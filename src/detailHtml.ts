import { getNonce } from './util';
import {
  buildChartScale,
  layoutKlineView,
  layoutMinuteView,
  panKlineView,
  zoomKlineView,
} from './chartView';

/**
 * 图表几何函数内联进 webview 执行：同一份实现既被 bun test 覆盖，
 * 又给 webview 用来算坐标，避免 host/webview 各养一套导致漂移。
 * 代价是这些函数必须自包含（见 chartView.ts 顶部说明）。
 */
const INLINE_VIEW = [
  buildChartScale,
  layoutMinuteView,
  layoutKlineView,
  panKlineView,
  zoomKlineView,
].map(String).join('\n');

/**
 * 详情面板的完整 HTML。
 * 样式与脚本内联，CSP 只放行本次 nonce；与面板状态逻辑分离，避免主文件被模板淹没。
 */
export function renderDetailHtml(): string {
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
.head .px .sig{margin-right:4px;vertical-align:2px}
.sig{width:16px;height:16px;display:inline-block}
.rocket{animation:rocket-bob .9s ease-in-out infinite alternate}
.rocket.down{animation-name:rocket-bob-down}
@keyframes rocket-bob{from{transform:translateY(-1.5px)}to{transform:translateY(1.5px)}}
@keyframes rocket-bob-down{from{transform:rotate(180deg) translateY(-1.5px)}to{transform:rotate(180deg) translateY(1.5px)}}
body.boss .rocket,body.boss .rocket.down{animation:none}
.head .chg{font-size:12px;font-variant-numeric:tabular-nums;text-align:right;line-height:1.3;min-width:56px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:3px 8px;padding:0 12px;font-size:11px;color:var(--vscode-descriptionForeground)}
.stats + .stats{margin-top:2px}
.stats span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stats b{color:var(--vscode-foreground);font-weight:600;font-variant-numeric:tabular-nums}
/* 第三行是补充信息的紧凑小字：始终占位，避免不同标的之间高度跳动 */
.stats3{padding:2px 12px 0;font-size:10px;line-height:13px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:14px}
.stats3 b{color:var(--vscode-foreground);font-weight:600;font-variant-numeric:tabular-nums}
.stats3 i{font-style:normal;opacity:.5;margin:0 5px}
.chart-wrap{position:relative;margin:0 6px;height:clamp(200px,45vh,440px)}
.chart{display:block;width:100%;height:100%;cursor:crosshair}
.chart-wrap.dragging .chart{cursor:grabbing}
.chart-wrap.dragging .tip{display:none!important}
.chart line.grid{stroke:var(--vscode-editorWidget-border);stroke-width:1;opacity:.6;vector-effect:non-scaling-stroke}
.chart line.base{stroke:var(--vscode-descriptionForeground);stroke-width:1.5;stroke-dasharray:4 3;opacity:.75;vector-effect:non-scaling-stroke}
.chart line.lim{stroke-width:1;stroke-dasharray:2 3;vector-effect:non-scaling-stroke;opacity:.55}
.chart line.limUp{stroke:var(--up)}
.chart line.limDown{stroke:var(--down)}
.chart text.limUp{fill:var(--up);opacity:.85}
.chart text.limDown{fill:var(--down);opacity:.85}
.chart text.avgEnd{fill:var(--avg);font-size:10px}
.chart polyline.avg{fill:none;stroke:var(--avg);stroke-width:1.4;vector-effect:non-scaling-stroke}
.chart polyline.ma{fill:none;stroke-width:1.1;vector-effect:non-scaling-stroke}
.chart polyline.ma5{stroke:var(--vscode-foreground);opacity:.9}
.chart polyline.ma10{stroke:#e5c07b}
.chart polyline.ma20{stroke:#c678dd}
.chart polyline.volma{fill:none;stroke:var(--vscode-descriptionForeground);stroke-width:1;stroke-dasharray:3 2;opacity:.7;vector-effect:non-scaling-stroke}
.malegend{position:absolute;top:3px;left:8px;display:flex;flex-wrap:wrap;gap:2px 10px;z-index:3;font-size:11px;color:var(--vscode-descriptionForeground);user-select:none;pointer-events:none}
.malegend span{pointer-events:auto;cursor:pointer;display:inline-flex;align-items:center;gap:4px;line-height:15px}
.malegend span:hover{color:var(--vscode-foreground)}
.malegend span.off{opacity:.35}
.malegend b{color:var(--vscode-foreground);font-weight:600;font-variant-numeric:tabular-nums}
.malegend .sw{width:10px;height:2px;border-radius:1px;display:inline-block;flex:none}
.malegend .sw.lg5{background:var(--vscode-foreground)}
.malegend .sw.lg10{background:#e5c07b}
.malegend .sw.lg20{background:#c678dd}
.malegend .sw.lgv{background:var(--vscode-descriptionForeground)}
.chart line.lastprice{stroke:var(--vscode-descriptionForeground);stroke-width:1;stroke-dasharray:4 3;opacity:.8;vector-effect:non-scaling-stroke}
@media (prefers-color-scheme: light){.chart polyline.ma10{stroke:#b8860b}.chart polyline.ma20{stroke:#7c3aed}.malegend .sw.lg10{background:#b8860b}.malegend .sw.lg20{background:#7c3aed}}
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
.chart.pannable{cursor:grab}
.chart-wrap.dragging .chart{cursor:grabbing}
.kctrl{position:absolute;right:8px;bottom:16px;z-index:4;display:flex;gap:2px;align-items:center}
.kbtn{width:20px;height:18px;display:flex;align-items:center;justify-content:center;padding:0;font-size:12px;line-height:1;font-family:inherit;color:var(--vscode-descriptionForeground);background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWidget-border);border-radius:3px;cursor:pointer;opacity:.7}
.kbtn:hover{opacity:1;color:var(--vscode-foreground);background:var(--vscode-list-hoverBackground)}
.kbtn.reset{width:auto;padding:0 6px;font-size:11px}
.kbtn[disabled]{opacity:.35;cursor:default;background:transparent}
.kbtn[disabled]:hover{color:var(--vscode-descriptionForeground);background:transparent}
.khint{position:absolute;left:8px;bottom:16px;z-index:4;max-width:calc(100% - 120px);font-size:11px;line-height:17px;padding:0 6px;border-radius:3px;color:var(--vscode-descriptionForeground);background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWidget-border);pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;animation:khintfade 6s ease forwards}
@keyframes khintfade{0%{opacity:0}8%{opacity:.95}75%{opacity:.95}100%{opacity:0;visibility:hidden}}
@media (prefers-reduced-motion:reduce){.khint{animation:none;opacity:.9}}
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
.related{margin:8px 12px 0;border-top:1px solid var(--vscode-editorWidget-border);padding-top:6px}
.related h4{font-size:11px;color:var(--vscode-descriptionForeground);margin:0 0 4px;font-weight:600;letter-spacing:.3px}
.relist{max-height:220px;overflow-y:auto}
.relmsg{padding:8px 0;color:var(--vscode-descriptionForeground);font-size:12px}
.ritem{display:flex;gap:6px;align-items:baseline;padding:4px 2px;cursor:pointer;border-radius:3px}
.ritem:hover{background:var(--vscode-list-hoverBackground)}
.ritem .t{font-size:11px;color:var(--vscode-descriptionForeground);font-variant-numeric:tabular-nums;white-space:nowrap;flex:none;width:38px;text-align:right}
.ritem .tag{font-size:10px;padding:0 4px;border-radius:3px;line-height:14px;white-space:nowrap;flex:none}
.ritem .tag.ann{color:#b07d1f;background:rgba(216,163,58,.16)}
.ritem .tag.news{color:#4a9eff;background:rgba(74,158,255,.16)}
.ritem .ti{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:text}
.ritem:hover .ti{text-decoration:underline}
</style>
</head>
<body>
<div id="app"><div class="msg">加载中…</div></div>
<script nonce="${nonce}">
(function(){
${INLINE_VIEW}
  const app=document.getElementById('app');
  const api=acquireVsCodeApi();
  app.addEventListener('click',e=>{
    const el=(e.target instanceof HTMLElement)?e.target.closest('.ritem'):null;
    if(el&&el.dataset.url) api.postMessage({type:'openUrl',url:el.dataset.url});
  });
  const fmtVol=function(v){ if(v>=10000) return (v/10000).toFixed(2)+'万手'; return Math.round(v)+'手'; };
  const fmtAmt=function(v){ if(v>=1e12) return (v/1e12).toFixed(2)+'万亿'; if(v>=1e8) return (v/1e8).toFixed(2)+'亿'; if(v>=1e4) return (v/1e4).toFixed(2)+'万'; return Math.round(v); };
  const cls=function(p,c){ return p>c?'up':p<c?'down':'flat'; };
  const sign=function(n){ return n>=0?'+':''; };
  // 价格小数位：基金类（沪5xx/深1xx，最小变动0.001元）3 位，股票/指数 2 位
  let pd=2;
  const pf=function(v){ return v.toFixed(pd); };
  const pct=function(v){ return v==null?'—':v.toFixed(2)+'%'; };
  const esc=function(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));};
  const hm=function(t){ return t.slice(0,2)+':'+t.slice(2); };
  const TABS=['分时','日K','周K','月K'];
  /** K 线缩放下限（可见根数），再小则蜡烛过宽失去意义 */
  const KLINE_MIN_POINTS=10;
  /** 每格滚轮/每次点按钮的缩放比例 */
  const KLINE_ZOOM_STEP=1.25;
  let last=null;
  let sym=null;
  let lastTab=null;
  let lastChartKey=null;
  let cur=null;
  let lastW=0,lastH=0;
  // 拖动平移状态：bar 是拖动开始时锁定的周期，cw 是当时的槽宽
  let drag=null;
  // 图表重绘合并到一帧：拖动的 pointermove、触控板的 wheel 都比屏幕刷新密
  let drawRaf=0;
  function scheduleDraw(){
    if(drawRaf)return;
    drawRaf=requestAnimationFrame(()=>{ drawRaf=0; if(last)drawChart(last); });
  }
  // 操作提示只露一次：滚轮/拖动/按钮任一交互后不再出现
  let hintSeen=false;
  let state={tab:'分时',klines:{},klinesTs:{},klinesPending:{},kviews:{},maHide:{},news:null,newsError:null};
  const KLINE_TTL_MS=60000;
  function requestKline(p){
    if(state.klinesPending[p])return;
    state.klinesPending[p]=true;
    api.postMessage({type:'needKline',period:p,force:true});
  }
  function needFetch(p){
    return !state.klines[p]||(state.klinesTs[p]!=null&&Date.now()-state.klinesTs[p]>KLINE_TTL_MS);
  }
  // 当前 K 线 tab 无数据或已过期即补取；上次失败的周期不自动重试，切 tab 可手动重试
  function maybeRefreshKline(){
    const p=periodFor(state.tab);
    if(!p||state.klinesPending[p])return;
    const k=state.klines[p];
    if(k&&k.error)return;
    if(needFetch(p))requestKline(p);
  }
  api.postMessage({type:'ready'});
  window.addEventListener('message',e=>{
    const m=e.data;
    if(!m)return;
    if(m.type==='data'){
      if(m.digits)pd=m.digits;
      else if(m.code) pd=(/^[51]/.test(m.code)&&m.price!=null&&m.price<=10)?3:2;
      if(m.symbol!==sym){
        sym=m.symbol; lastTab=null; lastChartKey=null;
        state={tab:'分时',klines:{},klinesTs:{},klinesPending:{},kviews:{},maHide:{},news:null,newsError:null};
      }
      if(m.klineSeries){
        // 仅 webview 就绪首帧会带缓存数据；无时间戳故标记过期，交由 maybeRefreshKline 刷新
        state.klines=m.klineSeries;
        for(const k in state.klines)state.klinesTs[k]=0;
      }
      last=m;
      render(m);
      maybeRefreshKline();
    } else if(m.type==='kline'){
      state.klinesPending[m.period]=false;
      if(m.error){
        // 定时刷新失败时保留旧图继续展示，仅顺延下轮刷新时间
        if(!state.klines[m.period]||state.klines[m.period].error)state.klines[m.period]={error:m.error};
        else state.klinesTs[m.period]=Date.now();
      }
      else { state.klines[m.period]=m.series; state.klinesTs[m.period]=Date.now(); }
      render(last);
    } else if(m.type==='news'){
      state.news = m.items && m.items.length ? m.items : [];
      state.newsError = m.error || null;
      if(last) render(last);
    }
  });
  const SIG={
    rocketUp:'<svg class="sig rocket" viewBox="0 0 16 16">'
      +'<path d="M8 .5 10.3 4H5.7Z" fill="currentColor"/>'
      +'<rect x="4.8" y="3.6" width="6.4" height="6.2" rx="1.6" fill="currentColor"/>'
      +'<circle cx="8" cy="5.9" r="1.5" fill="#12131a"/>'
      +'<path d="M4.9 8.7 2.3 12.2H5.9Z" fill="currentColor"/>'
      +'<path d="M11.1 8.7 13.7 12.2H10.1Z" fill="currentColor"/>'
      +'<path d="M7 9.5 8 13.6 9 9.5Z" fill="#f4b400"/>'
      +'<path d="M7.5 9.8 8 12.2 8.5 9.8Z" fill="#ffd54f"/></svg>',
    rocketDown:'<svg class="sig rocket down" viewBox="0 0 16 16">'
      +'<path d="M8 .5 10.3 4H5.7Z" fill="currentColor"/>'
      +'<rect x="4.8" y="3.6" width="6.4" height="6.2" rx="1.6" fill="currentColor"/>'
      +'<circle cx="8" cy="5.9" r="1.5" fill="#12131a"/>'
      +'<path d="M4.9 8.7 2.3 12.2H5.9Z" fill="currentColor"/>'
      +'<path d="M11.1 8.7 13.7 12.2H10.1Z" fill="currentColor"/>'
      +'<path d="M7 9.5 8 13.6 9 9.5Z" fill="#f4b400"/>'
      +'<path d="M7.5 9.8 8 12.2 8.5 9.8Z" fill="#ffd54f"/></svg>',
    bolt:'<svg class="sig" viewBox="0 0 16 16"><path d="M9 1 3 9h4l-1 6 7-8H9Z" fill="currentColor"/></svg>',
    triUp:'<svg class="sig" viewBox="0 0 16 16"><path d="M8 1.5 15 14.5H1Z" fill="currentColor" stroke-linejoin="round"/></svg>',
    triDown:'<svg class="sig" viewBox="0 0 16 16"><path d="M8 14.5 15 1.5H1Z" fill="currentColor" stroke-linejoin="round"/></svg>',
    diagUp:'<svg class="sig" viewBox="0 0 16 16"><path d="M2.5 13.5 12 4M7 4h5v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    diagDown:'<svg class="sig" viewBox="0 0 16 16"><path d="M2.5 2.5 12 12M7 12h5V7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    flat:'<svg class="sig" viewBox="0 0 16 16"><rect x="2" y="7" width="12" height="2.2" rx="1.1" fill="currentColor"/></svg>'
  };
  const sig=function(m){
    const tick=pd===3?0.001:0.01;
    if(m.price!=null&&m.limitUp!=null&&m.price>=m.limitUp-tick) return SIG.rocketUp;
    if(m.price!=null&&m.limitDown!=null&&m.price<=m.limitDown+tick) return SIG.rocketDown;
    const a=Math.abs(m.changePct||0);
    if(a>=5) return SIG.bolt;
    if(a>=2) return m.changePct>0?SIG.triUp:SIG.triDown;
    if(a>0) return m.changePct>0?SIG.diagUp:SIG.diagDown;
    return SIG.flat;
  };
  const headInner=function(m,pxCls,price,change,changePct){
    return '<span class="nm">'+esc(m.name)+'</span><span class="cd">'+esc(m.code)+'</span>'+
      '<span class="px '+pxCls+'">'+sig(m)+' '+pf(price)+'</span>'+
      '<span class="chg '+pxCls+'">'+sign(change)+pf(change)+'&nbsp; '+sign(changePct)+changePct.toFixed(2)+'%</span>';
  };
  const row1Inner=function(m,prevClose){
    return '<span>今开 <b>'+(m.open!=null?pf(m.open):'—')+'</b></span>'+
      '<span>最高 <b>'+(m.high!=null?pf(m.high):'—')+'</b></span>'+
      '<span>最低 <b>'+(m.low!=null?pf(m.low):'—')+'</b></span>'+
      '<span>昨收 <b>'+pf(prevClose)+'</b></span>';
  };
  // 固定四槽：缺字段补「—」，切换 tab 与不同标的都不再让统计区高度跳动
  const row2Inner=function(m,vol){
    const r=state.tab==='分时'
      ?[['成交量',fmtVol(vol)],['成交额',fmtAmt(m.amtTotal)],['换手',pct(m.turnoverRate)],['振幅',pct(m.amplitude)]]
      :[['成交量',fmtVol(vol)],['成交额',fmtAmt(m.amtTotal)],['换手',pct(m.turnoverRate)],['市盈',m.pe!=null?m.pe.toFixed(2):'—']];
    return r.map(a=>'<span>'+a[0]+' <b>'+a[1]+'</b></span>').join('');
  };
  // 第三行：低频但不删的信息压成一行小字，缺字段整项跳过
  const row3Inner=function(m){
    const r=[];
    if(state.tab==='分时'&&m.avgPrice!=null)r.push(['均价',pf(m.avgPrice)]);
    if(m.volRatio!=null)r.push(['量比',m.volRatio.toFixed(2)]);
    if(m.circMcap!=null)r.push(['流通市值',fmtAmt(m.circMcap)]);
    if(m.totalMcap!=null)r.push(['总市值',fmtAmt(m.totalMcap)]);
    if(m.pb!=null)r.push(['市净',m.pb.toFixed(2)]);
    if(m.limitUp!=null)r.push(['涨停',pf(m.limitUp)]);
    if(m.limitDown!=null)r.push(['跌停',pf(m.limitDown)]);
    return r.map(a=>a[0]+' <b>'+a[1]+'</b>').join('<i>/</i>');
  };
  const formatEventTime=function(ms){
    if(!ms) return '—';
    const d=new Date(ms);
    const now=new Date();
    const p=n=>String(n).padStart(2,'0');
    if(d.toDateString()===now.toDateString()) return p(d.getHours())+':'+p(d.getMinutes());
    return p(d.getMonth()+1)+'-'+p(d.getDate());
  };
  function relatedHtml(m){
    if(m.showNews===false)return '';
    return '<div class="related" id="related"><h4>相关资讯</h4>'+newsInner(state.news,state.newsError)+'</div>';
  }
  const newsInner=function(items,err){
    if(err) return '<div class="relmsg">'+esc(err)+'</div>';
    if(!items||!items.length) return '<div class="relmsg">暂无相关资讯</div>';
    return items.map(it=>{
      const cls2=it.kind==='公告'?'ann':'news';
      return '<div class="ritem" data-url="'+esc(it.url)+'">'
        +'<span class="t">'+formatEventTime(it.time)+'</span>'
        +'<span class="tag '+cls2+'">'+esc(it.kind)+'</span>'
        +'<span class="ti">'+esc(it.title)+'</span>'
        +'</div>';
    }).join('');
  };
  function updateText(m){
    const price=m.price==null?0:m.price;
    const prevClose=m.prevClose==null?0:m.prevClose;
    const change=m.change==null?0:m.change;
    const changePct=m.changePct==null?0:m.changePct;
    const pxCls=cls(price,prevClose);
    const head=document.getElementById('head');
    if(head) head.innerHTML=headInner(m,pxCls,price,change,changePct);
    const row1=document.getElementById('row1');
    if(row1) row1.innerHTML=row1Inner(m,prevClose);
    const row2=document.getElementById('row2');
    if(row2) row2.innerHTML=row2Inner(m,m.volTotal);
    const row3=document.getElementById('row3');
    if(row3) row3.innerHTML=row3Inner(m);
    const rel=document.getElementById('related');
    if(rel) rel.innerHTML='<h4>相关资讯</h4>'+newsInner(state.news,state.newsError);
  }
  function periodFor(tab){
    if(tab==='日K')return 'day';
    if(tab==='周K')return 'week';
    if(tab==='月K')return 'month';
    return null;
  }
  function render(m){
    try {
      document.body.classList.toggle('boss',!!m.boss);
      if(m.error){ app.innerHTML='<div class="msg">'+m.error+'</div>'; lastTab=null; lastChartKey=null; return; }
      const price=m.price==null?0:m.price;
      const prevClose=m.prevClose==null?0:m.prevClose;
      const change=m.change==null?0:m.change;
      const changePct=m.changePct==null?0:m.changePct;
      const pxCls=cls(price,prevClose);
      // 以内容指纹（而非对象引用，postMessage 每次都是新对象）判断图是否需重绘：
      // 分时取 host 下发的 layoutFp，K 线取数据到达时间戳 + 当前视窗；资讯开关一并入 key。
      const newsKey=m.showNews===false?'n0|':'n1|';
      const p=periodFor(state.tab);
      const kview=p&&state.kviews[p]?state.kviews[p].start+','+state.kviews[p].count:'';
      const chartKey=newsKey+(state.tab==='分时'
        ?'m|'+(m.layoutFp||'')+'|'+(m.chartError||'')
        :'k|'+(state.klinesTs[p]||0)+'|'+kview);
      const sameTab=state.tab===lastTab;
      const sameChart=chartKey===lastChartKey;
      lastTab=state.tab;
      lastChartKey=chartKey;
      // 图表区单独填充：容器还空着（webview 刚可见、面板曾隐藏）时不能走轻量更新
      const wrap=document.getElementById('cwrap');
      const chartPending=!wrap||!wrap.firstChild;
      if(sameTab&&sameChart&&!chartPending&&document.getElementById('head')){
        updateText(m);
        return;
      }
      const head='<div class="head" id="head">'+headInner(m,pxCls,price,change,changePct)+'</div>';
      const row1='<div class="stats" id="row1">'+row1Inner(m,prevClose)+'</div>';
      const row2='<div class="stats" id="row2">'+row2Inner(m,m.volTotal)+'</div>';
      const row3='<div class="stats3" id="row3">'+row3Inner(m)+'</div>';
      const tabs='<div class="tabs">'+TABS.map(t=>'<button data-tab="'+t+'" class="'+(t===state.tab?'on':'')+'">'+t+'</button>').join('')+'</div>';
      app.innerHTML=head+row1+row2+row3+tabs+'<div class="chart-wrap" id="cwrap"></div>'+relatedHtml(m);
      bindTabs();
      bindZoomOnce();
      drawChart(m);
    } catch (e) {
      app.innerHTML='<div class="msg">渲染失败: '+(e&&e.message?e.message:String(e))+'</div>';
      console.error('AStockDetail render error', e);
    }
  }
  function bindTabs(){
    app.querySelectorAll('.tabs button').forEach(btn=>{
      btn.addEventListener('click',()=>{
        state.tab=btn.dataset.tab;
        lastChartKey=null;
        if(state.tab!=='分时'){
          const p=periodFor(state.tab);
          if(p&&needFetch(p))requestKline(p);
        }
        render(last);
      });
    });
  }
  // 刻度/读数随容器尺寸即时重算：面板拉宽拉高后图跟着变，字号不随缩放失真
  function drawChart(m){
    const wrap=document.getElementById('cwrap');
    if(!wrap)return;
    const w=Math.round(wrap.clientWidth), h=Math.round(wrap.clientHeight);
    cur=null;
    lastW=w; lastH=h;
    if(w<80||h<80)return;
    if(state.tab==='分时'){
      const series=m.minuteSeries||[];
      const g=series.length<2?null:layoutMinuteView(series,m.prevClose||0,{limitUp:m.limitUp,limitDown:m.limitDown},pd,w,h);
      if(!g){ wrap.innerHTML='<div class="msg">'+esc(m.chartError||'暂无分时数据')+'</div>'; return; }
      wrap.innerHTML=minuteSVG(g,m);
      cur={kind:'minute',g:g};
      bindMinute(g,m);
      return;
    }
    const p=periodFor(state.tab);
    const K=state.klines[p];
    if(!K){ wrap.innerHTML='<div class="msg">加载K线…</div>'; return; }
    if(K.error){ wrap.innerHTML='<div class="msg">'+esc(K.error)+'</div>'; return; }
    const g=layoutKlineView(K,viewFor(p,K),w,h,pd);
    if(!g){ wrap.innerHTML='<div class="msg">暂无K线数据</div>'; return; }
    wrap.innerHTML=klineSVG(g,p);
    cur={kind:'kline',g:g};
    bindKline(g);
    // 提示淡出后就不再重建，否则每次数据刷新都会重新出现
    if(document.getElementById('khint')){
      setTimeout(()=>hideHint(),7000);
    }
  }
  // 默认可见根数跟着绘图区宽度走：每根约 6px，窄侧栏不至于挤成一团，宽面板也不空
  function defaultViewCount(total){
    const w=lastW>0?lastW:600;
    const min=Math.min(KLINE_MIN_POINTS,total);
    return Math.max(min,Math.min(total,Math.round((w-52)/6)));
  }
  function viewFor(p,K){
    const total=K.points.length;
    const dft=defaultViewCount(total);
    const v=state.kviews[p];
    if(!v)return {start:total-dft,count:dft};
    const min=Math.min(KLINE_MIN_POINTS,total);
    const count=Math.max(min,Math.min(Math.round(v.count),total));
    // start 允许小数，交给布局用小数部分补位移
    return {start:Math.max(0,Math.min(v.start,total-count)),count:count};
  }
  function isZoomed(p,K){
    if(!K||!K.points)return false;
    const v=viewFor(p,K);
    const dft=defaultViewCount(K.points.length);
    return v.count!==dft||Math.abs(v.start-(K.points.length-dft))>0.01;
  }
  function resetZoom(p){
    delete state.kviews[p];
    lastChartKey=null;
    drawChart(last);
  }
  /** 提示只露一次，之后不再出现 */
  function hideHint(){
    hintSeen=true;
    const el=document.getElementById('khint');
    if(el)el.remove();
  }
  /**
   * 缩放：factor<1 放大、>1 缩小；anchorPx 是相对绘图区左边界的像素，
   * 交给 zoomKlineView 钉住光标下的那根 K 线。几何全在 webview 算，不惊动 host。
   */
  function zoomBy(factor,anchorPx){
    const c=currentKline();
    if(!c||!cur||cur.kind!=='kline')return false;
    const g=cur.g;
    const v=viewFor(c.p,c.K);
    const total=c.K.points.length;
    const min=Math.min(KLINE_MIN_POINTS,total);
    const next=Math.max(min,Math.min(total,Math.round(v.count*factor)));
    if(next===v.count)return false;
    // 根数很少时绘图区左边会留白，光标落在留白上就锚在第一根上
    const left=g.candles.length?g.candles[0].x-(g.cw-g.candles[0].w)/2-g.padL:0;
    const px=Math.max(left,Math.min(g.plotW,anchorPx));
    state.kviews[c.p]=zoomKlineView(v,total,next,px,g.plotW);
    lastChartKey=null;
    hideHint();
    // 合并到下一帧：触控板一次手势会连发几十个 wheel，逐个重绘纯属浪费
    scheduleDraw();
    return true;
  }
  // 点工具栏时锚在绘图区中央，缩放后内容不会整体歪向一边
  function zoomCenter(factor){
    const g=cur&&cur.kind==='kline'?cur.g:null;
    zoomBy(factor,g?g.plotW/2:0);
  }
  // 缩放事件只绑一次：drawChart 会重建 wrap 内容，重复绑定会让一次滚轮触发多级缩放
  function bindZoomOnce(){
    const wrap=document.getElementById('cwrap');
    if(!wrap||wrap.dataset.bound)return;
    wrap.dataset.bound='1';
    wrap.addEventListener('wheel',ev=>{
      if(!cur||cur.kind!=='kline')return;
      const factor=ev.deltaY<0?1/KLINE_ZOOM_STEP:KLINE_ZOOM_STEP;
      // 视口坐标换算成几何坐标（viewBox 与 CSS 尺寸不一定相等），再减去左侧留白
      const r=document.getElementById('chart').getBoundingClientRect();
      const sx=r.width>0?(ev.clientX-r.left)/r.width*cur.g.width:0;
      // 到边界不再拦截，把滚轮交还页面，避免卡住面板滚动
      if(zoomBy(factor,sx-cur.g.padL))ev.preventDefault();
    },{passive:false});
    wrap.addEventListener('dblclick',ev=>{
      // 工具条与图例上的连点不是「复位」手势
      if(ev.target instanceof Element&&ev.target.closest('.kctrl, .malegend'))return;
      const c=currentKline();
      if(c&&isZoomed(c.p,c.K))resetZoom(c.p);
    });
    wrap.addEventListener('click',ev=>{
      const t=ev.target instanceof Element?ev.target.closest('[data-kz]'):null;
      if(!t)return;
      const c=currentKline();
      if(!c)return;
      const act=t.getAttribute('data-kz');
      if(act==='reset'){ if(isZoomed(c.p,c.K))resetZoom(c.p); return; }
      zoomCenter(act==='in'?1/KLINE_ZOOM_STEP:KLINE_ZOOM_STEP);
    });
    // 拖动平移：只改视窗起点，y 轴范围随窗口重算，不发消息也不拉数据
    wrap.addEventListener('pointerdown',ev=>{
      if(ev.button!==0)return;
      const target=ev.target instanceof Element?ev.target:null;
      // 图例与缩放工具条有自己的点击语义，不参与拖动
      if(target&&(target.closest('.malegend')||target.closest('.kctrl')))return;
      const c=currentKline();
      if(!c||!cur||cur.kind!=='kline'||cur.g.cw<=0)return;
      const v=viewFor(c.p,c.K);
      // 全量已可见时没有可平移的余量
      if(v.count>=c.K.points.length)return;
      drag={id:ev.pointerId,x:ev.clientX,bar:c.p,v:v,cw:cur.g.cw};
      wrap.classList.add('dragging');
      try{wrap.setPointerCapture(ev.pointerId);}catch(err){}
      hideCross();
      hideHint();
    });
    wrap.addEventListener('pointermove',ev=>{
      if(!drag||ev.pointerId!==drag.id)return;
      const c=currentKline();
      if(!c||c.p!==drag.bar)return;
      // 鼠标右移看更早的 K 线：起点随位移反向移动。始终以拖动起点换算，
      // 到边界后继续拖不会累积，反向拖动立刻跟手。
      const delta=Math.round((drag.x-ev.clientX)/drag.cw);
      const next=panKlineView(drag.v,c.K.points.length,delta);
      const v=viewFor(c.p,c.K);
      if(v.start===next.start&&v.count===next.count)return;
      state.kviews[c.p]=next;
      lastChartKey=null;
      // 一帧最多重绘一次：拖动时 pointermove 比屏幕刷新密得多
      scheduleDraw();
    });
    const stopDrag=ev=>{
      if(!drag||(ev&&ev.pointerId!==drag.id))return;
      drag=null;
      wrap.classList.remove('dragging');
    };
    wrap.addEventListener('pointerup',stopDrag);
    wrap.addEventListener('pointercancel',stopDrag);
  }
  function currentKline(){
    const p=periodFor(state.tab);
    const K=p?state.klines[p]:null;
    return K&&K.points?{p:p,K:K}:null;
  }
  function hideCross(){
    const cross=document.getElementById('cross');
    if(cross)cross.style.display='none';
    const tip=document.getElementById('tip');
    if(tip)tip.style.display='none';
  }
  function placeTip(tip,wrap,ev){
    const r=wrap.getBoundingClientRect();
    const tw=tip.offsetWidth,th=tip.offsetHeight;
    let lx=ev.clientX-r.left+14;
    if(lx+tw>r.width-4)lx=ev.clientX-r.left-tw-14;
    if(lx<4)lx=4;
    let ty=ev.clientY-r.top-th-12;
    if(ty<4)ty=ev.clientY-r.top+16;
    if(ty+th>r.height-4)ty=Math.max(4,r.height-th-4);
    tip.style.left=lx+'px';
    tip.style.top=ty+'px';
  }
  function minuteSVG(g,m){
    const plotR=g.padL+g.plotW;
    const gridH=g.yTicks.map(t=>'<line class="grid" x1="0" y1="'+t.y+'" x2="'+plotR+'" y2="'+t.y+'"></line>').join('');
    const gridV=g.xTicks.map(t=>'<line class="grid" x1="'+t.x+'" y1="0" x2="'+t.x+'" y2="'+g.volBottom+'"></line>').join('');
    const yLab=g.yTicks.map(t=>'<text x="'+(plotR+4)+'" y="'+(t.y+3)+'" dominant-baseline="hanging">'+t.label+'</text>').join('');
    const xLab=g.xTicks.map(t=>'<text x="'+t.x+'" y="'+(g.volBottom+11)+'" text-anchor="middle">'+t.label+'</text>').join('');
    const bars=g.bars.map(b=>'<rect class="v '+b.cls+'" x="'+b.x.toFixed(1)+'" y="'+b.y.toFixed(1)+'" width="'+b.w.toFixed(2)+'" height="'+b.h.toFixed(1)+'"></rect>').join('');
    const pxCls=cls(g.lastPrice,m.prevClose);
    const avgEl=g.avgLine?('<polyline class="avg" points="'+g.avgLine+'"></polyline>'):'';
    const lastPt=g.pts[g.pts.length-1];
    const limitUpEl=g.limitUpY!=null&&m.limitUp!=null?('<line class="lim limUp" x1="0" y1="'+g.limitUpY.toFixed(1)+'" x2="'+plotR+'" y2="'+g.limitUpY.toFixed(1)+'"></line><text class="limUp" x="0" y="'+(g.limitUpY-3).toFixed(1)+'">涨停 '+pf(m.limitUp)+'</text>'):'';
    const limitDownEl=g.limitDownY!=null&&m.limitDown!=null?('<line class="lim limDown" x1="0" y1="'+g.limitDownY.toFixed(1)+'" x2="'+plotR+'" y2="'+g.limitDownY.toFixed(1)+'"></line><text class="limDown" x="0" y="'+(g.limitDownY-3).toFixed(1)+'">跌停 '+pf(m.limitDown)+'</text>'):'';
    const avgEndEl=g.avgLine&&lastPt.ay!=null?('<text class="avgEnd" x="'+plotR+'" y="'+(lastPt.ay-4).toFixed(1)+'" text-anchor="end">均价 '+(g.lastAvg!=null?pf(g.lastAvg):'')+'</text>'):'';
    return '<div class="tip" id="tip"></div>'+
      '<svg class="chart" id="chart" viewBox="0 0 '+g.width+' '+g.height+'" preserveAspectRatio="none">'+
      gridV+gridH+yLab+
      '<g id="vol">'+bars+'</g>'+
      '<line class="base" x1="0" y1="'+g.baseY+'" x2="'+plotR+'" y2="'+g.baseY+'"></line>'+
      '<text x="0" y="'+(g.baseY-4)+'">昨收 '+pf(m.prevClose)+'</text>'+
      limitUpEl+limitDownEl+
      '<polyline class="price '+pxCls+'" points="'+g.priceLine+'"></polyline>'+
      '<circle class="end '+pxCls+'" cx="'+lastPt.x.toFixed(1)+'" cy="'+lastPt.y.toFixed(1)+'" r="3"></circle>'+
      avgEl+avgEndEl+
      '<g class="cross" id="cross" style="display:none"><line id="cx" y1="0" y2="'+g.volBottom+'"></line><line id="cy" x1="0" x2="'+plotR+'"></line><circle id="cp" class="p" r="3.5"></circle><circle id="ca" class="a" r="3"></circle></g>'+
      xLab+
      '</svg>';
  }
  function bindMinute(g,m){
    const wrap=document.getElementById('cwrap');
    const svg=document.getElementById('chart');
    const cross=document.getElementById('cross');
    const cx=document.getElementById('cx');
    const cy=document.getElementById('cy');
    const cp=document.getElementById('cp');
    const ca=document.getElementById('ca');
    const tip=document.getElementById('tip');
    const prevClose=m.prevClose||0;
    const show=function(i,ev){
      const p=g.pts[i];
      if(!p)return;
      cross.style.display='';
      cx.setAttribute('x1',p.x); cx.setAttribute('x2',p.x);
      cy.setAttribute('y1',p.y); cy.setAttribute('y2',p.y);
      cp.setAttribute('cx',p.x); cp.setAttribute('cy',p.y);
      cp.className.baseVal='p '+cls(p.price,prevClose);
      ca.setAttribute('cx',p.x);
      if(p.ay!=null){ ca.setAttribute('cy',p.ay); ca.style.display=''; } else { ca.style.display='none'; }
      const pc=cls(p.price,prevClose);
      tip.style.display='block';
      tip.innerHTML=
        '<div class="row"><span>'+hm(p.time)+'</span><b class="'+pc+'">'+pf(p.price)+'</b></div>'+
        (p.avg!=null?'<div class="row"><span>均价</span><b style="color:var(--avg)">'+pf(p.avg)+'</b></div>':'')+
        '<div class="row"><span>成交量</span><b>'+fmtVol(p.volume)+'</b></div>';
      placeTip(tip,wrap,ev);
    };
    let lastIdx=-1,raf=0;
    svg.addEventListener('mousemove',ev=>{
      const r=svg.getBoundingClientRect();
      const sx=(ev.clientX-r.left)/r.width*g.width;
      let lo=0,hi=g.pts.length-1;
      while(lo<hi){
        const mid=(lo+hi)>>1;
        if(g.pts[mid].x<sx)lo=mid+1;else hi=mid;
      }
      let best=lo;
      if(lo>0&&sx-g.pts[lo-1].x<Math.abs(g.pts[lo].x-sx))best=lo-1;
      if(best===lastIdx)return;
      lastIdx=best;
      cancelAnimationFrame(raf);
      raf=requestAnimationFrame(()=>show(best,ev));
    });
    svg.addEventListener('mouseleave',()=>{ lastIdx=-1; cross.style.display='none'; tip.style.display='none'; });
  }
  function maSuffix(period){
    return period==='week'?'W':period==='month'?'M':'';
  }
  function klineSVG(g,p){
    const suf=maSuffix(p);
    const plotR=g.padL+g.plotW;
    const gridH=g.yTicks.map(t=>'<line class="grid" x1="0" y1="'+t.y+'" x2="'+plotR+'" y2="'+t.y+'"></line>').join('');
    const yLab=g.yTicks.map(t=>'<text x="'+(plotR+4)+'" y="'+(t.y+3)+'" dominant-baseline="hanging">'+t.label+'</text>').join('');
    const xLab=g.xTicks.map(t=>'<text x="'+t.x+'" y="'+(g.volBottom+11)+'" text-anchor="middle">'+t.label+'</text>').join('');
    const candles=g.candles.map(c=>{
      const wick='<line x1="'+(c.x+c.w/2)+'" y1="'+c.wickY1+'" x2="'+(c.x+c.w/2)+'" y2="'+c.wickY2+'" class="'+c.cls+'"></line>';
      return '<g class="candle">'+wick+'<rect x="'+c.x+'" y="'+c.bodyY+'" width="'+c.w+'" height="'+Math.max(c.bodyH,1)+'" class="'+c.cls+'" rx="0"></rect></g>';
    }).join('');
    const volBars=g.volBars.map(b=>'<rect class="v '+b.cls+'" x="'+b.x.toFixed(1)+'" y="'+b.y.toFixed(1)+'" width="'+b.w.toFixed(2)+'" height="'+b.h.toFixed(1)+'"></rect>').join('');
    const maEls=g.maLines.map(ma=>{
      if(!ma.points)return '';
      return '<polyline class="ma ma'+ma.n+'" id="maline-'+ma.n+'" points="'+ma.points+'"'+(state.maHide[String(ma.n)]?' style="display:none"':'')+'></polyline>';
    }).join('');
    const volMaEl=g.volMaLine?('<polyline class="volma" id="maline-vol" points="'+g.volMaLine+'"'+(state.maHide.vol?' style="display:none"':'')+'></polyline>'):'';
    const lastVal=function(vals){return vals[vals.length-1];};
    const legendItems=g.maLines.map(function(ma,i){
      return {k:String(ma.n),label:'MA'+ma.n+suf,v:lastVal(g.maValues[i].vals)};
    });
    legendItems.push({k:'vol',label:'均量5',v:lastVal(g.volMaVals)});
    const legend='<div class="malegend">'+legendItems.map(function(it){
      const txt=it.v==null?'—':(it.k==='vol'?fmtVol(it.v):pf(it.v));
      return '<span data-k="'+it.k+'" class="'+(state.maHide[it.k]?'off':'')+'"><i class="sw lg'+(it.k==='vol'?'v':it.k)+'"></i>'+esc(it.label)+' <b>'+txt+'</b></span>';
    }).join('')+'</div>';
    const lastCandle=g.candles[g.candles.length-1];
    const closeY=lastCandle?(lastCandle.cls==='up'?lastCandle.bodyY:lastCandle.bodyY+lastCandle.bodyH):0;
    const lastPriceEl=lastCandle?('<line class="lastprice" x1="0" y1="'+closeY.toFixed(1)+'" x2="'+plotR+'" y2="'+closeY.toFixed(1)+'"></line><text x="'+plotR+'" y="'+(closeY-3).toFixed(1)+'" text-anchor="end">'+pf(g.lastPrice)+'</text>'):'';
    const zoomed=isZoomed(p,state.klines[p]);
    const total=state.klines[p]?state.klines[p].points.length:g.view.count;
    // 视窗带了小数起点，右端那根会探出绘图区，裁掉以免压住右侧价格刻度
    const clip='<defs><clipPath id="kclip"><rect x="'+g.padL+'" y="0" width="'+g.plotW+'" height="'+g.volBottom+'"></rect></clipPath></defs>';
    const ctrl='<div class="kctrl">'+
      '<button class="kbtn" data-kz="out" title="缩小（滚轮向下）">−</button>'+
      '<button class="kbtn" data-kz="in" title="放大（滚轮向上）">+</button>'+
      '<button class="kbtn reset" data-kz="reset" title="复位（双击图表）"'+(zoomed?'':' disabled')+'>复位</button>'+
      '</div>';
    const hint=hintSeen?'':'<div class="khint" id="khint">滚轮缩放 · 拖动平移 · 双击复位</div>';
    return legend+'<div class="tip" id="tip"></div>'+
      '<svg class="chart'+(g.view.count<total?' pannable':'')+'" id="chart" viewBox="0 0 '+g.width+' '+g.height+'" preserveAspectRatio="none">'+
      clip+gridH+yLab+
      '<g clip-path="url(#kclip)">'+
      '<g id="candles">'+candles+'</g>'+
      maEls+
      '<g id="vol">'+volBars+'</g>'+
      volMaEl+
      '<line class="base" x1="0" y1="'+g.mainH+'" x2="'+plotR+'" y2="'+g.mainH+'"></line>'+
      lastPriceEl+
      '</g>'+
      '<g class="cross" id="cross" style="display:none"><line id="cx" y1="0" y2="'+g.volBottom+'"></line><line id="cy" x1="0" x2="'+plotR+'"></line><circle id="kp" r="3"></circle></g>'+
      xLab+
      '</svg>'+ctrl+hint;
  }
  function bindKline(g){
    const wrap=document.getElementById('cwrap');
    const svg=document.getElementById('chart');
    const cross=document.getElementById('cross');
    const cx=document.getElementById('cx');
    const cy=document.getElementById('cy');
    const kp=document.getElementById('kp');
    const tip=document.getElementById('tip');
    const show=function(best,ev){
      const c=g.candles[best];
      if(!c)return;
      const cxPos=c.x+c.w/2;
      const closeY=c.cls==='up'?c.bodyY:c.bodyY+c.bodyH;
      cross.style.display='';
      cx.setAttribute('x1',cxPos); cx.setAttribute('x2',cxPos);
      cy.setAttribute('y1',closeY); cy.setAttribute('y2',closeY);
      if(kp){ kp.setAttribute('cx',cxPos); kp.setAttribute('cy',closeY); kp.className.baseVal='p '+c.cls; }
      const suf=maSuffix(periodFor(state.tab));
      const fmtMa=function(v){return v==null?'—':pf(v);};
      tip.style.display='block';
      tip.innerHTML=
        '<div class="row"><span>'+c.date+'</span></div>'+
        '<div class="row"><span>开</span><b>'+pf(c.open)+'</b></div>'+
        '<div class="row"><span>收</span><b class="'+c.cls+'">'+pf(c.close)+'</b></div>'+
        '<div class="row"><span>高</span><b>'+pf(c.high)+'</b></div>'+
        '<div class="row"><span>低</span><b>'+pf(c.low)+'</b></div>'+
        g.maValues.map(function(mv){
          if(state.maHide[String(mv.n)])return '';
          return '<div class="row"><span>MA'+mv.n+suf+'</span><b>'+fmtMa(mv.vals[best])+'</b></div>';
        }).join('')+
        (state.maHide.vol?'':'<div class="row"><span>均量5</span><b>'+(g.volMaVals[best]==null?'—':fmtVol(g.volMaVals[best]))+'</b></div>')+
        '<div class="row"><span>量</span><b>'+fmtVol(c.volume)+'</b></div>';
      placeTip(tip,wrap,ev);
    };
    let lastIdx=-1,raf=0;
    svg.addEventListener('mousemove',ev=>{
      // 拖动中不弹提示：重绘会换掉整个 svg，跟手优先
      if(drag)return;
      const r=svg.getBoundingClientRect();
      const sx=(ev.clientX-r.left)/r.width*g.width;
      let lo=0,hi=g.candles.length-1;
      while(lo<hi){
        const mid=(lo+hi)>>1;
        const ccx=g.candles[mid].x+g.candles[mid].w/2;
        if(ccx<sx)lo=mid+1;else hi=mid;
      }
      let best=lo;
      if(lo>0){
        const d=sx-(g.candles[lo-1].x+g.candles[lo-1].w/2);
        if(d<Math.abs(g.candles[lo].x+g.candles[lo].w/2-sx))best=lo-1;
      }
      // 拖动结束时十字线是隐藏的，同一个下标也要重新弹出来
      if(best===lastIdx&&cross.style.display!=='none')return;
      lastIdx=best;
      cancelAnimationFrame(raf);
      raf=requestAnimationFrame(()=>show(best,ev));
    });
    svg.addEventListener('mouseleave',()=>{ lastIdx=-1; cross.style.display='none'; tip.style.display='none'; });
    const lg=document.querySelector('.malegend');
    if(lg)lg.addEventListener('click',e=>{
      const s=e.target instanceof Element?e.target.closest('[data-k]'):null;
      if(!s)return;
      const k=s.dataset.k;
      state.maHide[k]=!state.maHide[k];
      s.classList.toggle('off',state.maHide[k]);
      const ln=document.getElementById('maline-'+k);
      if(ln)ln.style.display=state.maHide[k]?'none':'';
    });
  }
  // 面板尺寸变化只在图表区重绘，头部/资讯保持不动
  let resizeTimer=0;
  window.addEventListener('resize',()=>{
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(()=>{
      const wrap=document.getElementById('cwrap');
      if(!wrap||!last)return;
      if(Math.round(wrap.clientWidth)===lastW&&Math.round(wrap.clientHeight)===lastH)return;
      drawChart(last);
    },80);
  });
})();
</script>
</body>
</html>`;
}
