import {
  MinuteData,
  MinuteGap,
  MinutePoint,
  SparkData,
  StockQuote,
  beijingDateStr,
  beijingTimeStr,
  buildSpark,
  isMinuteFinal,
  isPreOpen,
  isSessionOver,
  isTradingDay,
  isTradingTime,
  resolveMinuteGap,
  sessionMinute,
} from './dataSource';

/** 单个标的的日内状态：分时种子 + 行情快照累积。 */
interface IntradayEntry {
  date: string;
  prevClose: number;
  seed: MinuteData | null;
  /** 行情快照按分钟聚合，同一分钟只留最后一个价 */
  live: MinutePoint[];
  gap: MinuteGap;
  done: boolean;
  seedKey: string;
}

/** 缺口判定阈值：本地序列落后当前交易分钟超过该值才补种子。 */
const SEED_GAP_MIN = 5;
/** 本地分钟桶上限（一个交易日 240 分钟）。 */
const LIVE_MAX = 240;
/** 快照保留点数上限：240 分钟 + 15:00 收尾点。 */
const SNAPSHOT_MAX = LIVE_MAX + 1;

/** 单个标的的持久化快照。只存序列本身，不存完整分时 payload。 */
export interface IntradaySnapshotEntry {
  date: string;
  prevClose: number;
  /** [HHMM, 价格]，按时间升序 */
  points: [string, number][];
}

export interface IntradaySnapshot {
  v: 1;
  entries: Record<string, IntradaySnapshotEntry>;
}

function newEntry(date: string, prevClose: number): IntradayEntry {
  return { date, prevClose, seed: null, live: [], gap: 'ok', done: false, seedKey: '' };
}

/** 行情时间转 HHMM；支持 HHMMSS / HHMM。非法值返回 null。 */
function quoteMinute(time: string | undefined): string | null {
  const m = time ? /^(\d{2})(\d{2})/.exec(time) : null;
  if (!m) {
    return null;
  }
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh <= 23 && mm <= 59 ? `${m[1]}${m[2]}` : null;
}

function seedKey(data: MinuteData | null): string {
  const last = data?.points[data.points.length - 1];
  return data ? `${data.date}|${data.points.length}|${last?.time ?? ''}|${last?.price ?? ''}|${last?.vol ?? ''}` : '';
}

/**
 * 日内序列的唯一事实源。
 *
 * - 行情快照：按分钟聚合，同分钟覆盖，不产生额外请求
 * - 分时种子：只在缺历史/有缺口时由调用方补拉，合并到本地序列
 * - 日期守卫：交易时段内只认当天数据，避免开盘画上一交易日
 *
 * 纯内存、无 vscode 依赖，时间可注入，便于单测。
 */
export class IntradayBook {
  private readonly entries = new Map<string, IntradayEntry>();

  /** 行情刷新时写入本地分钟桶，返回内容是否变化。 */
  recordQuotes(quotes: StockQuote[], now: Date = new Date()): boolean {
    let changed = false;
    const today = beijingDateStr(now);
    const trading = isTradingTime(now);
    for (const q of quotes) {
      const date = q.date || today;
      let entry = this.entries.get(q.symbol);
      // 旧行情不覆盖新一天；日期前进则重置
      if (entry && entry.date && date < entry.date) {
        continue;
      }
      if (!entry || date > entry.date) {
        entry = newEntry(date, q.prevClose);
        this.entries.set(q.symbol, entry);
        changed = true;
      }
      if (entry.prevClose !== q.prevClose) {
        entry.prevClose = q.prevClose;
        changed = true;
      }
      if (!trading || date !== today || !(q.price > 0)) {
        continue;
      }
      const time = quoteMinute(q.time) ?? beijingTimeStr(now).slice(0, 4);
      // 集合竞价与收盘后不进入分时桶；15:00 由分时种子补收尾点
      if (time < '0930' || time > '1500') {
        continue;
      }
      const last = entry.live[entry.live.length - 1];
      if (last && last.time === time) {
        if (last.price !== q.price) {
          entry.live[entry.live.length - 1] = { ...last, price: q.price };
          changed = true;
        }
      } else if (!last || time > last.time) {
        entry.live.push({ time, price: q.price });
        if (entry.live.length > LIVE_MAX) {
          entry.live.splice(0, entry.live.length - LIVE_MAX);
        }
        changed = true;
      }
    }
    return changed;
  }

