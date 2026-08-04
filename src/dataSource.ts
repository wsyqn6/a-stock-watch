export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  trend: 'up' | 'down' | 'flat';
}

const TENCENT_URL = 'http://qt.gtimg.cn/q=';

export async function fetchQuotes(symbols: string[]): Promise<StockQuote[]> {
  if (symbols.length === 0) {
    return [];
  }
  const url = TENCENT_URL + symbols.join(',');
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`行情接口返回 ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder('gb18030').decode(buf);
  return parseTencentResponse(text);
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
    quotes.push({ symbol, name, price, prevClose, change, changePct, trend });
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
}

const MINUTE_URL = 'http://data.gtimg.cn/flashdata/hushen/minute/';
const SPARK_WIDTH = 100;
const SPARK_HEIGHT = 18;
const SPARK_PAD = 1;
const SAMPLE_STEP = 5;

const minuteCache = new Map<string, MinuteData>();

export async function fetchMinute(symbol: string): Promise<MinuteData> {
  const res = await fetch(MINUTE_URL + symbol + '.js');
  if (!res.ok) {
    throw new Error(`分时接口返回 ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder('gb18030').decode(buf);
  return parseMinuteResponse(text);
}

export function parseMinuteResponse(text: string): MinuteData {
  const dateMatch = /date:\s*(\d{6,8})/.exec(text);
  const date = dateMatch?.[1] ?? '';
  const points: MinutePoint[] = [];
  for (const line of text.split('\n')) {
    const m = /^(\d{4})\s+([\d.]+)\s+\d+/.exec(line.trim());
    if (!m) {
      continue;
    }
    points.push({ time: m[1], price: Number(m[2]) });
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
  const x = (i: number) => SPARK_PAD + (i / (sampled.length - 1)) * (SPARK_WIDTH - 2 * SPARK_PAD);
  const y = (p: number) => SPARK_HEIGHT - SPARK_PAD - ((p - min) / (max - min)) * (SPARK_HEIGHT - 2 * SPARK_PAD);
  const line = sampled.map((p, i) => `${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  return { color, line };
}

function samplePoints(points: MinutePoint[], step: number): MinutePoint[] {
  const out: MinutePoint[] = [];
  for (let i = 0; i < points.length; i += step) {
    out.push(points[i]);
  }
  if (out.length < 2 && points.length >= 2) {
    out.push(points[points.length - 1]);
  }
  return out;
}

export function formatPrice(quote: StockQuote): string {
  const pct = (quote.changePct >= 0 ? '+' : '') + quote.changePct.toFixed(2) + '%';
  return `${quote.price.toFixed(2)} ${pct}`;
}
