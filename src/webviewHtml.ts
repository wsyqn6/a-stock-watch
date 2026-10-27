import { GAP_TEXT } from './dataSource';
import { getNonce } from './util';

const WEBVIEW_CSS = `
:root{--up:#E15241;--down:#2EA46E}
@media (prefers-color-scheme: light){:root{--up:#C73E2E;--down:#2F8F5B}}
/* 灰度加在 body 上会让 body 成为 fixed 后代的包含块，列表滚动后右键菜单会被定位到可视区外 */
body.boss>*{filter:grayscale(1)}
*{box-sizing:border-box;margin:0;padding:0}
/* 只压隐藏 0×0 的渐变定义图；不要用全局 svg[aria-hidden] —— 迷你图等标记 aria-hidden 后会被绝对定位吞掉 */
body>svg[aria-hidden="true"]{position:absolute;pointer-events:none}
body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);margin:0;padding:0 4px 8px;display:flex;flex-direction:column;height:100vh}
.row{display:flex;align-items:center;padding:6px;border-bottom:1px solid var(--vscode-panel-border);transition:background .12s ease}
.row:hover{background:var(--vscode-list-hoverBackground)}
.row:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
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
.spark.hide{display:none}
.gapmsg{display:none;flex:1;min-width:0;height:30px;align-items:center;justify-content:center;color:var(--vscode-descriptionForeground);font-size:11px;opacity:.75;padding:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gapmsg.on{display:flex}
.row:hover .spark polyline{stroke-width:1.6}
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
.ipo-body .dayhead,.ipo-body .sechead,.ipofold-title{font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase}
.lhead .cnt,.ipo-body .dayhead .cnt{font-weight:400;letter-spacing:0;opacity:.7}
.msg{padding:12px;color:var(--vscode-descriptionForeground);text-align:center}
/* 持仓汇总：压在标题行右端，不新增行高；取消标题的大写与字距，超宽省略 */
.lhead .sum{margin-left:auto;min-width:0;font-size:11px;font-weight:400;letter-spacing:0;text-transform:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--vscode-descriptionForeground);font-variant-numeric:tabular-nums}
.lhead .sum b{font-weight:600}
.warn{padding:6px 12px;color:var(--vscode-editorWarning-foreground);font-size:12px;line-height:1.4;word-break:break-all}
.ipo{margin-top:auto;flex:0 0 auto}
.ipofold{display:flex;align-items:center;gap:6px;padding:5px 12px 5px 8px;margin-top:6px;border-top:1px solid var(--vscode-panel-border);cursor:pointer;user-select:none}
.ipofold:hover{background:var(--vscode-list-hoverBackground)}
.ipofold-title{display:flex;align-items:center;gap:6px;color:var(--vscode-foreground)}
.ipofold-title::before{content:'▾';font-size:16px;line-height:1;color:var(--vscode-descriptionForeground);transition:transform .15s ease}
.ipo.collapsed .ipofold-title::before{transform:rotate(-90deg)}
.ipofold-count{font-size:10px;font-weight:400;color:var(--vscode-descriptionForeground);white-space:nowrap}
.ipofold-count:empty{display:none}
.ipofold-refresh{flex:0 0 auto;width:18px;height:18px;margin-left:auto;display:flex;align-items:center;justify-content:center;background:none;border:none;cursor:pointer;color:var(--vscode-descriptionForeground);border-radius:4px;opacity:.85;transition:opacity .12s ease,color .12s ease,background .12s ease}
.ipofold-refresh:hover{opacity:1;color:var(--vscode-foreground);background:var(--vscode-list-hoverBackground)}
.ipofold-refresh svg{vertical-align:middle;display:block}
.ipo-body{overflow:hidden}
.ipo.collapsed .ipo-body{display:none}
.ipo-body .day{margin:4px 0 8px}
.ipo-body .dayhead{display:flex;align-items:center;gap:8px;padding:0 8px 4px;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-panel-border)}
.ipo-body .dayhead.today{color:var(--vscode-textLink-foreground)}
.ipo-body .dayhead .cnt{margin-left:auto}
.ipo-body .sechead{display:flex;align-items:baseline;gap:6px;padding:5px 8px 0;color:var(--vscode-descriptionForeground);opacity:.85}
.ipo-body .price{color:var(--vscode-foreground)}
.ipo-body .tag{font-size:10px;color:var(--vscode-descriptionForeground);line-height:1.15;white-space:nowrap}
.ipo-body .fill{flex:1;min-width:0}
.ipo-body .empty{padding:8px 10px 10px;color:var(--vscode-descriptionForeground);font-size:12px}
.ipo-body .empty.today{color:var(--vscode-editorWarning-foreground)}
#app{flex:0 0 auto}
.lhead{display:flex;align-items:baseline;gap:6px;margin:8px 8px 4px;padding:0;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-panel-border);font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase}
.market{user-select:none;flex:0 0 auto;margin:0 4px}
.mind{display:block}
.midx{display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer}
.midx:hover{background:var(--vscode-list-hoverBackground)}
.midx .iname{flex:0 0 52px;font-size:11px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.midx .spark{height:24px}
.midx .gapmsg{height:24px}
.midx .right{margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:1px}
.midx .ipct{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.15;white-space:nowrap}
.midx .iprice{font-size:11px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1.15;white-space:nowrap}
.gauge{height:3px;margin:4px 6px 0;border-radius:2px;display:flex;gap:2px;overflow:hidden;background:var(--vscode-editor-background)}
.gauge .seg{border-radius:2px}
.gauge .seg.up{background:var(--up)}
.gauge .seg.down{background:var(--down)}
.gauge .seg.flat{background:var(--vscode-descriptionForeground)}
.gnums{display:flex;align-items:baseline;justify-content:space-between;padding:3px 8px 0;font-size:10px;font-variant-numeric:tabular-nums;line-height:1;color:var(--vscode-descriptionForeground)}
.gnums .u{color:var(--up)}
.gnums .d{color:var(--down)}
`;