  /** 合并一次分时种子，返回内容是否变化。 */
  applySeed(
    symbol: string,
    data: MinuteData,
    quote: StockQuote,
    now: Date = new Date(),
  ): boolean {
    const today = beijingDateStr(now);
    if (!data.date || data.date > today) {
      return false;
    }
    // 交易时段只接受当天分时；非交易日允许最近一个交易日
    if (isTradingDay(now) && data.date !== today) {
      return false;
    }
    let entry = this.entries.get(symbol);
    if (entry && entry.date && data.date < entry.date) {
      return false;
    }
    if (!entry || data.date > entry.date) {
      entry = newEntry(data.date, quote.prevClose);
      this.entries.set(symbol, entry);
    }
    entry.prevClose = quote.prevClose;
    const gap = resolveMinuteGap(data, quote.state, now);
    const done = isMinuteFinal(data, gap, now);
    const key = seedKey(data);
    const changed = entry.seedKey !== key || entry.gap !== gap || entry.done !== done;
    entry.seed = data;
    entry.gap = gap;
    entry.done = done;
    entry.seedKey = key;
    return changed;
  }

  /** 是否需要补拉分时种子。盘前、非交易日、已定格时不补。 */
  needsSeed(symbol: string, quote: StockQuote, now: Date = new Date()): boolean {
    if (quote.state === 'S' || quote.state === 'D') {
      return false;
    }
    if (!isTradingDay(now) || isPreOpen(now)) {
      return false;
    }
    const today = beijingDateStr(now);
    const entry = this.entries.get(symbol);
    if (!entry || entry.date !== today) {
      return true;
    }
    const data = this.merged(symbol, now);
    if (!data || data.points.length < 2) {
      return true;
    }
    // 首点晚于 09:30 说明缺开盘段
    if (sessionMinute(data.points[0].time) > 0) {
      return true;
    }
    // 恢复快照后行情从当前分钟续写，种子与行情之间可能有空档
    const seedLast = entry.seed?.points[entry.seed.points.length - 1];
    const liveFirst = entry.live[0];
    if (
      seedLast &&
      liveFirst &&
      sessionMinute(liveFirst.time) - sessionMinute(seedLast.time) > SEED_GAP_MIN
    ) {
      return true;
    }
    const current = sessionMinute(beijingTimeStr(now).slice(0, 4));
    const last = data.points[data.points.length - 1];
    if (current - sessionMinute(last.time) > SEED_GAP_MIN) {
      return true;
    }
    return isSessionOver(now) && !entry.done;
  }

  /** 合并分时种子与本地行情；日期不匹配或交易时段拿到旧日期时返回 null。 */
  merged(symbol: string, now: Date = new Date()): MinuteData | null {
    const entry = this.entries.get(symbol);
    if (!entry) {
      return null;
    }
    const today = beijingDateStr(now);
    if (entry.date > today) {
      return null;
    }
    // 交易时段内只画当天；非交易日允许最近交易日
    if (isTradingDay(now) && entry.date !== today) {
      return null;
    }
    const seed = entry.seed && entry.seed.date === entry.date ? entry.seed : null;
    const points: MinutePoint[] = seed ? seed.points.map((p) => ({ ...p })) : [];
    for (const p of entry.live) {
      if (points.length === 0) {
        points.push({ ...p });
        continue;
      }
      const last = points[points.length - 1];
      if (p.time > last.time) {
        points.push({ ...p });
      } else if (p.time === last.time) {
        // 同一分钟行情更新更快，只覆盖价格，保留种子的成交量/成交额
        points[points.length - 1] = { ...last, price: p.price };
      }
    }
    return points.length > 0 ? { date: entry.date, points } : null;
  }

  /** 迷你图数据：始终用最新行情价的 prevClose 与本地序列。 */
  spark(symbol: string, quote: StockQuote, now: Date = new Date()): SparkData | null {
    const entry = this.entries.get(symbol);
    if (!entry || (quote.date && entry.date !== quote.date)) {
      return null;
    }
    const data = this.merged(symbol, now);
    return data ? buildSpark(data, quote.prevClose) : null;
  }

