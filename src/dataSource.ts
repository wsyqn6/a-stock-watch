import { fetchWithTimeout } from './http';
import { trimCache } from './util';
import type { KlineSeries, MinuteSeriesPoint } from './chartView';

/** 图表数据包类型随 dataSource 一并导出，调用方不必同时引 chartView。 */
export type { KlineSeries, MinuteSeriesPoint };

export interface KlinePoint {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

const KLINE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=';

export type KlinePeriod = 'day' | 'week' | 'month';

/** 收盘价均线周期。 */
const MA_PERIODS = [5, 10, 20] as const;
/** 均量线周期。 */
const VOL_MA_PERIOD = 5;

/**
 * 一次抓取的 K 线根数。webview 按面板宽度决定默认可见根数（约每根 6px），
 * 这里给宽面板留足历史，也给放大后回看留出余量。
 */
export const KLINE_FETCH_COUNT = 240;

const klineCache = new Map<string, { data: KlinePoint[]; ts: number }>();
const KLINE_TTL_MS = 60_000;
/** K 线缓存最大条目数（每标的每周期一条），超过则淘汰最旧，避免长时间会话无界增长。 */
const KLINE_CACHE_MAX = 32;

export async function fetchKline(
  symbol: string,
  count = 300,
  period: KlinePeriod = 'day',
): Promise<KlinePoint[]> {
  const cacheKey = `${symbol}|${period}`;
  const hit = klineCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < KLINE_TTL_MS) {
    return hit.data;
  }
  const url = KLINE_URL + encodeURIComponent(`${symbol},${period},,,${count},qfq`);
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`K线接口返回 ${res.status}`);
  }
  const text = await res.text();
  const data = parseKlineResponse(text, symbol, period);
  klineCache.set(cacheKey, { data, ts: Date.now() });
  trimCache(klineCache, KLINE_CACHE_MAX);
  return data;
}

export function clearKlineCache(symbol?: string): void {
  if (symbol) {
    const prefix = `${symbol}|`;
    for (const key of [...klineCache.keys()]) {
      if (key.startsWith(prefix)) {
        klineCache.delete(key);
      }
    }
    return;
  }
  klineCache.clear();
}

export function parseKlineResponse(
  text: string,
  symbol: string,
  period: KlinePeriod = 'day',
): KlinePoint[] {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return [];
  }
  const data = (root as { data?: Record<string, unknown> } | null)?.data;
  const node = data?.[symbol] as Record<string, string[][]> | undefined;
  // 指数（sh000001/sz399001 等）无复权，接口只返回 day/week/month 键；
  // 个股返回 qfqday/qfqweek/qfqmonth。优先取 qfq 键，缺则回退非前缀键。
  const prefixed = period === 'day' ? 'qfqday' : period === 'week' ? 'qfqweek' : 'qfqmonth';
  const rows = node?.[prefixed] ?? node?.[period] ?? [];
  return rows
    .map((r) => ({
      date: r[0],
      open: Number(r[1]),
      close: Number(r[2]),
      high: Number(r[3]),
      low: Number(r[4]),
      volume: Number(r[5]),
    }))
    .filter((p) => p.close > 0);
}

/** 大盘概览可选的跟踪指数（腾讯行情符号），默认上证。 */
export const MARKET_INDEX_OPTIONS = ['sh000001', 'sz399001', 'sz399006'] as const;
export type MarketIndexSymbol = (typeof MARKET_INDEX_OPTIONS)[number];

export interface MarketBreadth {
  up: number;
  down: number;
  flat: number;
}

/** 东财市场涨跌家数接口：`f104` 上涨 / `f105` 下跌 / `f106` 平盘。secids 覆盖沪深京全 A（上证指数、深证成指、北证指数），指数口径按各自成分股（沪A/深A/京A，不含 B 股，上证50 验证）。多主机兜底防限流。 */
const BREADTH_HOSTS = [
  'https://push2.eastmoney.com',
  'https://push2delay.eastmoney.com',
];

