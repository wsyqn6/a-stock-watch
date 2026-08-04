import * as vscode from 'vscode';
import { StockQuote, fetchQuotes } from './dataSource';
import { Store } from './store';
import { RefreshManager } from './refreshManager';

export interface QuoteViewItem {
  name: string;
  code: string;
  price: string;
  changePct: string;
  cls: 'up' | 'down' | 'flat';
  bar: string;
}

export class StockViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'aStockWatch';
  private view?: vscode.WebviewView;
  private manager?: RefreshManager;
  private quotes: StockQuote[] = [];
  private error: string | null = null;
  private dark: boolean;

  constructor(private readonly store: Store) {
    this.dark = this.isDark();
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.html();
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg && msg.type === 'ready') {
        this.push();
      }
    });
    this.manager = new RefreshManager(this.store, this, webviewView);
    this.manager.start();
  }

  notifyChanged(): void {
    void this.manager?.refresh();
  }

  refreshNow(): Promise<void> {
    return this.manager?.refresh() ?? Promise.resolve();
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

  private push(): void {
    if (!this.view || !this.view.visible) {
      return;
    }
    const items = this.quotes.map(toViewItem);
    void this.view.webview.postMessage({ type: 'quotes', items, error: this.error });
  }

  dispose(): void {
    this.manager?.dispose();
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
.bar{width:16px;flex:0 0 auto;text-align:center;font-size:11px;font-weight:700;margin-right:6px}
.cell{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.l1{display:flex;justify-content:space-between;align-items:baseline;width:100%}
.name{font-weight:600;font-size:13px}
.code{font-size:10px;color:var(--vscode-descriptionForeground);opacity:.8}
.price{font-weight:600;font-variant-numeric:tabular-nums}
.pct{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
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
    app.innerHTML=m.items.map(it=>{
      return '<div class="row"><span class="bar '+it.cls+'">'+it.bar+'</span><div class="cell"><div class="l1"><span class="name">'+it.name+'</span><span class="pct '+it.cls+'">'+it.changePct+'</span></div><div class="l1"><span class="code">'+it.code+'</span><span class="price '+it.cls+'">'+it.price+'</span></div></div></div>';
    }).join('');
  });
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
