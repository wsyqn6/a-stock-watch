import { fetchWithTimeout } from './http';

export interface StockNewsItem {
  /** 文章标题 */
  title: string;
  /** 摘要/正文片段 */
  summary: string;
  /** 发布时间（毫秒时间戳，无法解析为 0） */
  time: number;
  /** 文章来源，如「东方财富」「证券时报」 */
  source: string;
  /** 详情链接 */
  url: string;
}

export interface StockAnnItem {
  /** 公告标题 */
  title: string;
  /** 公告日期原文，如 2026-02-28 00:00:00 */
  date: string;
  /** 公告分类名，如 员工持股计划 / 停牌公告 */
  types: string[];
  /** 详情链接 */
  url: string;
}

export interface StockEventItem {
  /** 标题 */
  title: string;
  /** 时间（毫秒时间戳） */
  time: number;
  /** 类型：新闻 / 公告 */
  kind: '新闻' | '公告';
  /** 标签：新闻取来源，公告取分类（多个用 / 连接） */
  tag: string;
  /** 详情链接 */
  url: string;
}

const NEWS_URL = 'https://search-api-web.eastmoney.com/search/jsonp';
const ANN_URL = 'https://np-anotice-stock.eastmoney.com/api/security/ann';

const NEWS_TTL_MS = 300_000;
const MAX_ITEMS = 12;
const NEWS_PAGE = 10;
const ANN_PAGE = 12;
const CACHE_MAX = 64;

interface CacheEntry {
  ts: number;
  items: StockEventItem[];
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<StockEventItem[]>>();

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function stripEm(s: string): string {
  return s.replace(/<\/?em>/g, '');
}

/** 剥离 JSONP 回调包装：cb(...)。无包装时原样返回。 */
export function stripJsonp(text: string): string {
  const s = text.trim();
  const open = s.indexOf('(');
  const close = s.lastIndexOf(')');
  if (open >= 0 && close > open) {
    return s.slice(open + 1, close);
  }
  return s;
}

/** 解析东财时间字符串为毫秒；支持时间戳(秒/毫秒)与 YYYY-MM-DD HH:MM:SS。 */
export function parseEastmoneyDate(date: string): number {
  if (!date) return 0;
  const t = date.trim();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (n > 1e12) return n;
    if (n > 1e9) return n * 1000;
    return 0;
  }
  let ms = Date.parse(t);
  if (Number.isNaN(ms)) {
    ms = Date.parse(t.replace(/-/g, '/'));
  }
  return Number.isNaN(ms) ? 0 : ms;
}

export async function fetchStockNews(code: string): Promise<StockNewsItem[]> {
  const inner = {
    uid: '',
    keyword: code,
    type: ['cmsArticleWebOld'],
    client: 'web',
    clientType: 'web',
    clientVersion: 'curr',
    param: {
      cmsArticleWebOld: {
        searchScope: 'default',
        sort: 'default',
        pageIndex: 1,
        pageSize: NEWS_PAGE,
        preTag: '<em>',
        postTag: '</em>',
      },
    },
  };
  const ts = Date.now();
  const params = new URLSearchParams({
    cb: 'jQuery' + ts,
    param: JSON.stringify(inner),
    _: String(ts),
  });
  const res = await fetchWithTimeout(`${NEWS_URL}?${params.toString()}`, 10_000, {
    headers: { Referer: `https://so.eastmoney.com/news/s?keyword=${code}` },
  });
  if (!res.ok) {
    throw new Error(`个股新闻接口返回 ${res.status}`);
  }
  const text = await res.text();
  let root: unknown;
  try {
    root = JSON.parse(stripJsonp(text));
  } catch {
    return [];
  }
  const list = asArr(asObj(asObj(root)?.result)?.cmsArticleWebOld);
  const items: StockNewsItem[] = [];
  for (const raw of list) {
    const it = asObj(raw);
    if (!it) continue;
    const artCode = str(it.code);
    if (!artCode) continue;
    items.push({
      title: stripEm(str(it.title)),
      summary: stripEm(str(it.content)),
      time: parseEastmoneyDate(str(it.date)),
      source: str(it.mediaName),
      url: `http://finance.eastmoney.com/a/${artCode}.html`,
    });
  }
  return items;
}

export async function fetchStockAnnouncements(code: string): Promise<StockAnnItem[]> {
  const params = new URLSearchParams({
    sr: '-1',
    page_size: String(ANN_PAGE),
    page_index: '1',
    ann_type: 'A',
    client_source: 'web',
    stock_list: code,
    f_node: '0',
    s_node: '0',
  });
  const res = await fetchWithTimeout(`${ANN_URL}?${params.toString()}`, 10_000, {
    headers: { Referer: 'https://data.eastmoney.com/' },
  });
  if (!res.ok) {
    throw new Error(`个股公告接口返回 ${res.status}`);
  }
  let root: unknown;
  try {
    root = await res.json();
  } catch {
    return [];
  }
  const list = asArr(asObj(asObj(root)?.data)?.list);
  const items: StockAnnItem[] = [];
  for (const raw of list) {
    const it = asObj(raw);
    if (!it) continue;
    const cols = asArr(it.columns)
      .map((c) => str(asObj(c)?.column_name))
      .filter(Boolean);
    const artCode = str(it.art_code);
    if (!artCode) continue;
    items.push({
      title: str(it.title_ch) || str(it.title),
      date: str(it.notice_date),
      types: cols,
      url: `https://data.eastmoney.com/notices/detail/${code}/${artCode}.html`,
    });
  }
  return items;
}

async function loadEvents(code: string): Promise<StockEventItem[]> {
  const [news, ann] = await Promise.allSettled([fetchStockNews(code), fetchStockAnnouncements(code)]);
  // 两源均失败才视为错误，避免把网络异常误显为「暂无相关资讯」
  if (news.status === 'rejected' && ann.status === 'rejected') {
    throw new Error('个股资讯加载失败');
  }
  const items: StockEventItem[] = [];
  if (news.status === 'fulfilled') {
    for (const n of news.value) {
      items.push({ title: n.title, time: n.time, kind: '新闻', tag: n.source || '新闻', url: n.url });
    }
  }
  if (ann.status === 'fulfilled') {
    for (const a of ann.value) {
      items.push({
        title: a.title,
        time: parseEastmoneyDate(a.date),
        kind: '公告',
        tag: a.types.join('/') || '公告',
        url: a.url,
      });
    }
  }
  items.sort((x, y) => y.time - x.time);
  return items.slice(0, MAX_ITEMS);
}

/**
 * 拉取个股相关资讯（新闻+公告合并，按时间倒序、截断最近 MAX_ITEMS 条）。
 * 带 TTL 缓存与 in-flight 合并，避免分时刷新频繁打东财。
 * @param code 6 位股票代码（不含市场前缀），如 600519
 */
export function fetchStockEvents(code: string): Promise<StockEventItem[]> {
  const cached = cache.get(code);
  if (cached && Date.now() - cached.ts < NEWS_TTL_MS) {
    return Promise.resolve(cached.items);
  }
  const running = inflight.get(code);
  if (running) {
    return running;
  }
  const p = (async () => {
    try {
      const items = await loadEvents(code);
      if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(code, { ts: Date.now(), items });
      return items;
    } finally {
      inflight.delete(code);
    }
  })();
  inflight.set(code, p);
  return p;
}
