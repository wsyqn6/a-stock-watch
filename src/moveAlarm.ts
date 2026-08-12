import * as vscode from 'vscode';
import { RefreshManager, QuoteSink } from './refreshManager';
import { StockQuote, fetchQuotes } from './dataSource';
import { Store } from './store';
import { MinuteDetailPanel } from './minuteDetailPanel';
import { MoveAlarmState, hitDirection } from './moveAlarmCore';

/** 告警后台轮询间隔：独立于侧边栏刷新频率，异动检测无需秒级，拉长降开销。 */
const ALARM_INTERVAL_SEC = 15;

/**
 * 大幅异动通知：后台常驻（不依赖侧边栏可见性），交易时段轮询全量自选股，
 * 涨跌幅越过阈值时弹右下角通知。默认关闭，开启才产生请求。
 */
export class MoveAlarm implements QuoteSink, vscode.Disposable {
  private manager: RefreshManager;
  private state: MoveAlarmState;
  private enabled = false;
  private thresholdPct = 5;
  private boss = false;
  private configSub: vscode.Disposable;

  constructor(private readonly store: Store) {
    this.state = new MoveAlarmState(30 * 60_000);
    this.applyConfig();
    this.manager = new RefreshManager(this, undefined, ALARM_INTERVAL_SEC);
    this.configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aStockWatch')) {
        this.applyConfig();
      }
    });
  }

  start(): void {
    this.manager.start();
  }

  private applyConfig(): void {
    const cfg = vscode.workspace.getConfiguration('aStockWatch');
    this.enabled = !!cfg.get('bigMoveAlert', false);
    this.thresholdPct = cfg.get('bigMoveAlertPct', 5);
    const cooldownMin = Math.max(1, cfg.get('bigMoveAlertCooldownMin', 30));
    this.state = new MoveAlarmState(cooldownMin * 60_000);
    this.boss = !!cfg.get('bossMode', false);
  }

  getSymbols(): string[] {
    return this.store.getAll();
  }

  async refresh(symbols: string[]): Promise<void> {
    if (!this.enabled || this.boss || symbols.length === 0) {
      return;
    }
    let quotes: StockQuote[];
    try {
      quotes = await fetchQuotes(symbols);
    } catch {
      return;
    }
    const now = Date.now();
    for (const q of quotes) {
      const dir = hitDirection(q.changePct, this.thresholdPct);
      if (dir && this.state.shouldNotify(q.symbol, dir, now)) {
        this.notify(q);
      }
    }
  }

  private notify(q: StockQuote): void {
    const code = q.symbol.slice(2);
    const sign = q.changePct > 0 ? '+' : '';
    const msg = `${q.name} ${code} 现价 ${q.price.toFixed(2)} ${sign}${q.changePct.toFixed(2)}%`;
    void vscode.window.showWarningMessage(msg, '查看走势').then((action) => {
      if (action === '查看走势') {
        MinuteDetailPanel.open(q.symbol, q);
      }
    });
  }

  dispose(): void {
    this.configSub.dispose();
    this.manager.dispose();
  }
}
