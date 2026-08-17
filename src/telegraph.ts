import { createHash } from 'node:crypto';
import { fetchWithTimeout } from './http';
import { beijingDateStr } from './dataSource';

export interface TelegraphStock {
  name: string;
  /** 涨跌幅百分比，如 4.68 */
  pct: number | null;
}

export interface TelegraphItem {
  id: number;
  title: string;
  brief: string;
  /** 全量正文 */
  content: string;
  /** 重要等级：A(重磅)/B(重要)/C/D */
  level: string;
  /** 阅读数 */
  reading: number;
  /** 关联个股 */
  stocks: TelegraphStock[];
  url: string;
  /** 毫秒时间戳 */
  ctime: number;
}

const API_URL = 'https://www.cls.cn/v1/roll/get_roll_list';
const BASE_PARAMS = { appName: 'CailianpressWeb', os: 'web', sv: '7.7.5' };

/** 财联社签名：sign = md5(sha1(键名按字母序排序后的 query string))。源自 RSSHub。 */
export function buildTelegraphQuery(lastTimeSec: number, rn = 30): URLSearchParams {
  const sp = new URLSearchParams({
    ...BASE_PARAMS,
    last_time: String(lastTimeSec),
    refresh_type: '1',
    rn: String(rn),
  });
  sp.sort();
  const sorted = sp.toString();
  const sha1 = createHash('sha1').update(sorted).digest('hex');
  const sign = createHash('md5').update(sha1).digest('hex');
  sp.append('sign', sign);
  return sp;
}

export function parseTelegraphResponse(text: string): TelegraphItem[] {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return [];
  }
  const list = (root as { data?: { roll_data?: unknown[] } } | null)?.data?.roll_data;
  if (!Array.isArray(list)) {
    return [];
  }
  const items: TelegraphItem[] = [];
  for (const raw of list) {
    const rec = raw as {
      id?: unknown;
      title?: unknown;
      brief?: unknown;
      content?: unknown;
      level?: unknown;
      reading_num?: unknown;
      stock_list?: unknown;
      ctime?: unknown;
      is_ad?: unknown;
    } | null;
    if (!rec || typeof rec !== 'object') {
      continue;
    }
    if (rec.is_ad === 1) {
      continue;
    }
    const id = Number(rec.id);
    const ctime = Number(rec.ctime) * 1000;
    if (!Number.isFinite(id) || !Number.isFinite(ctime) || ctime <= 0) {
      continue;
    }
    const stocks: TelegraphStock[] = [];
    if (Array.isArray(rec.stock_list)) {
      for (const s of rec.stock_list) {
        const sr = s as { name?: unknown; RiseRange?: unknown } | null;
        if (!sr || typeof sr !== 'object' || typeof sr.name !== 'string') {
          continue;
        }
        const rv = sr.RiseRange;
        const pct = rv === null || rv === undefined ? null : Number(rv);
        stocks.push({ name: sr.name, pct: pct === null || Number.isFinite(pct) ? pct : null });
      }
    }
    items.push({
      id,
      title: typeof rec.title === 'string' ? rec.title : '',
      brief: typeof rec.brief === 'string' ? rec.brief : '',
      content: typeof rec.content === 'string' ? rec.content : '',
      level: typeof rec.level === 'string' ? rec.level : 'C',
      reading: Math.max(0, Number(rec.reading_num) || 0),
      stocks,
      url: `https://www.cls.cn/detail/${id}`,
      ctime,
    });
  }
  return items;
}

export async function fetchTelegraph(): Promise<TelegraphItem[]> {
  const query = buildTelegraphQuery(Math.floor(Date.now() / 1000));
  const res = await fetchWithTimeout(`${API_URL}?${query.toString()}`, 10_000, {
    headers: { Referer: 'https://www.cls.cn/telegraph' },
  });
  if (!res.ok) {
    throw new Error(`电报接口返回 ${res.status}`);
  }
  return parseTelegraphResponse(await res.text());
}

export interface TelegraphDisplayItem {
  time: string;
  text: string;
  level: string;
  reading: number;
  stocks: TelegraphStock[];
}

export function toTelegraphDisplayItem(it: TelegraphItem, now: Date = new Date()): TelegraphDisplayItem {
  return {
    time: formatTelegraphTime(it.ctime, now),
    text: it.content || it.title || it.brief,
    level: it.level,
    reading: it.reading,
    stocks: it.stocks,
  };
}

/** 阅读数展示：≥1万 → 42.3万（去 .0）；<1万 → 原始数字。 */
export function fmtReading(n: number): string {
  if (n >= 10_000) {
    const w = n / 10_000;
    const s = w >= 100 ? String(Math.round(w)) : w.toFixed(1).replace(/\.0$/, '');
    return `${s}万`;
  }
  return String(n);
}

/** 涨跌方向：up(涨)/down(跌)/flat(平)，供红涨绿跌配色。 */
export function pctSign(p: number | null): 'up' | 'down' | 'flat' {
  if (p === null || p === 0) {
    return 'flat';
  }
  return p > 0 ? 'up' : 'down';
}

/** 涨跌幅展示：+4.68% / -2.10% / 0.00% / ''（null）。 */
export function fmtPct(p: number | null): string {
  if (p === null) {
    return '';
  }
  if (p === 0) {
    return '0.00%';
  }
  const body = Math.abs(p).toFixed(2);
  return `${p > 0 ? '+' : '-'}${body}%`;
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 电报时间展示：今天 → HH:MM；昨天 → 昨天 HH:MM；更早 → MM-DD HH:MM（均北京时间）。 */
export function formatTelegraphTime(ts: number, now: Date = new Date()): string {
  const ds = beijingDateStr(new Date(ts));
  const today = beijingDateStr(now);
  const b = new Date(ts + BEIJING_OFFSET_MS);
  const hh = String(b.getUTCHours()).padStart(2, '0');
  const mm = String(b.getUTCMinutes()).padStart(2, '0');
  const hm = `${hh}:${mm}`;
  if (ds === today) {
    return hm;
  }
  const yesterday = beijingDateStr(new Date(now.getTime() - 86_400_000));
  if (ds === yesterday) {
    return `昨天 ${hm}`;
  }
  return `${ds.slice(4, 6)}-${ds.slice(6)} ${hm}`;
}
