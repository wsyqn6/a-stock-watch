import * as vscode from 'vscode';
import { StockQuote, fetchQuotes, getMinuteCached, buildSpark, SparkData, isTradingTime } from './dataSource';
import { Store } from './store';
import { RefreshManager } from './refreshManager';
import { orderQuotes, SortMode } from './order';

export interface QuoteViewItem {
  sym: string;
  name: string;
  code: string;
  price: string;
  changePct: string;
  cls: 'up' | 'down' | 'flat';
  spark: SparkData | null;
  inBar: boolean;
  pinned: boolean;
}

const MINUTE_INTERVAL_MS = 60_000;

export class StockViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'aStockWatch';
  private view?: vscode.WebviewView;
  private manager?: RefreshManager;
  private minuteTimer: NodeJS.Timeout | null = null;
  private refreshingMinute = false;
  private quotes: StockQuote[] = [];
  private sparks = new Map<string, SparkData | null>();
  private error: string | null = null;
  private warn: string | null = null;
  private sortMode: SortMode = 'manual';
  private editMode = false;

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
    const symbols = this.store.getAll();
    if (!isTradingTime() && symbols.length > 0 && symbols.every((s) => this.sparks.has(s))) {
      return;
    }
    this.refreshingMinute = true;
    try {
      const pcMap = new Map(this.quotes.map((q) => [q.symbol, q.prevClose]));
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

  refreshNow(): Promise<void> {
    return this.manager?.refresh() ?? Promise.resolve();
  }

  dispose(): void {
    this.stopMinuteTimer();
    this.manager?.dispose();
  }

  async refresh(symbols: string[]): Promise<void> {
    if (symbols.length === 0) {
      this.quotes = [];
      this.error = null;
      this.warn = null;
    } else {
      try {
        this.quotes = await fetchQuotes(symbols);
        this.error = this.quotes.length === 0 ? '未获取到行情数据' : null;
      } catch (err) {
        this.quotes = [];
        this.error = err instanceof Error ? `行情错误: ${err.message}` : '行情错误';
      }
      if (this.error === null && this.quotes.length > 0) {
        const got = new Set(this.quotes.map((q) => q.symbol));
        const missing = symbols.filter((s) => !got.has(s));
        this.warn = missing.length > 0 ? `未获取到行情：${missing.join(', ')}` : null;
      }
    }
    this.push();
    void this.refreshMinute();
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
    void this.view.webview.postMessage({ type: 'quotes', items, error: this.error, warn: this.warn });
  }

  private html(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
:root{--up:#E15241;--down:#2EA46E}
@media (prefers-color-scheme: light){:root{--up:#C73E2E;--down:#2F8F5B}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);margin:0;padding:0 4px 8px}
.row{display:flex;align-items:center;padding:6px;border-bottom:1px solid var(--vscode-panel-border);transition:background .12s ease}
.row:hover{background:var(--vscode-list-hoverBackground)}
.row.drag{opacity:.4}
.row.drop{border-top:2px solid var(--vscode-focusBorder)}
.handle{cursor:grab;flex:0 0 auto;margin-right:4px;color:var(--vscode-descriptionForeground);font-size:12px;user-select:none}
.handle:active{cursor:grabbing}
.left{flex:0 0 90px;width:90px;max-width:90px;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:1px}
.right{flex:0 0 auto;display:flex;flex-direction:column;justify-content:center;gap:1px;align-items:flex-end;text-align:right}
.name{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.code{font-size:10px;color:var(--vscode-descriptionForeground);opacity:.8}
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
</style>
</head>
<body>
<svg width="0" height="0" aria-hidden="true"><defs><linearGradient id="gUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--up);stop-opacity:0.5"/><stop offset="1" style="stop-color:var(--up);stop-opacity:0"/></linearGradient><linearGradient id="gDown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--down);stop-opacity:0.5"/><stop offset="1" style="stop-color:var(--down);stop-opacity:0"/></linearGradient></defs></svg>
<div id="app"><div class="msg">加载中…</div></div>
<script nonce="${nonce}">
(function(){
  const app=document.getElementById('app');
  const api=acquireVsCodeApi();
  const PIN_SVG='<svg viewBox="0 0 16 16" width="13" height="13"><path d="M8 1a5 5 0 0 0-5 5c0 3.5 5 9 5 9s5-5.5 5-9a5 5 0 0 0-5-5z" fill="currentColor"></path><circle cx="8" cy="6" r="1.7" fill="var(--vscode-editor-background)"></circle></svg>';
  const TOP_SVG='<svg viewBox="0 0 16 16" width="13" height="13"><path d="M9.6 1.4l5 5-1 1-1.4-1.4-1.9 1.9.9 2.1-2.8 2.8-2.6-2.6L4 14l-2-2 3.8-2.8-2.6-2.6 2.8-2.8 2.1.9 1.9-1.9-1.4-1.4z" fill="currentColor"/></svg>';
  api.postMessage({type:'ready'});
  let editing=false;
  let cur=[];
  window.addEventListener('message',e=>{
    const m=e.data;
    if(!m)return;
    if(m.type==='editMode'){ editing=!!m.value; document.body.classList.toggle('editing',editing); if(cur.length)render(cur); return; }
    if(m.type!=='quotes')return;
    if(m.error){app.innerHTML='<div class="msg">'+m.error+'</div>';return;}
    if(!m.items||!m.items.length){cur=[];app.innerHTML='<div class="msg">暂无自选股，点击 + 添加</div>';return;}
    render(m.items,m.warn);
  });
  function render(items,warn){
    cur=items;
    closeMenu();
    const banner=warn?'<div class="warn">'+warn+'</div>':'';
    app.innerHTML=banner+items.map((it,i)=>{
      const handle=editing?'<span class="handle" title="拖动排序">⋮⋮</span>':'';
      const pin=editing?'<button class="pin'+(it.inBar?' on':'')+'" title="'+(it.inBar?'从状态栏移除':'添加到状态栏')+'">'+PIN_SVG+'</button>':'';
      const top=editing?'<button class="top'+(it.pinned?' on':'')+'" title="'+(it.pinned?'取消置顶':'置顶')+'">'+TOP_SVG+'</button>':'';
      return '<div class="row" data-i="'+i+'"'+(editing?' draggable="true"':'')+'>'+handle+'<div class="left"><span class="name">'+it.name+'</span><span class="code">'+it.code+'</span></div>'+spark(it)+'<div class="right"><span class="pct '+it.cls+'">'+it.changePct+'</span><span class="price '+it.cls+'">'+it.price+'</span></div>'+pin+top+'<button class="del" title="删除">✕</button></div>';
    }).join('');
    fitNames();
    bind();
  }
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
    if(s&&s.line){
      inner='<path class="area" d="'+s.area+'"></path><line class="base" x1="0" y1="'+s.baseY+'" x2="100" y2="'+s.baseY+'"></line><polyline points="'+s.line+'"></polyline>';
    }
    return '<svg class="spark '+color+'" viewBox="0 0 100 18" preserveAspectRatio="none">'+inner+'</svg>';
  }
  function bind(){
    const rows=Array.from(app.querySelectorAll('.row'));
    rows.forEach((row,i)=>{
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
  return {
    sym: q.symbol,
    name: q.name,
    code: q.symbol.slice(2),
    price: q.price.toFixed(2),
    changePct: `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`,
    cls,
    spark,
    inBar,
    pinned,
  };
}

function getNonce(): string {
  return Math.random().toString(36).slice(2);
}