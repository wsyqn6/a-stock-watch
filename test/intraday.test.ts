import { beforeEach, describe, expect, it } from 'bun:test';
import { IntradayBook } from '../src/intraday';
import { MinuteData, StockQuote, noteMarketDate } from '../src/dataSource';

const SYM = 'sh563020';
const DAY = '20261027';

/** 北京时间 2026-10-27（周二）的某个时刻。 */
const bj = (h: number, m: number, s = 0) => new Date(Date.UTC(2026, 9, 27, h - 8, m, s));

function quote(
  price: number,
  opts: Partial<StockQuote> = {},
): StockQuote {
  const prevClose = opts.prevClose ?? 10;
  return {
    symbol: SYM,
    name: '测试ETF',
    price,
    prevClose,
    change: price - prevClose,
    changePct: ((price - prevClose) / prevClose) * 100,
    trend: price > prevClose ? 'up' : price < prevClose ? 'down' : 'flat',
    date: DAY,
    ...opts,
  };
}

function minute(
  rows: [string, number][],
  date = DAY,
): MinuteData {
  return {
    date,
    points: rows.map(([time, price]) => ({ time, price, vol: 100, amt: price * 100 })),
  };
}

describe('IntradayBook', () => {
  beforeEach(() => {
    noteMarketDate([DAY], bj(10, 0));
  });

  it('把行情写入分钟桶，同一分钟覆盖，不追加重复点', () => {
    const book = new IntradayBook();
    book.recordQuotes([quote(10.1, { time: '100010' })], bj(10, 0, 10));
    book.recordQuotes([quote(10.2, { time: '100040' })], bj(10, 0, 40));
    book.recordQuotes([quote(10.3, { time: '100105' })], bj(10, 1, 5));

    const data = book.merged(SYM, bj(10, 1, 5));
    expect(data?.points.map((p) => [p.time, p.price])).toEqual([
      ['1000', 10.2],
      ['1001', 10.3],
    ]);
  });

  it('盘前集合竞价不写入分钟桶', () => {
    const book = new IntradayBook();
    book.recordQuotes([quote(10.1, { time: '092000' })], bj(9, 20));
    expect(book.spark(SYM, quote(10.1, { time: '092000' }), bj(9, 20))).toBeNull();
  });

  it('合并分时种子与本地行情，分时末点之后追加，同分钟本地优先', () => {
    const book = new IntradayBook();
    book.recordQuotes([quote(10.15, { time: '093100' })], bj(9, 31));
    book.recordQuotes([quote(10.2, { time: '093200' })], bj(9, 32));
    book.applySeed(
      SYM,
      minute([
        ['0930', 10],
        ['0931', 10.1],
      ]),
      quote(10.2, { time: '093200' }),
      bj(9, 32),
    );

    const data = book.merged(SYM, bj(9, 32));
    expect(data?.points.map((p) => [p.time, p.price])).toEqual([
      ['0930', 10],
      ['0931', 10.15],
      ['0932', 10.2],
    ]);
  });

  it('交易时段不画上一交易日的分时，非交易日允许显示最近交易日', () => {
    const book = new IntradayBook();
    const prevDay = '20261026';
    const weekend = new Date(Date.UTC(2026, 9, 31, 2, 0)); // 周六 10:00
    book.applySeed(
      SYM,
      minute(
        [
          ['0930', 10],
          ['1500', 10.1],
        ],
        prevDay,
      ),
      quote(10.1, { date: prevDay }),
      weekend,
    );

    expect(book.spark(SYM, quote(10.1, { date: prevDay }), bj(10, 0))).toBeNull();
    expect(book.spark(SYM, quote(10.1, { date: prevDay }), weekend)).not.toBeNull();
  });

  it('缺少历史或有缺口时要求补种子，盘前和午休不误判', () => {
    const book = new IntradayBook();
    const now = bj(10, 3);
    expect(book.needsSeed(SYM, quote(10.1, { time: '100300' }), now)).toBe(true);

    book.applySeed(
      SYM,
      minute([
        ['0930', 10],
        ['1000', 10.1],
      ]),
      quote(10.1, { time: '100300' }),
      now,
    );
    expect(book.needsSeed(SYM, quote(10.1, { time: '100300' }), now)).toBe(false);
    expect(book.needsSeed(SYM, quote(10.1, { time: '101000' }), bj(10, 10))).toBe(true);

    const lunch = bj(11, 35);
    const lunchBook = new IntradayBook();
    lunchBook.applySeed(
      SYM,
      minute([
        ['0930', 10],
        ['1130', 10.1],
      ]),
      quote(10.1, { time: '113000' }),
      lunch,
    );
    expect(lunchBook.needsSeed(SYM, quote(10.1, { time: '113500' }), lunch)).toBe(false);

    const preOpen = bj(9, 20);
    expect(new IntradayBook().needsSeed(SYM, quote(10.1, { time: '092000' }), preOpen)).toBe(false);
  });

  it('移除标的后不再保留日内状态', () => {
    const book = new IntradayBook();
    book.recordQuotes([quote(10.1, { time: '100000' })], bj(10, 0));
    expect(book.has(SYM)).toBe(true);
    book.prune(new Set());
    expect(book.has(SYM)).toBe(false);
  });

  it('快照可恢复当日序列，交易时段不恢复旧日期，非交易日允许', () => {
    const book = new IntradayBook();
    book.recordQuotes([quote(10.1, { time: '100000' })], bj(10, 0));
    book.applySeed(
      SYM,
      minute([
        ['0930', 10],
        ['1000', 10.1],
      ]),
      quote(10.1, { time: '100000' }),
      bj(10, 0),
    );
    const snapshot = book.snapshot(bj(10, 0));

    const sameDay = new IntradayBook();
    sameDay.restore(snapshot, bj(10, 0));
    expect(sameDay.has(SYM)).toBe(true);
    expect(sameDay.spark(SYM, quote(10.1, { time: '100000' }), bj(10, 0))).not.toBeNull();
    // 快照已覆盖到当前分钟，恢复后不应再补种子
    expect(sameDay.needsSeed(SYM, quote(10.1, { time: '100000' }), bj(10, 0))).toBe(false);

    const nextDay = new IntradayBook();
    nextDay.restore(snapshot, new Date(Date.UTC(2026, 9, 28, 2, 0)));
    expect(nextDay.has(SYM)).toBe(false);

    const weekend = new IntradayBook();
    weekend.restore(snapshot, new Date(Date.UTC(2026, 9, 31, 2, 0)));
    expect(weekend.has(SYM)).toBe(true);
  });

  it('忽略损坏的快照数据', () => {
    const book = new IntradayBook();
    book.restore({ v: 1, entries: { [SYM]: { date: 'bad', prevClose: 0, points: [] } } }, bj(10, 0));
    expect(book.has(SYM)).toBe(false);
  });

  it('恢复后行情从当前分钟续写时，补上快照与行情之间的空档', () => {
    const book = new IntradayBook();
    book.recordQuotes([quote(10.1, { time: '100000' })], bj(10, 0));
    book.applySeed(
      SYM,
      minute([
        ['0930', 10],
        ['1000', 10.1],
      ]),
      quote(10.1, { time: '100000' }),
      bj(10, 0),
    );
    const restored = new IntradayBook();
    restored.restore(book.snapshot(bj(10, 0)), bj(10, 0));

    // 午休后重开，行情直接续到 13:00，中间 10:01–12:59 需要补种子
    restored.recordQuotes([quote(10.2, { time: '130000' })], bj(13, 0));
    expect(restored.needsSeed(SYM, quote(10.2, { time: '130000' }), bj(13, 0))).toBe(true);
  });
});
