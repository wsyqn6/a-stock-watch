import * as vscode from 'vscode';
import {
  NewStockApply,
  NewBondApply,
  fetchNewStockApplies,
  fetchNewBondApplies,
  nextTradingDays,
  dashDate,
  dayLabel,
} from './ipo';
import { beijingDateStr } from './dataSource';
import { getNonce } from './util';

/** 打新列表单行（已预格式化，webview 只负责渲染）。 */
export interface IpoRow {
  name: string;
  code: string;
  date: string;
  price: string;
  tag: string;
}

/** 单个交易日分组。 */
export interface IpoDay {
  date: string;
  label: string;
  stocks: IpoRow[];
  bonds: IpoRow[];
}

const WEBVIEW_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);margin:0;padding:0 4px 8px}
.day{background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-widget-border);border-radius:6px;margin:6px 4px;overflow:hidden}
.dayhead{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:11px;font-weight:600;letter-spacing:.06em;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-panel-border)}
.dayhead.today{color:var(--vscode-textLink-foreground)}
.dayhead .cnt{font-weight:400;letter-spacing:0;opacity:.7;margin-left:auto}
.sechead{display:flex;align-items:baseline;gap:6px;padding:5px 10px 2px;font-size:10px;font-weight:600;letter-spacing:.12em;color:var(--vscode-descriptionForeground);text-transform:uppercase;opacity:.85}
.row{display:flex;align-items:center;padding:6px 10px}
.row:hover{background:var(--vscode-list-hoverBackground)}
.left{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:1px}
.right{flex:0 0 auto;display:flex;flex-direction:column;justify-content:center;gap:1px;align-items:flex-end;text-align:right}
.name{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.code{font-size:10px;color:var(--vscode-descriptionForeground);opacity:.8}
.date{font-size:11px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1.15}
.price{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.15}
.tag{font-size:10px;color:var(--vscode-descriptionForeground);line-height:1.15;white-space:nowrap}
.empty{padding:8px 10px 10px;color:var(--vscode-descriptionForeground);font-size:12px}
.empty.today{color:var(--vscode-editorWarning-foreground)}
.foot{text-align:right;padding:6px 8px 0;font-size:10px;color:var(--vscode-descriptionForeground)}
.msg{padding:12px;color:var(--vscode-descriptionForeground);text-align:center}
.warn{padding:6px 12px;color:var(--vscode-editorWarning-foreground);font-size:12px;line-height:1.4;word-break:break-all}
`;

export class IpoViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'aStockWatchIpo';
  private view?: vscode.WebviewView;
  private refreshing = false;
  private days: IpoDay[] = [];
  private error: string | null = null;
  private updatedAt = '';

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.html();
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (!msg || typeof msg !== 'object') {
        return;
      }
      if ((msg as { type?: unknown }).type === 'ready') {
        void this.refresh();
      }
    });
    webviewView.onDidChangeVisibility(() => {
      if (this.view?.visible) {
        void this.refresh();
      }
    });
  }

  refreshNow(): void {
    void this.refresh();
  }

  dispose(): void {
    this.view = undefined;
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) {
      return;
    }
    this.refreshing = true;
    try {
      const [stocks, bonds] = await Promise.all([
        fetchNewStockApplies(),
        fetchNewBondApplies(),
      ]);
      this.days = groupByDay(stocks, bonds);
      this.error = null;
      const now = new Date();
      this.updatedAt = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    } catch (err) {
      this.error = err instanceof Error ? `打新数据错误: ${err.message}` : '打新数据错误';
    } finally {
      this.refreshing = false;
    }
    this.push();
  }

  private push(): void {
    if (!this.view || !this.view.visible) {
      return;
    }
    void this.view.webview.postMessage({
      type: 'ipo',
      days: this.days,
      error: this.error,
      updatedAt: this.updatedAt,
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
<div id="app"><div class="msg">加载中…</div></div>
<script nonce="${nonce}">
(function(){
  const app=document.getElementById('app');
  const api=acquireVsCodeApi();
  api.postMessage({type:'ready'});
  function row(it){
    return '<div class="row"><div class="left"><span class="name">'+it.name+'</span><span class="code">'+it.code+'</span></div>'+
      '<div class="right"><span class="date">'+it.date+'</span><span class="price">'+it.price+'</span><span class="tag">'+it.tag+'</span></div></div>';
  }
  function dayHtml(d){
    const isToday=d.label.indexOf('今日')===0;
    const n=(d.stocks?d.stocks.length:0)+(d.bonds?d.bonds.length:0);
    const head='<div class="dayhead'+(isToday?' today':'')+'">'+d.label+'<span class="cnt">'+n+' 项</span></div>';
    let body='';
    if(n===0){
      body='<div class="empty'+(isToday?' today':'')+'">'+(isToday?'今日无新股/新债申购':'该日无新股/新债申购')+'</div>';
    } else {
      if(d.stocks&&d.stocks.length)body+='<div class="sechead">新股</div>'+d.stocks.map(row).join('');
      if(d.bonds&&d.bonds.length)body+='<div class="sechead">新债</div>'+d.bonds.map(row).join('');
    }
    return '<div class="day">'+head+body+'</div>';
  }
  window.addEventListener('message',e=>{
    const m=e.data;
    if(!m||m.type!=='ipo')return;
    const days=m.days||[];
    if(m.error){app.innerHTML='<div class="warn">'+m.error+'</div>';return;}
    if(days.length===0){app.innerHTML='<div class="msg">未来 3 个交易日暂无新股/新债申购</div>';return;}
    app.innerHTML=days.map(dayHtml).join('')+(m.updatedAt?'<div class="foot">更新于 '+m.updatedAt+'</div>':'');
  });
})();
</script>
</body>
</html>`;
  }
}

