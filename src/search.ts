import { fetchWithTimeout } from './http';

export interface SearchResult {
  name: string;
  code: string;
  market: 'sh' | 'sz';
  symbol: string;
}

const SEARCH_URL = 'https://smartbox.gtimg.cn/s3/?v=2&q=';

export async function searchStock(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const res = await fetchWithTimeout(SEARCH_URL + encodeURIComponent(trimmed) + '&t=all&c=1');
  if (!res.ok) {
    return [];
  }
  const text = new TextDecoder('gb18030').decode(new Uint8Array(await res.arrayBuffer()));
  return parseSearchResponse(text);
}

export function parseSearchResponse(text: string): SearchResult[] {
  const results: SearchResult[] = [];
  const raw = text.replace(/^v_hint=\s*"|";?\s*$/g, '');
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