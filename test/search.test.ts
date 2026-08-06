import { describe, expect, it } from 'bun:test';
import { parseSearchResponse, parseEastmoneyResponse } from '../src/search';

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

describe('parseEastmoneyResponse', () => {
  const sample = JSON.stringify({
    QuotationCodeTable: {
      Data: [
        { Code: '113708', Name: 'N曙26转', Classify: 'Bond', QuoteID: '1.113708' },
        { Code: '127027', Name: '能化转债', Classify: 'Bond', QuoteID: '0.127027' },
        { Code: '000037', Name: '深南电A', Classify: 'AStock', QuoteID: '0.000037' },
        { Code: '839583', Name: '图南股份', Classify: 'NEEQ', QuoteID: '0.839583' },
        { Code: '0A2O', Name: 'LYFT INC', Classify: 'ForeignStock', QuoteID: '155.0A2O' },
      ],
    },
  });

  it('parses bonds with market from QuoteID prefix', () => {
    const r = parseEastmoneyResponse(sample);
    expect(r).toEqual([
      { name: 'N曙26转', code: '113708', market: 'sh', symbol: 'sh113708' },
      { name: '能化转债', code: '127027', market: 'sz', symbol: 'sz127027' },
      { name: '深南电A', code: '000037', market: 'sz', symbol: 'sz000037' },
    ]);
  });

  it('filters out non-AStock/Bond classes', () => {
    const names = parseEastmoneyResponse(sample).map((r) => r.name);
    expect(names).not.toContain('图南股份');
    expect(names).not.toContain('LYFT INC');
  });

  it('handles malformed and empty responses', () => {
    expect(parseEastmoneyResponse('garbage')).toHaveLength(0);
    expect(parseEastmoneyResponse('{"QuotationCodeTable":{}}')).toHaveLength(0);
    expect(parseEastmoneyResponse('')).toHaveLength(0);
  });
});
