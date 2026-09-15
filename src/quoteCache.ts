import { fetchQuotes, StockQuote } from './dataSource';
import { trimCache } from './util';

/** 缓存 TTL（毫秒）。低于侧边栏最小刷新间隔(3s)，保证命中窗口内的并发轮询去重，又不显著延迟数据。 */
const DEFAULT_TTL_MS = 2000;
/** 缓存上限：远大于自选规模，仅用于约束长期增删自选后的内存。 */
const QUOTE_CACHE_MAX = 200;

const cache = new Map<string, { q: StockQuote; ts: number }>();
const inflight = new Map<string, Promise<StockQuote[]>>();

function keyOf(symbols: string[]): string {
  return [...new Set(symbols)].sort().join(',');
}

/**
 * 按符号去重 + 单飞的行情获取：合并侧边栏/状态栏/异动三路轮询为最小批次数 HTTP。
 * 命中缓存(未过期)直接返回；缺失符号走单次批量 fetchQuotes，并并发合并同源请求。
 * 保持原 fetchQuotes 语义（返回按请求顺序、仅含成功标的）。
 */
export async function fetchQuotesCached(
  symbols: string[],
  ttlMs = DEFAULT_TTL_MS,
): Promise<StockQuote[]> {
  if (symbols.length === 0) {
    return [];
  }
  const now = Date.now();
  const uniq = [...new Set(symbols)];
  const missing = uniq.filter((s) => {
    const hit = cache.get(s);
    return !hit || now - hit.ts >= ttlMs;
  });
  if (missing.length > 0) {
    const key = keyOf(missing);
    let pending = inflight.get(key);
    if (!pending) {
      pending = fetchQuotes(missing)
        .then((qs) => {
          const ts = Date.now();
          for (const q of qs) {
            cache.set(q.symbol, { q, ts });
          }
          trimCache(cache, QUOTE_CACHE_MAX);
          return qs;
        })
        .finally(() => {
          inflight.delete(key);
        });
      inflight.set(key, pending);
    }
    await pending;
  }
  const out: StockQuote[] = [];
  for (const s of symbols) {
    const hit = cache.get(s);
    if (hit) {
      out.push(hit.q);
    }
  }
  return out;
}
