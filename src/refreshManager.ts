import * as vscode from 'vscode';
import { isTradingTime } from './dataSource';

export interface QuoteSink {
  getSymbols(): string[];
  refresh(symbols: string[]): Promise<void>;
}

export class RefreshManager implements vscode.Disposable {
  private timer: NodeJS.Timeout | null = null;
  private disposing = false;
  private refreshing = false;

  constructor(
    private readonly sink: QuoteSink,
    private readonly view?: vscode.WebviewView,
  ) {}

  start(): void {
    this.handleVisibility();
  }

  handleVisibility(): void {
    if (!this.view || this.view.visible) {
      this.updateTimer();
      void this.refresh();
    } else {
      this.stopTimer();
    }
  }

  private updateTimer(): void {
    this.stopTimer();
    if ((this.view && !this.view.visible) || this.disposing) {
      return;
    }
    const sec = vscode.workspace
      .getConfiguration('aStockWatch')
      .get<number>('refreshIntervalSec', 3);
    const ms = Math.max(1, sec) * 1000;
    this.timer = setInterval(() => void this.autoRefresh(), ms);
  }

  private autoRefresh(): Promise<void> {
    if (!isTradingTime()) {
      return Promise.resolve();
    }
    return this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.refreshing) {
      return;
    }
    const symbols = this.sink.getSymbols();
    this.refreshing = true;
    try {
      await this.sink.refresh(symbols);
    } finally {
      this.refreshing = false;
    }
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.disposing = true;
    this.stopTimer();
  }
}
