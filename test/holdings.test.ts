import { describe, expect, it } from 'bun:test';
import { StockQuote } from '../src/dataSource';
import {
  buildHoldingView,
  buildSummaryView,
  computeHolding,
  formatPct,
  formatPnl,
  parseHoldings,
  pnlClass,
} from '../src/holdings';

function quote(symbol: string, price: number, prevClose: number): StockQuote {
  return {
    symbol,
    name: '测试',
    price,
    prevClose,
    change: price - prevClose,
    changePct: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
    trend: 'flat',
    date: '20261023',
  };
}

describe('parseHoldings', () => {
  it('returns empty for non-array input', () => {
    expect(parseHoldings(undefined)).toEqual([]);
    expect(parseHoldings(null)).toEqual([]);
    expect(parseHoldings({})).toEqual([]);
  });

  it('keeps valid entries', () => {
    expect(
      parseHoldings([
        { symbol: 'sz000001', shares: 1000, cost: 10.2 },
        { symbol: 'sh510300', shares: 500, cost: 3.987 },
      ]),
    ).toEqual([
      { symbol: 'sz000001', shares: 1000, cost: 10.2 },
      { symbol: 'sh510300', shares: 500, cost: 3.987 },
    ]);
  });

  it('drops malformed symbol, shares and cost', () => {
    const list = parseHoldings([
      { symbol: '000001', shares: 1000, cost: 10 },
      { symbol: 'sz000001', shares: 0, cost: 10 },
      { symbol: 'sz000002', shares: -100, cost: 10 },
      { symbol: 'sz000003', shares: 1.5, cost: 10 },
      { symbol: 'sz000004', shares: '1000', cost: 10 },
      { symbol: 'sz000005', shares: 1000, cost: 0 },
      { symbol: 'sz000006', shares: 1000, cost: Number.NaN },
      { symbol: 'sz000007', shares: 1000, cost: Number.POSITIVE_INFINITY },
      null,
      'sz000008',
    ]);
    expect(list).toEqual([]);
  });

  it('keeps the last entry when a symbol repeats', () => {
    expect(
      parseHoldings([
        { symbol: 'sz000001', shares: 1000, cost: 10 },
        { symbol: 'sz000001', shares: 2000, cost: 9.5 },
      ]),
    ).toEqual([{ symbol: 'sz000001', shares: 2000, cost: 9.5 }]);
  });
});

describe('computeHolding', () => {
  const h = { symbol: 'sz000001', shares: 1000, cost: 10 };

  it('computes day and total profit', () => {
    const s = computeHolding(h, quote('sz000001', 11, 10))!;
    expect(s.value).toBe(11000);
    expect(s.dayPnl).toBe(1000);
    expect(s.dayPct).toBeCloseTo(10, 6);
    expect(s.totalPnl).toBe(1000);
    expect(s.totalPct).toBeCloseTo(10, 6);
  });

  it('keeps total profit when prevClose is missing', () => {
    const s = computeHolding(h, quote('sz000001', 11, 0))!;
    expect(s.dayPnl).toBeNull();
    expect(s.dayPct).toBeNull();
    expect(s.totalPnl).toBe(1000);
  });

  it('returns null when price is invalid', () => {
    expect(computeHolding(h, quote('sz000001', 0, 10))).toBeNull();
    expect(computeHolding(h, quote('sz000001', Number.NaN, 10))).toBeNull();
  });
});

describe('formatPnl', () => {
  it('formats small amounts as signed integer yuan', () => {
    expect(formatPnl(820)).toBe('+820');
    expect(formatPnl(-820)).toBe('-820');
    expect(formatPnl(0.6)).toBe('+1');
    expect(formatPnl(-0.4)).toBe('0');
    expect(formatPnl(0)).toBe('0');
  });

  it('abbreviates amounts at or above 10000', () => {
    expect(formatPnl(10000)).toBe('+1.00万');
    expect(formatPnl(-12345)).toBe('-1.23万');
    // 四舍五入跨过一万也要走缩写
    expect(formatPnl(9999.6)).toBe('+1.00万');
  });

  it('returns a dash for non-finite input', () => {
    expect(formatPnl(Number.NaN)).toBe('—');
  });
});

describe('formatPct / pnlClass', () => {
  it('formats percent with sign and two decimals', () => {
    expect(formatPct(2.316)).toBe('+2.32%');
    expect(formatPct(-0.5)).toBe('-0.50%');
    expect(formatPct(0)).toBe('+0.00%');
    expect(formatPct(Number.NaN)).toBe('—');
  });

  it('maps zero and missing to flat', () => {
    expect(pnlClass(1)).toBe('up');
    expect(pnlClass(-1)).toBe('down');
    expect(pnlClass(0)).toBe('flat');
    expect(pnlClass(null)).toBe('flat');
    expect(pnlClass(Number.NaN)).toBe('flat');
  });
});

describe('buildHoldingView', () => {
  const h = { symbol: 'sz000001', shares: 1000, cost: 10 };

  it('puts day profit on the primary line and price + pct below', () => {
    const v = buildHoldingView(h, quote('sz000001', 11, 10));
    expect(v.main).toBe('+1000');
    expect(v.cls).toBe('up');
    expect(v.sub).toBe('11.00 · +10.00%');
    expect(v.title).toContain('1000 股');
    expect(v.title).toContain('成本 10.00');
    expect(v.title).toContain('累计 +1000');
    expect(v.title).toContain('市值 11000.00');
  });

  it('shows a dash for day profit but keeps price when prevClose is missing', () => {
    const v = buildHoldingView(h, quote('sz000001', 11, 0));
    expect(v.main).toBe('—');
    expect(v.cls).toBe('flat');
    expect(v.sub).toBe('11.00');
  });

  it('shows dashes when the quote has no usable price', () => {
    const v = buildHoldingView(h, quote('sz000001', 0, 10));
    expect(v.main).toBe('—');
    expect(v.sub).toBe('—');
    expect(v.title).toContain('市值 —');
    expect(v.title).toContain('1000 股');
  });

  it('uses fund precision for cost', () => {
    const v = buildHoldingView({ symbol: 'sh510300', shares: 500, cost: 3.5 }, quote('sh510300', 3.6, 3.55));
    expect(v.title).toContain('成本 3.500');
  });
});

describe('buildSummaryView', () => {
  const h = { symbol: 'sz000001', shares: 1000, cost: 10 };
  const up = computeHolding(h, quote('sz000001', 11, 10))!;
  const down = computeHolding(
    { symbol: 'sz000002', shares: 1000, cost: 10 },
    quote('sz000002', 9, 9.5),
  )!;

  it('returns null without holdings', () => {
    expect(buildSummaryView([])).toBeNull();
  });

  it('sums day and total profit', () => {
    const s = buildSummaryView([up, down])!;
    expect(s.day).toBe('+500');
    expect(s.dayCls).toBe('up');
    expect(s.total).toBe('0');
    expect(s.totalCls).toBe('flat');
    expect(s.title).toContain('总市值 20000.00');
  });

  it('shows a dash when any holding lacks prevClose', () => {
    const noPrev = computeHolding(h, quote('sz000001', 11, 0))!;
    const s = buildSummaryView([up, noPrev])!;
    expect(s.day).toBe('—');
    expect(s.dayCls).toBe('flat');
    expect(s.total).toBe('+2000');
  });
});
