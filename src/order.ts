import { StockQuote } from './dataSource';

export type SortMode = 'manual' | 'code' | 'name' | 'pctDesc' | 'pctAsc';

export function orderQuotes(quotes: StockQuote[], mode: SortMode, pinned: Set<string>): StockQuote[] {
  const sort = (arr: StockQuote[]): StockQuote[] => {
    const copy = [...arr];
    if (mode === 'code') {
      copy.sort((a, b) => a.symbol.slice(2).localeCompare(b.symbol.slice(2)));
    } else if (mode === 'name') {
      copy.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    } else if (mode === 'pctDesc') {
      copy.sort((a, b) => b.changePct - a.changePct);
    } else if (mode === 'pctAsc') {
      copy.sort((a, b) => a.changePct - b.changePct);
    }
    return copy;
  };
  return [...sort(quotes.filter((q) => pinned.has(q.symbol))), ...sort(quotes.filter((q) => !pinned.has(q.symbol)))];
}
