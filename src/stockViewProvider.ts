import * as vscode from 'vscode';
import { StockQuote, fetchQuotes } from './dataSource';
import { Store } from './store';
import { RefreshManager } from './refreshManager';

export interface QuoteViewItem {
  sym: string;
  name: string;
  code: string;
  price: string;
  changePct: string;
  cls: 'up' | 'down' | 'flat';
  bar: string;
}

type SortMode = 'manual' | 'code' | 'name' | 'pctDesc' | 'pctAsc';

export class StockViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'aStockWatch';
  private view?: vscode.WebviewView;
  private manager?: RefreshManager;
  private quotes: StockQuote[] = [];
  private error: string | null = null;
  private dark: boolean;
  private sortMode: SortMode = 'manual';

  constructor(private readonly store: Store) {
    this.dark = this.isDark();
  }

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
      } else if (type === 'remove') {
        const symbol = (msg as { symbol?: unknown }).symbol;
        if (typeof symbol === 'string' && this.store.remove(symbol)) {
          this.notifyChanged();
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
    this.manager = new RefreshManager(this.store, this, webviewView);
    this.manager.start();
  }

  setSortMode(mode: SortMode): void {
    this.sortMode = mode;
    this.push();
  }

  notifyChanged(): void {
    void this.manager?.refresh();
  }

  refreshNow(): Promise<void> {
    return this.manager?.refresh() ?? Promise.resolve();
  }

  dispose(): void {
    this.manager?.dispose();
  }

  async refresh(symbols: string[]): Promise<void> {
    if (symbols.length === 0) {
      this.quotes = [];
      this.error = null;
    } else {
      try {
        this.quotes = await fetchQuotes(symbols);
        this.error = this.quotes.length === 0 ? '未获取到行情数据' : null;
      } catch (err) {
        this.quotes = [];
        this.error = err instanceof Error ? `行情错误: ${err.message}` : '行情错误';
      }
    }
    this.push();
  }

  private ordered(): StockQuote[] {
    if (this.sortMode === 'code') {
      return [...this.quotes].sort((a, b) => a.symbol.slice(2).localeCompare(b.symbol.slice(2)));
    }
    if (this.sortMode === 'name') {
      return [...this.quotes].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    }
    if (this.sortMode === 'pctDesc') {
      return [...this.quotes].sort((a, b) => b.changePct - a.changePct);
    }
    if (this.sortMode === 'pctAsc') {
      return [...this.quotes].sort((a, b) => a.changePct - b.changePct);
    }
    return this.quotes;
  }

  private push(): void {
    if (!this.view || !this.view.visible) {
      return;
    }
    const items = this.ordered().map(toViewItem);
    void this.view.webview.postMessage({ type: 'quotes', items, error: this.error });
  }

  private html(): string {
    const nonce = getNonce();
    const up = this.dark ? '#E15241' : '#C73E2E';
    const down = this.dark ? '#2EA46E' : '#2F8F5B';
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);padding:8px 4px}
.row{display:flex;align-items:center;padding:6px 8px;border-bottom:1px solid var(--vscode-panel-border)}
.row.drag{opacity:.4}
.row.drop{border-top:2px solid var(--vscode-focusBorder)}
.handle{cursor:grab;flex:0 0 auto;margin-right:4px;color:var(--vscode-descriptionForeground);font-size:12px;user-select:none}
.handle:active{cursor:grabbing}
.bar{width:16px;flex:0 0 auto;text-align:center;font-size:11px;font-weight:700;margin-right:6px}
.cell{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.l1{display:flex;justify-content:space-between;align-items:baseline;width:100%}
.name{font-weight:600;font-size:13px}
.code{font-size:10px;color:var(--vscode-descriptionForeground);opacity:.8}
.price{font-weight:600;font-variant-numeric:tabular-nums}
.pct{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
.del{flex:0 0 auto;margin-left:6px;color:var(--vscode-descriptionForeground);opacity:0;cursor:pointer;background:none;border:none;font-size:13px;padding:0 2px}
.row:hover .del{opacity:.9}
.del:hover{color:var(--vscode-errorForeground)}
.up{color:${up}}
.down{color:${down}}
.flat{color:var(--vscode-descriptionForeground)}
.msg{padding:12px;color:var(--vscode-descriptionForeground);text-align:center}
</style>
</head>
<body>
<div id="app"><div class="msg">加载中…</div></div>
<script nonce="${nonce}">
(function(){
  const app=document.getElementById('app');
  const api=acquireVsCodeApi();
  api.postMessage({type:'ready'});
  window.addEventListener('message',e=>{
    const m=e.data;
    if(!m||m.type!=='quotes')return;
    if(m.error){app.innerHTML='<div class="msg">'+m.error+'</div>';return;}
    if(!m.items||!m.items.length){app.innerHTML='<div class="msg">暂无自选股，点击 + 添加</div>';return;}
    render(m.items);
  });
  function render(items){
    app.innerHTML=items.map((it,i)=>{
      return '<div class="row" draggable="true" data-i="'+i+'"><span class="handle" title="拖动排序">⋮⋮</span><span class="bar '+it.cls+'">'+it.bar+'</span><div class="cell"><div class="l1"><span class="name">'+it.name+'</span><span class="pct '+it.cls+'">'+it.changePct+'</span></div><div class="l1"><span class="code">'+it.code+'</span><span class="price '+it.cls+'">'+it.price+'</span></div></div><button class="del" title="删除">✕</button></div>';
    }).join('');
    bind(items);
  }
  function bind(items){
    const rows=Array.from(app.querySelectorAll('.row'));
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
        api.postMessage({type:'reorder',symbols:order.map(idx=>items[idx].sym)});
        from=null;
      });
      const del=row.querySelector('.del');
      del.addEventListener('click',()=>api.postMessage({type:'remove',symbol:items[i].sym}));
    });
  }
})();
</script>
</body>
</html>`;
  }

  private isDark(): boolean {
    const kind = vscode.window.activeColorTheme.kind;
    return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
  }
}

function toViewItem(q: StockQuote): QuoteViewItem {
  const cls: QuoteViewItem['cls'] = q.changePct > 0 ? 'up' : q.changePct < 0 ? 'down' : 'flat';
  return {
    sym: q.symbol,
    name: q.name,
    code: q.symbol.slice(2),
    price: q.price.toFixed(2),
    changePct: `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`,
    cls,
    bar: barFor(q.changePct),
  };
}

function barFor(pct: number): string {
  if (pct >= 9.9) return '▲▲';
  if (pct >= 3) return '▲';
  if (pct > 0) return '↗';
  if (pct === 0) return '—';
  if (pct > -3) return '↘';
  if (pct > -9.9) return '▼';
  return '▼▼';
}

function getNonce(): string {
  return Math.random().toString(36).slice(2);
}