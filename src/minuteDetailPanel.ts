import * as vscode from 'vscode';
import {
  StockQuote,
  KlineSeries,
  MinuteSeriesPoint,
  KlinePeriod,
  fetchKline,
  getMinuteCached,
  buildMinuteSeries,
  buildKlineSeries,
  clearKlineCache,
  isTradingTime,
  isPreOpen,
  resolveMinuteGap,
  isMinuteFinal,
  GAP_TEXT,
  KLINE_FETCH_COUNT,
} from './dataSource';
import { priceDecimals } from './util';
import { renderDetailHtml } from './detailHtml';
import { fetchQuotesCached } from './quoteCache';
import { config } from './config';
import { fetchStockEvents, StockEventItem } from './stockNews';

const REFRESH_INTERVAL_MS = 10_000;
const NEWS_REFRESH_MS = 300_000;

export class MinuteDetailPanel {
  public static readonly viewType = 'aStockWatch.detail';
  private static current: MinuteDetailPanel | null = null;

  static open(symbol: string, quote?: StockQuote): void {
    const existing = MinuteDetailPanel.current;
    if (existing && !existing.disposed) {
      // 关键修复：复用面板时不要反复 reveal 到 ViewColumn.Beside。
      // Beside 会被解析成具体列号，多次 reveal 会让面板在 col=2/col=3
      // 之间反复切换，每次切换 VSCode 都会销毁并重建 webview 内容，
      // 导致 fetchData 完成后发出的 postMessage 在重建瞬间被丢弃 → 空白。
      // 改为：已可见则只 reveal()（保留原列），隐藏则回到原列。
      if (existing.panel.visible) {
        existing.panel.reveal(existing.panel.viewColumn);
      } else {
        existing.panel.reveal(existing.panel.viewColumn, true);
      }
      void existing.load(symbol, quote);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      MinuteDetailPanel.viewType,
      '走势',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    MinuteDetailPanel.current = new MinuteDetailPanel(panel, symbol, quote);
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposeSub: vscode.Disposable;
  private readonly viewChangeSub: vscode.Disposable;
  private readonly configSub: vscode.Disposable;
  private timer: NodeJS.Timeout | null = null;
  private symbol: string;
  private quote?: StockQuote;
  /** 分时序列（几何由 webview 现算，host 只保留数据） */
  private minuteSeries: MinuteSeriesPoint[] = [];
  private layoutFp = '';
  /** 当日分时已定格（覆盖收盘或收盘后宽限期），收盘后不再定时刷新 */
  private minuteFinal = false;
  private minuteDate = '';
  private volTotal = 0;
  private amtTotal = 0;
  private klineSeries = new Map<KlinePeriod, KlineSeries>();
  private error: string | null = null;
  /** 仅图表区的提示（停牌/退市/零成交/缺失），不吞头部与资讯 */
  private chartError: string | null = null;
  private ready = false;
  private pendingLoad = false;
  private pendingSymbol = false;
  private loading = false;
  private disposed = false;
  private boss = false;
  private newsTs = 0;
  /** webview 就绪后的首帧才回传 K 线缓存：后续刷新回传会重置 webview 的 K 线 TTL，造成重复请求。 */
  private pushKlineCache = true;

  private constructor(panel: vscode.WebviewPanel, symbol: string, quote?: StockQuote) {
    this.panel = panel;
    this.symbol = symbol;
    this.quote = quote;
    panel.webview.options = { enableScripts: true };
    panel.webview.html = renderDetailHtml();
    panel.webview.onDidReceiveMessage((msg) => {
      const m = msg as {
        type?: string;
        period?: KlinePeriod;
        force?: boolean;
        url?: string;
        items?: StockEventItem[];
        error?: string | null;
      } | null;
      if (!m) {
        return;
      }
      if (m.type === 'ready') {
        this.ready = true;
        this.pushKlineCache = true;
        if (this.pendingLoad) {
          this.pendingLoad = false;
          void this.load();
        } else {
          this.push();
        }
      } else if (m.type === 'needKline' && m.period) {
        void this.ensureKline(m.period, m.force === true);
      } else if (m.type === 'openUrl' && m.url) {
        openHttpUrl(m.url);
      }
    });
    this.disposeSub = panel.onDidDispose(() => this.onDispose());
    this.viewChangeSub = panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.visible) {
        this.startTimer();
        // reveal 复用到其他视图列时，webview 内容可能被重置或 postMessage
        // 在切换瞬间被丢弃。面板重新可见时，补推一次当前已加载的数据，
        // 避免「不关闭点另一个 → 空白」。
        if (this.ready && (this.minuteSeries.length > 0 || this.quote)) {
          this.push();
        }
      } else {
        this.stopTimer();
      }
    });
    this.configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aStockWatch.bossMode') || e.affectsConfiguration('aStockWatch.bossModeTitle')) {
        this.boss = config.bossMode();
        this.panel.title = this.titleFor(this.quote);
        if (this.ready) {
          this.push();
        }
      }
    });
    this.boss = config.bossMode();
    if (panel.visible) {
      this.startTimer();
    }
    void this.load();
  }

  private async load(symbol?: string, quote?: StockQuote): Promise<void> {
    if (symbol) {
      if (this.symbol !== symbol) {
        // 切换标的时丢弃旧图与错误，避免上一次成功的布局泄漏到新标的
        this.minuteSeries = [];
        this.layoutFp = '';
        this.error = null;
        this.chartError = null;
        this.minuteFinal = false;
        this.klineSeries.clear();
        clearKlineCache(symbol);
        this.newsTs = 0;
      }
      this.symbol = symbol;
      this.quote = quote;
    }
    if (!this.ready) {
      this.pendingLoad = true;
      return;
    }
    if (this.loading) {
      this.pendingSymbol = true;
      return;
    }    this.loading = true;
    try {
      await this.fetchData(true);
    } finally {
      this.loading = false;
    }
    if (this.pendingSymbol) {
      this.pendingSymbol = false;
      // 携带当前（最新）的标的与行情重载，避免 reveal 触发的
      // onDidChangeViewState 与本次 load 交错导致的旧图污染
      void this.load(this.symbol, this.quote);
    }
    void this.ensureNews();
  }

  private async refreshTick(): Promise<void> {
    // 收盘后还需一次补拉拿到 15:00 收尾点；定格后不再空转
    if (!isTradingTime() && this.minuteFinal) {
      return;
    }
    await this.load();
  }

  private titleFor(q?: StockQuote): string {
    if (this.boss) {
      return config.bossModeTitle();
    }
    return `${q?.name ?? this.symbol} · 走势`;
  }

  private async fetchData(refetchQuote: boolean): Promise<void> {
    if (refetchQuote || !this.quote || this.quote.symbol !== this.symbol) {
      try {
        const list = await fetchQuotesCached([this.symbol]);
        this.quote = list[0];
      } catch {
        // keep the last known quote only when symbols match
        if (this.quote && this.quote.symbol !== this.symbol) {
          this.quote = undefined;
        }
      }
    }
    // 注意：此处不再无条件清空 layout/error。
    // 切换标的时的清空已由 load() 负责；同标的刷新失败时应保留上一张图，
    // 避免每 10s 定时刷新闪现「暂无分时数据」。
    const q = this.quote;
    if (!q) {
      this.error = '未获取到行情数据';
      this.push();
      return;
    }
    if (q.symbol !== this.symbol) {
      // 残留的旧行情与目标股票不匹配，不应使用
      this.error = '未获取到行情数据';
      this.push();
      return;
    }
    this.error = null;
    this.panel.title = this.titleFor(q);
    try {
      const { data } = await getMinuteCached(this.symbol);
      // 末笔价量一并纳入指纹：当前分钟内价格/成交量会原地更新，只看点数会让图形滞后一分钟
      const lastPoint = data.points[data.points.length - 1];
      const fp = `${data.date}|${data.points.length}|${lastPoint?.price ?? ''}|${lastPoint?.vol ?? ''}|${q.prevClose}|${q.limitUp ?? ''}|${q.limitDown ?? ''}`;
      // 定格判定与指纹无关：收盘后数据不再变化时指纹不变，仍需靠时间宽限结束轮询
      const gap = resolveMinuteGap(data, q.state);
      this.minuteFinal = isMinuteFinal(data, gap);
      if (fp !== this.layoutFp) {
        this.minuteSeries = buildMinuteSeries(data);
        // 出图失败仅作图表区提示（停牌/退市/零成交/缺失），头部与资讯照常渲染；
        // 盘前无当日数据不算缺失，提示「未开盘」
        const drawable = this.minuteSeries.length >= 2;
        this.chartError = drawable ? null : gap === 'ok' && isPreOpen() ? '未开盘' : GAP_TEXT[gap];
        this.layoutFp = fp;
      }
      let vol = 0;
      let amt = 0;
      for (const p of data.points) {
        if (p.vol !== undefined) {
          vol = p.vol;
        }
        if (p.amt !== undefined) {
          amt = p.amt;
        }
      }
      this.volTotal = vol;
      this.amtTotal = amt;
      this.minuteDate = data.date;
    } catch (err) {
      // 同标的刷新失败时保留上一张可用图；切换标的时序列已被 load 清空，
      // 走到这里必然给出提示（图表区），避免旧图残留
      if (this.minuteSeries.length === 0) {
        this.chartError = err instanceof Error ? err.message : '加载失败';
      }
    }
    this.push();
  }

  /** 按需拉取个股相关资讯（新闻+公告），经独立消息下发，避免阻塞主图渲染。 */
  private async ensureNews(force = false): Promise<void> {
    if (!this.ready) {
      return;
    }
    if (!config.showStockNews()) {
      return;
    }
    if (!force && Date.now() - this.newsTs < NEWS_REFRESH_MS) {
      return;
    }
    this.newsTs = Date.now();
    const code = this.symbol.slice(2);
    try {
      const items = await fetchStockEvents(code);
      void this.panel.webview.postMessage({ type: 'news', items, error: null });
    } catch (err) {
      void this.panel.webview.postMessage({
        type: 'news',
        items: [],
        error: err instanceof Error ? err.message : '加载失败',
      });
    }
  }

  /** 按需拉取并缓存指定周期的 K 线数据包。force 仅绕过本层缓存，数据仍受数据源 60s 缓存约束。 */
  private async ensureKline(period: KlinePeriod, force = false): Promise<void> {
    if (!this.ready) {
      return;
    }
    if (!force && this.klineSeries.has(period)) {
      return;
    }
    try {
      const all = await fetchKline(this.symbol, KLINE_FETCH_COUNT, period);
      if (all.length < 2) {
        void this.panel.webview.postMessage({ type: 'kline', period, error: 'K线数据不足' });
        return;
      }
      const series = buildKlineSeries(all);
      this.klineSeries.set(period, series);
      void this.panel.webview.postMessage({
        type: 'kline',
        period,
        series,
      });
    } catch (err) {
      void this.panel.webview.postMessage({
        type: 'kline',
        period,
        error: err instanceof Error ? err.message : '加载失败',
      });
    }
  }

  private push(): void {
    if (!this.ready) {
      return;
    }
    const q = this.quote;
    void this.panel.webview.postMessage({
      type: 'data',
      symbol: this.symbol,
      name: q?.name ?? '',
      code: this.symbol.slice(2),
      price: q?.price,
      change: q?.change,
      changePct: q?.changePct,
      prevClose: q?.prevClose,
      open: q?.open,
      high: q?.high,
      low: q?.low,
      trend: q?.trend ?? 'flat',
      turnoverRate: q?.turnoverRate,
      pe: q?.pe,
      pb: q?.pb,
      circMcap: q?.circMcap,
      totalMcap: q?.totalMcap,
      amount: q?.amount,
      amplitude: q?.amplitude,
      limitUp: q?.limitUp,
      limitDown: q?.limitDown,
      volRatio: q?.volRatio,
      avgPrice: q?.avgPrice,
      outerVol: q?.outerVol,
      innerVol: q?.innerVol,
      digits: priceDecimals(this.symbol, q?.price),
      minuteSeries: this.minuteSeries,
      layoutFp: this.layoutFp,
      klineSeries: this.pushKlineCache ? Object.fromEntries(this.klineSeries) : undefined,
      showNews: config.showStockNews(),
      volTotal: this.volTotal,
      amtTotal: this.amtTotal,
      minuteDate: this.minuteDate,
      error: this.error,
      chartError: this.chartError,
      boss: this.boss,
    });
    this.pushKlineCache = false;
  }

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => void this.refreshTick(), REFRESH_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private onDispose(): void {
    this.disposed = true;
    this.stopTimer();
    this.disposeSub.dispose();
    this.viewChangeSub.dispose();
    this.configSub.dispose();
    if (MinuteDetailPanel.current === this) {
      MinuteDetailPanel.current = null;
    }
  }
}

/** 仅放行 http/https：不应让 webview 消息触发其它协议的 URI（如 command:）。 */
function openHttpUrl(raw: string): void {
  let uri: vscode.Uri;
  try {
    uri = vscode.Uri.parse(raw);
  } catch {
    return;
  }
  if (uri.scheme === 'http' || uri.scheme === 'https') {
    void vscode.env.openExternal(uri);
  }
}
