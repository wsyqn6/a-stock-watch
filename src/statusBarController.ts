import * as vscode from 'vscode';
import { Store } from './store';
import { RefreshManager, QuoteSink } from './refreshManager';
import { StockQuote, fetchQuotes } from './dataSource';

const UP = { dark: '#F07862', light: '#C73E2E' };
const DOWN = { dark: '#2FAE75', light: '#2F8F5B' };

interface StatusBarPair {
  name: vscode.StatusBarItem;
  pct: vscode.StatusBarItem;
}

export class StatusBarController implements QuoteSink, vscode.Disposable {
  private pairs = new Map<string, StatusBarPair>();
  private quotes = new Map<string, StockQuote>();
  private manager: RefreshManager;
  private themeSub: vscode.Disposable;
  private boss = false;
  private disposed = false;

  constructor(private readonly store: Store) {
    this.manager = new RefreshManager(this, undefined);
    this.themeSub = vscode.window.onDidChangeActiveColorTheme(() => this.reapplyColors());
  }

  start(): void {
    this.manager.start();
  }

  getSymbols(): string[] {
    return this.store.getStatusBar();
  }

  setBoss(v: boolean): void {
    this.boss = v;
    this.reapplyColors();
  }

  async refresh(symbols: string[]): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (symbols.length > 0) {
      try {
        for (const q of await fetchQuotes(symbols)) {
          this.quotes.set(q.symbol, q);
        }
      } catch {
        // keep last quotes
      }
    }
    this.reconcile(symbols);
  }

  refreshNow(): Promise<void> {
    return this.manager.refresh();
  }

  private sig = '';
  private reconcile(symbols: string[]): void {
    const sig = symbols.join(',');
    const rebuild = sig !== this.sig;
    this.sig = sig;
    const wanted = new Set(symbols);
    for (const [sym, pair] of this.pairs) {
      if (!wanted.has(sym) || rebuild) {
        pair.name.dispose();
        pair.pct.dispose();
        this.pairs.delete(sym);
      }
    }
    symbols.forEach((sym, i) => {
      const q = this.quotes.get(sym);
      if (!q) {
        return;
      }
      let pair = this.pairs.get(sym);
      if (!pair) {
        pair = {
          name: createItem(1000 - 2 * i),
          pct: createItem(1000 - 2 * i - 1),
        };
        this.pairs.set(sym, pair);
      }
      pair.name.text = q.name;
      pair.name.tooltip = tooltip(q);
      pair.pct.text = fmtPct(q.changePct);
      pair.pct.tooltip = tooltip(q);
      pair.pct.color = this.colorFor(q.changePct);
      pair.name.show();
      pair.pct.show();
    });
  }

  private reapplyColors(): void {
    for (const [sym, pair] of this.pairs) {
      const q = this.quotes.get(sym);
      if (q) {
        pair.pct.color = this.colorFor(q.changePct);
      }
    }
  }

  private colorFor(pct: number): string | undefined {
    if (this.boss) {
      return undefined;
    }
    const dark =
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
    if (pct > 0) {
      return dark ? UP.dark : UP.light;
    }
    if (pct < 0) {
      return dark ? DOWN.dark : DOWN.light;
    }
    return undefined;
  }

  dispose(): void {
    this.disposed = true;
    this.manager.dispose();
    this.themeSub.dispose();
    for (const pair of this.pairs.values()) {
      pair.name.dispose();
      pair.pct.dispose();
    }
    this.pairs.clear();
  }
}

function createItem(priority: number): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, priority);
  item.command = { title: '显示自选股', command: 'a-stock-watch.show' };
  return item;
}

function fmtPct(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

function tooltip(q: StockQuote): string {
  const sign = q.change >= 0 ? '+' : '';
  return [
    `${q.name} ${q.symbol.slice(2)}`,
    `现价 ${q.price.toFixed(2)}`,
    `昨收 ${q.prevClose.toFixed(2)}`,
    `涨跌 ${sign}${q.change.toFixed(2)} (${sign}${q.changePct.toFixed(2)}%)`,
  ].join('\n');
}
