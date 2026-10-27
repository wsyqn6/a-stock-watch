import { describe, expect, it } from 'bun:test';
import { renderSidebarHtml } from '../src/webviewHtml';

describe('renderSidebarHtml', () => {
  it('注入 nonce 且包含关键挂载点', () => {
    const html = renderSidebarHtml();
    const nonce = /script-src 'nonce-([^']+)'/.exec(html)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).toContain('id="market"');
    expect(html).toContain('id="app"');
    expect(html).toContain('id="ipo"');
    expect(html).toContain("postMessage({type:'ready'})");
  });

  it('每次渲染使用不同 nonce', () => {
    expect(renderSidebarHtml()).not.toBe(renderSidebarHtml());
  });
});
