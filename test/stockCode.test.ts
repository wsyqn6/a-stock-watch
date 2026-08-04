import { describe, expect, it } from 'bun:test';
import { normalizeCode, isValidCode } from '../src/stockCode';

describe('normalizeCode', () => {
  const cases: Array<[string, string]> = [
    ['600519', 'sh600519'],
    ['601318', 'sh601318'],
    ['688111', 'sh688111'],
    ['000001', 'sz000001'],
    ['002594', 'sz002594'],
    ['300750', 'sz300750'],
    ['110059', 'sh110059'],
    ['123456', 'sz123456'],
    [' 600519 ', 'sh600519'],
  ];
  for (const [input, expected] of cases) {
    it(`normalizes ${input} -> ${expected}`, () => {
      expect(normalizeCode(input)).toEqual({ ok: true, code: expected, market: expected.slice(0, 2), symbol: expected.slice(2) });
    });
  }

  const invalid = ['123', 'abcdef', '0000000', '430047', '830799', '', 'abc123'];
  for (const input of invalid) {
    it(`rejects ${input || '(empty)'}`, () => {
      expect(normalizeCode(input).ok).toBe(false);
    });
  }
});

describe('isValidCode', () => {
  it('accepts 6 digits', () => {
    expect(isValidCode('600519')).toBe(true);
  });
  it('rejects non-6-digit', () => {
    expect(isValidCode('60051')).toBe(false);
    expect(isValidCode('6005190')).toBe(false);
    expect(isValidCode('abcdef')).toBe(false);
  });
});
