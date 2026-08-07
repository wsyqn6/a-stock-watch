import { fetchWithTimeout } from './http';

export interface SearchResult {
  name: string;
  code: string;
  market: 'sh' | 'sz';
  symbol: string;
}

const SEARCH_URL = 'https://smartbox.gtimg.cn/s3/?v=2&q=';

export async function searchStock(query: string): Promise<SearchResult[]> {
  return search(SEARCH_URL, query, parseSearchResponse, 'gb18030', '&t=all&c=1');
}

const EM_SEARCH_URL =
  'https://searchapi.eastmoney.com/api/suggest/get?type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10&input=';

export async function searchEastmoney(query: string): Promise<SearchResult[]> {
  return search(EM_SEARCH_URL, query, parseEastmoneyResponse, 'utf-8');
}

async function search(
  url: string,
  query: string,
  parse: (text: string) => SearchResult[],
  encoding: 'gb18030' | 'utf-8',
  suffix = '',
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const res = await fetchWithTimeout(url + encodeURIComponent(trimmed) + suffix);
  if (!res.ok) {
    return [];
  }
  const text = new TextDecoder(encoding).decode(new Uint8Array(await res.arrayBuffer()));
  return parse(text);
}

export function parseEastmoneyResponse(text: string): SearchResult[] {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return [];
  }
  const rows = (root as { QuotationCodeTable?: { Data?: unknown[] } })?.QuotationCodeTable?.Data;
  if (!Array.isArray(rows)) {
    return [];
  }
  const results: SearchResult[] = [];
  for (const row of rows) {
    const rec = row as {
      Code?: unknown;
      Name?: unknown;
      Classify?: unknown;
      QuoteID?: unknown;
    };
    const code = typeof rec.Code === 'string' ? rec.Code : '';
    const name = typeof rec.Name === 'string' ? rec.Name : '';
    const classify = typeof rec.Classify === 'string' ? rec.Classify : '';
    const market = emMarket(rec.QuoteID);
    if ((classify !== 'AStock' && classify !== 'Bond') || !/^\d{6}$/.test(code) || !market) {
      continue;
    }
    results.push({ name, code, market, symbol: `${market}${code}` });
  }
  return results;
}

function emMarket(quoteId: unknown): 'sh' | 'sz' | null {
  const id = typeof quoteId === 'string' ? quoteId : '';
  if (id.startsWith('1.')) return 'sh';
  if (id.startsWith('0.')) return 'sz';
  return null;
}

export function parseSearchResponse(text: string): SearchResult[] {
  const results: SearchResult[] = [];
  const marker = 'v_hint="';
  const start = text.indexOf(marker);
  const raw = (start === -1 ? text : text.slice(start + marker.length)).replace(/";?\s*$/g, '');
  if (!raw) {
    return results;
  }
  for (const entry of raw.split('^')) {
    const parts = entry.split('~');
    if (parts.length < 3) {
      continue;
    }
    const market = parts[0];
    const code = parts[1];
    const name = decodeEscaped(parts[2]);
    if ((market !== 'sh' && market !== 'sz') || !/^\d{6}$/.test(code)) {
      continue;
    }
    results.push({ name, code, market, symbol: `${market}${code}` });
  }
  return results;
}

function decodeEscaped(s: string): string {
  try {
    return JSON.parse('"' + s + '"');
  } catch {
    return s;
  }
}