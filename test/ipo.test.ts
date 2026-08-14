import { describe, expect, it } from 'bun:test';
import {
  parseDataRows,
  parseStockApplies,
  parseBondApplies,
  dashDate,
  nextTradingDays,
  filterRecentApplies,
  calendarDays,
  dayLabel,
  boardOf,
} from '../src/ipo';

const emJSON = (data: unknown[]) =>
  JSON.stringify({ success: true, result: { count: data.length, data } });

describe('parseDataRows', () => {
  it('extracts result.data rows', () => {
    const rows = parseDataRows(emJSON([{ SECURITY_CODE: '601123' }]));
    expect(rows).toHaveLength(1);
    expect(rows[0].SECURITY_CODE).toBe('601123');
  });

  it('returns [] for invalid json, missing result, or non-array data', () => {
    expect(parseDataRows('not json')).toHaveLength(0);
    expect(parseDataRows(JSON.stringify({ success: true }))).toHaveLength(0);
    expect(parseDataRows(JSON.stringify({ result: { data: {} } }))).toHaveLength(0);
    expect(parseDataRows(emJSON([null, 1, 'x']))).toHaveLength(0);
  });
});

describe('parseStockApplies', () => {
  it('maps fields and slices dates', () => {
    const rows = [
      {
        SECURITY_CODE: '601123',
        SECURITY_NAME_ABBR: '马矿股份',
        APPLY_DATE: '2026-08-21 00:00:00',
        ISSUE_PRICE: 15.5,
        PREDICT_ISSUE_PRICE: 0,
        TOP_APPLY_MARKETCAP: 29.5,
        ONLINE_APPLY_UPPER: 29500,
      },
      {
        SECURITY_CODE: '688835',
        SECURITY_NAME_ABBR: '高凯创芯',
        APPLY_DATE: '2026-08-14 00:00:00',
        ISSUE_PRICE: null,
        PREDICT_ISSUE_PRICE: 61.36,
        TOP_APPLY_MARKETCAP: 5.5,
        ONLINE_APPLY_UPPER: 5500,
      },
    ];
    const list = parseStockApplies(rows);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      code: '601123',
      name: '马矿股份',
      applyDate: '2026-08-21',
      issuePrice: 15.5,
      topMcapWan: 29.5,
      applyUpperWan: 29500,
    });
    expect(list[1].issuePrice).toBe(61.36);
  });

  it('drops invalid price / market cap values', () => {
    const list = parseStockApplies([
      {
        SECURITY_CODE: '920288',
        SECURITY_NAME_ABBR: '华大海天',
        APPLY_DATE: '2026-08-17 00:00:00',
        ISSUE_PRICE: 0,
        PREDICT_ISSUE_PRICE: 0,
        TOP_APPLY_MARKETCAP: -1,
        ONLINE_APPLY_UPPER: 'abc',
      },
    ]);
    expect(list[0].issuePrice).toBeUndefined();
    expect(list[0].topMcapWan).toBeUndefined();
    expect(list[0].applyUpperWan).toBeUndefined();
  });

  it('handles empty rows', () => {
    expect(parseStockApplies([])).toHaveLength(0);
  });
});

describe('parseBondApplies', () => {
  it('maps fields and slices dates', () => {
    const list = parseBondApplies([
      {
        SECURITY_CODE: '123282',
        SECURITY_NAME_ABBR: '震裕转债',
        PUBLIC_START_DATE: '2026-08-17 00:00:00',
        ACTUAL_ISSUE_SCALE: 18.8,
        CONVERT_STOCK_CODE: '300953',
        TRANSFER_PRICE: 42.5,
      },
    ]);
    expect(list[0]).toEqual({
      code: '123282',
      name: '震裕转债',
      applyDate: '2026-08-17',
      scaleYi: 18.8,
      convertStock: '300953',
      transferPrice: 42.5,
    });
  });

  it('leaves optional fields undefined when absent', () => {
    const list = parseBondApplies([
      {
        SECURITY_CODE: '123283',
        SECURITY_NAME_ABBR: '丰茂转债',
        PUBLIC_START_DATE: '2026-08-18 00:00:00',
      },
    ]);
    expect(list[0].scaleYi).toBeUndefined();
    expect(list[0].transferPrice).toBeUndefined();
    expect(list[0].convertStock).toBe('');
  });

  it('handles empty rows', () => {
    expect(parseBondApplies([])).toHaveLength(0);
  });
});

