import * as vscode from 'vscode';
import { Store } from './store';

export interface QuoteSink {
  refresh(symbols: string[]): Promise<void>;
}

export class RefreshManager implements vscode.Disposable {
  private timer: NodeJS.Timeout | null = null;
  private disposing = false;

  constructor(
    private readonly store: Store,
    private readonly sink: QuoteSink,
    private readonly view: vscode.WebviewView,
  ) {}

  start(): void {
    this.updateTimer();
    const interval = () => this.whenVisible();
    this.view.onDidChangeVisibility(interval);
  }

  private whenVisible(): void {
    if (this.view.visible) {
      this.updateTimer();
      void this.refresh();
    } else {
      this.stopTimer();
    }
  }

  private updateTimer(): void {
    this.stopTimer();
    if (!this.view.visible || this.disposing) {
      return;
    }
    const sec = vscode.workspace
      .getConfiguration('aStockWatch')
      .get<number>('refreshIntervalSec', 3);
    const ms = Math.max(1, sec) * 1000;
    this.timer = setInterval(() => void this.refresh(), ms);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const symbols = this.store.getAll();
    await this.sink.refresh(symbols);
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
