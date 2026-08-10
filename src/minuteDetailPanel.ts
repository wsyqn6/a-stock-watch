import * as vscode from 'vscode';
import {
  StockQuote,
  MinuteChartLayout,
  KlineLayout,
  KlinePeriod,
  fetchQuotes,
  fetchKline,
  getMinuteCached,
  buildMinuteChart,
  buildKlineLayout,
  clearKlineCache,
  isTradingTime,
  KLINE_CANDLE_COUNT,
} from './dataSource';
import { getNonce } from './util';

const REFRESH_INTERVAL_MS = 10_000;

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

  private constructor(panel: vscode.WebviewPanel, symbol: string, quote?: StockQuote) {
    this.panel = panel;
    this.symbol = symbol;
    this.quote = quote;
    panel.webview.options = { enableScripts: true };
    panel.webview.html = this.html();
    panel.webview.onDidReceiveMessage((msg) => {
      const m = msg as { type?: string; period?: KlinePeriod } | null;
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
        void this.ensureKline(m.period);
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
      if (e.affectsConfiguration('aStockWatch.bossMode')) {
        this.boss = !!vscode.workspace.getConfiguration('aStockWatch').get('bossMode');
        if (this.ready) {
          this.push();
        }
      }
    });
    this.boss = !!vscode.workspace.getConfiguration('aStockWatch').get('bossMode');
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
        this.error = null;
        this.klineLayouts.clear();
        clearKlineCache(symbol);
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
  }

  private async refreshTick(): Promise<void> {
    if (!isTradingTime()) {
      return;
    }
    await this.load();
  }

  private async fetchData(refetchQuote: boolean): Promise<void> {
    if (refetchQuote || !this.quote || this.quote.symbol !== this.symbol) {
      try {
        const list = await fetchQuotes([this.symbol]);
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
    this.panel.title = `${q.name ?? this.symbol} · 走势`;
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
      // 同标的刷新失败时保留上一张可用图；切换标的时 layout 已被 load 清空，
      // 走到这里必然置错误提示，避免旧图残留
      if (this.layout === null) {
        this.error = err instanceof Error ? err.message : '加载失败';
      }
    }
    this.push();
  }

  /** 按需拉取并缓存指定周期的 K 线布局（命中缓存则不重复请求）。 */
  private async ensureKline(period: KlinePeriod): Promise<void> {
    if (!this.ready) {
      return;
    }
    if (this.klineLayouts.has(period)) {
      return;
    }
    try {
      const all = await fetchKline(this.symbol, KLINE_CANDLE_COUNT, period);
      const sliced = all.slice(-KLINE_CANDLE_COUNT);
      if (sliced.length < 2) {
        void this.panel.webview.postMessage({ type: 'kline', period, error: 'K线数据不足' });
        return;
      }
      const layout = buildKlineLayout(sliced);
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
.head .chg{font-size:12px;font-variant-numeric:tabular-nums;text-align:right;line-height:1.3;min-width:56px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:3px 8px;padding:2px 12px 0;font-size:11px;color:var(--vscode-descriptionForeground)}
.stats + .stats{padding-bottom:6px}
.stats span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stats b{color:var(--vscode-foreground);font-weight:600;font-variant-numeric:tabular-nums}
.chart-wrap{position:relative;margin:0 6px}
.chart{display:block;width:100%;height:auto;cursor:crosshair}
.chart line.grid{stroke:var(--vscode-editorWidget-border);stroke-width:1;opacity:.6;vector-effect:non-scaling-stroke}
.chart line.base{stroke:var(--vscode-descriptionForeground);stroke-width:1.5;stroke-dasharray:4 3;opacity:.75;vector-effect:non-scaling-stroke}
.chart polyline.avg{fill:none;stroke:var(--avg);stroke-width:1.4;vector-effect:non-scaling-stroke}
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
  const fmtAmt=function(v){ if(v>=1e12) return (v/1e12).toFixed(2)+'万亿'; if(v>=1e8) return (v/1e8).toFixed(2)+'亿'; if(v>=1e4) return (v/1e4).toFixed(2)+'万'; return Math.round(v); };
  const cls=function(p,c){ return p>c?'up':p<c?'down':'flat'; };
  const sign=function(n){ return n>=0?'+':''; };
  const hm=function(t){ return t.slice(0,2)+':'+t.slice(2); };
  const TABS=['分时','日K','周K','月K'];
  let last=null;
  let sym=null;
  let state={tab:'分时',klines:{}};
  api.postMessage({type:'ready'});
  window.addEventListener('message',e=>{
    const m=e.data;
    if(!m)return;
    if(m.type==='data'){
      if(m.symbol!==sym){ sym=m.symbol; state={tab:'分时',klines:{}}; }
      if(m.klineLayouts) state.klines=m.klineLayouts;
      last=m;
      render(m);
    } else if(m.type==='kline'){
      if(m.error){ state.klines[m.period]={error:m.error}; }
      else { state.klines[m.period]=m.layout; }
      render(last);
    }
  });
  function render(m){
    try {
      document.body.classList.toggle('boss',!!m.boss);
      if(m.error){ app.innerHTML='<div class="msg">'+m.error+'</div>'; return; }
      const price=m.price==null?0:m.price;
      const prevClose=m.prevClose==null?0:m.prevClose;
      const change=m.change==null?0:m.change;
      const changePct=m.changePct==null?0:m.changePct;
      const pxCls=cls(price,prevClose);
      const vol=m.volTotal;
      const head=
        '<div class="head"><span class="nm">'+m.name+'</span><span class="cd">'+m.code+'</span>'+
        '<span class="px '+pxCls+'">'+price.toFixed(2)+'</span>'+
        '<span class="chg '+pxCls+'">'+sign(change)+change.toFixed(2)+'&nbsp; '+sign(changePct)+changePct.toFixed(2)+'%</span></div>';
      const row1=
        '<div class="stats">'+
        '<span>今开 <b>'+(m.open!=null?m.open.toFixed(2):'—')+'</b></span>'+
        '<span>最高 <b>'+(m.high!=null?m.high.toFixed(2):'—')+'</b></span>'+
        '<span>最低 <b>'+(m.low!=null?m.low.toFixed(2):'—')+'</b></span>'+
        '<span>昨收 <b>'+prevClose.toFixed(2)+'</b></span>'+
        '</div>';
      const r2=state.tab==='分时'
        ?[['成交量',fmtVol(vol)],['成交额',fmtAmt(m.amtTotal)],['换手',m.turnoverRate!=null?m.turnoverRate.toFixed(2)+'%':null],['市盈率',m.pe!=null?m.pe.toFixed(2):null]]
        :[['换手',m.turnoverRate!=null?m.turnoverRate.toFixed(2)+'%':null],['市盈率',m.pe!=null?m.pe.toFixed(2):null],['市净率',m.pb!=null?m.pb.toFixed(2):null],['总市值',m.totalMcap!=null?fmtAmt(m.totalMcap):null]];
      const row2='<div class="stats">'+r2.map(a=>'<span>'+a[0]+' <b>'+(a[1]!=null?a[1]:'—')+'</b></span>').join('')+'</div>';
      const tabs='<div class="tabs">'+TABS.map(t=>'<button data-tab="'+t+'" class="'+(t===state.tab?'on':'')+'">'+t+'</button>').join('')+'</div>';
      const body=state.tab==='分时'?chartSVG(m):klineSVG(state.tab);
      app.innerHTML=head+row1+row2+tabs+body;
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
          if(p&&!state.klines[p]) api.postMessage({type:'needKline',period:p});
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
    const W=L.width,H=L.totalH;
    const gridH=L.yTicks.map(t=>'<line class="grid" x1="0" y1="'+t.y+'" x2="'+(W-AXIS_R)+'" y2="'+t.y+'"></line>').join('');
    const gridV=L.xTicks.map(t=>'<line class="grid" x1="'+t.x+'" y1="0" x2="'+t.x+'" y2="'+H+'"></line>').join('');
    const yLab=L.yTicks.map(t=>'<text x="'+(W-AXIS_R+4)+'" y="'+(t.y+3)+'" dominant-baseline="hanging">'+t.label+'</text>').join('');
    const xLab=L.xTicks.map(t=>'<text x="'+t.x+'" y="'+(H-3)+'" text-anchor="middle">'+t.label+'</text>').join('');
    const bars=L.bars.map(b=>'<rect class="v '+b.cls+'" x="'+b.x.toFixed(1)+'" y="'+b.y.toFixed(1)+'" width="'+b.w.toFixed(2)+'" height="'+b.h.toFixed(1)+'"></rect>').join('');
    const pxCls=cls(L.lastPrice,m.prevClose);
    const avgEl=L.avgLine?('<polyline class="avg" points="'+L.avgLine+'"></polyline>'):'';
    const lastPt=L.pts[L.pts.length-1];
    return '<div class="chart-wrap"><div class="tip" id="tip"></div>'+
      '<svg class="chart" id="chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'+
      gridV+gridH+yLab+
      '<g id="vol">'+bars+'</g>'+
      '<line class="base" x1="0" y1="'+L.baseY+'" x2="'+(W-AXIS_R)+'" y2="'+L.baseY+'"></line>'+
      '<text x="0" y="'+(L.baseY-4)+'">昨收 '+m.prevClose.toFixed(2)+'</text>'+
      '<polyline class="price '+pxCls+'" points="'+L.priceLine+'"></polyline>'+
      '<circle class="end '+pxCls+'" cx="'+lastPt.x.toFixed(1)+'" cy="'+lastPt.y.toFixed(1)+'" r="3"></circle>'+
      avgEl+
      '<g class="cross" id="cross" style="display:none"><line id="cx" y1="0" y2="'+H+'"></line><line id="cy" x1="0" x2="'+(W-AXIS_R)+'"></line><circle id="cp" class="p" r="3.5"></circle><circle id="ca" class="a" r="3"></circle></g>'+
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
      let best=0,dd=Infinity;
      for(let i=0;i<L.pts.length;i++){
        const d=Math.abs(L.pts[i].x-sx);
        if(d<dd){dd=d;best=i;}
      }
      if(best===last)return;
      last=best;
      cancelAnimationFrame(raf);
      raf=requestAnimationFrame(()=>show(best));
    });
    svg.addEventListener('mouseleave',()=>{ last=-1; cross.style.display='none'; tip.style.display='none'; });
  }
  function klineSVG(tab){
    const K=state.klines[periodFor(tab)];
    if(!K) return '<div class="msg">加载K线…</div>';
    if(K.error) return '<div class="msg">'+K.error+'</div>';
    const W=K.width,H=K.totalH,plotW=W-K.volH;
    const gridH=K.yTicks.map(t=>'<line class="grid" x1="0" y1="'+t.y+'" x2="'+plotW+'" y2="'+t.y+'"></line>').join('');
    const yLab=K.yTicks.map(t=>'<text x="'+(plotW+4)+'" y="'+(t.y+3)+'" dominant-baseline="hanging">'+t.label+'</text>').join('');
    const xLab=K.xTicks.map(t=>'<text x="'+t.x+'" y="'+(H-3)+'" text-anchor="middle">'+t.label+'</text>').join('');
    const candles=K.candles.map(c=>{
      const wick='<line x1="'+(c.x+c.w/2)+'" y1="'+c.wickY1+'" x2="'+(c.x+c.w/2)+'" y2="'+c.wickY2+'" class="'+c.cls+'"></line>';
      return '<g class="candle">'+wick+'<rect x="'+c.x+'" y="'+c.bodyY+'" width="'+c.w+'" height="'+Math.max(c.bodyH,1)+'" class="'+c.cls+'" rx="0"></rect></g>';
    }).join('');
    const volBars=K.volBars.map(b=>'<rect class="v '+b.cls+'" x="'+b.x.toFixed(1)+'" y="'+b.y.toFixed(1)+'" width="'+b.w.toFixed(2)+'" height="'+b.h.toFixed(1)+'"></rect>').join('');
    return '<div class="chart-wrap"><div class="tip" id="tip"></div>'+
      '<svg class="chart" id="chart" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none">'+
      gridH+yLab+
      '<g id="candles">'+candles+'</g>'+
      '<g id="vol">'+volBars+'</g>'+
      '<line class="base" x1="0" y1="'+K.mainH+'" x2="'+plotW+'" y2="'+K.mainH+'"></line>'+
      '<g class="cross" id="cross" style="display:none"><line id="cx" y1="0" y2="'+H+'"></line><line id="cy" x1="0" x2="'+plotW+'"></line></g>'+
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
      tip.style.display='block';
      tip.innerHTML=
        '<div class="row"><span>'+c.date+'</span></div>'+
        '<div class="row"><span>开</span><b>'+c.open.toFixed(2)+'</b></div>'+
        '<div class="row"><span>收</span><b class="'+c.cls+'">'+c.close.toFixed(2)+'</b></div>'+
        '<div class="row"><span>高</span><b>'+c.high.toFixed(2)+'</b></div>'+
        '<div class="row"><span>低</span><b>'+c.low.toFixed(2)+'</b></div>'+
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
      let best=0,dd=Infinity;
      for(let i=0;i<K.candles.length;i++){
        const ccx=K.candles[i].x+K.candles[i].w/2;
        const d=Math.abs(ccx-sx);
        if(d<dd){dd=d;best=i;}
      }
      if(best===last)return;
      last=best;
      cancelAnimationFrame(raf);
      raf=requestAnimationFrame(()=>show(best));
    });
    svg.addEventListener('mouseleave',()=>{ last=-1; cross.style.display='none'; tip.style.display='none'; });
  }
})();
</script>
</body>
</html>`;
  }
}