/**
 * 侧边栏 webview 的完整 HTML。
 * 样式与脚本内联，CSP 只放行本次 nonce；与 provider 逻辑分离，避免主文件被模板淹没。
 */
export function renderSidebarHtml(): string {
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
  function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  const GAP_TEXT=${JSON.stringify(GAP_TEXT)};
  /** 分时有缺口时用提示文字占据迷你图区域，ok 时还原迷你图。 */
  function applyGap(box,gap){
    const msg=box.querySelector('.gapmsg');
    const svg=box.querySelector('.spark');
    if(!msg||!svg)return;
    const text=gap&&gap!=='ok'?GAP_TEXT[gap]||GAP_TEXT['no-data']:null;
    msg.textContent=text||'';
    msg.classList.toggle('on',!!text);
    svg.classList.toggle('hide',!!text);
  }
  let editing=false;
  let cur=[];
  let curSum=null;
  let lastMkSig='';
  function idxHtml(it){
    return '<div class="midx" data-ix="'+it.sym+'" title="查看 '+it.short+' 走势">'+
      '<span class="iname">'+it.short+'</span>'+
      '<span class="gapmsg"></span>'+
      '<svg class="spark flat" aria-hidden="true" viewBox="0 0 100 18" preserveAspectRatio="none"></svg>'+
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
      updateSpark(svg,it.spark);
      applyGap(el,it.gap);
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
      marketEl.innerHTML='<div class="mind">'+m.indices.map(idxHtml).join('')+'</div>'+mkBarHtml(m.breadth);
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
    const board=it.board?'<span class="board">'+esc(it.board)+'</span>':'';
    return '<div class="row"><div class="left"><span class="name">'+esc(it.name)+'</span><span class="codeline"><span class="code">'+esc(it.code)+'</span>'+board+'</span></div>'+
      '<span class="fill"></span><div class="right"><span class="price">'+esc(it.price)+'</span><span class="tag">'+esc(it.tag)+'</span></div></div>';
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
    ipoEl.style.display=m.show?'':'none';
    if(!m.show)return;
    if(m.error){ipoBody.innerHTML='<div class="warn">'+esc(m.error)+'</div>';ipoCount.textContent='';return;}
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
      if(ns||nb)todayInfo='今日股 '+ns+' · 债 '+nb;
    }
    ipoCount.textContent=todayInfo;
    ipoBody.innerHTML=days.map(ipoDayHtml).join('');
  }
  window.addEventListener('message',e=>{
    const m=e.data;
    if(!m)return;
    if(m.type==='editMode'){ editing=!!m.value; document.body.classList.toggle('editing',editing); if(cur.length)render(cur,undefined,curSum); return; }
    if(m.type==='ipo'){ renderIpo(m); return; }
    if(m.type!=='quotes')return;
    document.body.classList.toggle('boss',!!m.boss);
    renderMarket(m.market);
    if(m.error){resetList();app.innerHTML='<div class="msg">'+esc(m.error)+'</div>';return;}
    if(!m.items||!m.items.length){resetList();app.innerHTML='<div class="lhead">自选股<span class="cnt">0</span></div><div class="msg">暂无自选股，点击 + 添加</div>';return;}
    curSum=m.sum||null;
    render(m.items,m.warn,curSum);
  });
  // 错误/空态直接覆盖了列表 DOM，签名须一并清空：否则行情恢复后同一符号集会命中增量分支，
  // 而查询不到任何行，列表一直停在错误态。
  let curSig=null;
  function resetList(){curSig=null;cur=[];curSum=null;}
  /** 汇总只在存在有效持仓时出现，无持仓时连占位节点都不生成，保证零足迹。 */
  function sumHtml(sum){
    if(!sum)return '';
    return '<span class="sum" title="'+esc(sum.title)+'">今日 <b class="'+sum.dayCls+'">'+esc(sum.day)+'</b> · 累计 <b class="'+sum.totalCls+'">'+esc(sum.total)+'</b></span>';
  }
  function updateSum(sum){
    const bar=app.querySelector('.lhead');
    if(!bar)return;
    const el=bar.querySelector('.sum');
    if(!sum){if(el)el.remove();return;}
    if(el){el.outerHTML=sumHtml(sum);return;}
    bar.insertAdjacentHTML('beforeend',sumHtml(sum));
  }
  function render(items,warn,sum){
    const sig=editing+'|'+items.map(it=>it.sym).join(',');
    if(curSig!==sig){
      curSig=sig;
      closeMenu();
      const banner=warn?'<div class="warn">'+esc(warn)+'</div>':'';
      app.innerHTML=banner+'<div class="lhead">自选股<span class="cnt">'+items.length+'</span>'+sumHtml(sum)+'</div>'+items.map((it,i)=>{
        const handle=editing?'<span class="handle" title="拖动排序">⋮⋮</span>':'';
        const pin=editing?'<button class="pin'+(it.inBar?' on':'')+'" title="'+(it.inBar?'从状态栏移除':'添加到状态栏')+'">'+PIN_SVG+'</button>':'';
        const top=editing?'<button class="top'+(it.pinned?' on':'')+'" title="'+(it.pinned?'取消置顶':'置顶')+'">'+TOP_SVG+'</button>':'';
        const pnl=it.pnl;
        const main=pnl?pnl.main:it.changePct;
        const mainCls=pnl?pnl.cls:it.cls;
        const sub=pnl?pnl.sub:it.price;
        const tip=pnl?' title="'+esc(pnl.title)+'"':'';
        return '<div class="row" data-i="'+i+'"'+tip+(editing?' draggable="true"':' role="button" tabindex="0"')+'>'+handle+'<div class="left"><span class="name">'+esc(it.name)+'</span><span class="codeline"><span class="code">'+esc(it.code)+'</span>'+(it.board?'<span class="board">'+esc(it.board)+'</span>':'')+'</span></div><span class="gapmsg"></span>'+spark(it)+'<div class="right"><span class="pct '+mainCls+'">'+esc(main)+'</span><span class="price">'+esc(sub)+'</span></div>'+pin+top+'<button class="del" title="删除">✕</button></div>';
      }).join('');
      fitNames();
      bind();
      app.querySelectorAll('.row').forEach((row,i)=>applyGap(row,items[i]&&items[i].gap));
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
        const pnl=it.pnl;
        const pct=row.querySelector('.pct');
        const price=row.querySelector('.price');
        if(pct){pct.textContent=pnl?pnl.main:it.changePct;pct.className='pct '+(pnl?pnl.cls:it.cls);}
        if(price){price.textContent=pnl?pnl.sub:it.price;price.className='price';}
        if(pnl){row.title=pnl.title;}else{row.removeAttribute('title');}
        updateSpark(row.querySelector('.spark'),it.spark);
        applyGap(row,it.gap);
      });
      updateSum(sum);
    }
    cur=items;
  }
  function fitNames(){
    app.querySelectorAll('.name').forEach(el=>{
      const maxW=el.parentNode.clientWidth;
      let fs=13;
      el.style.fontSize=fs+'px';
      while(fs>9&&el.scrollWidth>maxW){fs-=0.5;el.style.fontSize=fs+'px';}
    });
  }
  function sparkMarkup(s){
    return '<path class="area" d="'+s.area+'"></path><line class="base" x1="0" y1="'+s.baseY+'" x2="100" y2="'+s.baseY+'"></line><polyline points="'+s.line+'"></polyline>';
  }
  /** 与 dataSource.sparkKey 同格式（颜色|基准线|折线）：任一变化都要重绘，只比折线会漏掉基线/颜色更新。 */
  function sparkSig(s){
    return s&&s.line?s.color+'|'+s.baseY+'|'+s.line:'';
  }
  function updateSpark(svg,s){
    if(!svg)return;
    const sig=sparkSig(s);
    if(svg.dataset.sig===sig)return;
    svg.dataset.sig=sig;
    if(sig){
      svg.innerHTML=sparkMarkup(s);
      svg.setAttribute('class','spark '+s.color);
    } else {
      svg.innerHTML='';
      svg.setAttribute('class','spark flat');
    }
  }
  function spark(it){
    const s=it.spark;
    const sig=sparkSig(s);
    const color=s&&s.line?s.color:'flat';
    return '<svg class="spark '+color+'" aria-hidden="true" data-sig="'+sig+'" viewBox="0 0 100 18" preserveAspectRatio="none">'+(sig?sparkMarkup(s):'')+'</svg>';
  }
  function bind(){
    const rows=Array.from(app.querySelectorAll('.row'));
    rows.forEach((row,i)=>{
      row.addEventListener('click',(e)=>{
        if(editing)return;
        if(e.target.closest('.del,.pin,.top,.handle'))return;
        api.postMessage({type:'openDetail',symbol:cur[i].sym});
      });
      row.addEventListener('keydown',(e)=>{
        if(editing||(e.key!=='Enter'&&e.key!==' '))return;
        e.preventDefault();
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
      '<div class="item">'+(it.held?'修改持仓':'设置持仓')+'</div>'+
      '<div class="sep"></div>'+
      '<div class="item danger">删除</div>';
    document.body.appendChild(menu);
    menu.style.left=Math.max(0,Math.min(x,window.innerWidth-menu.offsetWidth-4))+'px';
    menu.style.top=Math.max(0,Math.min(y,window.innerHeight-menu.offsetHeight-4))+'px';
    const items=Array.from(menu.querySelectorAll('.item'));
    items[0].addEventListener('click',()=>api.postMessage({type:'toggleStatusBar',symbol:it.sym}));
    items[1].addEventListener('click',()=>api.postMessage({type:'togglePin',symbol:it.sym}));
    items[2].addEventListener('click',()=>api.postMessage({type:'copy',code:it.code}));
    items[3].addEventListener('click',()=>api.postMessage({type:'editHolding',symbol:it.sym}));
    items[4].addEventListener('click',()=>api.postMessage({type:'remove',symbol:it.sym}));
    items.forEach(el=>el.addEventListener('click',closeMenu));
  }
  window.addEventListener('contextmenu',e=>{
    e.preventDefault();
    const row=e.target.closest('#app .row');
    if(!row){closeMenu();return;}
    showMenu(e.clientX,e.clientY,cur[+row.dataset.i]);
  });
  window.addEventListener('mousedown',e=>{ if(menu&&!menu.contains(e.target))closeMenu(); });
  window.addEventListener('keydown',e=>{ if(e.key==='Escape')closeMenu(); });
  window.addEventListener('blur',closeMenu);
  window.addEventListener('scroll',closeMenu,true);
  document.addEventListener('visibilitychange',()=>{ if(document.hidden)closeMenu(); });
})();
</script>
</body>
</html>`;
}
