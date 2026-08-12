export type MoveDir = 'up' | 'down';

/** 涨跌幅是否命中阈值；返回异动方向，未命中返回 null。 */
export function hitDirection(changePct: number, thresholdPct: number): MoveDir | null {
  if (changePct >= thresholdPct) {
    return 'up';
  }
  if (changePct <= -thresholdPct) {
    return 'down';
  }
  return null;
}

/** 冷却状态机：同股同方向冷却期内不再触发。 */
export class MoveAlarmState {
  private last = new Map<string, number>();

  constructor(private readonly cooldownMs: number) {}

  /** 应触发返回 true 并记录本次触发时间；冷却期内返回 false。 */
  shouldNotify(symbol: string, dir: MoveDir, now: number): boolean {
    const key = `${symbol}|${dir}`;
    const ts = this.last.get(key);
    if (ts !== undefined && now - ts < this.cooldownMs) {
      return false;
    }
    this.last.set(key, now);
    return true;
  }
}
