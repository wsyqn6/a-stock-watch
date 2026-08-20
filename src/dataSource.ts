import { fetchWithTimeout } from './http';

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

export const KLINE_CANDLE_COUNT = 60;

const klineCache = new Map<string, { data: KlinePoint[]; ts: number }>();
const KLINE_TTL_MS = 60_000;

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
  avgPrice: 51,
};
const MIN_FIELDS = F.high; // 至少含到最高价字段（索引33）即可解析，high/low 可能缺失

/** 转为有效正数；无效（NaN/0/负数）返回 undefined。 */
function toFinitePos(v: string | undefined): number | undefined {
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
    const date = /^\d{8}/.exec(fields[F.date])?.[0] ?? '';
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

const MINUTE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=';
const SPARK_WIDTH = 100;
const SPARK_HEIGHT = 18;
const SPARK_PAD = 1;
const SAMPLE_STEP = 5;

const minuteCache = new Map<string, { data: MinuteData; ts: number }>();
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
    const m = /^(\d{4})\s+([\d.]+)(?:\s+(\d+)\s+([\d.]+))?/.exec(row.trim());
    if (m) {
      const point: MinutePoint = { time: m[1], price: Number(m[2]) };
      if (m[3] !== undefined && m[4] !== undefined) {
        point.vol = Number(m[3]);
        point.amt = Number(m[4]);
      }
      points.push(point);
    }
  }
  return { date, points };
}

export async function getMinuteCached(symbol: string): Promise<MinuteResult> {
  const hit = minuteCache.get(symbol);
  if (hit && Date.now() - hit.ts < MINUTE_TTL_MS) {
    return { data: hit.data, fresh: false };
  }
  try {
    const data = await fetchMinute(symbol);
    minuteCache.set(symbol, { data, ts: Date.now() });
    if (minuteCache.size > MINUTE_CACHE_MAX) {
      for (const k of minuteCache.keys()) {
        if (minuteCache.size <= MINUTE_CACHE_MAX) {
          break;
        }
        minuteCache.delete(k);
      }
    }
    return { data, fresh: true };
  } catch (err) {
    if (hit) {
      return { data: hit.data, fresh: false };
    }
    throw err;
  }
}

