import { fetchWithTimeout } from './http';

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
}

const TENCENT_URL = 'https://qt.gtimg.cn/q=';

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
    if (fields.length < 33) {
      continue;
    }
    const name = fields[1];
    const price = Number(fields[3]);
    const prevClose = Number(fields[4]);
    const open = Number(fields[5]);
    const high = Number(fields[33]);
    const low = Number(fields[34]);
    const change = Number(fields[31]);
    const changePct = Number(fields[32]);
    if (!Number.isFinite(price) || !Number.isFinite(prevClose)) {
      continue;
    }
    const trend: StockQuote['trend'] =
      changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'flat';
    const date = /^\d{8}/.exec(fields[30])?.[0] ?? '';
    quotes.push({
      symbol,
      name,
      price,
      prevClose,
      open: Number.isFinite(open) ? open : undefined,
      high: Number.isFinite(high) ? high : undefined,
      low: Number.isFinite(low) ? low : undefined,
      change,
      changePct,
      trend,
      date,
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
}

const CHART_W = 640;
const CHART_PAD_L = 6;
const CHART_AXIS_R = 46;
const CHART_MAIN_H = 200;
const CHART_VOL_H = 56;
const CHART_GAP = 6;
const CHART_TOTAL_H = CHART_MAIN_H + CHART_GAP + CHART_VOL_H;
const CHART_Y_DIVS = 4;

export function buildMinuteChart(data: MinuteData, prevClose: number): MinuteChartLayout | null {
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
  if (hi - lo < 1e-9) {
    hi += 1;
    lo -= 1;
  }
  const pad = (hi - lo) * 0.05;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const y = (p: number) => CHART_MAIN_H - ((p - yMin) / (yMax - yMin)) * CHART_MAIN_H;
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
  const yTicks = Array.from({ length: CHART_Y_DIVS + 1 }, (_, i) => ({
    y: (CHART_MAIN_H * i) / CHART_Y_DIVS,
    label: (yMin + ((yMax - yMin) * i) / CHART_Y_DIVS).toFixed(2),
  }));
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
