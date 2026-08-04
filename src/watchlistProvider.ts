import * as vscode from 'vscode';
import { StockQuote, fetchQuotes, formatPrice } from './dataSource';

export class WatchlistProvider implements vscode.TreeDataProvider<string> {
  private _onDidChangeTreeData = new vscode.EventEmitter<string | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private quotes = new Map<string, StockQuote>();
  private symbols: string[] = [];
  private error: string | null = null;

  getChildren(): string[] {
    return this.symbols;
  }

  getTreeItem(symbol: string): vscode.TreeItem {
    const quote = this.quotes.get(symbol);
    const item = new vscode.TreeItem(symbol);
    if (quote) {
      item.label = `${quote.name}  ${quote.symbol}`;
      item.description = formatPrice(quote);
      item.iconPath = new vscode.ThemeIcon(this.iconFor(quote.trend), this.colorFor(quote.trend));
      item.tooltip = `${quote.name}\n最新: ${quote.price.toFixed(2)}\n昨收: ${quote.prevClose.toFixed(2)}\n涨跌: ${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)} (${quote.changePct >= 0 ? '+' : ''}${quote.changePct.toFixed(2)}%)`;
    } else {
      item.label = symbol;
      item.description = '加载中…';
    }
    return item;
  }

  getMessage(): string {
    if (this.error) {
      return this.error;
    }
    return this.quotes.size === 0 ? '暂无自选股，点击 + 添加' : '';
  }

  private iconFor(trend: StockQuote['trend']): string {
    return trend === 'up' ? 'arrow-up' : trend === 'down' ? 'arrow-down' : 'circle';
  }

  private colorFor(trend: StockQuote['trend']): vscode.ThemeColor {
    if (trend === 'up') {
      return new vscode.ThemeColor('charts.red');
    }
    if (trend === 'down') {
      return new vscode.ThemeColor('charts.green');
    }
    return new vscode.ThemeColor('charts.gray');
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  async refresh(symbols: string[]): Promise<void> {
    if (symbols.length === 0) {
      this.symbols = [];
      this.quotes.clear();
      this.error = null;
      this._onDidChangeTreeData.fire(undefined);
      return;
    }
    this.symbols = symbols;
    try {
      const list = await fetchQuotes(symbols);
      const map = new Map<string, StockQuote>();
      for (const q of list) {
        map.set(q.symbol, q);
      }
      this.quotes = map;
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? `行情错误: ${err.message}` : '行情错误';
    }
    this._onDidChangeTreeData.fire(undefined);
  }
}