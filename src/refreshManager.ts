import * as vscode from 'vscode';
import { isTradingTime } from './dataSource';
import { config } from './config';

export interface QuoteSink {
  getSymbols(): string[];
  refresh(symbols: string[]): Promise<void>;
}

export class RefreshManager implements vscode.Disposable {
  private timer: NodeJS.Timeout | null = null;
  private disposing = false;
  private refreshing = false;
  private configSub: vscode.Disposable | null = null;

  constructor(
    private readonly sink: QuoteSink,
    private readonly view?: vscode.WebviewView,
    private readonly intervalSecOverride?: number,
  ) {
    // 间隔取自配置时自监听，保证设置改动即时生效；固定间隔（如异动 15s）无需监听。
    if (intervalSecOverride === undefined) {
      this.configSub = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('aStockWatch.refreshIntervalSec')) {
          this.updateTimer();
        }
      });
    }
  }

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
    const sec =
      this.intervalSecOverride ??
      config.refreshIntervalSec();
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
    this.configSub?.dispose();
    this.configSub = null;
  }
}
