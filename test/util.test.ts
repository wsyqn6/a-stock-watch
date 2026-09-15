import { describe, expect, it } from 'bun:test';
import { trimCache } from '../src/util';

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
