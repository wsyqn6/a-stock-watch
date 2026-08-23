import { describe, it, expect, beforeEach, mock } from 'bun:test';

type Q = {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  trend: 'up' | 'down' | 'flat';
  date: string;
};

function makeQ(symbol: string): Q {
  return {
    symbol,
    name: symbol,
    price: 10,
    prevClose: 9,
    change: 1,
    changePct: 11.11,
    trend: 'up',
    date: '20260101',
  };
}

const calls: string[][] = [];

mock.module('../src/dataSource', () => ({
  fetchQuotes: async (symbols: string[]): Promise<Q[]> => {
    calls.push([...symbols]);
    return symbols.map(makeQ);
  },
}));

const { fetchQuotesCached } = await import('../src/quoteCache');

describe('fetchQuotesCached', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('empty input returns empty without fetching', async () => {
    const r = await fetchQuotesCached([]);
    expect(r).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it('fetches missing symbols then serves from cache within TTL', async () => {
    const r1 = await fetchQuotesCached(['a', 'b']);
    expect(r1.map((x) => x.symbol)).toEqual(['a', 'b']);
    expect(calls.length).toBe(1);
    calls.length = 0;
    const r2 = await fetchQuotesCached(['a', 'b']);
    expect(r2.map((x) => x.symbol)).toEqual(['a', 'b']);
    expect(calls.length).toBe(0);
  });

  it('coalesces concurrent identical requests into a single fetch', async () => {
    const [r1, r2] = await Promise.all([
      fetchQuotesCached(['x', 'y']),
      fetchQuotesCached(['x', 'y']),
    ]);
    expect(r1.map((x) => x.symbol)).toEqual(['x', 'y']);
    expect(r2.map((x) => x.symbol)).toEqual(['x', 'y']);
    expect(calls.length).toBe(1);
  });

  it('returns quotes in request order (even when reversed)', async () => {
    const r = await fetchQuotesCached(['b', 'a']);
    expect(r.map((x) => x.symbol)).toEqual(['b', 'a']);
  });

  it('only fetches the missing subset on a partial refresh', async () => {
    await fetchQuotesCached(['a', 'b']);
    calls.length = 0;
    const r = await fetchQuotesCached(['a', 'c']);
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual(['c']);
    expect(r.map((x) => x.symbol)).toEqual(['a', 'c']);
  });

  it('deduplicates repeated symbols in a single request', async () => {
    const r = await fetchQuotesCached(['m', 'm', 'n']);
    expect(r.map((x) => x.symbol)).toEqual(['m', 'm', 'n']);
    expect(calls[0]).toEqual(['m', 'n']);
  });
});