describe('dashDate', () => {
  it('converts YYYYMMDD to YYYY-MM-DD', () => {
    expect(dashDate('20260814')).toBe('2026-08-14');
  });

  it('passes through already-dashed values', () => {
    expect(dashDate('2026-08-14')).toBe('2026-08-14');
  });
});

describe('nextTradingDays', () => {
  // beijing 2026-08-14 = Friday
  const now = new Date(Date.UTC(2026, 7, 14, 2, 0)); // beijing 10:00

  it('returns count days including today', () => {
    expect(nextTradingDays(3, now)).toEqual(['2026-08-14', '2026-08-17', '2026-08-18']);
  });

  it('skips weekends', () => {
    // beijing 2026-08-15 = Saturday, 2026-08-16 = Sunday
    const fri = new Date(Date.UTC(2026, 7, 14, 2, 0));
    const days = nextTradingDays(5, fri);
    expect(days).toEqual([
      '2026-08-14',
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
    ]);
  });

  it('starts from the next weekday when today is a weekend', () => {
    const sat = new Date(Date.UTC(2026, 7, 15, 2, 0)); // beijing sat
    expect(nextTradingDays(2, sat)).toEqual(['2026-08-17', '2026-08-18']);
  });

  it('defaults to current time when now is omitted', () => {
    expect(nextTradingDays(1)).toHaveLength(1);
  });
});

describe('filterRecentApplies', () => {
  const mk = (applyDate: string) => ({ applyDate });

  it('keeps only items inside the window and sorts ascending', () => {
    const days = ['2026-08-14', '2026-08-17', '2026-08-18'];
    const stocks = [
      mk('2026-08-21'),
      mk('2026-08-17'),
      mk('2026-08-14'),
      mk('2026-09-01'),
    ];
    const bonds = [mk('2026-08-18'), mk('2026-08-20')];
    const out = filterRecentApplies(stocks, bonds, days);
    expect(out.stocks.map((s) => s.applyDate)).toEqual(['2026-08-14', '2026-08-17']);
    expect(out.bonds.map((b) => b.applyDate)).toEqual(['2026-08-18']);
  });

  it('returns empty lists when nothing is in the window', () => {
    const out = filterRecentApplies([mk('2026-09-01')], [mk('2026-08-20')], ['2026-08-14']);
    expect(out.stocks).toHaveLength(0);
    expect(out.bonds).toHaveLength(0);
  });

  it('keeps ordering stable for same-date items', () => {
    const a = mk('2026-08-17');
    const b = mk('2026-08-17');
    const out = filterRecentApplies([b, a], [], ['2026-08-17']);
    expect(out.stocks[0]).toBe(b);
    expect(out.stocks[1]).toBe(a);
  });
});

describe('dayLabel', () => {
  const today = '2026-08-14'; // Friday

  it('marks same-day as 今日 and next calendar day as 明日', () => {
    expect(dayLabel('2026-08-14', today)).toBe('今日 08-14');
    expect(dayLabel('2026-08-15', today)).toBe('明日 08-15');
  });

  it('falls back to weekday when not tomorrow', () => {
    // 08-17 is Monday but 3 calendar days later, not 明日
    expect(dayLabel('2026-08-17', today)).toBe('周一 08-17');
    expect(dayLabel('2026-08-18', today)).toBe('周二 08-18');
    expect(dayLabel('2026-08-16', today)).toBe('周日 08-16');
  });
});

describe('calendarDays', () => {
  it('computes natural day difference', () => {
    expect(calendarDays('2026-08-14', '2026-08-14')).toBe(0);
    expect(calendarDays('2026-08-14', '2026-08-17')).toBe(3);
    expect(calendarDays('2026-08-18', '2026-08-14')).toBe(-4);
  });
});

describe('boardOf', () => {
  it('derives one-char board from code prefix', () => {
    expect(boardOf('601123')).toBe('沪');
    expect(boardOf('688835')).toBe('科');
    expect(boardOf('300125')).toBe('创');
    expect(boardOf('000001')).toBe('深');
    expect(boardOf('002594')).toBe('深');
    expect(boardOf('833171')).toBe('北');
    expect(boardOf('920820')).toBe('北');
    expect(boardOf('113050')).toBe('沪');
    expect(boardOf('123001')).toBe('深');
    expect(boardOf('')).toBe('');
  });
});