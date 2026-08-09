import { describe, expect, it } from 'bun:test';
import { WatchlistCore, reconcileSubset } from '../src/watchlistCore';

describe('WatchlistCore', () => {
  it('adds symbols', () => {
    const saved: string[][] = [];
    const core = new WatchlistCore([], (s) => saved.push(s));
    expect(core.add('sh600519')).toBe(true);
    expect(core.add('sh600519')).toBe(false);
    expect(core.getAll()).toEqual(['sh600519']);
    expect(saved).toEqual([['sh600519']]);
  });

  it('removes symbols', () => {
    const core = new WatchlistCore(['sh600519', 'sz000001'], () => {});
    expect(core.remove('sz000001')).toBe(true);
    expect(core.remove('sz000001')).toBe(false);
    expect(core.getAll()).toEqual(['sh600519']);
  });

  it('reorders symbols and drops unknowns', () => {
    const saved: string[][] = [];
    const core = new WatchlistCore(['a', 'b', 'c'], (s) => saved.push(s));
    core.reorder(['c', 'a', 'b', 'zzz']);
    expect(core.getAll()).toEqual(['c', 'a', 'b']);
    expect(saved).toEqual([['c', 'a', 'b']]);
  });

  it('reorder keeps any missing symbols appended', () => {
    const core = new WatchlistCore(['a', 'b', 'c'], () => {});
    core.reorder(['c', 'b']);
    expect(core.getAll()).toEqual(['c', 'b', 'a']);
  });

  it('reorder dedupes repeated symbols', () => {
    const core = new WatchlistCore(['a', 'b', 'c'], () => {});
    core.reorder(['c', 'c', 'a']);
    expect(core.getAll()).toEqual(['c', 'a', 'b']);
  });

  it('reorder preserves unique members', () => {
    const core = new WatchlistCore(['a', 'b', 'c'], () => {});
    expect(core.has('b')).toBe(true);
    expect(core.has('zzz')).toBe(false);
  });
});

describe('reconcileSubset', () => {
  it('drops items not in master', () => {
    expect(reconcileSubset(['a', 'b', 'c'], ['b', 'x', 'a'])).toEqual(['b', 'a']);
  });

  it('keeps master order in subset', () => {
    expect(reconcileSubset(['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'a']);
  });

  it('handles empty inputs', () => {
    expect(reconcileSubset([], ['a', 'b'])).toEqual([]);
    expect(reconcileSubset(['a', 'b'], [])).toEqual([]);
  });
});
