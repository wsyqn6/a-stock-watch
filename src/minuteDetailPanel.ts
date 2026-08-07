import * as vscode from 'vscode';
import {
  StockQuote,
  MinuteChartLayout,
  fetchQuotes,
  getMinuteCached,
  buildMinuteChart,
  isTradingTime,
} from './dataSource';

const REFRESH_INTERVAL_MS = 10_000;

export class MinuteDetailPanel {
  public static readonly viewType = 'aStockWatch.detail';
  private static current: MinuteDetailPanel | null = null;

  static open(symbol: string, quote?: StockQuote): void {
    const existing = MinuteDetailPanel.current;
    if (existing && !existing.disposed) {
      existing.panel.reveal(vscode.ViewColumn.Beside, true);
      void existing.load(symbol, quote);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      MinuteDetailPanel.viewType,
      '分时走势',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    MinuteDetailPanel.current = new MinuteDetailPanel(panel, symbol, quote);
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposeSub: vscode.Disposable;
  private readonly viewChangeSub: vscode.Disposable;
  private timer: NodeJS.Timeout | null = null;
  private symbol: string;
  private quote?: StockQuote;
  private layout: MinuteChartLayout | null = null;
  private minuteDate = '';
  private volTotal = 0;
  private amtTotal = 0;
  private error: string | null = null;
  private ready = false;
  private pendingLoad = false;
  private loading = false;
  private disposed = false;

  private constructor(panel: vscode.WebviewPanel, symbol: string, quote?: StockQuote) {
    this.panel = panel;
    this.symbol = symbol;
    this.quote = quote;
    panel.webview.options = { enableScripts: true };
    panel.webview.html = this.html();
    panel.webview.onDidReceiveMessage((msg) => {
      const type = (msg as { type?: string } | null)?.type;
      if (type === 'ready') {
        this.ready = true;
        if (this.pendingLoad) {
          this.pendingLoad = false;
          void this.load();
        } else {
          this.push();
        }
      }
    });
    this.disposeSub = panel.onDidDispose(() => this.onDispose());
    this.viewChangeSub = panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.visible) {
        this.startTimer();
        void this.load();
      } else {
        this.stopTimer();
      }
    });
    if (panel.visible) {
      this.startTimer();
    }
    void this.load();
  }

  private async load(symbol?: string, quote?: StockQuote): Promise<void> {
    if (symbol) {
      this.symbol = symbol;
      this.quote = quote;
    }
    if (!this.ready) {
      this.pendingLoad = true;
      return;
    }
    if (this.loading) {
      return;
    }
    this.loading = true;
    try {
      await this.fetchData(true);
    } finally {
      this.loading = false;
    }
  }

  private async refreshTick(): Promise<void> {
    if (!this.ready || this.loading || !isTradingTime()) {
      return;
    }
    this.loading = true;
    try {
      await this.fetchData(true);
    } finally {
      this.loading = false;
    }
  }

  private async fetchData(refetchQuote: boolean): Promise<void> {
    if (refetchQuote || !this.quote || this.quote.symbol !== this.symbol) {
      try {
        const list = await fetchQuotes([this.symbol]);
        this.quote = list[0];
      } catch {
        // keep the last known quote
      }
    }
    const q = this.quote;
    if (!q) {
      this.error = '未获取到行情数据';
      this.push();
      return;
    }
    if (q.name) {
      this.panel.title = `${q.name} · 分时`;
    }
    try {
      const { data } = await getMinuteCached(this.symbol);
      const layout = buildMinuteChart(data, q.prevClose);
      this.layout = layout;
      this.error = layout ? null : '分时数据缺失';
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
      if (this.layout === null) {
        this.error = err instanceof Error ? err.message : '加载失败';
      }
    }
    this.push();
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
      layout: this.layout,
      volTotal: this.volTotal,
      amtTotal: this.amtTotal,
      minuteDate: this.minuteDate,
      error: this.error,
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
@media (prefers-color-scheme: light){:root{--up:#C73E2E;--down:#2F8F5B}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);padding:0 0 12px;user-select:none}
.up{color:var(--up)}
.down{color:var(--down)}
.flat{color:var(--vscode-descriptionForeground)}
.head{display:flex;align-items:baseline;gap:10px;padding:10px 12px 6px}
.head .nm{font-size:15px;font-weight:600}
.head .cd{font-size:11px;color:var(--vscode-descriptionForeground)}
.head .px{font-size:26px;font-weight:600;font-variant-numeric:tabular-nums;margin-left:auto}
.head .chg{font-size:12px;font-variant-numeric:tabular-nums;text-align:right;line-height:1.3}
.stats{display:flex;flex-wrap:wrap;gap:4px 14px;padding:2px 12px 8px;font-size:11px;color:var(--vscode-descriptionForeground)}
.stats b{color:var(--vscode-foreground);font-weight:500;font-variant-numeric:tabular-nums}
.chart-wrap{position:relative;margin:0 6px}
.chart{display:block;width:100%;height:auto;cursor:crosshair}
.chart line.grid{stroke:var(--vscode-editorWidget-border);stroke-width:1;opacity:.6;vector-effect:non-scaling-stroke}
.chart line.base{stroke:var(--vscode-descriptionForeground);stroke-width:1;stroke-dasharray:4 3;opacity:.55;vector-effect:non-scaling-stroke}
.chart polyline.avg{fill:none;stroke:var(--avg);stroke-width:1.4;stroke-dasharray:5 3;vector-effect:non-scaling-stroke}
.chart polyline.price{fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.chart polyline.price.up{stroke:var(--up)}
.chart polyline.price.down{stroke:var(--down)}
.chart polyline.price.flat{stroke:var(--vscode-descriptionForeground)}
.chart rect.v{stroke:none;opacity:.75}
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
.tip{position:absolute;display:none;min-width:130px;background:var(--vscode-menu-background);color:var(--vscode-menu-foreground);border:1px solid var(--vscode-menu-border);border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,.3);padding:6px 8px;font-size:11px;pointer-events:none;line-height:1.5;z-index:10}
.tip .row{display:flex;justify-content:space-between;gap:12px}
.tip .row b{font-variant-numeric:tabular-nums}
.msg{padding:24px;color:var(--vscode-descriptionForeground);text-align:center}
.foot{display:flex;justify-content:space-between;padding:6px 14px 0;font-size:10px;color:var(--vscode-descriptionForeground);opacity:.8}
</style>
</head>
<body>
<div id="app"><div class="msg">加载中…</div></div>
<script nonce="${nonce}">
(function(){
  const app=document.getElementById('app');
  const api=acquireVsCodeApi();
  const AXIS_R=46;
  const fmtVol=function(v){ if(v>=10000) return (v/10000).toFixed(2)+'万手'; return Math.round(v)+'手'; };
  const fmtAmt=function(v){ if(v>=1e8) return (v/1e8).toFixed(2)+'亿'; if(v>=1e4) return (v/1e4).toFixed(2)+'万'; return Math.round(v); };
  const cls=function(p,c){ return p>c?'up':p<c?'down':'flat'; };
  const sign=function(n){ return n>=0?'+':''; };
  const hm=function(t){ return t.slice(0,2)+':'+t.slice(2); };
  let last=null;
  api.postMessage({type:'ready'});
  window.addEventListener('message',e=>{
    const m=e.data;
    if(!m||m.type!=='data')return;
    last=m;
    render(m);
  });
  function render(m){
    if(m.error){ app.innerHTML='<div class="msg">'+m.error+'</div>'; return; }
    const pxCls=cls(m.price,m.prevClose);
    const vol=m.volTotal;
    const head=
      '<div class="head"><span class="nm">'+m.name+'</span><span class="cd">'+m.code+'</span>'+
      '<span class="px '+pxCls+'">'+m.price.toFixed(2)+'</span>'+
      '<span class="chg '+pxCls+'">'+sign(m.change)+m.change.toFixed(2)+'&nbsp; '+sign(m.changePct)+m.changePct.toFixed(2)+'%</span></div>';
    const stats=
      '<div class="stats">'+
      (m.open!=null?'<span>今开 <b>'+m.open.toFixed(2)+'</b></span>':'')+
      (m.high!=null?'<span>最高 <b>'+m.high.toFixed(2)+'</b></span>':'')+
      (m.low!=null?'<span>最低 <b>'+m.low.toFixed(2)+'</b></span>':'')+
      '<span>昨收 <b>'+m.prevClose.toFixed(2)+'</b></span>'+
      '<span>成交量 <b>'+fmtVol(vol)+'</b></span>'+
      '<span>成交额 <b>'+fmtAmt(m.amtTotal)+'</b></span></div>';
    app.innerHTML=head+stats+chartSVG(m);
    bindChart(m);
  }
  function chartSVG(m){
    const L=m.layout;
    if(!L) return '<div class="msg">暂无分时数据</div>';
    const W=L.width,H=L.totalH;
    const gridH=L.yTicks.map(t=>'<line class="grid" x1="0" y1="'+t.y+'" x2="'+(W-AXIS_R)+'" y2="'+t.y+'"></line>').join('');
    const gridV=L.xTicks.map(t=>'<line class="grid" x1="'+t.x+'" y1="0" x2="'+t.x+'" y2="'+H+'"></line>').join('');
    const yLab=L.yTicks.map(t=>'<text x="'+(W-AXIS_R+4)+'" y="'+(t.y+3)+'">'+t.label+'</text>').join('');
    const xLab=L.xTicks.map(t=>'<text x="'+t.x+'" y="'+(H-3)+'" text-anchor="middle">'+t.label+'</text>').join('');
    const bars=L.bars.map(b=>'<rect class="v '+b.cls+'" x="'+b.x.toFixed(1)+'" y="'+b.y.toFixed(1)+'" width="'+b.w.toFixed(2)+'" height="'+b.h.toFixed(1)+'"></rect>').join('');
    const pxCls=cls(L.lastPrice,m.prevClose);
    return '<div class="chart-wrap"><div class="tip" id="tip"></div>'+
      '<svg class="chart" id="chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'+
      gridV+gridH+yLab+
      '<g id="vol">'+bars+'</g>'+
      '<line class="base" x1="0" y1="'+L.baseY+'" x2="'+(W-AXIS_R)+'" y2="'+L.baseY+'"></line>'+
      '<polyline class="price '+pxCls+'" points="'+L.priceLine+'"></polyline>'+
      '<polyline class="avg" points="'+L.avgLine+'"></polyline>'+
      '<g class="cross" id="cross" style="display:none"><line id="cx" y1="0" y2="'+H+'"></line><circle id="cp" class="p" r="3.5"></circle><circle id="ca" class="a" r="3"></circle></g>'+
      xLab+
      '</svg></div>';
  }
  function bindChart(m){
    const L=m.layout;
    const svg=document.getElementById('chart');
    const cross=document.getElementById('cross');
    const cx=document.getElementById('cx');
    const cp=document.getElementById('cp');
    const ca=document.getElementById('ca');
    const tip=document.getElementById('tip');
    const W=L.width,H=L.totalH;
    const show=function(i){
      const p=L.pts[i];
      if(!p)return;
      cross.style.display='';
      cx.setAttribute('x1',p.x); cx.setAttribute('x2',p.x);
      cp.setAttribute('cx',p.x); cp.setAttribute('cy',p.y);
      cp.className.baseVal='p '+cls(p.price,m.prevClose);
      ca.setAttribute('cx',p.x); ca.setAttribute('cy',p.ay);
      const pc=cls(p.price,m.prevClose);
      tip.style.display='block';
      tip.innerHTML=
        '<div class="row"><span>'+hm(p.time)+'</span><b class="'+pc+'">'+p.price.toFixed(2)+'</b></div>'+
        '<div class="row"><span>均价</span><b style="color:var(--avg)">'+p.avg.toFixed(2)+'</b></div>'+
        '<div class="row"><span>成交量</span><b>'+fmtVol(p.volume)+'</b></div>';
      const frac=p.x/W;
      const rw=svg.parentNode.getBoundingClientRect();
      const tw=tip.offsetWidth;
      const tx=frac*rw.width+(rw.width*(1/W)*4);
      tip.style.left=Math.min(Math.max(0,tx-tw/2),rw.width-tw-4)+'px';
      tip.style.top='6px';
    };
    svg.addEventListener('mousemove',e=>{
      const r=svg.getBoundingClientRect();
      const sx=(e.clientX-r.left)/r.width*W;
      let best=0,dd=Infinity;
      for(let i=0;i<L.pts.length;i++){
        const d=Math.abs(L.pts[i].x-sx);
        if(d<dd){dd=d;best=i;}
      }
      show(best);
    });
    svg.addEventListener('mouseleave',()=>{ cross.style.display='none'; tip.style.display='none'; });
  }
})();
</script>
</body>
</html>`;
  }
}

function getNonce(): string {
  return Math.random().toString(36).slice(2);
}
