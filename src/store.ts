import * as vscode from 'vscode';
import { WatchlistCore, reconcileSubset } from './watchlistCore';

const CONFIG_SECTION = 'aStockWatch';
const WATCHLIST_KEY = 'watchlist';
const STATUS_BAR_KEY = 'statusBar';
const PINNED_KEY = 'pinned';
const LEGACY_KEY = 'aStockWatch.list';
const DEFAULT_SYMBOLS = ['sh000001', 'sz399001'];

export class Store implements vscode.Disposable {
  static readonly STATUS_BAR_MAX = 3;

  private watchlist: WatchlistCore;
  private statusBar: WatchlistCore;
  private pinned: WatchlistCore;

  constructor(initial?: string[]) {
    this.watchlist = new WatchlistCore(
      initial ?? this.read(WATCHLIST_KEY, DEFAULT_SYMBOLS),
      (s) => this.persist(WATCHLIST_KEY, s),
    );
    this.statusBar = this.buildStatusBar(this.watchlist.getAll());
    this.pinned = this.buildPinned(this.watchlist.getAll());
  }

  static migrateLegacy(context: vscode.ExtensionContext): Store {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const inspected = config.inspect<string[]>(WATCHLIST_KEY);
    const hasConfig = Store.configSet(inspected);
    if (!hasConfig) {
      const legacy: unknown = context.globalState.get(LEGACY_KEY);
      const legacyList = Array.isArray(legacy)
        ? legacy.filter((x): x is string => typeof x === 'string')
        : [];
      const seeds = legacyList.length > 0 ? legacyList : [...DEFAULT_SYMBOLS];
      void config.update(WATCHLIST_KEY, seeds, vscode.ConfigurationTarget.Global);
      return new Store(seeds);
    }
    return new Store();
  }

  private static configSet(
    inspected: { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown } | undefined,
  ): boolean {
    return (
      inspected?.globalValue !== undefined ||
      inspected?.workspaceValue !== undefined ||
      inspected?.workspaceFolderValue !== undefined
    );
  }

  private read(key: string, fallback: string[]): string[] {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const inspected = config.inspect<string[]>(key);
    if (!Store.configSet(inspected)) {
      return [...fallback];
    }
    const raw: unknown = config.get<string[]>(key, []);
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  }

  private buildStatusBar(master: string[]): WatchlistCore {
    const raw = this.read(STATUS_BAR_KEY, []);
    const valid = reconcileSubset(master, raw).slice(0, Store.STATUS_BAR_MAX);
    if (valid.join('\n') !== raw.join('\n')) {
      this.persist(STATUS_BAR_KEY, valid);
    }
    return new WatchlistCore(valid, (s) => this.persist(STATUS_BAR_KEY, s));
  }

  private buildPinned(master: string[]): WatchlistCore {
    const raw = this.read(PINNED_KEY, []);
    const valid = reconcileSubset(master, raw);
    if (valid.join('\n') !== raw.join('\n')) {
      this.persist(PINNED_KEY, valid);
    }
    return new WatchlistCore(valid, (s) => this.persist(PINNED_KEY, s));
  }

  reload(): void {
    this.watchlist = new WatchlistCore(
      this.read(WATCHLIST_KEY, DEFAULT_SYMBOLS),
      (s) => this.persist(WATCHLIST_KEY, s),
    );
    this.statusBar = this.buildStatusBar(this.watchlist.getAll());
    this.pinned = this.buildPinned(this.watchlist.getAll());
  }

  getAll(): string[] {
    return this.watchlist.getAll();
  }

  has(symbol: string): boolean {
    return this.watchlist.has(symbol);
  }

  add(symbol: string): boolean {
    return this.watchlist.add(symbol);
  }

  remove(symbol: string): boolean {
    const ok = this.watchlist.remove(symbol);
    if (ok) {
      this.statusBar.remove(symbol);
      this.pinned.remove(symbol);
    }
    return ok;
  }

  reorder(symbols: string[]): void {
    this.watchlist.reorder(symbols);
  }

  getStatusBar(): string[] {
    return this.statusBar.getAll();
  }

  isPinned(symbol: string): boolean {
    return this.pinned.has(symbol);
  }

  getPinned(): string[] {
    return this.pinned.getAll();
  }

  togglePin(symbol: string): boolean {
    if (this.pinned.has(symbol)) {
      return this.pinned.remove(symbol);
    }
    if (!this.watchlist.has(symbol)) {
      return false;
    }
    return this.pinned.add(symbol);
  }

  statusBarHas(symbol: string): boolean {
    return this.statusBar.has(symbol);
  }

  statusBarToggle(symbol: string): boolean {
    if (this.statusBar.has(symbol)) {
      return this.statusBar.remove(symbol);
    }
    if (!this.watchlist.has(symbol)) {
      return false;
    }
    if (this.statusBar.getAll().length >= Store.STATUS_BAR_MAX) {
      return false;
    }
    return this.statusBar.add(symbol);
  }

  private persist(key: string, symbols: string[]): void {
    void vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(key, symbols, vscode.ConfigurationTarget.Global);
  }

  dispose(): void {}
}
