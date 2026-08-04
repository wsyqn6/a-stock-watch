import * as vscode from 'vscode';
import { WatchlistCore } from './watchlistCore';

const CONFIG_SECTION = 'aStockWatch';
const WATCHLIST_KEY = 'watchlist';
const LEGACY_KEY = 'aStockWatch.list';
const DEFAULT_SYMBOLS = ['sh000001', 'sz399001'];

export class Store implements vscode.Disposable {
  private core: WatchlistCore;

  constructor(initial?: string[]) {
    this.core = new WatchlistCore(initial ?? [], (s) => this.persist(s));
  }

  static migrateLegacy(context: vscode.ExtensionContext): Store {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const inspected = config.inspect<string[]>(WATCHLIST_KEY);
    const hasConfig =
      inspected?.globalValue !== undefined ||
      inspected?.workspaceValue !== undefined ||
      inspected?.workspaceFolderValue !== undefined;
    let initial: string[] | undefined;
    if (!hasConfig) {
      const legacy: unknown = context.globalState.get(LEGACY_KEY);
      const legacyList = Array.isArray(legacy)
        ? legacy.filter((x): x is string => typeof x === 'string')
        : [];
      initial = legacyList.length > 0 ? legacyList : [...DEFAULT_SYMBOLS];
    }
    const store = new Store(initial);
    if (initial) {
      store.persist(initial);
    }
    return store;
  }

  reload(): void {
    const raw: unknown = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<string[]>(WATCHLIST_KEY, []);
    const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    this.core = new WatchlistCore(list, (s) => this.persist(s));
  }

  getAll(): string[] {
    return this.core.getAll();
  }

  has(symbol: string): boolean {
    return this.core.has(symbol);
  }

  add(symbol: string): boolean {
    return this.core.add(symbol);
  }

  remove(symbol: string): boolean {
    return this.core.remove(symbol);
  }

  reorder(symbols: string[]): void {
    this.core.reorder(symbols);
  }

  private persist(symbols: string[]): void {
    void vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .update(WATCHLIST_KEY, symbols, vscode.ConfigurationTarget.Global);
  }

  dispose(): void {}
}
