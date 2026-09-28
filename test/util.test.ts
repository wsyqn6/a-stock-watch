import { describe, expect, it } from 'bun:test';
import { fmtPrice, priceDecimals, trimCache } from '../src/util';

describe('priceDecimals', () => {
  it('gives 3 decimals to funds (sh 5xx / sz 1xx: ETF, LOF, bonds)', () => {
    expect(priceDecimals('sh510300', 0.853)).toBe(3);
    expect(priceDecimals('sz159915', 0.5)).toBe(3);
    expect(priceDecimals('sz161725', 1.2)).toBe(3);
    expect(priceDecimals('510300', 10)).toBe(3);
    expect(priceDecimals('510300')).toBe(3); // 无参考价时安全兜底 3 位
  });

  it('falls back to 2 decimals for funds priced above 10 yuan', () => {
    expect(priceDecimals('sh511880', 100.005)).toBe(2);
    expect(priceDecimals('sz128048', 135.678)).toBe(2);
    expect(priceDecimals('sh510300', 10.01)).toBe(2);
  });

  it('keeps 2 decimals for stocks and indices', () => {
    expect(priceDecimals('sh600000')).toBe(2);
    expect(priceDecimals('sz000001')).toBe(2);
    expect(priceDecimals('sz300750')).toBe(2);
    expect(priceDecimals('sh000001')).toBe(2);
    expect(priceDecimals('600000')).toBe(2);
  });

  it('formats prices with the resolved precision', () => {
    expect(fmtPrice(0.853, 'sh510300', 0.853)).toBe('0.853');
    expect(fmtPrice(0.001, 'sz159915', 0.5)).toBe('0.001');
    expect(fmtPrice(0.001, 'sh511880', 100)).toBe('0.00'); // 大价差金额也随参考价回落 2 位
    expect(fmtPrice(12.34, 'sh600000')).toBe('12.34');
  });
});

describe('trimCache', () => {
  it('keeps the map untouched while under the limit', () => {
    const cache = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    trimCache(cache, 2);
    expect([...cache.keys()]).toEqual(['a', 'b']);
  });

  it('evicts oldest inserted entries until size fits', () => {
    const cache = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ]);
    trimCache(cache, 2);
    expect([...cache.keys()]).toEqual(['c', 'd']);
  });

  it('handles empty map and zero limit', () => {
    const empty = new Map<string, number>();
    trimCache(empty, 0);
    expect(empty.size).toBe(0);

    const cache = new Map([['a', 1]]);
    trimCache(cache, 0);
    expect(cache.size).toBe(0);
  });
});