export function buildSpark(data: MinuteData, prevClose: number): SparkData | null {
  if (data.points.length < 2) {
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

export interface MinuteDetailPoint {
  time: string;
  price: number;
  avg: number;
  volume: number;
}

export function buildMinuteSeries(data: MinuteData): MinuteDetailPoint[] {
  const out: MinuteDetailPoint[] = [];
  let lastVol = 0;
  let haveLast = false;
  for (const p of data.points) {
    if (p.vol === undefined || p.amt === undefined || p.vol <= 0) {
      continue;
    }
    const volume = haveLast ? Math.max(0, p.vol - lastVol) : 0;
    lastVol = p.vol;
    haveLast = true;
    out.push({ time: p.time, price: p.price, avg: p.amt / (p.vol * 100), volume });
  }
  return out;
}

export interface MinuteChartLayout {
  width: number;
  totalH: number;
  mainH: number;
  volH: number;
  priceLine: string;
  avgLine: string | null;
  baseY: number;
  bars: { x: number; w: number; y: number; h: number; cls: 'up' | 'down' }[];
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
  pts: { x: number; y: number; ay: number | null; price: number; avg: number | null; volume: number; time: string }[];
  lastPrice: number;
  lastAvg: number | null;
  /** 涨停/跌停线 y 坐标（价格在当日范围内时提供，否则 undefined） */
  limitUpY?: number;
  limitDownY?: number;
}

const CHART_W = 640;
const CHART_PAD_L = 6;
const CHART_AXIS_R = 46;
const CHART_MAIN_H = 200;
const CHART_VOL_H = 56;
const CHART_GAP = 6;
const CHART_TOTAL_H = CHART_MAIN_H + CHART_GAP + CHART_VOL_H;
const CHART_Y_DIVS = 4;

interface ChartScale {
  yMin: number;
  yMax: number;
  y: (p: number) => number;
  yTicks: { y: number; label: string }[];
}

/** 构建主图纵向比例尺（含刻度标签）。reversed 控制标签方向：true=刻度顶为最大值（K线），false=底为最小值（分时）。 */
function buildChartScale(lo: number, hi: number, reversed: boolean): ChartScale {
  let min = lo;
  let max = hi;
  if (max - min < 1e-9) {
    max += 1;
    min -= 1;
  }
  const pad = (max - min) * 0.05;
  const yMin = min - pad;
  const yMax = max + pad;
  const y = (p: number) => CHART_MAIN_H - ((p - yMin) / (yMax - yMin)) * CHART_MAIN_H;
  const yTicks = Array.from({ length: CHART_Y_DIVS + 1 }, (_, i) => {
    const ratio = reversed ? (CHART_Y_DIVS - i) / CHART_Y_DIVS : i / CHART_Y_DIVS;
    return {
      y: (CHART_MAIN_H * i) / CHART_Y_DIVS,
      label: (yMin + (yMax - yMin) * ratio).toFixed(2),
    };
  });
  return { yMin, yMax, y, yTicks };
}

export function buildMinuteChart(
  data: MinuteData,
  prevClose: number,
  limits?: { limitUp?: number; limitDown?: number },
): MinuteChartLayout | null {
  const series = buildMinuteSeries(data);
  if (series.length < 2) {
    return null;
  }
  const plotW = CHART_W - CHART_PAD_L - CHART_AXIS_R;
  const x = (sm: number) => CHART_PAD_L + (sm / SESSION_TOTAL) * plotW;
  const priceMin = Math.min(...series.map((p) => p.price));
  const priceMax = Math.max(...series.map((p) => p.price));
  const slack = Math.max(priceMax - priceMin, priceMin * 0.5, 1e-6);
  const avgUsable = series.every(
    (p) => p.avg >= priceMin - slack && p.avg <= priceMax + slack,
  );
  let lo = prevClose;
  let hi = prevClose;
  for (const p of series) {
    lo = Math.min(lo, p.price);
    hi = Math.max(hi, p.price);
    if (avgUsable) {
      lo = Math.min(lo, p.avg);
      hi = Math.max(hi, p.avg);
    }
  }
  // 涨跌停价仅在贴近当日价格区间时纳入坐标范围，避免异常值或指数（无涨跌停）拉爆图表。
  // 阈值取 25% 价格幅，覆盖主板 10% / 创业板科创板 20% 涨跌停。
  const span = Math.max(hi - lo, prevClose * 0.25, 1e-6);
  const limitUp = limits?.limitUp;
  const limitDown = limits?.limitDown;
  const limitUpIn = limitUp !== undefined && limitUp >= lo - span && limitUp <= hi + span;
  const limitDownIn = limitDown !== undefined && limitDown >= lo - span && limitDown <= hi + span;
  if (limitUpIn) hi = Math.max(hi, limitUp as number);
  if (limitDownIn) lo = Math.min(lo, limitDown as number);
  const { y, yTicks } = buildChartScale(lo, hi, false);
  const priceLine = series
    .map((p) => `${x(sessionMinute(p.time)).toFixed(1)},${y(p.price).toFixed(1)}`)
    .join(' ');
  const avgLine = avgUsable
    ? series
        .map((p) => `${x(sessionMinute(p.time)).toFixed(1)},${y(p.avg).toFixed(1)}`)
        .join(' ')
    : null;
  const baseY = y(prevClose);
  const vmax = Math.max(...series.map((p) => p.volume), 1);
  const bw = plotW / series.length;
  const bars = series.map(
    (p): { x: number; w: number; y: number; h: number; cls: 'up' | 'down' } => {
      const h = p.volume > 0 ? (p.volume / vmax) * (CHART_VOL_H - 2) : 0;
      return {
        x: x(sessionMinute(p.time)),
        w: Math.max(0.5, bw),
        y: CHART_MAIN_H + CHART_GAP + (CHART_VOL_H - h),
        h,
        cls: p.price >= prevClose ? 'up' : 'down',
      };
    },
  );
  const xTicks = [0, 60, 120, 180, 240].map((sm) => ({ x: x(sm), label: smLabel(sm) }));
  const pts = series.map((p) => {
    const sx = x(sessionMinute(p.time));
    return {
      x: sx,
      y: y(p.price),
      ay: avgUsable ? y(p.avg) : null,
      price: p.price,
      avg: avgUsable ? p.avg : null,
      volume: p.volume,
      time: p.time,
    };
  });
  const last = series[series.length - 1];
  return {
    width: CHART_W,
    totalH: CHART_TOTAL_H,
    mainH: CHART_MAIN_H,
    volH: CHART_VOL_H,
    priceLine,
    avgLine,
    baseY,
    bars,
    xTicks,
    yTicks,
    pts,
    lastPrice: last.price,
    lastAvg: avgUsable ? last.avg : null,
    limitUpY: limitUpIn ? y(limitUp as number) : undefined,
    limitDownY: limitDownIn ? y(limitDown as number) : undefined,
  };
}

function smLabel(sm: number): string {
  if (sm === 0) return '09:30';
  if (sm === 60) return '10:30';
  if (sm === 120) return '11:30';
  if (sm === 180) return '14:00';
  return '15:00';
}

const SESSION_TOTAL = 240;
const MORNING_AUCTION = 555; // 09:15
const MORNING_OPEN = 570; // 09:30
const MORNING_END = 690; // 11:30
const AFTERNOON_START = 780; // 13:00
const AFTERNOON_END = 900; // 15:00
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

let closedDay = '';

export function beijingDateStr(now: Date = new Date()): string {
  return new Date(now.getTime() + BEIJING_OFFSET_MS)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
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

export function isTradingTime(now: Date = new Date()): boolean {
  const today = beijingDateStr(now);
  if (closedDay !== '' && closedDay !== today) {
    closedDay = '';
  }
  const bj = new Date(now.getTime() + BEIJING_OFFSET_MS);
  const day = bj.getUTCDay();
  if (day === 0 || day === 6) {
    return false;
  }
  if (closedDay === today) {
    return false;
  }
  const mins = bj.getUTCHours() * 60 + bj.getUTCMinutes();
  return (mins >= MORNING_AUCTION && mins < MORNING_END) || (mins >= AFTERNOON_START && mins < AFTERNOON_END);
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

export interface KlineCandle {
  x: number;
  w: number;
  bodyY: number;
  bodyH: number;
  wickY1: number;
  wickY2: number;
  cls: 'up' | 'down';
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface KlineLayout {
  width: number;
  totalH: number;
  mainH: number;
  volH: number;
  candles: KlineCandle[];
  volBars: { x: number; w: number; y: number; h: number; cls: 'up' | 'down' }[];
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
  lastPrice: number;
}

/** K线单根蜡烛最大宽度（px，viewBox 单位）。数据少时限制宽度，避免单根蜡烛撑满整图。 */
const CANDLE_W_MAX = 14;
/** 相邻刻度最小像素间隔，低于此则跳标，防止 x 轴文字重叠。 */
const MIN_TICK_PX = 56;

export function buildKlineLayout(klines: KlinePoint[]): KlineLayout {
  const plotW = CHART_W - CHART_PAD_L - CHART_AXIS_R;
  const n = klines.length;
  const cw = Math.min(plotW / n, CANDLE_W_MAX);
  const bw = cw * 0.65;

  let lo = Infinity;
  let hi = -Infinity;
  let vmax = 0;
  for (const k of klines) {
    if (k.low < lo) lo = k.low;
    if (k.high > hi) hi = k.high;
    if (k.volume > vmax) vmax = k.volume;
  }
  const { y, yTicks } = buildChartScale(lo, hi, true);

  // 按像素间隔稀疏刻度，避免少数据时 label 拥挤重叠。
  const labelStep = Math.max(1, Math.floor(MIN_TICK_PX / cw));
  const xTicks: { x: number; label: string }[] = [];
  for (let i = 0; i < n; i += labelStep) {
    xTicks.push({ x: CHART_PAD_L + i * cw + cw / 2, label: klines[i].date.slice(5) });
  }

  const candles: KlineCandle[] = [];
  const volBars: KlineLayout['volBars'] = [];

  for (let i = 0; i < n; i++) {
    const k = klines[i];
    const x = CHART_PAD_L + i * cw + (cw - bw) / 2;
    const cls: 'up' | 'down' = k.close >= k.open ? 'up' : 'down';
    const bodyY = y(Math.max(k.open, k.close));
    const bodyH = y(Math.min(k.open, k.close)) - bodyY;
    candles.push({
      x, w: bw, bodyY, bodyH: Math.max(bodyH, 1),
      wickY1: y(k.high), wickY2: y(k.low), cls,
      date: k.date, open: k.open, close: k.close,
      high: k.high, low: k.low, volume: k.volume,
    });
    const vh = k.volume > 0 ? (k.volume / vmax) * (CHART_VOL_H - 2) : 0;
    volBars.push({
      x, w: bw,
      y: CHART_MAIN_H + CHART_GAP + (CHART_VOL_H - vh),
      h: vh, cls,
    });
  }

  return {
    width: CHART_W,
    totalH: CHART_TOTAL_H,
    mainH: CHART_MAIN_H,
    volH: CHART_VOL_H,
    candles,
    volBars,
    xTicks,
    yTicks,
    lastPrice: klines[n - 1].close,
  };
}
