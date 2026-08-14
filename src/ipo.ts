import { fetchWithTimeout } from './http';
import { beijingDateStr } from './dataSource';

/** 待申购新股。 */
export interface NewStockApply {
  code: string;
  name: string;
  /** 申购日 YYYY-MM-DD */
  applyDate: string;
  /** 发行价（元）；未定价时为预估 */
  issuePrice?: number;
  /** 顶格申购需配市值（万元） */
  topMcapWan?: number;
  /** 申购上限（万股） */
  applyUpperWan?: number;
}

/** 待申购新债（可转债）。 */
export interface NewBondApply {
  code: string;
  name: string;
  /** 申购日 YYYY-MM-DD */
  applyDate: string;
  /** 发行规模（亿元） */
  scaleYi?: number;
  /** 正股代码 */
  convertStock: string;
  /** 转股价（元） */
  transferPrice?: number;
}

const DC_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get';

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 东财数据中心接口实际返回 UTF-8（header charset=UTF-8 属实，与腾讯 GBK 行情不同）。 */
async function getDataRows(url: string): Promise<Record<string, unknown>[]> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`接口返回 ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const utf8 = new TextDecoder('utf-8').decode(buf);
  const text = utf8.includes('\uFFFD') ? new TextDecoder('gb18030').decode(buf) : utf8;
  return parseDataRows(text);
}

export function parseDataRows(text: string): Record<string, unknown>[] {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return [];
  }
  const rows = (root as { result?: { data?: unknown[] } } | null)?.result?.data;
  return Array.isArray(rows) ? (rows.filter((r) => r && typeof r === 'object') as Record<string, unknown>[]) : [];
}

/** 转为有效正数；NaN/0/负数/缺省返回 undefined。 */
function toFinitePos(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function dateOnly(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, 10) : '';
}

export async function fetchNewStockApplies(): Promise<NewStockApply[]> {
  const today = dashDate(beijingDateStr());
  const url =
    `${DC_URL}?reportName=RPTA_APP_IPOAPPLY&columns=ALL&source=APP&client=APP` +
    `&sortColumns=APPLY_DATE&sortTypes=1&pageSize=50&pageNumber=1&filter=${encodeURIComponent(`(APPLY_DATE>='${today}')`)}`;
  const rows = await getDataRows(url);
  return filterRecentApplies(parseStockApplies(rows), [], nextTradingDays(3)).stocks;
}

export function parseStockApplies(rows: Record<string, unknown>[]): NewStockApply[] {
  return rows.map((r) => ({
    code: str(r.SECURITY_CODE),
    name: str(r.SECURITY_NAME_ABBR),
    applyDate: dateOnly(r.APPLY_DATE),
    issuePrice: toFinitePos(r.ISSUE_PRICE) ?? toFinitePos(r.PREDICT_ISSUE_PRICE),
    topMcapWan: toFinitePos(r.TOP_APPLY_MARKETCAP),
    applyUpperWan: toFinitePos(r.ONLINE_APPLY_UPPER),
  }));
}

export async function fetchNewBondApplies(): Promise<NewBondApply[]> {
  const today = dashDate(beijingDateStr());
  const url =
    `${DC_URL}?reportName=RPT_BOND_CB_LIST&columns=ALL&source=WEB&client=WEB` +
    `&sortColumns=PUBLIC_START_DATE&sortTypes=1&pageSize=50&pageNumber=1&filter=${encodeURIComponent(`(PUBLIC_START_DATE>='${today}')`)}`;
  const rows = await getDataRows(url);
  return filterRecentApplies([], parseBondApplies(rows), nextTradingDays(3)).bonds;
}

export function parseBondApplies(rows: Record<string, unknown>[]): NewBondApply[] {
  return rows.map((r) => ({
    code: str(r.SECURITY_CODE),
    name: str(r.SECURITY_NAME_ABBR),
    applyDate: dateOnly(r.PUBLIC_START_DATE),
    scaleYi: toFinitePos(r.ACTUAL_ISSUE_SCALE),
    convertStock: str(r.CONVERT_STOCK_CODE),
    transferPrice: toFinitePos(r.TRANSFER_PRICE),
  }));
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** YYYYMMDD → YYYY-MM-DD（东财过滤器需要连字符格式）。 */
export function dashDate(d: string): string {
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d;
}

/** 从今天（含）起 count 个交易日（跳过周六日）的 YYYY-MM-DD 列表。节假日未建模，以上市日期为准。 */
export function nextTradingDays(count: number, now: Date = new Date()): string[] {
  const days: string[] = [];
  const bj = new Date(now.getTime() + BEIJING_OFFSET_MS);
  bj.setUTCHours(12, 0, 0, 0);
  while (days.length < count) {
    const dow = bj.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      days.push(bj.toISOString().slice(0, 10));
    }
    bj.setUTCDate(bj.getUTCDate() + 1);
  }
  return days;
}

interface Dated {
  applyDate: string;
}

/** 截取窗口内（最近几个交易日）的申购项并按日期升序。 */
export function filterRecentApplies<T extends Dated, U extends Dated>(
  stocks: T[],
  bonds: U[],
  days: string[],
): { stocks: T[]; bonds: U[] } {
  const set = new Set(days);
  const sortAsc = (a: Dated, b: Dated): number =>
    a.applyDate < b.applyDate ? -1 : a.applyDate > b.applyDate ? 1 : 0;
  return {
    stocks: stocks.filter((s) => set.has(s.applyDate)).sort(sortAsc),
    bonds: bonds.filter((b) => set.has(b.applyDate)).sort(sortAsc),
  };
}

/** 两个 YYYY-MM-DD 之间的自然日差。 */
export function calendarDays(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

function weekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return names[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** 交易日分块表头：今日 / 明日（自然日差 1）/ 周几。 */
export function dayLabel(date: string, today: string): string {
  const short = date.slice(5);
  const diff = calendarDays(today, date);
  if (diff === 0) return `今日 ${short}`;
  if (diff === 1) return `明日 ${short}`;
  return `${weekday(date)} ${short}`;
}