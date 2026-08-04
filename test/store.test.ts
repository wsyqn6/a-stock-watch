import { describe, expect, it } from 'bun:test';
import { WatchlistCore } from '../src/watchlistCore';

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
});