export async function fetchMarketBreadth(): Promise<MarketBreadth> {
  let lastErr: unknown;
  for (const base of BREADTH_HOSTS) {
    try {
      const url =
        `${base}/api/qt/ulist.np/get?fltt=2&secids=1.000001,0.399001,0.899050&fields=f104,f105,f106`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        throw new Error(`涨跌家数接口返回 ${res.status}`);
      }
      const breadth = parseBreadthResponse(await res.text());
      if (breadth) {
        return breadth;
      }
      throw new Error('涨跌家数接口数据异常');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('涨跌家数接口不可用');
}

export function parseBreadthResponse(text: string): MarketBreadth | null {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  const diff = (root as { data?: { diff?: unknown[] } } | null)?.data?.diff;
  if (!Array.isArray(diff) || diff.length === 0) {
    return null;
  }
  let up = 0;
  let down = 0;
  let flat = 0;
  for (const row of diff) {
    const rec = row as { f104?: unknown; f105?: unknown; f106?: unknown } | null;
    up += toCount(rec?.f104);
    down += toCount(rec?.f105);
    flat += toCount(rec?.f106);
  }
  if (up + down + flat === 0) {
    return null;
  }
  return { up, down, flat };
}

/** 转为非负整数；NaN/负数/缺省按 0 计。 */
function toCount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  open?: number;
  high?: number;
  low?: number;
  change: number;
  changePct: number;
  trend: 'up' | 'down' | 'flat';
  date: string;
  /** 行情时间 HHMMSS（腾讯字段 30），缺失时为空 */
  time?: string;
  /** 换手率 % */
  turnoverRate?: number;
  /** 市盈率 TTM */
  pe?: number;
  /** 市净率 */
  pb?: number;
  /** 流通市值（元） */
  circMcap?: number;
  /** 总市值（元） */
  totalMcap?: number;
  /** 成交额（元） */
  amount?: number;
  /** 振幅 % */
  amplitude?: number;
  /** 涨停价 */
  limitUp?: number;
  /** 跌停价 */
  limitDown?: number;
  /** 量比 */
  volRatio?: number;
  /** 均价 */
  avgPrice?: number;
  /** 外盘（手） */
  outerVol?: number;
  /** 内盘（手） */
  innerVol?: number;
  /** 数据源状态字母（腾讯字段40）：S=停牌 D=退市；正常交易为空/缺省 */
  state?: string;
}

const TENCENT_URL = 'https://qt.gtimg.cn/q=';
/** 腾讯行情 `~` 分隔字段的索引（保持与接口约定一致，便于维护）。 */
const F = {
  name: 1,
  code: 2,
  price: 3,
  prevClose: 4,
  open: 5,
  outerVol: 7,
  innerVol: 8,
  date: 30,
  change: 31,
  changePct: 32,
  high: 33,
  low: 34,
  amountYi: 37,
  turnover: 38,
  pe: 39,
  amplitude: 43,
  circMcapYi: 44,
  totalMcapYi: 45,
  pb: 46,
  limitUp: 47,
  limitDown: 48,
  volRatio: 49,
  /** 状态字母：空=正常 S=停牌 D=退市 */
  state: 40,
  avgPrice: 51,
};
const MIN_FIELDS = F.high; // 至少含到最高价字段（索引33）即可解析，high/low 可能缺失

