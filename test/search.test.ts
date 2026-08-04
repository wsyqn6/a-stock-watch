import { describe, expect, it } from 'bun:test';
import { parseSearchResponse } from '../src/search';

describe('parseSearchResponse', () => {
  it('parses single result', () => {
    const raw = 'v_hint="sh~600519~\u8d35\u5dde\u8305\u53f0~gzmt~GP-A"';
    const r = parseSearchResponse(raw);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ name: '贵州茅台', code: '600519', market: 'sh', symbol: 'sh600519' });
  });

  it('parses multiple results separated by ^', () => {
    const raw =
      'v_hint="sh~000001~\u4e0a\u8bc1\u6307\u6570~szzs~ZS^sz~000001~\u5e73\u5b89\u94f6\u884c~payh~GP-A"';
    const r = parseSearchResponse(raw);
    expect(r).toHaveLength(2);
    expect(r[0].symbol).toBe('sh000001');
    expect(r[1].symbol).toBe('sz000001');
  });

  it('filters out non-sh/sz markets and invalid codes', () => {
    const raw = 'v_hint="jj~000001~\u534e\u590f\u6210\u957f~hxcz~KJ^us~AAPL~Apple~aapl~US"';
    const r = parseSearchResponse(raw);
    expect(r).toHaveLength(0);
  });

  it('handles empty response', () => {
    expect(parseSearchResponse('v_hint=""')).toHaveLength(0);
    expect(parseSearchResponse('garbage')).toHaveLength(0);
  });
});
