import { Memento } from 'vscode';

const KEY = 'aStockWatch.list';
const VERSION_KEY = 'aStockWatch.version';
const INIT_KEY = 'aStockWatch.initialized';
const VERSION = 1;

const DEFAULT_SYMBOLS = ['sh000001', 'sz399001'];

export class Store {
  private symbols: string[];

  constructor(
    private storage: Memento,
    loaded: string[],
  ) {
    this.symbols = loaded;
  }

  static load(storage: Memento): Store {
    const raw: unknown = storage.get(KEY, []);
    const existing = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string')
      : [];
    const store = new Store(storage, existing);
    if (!storage.keys().includes(INIT_KEY)) {
      store.symbols = [...new Set([...DEFAULT_SYMBOLS, ...existing])];
      store.save();
    }
    return store;
  }

  getAll(): string[] {
    return [...this.symbols];
  }

  has(symbol: string): boolean {
    return this.symbols.includes(symbol);
  }

  add(symbol: string): boolean {
    if (this.symbols.includes(symbol)) {
      return false;
    }
    this.symbols.push(symbol);
    this.save();
    return true;
  }

  remove(symbol: string): boolean {
    const idx = this.symbols.indexOf(symbol);
    if (idx === -1) {
      return false;
    }
    this.symbols.splice(idx, 1);
    this.save();
    return true;
  }

  private save(): void {
    void this.storage.update(INIT_KEY, true);
    void this.storage.update(VERSION_KEY, VERSION);
    void this.storage.update(KEY, this.symbols);
  }
}