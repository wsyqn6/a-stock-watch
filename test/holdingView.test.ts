import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(import.meta.dir, '..', 'src', 'stockViewProvider.ts'), 'utf8');

describe('webview holding wiring', () => {
  it('无持仓时汇总函数必须返回空串，保证零足迹', () => {
    expect(src).toMatch(/function sumHtml\(sum\)\{\s*if\(!sum\)return '';/);
  });

  it('持仓行主指标与副行都来自后端算好的 pnl 字段', () => {
    expect(src).toContain('const main=pnl?pnl.main:it.changePct;');
    expect(src).toContain('const sub=pnl?pnl.sub:it.price;');
    expect(src).toContain('pct.textContent=pnl?pnl.main:it.changePct;');
  });

  it('汇总必须走 updateSum，增量分支不能漏更标题行', () => {
    expect(src).toContain('function updateSum(sum)');
    expect(src).toContain('updateSum(sum);');
  });

  it('汇总样式挂在标题行内，不新增独立行', () => {
    expect(src).toContain('.lhead .sum{');
  });
});