  /** 迷你图区的缺口状态；本地已有至少两个价点时优先认为可画。 */
  gap(symbol: string, quote: StockQuote, now: Date = new Date()): MinuteGap {
    if (quote.state === 'D') {
      return 'delisted';
    }
    if (quote.state === 'S') {
      return 'suspended';
    }
    const entry = this.entries.get(symbol);
    const data = this.merged(symbol, now);
    if (!data || data.points.length < 2) {
      return isPreOpen(now) ? 'ok' : 'no-data';
    }
    if (entry && (entry.gap === 'no-data' || entry.gap === 'no-trade')) {
      return entry.live.length >= 2 ? 'ok' : entry.gap;
    }
    return entry?.gap ?? 'ok';
  }

  /**
   * 导出可持久化的日内快照。
   * 交易时段只导出当天，非交易日保留最近交易日；点数不足两个的画不出图，直接丢弃。
   */
  snapshot(now: Date = new Date()): IntradaySnapshot {
    const entries: Record<string, IntradaySnapshotEntry> = {};
    const today = beijingDateStr(now);
    for (const [symbol, entry] of this.entries) {
      if (!entry.date || entry.date > today) {
        continue;
      }
      if (isTradingDay(now) && entry.date !== today) {
        continue;
      }
      if (!(entry.prevClose > 0)) {
        continue;
      }
      const data = this.merged(symbol, now);
      if (!data || data.points.length < 2) {
        continue;
      }
      entries[symbol] = {
        date: entry.date,
        prevClose: entry.prevClose,
        points: data.points
          .slice(-SNAPSHOT_MAX)
          .map((p) => [p.time, p.price] as [string, number]),
      };
    }
    return { v: 1, entries };
  }

  /**
   * 恢复持久化快照，供打开面板时立即出图。
   * 只接受当天（非交易日接受最近交易日）且结构合法的条目，损坏数据静默忽略。
   */
  restore(snapshot: IntradaySnapshot | null | undefined, now: Date = new Date()): void {
    if (!snapshot || snapshot.v !== 1 || !snapshot.entries || typeof snapshot.entries !== 'object') {
      return;
    }
    const today = beijingDateStr(now);
    for (const [symbol, raw] of Object.entries(snapshot.entries)) {
      if (!symbol || !raw || typeof raw !== 'object') {
        continue;
      }
      const { date, prevClose, points: rawPoints } = raw;
      if (typeof date !== 'string' || !/^\d{8}$/.test(date) || date > today) {
        continue;
      }
      if (isTradingDay(now) && date !== today) {
        continue;
      }
      if (typeof prevClose !== 'number' || !Number.isFinite(prevClose) || prevClose <= 0) {
        continue;
      }
      if (!Array.isArray(rawPoints)) {
        continue;
      }
      const points: MinutePoint[] = [];
      for (const p of rawPoints) {
        if (!Array.isArray(p)) {
          continue;
        }
        const [time, price] = p as [unknown, unknown];
        if (typeof time !== 'string' || !/^\d{4}$/.test(time)) {
          continue;
        }
        if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
          continue;
        }
        // 保持升序去重，避免损坏数据把折线画成回环
        if (points.length > 0 && time <= points[points.length - 1].time) {
          continue;
        }
        points.push({ time, price });
      }
      if (points.length < 2) {
        continue;
      }
      const entry = newEntry(date, prevClose);
      entry.seed = { date, points };
      entry.seedKey = seedKey(entry.seed);
      this.entries.set(symbol, entry);
    }
  }

  has(symbol: string): boolean {
    return this.entries.has(symbol);
  }

  isDone(symbol: string): boolean {
    return this.entries.get(symbol)?.done ?? false;
  }

  /** 供详情面板复用的分时种子。 */
  seedData(symbol: string): MinuteData | null {
    return this.entries.get(symbol)?.seed ?? null;
  }

  prune(symbols: Iterable<string>): void {
    const keep = new Set(symbols);
    for (const symbol of [...this.entries.keys()]) {
      if (!keep.has(symbol)) {
        this.entries.delete(symbol);
      }
    }
  }

  clear(symbol?: string): void {
    if (symbol) {
      this.entries.delete(symbol);
    } else {
      this.entries.clear();
    }
  }
}
