import { Memento } from 'vscode';

const KEY = 'aStockWatch.list';
const VERSION_KEY = 'aStockWatch.version';
const VERSION = 1;

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
    const list = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string')
      : [];
    return new Store(storage, list);
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
    void this.storage.update(VERSION_KEY, VERSION);
    void this.storage.update(KEY, this.symbols);
  }
}