export class WatchlistCore {
  private symbols: string[];

  constructor(
    initial: string[],
    private readonly onSave: (symbols: string[]) => void,
  ) {
    this.symbols = [...initial];
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

  reorder(symbols: string[]): void {
    const valid = symbols.filter((s) => typeof s === 'string' && this.symbols.includes(s));
    for (const s of this.symbols) {
      if (!valid.includes(s)) {
        valid.push(s);
      }
    }
    this.symbols = valid;
    this.save();
  }

  private save(): void {
    this.onSave(this.getAll());
  }
}
