import * as vscode from 'vscode';
import {
  StockQuote,
  MinuteChartLayout,
  KlineLayout,
  KlinePeriod,
  fetchKline,
  getMinuteCached,
  buildMinuteChart,
  buildKlineLayout,
  clearKlineCache,
  isTradingTime,
  KLINE_CANDLE_COUNT,
  KLINE_FETCH_COUNT,
} from './dataSource';
import { getNonce } from './util';
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
  private layout: MinuteChartLayout | null = null;
  private layoutFp = '';
  private minuteDate = '';
  private volTotal = 0;
  private amtTotal = 0;
  private klineLayouts = new Map<KlinePeriod, KlineLayout>();
  private error: string | null = null;
  private ready = false;
  private pendingLoad = false;
  private pendingSymbol = false;
  private loading = false;
  private disposed = false;
  private boss = false;
  private newsTs = 0;

  private constructor(panel: vscode.WebviewPanel, symbol: string, quote?: StockQuote) {
    this.panel = panel;
    this.symbol = symbol;
    this.quote = quote;
    panel.webview.options = { enableScripts: true };
    panel.webview.html = this.html();
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
        if (this.pendingLoad) {
          this.pendingLoad = false;
          void this.load();
        } else {
          this.push();
        }
      } else if (m.type === 'needKline' && m.period) {
        void this.ensureKline(m.period, m.force === true);
      } else if (m.type === 'openUrl' && m.url) {
        void vscode.env.openExternal(vscode.Uri.parse(m.url));
      }
    });
    this.disposeSub = panel.onDidDispose(() => this.onDispose());
    this.viewChangeSub = panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.visible) {
        this.startTimer();
        // reveal 复用到其他视图列时，webview 内容可能被重置或 postMessage
        // 在切换瞬间被丢弃。面板重新可见时，补推一次当前已加载的数据，
        // 避免「不关闭点另一个 → 空白」。
        if (this.ready && (this.layout !== null || this.quote)) {
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
        this.layout = null;
        this.layoutFp = '';
        this.error = null;
        this.klineLayouts.clear();
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
    }
    this.loading = true;
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
    if (!isTradingTime()) {
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
    this.panel.title = this.titleFor(q);
    try {
      const { data } = await getMinuteCached(this.symbol);
      const fp = `${data.date}|${data.points.length}|${q.prevClose}`;
      if (fp !== this.layoutFp) {
        const layout = buildMinuteChart(data, q.prevClose, {
          limitUp: q.limitUp,
          limitDown: q.limitDown,
        });
        this.layout = layout;
        this.error = layout ? null : '分时数据缺失';
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
      // 同标的刷新失败时保留上一张可用图；切换标的时 layout 已被 load 清空，
      // 走到这里必然置错误提示，避免旧图残留
      if (this.layout === null) {
        this.error = err instanceof Error ? err.message : '加载失败';
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

  /** 按需拉取并缓存指定周期的 K 线布局（命中缓存则不重复请求；force 跳过缓存用于定时刷新）。 */
  private async ensureKline(period: KlinePeriod, force = false): Promise<void> {    if (!this.ready) {
      return;
    }
    if (!force && this.klineLayouts.has(period)) {
      return;
    }
    try {
      const all = await fetchKline(this.symbol, KLINE_FETCH_COUNT, period);
      if (all.length < 2) {
        void this.panel.webview.postMessage({ type: 'kline', period, error: 'K线数据不足' });
        return;
      }
      const layout = buildKlineLayout(all, KLINE_CANDLE_COUNT);
      this.klineLayouts.set(period, layout);
      void this.panel.webview.postMessage({ type: 'kline', period, layout });
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
      layout: this.layout,
      klineLayouts: Object.fromEntries(this.klineLayouts),
      volTotal: this.volTotal,
      amtTotal: this.amtTotal,
      minuteDate: this.minuteDate,
      error: this.error,
      boss: this.boss,
    });
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

  private html(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
:root{--up:#E15241;--down:#2EA46E;--avg:#d8a33a}
@media (prefers-color-scheme: light){:root{--up:#C73E2E;--down:#2F8F5B;--avg:#b07d1f}}
body.boss{filter:grayscale(1)}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);padding:0 0 12px;user-select:none}
.up{color:var(--up)}
.down{color:var(--down)}
.flat{color:var(--vscode-descriptionForeground)}
.head{display:flex;align-items:baseline;gap:10px;padding:12px 12px 6px}
.head .nm{font-size:15px;font-weight:600;letter-spacing:.2px}
.head .cd{font-size:11px;color:var(--vscode-descriptionForeground);padding-left:2px}
.head .px{font-size:26px;font-weight:600;letter-spacing:-.5px;font-variant-numeric:tabular-nums;margin-left:auto}
.head .px .sig{margin-right:4px;vertical-align:2px}
.sig{width:16px;height:16px;display:inline-block}
.rocket{animation:rocket-bob .9s ease-in-out infinite alternate}
.rocket.down{animation-name:rocket-bob-down}
@keyframes rocket-bob{from{transform:translateY(-1.5px)}to{transform:translateY(1.5px)}}
@keyframes rocket-bob-down{from{transform:rotate(180deg) translateY(-1.5px)}to{transform:rotate(180deg) translateY(1.5px)}}
body.boss .rocket,body.boss .rocket.down{animation:none}
.head .chg{font-size:12px;font-variant-numeric:tabular-nums;text-align:right;line-height:1.3;min-width:56px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:3px 8px;padding:2px 12px 0;font-size:11px;color:var(--vscode-descriptionForeground)}
.stats + .stats{padding-bottom:6px}
.stats span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stats b{color:var(--vscode-foreground);font-weight:600;font-variant-numeric:tabular-nums}
.chart-wrap{position:relative;margin:0 6px}
.chart{display:block;width:100%;height:auto;cursor:crosshair}
.chart line.grid{stroke:var(--vscode-editorWidget-border);stroke-width:1;opacity:.6;vector-effect:non-scaling-stroke}
.chart line.base{stroke:var(--vscode-descriptionForeground);stroke-width:1.5;stroke-dasharray:4 3;opacity:.75;vector-effect:non-scaling-stroke}
.chart line.lim{stroke-width:1;stroke-dasharray:2 3;vector-effect:non-scaling-stroke;opacity:.55}
.chart line.limUp{stroke:var(--up)}
.chart line.limDown{stroke:var(--down)}
.chart text.limUp{fill:var(--up);opacity:.85}
.chart text.limDown{fill:var(--down);opacity:.85}
.chart text.avgEnd{fill:var(--avg);font-size:10px}
.chart polyline.avg{fill:none;stroke:var(--avg);stroke-width:1.4;vector-effect:non-scaling-stroke}
.chart polyline.ma{fill:none;stroke-width:1.1;vector-effect:non-scaling-stroke}
.chart polyline.ma5{stroke:var(--vscode-foreground);opacity:.9}
.chart polyline.ma10{stroke:#e5c07b}
.chart polyline.ma20{stroke:#c678dd}
.chart polyline.volma{fill:none;stroke:var(--vscode-descriptionForeground);stroke-width:1;stroke-dasharray:3 2;opacity:.7;vector-effect:non-scaling-stroke}
.malegend{position:absolute;top:3px;left:8px;display:flex;flex-wrap:wrap;gap:2px 10px;z-index:3;font-size:11px;color:var(--vscode-descriptionForeground);user-select:none;pointer-events:none}
.malegend span{pointer-events:auto;cursor:pointer;display:inline-flex;align-items:center;gap:4px;line-height:15px}
.malegend span:hover{color:var(--vscode-foreground)}
.malegend span.off{opacity:.35}
.malegend b{color:var(--vscode-foreground);font-weight:600;font-variant-numeric:tabular-nums}
.malegend .sw{width:10px;height:2px;border-radius:1px;display:inline-block;flex:none}
.malegend .sw.lg5{background:var(--vscode-foreground)}
.malegend .sw.lg10{background:#e5c07b}
.malegend .sw.lg20{background:#c678dd}
.malegend .sw.lgv{background:var(--vscode-descriptionForeground)}
.chart line.lastprice{stroke:var(--vscode-descriptionForeground);stroke-width:1;stroke-dasharray:4 3;opacity:.8;vector-effect:non-scaling-stroke}
@media (prefers-color-scheme: light){.chart polyline.ma10{stroke:#b8860b}.chart polyline.ma20{stroke:#7c3aed}.malegend .sw.lg10{background:#b8860b}.malegend .sw.lg20{background:#7c3aed}}
.chart polyline.price{fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;transition:stroke-width .12s ease}
.chart-wrap:hover polyline.price{stroke-width:2}
@media (prefers-reduced-motion:reduce){.chart polyline.price{transition:none}}
.chart polyline.price.up{stroke:var(--up)}
.chart polyline.price.down{stroke:var(--down)}
.chart polyline.price.flat{stroke:var(--vscode-descriptionForeground)}
.chart rect.v{stroke:none;opacity:.45}
.chart rect.v.up{fill:var(--up)}
.chart rect.v.down{fill:var(--down)}
.chart text{fill:var(--vscode-descriptionForeground);font-size:9px}
.chart .cross line{stroke:var(--vscode-descriptionForeground);stroke-width:1;stroke-dasharray:3 3;opacity:.7;vector-effect:non-scaling-stroke}
.chart .cross circle{fill:none;stroke-width:1.4;vector-effect:non-scaling-stroke}
.chart .cross circle.p{fill:var(--vscode-editor-background)}
.chart .cross circle.p.up{stroke:var(--up)}
.chart .cross circle.p.down{stroke:var(--down)}
.chart .cross circle.p.flat{stroke:var(--vscode-descriptionForeground)}
.chart .cross circle.a{stroke:var(--avg)}
.chart circle.end{fill:var(--vscode-editor-background);stroke-width:1.6;vector-effect:non-scaling-stroke}
.chart circle.end.up{stroke:var(--up)}
.chart circle.end.down{stroke:var(--down)}
.chart circle.end.flat{stroke:var(--vscode-descriptionForeground)}
.tip{position:absolute;display:none;min-width:130px;background:var(--vscode-menu-background);color:var(--vscode-menu-foreground);border:1px solid var(--vscode-menu-border);border-radius:4px;box-shadow:var(--vscode-widget-shadow);padding:6px 8px;font-size:11px;pointer-events:none;line-height:1.5;z-index:10}
.tip .row{display:flex;justify-content:space-between;gap:14px;align-items:baseline}
.tip .row b{font-variant-numeric:tabular-nums;font-weight:600}
.tabs{display:flex;gap:2px;padding:6px 12px 0;border-bottom:1px solid var(--vscode-editorWidget-border)}
.tabs button{flex:1;max-width:110px;background:none;border:none;color:var(--vscode-descriptionForeground);font-size:12px;padding:6px 0;cursor:pointer;border-radius:4px 4px 0 0;border-bottom:2px solid transparent;transition:color .12s ease,border-color .12s ease,background .12s ease}
.tabs button:hover{color:var(--vscode-foreground);background:var(--vscode-list-hoverBackground)}
.tabs button.on{color:var(--vscode-foreground);border-bottom-color:var(--vscode-focusBorder);font-weight:600;background:var(--vscode-list-hoverBackground)}
.chart .candle line{stroke-width:1;vector-effect:non-scaling-stroke}
.chart .candle line.up{stroke:var(--up)}
.chart .candle line.down{stroke:var(--down)}
.chart .candle rect.up{fill:var(--up);stroke:var(--up)}
.chart .candle rect.down{fill:var(--down);stroke:var(--down)}
.msg{padding:24px;color:var(--vscode-descriptionForeground);text-align:center}
.foot{display:flex;justify-content:space-between;padding:6px 14px 0;font-size:10px;color:var(--vscode-descriptionForeground);opacity:.8}
.related{margin:8px 12px 0;border-top:1px solid var(--vscode-editorWidget-border);padding-top:6px}
.related h4{font-size:11px;color:var(--vscode-descriptionForeground);margin:0 0 4px;font-weight:600;letter-spacing:.3px}
.relist{max-height:220px;overflow-y:auto}
.relmsg{padding:8px 0;color:var(--vscode-descriptionForeground);font-size:12px}
.ritem{display:flex;gap:6px;align-items:baseline;padding:4px 2px;cursor:pointer;border-radius:3px}
.ritem:hover{background:var(--vscode-list-hoverBackground)}
.ritem .t{font-size:11px;color:var(--vscode-descriptionForeground);font-variant-numeric:tabular-nums;white-space:nowrap;flex:none;width:38px;text-align:right}
.ritem .tag{font-size:10px;padding:0 4px;border-radius:3px;line-height:14px;white-space:nowrap;flex:none}
.ritem .tag.ann{color:#b07d1f;background:rgba(216,163,58,.16)}
.ritem .tag.news{color:#4a9eff;background:rgba(74,158,255,.16)}
.ritem .ti{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:text}
.ritem:hover .ti{text-decoration:underline}
</style>
</head>
<body>
<div id="app"><div class="msg">加载中…</div></div>
<script nonce="${nonce}">
(function(){
  const app=document.getElementById('app');
  const api=acquireVsCodeApi();
  app.addEventListener('click',e=>{
    const el=(e.target instanceof HTMLElement)?e.target.closest('.ritem'):null;
    if(el&&el.dataset.url) api.postMessage({type:'openUrl',url:el.dataset.url});
  });
  const fmtVol=function(v){ if(v>=10000) return (v/10000).toFixed(2)+'万手'; return Math.round(v)+'手'; };
  const fmtAmt=function(v){ if(v>=1e12) return (v/1e12).toFixed(2)+'万亿'; if(v>=1e8) return (v/1e8).toFixed(2)+'亿'; if(v>=1e4) return (v/1e4).toFixed(2)+'万'; return Math.round(v); };
  const cls=function(p,c){ return p>c?'up':p<c?'down':'flat'; };
  const sign=function(n){ return n>=0?'+':''; };
  const esc=function(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));};
  const hm=function(t){ return t.slice(0,2)+':'+t.slice(2); };
  const TABS=['分时','日K','周K','月K'];
  let last=null;
  let sym=null;
  let state={tab:'分时',klines:{},klinesTs:{},klinesPending:{},maHide:{},news:null,newsError:null};
  const KLINE_TTL_MS=60000;
  function requestKline(p){
    if(state.klinesPending[p])return;
    state.klinesPending[p]=true;
    api.postMessage({type:'needKline',period:p,force:true});
  }
  function needFetch(p){
    return !state.klines[p]||(state.klinesTs[p]!=null&&Date.now()-state.klinesTs[p]>KLINE_TTL_MS);
  }
  function maybeRefreshKline(){
    const p=periodFor(state.tab);
    if(p&&!state.klinesPending[p]&&state.klines[p]&&!state.klines[p].error&&needFetch(p))requestKline(p);
  }
  api.postMessage({type:'ready'});
  window.addEventListener('message',e=>{
    const m=e.data;
    if(!m)return;
    if(m.type==='data'){
      if(m.symbol!==sym){ sym=m.symbol; state={tab:'分时',klines:{},klinesTs:{},klinesPending:{},maHide:{},news:null,newsError:null}; }
      if(m.klineLayouts){
        state.klines=m.klineLayouts;
        // 反序列化恢复的布局无时间戳，标记为过期以触发一次刷新
        for(const k in state.klines)state.klinesTs[k]=0;
      }
      last=m;
      render(m);
      maybeRefreshKline();
    } else if(m.type==='kline'){
      state.klinesPending[m.period]=false;
      if(m.error){
        // 定时刷新失败时保留旧图继续展示，仅顺延下轮刷新时间
        if(!state.klines[m.period]||state.klines[m.period].error)state.klines[m.period]={error:m.error};
        else state.klinesTs[m.period]=Date.now();
      }
      else { state.klines[m.period]=m.layout; state.klinesTs[m.period]=Date.now(); }
      render(last);
    } else if(m.type==='news'){
      state.news = m.items && m.items.length ? m.items : [];
      state.newsError = m.error || null;
      if(last) render(last);
    }
  });
  let lastTab=null;
  let lastChartKey=null;
  const SIG={
    rocketUp:'<svg class="sig rocket" viewBox="0 0 16 16">'
      +'<path d="M8 .5 10.3 4H5.7Z" fill="currentColor"/>'
      +'<rect x="4.8" y="3.6" width="6.4" height="6.2" rx="1.6" fill="currentColor"/>'
      +'<circle cx="8" cy="5.9" r="1.5" fill="#12131a"/>'
      +'<path d="M4.9 8.7 2.3 12.2H5.9Z" fill="currentColor"/>'
      +'<path d="M11.1 8.7 13.7 12.2H10.1Z" fill="currentColor"/>'
      +'<path d="M7 9.5 8 13.6 9 9.5Z" fill="#f4b400"/>'
      +'<path d="M7.5 9.8 8 12.2 8.5 9.8Z" fill="#ffd54f"/></svg>',
    rocketDown:'<svg class="sig rocket down" viewBox="0 0 16 16">'
      +'<path d="M8 .5 10.3 4H5.7Z" fill="currentColor"/>'
      +'<rect x="4.8" y="3.6" width="6.4" height="6.2" rx="1.6" fill="currentColor"/>'
      +'<circle cx="8" cy="5.9" r="1.5" fill="#12131a"/>'
      +'<path d="M4.9 8.7 2.3 12.2H5.9Z" fill="currentColor"/>'
      +'<path d="M11.1 8.7 13.7 12.2H10.1Z" fill="currentColor"/>'
      +'<path d="M7 9.5 8 13.6 9 9.5Z" fill="#f4b400"/>'
      +'<path d="M7.5 9.8 8 12.2 8.5 9.8Z" fill="#ffd54f"/></svg>',
    bolt:'<svg class="sig" viewBox="0 0 16 16"><path d="M9 1 3 9h4l-1 6 7-8H9Z" fill="currentColor"/></svg>',
    triUp:'<svg class="sig" viewBox="0 0 16 16"><path d="M8 1.5 15 14.5H1Z" fill="currentColor" stroke-linejoin="round"/></svg>',
    triDown:'<svg class="sig" viewBox="0 0 16 16"><path d="M8 14.5 15 1.5H1Z" fill="currentColor" stroke-linejoin="round"/></svg>',
    diagUp:'<svg class="sig" viewBox="0 0 16 16"><path d="M2.5 13.5 12 4M7 4h5v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    diagDown:'<svg class="sig" viewBox="0 0 16 16"><path d="M2.5 2.5 12 12M7 12h5V7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    flat:'<svg class="sig" viewBox="0 0 16 16"><rect x="2" y="7" width="12" height="2.2" rx="1.1" fill="currentColor"/></svg>'
  };
  const sig=function(m){
    if(m.price!=null&&m.limitUp!=null&&m.price>=m.limitUp-0.01) return SIG.rocketUp;
    if(m.price!=null&&m.limitDown!=null&&m.price<=m.limitDown+0.01) return SIG.rocketDown;
    const a=Math.abs(m.changePct||0);
    if(a>=5) return SIG.bolt;
    if(a>=2) return m.changePct>0?SIG.triUp:SIG.triDown;
    if(a>0) return m.changePct>0?SIG.diagUp:SIG.diagDown;
    return SIG.flat;
  };
  const headInner=function(m,pxCls,price,change,changePct){
    return '<span class="nm">'+esc(m.name)+'</span><span class="cd">'+esc(m.code)+'</span>'+
      '<span class="px '+pxCls+'">'+sig(m)+' '+price.toFixed(2)+'</span>'+
      '<span class="chg '+pxCls+'">'+sign(change)+change.toFixed(2)+'&nbsp; '+sign(changePct)+changePct.toFixed(2)+'%</span>';
  };
  const row1Inner=function(m,prevClose){
    return '<span>今开 <b>'+(m.open!=null?m.open.toFixed(2):'—')+'</b></span>'+
      '<span>最高 <b>'+(m.high!=null?m.high.toFixed(2):'—')+'</b></span>'+
      '<span>最低 <b>'+(m.low!=null?m.low.toFixed(2):'—')+'</b></span>'+
      '<span>昨收 <b>'+prevClose.toFixed(2)+'</b></span>';
  };
  const row2Inner=function(m,vol){
    const r=state.tab==='分时'
      ?[['成交量',fmtVol(vol)],['成交额',fmtAmt(m.amtTotal)],['换手',m.turnoverRate!=null?m.turnoverRate.toFixed(2)+'%':null],['振幅',m.amplitude!=null?m.amplitude.toFixed(2)+'%':null]]
      :[['成交量',fmtVol(vol)],['成交额',fmtAmt(m.amtTotal)],['换手',m.turnoverRate!=null?m.turnoverRate.toFixed(2)+'%':null],['市盈率',m.pe!=null?m.pe.toFixed(2):null]];
    return r.map(a=>'<span>'+a[0]+' <b>'+(a[1]!=null?a[1]:'—')+'</b></span>').join('');
  };
  const footInner=function(m){
    const parts=[];
    if(m.circMcap!=null) parts.push('流通 '+fmtAmt(m.circMcap));
    if(m.totalMcap!=null) parts.push('总市值 '+fmtAmt(m.totalMcap));
    if(m.pb!=null) parts.push('市净 '+m.pb.toFixed(2));
    if(m.volRatio!=null) parts.push('量比 '+m.volRatio.toFixed(2));
    if(m.avgPrice!=null) parts.push('均价 '+m.avgPrice.toFixed(2));
    if(m.limitUp!=null) parts.push('涨停 '+m.limitUp.toFixed(2));
    if(m.limitDown!=null) parts.push('跌停 '+m.limitDown.toFixed(2));
    return '<span>分时 '+(m.minuteDate||'—')+'</span><span>'+parts.join(' · ')+'</span>';
  };
  const formatEventTime=function(ms){
    if(!ms) return '—';
    const d=new Date(ms);
    const now=new Date();
    const p=n=>String(n).padStart(2,'0');
    if(d.toDateString()===now.toDateString()) return p(d.getHours())+':'+p(d.getMinutes());
    return p(d.getMonth()+1)+'-'+p(d.getDate());
  };
  const newsInner=function(items,err){
    if(err) return '<div class="relmsg">'+esc(err)+'</div>';
    if(!items||!items.length) return '<div class="relmsg">暂无相关资讯</div>';
    return items.map(it=>{
      const cls2=it.kind==='公告'?'ann':'news';
      return '<div class="ritem" data-url="'+esc(it.url)+'">'
        +'<span class="t">'+formatEventTime(it.time)+'</span>'
        +'<span class="tag '+cls2+'">'+esc(it.kind)+'</span>'
        +'<span class="ti">'+esc(it.title)+'</span>'
        +'</div>';
    }).join('');
  };
  function updateText(m){
    const price=m.price==null?0:m.price;
    const prevClose=m.prevClose==null?0:m.prevClose;
    const change=m.change==null?0:m.change;
    const changePct=m.changePct==null?0:m.changePct;
    const pxCls=cls(price,prevClose);
    const head=document.getElementById('head');
    if(head) head.innerHTML=headInner(m,pxCls,price,change,changePct);
    const row1=document.getElementById('row1');
    if(row1) row1.innerHTML=row1Inner(m,prevClose);
    const row2=document.getElementById('row2');
    if(row2) row2.innerHTML=row2Inner(m,m.volTotal);
    const foot=document.getElementById('foot');
    if(foot) foot.innerHTML=footInner(m);
    const rel=document.getElementById('related');
    if(rel) rel.innerHTML='<h4>相关资讯</h4>'+newsInner(state.news,state.newsError);
  }
  function render(m){
    try {
      document.body.classList.toggle('boss',!!m.boss);
      if(m.error){ app.innerHTML='<div class="msg">'+m.error+'</div>'; lastTab=null; lastChartKey=null; return; }
      const price=m.price==null?0:m.price;
      const prevClose=m.prevClose==null?0:m.prevClose;
      const change=m.change==null?0:m.change;
      const changePct=m.changePct==null?0:m.changePct;
      const pxCls=cls(price,prevClose);
      const vol=m.volTotal;
      const kp=state.tab==='分时'?null:periodFor(state.tab);
      const chartRef=state.tab==='分时'?m.layout:state.klines[kp];
      const sameTab=state.tab===lastTab;
      const sameChart=chartRef===lastChartKey;
      lastTab=state.tab;
      lastChartKey=chartRef;
      if(sameTab&&sameChart&&chartRef!==null&&document.getElementById('head')){
        updateText(m);
        return;
      }
      const head='<div class="head" id="head">'+headInner(m,pxCls,price,change,changePct)+'</div>';
      const row1='<div class="stats" id="row1">'+row1Inner(m,prevClose)+'</div>';
      const row2='<div class="stats" id="row2">'+row2Inner(m,vol)+'</div>';
      const tabs='<div class="tabs">'+TABS.map(t=>'<button data-tab="'+t+'" class="'+(t===state.tab?'on':'')+'">'+t+'</button>').join('')+'</div>';
      const body=state.tab==='分时'?chartSVG(m):klineSVG(state.tab);
      app.innerHTML=head+row1+row2+tabs+body
        +'<div class="related" id="related"><h4>相关资讯</h4>'+newsInner(state.news,state.newsError)+'</div>'
        +'<div class="foot" id="foot">'+footInner(m)+'</div>';
      bindTabs();
      if(state.tab==='分时') bindChart(m);
      else bindKline(state.tab);
    } catch (e) {
      app.innerHTML='<div class="msg">渲染失败: '+(e&&e.message?e.message:String(e))+'</div>';
      console.error('AStockDetail render error', e);
    }
  }
  function bindTabs(){
    app.querySelectorAll('.tabs button').forEach(btn=>{
      btn.addEventListener('click',()=>{
        state.tab=btn.dataset.tab;
        if(state.tab!=='分时'){
          const p=periodFor(state.tab);
          if(p&&needFetch(p))requestKline(p);
        }
        render(last);
      });
    });
  }
  function periodFor(tab){
    if(tab==='日K')return 'day';
    if(tab==='周K')return 'week';
    if(tab==='月K')return 'month';
    return null;
  }
  function chartSVG(m){
    const L=m.layout;
    if(!L) return '<div class="msg">暂无分时数据</div>';
    const W=L.width,H=L.totalH,plotR=L.padL+L.plotW;
    const gridH=L.yTicks.map(t=>'<line class="grid" x1="0" y1="'+t.y+'" x2="'+plotR+'" y2="'+t.y+'"></line>').join('');
    const gridV=L.xTicks.map(t=>'<line class="grid" x1="'+t.x+'" y1="0" x2="'+t.x+'" y2="'+L.volBottom+'"></line>').join('');
    const yLab=L.yTicks.map(t=>'<text x="'+(plotR+4)+'" y="'+(t.y+3)+'" dominant-baseline="hanging">'+t.label+'</text>').join('');
    const xLab=L.xTicks.map(t=>'<text x="'+t.x+'" y="'+(L.volBottom+11)+'" text-anchor="middle">'+t.label+'</text>').join('');
    const bars=L.bars.map(b=>'<rect class="v '+b.cls+'" x="'+b.x.toFixed(1)+'" y="'+b.y.toFixed(1)+'" width="'+b.w.toFixed(2)+'" height="'+b.h.toFixed(1)+'"></rect>').join('');
    const pxCls=cls(L.lastPrice,m.prevClose);
    const avgEl=L.avgLine?('<polyline class="avg" points="'+L.avgLine+'"></polyline>'):'';
    const lastPt=L.pts[L.pts.length-1];
    const limitUpEl=L.limitUpY!=null&&m.limitUp!=null?('<line class="lim limUp" x1="0" y1="'+L.limitUpY.toFixed(1)+'" x2="'+plotR+'" y2="'+L.limitUpY.toFixed(1)+'"></line><text class="limUp" x="0" y="'+(L.limitUpY-3).toFixed(1)+'">涨停 '+m.limitUp.toFixed(2)+'</text>'):'';
    const limitDownEl=L.limitDownY!=null&&m.limitDown!=null?('<line class="lim limDown" x1="0" y1="'+L.limitDownY.toFixed(1)+'" x2="'+plotR+'" y2="'+L.limitDownY.toFixed(1)+'"></line><text class="limDown" x="0" y="'+(L.limitDownY-3).toFixed(1)+'">跌停 '+m.limitDown.toFixed(2)+'</text>'):'';
    const avgEndEl=L.avgLine&&lastPt.ay!=null?('<text class="avgEnd" x="'+plotR+'" y="'+(lastPt.ay-4).toFixed(1)+'" text-anchor="end">均价 '+(L.lastAvg!=null?L.lastAvg.toFixed(2):'')+'</text>'):'';
    return '<div class="chart-wrap"><div class="tip" id="tip"></div>'+
      '<svg class="chart" id="chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'+
      gridV+gridH+yLab+
      '<g id="vol">'+bars+'</g>'+
      '<line class="base" x1="0" y1="'+L.baseY+'" x2="'+plotR+'" y2="'+L.baseY+'"></line>'+
      '<text x="0" y="'+(L.baseY-4)+'">昨收 '+m.prevClose.toFixed(2)+'</text>'+
      limitUpEl+limitDownEl+
      '<polyline class="price '+pxCls+'" points="'+L.priceLine+'"></polyline>'+
      '<circle class="end '+pxCls+'" cx="'+lastPt.x.toFixed(1)+'" cy="'+lastPt.y.toFixed(1)+'" r="3"></circle>'+
      avgEl+avgEndEl+
      '<g class="cross" id="cross" style="display:none"><line id="cx" y1="0" y2="'+L.volBottom+'"></line><line id="cy" x1="0" x2="'+plotR+'"></line><circle id="cp" class="p" r="3.5"></circle><circle id="ca" class="a" r="3"></circle></g>'+
      xLab+
      '</svg></div>';
  }
  function bindChart(m){
    const L=m.layout;
    const svg=document.getElementById('chart');
    const cross=document.getElementById('cross');
    const cx=document.getElementById('cx');
    const cy=document.getElementById('cy');
    const cp=document.getElementById('cp');
    const ca=document.getElementById('ca');
    const tip=document.getElementById('tip');
    const W=L.width,H=L.totalH;
    const show=function(i){
      const p=L.pts[i];
      if(!p)return;
      cross.style.display='';
      cx.setAttribute('x1',p.x); cx.setAttribute('x2',p.x);
      cy.setAttribute('y1',p.y); cy.setAttribute('y2',p.y);
      cp.setAttribute('cx',p.x); cp.setAttribute('cy',p.y);
      cp.className.baseVal='p '+cls(p.price,m.prevClose);
      ca.setAttribute('cx',p.x);
      if(p.ay!=null){ ca.setAttribute('cy',p.ay); ca.style.display=''; } else { ca.style.display='none'; }
      const pc=cls(p.price,m.prevClose);
      tip.style.display='block';
      tip.innerHTML=
        '<div class="row"><span>'+hm(p.time)+'</span><b class="'+pc+'">'+p.price.toFixed(2)+'</b></div>'+
        (p.avg!=null?'<div class="row"><span>均价</span><b style="color:var(--avg)">'+p.avg.toFixed(2)+'</b></div>':'')+
        '<div class="row"><span>成交量</span><b>'+fmtVol(p.volume)+'</b></div>';
      const frac=p.x/W;
      const rw=svg.parentNode.getBoundingClientRect();
      const tw=tip.offsetWidth;
      const lx=frac*rw.width;
      const tx=frac<0.5?lx+10:lx-tw-10;
      tip.style.left=Math.min(Math.max(0,tx),rw.width-tw-4)+'px';
      tip.style.top='6px';
    };
    let r=svg.getBoundingClientRect();
    let last=-1,raf=0;
    svg.addEventListener('mouseenter',()=>{ r=svg.getBoundingClientRect(); });
    svg.addEventListener('mousemove',e=>{
      const sx=(e.clientX-r.left)/r.width*W;
      let lo=0,hi=L.pts.length-1;
      while(lo<hi){
        const mid=(lo+hi)>>1;
        if(L.pts[mid].x<sx)lo=mid+1;else hi=mid;
      }
      let best=lo;
      if(lo>0&&sx-L.pts[lo-1].x<Math.abs(L.pts[lo].x-sx))best=lo-1;
      if(best===last)return;
      last=best;
      cancelAnimationFrame(raf);
      raf=requestAnimationFrame(()=>show(best));
    });
    svg.addEventListener('mouseleave',()=>{ last=-1; cross.style.display='none'; tip.style.display='none'; });
  }
  function maSuffix(tab){
    return tab==='周K'?'W':tab==='月K'?'M':'';
  }
  function klineSVG(tab){
    const K=state.klines[periodFor(tab)];
    if(!K) return '<div class="msg">加载K线…</div>';
    if(K.error) return '<div class="msg">'+K.error+'</div>';
    const suf=maSuffix(tab);
    const W=K.width,H=K.totalH,plotR=K.padL+K.plotW;
    const gridH=K.yTicks.map(t=>'<line class="grid" x1="0" y1="'+t.y+'" x2="'+plotR+'" y2="'+t.y+'"></line>').join('');
    const yLab=K.yTicks.map(t=>'<text x="'+(plotR+4)+'" y="'+(t.y+3)+'" dominant-baseline="hanging">'+t.label+'</text>').join('');
    const xLab=K.xTicks.map(t=>'<text x="'+t.x+'" y="'+(K.volBottom+11)+'" text-anchor="middle">'+t.label+'</text>').join('');
    const candles=K.candles.map(c=>{
      const wick='<line x1="'+(c.x+c.w/2)+'" y1="'+c.wickY1+'" x2="'+(c.x+c.w/2)+'" y2="'+c.wickY2+'" class="'+c.cls+'"></line>';
      return '<g class="candle">'+wick+'<rect x="'+c.x+'" y="'+c.bodyY+'" width="'+c.w+'" height="'+Math.max(c.bodyH,1)+'" class="'+c.cls+'" rx="0"></rect></g>';
    }).join('');
    const volBars=K.volBars.map(b=>'<rect class="v '+b.cls+'" x="'+b.x.toFixed(1)+'" y="'+b.y.toFixed(1)+'" width="'+b.w.toFixed(2)+'" height="'+b.h.toFixed(1)+'"></rect>').join('');
    const maEls=K.maLines.map(ma=>{
      if(!ma.points)return '';
      return '<polyline class="ma ma'+ma.n+'" id="maline-'+ma.n+'" points="'+ma.points+'"'+(state.maHide[String(ma.n)]?' style="display:none"':'')+'></polyline>';
    }).join('');
    const volMaEl=K.volMaLine?('<polyline class="volma" id="maline-vol" points="'+K.volMaLine+'"'+(state.maHide.vol?' style="display:none"':'')+'></polyline>'):'';
    const lastVal=function(vals){return vals[vals.length-1];};
    const legendItems=K.maLines.map(function(ma,i){
      return {k:String(ma.n),label:'MA'+ma.n+suf,v:lastVal(K.maValues[i].vals)};
    });
    legendItems.push({k:'vol',label:'均量5',v:lastVal(K.volMaVals)});
    const legend='<div class="malegend">'+legendItems.map(function(it){
      const txt=it.v==null?'—':(it.k==='vol'?fmtVol(it.v):it.v.toFixed(2));
      return '<span data-k="'+it.k+'" class="'+(state.maHide[it.k]?'off':'')+'"><i class="sw lg'+(it.k==='vol'?'v':it.k)+'"></i>'+esc(it.label)+' <b>'+txt+'</b></span>';
    }).join('')+'</div>';
    const lastCandle=K.candles[K.candles.length-1];
    const closeY=lastCandle?(lastCandle.cls==='up'?lastCandle.bodyY:lastCandle.bodyY+lastCandle.bodyH):0;
    const lastPriceEl=lastCandle?('<line class="lastprice" x1="0" y1="'+closeY.toFixed(1)+'" x2="'+plotR+'" y2="'+closeY.toFixed(1)+'"></line><text x="'+plotR+'" y="'+(closeY-3).toFixed(1)+'" text-anchor="end">'+K.lastPrice.toFixed(2)+'</text>'):'';
    return '<div class="chart-wrap">'+legend+'<div class="tip" id="tip"></div>'+
      '<svg class="chart" id="chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'+
      gridH+yLab+
      '<g id="candles">'+candles+'</g>'+
      maEls+
      '<g id="vol">'+volBars+'</g>'+
      volMaEl+
      '<line class="base" x1="0" y1="'+K.mainH+'" x2="'+plotR+'" y2="'+K.mainH+'"></line>'+
      lastPriceEl+
      '<g class="cross" id="cross" style="display:none"><line id="cx" y1="0" y2="'+K.volBottom+'"></line><line id="cy" x1="0" x2="'+plotR+'"></line><circle id="kp" r="3"></circle></g>'+
      xLab+
      '</svg></div>';
  }
  function bindKline(){
    const K=state.klines[periodFor(state.tab)];
    const svg=document.getElementById('chart');
    if(!K||!svg)return;
    const cross=document.getElementById('cross');
    const cx=document.getElementById('cx');
    const cy=document.getElementById('cy');
    const kp=document.getElementById('kp');
    const tip=document.getElementById('tip');
    const W=K.width;
    const show=function(best){
      const c=K.candles[best];
      if(!c)return;
      const cxPos=c.x+c.w/2;
      const closeY=c.cls==='up'?c.bodyY:c.bodyY+c.bodyH;
      cross.style.display='';
      cx.setAttribute('x1',cxPos); cx.setAttribute('x2',cxPos);
      cy.setAttribute('y1',closeY); cy.setAttribute('y2',closeY);
      if(kp){ kp.setAttribute('cx',cxPos); kp.setAttribute('cy',closeY); kp.className.baseVal='p '+c.cls; }
      const suf=maSuffix(state.tab);
      const fmtMa=function(v){return v==null?'—':v.toFixed(2);};
      tip.style.display='block';
      tip.innerHTML=
        '<div class="row"><span>'+c.date+'</span></div>'+
        '<div class="row"><span>开</span><b>'+c.open.toFixed(2)+'</b></div>'+
        '<div class="row"><span>收</span><b class="'+c.cls+'">'+c.close.toFixed(2)+'</b></div>'+
        '<div class="row"><span>高</span><b>'+c.high.toFixed(2)+'</b></div>'+
        '<div class="row"><span>低</span><b>'+c.low.toFixed(2)+'</b></div>'+
        K.maValues.map(function(mv){
          if(state.maHide[String(mv.n)])return '';
          return '<div class="row"><span>MA'+mv.n+suf+'</span><b>'+fmtMa(mv.vals[best])+'</b></div>';
        }).join('')+
        (state.maHide.vol?'':'<div class="row"><span>均量5</span><b>'+(K.volMaVals[best]==null?'—':fmtVol(K.volMaVals[best]))+'</b></div>')+
        '<div class="row"><span>量</span><b>'+fmtVol(c.volume)+'</b></div>';
      const frac=cxPos/W;
      const rw=svg.parentNode.getBoundingClientRect();
      const tw=tip.offsetWidth;
      const lx=frac*rw.width;
      const tx=frac<0.5?lx+10:lx-tw-10;
      tip.style.left=Math.min(Math.max(0,tx),rw.width-tw-4)+'px';
      tip.style.top='6px';
    };
    let r=svg.getBoundingClientRect();
    let last=-1,raf=0;
    svg.addEventListener('mouseenter',()=>{ r=svg.getBoundingClientRect(); });
    svg.addEventListener('mousemove',e=>{
      const sx=(e.clientX-r.left)/r.width*W;
      let lo=0,hi=K.candles.length-1;
      while(lo<hi){
        const mid=(lo+hi)>>1;
        const ccx=K.candles[mid].x+K.candles[mid].w/2;
        if(ccx<sx)lo=mid+1;else hi=mid;
      }
      let best=lo;
      if(lo>0){
        const d=sx-(K.candles[lo-1].x+K.candles[lo-1].w/2);
        if(d<Math.abs(K.candles[lo].x+K.candles[lo].w/2-sx))best=lo-1;
      }
      if(best===last)return;
      last=best;
      cancelAnimationFrame(raf);
      raf=requestAnimationFrame(()=>show(best));
    });
    svg.addEventListener('mouseleave',()=>{ last=-1; cross.style.display='none'; tip.style.display='none'; });
    const lg=document.querySelector('.malegend');
    if(lg)lg.addEventListener('click',e=>{
      const s=e.target instanceof Element?e.target.closest('[data-k]'):null;
      if(!s)return;
      const k=s.dataset.k;
      state.maHide[k]=!state.maHide[k];
      s.classList.toggle('off',state.maHide[k]);
      const ln=document.getElementById('maline-'+k);
      if(ln)ln.style.display=state.maHide[k]?'none':'';
    });
  }
})();
</script>
</body>
</html>`;
  }
}
