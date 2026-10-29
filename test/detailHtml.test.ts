import { describe, expect, it } from 'bun:test';
import { renderDetailHtml } from '../src/detailHtml';

describe('renderDetailHtml', () => {
  it('注入 nonce 且包含关键挂载点', () => {
    const html = renderDetailHtml();
    const nonce = /script-src 'nonce-([^']+)'/.exec(html)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).toContain('id="app"');
    expect(html).toContain('id="chart"');
    expect(html).toContain('id="related"');
    expect(html).toContain("postMessage({type:'ready'})");
    expect(html).toContain("type:'needKline'");
  });

  it('每次渲染使用不同 nonce', () => {
    expect(renderDetailHtml()).not.toBe(renderDetailHtml());
  });

  it('内联图表几何函数且脚本可解析', () => {
    const html = renderDetailHtml();
    const code = /<script nonce="[^"]*">([\s\S]*?)<\/script>/.exec(html)![1];
    // 几何函数必须是自包含的纯源码：出现模块引用会让 webview 侧直接报错
    expect(code).toContain('function buildChartScale');
    expect(code).toContain('function layoutMinuteView');
    expect(code).toContain('function layoutKlineView');
    expect(code).not.toContain('exports.');
    expect(code).not.toContain('require(');
    expect(() => new Function(code)).not.toThrow();
  });

  it('统计区固定两行主格加一行紧凑补充', () => {
    const html = renderDetailHtml();
    expect(html).toContain('id="row3"');
    expect(html).toContain('class="stats3"');
    expect(html).toContain('涨停');
    expect(html).toContain('跌停');
  });

  it('挂载缩放与复位交互', () => {
    const html = renderDetailHtml();
    expect(html).toContain("addEventListener('wheel'");
    expect(html).toContain("addEventListener('dblclick'");
    expect(html).toContain('KLINE_MIN_POINTS');
    // 缩放只改视窗，数据仍由 host 下发
    expect(html).toContain('layoutKlineView(K,viewFor(p,K)');
  });

  it('用常驻工具条暴露缩放与复位，而不是只靠双击', () => {
    const html = renderDetailHtml();
    const code = /<script nonce="[^"]*">([\s\S]*?)<\/script>/.exec(html)![1];
    expect(html).toContain('class="kctrl"');
    expect(html).toContain('data-kz="in"');
    expect(html).toContain('data-kz="out"');
    expect(html).toContain('data-kz="reset"');
    // 未缩放时复位按钮置灰，同时给一次操作提示
    expect(code).toContain("(zoomed?'':' disabled')");
    expect(code).toContain('class="khint"');
    // 按钮与滚轮走同一条缩放路径，锚点都交给内联的纯函数
    expect(code).toContain('function zoomKlineView');
    expect(code).toContain('zoomKlineView(v,total,next,px,g.plotW)');
  });

  it('挂载拖动平移交互', () => {
    const html = renderDetailHtml();
    const code = /<script nonce="[^"]*">([\s\S]*?)<\/script>/.exec(html)![1];
    // 平移几何同样是内联的纯函数，缺了会让拖动在 webview 侧报错
    expect(code).toContain('function panKlineView');
    expect(code).toContain("addEventListener('pointerdown'");
    expect(code).toContain("addEventListener('pointermove'");
    expect(code).toContain("classList.add('dragging')");
    // 拖动只改视窗起点，不发消息
    expect(code).toContain('panKlineView(drag.v,c.K.points.length,delta)');
    expect(() => new Function(code)).not.toThrow();
  });
});
