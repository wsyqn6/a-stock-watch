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

export function formatPrice(quote: StockQuote): string {
  const pct = (quote.changePct >= 0 ? '+' : '') + quote.changePct.toFixed(2) + '%';
  return `${quote.price.toFixed(2)} ${pct}`;
}
