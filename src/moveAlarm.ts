import * as vscode from 'vscode';
import { RefreshManager, QuoteSink } from './refreshManager';
import { StockQuote } from './dataSource';
import { Store } from './store';
import { MinuteDetailPanel } from './minuteDetailPanel';
import { MoveAlarmState, hitDirection } from './moveAlarmCore';
import { fetchQuotesCached } from './quoteCache';
import { config } from './config';

/** 告警后台轮询间隔：独立于侧边栏刷新频率，异动检测无需秒级，拉长降开销。 */
const ALARM_INTERVAL_SEC = 15;

/**
 * 大幅异动通知：后台常驻（不依赖侧边栏可见性），交易时段轮询全量自选股，
 * 涨跌幅越过阈值时弹右下角通知。默认关闭，开启才产生请求。
 */
export class MoveAlarm implements QuoteSink, vscode.Disposable {
  private manager: RefreshManager;
  /** 冷却状态，构造与冷却时长变化时重建。 */
  private state = new MoveAlarmState(0);
  private cooldownMin = 0;
  private enabled = false;
  private thresholdPct = 5;
  private boss = false;
  private configSub: vscode.Disposable;

  constructor(private readonly store: Store) {
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
    this.enabled = config.bigMoveAlert();
    this.thresholdPct = config.bigMoveAlertPct();
    this.boss = config.bossMode();
    // 仅冷却时长变化才重建冷却记录：无关配置改动若一并重建，会让冷却失效重复通知。
    const cooldownMin = Math.max(1, config.bigMoveAlertCooldownMin());
    if (cooldownMin !== this.cooldownMin) {
      this.cooldownMin = cooldownMin;
      this.state = new MoveAlarmState(cooldownMin * 60_000);
    }
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
      quotes = await fetchQuotesCached(symbols);
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
