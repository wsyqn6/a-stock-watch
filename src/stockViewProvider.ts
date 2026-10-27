import * as vscode from 'vscode';
import {
  StockQuote,
  fetchMarketBreadth,
  getMinuteCached,
  MinuteGap,
  SparkData,
  MarketBreadth,
  MARKET_INDEX_OPTIONS,
  MarketIndexSymbol,
  isPreOpen,
  isTradingDay,
} from './dataSource';
import { IntradayBook, IntradaySnapshot } from './intraday';
import { Store } from './store';
import { RefreshManager } from './refreshManager';
import { normalizeSortMode, orderQuotes, SortMode } from './order';
import { MinuteDetailPanel } from './minuteDetailPanel';
import { fmtPrice } from './util';
import { renderSidebarHtml } from './webviewHtml';
import { fetchQuotesCached } from './quoteCache';
import { config, configWriteTarget } from './config';
import {
  buildHoldingView,
  buildSummaryView,
  computeHolding,
  Holding,
  HoldingStat,
  HoldingView,
  parseHoldings,
} from './holdings';
import {
  fetchNewStockApplies,
  fetchNewBondApplies,
  groupByDay,
  IpoDay,
  boardOf,
} from './ipo';

export interface QuoteViewItem {
  sym: string;
  name: string;
  code: string;
  board: string;
  price: string;
  changePct: string;
  cls: 'up' | 'down' | 'flat';
  spark: SparkData | null;
  /** 分时数据缺口：ok 时仅画迷你图，其余在迷你图区显示提示文字 */
  gap: MinuteGap;
  /** 持仓行：第一行改显当日盈亏，第二行补现价与涨幅；无持仓时不存在 */
  pnl?: HoldingView;
  /** 是否已录入持仓：右键菜单据此切换「设置 / 修改」文案 */
  held: boolean;
  inBar: boolean;
  pinned: boolean;
}

export interface IndexViewItem {
  sym: string;
  short: string;
  price: string;
  changePct: string;
  cls: 'up' | 'down' | 'flat';
  spark: SparkData | null;
  gap: MinuteGap;
}

export interface MarketPayload {
  show: boolean;
  indices: IndexViewItem[];
  breadth: MarketBreadth | null;
}

/** 指数在概览条的短名（侧边栏空间有限）。 */
const INDEX_SHORT_NAMES: Record<string, string> = {
  sh000001: '上证',
  sz399001: '深证',
  sz399006: '创业板',
};

const MINUTE_INTERVAL_MS = 60_000;
const BREADTH_INTERVAL_MS = 15_000;
/** 排序方式持久化键。 */
const SORT_MODE_KEY = 'sortMode';
/** 日内快照持久化键。 */
const INTRADAY_KEY = 'intraday.v1';
/** 快照写入节流：行情每 3 秒刷新，没必要每次都写 Memento。 */
const INTRADAY_SAVE_MS = 60_000;

