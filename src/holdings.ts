import { StockQuote } from './dataSource';
import { fmtPrice } from './util';

/** 一条持仓：股数（ETF 为份、可转债为张）与摊薄成本价。 */
export interface Holding {
  symbol: string;
  shares: number;
  cost: number;
}

/** 持仓的计算结果。dayPnl 为 null 表示昨收缺失，当日盈亏无法计算。 */
export interface HoldingStat {
  shares: number;
  cost: number;
  /** 市值 = 现价 × 股数 */
  value: number;
  dayPnl: number | null;
  dayPct: number | null;
  totalPnl: number;
  totalPct: number;
}

/** 行内展示用的持仓字段，已格式化为字符串，webview 不再做计算。 */
export interface HoldingView {
  /** 第一行：当日盈亏额，昨收缺失时为 — */
  main: string;
  cls: 'up' | 'down' | 'flat';
  /** 第二行：现价 · 当日涨幅 */
  sub: string;
  /** 行 tooltip：股数、成本、累计、市值 */
  title: string;
}

/** 标题行汇总，仅在有持仓且至少一只行情有效时生成。 */
export interface HoldingSummaryView {
  day: string;
  dayCls: 'up' | 'down' | 'flat';
  total: string;
  totalCls: 'up' | 'down' | 'flat';
  title: string;
}

const SYMBOL_RE = /^(sh|sz|bj)\d{6}$/;

/**
 * 校验并归一化设置里的持仓数组：非法条目静默忽略，同一符号取最后一条。
 * 股数要求正整数（股/份/张），成本价要求正数；不合法时不阻断其它条目。
 */
export function parseHoldings(raw: unknown): Holding[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const bySymbol = new Map<string, Holding>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const { symbol, shares, cost } = item as Record<string, unknown>;
    if (typeof symbol !== 'string' || !SYMBOL_RE.test(symbol)) {
      continue;
    }
    if (typeof shares !== 'number' || !Number.isInteger(shares) || shares <= 0) {
      continue;
    }
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) {
      continue;
    }
    bySymbol.set(symbol, { symbol, shares, cost });
  }
  return [...bySymbol.values()];
}

/** 计算单只持仓。现价无效（停牌、脏数据）时返回 null。 */
export function computeHolding(h: Holding, q: StockQuote): HoldingStat | null {
  if (!Number.isFinite(q.price) || q.price <= 0) {
    return null;
  }
  const prevOk = Number.isFinite(q.prevClose) && q.prevClose > 0;
  return {
    shares: h.shares,
    cost: h.cost,
    value: q.price * h.shares,
    dayPnl: prevOk ? (q.price - q.prevClose) * h.shares : null,
    dayPct: prevOk ? ((q.price - q.prevClose) / q.prevClose) * 100 : null,
    totalPnl: (q.price - h.cost) * h.shares,
    totalPct: ((q.price - h.cost) / h.cost) * 100,
  };
}

/** 盈亏额：万位缩写，其余取整到元；正数带 +，零不带符号。 */
export function formatPnl(v: number): string {
  if (!Number.isFinite(v)) {
    return '—';
  }
  if (v === 0) {
    return '0';
  }
  const sign = v > 0 ? '+' : '-';
  const yuan = Math.round(Math.abs(v));
  // 取整后跨过 1 万也走缩写，避免 9999.6 显示成 +10000
  if (yuan >= 10000) {
    return `${sign}${(yuan / 10000).toFixed(2)}万`;
  }
  return yuan === 0 ? '0' : `${sign}${yuan}`;
}

/** 百分比：两位小数，非负带 +（与行情涨跌幅同格式）。 */
export function formatPct(v: number): string {
  if (!Number.isFinite(v)) {
    return '—';
  }
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/** 涨跌配色：0 与缺失都用中性色，避免"平盘"被染红。 */
export function pnlClass(v: number | null): 'up' | 'down' | 'flat' {
  if (v === null || !Number.isFinite(v) || v === 0) {
    return 'flat';
  }
  return v > 0 ? 'up' : 'down';
}

/** 金额明细：tooltip 用，保留两位小数且不带 +。 */
function amountText(v: number): string {
  return Number.isFinite(v) ? v.toFixed(2) : '—';
}

/**
 * 生成持仓行展示字段。现价无效时第一、二行显示 —，但 tooltip 仍给股数与成本。
 * 当日盈亏以昨收为基准；今日新买入的部分会被算作昨日持有，这是刻意的简化。
 */
export function buildHoldingView(h: Holding, q: StockQuote): HoldingView {
  const stat = computeHolding(h, q);
  const code = q.symbol.slice(2);
  const costText = fmtPrice(h.cost, code, q.price);
  if (!stat) {
    return {
      main: '—',
      cls: 'flat',
      sub: '—',
      title: `${h.shares} 股 · 成本 ${costText} · 市值 —`,
    };
  }
  const priceText = fmtPrice(q.price, code, q.price);
  const sub = stat.dayPct === null ? priceText : `${priceText} · ${formatPct(stat.dayPct)}`;
  return {
    main: stat.dayPnl === null ? '—' : formatPnl(stat.dayPnl),
    cls: pnlClass(stat.dayPnl),
    sub,
    title:
      `${h.shares} 股 · 成本 ${costText} · 累计 ${formatPnl(stat.totalPnl)}` +
      ` (${formatPct(stat.totalPct)}) · 市值 ${amountText(stat.value)}`,
  };
}

/** 生成标题行汇总。任一持仓缺昨收时当日合计显示 —，不给"部分合计"的错觉。 */
export function buildSummaryView(stats: HoldingStat[]): HoldingSummaryView | null {
  if (stats.length === 0) {
    return null;
  }
  let day = 0;
  let dayKnown = true;
  let total = 0;
  let value = 0;
  for (const s of stats) {
    total += s.totalPnl;
    value += s.value;
    if (s.dayPnl === null) {
      dayKnown = false;
    } else {
      day += s.dayPnl;
    }
  }
  return {
    day: dayKnown ? formatPnl(day) : '—',
    dayCls: dayKnown ? pnlClass(day) : 'flat',
    total: formatPnl(total),
    totalCls: pnlClass(total),
    title: `总市值 ${amountText(value)} · 今日 ${dayKnown ? formatPnl(day) : '—'} · 累计 ${formatPnl(total)}`,
  };
}
