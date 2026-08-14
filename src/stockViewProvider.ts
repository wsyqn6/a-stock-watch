import * as vscode from 'vscode';
import {
  StockQuote,
  fetchQuotes,
  fetchMarketBreadth,
  getMinuteCached,
  buildSpark,
  SparkData,
  isTradingTime,
  MarketBreadth,
  MARKET_INDEX_OPTIONS,
  MarketIndexSymbol,
} from './dataSource';
import { Store } from './store';
import { RefreshManager } from './refreshManager';
import { orderQuotes, SortMode } from './order';
import { MinuteDetailPanel } from './minuteDetailPanel';
import { getNonce } from './util';
import {
  fetchNewStockApplies,
  fetchNewBondApplies,
  groupByDay,
  IpoDay,
  pad,
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
const BREADTH_INTERVAL_MS = 60_000;

const WEBVIEW_CSS = `
:root{--up:#E15241;--down:#2EA46E}
@media (prefers-color-scheme: light){:root{--up:#C73E2E;--down:#2F8F5B}}
body.boss{filter:grayscale(1)}
*{box-sizing:border-box;margin:0;padding:0}
svg[aria-hidden="true"]{position:absolute;pointer-events:none}
body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);margin:0;padding:0 4px 8px;display:flex;flex-direction:column;height:100vh}
.row{display:flex;align-items:center;padding:6px;border-bottom:1px solid var(--vscode-panel-border);transition:background .12s ease}
.row:hover{background:var(--vscode-list-hoverBackground)}
.row.drag{opacity:.4}
.row.drop{border-top:2px solid var(--vscode-focusBorder)}
.handle{cursor:grab;flex:0 0 auto;margin-right:4px;color:var(--vscode-descriptionForeground);font-size:12px;user-select:none}
.handle:active{cursor:grabbing}
.left{flex:0 0 90px;width:90px;max-width:90px;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:1px}
.right{flex:0 0 auto;display:flex;flex-direction:column;justify-content:center;gap:1px;align-items:flex-end;text-align:right}
.name{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.codeline{display:flex;align-items:center;gap:4px;min-width:0}
.code{font-size:10px;color:var(--vscode-descriptionForeground);opacity:.8}
.board{flex:0 0 auto;font-size:9px;line-height:1.6;color:var(--vscode-descriptionForeground);white-space:nowrap}
.price{font-size:12px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1.15}
.pct{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.15}
.spark{flex:1;min-width:0;height:30px;display:block;margin:0 8px;transition:opacity .12s ease}
.row:hover .spark polyline:not(.glow){stroke-width:1.6}
@media (prefers-reduced-motion:reduce){.row,.spark{transition:none}}
.spark polyline{fill:none;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.spark path.area{fill:none;opacity:.8}
.spark.up path.area{fill:url(#gUp)}
.spark.down path.area{fill:url(#gDown)}
.row:hover .spark path.area{opacity:1}
.spark line.base{stroke:var(--vscode-descriptionForeground);stroke-width:1;stroke-dasharray:3 2;opacity:.45;vector-effect:non-scaling-stroke}
.spark.up polyline{stroke:var(--up)}
.spark.down polyline{stroke:var(--down)}
.spark.flat polyline{stroke:var(--vscode-descriptionForeground)}
.del{flex:0 0 auto;max-width:0;overflow:hidden;color:var(--vscode-descriptionForeground);opacity:0;cursor:pointer;background:none;border:none;font-size:13px;padding:0;transition:max-width .15s ease,opacity .15s ease}
body.editing .del{max-width:20px;margin-left:6px;padding:0 2px;opacity:.9}
.del:hover{color:var(--vscode-errorForeground)}
.pin{flex:0 0 auto;max-width:0;overflow:hidden;color:var(--vscode-descriptionForeground);opacity:0;cursor:pointer;background:none;border:none;padding:0;line-height:0;transition:max-width .15s ease,opacity .15s ease}
body.editing .pin{max-width:20px;margin-left:6px;padding:0 2px;opacity:.9}
.pin svg{vertical-align:middle;display:block}
.pin.on{color:#d4a017}
.pin:hover{color:var(--vscode-textLink-foreground)}
.top{flex:0 0 auto;max-width:0;overflow:hidden;color:var(--vscode-descriptionForeground);opacity:0;cursor:pointer;background:none;border:none;padding:0;line-height:0;transition:max-width .15s ease,opacity .15s ease}
body.editing .top{max-width:20px;margin-left:6px;padding:0 2px;opacity:.9}
.top svg{vertical-align:middle;display:block}
.top.on{color:#d4a017}
.top:hover{color:var(--vscode-textLink-foreground)}
.ctxmenu{position:fixed;z-index:1000;min-width:150px;background:var(--vscode-menu-background);color:var(--vscode-menu-foreground);border:1px solid var(--vscode-menu-border);border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,.3);padding:4px 0;font-size:12px}
.ctxmenu .item{padding:5px 14px;cursor:pointer;user-select:none}
.ctxmenu .item:hover{background:var(--vscode-menu-selectionBackground);color:var(--vscode-menu-selectionForeground)}
.ctxmenu .item.danger:hover{color:var(--vscode-errorForeground)}
.ctxmenu .sep{height:1px;background:var(--vscode-menu-separatorBackground);margin:4px 8px}
.up{color:var(--up)}
.down{color:var(--down)}
.flat{color:var(--vscode-descriptionForeground)}
.msg{padding:12px;color:var(--vscode-descriptionForeground);text-align:center}
.warn{padding:6px 12px;color:var(--vscode-editorWarning-foreground);font-size:12px;line-height:1.4;word-break:break-all}
.ipo{margin-top:auto;flex:0 0 auto}
.ipofold{display:flex;align-items:center;gap:4px;padding:3px 8px;cursor:pointer;user-select:none}
.ipofold:hover{background:var(--vscode-list-hoverBackground)}
.ipofold-chevron{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:14px;height:16px;font-size:11px;color:var(--vscode-descriptionForeground);transition:transform .15s ease}
.ipo.collapsed .ipofold-chevron{transform:rotate(-90deg)}
.ipofold-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--vscode-foreground)}
.ipofold-count{font-size:11px;font-weight:400;color:var(--vscode-descriptionForeground)}
.ipofold-count:empty{display:none}
.ipofold-refresh{flex:0 0 auto;width:18px;height:18px;margin-left:auto;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;color:var(--vscode-descriptionForeground);border-radius:4px;opacity:0;transition:opacity .12s ease,color .12s ease,background .12s ease}
.ipofold:hover .ipofold-refresh{opacity:.9}
.ipofold-refresh:hover{opacity:1;color:var(--vscode-foreground);background:var(--vscode-list-hoverBackground)}
.ipofold-refresh svg{vertical-align:middle;display:block}
.ipo-body{overflow:hidden}
.ipo.collapsed .ipo-body{display:none}
.ipo-body .day{background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-widget-border);border-radius:6px;margin:6px 4px;overflow:hidden}
.ipo-body .dayhead{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:11px;font-weight:600;letter-spacing:.06em;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-panel-border)}
.ipo-body .dayhead.today{color:var(--vscode-textLink-foreground)}
.ipo-body .dayhead .cnt{font-weight:400;letter-spacing:0;opacity:.7;margin-left:auto}
.ipo-body .sechead{display:flex;align-items:baseline;gap:6px;padding:5px 10px 2px;font-size:10px;font-weight:600;letter-spacing:.12em;color:var(--vscode-descriptionForeground);text-transform:uppercase;opacity:.85}
.ipo-body .row{display:flex;align-items:center;padding:6px 10px;border-bottom:0}
.ipo-body .left{flex:1;min-width:0;width:auto;max-width:none;display:flex;flex-direction:column;justify-content:center;gap:1px}
.ipo-body .date{font-size:11px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1.15}
.ipo-body .price{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.15}
.ipo-body .tag{font-size:10px;color:var(--vscode-descriptionForeground);line-height:1.15;white-space:nowrap}
.ipo-body .empty{padding:8px 10px 10px;color:var(--vscode-descriptionForeground);font-size:12px}
.ipo-body .empty.today{color:var(--vscode-editorWarning-foreground)}
.ipo-body .foot{text-align:right;padding:6px 8px 0;font-size:10px;color:var(--vscode-descriptionForeground)}
#app{flex:0 0 auto}
.market{background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-widget-border);border-radius:6px;padding:6px 8px 4px;margin:4px 4px 8px;user-select:none;flex:0 0 auto}
.mhead{display:flex;align-items:center;gap:6px;padding:0 0 2px;font-size:10px;font-weight:600;letter-spacing:.12em;color:var(--vscode-descriptionForeground);text-transform:uppercase}
.lhead{display:flex;align-items:baseline;gap:6px;margin:8px 12px 4px;padding:0;font-size:10px;font-weight:600;letter-spacing:.12em;color:var(--vscode-descriptionForeground);text-transform:uppercase;border-bottom:1px solid var(--vscode-panel-border)}
.lhead .cnt{font-weight:400;letter-spacing:0;opacity:.7}
.mind{display:block}
.midx{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:4px;cursor:pointer}
.midx:hover{background:var(--vscode-list-hoverBackground)}
.midx .iname{flex:0 0 48px;font-size:11px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.midx .spark{flex:1;min-width:0;height:30px;display:block;margin:0 8px}
.midx .right{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:1px}
.midx .ipct{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.15;white-space:nowrap}
.midx .iprice{font-size:11px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1.15;white-space:nowrap;opacity:.72}
.gauge{height:3px;margin:8px 6px 0;border-radius:2px;display:flex;overflow:hidden;background:var(--vscode-editor-background);box-shadow:inset 0 0 0 1px var(--vscode-panel-border)}
.gauge .seg.up{background:var(--up)}
.gauge .seg.down{background:var(--down)}
.gauge .seg.flat{background:var(--vscode-descriptionForeground)}
.gnums{display:flex;align-items:baseline;justify-content:space-between;padding:5px 8px 2px;font-size:10px;font-variant-numeric:tabular-nums;line-height:1;color:var(--vscode-descriptionForeground)}
.gnums .u{color:var(--up)}
.gnums .d{color:var(--down)}
`;

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
  private sparks = new Map<string, SparkData | null>();
  private error: string | null = null;
  private warn: string | null = null;
  private sortMode: SortMode = 'manual';
  private editMode = false;
  private bossMode = false;
  private ipoDays: IpoDay[] = [];
  private ipoError: string | null = null;
  private ipoUpdatedAt = '';
  private refreshingIpo = false;

  constructor(
    private readonly store: Store,
    private readonly onStatusBarChanged?: () => void,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.html();
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
      } else if (type === 'reorder') {
        const symbols = (msg as { symbols?: unknown }).symbols;
        if (Array.isArray(symbols)) {
          this.store.reorder(symbols.filter((s): s is string => typeof s === 'string'));
          this.notifyChanged();
        }
      } else if (type === 'sortMode') {
        this.sortMode = (msg as { mode?: unknown }).mode as SortMode;
        this.push();
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

  private async refreshMinute(): Promise<void> {
    if (!this.view?.visible || this.refreshingMinute) {
      return;
    }
    const symbols = this.minuteSymbols();
    if (symbols.length === 0) {
      return;
    }
    if (!isTradingTime() && symbols.every((s) => this.sparks.has(s))) {
      return;
    }
    this.refreshingMinute = true;
    try {
      const pcMap = new Map(
        [...this.quotes, ...this.indexQuotes].map((q) => [q.symbol, q.prevClose]),
      );
      if (symbols.some((s) => !pcMap.has(s))) {
        try {
          for (const q of await fetchQuotes(symbols)) {
            pcMap.set(q.symbol, q.prevClose);
          }
        } catch {
          // keep whatever prevClose we already have
        }
      }
      let dirty = false;
      await Promise.all(
        symbols.map(async (sym) => {
          try {
            const { data, fresh } = await getMinuteCached(sym);
            const pc = pcMap.get(sym);
            const spark = pc !== undefined ? buildSpark(data, pc) : null;
            if (fresh) {
              this.sparks.set(sym, spark);
              dirty = true;
            } else if (!this.sparks.has(sym)) {
              this.sparks.set(sym, spark);
              dirty = true;
            }
          } catch {
            this.sparks.set(sym, null);
            dirty = true;
          }
        }),
      );
      if (dirty) {
        this.push();
      }
    } finally {
      this.refreshingMinute = false;
    }
  }

  setSortMode(mode: SortMode): void {
    this.sortMode = mode;
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
  }

  getSymbols(): string[] {
    return this.store.getAll();
  }

  /** 概览条展示的指数符号（配置可选，默认上证）。 */
  private getMarketIndexSymbol(): MarketIndexSymbol {
    const cfg = vscode.workspace
      .getConfiguration('aStockWatch')
      .get<string>('marketIndex', 'sh000001');
    return (MARKET_INDEX_OPTIONS as readonly string[]).includes(cfg)
      ? (cfg as MarketIndexSymbol)
      : 'sh000001';
  }

  /** 需要刷新迷你分时的符号：自选股 + 概览指数（showMarketBar 开启时）。 */
  private minuteSymbols(): string[] {
    const symbols = [...this.store.getAll()];
    if (
      vscode.workspace
        .getConfiguration('aStockWatch')
        .get<boolean>('showMarketBar', true)
    ) {
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
    this.manager?.dispose();
  }

  async refresh(symbols: string[]): Promise<void> {
    // 概览指数并入同一批量请求，守"全部标的单次 HTTP"原则；自选股为空也保留指数概览。
    // showMarketBar 关闭时不再合并指数、不请求涨跌家数。
    const showMarket = vscode.workspace
      .getConfiguration('aStockWatch')
      .get<boolean>('showMarketBar', true);
    const idxSym = showMarket ? this.getMarketIndexSymbol() : null;
    const wanted = new Set(symbols);
    const fetchList = [
      ...new Set(idxSym ? [idxSym, ...symbols] : symbols),
    ] as string[];
    try {
      const all = await fetchQuotes(fetchList);
      this.quotes = wanted.size > 0 ? all.filter((q) => wanted.has(q.symbol)) : [];
      this.indexQuotes = idxSym ? all.filter((q) => q.symbol === idxSym) : [];
      this.error =
        wanted.size > 0 && this.quotes.length === 0 ? '未获取到行情数据' : null;
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
    this.push();
    void this.refreshMinute();
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

  /** 拉取未来 3 个交易日新股/新债申购；失败显示错误。与行情独立刷新。 */
  async refreshIpo(): Promise<void> {
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
      const now = new Date();
      this.ipoUpdatedAt = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
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
    void this.view.webview.postMessage({
      type: 'ipo',
      days: this.ipoDays,
      error: this.ipoError,
      updatedAt: this.ipoUpdatedAt,
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
    const items = this.ordered().map((q) =>
      toViewItem(q, this.sparks.get(q.symbol) ?? null, this.store.statusBarHas(q.symbol), pinned.has(q.symbol)),
    );
    const showMarket = vscode.workspace
      .getConfiguration('aStockWatch')
      .get<boolean>('showMarketBar', true);
    const market: MarketPayload = {
      show: showMarket,
      indices: this.indexQuotes.map((q) =>
        toIndexViewItem(q, this.sparks.get(q.symbol) ?? null),
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
    });
  }

  private html(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${WEBVIEW_CSS}</style>
</head>
<body>
<svg width="0" height="0" aria-hidden="true"><defs><linearGradient id="gUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--up);stop-opacity:0.5"/><stop offset="1" style="stop-color:var(--up);stop-opacity:0"/></linearGradient><linearGradient id="gDown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--down);stop-opacity:0.5"/><stop offset="1" style="stop-color:var(--down);stop-opacity:0"/></linearGradient></defs></svg>
<div id="market" class="market"></div>
<div id="app"><div class="msg">加载中…</div></div>
<div class="ipo collapsed" id="ipo">
<div class="ipofold" id="ipoFold" role="button" tabindex="0">
<span class="ipofold-chevron">▾</span>
<span class="ipofold-title">打新</span>
<span class="ipofold-count" id="ipoCount"></span>
<button class="ipofold-refresh" id="ipoRefreshBtn" title="刷新打新"></button>
</div>
<div class="ipo-body" id="ipoBody"><div class="msg">加载中…</div></div>
</div>
<script nonce="${nonce}">
(function(){
  const app=document.getElementById('app');
  const marketEl=document.getElementById('market');
  const api=acquireVsCodeApi();
  const PIN_SVG='<svg viewBox="0 0 16 16" width="13" height="13"><path d="M8 1a5 5 0 0 0-5 5c0 3.5 5 9 5 9s5-5.5 5-9a5 5 0 0 0-5-5z" fill="currentColor"></path><circle cx="8" cy="6" r="1.7" fill="var(--vscode-editor-background)"></circle></svg>';
  const TOP_SVG='<svg viewBox="0 0 16 16" width="13" height="13"><path d="M9.6 1.4l5 5-1 1-1.4-1.4-1.9 1.9.9 2.1-2.8 2.8-2.6-2.6L4 14l-2-2 3.8-2.8-2.6-2.6 2.8-2.8 2.1.9 1.9-1.9-1.4-1.4z" fill="currentColor"/></svg>';
  const REFRESH_SVG='<svg viewBox="0 0 16 16" width="12" height="12"><path d="M13.65 2.35A6.96 6.96 0 0 0 8.5 1a6.5 6.5 0 1 0 6.34 8.5h-1.7A5 5 0 1 1 8.5 3c1.4 0 2.68.55 3.62 1.47L9.5 7h5V2l-.85.85z" fill="currentColor"/></svg>';
  api.postMessage({type:'ready'});
  let editing=false;
  let cur=[];
  let lastMkSig='';
  function idxHtml(it){
    return '<div class="midx" data-ix="'+it.sym+'" title="查看 '+it.short+' 走势">'+
      '<span class="iname">'+it.short+'</span>'+
      '<svg class="spark flat" viewBox="0 0 100 18" preserveAspectRatio="none"></svg>'+
      '<span class="right"><span class="ipct"></span><span class="iprice"></span></span></div>';
  }
  function mkBarHtml(b){
    if(!b)return '';
    const t=b.up+b.down+b.flat;
    if(!t)return '';
    return '<div class="gauge"><div class="seg up"></div>'+
      (b.flat?'<div class="seg flat"></div>':'')+'<div class="seg down"></div></div>'+
      '<div class="gnums"><span class="u"></span>'+(b.flat?'<span class="f"></span>':'')+'<span class="d"></span></div>';
  }
  function setMkValues(m){
    const idxs=marketEl.querySelectorAll('.midx');
    m.indices.forEach((it,i)=>{
      const el=idxs[i];
      if(!el)return;
      const p=el.querySelector('.ipct');
      p.textContent=it.changePct;p.className='ipct '+it.cls;
      const r=el.querySelector('.iprice');
      r.textContent=it.price;
      const svg=el.querySelector('.spark');
      const s=it.spark;
      if(svg&&s&&s.line){
        if(svg.dataset.pts!==s.line){
          svg.dataset.pts=s.line;
          svg.innerHTML='<path class="area" d="'+s.area+'"></path><line class="base" x1="0" y1="'+s.baseY+'" x2="100" y2="'+s.baseY+'"></line><polyline points="'+s.line+'"></polyline>';
          svg.setAttribute('class','spark '+s.color);
        }
      } else if(svg&&(!s||!s.line)){
        if(svg.innerHTML!==''){svg.innerHTML='';svg.setAttribute('class','spark flat');}
      }
    });
    const b=m.breadth;
    if(!b)return;
    const t=b.up+b.down+b.flat;
    if(!t)return;
    const upW=(b.up/t*100).toFixed(1);
    const downW=(b.down/t*100).toFixed(1);
    const up=marketEl.querySelector('.gauge .seg.up');
    if(up)up.style.width=upW+'%';
    const down=marketEl.querySelector('.gauge .seg.down');
    if(down)down.style.width=downW+'%';
    const flat=marketEl.querySelector('.gauge .seg.flat');
    if(flat)flat.style.width=(100-upW-downW).toFixed(1)+'%';
    const u=marketEl.querySelector('.gnums .u');
    if(u)u.textContent='涨 '+b.up;
    const f=marketEl.querySelector('.gnums .f');
    if(f)f.textContent='平 '+b.flat;
    const d=marketEl.querySelector('.gnums .d');
    if(d)d.textContent='跌 '+b.down;
  }
  function renderMarket(m){
    if(!m||!m.show){if(marketEl.innerHTML){marketEl.innerHTML='';lastMkSig='';}return;}
    const sig=m.indices.map(i=>i.sym).join(',')+'|'+(m.breadth?'1':'0');
    if(sig!==lastMkSig){
      lastMkSig=sig;
      marketEl.innerHTML='<div class="mhead">大盘</div><div class="mind">'+m.indices.map(idxHtml).join('')+'</div>'+mkBarHtml(m.breadth);
      marketEl.querySelectorAll('.midx').forEach(el=>{
        el.addEventListener('click',()=>api.postMessage({type:'openDetail',symbol:el.dataset.ix}));
      });
    }
    setMkValues(m);
  }
  const ipoEl=document.getElementById('ipo');
  const ipoBody=document.getElementById('ipoBody');
  const ipoCount=document.getElementById('ipoCount');
  const ipoFold=document.getElementById('ipoFold');
  const ipoRefreshBtn=document.getElementById('ipoRefreshBtn');
  let ipoCollapsed=true;
  function setIpoCollapsed(c){
    ipoCollapsed=c;
    ipoEl.classList.toggle('collapsed',c);
  }
  ipoRefreshBtn.innerHTML=REFRESH_SVG;
  ipoRefreshBtn.addEventListener('click',(e)=>{
    e.stopPropagation();
    api.postMessage({type:'ipoRefresh'});
  });
  ipoFold.addEventListener('click',()=>setIpoCollapsed(!ipoCollapsed));
  ipoFold.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();setIpoCollapsed(!ipoCollapsed);}
  });
  function ipoRowHtml(it){
    const board=it.board?'<span class="board">'+it.board+'</span>':'';
    return '<div class="row"><div class="left"><span class="name">'+it.name+'</span><span class="codeline"><span class="code">'+it.code+'</span>'+board+'</span></div>'+
      '<div class="right"><span class="date">'+it.date+'</span><span class="price">'+it.price+'</span><span class="tag">'+it.tag+'</span></div></div>';
  }
  function ipoDayHtml(d){
    const isToday=d.label.indexOf('今日')===0;
    const n=(d.stocks?d.stocks.length:0)+(d.bonds?d.bonds.length:0);
    const head='<div class="dayhead'+(isToday?' today':'')+'">'+d.label+'<span class="cnt">'+n+' 项</span></div>';
    let body='';
    if(n===0){
      body='<div class="empty'+(isToday?' today':'')+'">'+(isToday?'今日无新股/新债申购':'该日无新股/新债申购')+'</div>';
    } else {
      if(d.stocks&&d.stocks.length)body+='<div class="sechead">新股</div>'+d.stocks.map(ipoRowHtml).join('');
      if(d.bonds&&d.bonds.length)body+='<div class="sechead">新债</div>'+d.bonds.map(ipoRowHtml).join('');
    }
    return '<div class="day">'+head+body+'</div>';
  }
  function renderIpo(m){
    if(m.error){ipoBody.innerHTML='<div class="warn">'+m.error+'</div>';ipoCount.textContent='';return;}
    const days=m.days||[];
    if(days.length===0){
      ipoBody.innerHTML='<div class="msg">未来 3 个交易日暂无新股/新债申购</div>';
      ipoCount.textContent='';
      return;
    }
    let todayInfo='';
    const td=days.find(d=>d.label.indexOf('今日')===0);
    if(td){
      const ns=td.stocks?td.stocks.length:0;
      const nb=td.bonds?td.bonds.length:0;
      if(ns||nb)todayInfo='今日新股'+ns+'新债'+nb;
    }
    ipoCount.textContent=todayInfo;
    ipoBody.innerHTML=days.map(ipoDayHtml).join('')+(m.updatedAt?'<div class="foot">更新于 '+m.updatedAt+'</div>':'');
  }
  window.addEventListener('message',e=>{
    const m=e.data;
    if(!m)return;
    if(m.type==='editMode'){ editing=!!m.value; document.body.classList.toggle('editing',editing); if(cur.length)render(cur); return; }
    if(m.type==='ipo'){ renderIpo(m); return; }
    if(m.type!=='quotes')return;
    document.body.classList.toggle('boss',!!m.boss);
    renderMarket(m.market);
    if(m.error){app.innerHTML='<div class="msg">'+m.error+'</div>';return;}
    if(!m.items||!m.items.length){cur=[];app.innerHTML='<div class="lhead">自选股<span class="cnt">0</span></div><div class="msg">暂无自选股，点击 + 添加</div>';return;}
    render(m.items,m.warn);
  });
  function render(items,warn){
    const sig=editing+'|'+items.map(it=>it.sym).join(',');
    if(curSig!==sig){
      curSig=sig;
      closeMenu();
      const banner=warn?'<div class="warn">'+warn+'</div>':'';
      app.innerHTML=banner+'<div class="lhead">自选股<span class="cnt">'+items.length+'</span></div>'+items.map((it,i)=>{
        const handle=editing?'<span class="handle" title="拖动排序">⋮⋮</span>':'';
        const pin=editing?'<button class="pin'+(it.inBar?' on':'')+'" title="'+(it.inBar?'从状态栏移除':'添加到状态栏')+'">'+PIN_SVG+'</button>':'';
        const top=editing?'<button class="top'+(it.pinned?' on':'')+'" title="'+(it.pinned?'取消置顶':'置顶')+'">'+TOP_SVG+'</button>':'';
        return '<div class="row" data-i="'+i+'"'+(editing?' draggable="true"':'')+'>'+handle+'<div class="left"><span class="name">'+it.name+'</span><span class="codeline"><span class="code">'+it.code+'</span>'+(it.board?'<span class="board">'+it.board+'</span>':'')+'</span></div>'+spark(it)+'<div class="right"><span class="pct '+it.cls+'">'+it.changePct+'</span><span class="price '+it.cls+'">'+it.price+'</span></div>'+pin+top+'<button class="del" title="删除">✕</button></div>';
      }).join('');
      fitNames();
      bind();
    } else {
      let bannerEl=app.querySelector('.warn');
      if(warn&&!bannerEl){
        bannerEl=document.createElement('div');
        bannerEl.className='warn';
        app.insertBefore(bannerEl,app.firstChild);
      }
      if(warn&&bannerEl){bannerEl.textContent=warn;}
      else if(!warn&&bannerEl){bannerEl.remove();}
      const rows=app.querySelectorAll('.row');
      items.forEach((it,i)=>{
        const row=rows[i];
        if(!row)return;
        const pct=row.querySelector('.pct');
        const price=row.querySelector('.price');
        if(pct){pct.textContent=it.changePct;pct.className='pct '+it.cls;}
        if(price){price.textContent=it.price;price.className='price '+it.cls;}
        const svg=row.querySelector('.spark');
        const s=it.spark;
        if(svg&&s&&s.line){
          const curPts=svg.dataset.pts;
          if(curPts!==s.line){
            svg.dataset.pts=s.line;
            svg.innerHTML='<path class="area" d="'+s.area+'"></path><line class="base" x1="0" y1="'+s.baseY+'" x2="100" y2="'+s.baseY+'"></line><polyline points="'+s.line+'"></polyline>';
            svg.setAttribute('class','spark '+s.color);
          }
        } else if(svg&&(!s||!s.line)){
          if(svg.innerHTML!==''){svg.innerHTML='';svg.setAttribute('class','spark flat');}
        }
      });
    }
    cur=items;
  }
  let curSig=null;
  function fitNames(){
    app.querySelectorAll('.name').forEach(el=>{
      const maxW=el.parentNode.clientWidth;
      let fs=13;
      el.style.fontSize=fs+'px';
      while(fs>9&&el.scrollWidth>maxW){fs-=0.5;el.style.fontSize=fs+'px';}
    });
  }
  function spark(it){
    const s=it.spark;
    const color=s&&s.line?s.color:'flat';
    let inner='';
    let pts='';
    if(s&&s.line){
      pts=s.line;
      inner='<path class="area" d="'+s.area+'"></path><line class="base" x1="0" y1="'+s.baseY+'" x2="100" y2="'+s.baseY+'"></line><polyline points="'+s.line+'"></polyline>';
    }
    return '<svg class="spark '+color+'" data-pts="'+pts+'" viewBox="0 0 100 18" preserveAspectRatio="none">'+inner+'</svg>';
  }
  function bind(){
    const rows=Array.from(app.querySelectorAll('.row'));
    rows.forEach((row,i)=>{
      row.addEventListener('click',(e)=>{
        if(editing)return;
        if(e.target.closest('.del,.pin,.top,.handle'))return;
        api.postMessage({type:'openDetail',symbol:cur[i].sym});
      });
      const del=row.querySelector('.del');
      del.addEventListener('click',()=>api.postMessage({type:'remove',symbol:cur[i].sym}));
      const pin=row.querySelector('.pin');
      if(pin)pin.addEventListener('click',()=>api.postMessage({type:'toggleStatusBar',symbol:cur[i].sym}));
      const top=row.querySelector('.top');
      if(top)top.addEventListener('click',()=>api.postMessage({type:'togglePin',symbol:cur[i].sym}));
    });
    if(!editing)return;
    const order=rows.map(r=>+r.dataset.i);
    let from=null;
    rows.forEach((row,i)=>{
      row.addEventListener('dragstart',e=>{
        from=i; row.classList.add('drag');
        e.dataTransfer.effectAllowed='move';
      });
      row.addEventListener('dragend',()=>{ from=null; rows.forEach(r=>r.classList.remove('drag','drop')); });
      row.addEventListener('dragover',e=>{ if(from===null||from===i)return; e.preventDefault(); e.dataTransfer.dropEffect='move'; rows.forEach(r=>r.classList.remove('drop')); row.classList.add('drop'); });
      row.addEventListener('drop',e=>{
        e.preventDefault();
        if(from===null||from===i){ from=null; return; }
        const moved=order.splice(from,1)[0];
        order.splice(i,0,moved);
        api.postMessage({type:'reorder',symbols:order.map(idx=>cur[idx].sym)});
        from=null;
      });
    });
  }
  let menu=null;
  function closeMenu(){
    if(menu){menu.remove();menu=null;}
  }
  function showMenu(x,y,it){
    closeMenu();
    menu=document.createElement('div');
    menu.className='ctxmenu';
    menu.innerHTML=
      '<div class="item">'+(it.inBar?'从状态栏移除':'添加到状态栏')+'</div>'+
      '<div class="item">'+(it.pinned?'取消置顶':'置顶')+'</div>'+
      '<div class="item">复制代码</div>'+
      '<div class="sep"></div>'+
      '<div class="item danger">删除</div>';
    document.body.appendChild(menu);
    menu.style.left=Math.min(x,window.innerWidth-menu.offsetWidth-4)+'px';
    menu.style.top=Math.min(y,window.innerHeight-menu.offsetHeight-4)+'px';
    const items=Array.from(menu.querySelectorAll('.item'));
    items[0].addEventListener('click',()=>api.postMessage({type:'toggleStatusBar',symbol:it.sym}));
    items[1].addEventListener('click',()=>api.postMessage({type:'togglePin',symbol:it.sym}));
    items[2].addEventListener('click',()=>api.postMessage({type:'copy',code:it.code}));
    items[3].addEventListener('click',()=>api.postMessage({type:'remove',symbol:it.sym}));
    items.forEach(el=>el.addEventListener('click',closeMenu));
  }
  window.addEventListener('contextmenu',e=>{
    const row=e.target.closest('.row');
    if(!row){closeMenu();return;}
    e.preventDefault();
    showMenu(e.clientX,e.clientY,cur[+row.dataset.i]);
  });
  window.addEventListener('mousedown',e=>{ if(menu&&!menu.contains(e.target))closeMenu(); });
  window.addEventListener('keydown',e=>{ if(e.key==='Escape')closeMenu(); });
})();
</script>
</body>
</html>`;
  }
}

function toViewItem(q: StockQuote, spark: SparkData | null, inBar: boolean, pinned: boolean): QuoteViewItem {
  const cls: QuoteViewItem['cls'] = q.changePct > 0 ? 'up' : q.changePct < 0 ? 'down' : 'flat';
  const code = q.symbol.slice(2);
  return {
    sym: q.symbol,
    name: q.name,
    code,
    board: boardOf(code),
    price: q.price.toFixed(2),
    changePct: `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`,
    cls,
    spark,
    inBar,
    pinned,
  };
}

function toIndexViewItem(q: StockQuote, spark: SparkData | null): IndexViewItem {
  const cls: IndexViewItem['cls'] = q.changePct > 0 ? 'up' : q.changePct < 0 ? 'down' : 'flat';
  return {
    sym: q.symbol,
    short: INDEX_SHORT_NAMES[q.symbol] ?? q.name,
    price: q.price.toFixed(2),
    changePct: `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`,
    cls,
    spark,
  };
}