export class StockViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'aStockWatch';
  private view?: vscode.WebviewView;
  private manager?: RefreshManager;
  private minuteTimer: NodeJS.Timeout | null = null;
  private refreshingMinute = false;
  private quotes: StockQuote[] = [];
  private indexQuotes: StockQuote[] = [];
  private breadth: MarketBreadth | null = null;
  private lastBreadthAt = 0;
  private readonly intraday = new IntradayBook();
  private intradayDirty = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private error: string | null = null;
  private warn: string | null = null;
  private sortMode: SortMode = 'manual';
  private editMode = false;
  private bossMode = false;
  private ipoDays: IpoDay[] = [];
  private ipoError: string | null = null;
  private refreshingIpo = false;

  constructor(
    private readonly store: Store,
    private readonly onStatusBarChanged?: () => void,
    private readonly state?: vscode.Memento,
  ) {
    this.sortMode = normalizeSortMode(this.state?.get(SORT_MODE_KEY));
    // 先恢复上次会话的日内序列，首次 push 即可出图，不必等分时接口
    this.intraday.restore(this.state?.get<IntradaySnapshot>(INTRADAY_KEY));
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = renderSidebarHtml();
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (!msg || typeof msg !== 'object') {
        return;
      }
      const type = (msg as { type: string }).type;
      if (type === 'ready') {
        this.push();
        this.pushEditMode();
        void this.refreshMinute();
        void this.refreshIpo();
      } else if (type === 'ipoRefresh') {
        void this.refreshIpo();
      } else if (type === 'remove') {
        const symbol = (msg as { symbol?: unknown }).symbol;
        if (typeof symbol === 'string' && this.store.remove(symbol)) {
          this.notifyChanged();
        }
      } else if (type === 'toggleStatusBar') {
        const symbol = (msg as { symbol?: unknown }).symbol;
        if (typeof symbol === 'string' && this.store.statusBarHas(symbol)) {
          this.store.statusBarToggle(symbol);
          this.push();
          this.onStatusBarChanged?.();
        } else if (typeof symbol === 'string' && this.store.statusBarToggle(symbol)) {
          this.push();
          this.onStatusBarChanged?.();
        } else if (typeof symbol === 'string' && this.store.getStatusBar().length >= Store.STATUS_BAR_MAX) {
          void vscode.window.showInformationMessage(`状态栏最多显示 ${Store.STATUS_BAR_MAX} 只股票`);
        }
      } else if (type === 'togglePin') {
        const symbol = (msg as { symbol?: unknown }).symbol;
        if (typeof symbol === 'string' && this.store.togglePin(symbol)) {
          this.push();
        }
      } else if (type === 'copy') {
        const code = (msg as { code?: unknown }).code;
        if (typeof code === 'string') {
          void vscode.env.clipboard.writeText(code);
        }
      } else if (type === 'editHolding') {
        const symbol = (msg as { symbol?: unknown }).symbol;
        if (typeof symbol === 'string') {
          void this.editHolding(symbol);
        }
      } else if (type === 'reorder') {
        const symbols = (msg as { symbols?: unknown }).symbols;
        if (Array.isArray(symbols)) {
          this.store.reorder(symbols.filter((s): s is string => typeof s === 'string'));
          this.notifyChanged();
        }
      } else if (type === 'openDetail') {
        const symbol = (msg as { symbol?: unknown }).symbol;
        if (typeof symbol === 'string') {
          const quote =
            this.quotes.find((q) => q.symbol === symbol) ??
            this.indexQuotes.find((q) => q.symbol === symbol);
          MinuteDetailPanel.open(symbol, quote);
        }
      }
    });
    this.manager?.dispose();
    this.manager = new RefreshManager(this, webviewView);
    this.manager.start();
    // 首次解析不会触发 onDidChangeVisibility，这里显式起表，
    // 保证收盘后仍能补拉最后一分钟（行情轮询在非交易时段是停的）。
    this.startMinuteTimer();
    webviewView.onDidChangeVisibility(() => this.onVisibility());
  }

  private onVisibility(): void {
    this.manager?.handleVisibility();
    if (this.view?.visible) {
      this.startMinuteTimer();
      void this.refreshMinute();
      void this.refreshIpo();
    } else {
      this.stopMinuteTimer();
      this.flushIntraday();
    }
  }

  private startMinuteTimer(): void {
    this.stopMinuteTimer();
    this.minuteTimer = setInterval(() => void this.refreshMinute(), MINUTE_INTERVAL_MS);
  }

  private stopMinuteTimer(): void {
    if (this.minuteTimer) {
      clearInterval(this.minuteTimer);
      this.minuteTimer = null;
    }
  }

  /** 标记日内序列已变化，节流写入持久化快照。 */
  private scheduleIntradaySave(): void {
    if (!this.state) {
      return;
    }
    this.intradayDirty = true;
    if (this.saveTimer) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushIntraday();
    }, INTRADAY_SAVE_MS);
  }

  /** 立即落盘；隐藏面板或停用时调用，避免丢掉最后一次变化。 */
  private flushIntraday(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.intradayDirty || !this.state) {
      return;
    }
    this.intradayDirty = false;
    void this.state.update(INTRADAY_KEY, this.intraday.snapshot());
  }

  private async refreshMinute(): Promise<void> {
    if (!this.view?.visible || this.refreshingMinute) {
      return;
    }
    const symbols = this.minuteSymbols();
    if (symbols.length === 0) {
      return;
    }
    // 盘前/非交易日没有当日分时可补，避免白拉行情
    if (!isTradingDay() || isPreOpen()) {
      return;
    }
    this.refreshingMinute = true;
    try {
      const quoteMap = new Map(
        [...this.quotes, ...this.indexQuotes].map((q) => [q.symbol, q] as const),
      );
      const missing = symbols.filter((s) => !quoteMap.has(s));
      if (missing.length > 0) {
        try {
          for (const q of await fetchQuotesCached(missing)) {
            quoteMap.set(q.symbol, q);
          }
        } catch {
          // 拿不到行情的标的无法判定缺口，等下一轮
        }
      }
      const need = symbols.filter((s) => {
        const q = quoteMap.get(s);
        return q !== undefined && this.intraday.needsSeed(s, q);
      });
      if (need.length === 0) {
        return;
      }
      let dirty = false;
      await Promise.all(
        need.map(async (sym) => {
          const q = quoteMap.get(sym);
          if (!q) {
            return;
          }
          try {
            // 只有判定需要补种子才强制走网络，避免 60s 缓存把缺口继续拖住
            const { data } = await getMinuteCached(sym, 0);
            if (this.intraday.applySeed(sym, data, q)) {
              dirty = true;
            }
          } catch {
            // 拉取失败保留本地序列，下一轮再试
          }
        }),
      );
      if (dirty) {
        this.scheduleIntradaySave();
        this.push();
      }
    } finally {
      this.refreshingMinute = false;
    }
  }

  setSortMode(mode: SortMode): void {
    const next = normalizeSortMode(mode);
    if (next === this.sortMode) {
      return;
    }
    this.sortMode = next;
    void this.state?.update(SORT_MODE_KEY, next);
    this.push();
  }

  setEditMode(v: boolean): void {
    this.editMode = v;
    this.pushEditMode();
  }

  setBossMode(v: boolean): void {
    this.bossMode = v;
    this.push();
  }

  toggleEditMode(): boolean {
    this.setEditMode(!this.editMode);
    return this.editMode;
  }

  private pushEditMode(): void {
    void this.view?.webview.postMessage({ type: 'editMode', value: this.editMode });
  }

  notifyChanged(): void {
    void this.manager?.refresh();
    void this.refreshMinute();
  }

  /** 持仓改动只影响展示：重算行内与汇总即可，不必重新拉行情。 */
  refreshHoldings(): void {
    this.push();
  }

  /** 两步录入持仓：股数 → 成本价；股数留空或 0 即取消该标的持仓。 */
  private async editHolding(symbol: string): Promise<void> {
    const list = parseHoldings(config.holdings());
    const current = list.find((h) => h.symbol === symbol);
    const name = this.quotes.find((q) => q.symbol === symbol)?.name ?? symbol;
    const sharesInput = await vscode.window.showInputBox({
      title: `设置持仓 · ${name}`,
      prompt: '持有数量（股/份/张），留空或 0 表示取消持仓',
      value: current ? String(current.shares) : '',
      validateInput: (v) => {
        const text = v.trim();
        if (text === '') {
          return undefined;
        }
        const n = Number(text);
        return Number.isInteger(n) && n >= 0 ? undefined : '请输入非负整数（留空取消持仓）';
      },
    });
    if (sharesInput === undefined) {
      return;
    }
    const sharesText = sharesInput.trim();
    const shares = Number(sharesText);
    if (sharesText === '' || shares === 0) {
      await this.writeHoldings(list.filter((h) => h.symbol !== symbol));
      return;
    }
    const costInput = await vscode.window.showInputBox({
      title: `设置持仓 · ${name}`,
      prompt: '摊薄成本价（元），手续费与分红请折算进成本',
      value: current ? String(current.cost) : '',
      validateInput: (v) => {
        const n = Number(v.trim());
        return Number.isFinite(n) && n > 0 ? undefined : '请输入大于 0 的成本价';
      },
    });
    if (costInput === undefined) {
      return;
    }
    const cost = Number(costInput.trim());
    const next = [...list.filter((h) => h.symbol !== symbol), { symbol, shares, cost }];
    await this.writeHoldings(next);
  }

  private async writeHoldings(next: Holding[]): Promise<void> {
    try {
      await vscode.workspace
        .getConfiguration('aStockWatch')
        .update('holdings', next, configWriteTarget('holdings'));
    } catch (err) {
      void vscode.window.showErrorMessage(
        `保存持仓失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    // 配置变更事件也会触发刷新；这里先推一次，输入完成后界面不必等事件回环
    this.push();
  }

  getSymbols(): string[] {
    return this.store.getAll();
  }

  /** 概览条展示的指数符号（配置可选，默认上证）。 */
  private getMarketIndexSymbol(): MarketIndexSymbol {
    const cfg = config.marketIndex();
    return (MARKET_INDEX_OPTIONS as readonly string[]).includes(cfg)
      ? (cfg as MarketIndexSymbol)
      : 'sh000001';
  }

  /** 需要刷新迷你分时的符号：自选股 + 概览指数（showMarketBar 开启时）。 */
  private minuteSymbols(): string[] {
    const symbols = [...this.store.getAll()];
    if (config.showMarketBar()) {
      const idx = this.getMarketIndexSymbol();
      if (!symbols.includes(idx)) {
        symbols.push(idx);
      }
    }
    return symbols;
  }

  refreshNow(): Promise<void> {
    return this.manager?.refresh() ?? Promise.resolve();
  }

  dispose(): void {
    this.stopMinuteTimer();
    this.flushIntraday();
    this.manager?.dispose();
  }

  async refresh(symbols: string[]): Promise<void> {
    // 概览指数并入同一批量请求，守"全部标的单次 HTTP"原则；自选股为空也保留指数概览。
    // showMarketBar 关闭时不再合并指数、不请求涨跌家数。
    const showMarket = config.showMarketBar();
    const idxSym = showMarket ? this.getMarketIndexSymbol() : null;
    const wanted = new Set(symbols);
    const fetchList = [
      ...new Set(idxSym ? [idxSym, ...symbols] : symbols),
    ] as string[];
    // 已移出自选/概览的标的不再保留日内状态（重新加回时会自动重取）
    this.intraday.prune(fetchList);
    try {
      const all = await fetchQuotesCached(fetchList);
      this.quotes = wanted.size > 0 ? all.filter((q) => wanted.has(q.symbol)) : [];
      this.indexQuotes = idxSym ? all.filter((q) => q.symbol === idxSym) : [];
      this.error =
        wanted.size > 0 && this.quotes.length === 0
          ? `未获取到行情：${symbols.join('、')}`
          : null;
    } catch (err) {
      this.quotes = [];
      this.error =
        wanted.size > 0
          ? err instanceof Error
            ? `行情错误: ${err.message}`
            : '行情错误'
          : null;
    }
    if (!showMarket) {
      this.breadth = null;
    }
    if (wanted.size === 0) {
      this.warn = null;
    } else if (this.error === null && this.quotes.length > 0) {
      const got = new Set(this.quotes.map((q) => q.symbol));
      const missing = symbols.filter((s) => !got.has(s));
      this.warn = missing.length > 0 ? `未获取到行情：${missing.join(', ')}` : null;
    }
    if (showMarket) {
      void this.refreshBreadth();
    }
    if (this.intraday.recordQuotes([...this.quotes, ...this.indexQuotes])) {
      this.scheduleIntradaySave();
    }
    this.push();
  }

  /** 拉取沪深全 A 涨跌家数；失败静默降级（概览条仅不显示进度条，不影响行情）。60s 节流：家数变化慢，无需随行情 3s 一拉。 */
  private async refreshBreadth(): Promise<void> {
    const now = Date.now();
    if (now - this.lastBreadthAt < BREADTH_INTERVAL_MS) {
      return;
    }
    this.lastBreadthAt = now;
    try {
      const b = await fetchMarketBreadth();
      if (
        !this.breadth ||
        this.breadth.up !== b.up ||
        this.breadth.down !== b.down ||
        this.breadth.flat !== b.flat
      ) {
        this.breadth = b;
        this.push();
      }
    } catch {
      if (this.breadth !== null) {
        this.breadth = null;
        this.push();
      }
    }
  }

  /** 拉取未来 3 个交易日新股/新债申购；失败显示错误。与行情独立刷新。showIpo 关闭时清空并隐藏，不请求。 */
  async refreshIpo(): Promise<void> {
    const showIpo = config.showIpo();
    if (!showIpo) {
      if (this.ipoDays.length > 0 || this.ipoError !== null) {
        this.ipoDays = [];
        this.ipoError = null;
      }
      this.pushIpo();
      return;
    }
    if (this.refreshingIpo) {
      return;
    }
    this.refreshingIpo = true;
    try {
      const [stocks, bonds] = await Promise.all([
        fetchNewStockApplies(),
        fetchNewBondApplies(),
      ]);
      this.ipoDays = groupByDay(stocks, bonds);
      this.ipoError = null;
    } catch (err) {
      this.ipoError = err instanceof Error ? `打新数据错误: ${err.message}` : '打新数据错误';
    } finally {
      this.refreshingIpo = false;
    }
    this.pushIpo();
  }

  private pushIpo(): void {
    if (!this.view || !this.view.visible) {
      return;
    }
    const show = config.showIpo();
    void this.view.webview.postMessage({
      type: 'ipo',
      show,
      days: this.ipoDays,
      error: this.ipoError,
    });
  }

  private ordered(): StockQuote[] {
    return orderQuotes(this.quotes, this.sortMode, new Set(this.store.getPinned()));
  }

  private push(): void {
    if (!this.view || !this.view.visible) {
      return;
    }
    const pinned = new Set(this.store.getPinned());
    // 持仓只在展示层参与计算：行情仍按自选批量拉取，持仓不额外产生请求
    const holdings = new Map(
      parseHoldings(config.holdings()).map((h) => [h.symbol, h] as const),
    );
    const stats: HoldingStat[] = [];
    const items = this.ordered().map((q) => {
      const holding = holdings.get(q.symbol);
      const stat = holding ? computeHolding(holding, q) : null;
      if (stat) {
        stats.push(stat);
      }
      return toViewItem(
        q,
        this.intraday.spark(q.symbol, q),
        this.intraday.gap(q.symbol, q),
        this.store.statusBarHas(q.symbol),
        pinned.has(q.symbol),
        holding,
      );
    });
    const showMarket = config.showMarketBar();
    const market: MarketPayload = {
      show: showMarket,
      indices: this.indexQuotes.map((q) =>
        toIndexViewItem(
          q,
          this.intraday.spark(q.symbol, q),
          this.intraday.gap(q.symbol, q),
        ),
      ),
      breadth: this.breadth,
    };
    void this.view.webview.postMessage({
      type: 'quotes',
      items,
      error: this.error,
      warn: this.warn,
      boss: this.bossMode,
      market,
      sum: buildSummaryView(stats),
    });
  }
}

function toViewItem(
  q: StockQuote,
  spark: SparkData | null,
  gap: MinuteGap,
  inBar: boolean,
  pinned: boolean,
  holding?: Holding,
): QuoteViewItem {
  const cls: QuoteViewItem['cls'] = q.changePct > 0 ? 'up' : q.changePct < 0 ? 'down' : 'flat';
  const code = q.symbol.slice(2);
  return {
    sym: q.symbol,
    name: q.name,
    code,
    board: boardOf(code),
    price: fmtPrice(q.price, code, q.price),
    changePct: `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`,
    cls,
    spark,
    gap,
    pnl: holding ? buildHoldingView(holding, q) : undefined,
    held: holding !== undefined,
    inBar,
    pinned,
  };
}

function toIndexViewItem(q: StockQuote, spark: SparkData | null, gap: MinuteGap): IndexViewItem {
  const cls: IndexViewItem['cls'] = q.changePct > 0 ? 'up' : q.changePct < 0 ? 'down' : 'flat';
  return {
    sym: q.symbol,
    short: INDEX_SHORT_NAMES[q.symbol] ?? q.name,
    price: fmtPrice(q.price, q.symbol, q.price),
    changePct: `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`,
    cls,
    spark,
    gap,
  };
}
