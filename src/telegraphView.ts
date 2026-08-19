import * as vscode from 'vscode';
import {
  fetchTelegraph,
  fetchTelegraphBefore,
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
  level: string;
  reading: string;
  stocks: DisplayStock[];
}

const DEFAULT_INTERVAL_SEC = 30;
const HISTORY_RN = 20;
const MAX_ITEMS = 200;

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);padding:0 4px 8px}
.row{position:relative;padding:6px 8px 6px 11px;border-bottom:1px solid var(--vscode-panel-border)}
.row:hover{background:var(--vscode-list-hoverBackground)}
.row.imp::before{content:'';position:absolute;left:0;top:7px;height:13px;width:3px;background:var(--imp-color,#d0372d);border-radius:0 1px 1px 0}
.row.lvl-a{--imp-color:#d0372d}
.row.lvl-b{--imp-color:#ed9a2e}
.meta{display:flex;align-items:baseline;gap:6px;font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:2px}
.meta .time{font-variant-numeric:tabular-nums;flex:0 0 auto}
.meta .reading{margin-left:auto;flex:0 0 auto;font-variant-numeric:tabular-nums}
.badge{flex:0 0 auto;font-size:10px;font-weight:700;line-height:1.2;padding:1px 4px;border-radius:2px;color:#fff;background:var(--imp-color,#d0372d)}
.row.lvl-b .badge{color:#ed9a2e;background:rgba(237,154,46,.16)}
.row.imp .text{font-weight:600}
.text{line-height:1.45;word-break:break-word}
.stocks{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.chip{font-size:11px;line-height:1;padding:2px 6px;border-radius:3px;border:1px solid;font-variant-numeric:tabular-nums}
.chip.up{color:#d0372d;border-color:rgba(208,55,45,.35);background:rgba(208,55,45,.08)}
.chip.down{color:#089981;border-color:rgba(8,153,129,.35);background:rgba(8,153,129,.08)}
.chip.flat{color:var(--vscode-descriptionForeground);border-color:var(--vscode-panel-border)}
.msg{padding:12px;color:var(--vscode-descriptionForeground);text-align:center}
.foot{padding:10px 8px;color:var(--vscode-descriptionForeground);font-size:11px;text-align:center}
.warn{padding:6px 12px;color:var(--vscode-editorWarning-foreground);font-size:12px;line-height:1.4;word-break:break-all}
`;

export class TelegraphView implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'aStockTelegraph';
  private view?: vscode.WebviewView;
  private timer: NodeJS.Timeout | null = null;
  private loading = false;
  private loadingMore = false;
  private hasMore = true;
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
      if (!msg || typeof msg !== 'object') {
        return;
      }
      const type = (msg as { type?: unknown }).type;
      if (type === 'ready') {
        this.push();
      } else if (type === 'loadMore') {
        void this.loadMore();
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
      // 列表未触顶说明仍有空间容纳历史，重新开放下拉加载；触顶(200)则维持现状避免空取
      this.hasMore = this.items.length < MAX_ITEMS ? true : this.hasMore;
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
      items: this.toDisplayItems(this.items),
      hasMore: this.hasMore,
      error: this.error,
    });
  }

  /** 仅把增量（更旧的历史）追加推给 webview，不重建整列表，避免滚动跳顶。 */
  private pushMore(items: TelegraphItem[]): void {
    if (!this.view || !this.view.visible) {
      return;
    }
    void this.view.webview.postMessage({
      type: 'more',
      items: this.toDisplayItems(items),
      hasMore: this.hasMore,
    });
  }

  /** host 侧算好展示字符串，webview 只做转义渲染。 */
  private toDisplayItems(items: TelegraphItem[]): DisplayItem[] {
    return items.map((it): DisplayItem => {
      const row = toTelegraphDisplayItem(it);
      return {
        time: row.time,
        text: row.text,
        level: row.level,
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

  /** 下拉加载更早的历史电报。游标取当前列表最旧一条的 ctime。 */
  private async loadMore(): Promise<void> {
    if (this.loadingMore || !this.hasMore || this.items.length === 0) {
      return;
    }
    this.loadingMore = true;
    const cursor = Math.floor(Math.min(...this.items.map((i) => i.ctime)) / 1000);
    const prevIds = new Set(this.items.map((i) => i.id));
    try {
      const fetched = await fetchTelegraphBefore(cursor, HISTORY_RN);
      const older = fetched.filter((it) => !prevIds.has(it.id));
      if (older.length === 0) {
        this.hasMore = false;
      } else {
        this.items = [...this.items, ...older]
          .sort((a, b) => b.ctime - a.ctime)
          .slice(0, MAX_ITEMS);
      }
      const delta = this.items.filter((i) => !prevIds.has(i.id));
      this.pushMore(delta);
    } catch {
      // 保留现有数据，允许下次重试；仅清除 loading 态
      this.pushMore([]);
    } finally {
      this.loadingMore = false;
    }
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
  let hasMore=true, loadingMore=false, pending=null;
  function rowHtml(it){
    const cls=(it.badge?' imp':'')+(it.level==='A'?' lvl-a':it.level==='B'?' lvl-b':'');
    const meta='<div class="meta"><span class="time">'+esc(it.time)+'</span>'+
      (it.badge?'<span class="badge">'+esc(it.badge)+'</span>':'')+
      (it.reading?'<span class="reading">'+esc(it.reading)+'</span>':'')+'</div>';
    const chips=it.stocks.map(function(s){
      return '<span class="chip '+s.sign+'">'+esc(s.name)+(s.pct?' '+s.pct:'')+'</span>';
    }).join('');
    return '<div class="row'+cls+'">'+meta+
      '<div class="text">'+esc(it.text)+'</div>'+
      (chips?'<div class="stocks">'+chips+'</div>':'')+'</div>';
  }
  function foot(){
    let f=root.querySelector('.foot');
    if(!f){f=document.createElement('div');f.className='foot';root.appendChild(f);}
    f.textContent=loadingMore?'加载中…':(hasMore?'':'没有更多了');
  }
  function applyData(m){
    loadingMore=false;
    if(m.error){root.innerHTML='<div class="warn">'+esc(m.error)+'</div>';return;}
    const items=m.items||[];
    if(items.length===0){root.innerHTML='<div class="msg">暂无电报</div>';return;}
    hasMore=m.hasMore!==false;
    root.innerHTML=items.map(rowHtml).join('')+'<div class="foot"></div>';
    foot();
  }
  function render(m){
    // 用户已下翻查看历史时，暂缓整列重建以免跳回顶部；回顶后再应用最新数据
    if(window.scrollY>40){pending=m;return;}
    pending=null;
    applyData(m);
  }
  function appendMore(m){
    loadingMore=false;
    hasMore=m.hasMore!==false;
    const items=m.items||[];
    if(items.length){
      const f=root.querySelector('.foot');
      if(f){f.insertAdjacentHTML('beforebegin',items.map(rowHtml).join(''));}
      else{root.insertAdjacentHTML('beforeend',items.map(rowHtml).join(''));}
    }
    foot();
  }
  let ticking=false;
  function onScroll(){
    if(ticking)return;
    ticking=true;
    requestAnimationFrame(function(){
      ticking=false;
      if(pending&&window.scrollY<=40){const p=pending;pending=null;applyData(p);}
      if(loadingMore||!hasMore)return;
      if(window.innerHeight+window.scrollY>=document.body.offsetHeight-40){
        loadingMore=true;foot();api.postMessage({type:'loadMore'});
      }
    });
  }
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('message',e=>{const m=e.data;if(!m)return;if(m.type==='data')render(m);else if(m.type==='more')appendMore(m);});
})();
</script>
</body>
</html>`;
  }

  dispose(): void {
    this.stop();
  }
}