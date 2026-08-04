import * as vscode from 'vscode';
import { WatchlistCore } from './watchlistCore';

const CONFIG_SECTION = 'aStockWatch';
const WATCHLIST_KEY = 'watchlist';
const LEGACY_KEY = 'aStockWatch.list';
const DEFAULT_SYMBOLS = ['sh000001', 'sz399001'];

export class Store implements vscode.Disposable {
  private core: WatchlistCore;

  constructor(initial?: string[]) {
    this.core = new WatchlistCore(initial ?? this.read(), (s) => this.persist(s));
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

  private read(): string[] {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const inspected = config.inspect<string[]>(WATCHLIST_KEY);
    if (!Store.configSet(inspected)) {
      return [...DEFAULT_SYMBOLS];
    }
    const raw: unknown = config.get<string[]>(WATCHLIST_KEY, []);
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  }

  reload(): void {
    this.core = new WatchlistCore(this.read(), (s) => this.persist(s));
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
