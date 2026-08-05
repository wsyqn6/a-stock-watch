import { fetchWithTimeout } from './http';

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
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
    const change = Number(fields[31]);
    const changePct = Number(fields[32]);
    if (!Number.isFinite(price) || !Number.isFinite(prevClose)) {
      continue;
    }
    const trend: StockQuote['trend'] =
      changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'flat';
    const date = /^\d{8}/.exec(fields[30])?.[0] ?? '';
    quotes.push({ symbol, name, price, prevClose, change, changePct, trend, date });
  }
  return quotes;
}

export interface MinutePoint {
  time: string;
  price: number;
}

export interface MinuteData {
  date: string;
  points: MinutePoint[];
}

export interface SparkData {
  color: 'up' | 'down' | 'flat';
  line: string;
  baseY: number;
}

const MINUTE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=';
const SPARK_WIDTH = 100;
const SPARK_HEIGHT = 18;
const SPARK_PAD = 1;
const SAMPLE_STEP = 5;

const minuteCache = new Map<string, MinuteData>();

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
    const m = /^(\d{4})\s+([\d.]+)/.exec(row.trim());
    if (m) {
      points.push({ time: m[1], price: Number(m[2]) });
    }
  }
  return { date, points };
}

export async function getMinuteCached(symbol: string): Promise<MinuteData> {
  const cached = minuteCache.get(symbol);
  if (cached) {
    try {
      const fresh = await fetchMinute(symbol);
      minuteCache.set(symbol, fresh);
      return fresh;
    } catch {
      return cached;
    }
  }
  const data = await fetchMinute(symbol);
  minuteCache.set(symbol, data);
  return data;
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
  const line = sampled.map((p) => `${x(p).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  return { color, line, baseY: y(prevClose) };
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

export function formatPrice(quote: StockQuote): string {
  const pct = (quote.changePct >= 0 ? '+' : '') + quote.changePct.toFixed(2) + '%';
  return `${quote.price.toFixed(2)} ${pct}`;
}
