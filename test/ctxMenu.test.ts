import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dir, '..', 'src', 'webviewHtml.ts'), 'utf8');

describe('webview context menu', () => {
  it('老板模式灰度不能加在 body 上（filter 会成为 fixed 后代的包含块）', () => {
    expect(src).not.toContain('body.boss{filter:grayscale(1)}');
    expect(src).toContain('body.boss>*{filter:grayscale(1)}');
  });

  it('菜单坐标需夹紧到视口内，避免短视图下被裁掉', () => {
    expect(src).toContain('Math.max(0,Math.min(x,window.innerWidth-menu.offsetWidth-4))');
    expect(src).toContain('Math.max(0,Math.min(y,window.innerHeight-menu.offsetHeight-4))');
  });
});