/** 转为有效正数；无效（NaN/0/负数）返回 undefined。 */
export function toFinitePos(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export async function fetchQuotes(symbols: string[]): Promise<StockQuote[]> {
  if (symbols.length === 0) {
    return [];
  }
  const url = TENCENT_URL + symbols.join(',');
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`行情接口返回 ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder('gb18030').decode(buf);
  const quotes = parseTencentResponse(text);
  noteMarketDate(quotes.map((q) => q.date));
  return quotes;
}

export function parseTencentResponse(text: string): StockQuote[] {
  const quotes: StockQuote[] = [];
  const re = /v_(\w+)=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const symbol = m[1];
    const fields = m[2].split('~');
    if (fields.length < MIN_FIELDS) {
      continue;
    }
    const name = fields[F.name];
    const price = Number(fields[F.price]);
    const prevClose = Number(fields[F.prevClose]);
    if (!Number.isFinite(price) || !Number.isFinite(prevClose)) {
      continue;
    }
    const open = toFinitePos(fields[F.open]);
    const high = toFinitePos(fields[F.high]);
    const low = toFinitePos(fields[F.low]);
    const change = Number(fields[F.change]);
    const changePct = Number(fields[F.changePct]);
    const trend: StockQuote['trend'] =
      changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'flat';
    const dt = /^(\d{8})(\d{6})?/.exec(fields[F.date]);
    const date = dt?.[1] ?? '';
    const time = dt?.[2];
    const circMcapYi = toFinitePos(fields[F.circMcapYi]);
    const totalMcapYi = toFinitePos(fields[F.totalMcapYi]);
    const amountYi = toFinitePos(fields[F.amountYi]);
    quotes.push({
      symbol,
      name,
      price,
      prevClose,
      open,
      high,
      low,
      change,
      changePct,
      trend,
      date,
      time,
      turnoverRate: toFinitePos(fields[F.turnover]),
      pe: toFinitePos(fields[F.pe]),
      pb: toFinitePos(fields[F.pb]),
      circMcap: circMcapYi !== undefined ? circMcapYi * 1e8 : undefined,
      totalMcap: totalMcapYi !== undefined ? totalMcapYi * 1e8 : undefined,
      amount: amountYi !== undefined ? amountYi * 1e4 : undefined,
      amplitude: toFinitePos(fields[F.amplitude]),
      limitUp: toFinitePos(fields[F.limitUp]),
      limitDown: toFinitePos(fields[F.limitDown]),
      volRatio: toFinitePos(fields[F.volRatio]),
      avgPrice: toFinitePos(fields[F.avgPrice]),
      outerVol: toFinitePos(fields[F.outerVol]),
      innerVol: toFinitePos(fields[F.innerVol]),
      // 字段40 可能缺省（MIN_FIELDS=33），仅接受已知状态字母
      state: fields.length > F.state && /^[A-Z]$/.test(fields[F.state]) ? fields[F.state] : undefined,
    });
  }
  return quotes;
}

export interface MinutePoint {
  time: string;
  price: number;
  vol?: number;
  amt?: number;
}

export interface MinuteData {
  date: string;
  points: MinutePoint[];
}

export interface SparkData {
  color: 'up' | 'down' | 'flat';
  line: string;
  area: string;
  baseY: number;
}

/**
 * 迷你图内容签名：颜色、基准线或折线任一变化都需要重绘。
 * 用于「内容是否变化」判定，替代缓存命中标志（fresh 只表示本次是否走网络）。
 */
export function sparkKey(s: SparkData | null): string {
  return s && s.line ? `${s.color}|${s.baseY}|${s.line}` : '';
}

const MINUTE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=';
const SPARK_WIDTH = 100;
const SPARK_HEIGHT = 18;
const SPARK_PAD = 1;
const SAMPLE_STEP = 5;

const minuteCache = new Map<string, { data: MinuteData; ts: number }>();
const minuteInflight = new Map<string, Promise<MinuteData>>();
const MINUTE_TTL_MS = 60_000;
/** 分时缓存最大条目数，超过则淘汰最旧，避免自选股频繁增删时无界增长。 */
const MINUTE_CACHE_MAX = 64;

export interface MinuteResult {
  data: MinuteData;
  fresh: boolean;
}

export async function fetchMinute(symbol: string): Promise<MinuteData> {
  const res = await fetchWithTimeout(MINUTE_URL + encodeURIComponent(symbol));
  if (!res.ok) {
    throw new Error(`分时接口返回 ${res.status}`);
  }
  const text = await res.text();
  return parseMinuteResponse(text, symbol);
}

export function parseMinuteResponse(text: string, symbol: string): MinuteData {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { date: '', points: [] };
  }
  const data = (root as { data?: Record<string, unknown> } | null)?.data;
  const node = data?.[symbol] as { data?: { date?: string; data?: string[] } } | undefined;
  const date = node?.data?.date ?? '';
  const points: MinutePoint[] = [];
  for (const row of node?.data?.data ?? []) {
    // vol/amt 各自可选：北交所仅 3 字段（time price vol），无成交额
    const m = /^(\d{4})\s+([\d.]+)(?:\s+(\d+))?(?:\s+([\d.]+))?/.exec(row.trim());
    if (m) {
      const price = Number(m[2]);
      if (!Number.isFinite(price) || price <= 0) {
        continue;
      }
      const point: MinutePoint = { time: m[1], price };
      if (m[3] !== undefined) {
        point.vol = Number(m[3]);
      }
      if (m[4] !== undefined) {
        point.amt = Number(m[4]);
      }
      points.push(point);
    }
  }
  return { date, points };
}

/** 分时数据可用性：正常/停牌/退市/零成交/无数据。 */
export type MinuteGap = 'ok' | 'suspended' | 'delisted' | 'no-trade' | 'no-data';

/**
 * 判断分时数据缺口类型。
 * 优先用行情状态字段（腾讯 f40：S=停牌 D=退市）区分停牌与零成交；
 * 无状态信息时退回数据特征：
 * - no-data：可解析价格点不足 2 个（接口无数据/垃圾行）
 * - no-trade：有价格点但有效成交点不足 2 个（零成交/停牌兜底）
 * @param state 行情状态字母（StockQuote.state）
 */
export function minuteGapStatus(data: MinuteData, state?: string): MinuteGap {
  if (state === 'D') {
    return 'delisted';
  }
  if (state === 'S') {
    return 'suspended';
  }
  if (data.points.length < 2) {
    return 'no-data';
  }
  const traded = data.points.filter((p) => p.vol !== undefined && p.vol > 0).length;
  return traded < 2 ? 'no-trade' : 'ok';
}

/** 各缺口状态的展示文案（详情图区与侧栏迷你图区共用）。 */
export const GAP_TEXT: Record<MinuteGap, string> = {
  ok: '',
  suspended: '停牌',
  delisted: '已退市',
  'no-trade': '无成交',
  'no-data': '分时数据缺失',
};

export async function getMinuteCached(
  symbol: string,
  ttlMs = MINUTE_TTL_MS,
): Promise<MinuteResult> {
  const hit = minuteCache.get(symbol);
  if (hit && ttlMs > 0 && Date.now() - hit.ts < ttlMs) {
    return { data: hit.data, fresh: false };
  }
  let pending = minuteInflight.get(symbol);
  if (!pending) {
    pending = fetchMinute(symbol)
      .then((data) => {
        minuteCache.set(symbol, { data, ts: Date.now() });
        trimCache(minuteCache, MINUTE_CACHE_MAX);
        return data;
      })
      .finally(() => {
        minuteInflight.delete(symbol);
      });
    minuteInflight.set(symbol, pending);
  }
  try {
    const data = await pending;
    return { data, fresh: true };
  } catch (err) {
    if (hit) {
      return { data: hit.data, fresh: false };
    }
    throw err;
  }
}

export function buildSpark(data: MinuteData, prevClose: number): SparkData | null {
  // prevClose 缺失/为 0 时（新股、停牌、脏数据）坐标范围会被拉到 0，折线压成一条边，不画更诚实
  if (!Number.isFinite(prevClose) || prevClose <= 0 || data.points.length < 2) {
    return null;
  }
  const sampled = samplePoints(data.points, SAMPLE_STEP);
  const prices = sampled.map((p) => p.price);
  let min = Math.min(...prices, prevClose);
  let max = Math.max(...prices, prevClose);
  if (max - min < 1e-9) {
    max += 1;
    min -= 1;
  }
  const last = prices[prices.length - 1];
  const color: SparkData['color'] =
    last > prevClose ? 'up' : last < prevClose ? 'down' : 'flat';
  const x = (p: MinutePoint) => SPARK_PAD + (sessionMinute(p.time) / SESSION_TOTAL) * (SPARK_WIDTH - 2 * SPARK_PAD);
  const y = (p: number) => SPARK_HEIGHT - SPARK_PAD - ((p - min) / (max - min)) * (SPARK_HEIGHT - 2 * SPARK_PAD);
  const pts = sampled.map((p) => `${x(p).toFixed(1)},${y(p.price).toFixed(1)}`);
  const line = pts.join(' ');
  const baseY = y(prevClose);
  const bx = pts[0].split(',')[0];
  const ex = pts[pts.length - 1].split(',')[0];
  const floorY = Math.max(...sampled.map((p) => y(p.price))).toFixed(1);
  const area = `M${pts.join(' L')} L${ex} ${floorY} L${bx} ${floorY} Z`;
  return { color, line, area, baseY };
}

export function buildMinuteSeries(data: MinuteData): MinuteSeriesPoint[] {
  const out: MinuteSeriesPoint[] = [];
  let lastVol = 0;
  let haveLast = false;
  for (const p of data.points) {
    if (p.vol === undefined || p.vol <= 0) {
      continue;
    }
    const volume = haveLast ? Math.max(0, p.vol - lastVol) : 0;
    lastVol = p.vol;
    haveLast = true;
    out.push({
      time: p.time,
      price: p.price,
      avg: p.amt != null ? p.amt / (p.vol * 100) : null,
      volume,
      // 交易时段规则只在 host 算一次，webview 布局直接吃序号
      sm: sessionMinute(p.time),
    });
  }
  return out;
}

const SESSION_TOTAL = 240;
const MORNING_AUCTION = 555; // 09:15
const MORNING_OPEN = 570; // 09:30
const MORNING_END = 690; // 11:30
const AFTERNOON_START = 780; // 13:00
const AFTERNOON_END = 900; // 15:00
export const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

let closedDay = '';

export function beijingDateStr(now: Date = new Date()): string {
  return new Date(now.getTime() + BEIJING_OFFSET_MS)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
}

/** 北京时间 HHMMSS，供行情快照写入分钟桶时对齐交易时间。 */
export function beijingTimeStr(now: Date = new Date()): string {
  return new Date(now.getTime() + BEIJING_OFFSET_MS)
    .toISOString()
    .slice(11, 19)
    .replace(/:/g, '');
}

export function noteMarketDate(dates: string[], now: Date = new Date()): void {
  const today = beijingDateStr(now);
  closedDay = dates.some((d) => d === today) || dates.length === 0 ? '' : today;
}

export function sessionMinute(time: string): number {
  const hh = Number(time.slice(0, 2));
  const mm = Number(time.slice(2));
  const t = hh * 60 + mm;
  if (t < MORNING_OPEN) return 0;
  if (t <= MORNING_END) return t - MORNING_OPEN;
  if (t < AFTERNOON_START) return 120;
  if (t <= AFTERNOON_END) return t - (AFTERNOON_START - 120);
  return 240;
}

/** 是否交易日：北京时间工作日且非休市日。 */
export function isTradingDay(now: Date = new Date()): boolean {
  const today = beijingDateStr(now);
  if (closedDay !== '' && closedDay !== today) {
    closedDay = '';
  }
  const bj = new Date(now.getTime() + BEIJING_OFFSET_MS);
  const day = bj.getUTCDay();
  if (day === 0 || day === 6) {
    return false;
  }
  return closedDay !== today;
}

export function isTradingTime(now: Date = new Date()): boolean {
  if (!isTradingDay(now)) {
    return false;
  }
  const bj = new Date(now.getTime() + BEIJING_OFFSET_MS);
  const mins = bj.getUTCHours() * 60 + bj.getUTCMinutes();
  return (mins >= MORNING_AUCTION && mins < MORNING_END) || (mins >= AFTERNOON_START && mins < AFTERNOON_END);
}

/** 当日交易时段是否已全部结束（15:00 后或非交易日）。收盘后据此判断是否还值得补拉分时，午休不算结束。 */
export function isSessionOver(now: Date = new Date()): boolean {
  if (!isTradingDay(now)) {
    return true;
  }
  const bj = new Date(now.getTime() + BEIJING_OFFSET_MS);
  return bj.getUTCHours() * 60 + bj.getUTCMinutes() >= AFTERNOON_END;
}

/**
 * 盘前/开盘首分钟：交易日 09:31 之前（含集合竞价 09:15~09:30 与开盘第 1 分钟）。
 * 此时分时接口尚无（或仅有 1 行快照）当日数据，属正常状态。
 */
export function isPreOpen(now: Date = new Date()): boolean {
  if (!isTradingDay(now)) {
    return false;
  }
  const bj = new Date(now.getTime() + BEIJING_OFFSET_MS);
  return bj.getUTCHours() * 60 + bj.getUTCMinutes() <= MORNING_OPEN;
}

/**
 * 结合时钟的缺口判定：盘前点数不足视为正常（ok），不误报「分时数据缺失」/「无成交」。
 * 停牌/退市由行情状态驱动，盘前照常显示。
 */
export function resolveMinuteGap(data: MinuteData, state?: string, now: Date = new Date()): MinuteGap {
  const gap = minuteGapStatus(data, state);
  if ((gap === 'no-data' || gap === 'no-trade') && isPreOpen(now)) {
    return 'ok';
  }
  return gap;
}

/** 分时数据是否已覆盖当日收盘（末点 15:00）。收盘后据此只补拉一次，避免空轮询。 */
export function minuteSessionComplete(data: MinuteData): boolean {
  const last = data.points[data.points.length - 1];
  return last !== undefined && last.time >= '1500';
}

/** 收盘后等待 15:00 收尾点的宽限分钟数；超过仍无新数据即按定格处理，避免整晚轮询。 */
const MINUTE_FINAL_GRACE_MIN = 5;

/**
 * 当日分时是否已定格（无需再拉）。
 * - 拿到 15:00 收尾点，或非交易日（数据不会再变）→ 定格
 * - 收盘后：停牌/退市/无成交 → 定格；正常却始终等不到收尾点，超出宽限期也定格
 * - 午休/盘前不算收盘，返回 false（由调用方的交易时段判断决定是否跳过刷新）
 */
export function isMinuteFinal(
  data: MinuteData | null,
  gap: MinuteGap,
  now: Date = new Date(),
): boolean {
  if (data === null) {
    return false;
  }
  if (minuteSessionComplete(data)) {
    return true;
  }
  if (!isTradingDay(now)) {
    return true;
  }
  if (!isSessionOver(now)) {
    return false;
  }
  if (gap !== 'ok') {
    return true;
  }
  const bj = new Date(now.getTime() + BEIJING_OFFSET_MS);
  return bj.getUTCHours() * 60 + bj.getUTCMinutes() >= AFTERNOON_END + MINUTE_FINAL_GRACE_MIN;
}

function samplePoints(points: MinutePoint[], step: number): MinutePoint[] {
  const out: MinutePoint[] = [];
  for (let i = 0; i < points.length; i += step) {
    out.push(points[i]);
  }
  const last = points[points.length - 1];
  if (out.length < 2 || out[out.length - 1] !== last) {
    out.push(last);
  }
  return out;
}

function movingAverage(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      out[i] = sum / period;
    }
  }
  return out;
}

/**
 * K 线数据包：全量历史 + 按全量算好的均线值。
 * 几何留给 webview（缩放/自适应尺寸都在本地），host 只做数据与指标计算。
 */
export function buildKlineSeries(klines: KlinePoint[]): KlineSeries {
  const closes = klines.map((k) => k.close);
  const vols = klines.map((k) => k.volume);
  return {
    points: klines.map((k) => ({
      date: k.date,
      open: k.open,
      close: k.close,
      high: k.high,
      low: k.low,
      volume: k.volume,
    })),
    maValues: MA_PERIODS.map((n) => ({ n, vals: movingAverage(closes, n) })),
    volMaVals: movingAverage(vols, VOL_MA_PERIOD),
  };
}

