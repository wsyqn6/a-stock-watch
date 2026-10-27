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
});
