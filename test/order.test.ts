import { describe, expect, it } from 'bun:test';
import { orderQuotes } from '../src/order';
import { StockQuote } from '../src/dataSource';

function quote(symbol: string, name: string, changePct: number): StockQuote {
  return { symbol, name, price: 10, prevClose: 10, change: 0, changePct, trend: 'flat', date: '' };
}

const quotes = [
  quote('sh600519', '贵州茅台', 2),
  quote('sz000858', '五粮液', 5),
  quote('sh601398', '工商银行', -1),
  quote('sz002594', '比亚迪', -3),
];

function syms(result: StockQuote[]): string[] {
  return result.map((q) => q.symbol);
}

describe('orderQuotes', () => {
  it('manual mode keeps watchlist order with no pins', () => {
    expect(syms(orderQuotes(quotes, 'manual', new Set()))).toEqual([
      'sh600519', 'sz000858', 'sh601398', 'sz002594',
    ]);
  });

  it('pinned group always first in manual order', () => {
    const pinned = new Set(['sz002594', 'sh600519']);
    expect(syms(orderQuotes(quotes, 'manual', pinned))).toEqual([
      'sh600519', 'sz002594', 'sz000858', 'sh601398',
    ]);
  });

  it('pinned group first and both groups sorted by code', () => {
    const pinned = new Set(['sz002594', 'sh601398']);
    expect(syms(orderQuotes(quotes, 'code', pinned))).toEqual([
      'sz002594', 'sh601398', 'sz000858', 'sh600519',
    ]);
  });

  it('pinned group first and both groups sorted by pctDesc', () => {
    const pinned = new Set(['sh600519', 'sz002594']);
    expect(syms(orderQuotes(quotes, 'pctDesc', pinned))).toEqual([
      'sh600519', 'sz002594', 'sz000858', 'sh601398',
    ]);
  });

  it('pinned group first and both groups sorted by pctAsc', () => {
    const pinned = new Set(['sh600519', 'sz002594']);
    expect(syms(orderQuotes(quotes, 'pctAsc', pinned))).toEqual([
      'sz002594', 'sh600519', 'sh601398', 'sz000858',
    ]);
  });

  it('pinned group first and both groups sorted by name', () => {
    const pinned = new Set(['sh601398', 'sz000858']);
    expect(syms(orderQuotes(quotes, 'name', pinned))).toEqual([
      'sh601398', 'sz000858', 'sz002594', 'sh600519',
    ]);
  });

  it('does not mutate input array', () => {
    const copy = [...quotes];
    orderQuotes(quotes, 'pctDesc', new Set());
    expect(quotes).toEqual(copy);
  });
});
