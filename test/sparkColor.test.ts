import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dir, '..', 'src', 'stockViewProvider.ts'), 'utf8');

describe('webview spark color wiring', () => {
  it('必须用 setAttribute 而非 className 给 SVG 上色（className 在 SVG 元素上不生效）', () => {
    const svgClassAssign = [...src.matchAll(/svg\.className=/g)];
    expect(svgClassAssign).toHaveLength(0);
    const setAttr = [...src.matchAll(/svg\.setAttribute\('class'/g)];
    expect(setAttr.length).toBeGreaterThanOrEqual(2);
  });

  it('增量重绘必须比较完整签名（颜色|基准线|折线），只比折线会漏更基线/颜色', () => {
    expect(src).toContain('svg.dataset.sig===sig');
    expect(src).not.toContain('svg.dataset.pts');
    expect(src).toMatch(/function sparkSig\(s\)/);
  });
});