function groupByDay(stocks: NewStockApply[], bonds: NewBondApply[]): IpoDay[] {
  const dates = nextTradingDays(3);
  const today = dashDate(beijingDateStr());
  const stockBy = new Map<string, NewStockApply[]>();
  const bondBy = new Map<string, NewBondApply[]>();
  for (const s of stocks) {
    const list = stockBy.get(s.applyDate) ?? [];
    list.push(s);
    stockBy.set(s.applyDate, list);
  }
  for (const b of bonds) {
    const list = bondBy.get(b.applyDate) ?? [];
    list.push(b);
    bondBy.set(b.applyDate, list);
  }
  return dates.map((date) => ({
    date,
    label: dayLabel(date, today),
    stocks: (stockBy.get(date) ?? []).map(toStockRow),
    bonds: (bondBy.get(date) ?? []).map(toBondRow),
  }));
}

function toStockRow(s: NewStockApply): IpoRow {
  const price = s.issuePrice !== undefined ? `${s.issuePrice.toFixed(2)} 元` : '待定价';
  const parts: string[] = [];
  if (s.topMcapWan !== undefined) {
    parts.push(`顶格 ${s.topMcapWan} 万`);
  }
  if (s.applyUpperWan !== undefined) {
    parts.push(`上限 ${s.applyUpperWan} 万股`);
  }
  return {
    name: s.name,
    code: s.code,
    date: s.applyDate.slice(5),
    price,
    tag: parts.join(' · '),
  };
}

function toBondRow(b: NewBondApply): IpoRow {
  const parts: string[] = [];
  if (b.scaleYi !== undefined) {
    parts.push(`规模 ${b.scaleYi} 亿`);
  }
  parts.push(b.transferPrice !== undefined ? `转股价 ${b.transferPrice} 元` : '转股价待定');
  return {
    name: b.name,
    code: b.code,
    date: b.applyDate.slice(5),
    price: b.convertStock ? `正股 ${b.convertStock}` : '—',
    tag: parts.join(' · '),
  };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}