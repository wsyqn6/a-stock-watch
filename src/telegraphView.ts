import * as vscode from 'vscode';
import {
  fetchTelegraph,
  fmtPct,
  fmtReading,
  pctSign,
  TelegraphItem,
  toTelegraphDisplayItem,
} from './telegraph';
import { getNonce } from './util';

interface DisplayStock {
  name: string;
  pct: string;
  sign: string;
}

interface DisplayItem {
  time: string;
  text: string;
  badge: string;
  reading: string;
  stocks: DisplayStock[];
}

const DEFAULT_INTERVAL_SEC = 30;
const MAX_ITEMS = 100;

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);padding:0 4px 8px}
.row{padding:6px 8px;border-bottom:1px solid var(--vscode-panel-border)}
.row:hover{background:var(--vscode-list-hoverBackground)}
.meta{display:flex;align-items:baseline;gap:6px;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:2px}
.meta .time{font-variant-numeric:tabular-nums;flex:0 0 auto}
.meta .reading{margin-left:auto;flex:0 0 auto;font-variant-numeric:tabular-nums}
.badge{flex:0 0 auto;font-size:10px;font-weight:700;line-height:1.2;padding:1px 4px;border-radius:2px;color:#fff;background:#d0372d}
.row.imp .text{font-weight:600}
.text{line-height:1.45;word-break:break-word}
.stocks{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.chip{font-size:11px;line-height:1;padding:2px 6px;border-radius:3px;border:1px solid;font-variant-numeric:tabular-nums}
.chip.up{color:#d0372d;border-color:rgba(208,55,45,.35);background:rgba(208,55,45,.08)}
.chip.down{color:#089981;border-color:rgba(8,153,129,.35);background:rgba(8,153,129,.08)}
.chip.flat{color:var(--vscode-descriptionForeground);border-color:var(--vscode-panel-border)}
.msg{padding:12px;color:var(--vscode-descriptionForeground);text-align:center}
.warn{padding:6px 12px;color:var(--vscode-editorWarning-foreground);font-size:12px;line-height:1.4;word-break:break-all}
`;

export class TelegraphView implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'aStockTelegraph';
  private view?: vscode.WebviewView;
  private timer: NodeJS.Timeout | null = null;
  private loading = false;
  private items: TelegraphItem[] = [];
  private error: string | null = null;

  get visible(): boolean {
    return this.view?.visible ?? false;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.html();
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg && typeof msg === 'object' && (msg as { type?: unknown }).type === 'ready') {
        this.push();
      }
    });
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.start();
      } else {
        this.stop();
      }
    });
    if (webviewView.visible) {
      this.start();
    }
  }

  /** view 可见时启动轮询；隐藏时停止，实现「可见才请求」。 */
  start(): void {
    void this.refresh();
    this.schedule();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    this.stop();
    const sec = Math.max(
      10,
      vscode.workspace.getConfiguration('aStockWatch').get<number>('telegraphIntervalSec', DEFAULT_INTERVAL_SEC),
    );
    this.timer = setInterval(() => void this.refresh(), sec * 1000);
  }

  async refresh(): Promise<void> {
    if (this.loading) {
      return;
    }
    this.loading = true;
    try {
      const fetched = await fetchTelegraph();
      const seen = new Set<number>();
      const merged: TelegraphItem[] = [];
      for (const it of [...fetched, ...this.items]) {
        if (seen.has(it.id)) {
          continue;
        }
        seen.add(it.id);
        merged.push(it);
      }
      merged.sort((a, b) => b.ctime - a.ctime);
      this.items = merged.slice(0, MAX_ITEMS);
      this.error = null;
    } catch (err) {
      // 保留旧数据，下次刷新重试
      if (this.items.length === 0) {
        this.error = err instanceof Error ? `电报数据错误: ${err.message}` : '电报数据错误';
      }
    } finally {
      this.loading = false;
    }
    this.push();
  }

  private push(): void {
    if (!this.view || !this.view.visible) {
      return;
    }
    void this.view.webview.postMessage({
      type: 'data',
      items: this.toDisplay(),
      error: this.error,
    });
  }

  /** host 侧算好展示字符串，webview 只做转义渲染。 */
  private toDisplay(): DisplayItem[] {
    return this.items.map((it): DisplayItem => {
      const row = toTelegraphDisplayItem(it);
      return {
        time: row.time,
        text: row.text,
        badge: row.level === 'A' ? '重磅' : row.level === 'B' ? '重要' : '',
        reading: row.reading > 0 ? fmtReading(row.reading) : '',
        stocks: row.stocks.map((s) => ({
          name: s.name,
          pct: fmtPct(s.pct),
          sign: pctSign(s.pct),
        })),
      };
    });
  }

  private html(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${CSS}</style>
</head>
<body>
<div id="root"><div class="msg">加载中…</div></div>
<script nonce="${nonce}">
(function(){
  const root=document.getElementById('root');
  const api=acquireVsCodeApi();
  api.postMessage({type:'ready'});
  function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function render(m){
    if(m.error){root.innerHTML='<div class="warn">'+esc(m.error)+'</div>';return;}
    const items=m.items||[];
    if(items.length===0){root.innerHTML='<div class="msg">暂无电报</div>';return;}
    root.innerHTML=items.map(function(it){
      const meta='<div class="meta"><span class="time">'+esc(it.time)+'</span>'+
        (it.badge?'<span class="badge">'+esc(it.badge)+'</span>':'')+
        (it.reading?'<span class="reading">'+esc(it.reading)+'</span>':'')+'</div>';
      const chips=it.stocks.map(function(s){
        return '<span class="chip '+s.sign+'">'+esc(s.name)+(s.pct?' '+s.pct:'')+'</span>';
      }).join('');
      return '<div class="row'+(it.badge?' imp':'')+'">'+meta+
        '<div class="text">'+esc(it.text)+'</div>'+
        (chips?'<div class="stocks">'+chips+'</div>':'')+'</div>';
    }).join('');
  }
  window.addEventListener('message',e=>{const m=e.data;if(m&&m.type==='data')render(m);});
})();
</script>
</body>
</html>`;
  }

  dispose(): void {
    this.stop();
  }
}