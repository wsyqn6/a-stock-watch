import { describe, expect, it } from 'bun:test';
import {
  parseTencentResponse,
  parseMinuteResponse,
  parseKlineResponse,
  buildSpark,
  buildMinuteSeries,
  buildMinuteChart,
  buildKlineLayout,
  KlinePoint,
  sessionMinute,
  isTradingTime,
  beijingDateStr,
  noteMarketDate,
  SparkData,
} from '../src/dataSource';

const SAMPLE = `v_sh600519="1~贵州茅台~600519~1421.50~1400.00~1401.00~30246~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~21.50~1.54~1425.00~1400.00~0~0~0~0~5.03~0~0~0~0~0~0";`;
const DOWN_SAMPLE = `v_sz000001="1~平安银行~000001~10.00~10.50~10.20~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~-0.50~-4.76~10.50~10.00~0~0~0~0~0~0~0~0~0~0~0~0";`;

describe('parseTencentResponse', () => {
  it('parses an up quote', () => {
    const q = parseTencentResponse(SAMPLE);
    expect(q).toHaveLength(1);
    const it0 = q[0];
    expect(it0.symbol).toBe('sh600519');
    expect(it0.name).toBe('贵州茅台');
    expect(it0.price).toBe(1421.5);
    expect(it0.prevClose).toBe(1400.0);
    expect(it0.change).toBe(21.5);
    expect(it0.changePct).toBe(1.54);
    expect(it0.trend).toBe('up');
  });

  it('parses a down quote', () => {
    const q = parseTencentResponse(DOWN_SAMPLE);
    expect(q[0].trend).toBe('down');
    expect(q[0].changePct).toBe(-4.76);
  });

  it('parses multiple quotes', () => {
    const q = parseTencentResponse(SAMPLE + DOWN_SAMPLE);
    expect(q).toHaveLength(2);
  });

  it('parses valuation metrics: turnover, PE, PB and market caps', () => {
    const f = Array(47).fill('0');
    f[1] = 'A'; f[2] = 'sh600519'; f[3] = '10.00'; f[4] = '10.00';
    f[30] = '20260805150000';
    f[31] = '0.00'; f[32] = '0.00';
    f[33] = '10.20'; f[34] = '9.90';
    f[38] = '1.23';   // 换手率 %
    f[39] = '25.6';   // 市盈率 TTM
    f[44] = '1250.0'; // 流通市值（亿）
    f[45] = '1300.0'; // 总市值（亿）
    f[46] = '4.56';   // 市净率
    const q = parseTencentResponse('v_sh600519="' + f.join('~') + '";');
    expect(q).toHaveLength(1);
    const it0 = q[0];
    expect(it0.turnoverRate).toBeCloseTo(1.23, 5);
    expect(it0.pe).toBeCloseTo(25.6, 5);
    expect(it0.pb).toBeCloseTo(4.56, 5);
    expect(it0.circMcap).toBeCloseTo(1250.0 * 1e8, 0);
    expect(it0.totalMcap).toBeCloseTo(1300.0 * 1e8, 0);
  });

  it('leaves valuation metrics undefined when absent or zero', () => {
    // 34-field row (truncated at index 33) carries no valuation metrics
    const f = Array(34).fill('0');
    f[1] = 'A'; f[2] = 'sh600519'; f[3] = '10.00'; f[4] = '10.00';
    f[30] = '20260805150000'; f[31] = '0.00'; f[32] = '0.00'; f[33] = '10.20';
    const q = parseTencentResponse('v_sh600519="' + f.join('~') + '";');
    expect(q).toHaveLength(1);
    expect(q[0].turnoverRate).toBeUndefined();
    expect(q[0].pe).toBeUndefined();
    expect(q[0].pb).toBeUndefined();
    expect(q[0].circMcap).toBeUndefined();
    expect(q[0].totalMcap).toBeUndefined();

    // zero-valued metrics are dropped
    const z = Array(47).fill('0');
    z[1] = 'A'; z[2] = 'sh600519'; z[3] = '10.00'; z[4] = '10.00';
    z[30] = '20260805150000'; z[31] = '0.00'; z[32] = '0.00';
    z[33] = '10.20'; z[34] = '9.90'; z[38] = '0'; z[39] = '0';
    z[44] = '0'; z[45] = '0'; z[46] = '0';
    const qz = parseTencentResponse('v_sh600519="' + z.join('~') + '";');
    expect(qz[0].turnoverRate).toBeUndefined();
    expect(qz[0].pe).toBeUndefined();
    expect(qz[0].pb).toBeUndefined();
    expect(qz[0].circMcap).toBeUndefined();
    expect(qz[0].totalMcap).toBeUndefined();
  });

  it('ignores malformed lines', () => {
    const q = parseTencentResponse('garbage;');
    expect(q).toHaveLength(0);
  });

  it('skips truncated field rows', () => {
    const q = parseTencentResponse('v_sh12345="1~短~600519";');
    expect(q).toHaveLength(0);
  });

  it('extracts quote date from the timestamp field', () => {
    const f = Array(33).fill('0');
    f[0] = '1';
    f[1] = 'A';
    f[2] = 'sh000001';
    f[3] = '10.00';
    f[4] = '10.00';
    f[5] = '10.00';
    f[30] = '20260805161202';
    f[31] = '0.00';
    f[32] = '0.00';
    const q = parseTencentResponse(`v_sh000001="${f.join('~')}";`);
    expect(q[0].date).toBe('20260805');
  });

  it('parses open/high/low when fields present', () => {
    const f = Array(40).fill('0');
    f[0] = '1';
    f[1] = '测试股';
    f[2] = 'sh600000';
    f[3] = '10.50';
    f[4] = '10.00';
    f[5] = '10.20';
    f[30] = '20260805150300';
    f[31] = '0.50';
    f[32] = '5.00';
    f[33] = '10.80';
    f[34] = '10.10';
    const q = parseTencentResponse(`v_sh600000="${f.join('~')}";`);
    expect(q[0].open).toBe(10.2);
    expect(q[0].high).toBe(10.8);
    expect(q[0].low).toBe(10.1);
  });

  it('leaves open/high/low undefined when absent', () => {
    const f = Array(33).fill('0');
    f[0] = '1';
    f[1] = 'A';
    f[2] = 'sh000001';
    f[3] = '10.00';
    f[4] = '10.00';
    f[5] = '10.00';
    f[30] = '20260805161202';
    f[31] = '0.00';
    f[32] = '0.00';
    const q = parseTencentResponse(`v_sh000001="${f.join('~')}";`);
    expect(q[0].high).toBeUndefined();
    expect(q[0].low).toBeUndefined();
  });

  it('leaves date empty when timestamp is missing', () => {
    const q = parseTencentResponse(SAMPLE);
    expect(q[0].date).toBe('');
  });
});

describe('parseMinuteResponse', () => {
  const SYM = 'sz000001';
  const raw = JSON.stringify({
    code: 0,
    data: {
      [SYM]: {
        data: {
          date: '20260805',
          data: [
            '0930 1822.42 2098 100.00',
            '0931 1811.05 2644 200.00',
            '0932 1817.01 3174 300.00',
            '1130 1818.00 100 400.00',
            '1301 1820.00 200 500.00',
            '1500 1830.50 300 600.00',
          ],
        },
      },
    },
  });

  it('parses date and points', () => {
    const d = parseMinuteResponse(raw, SYM);
    expect(d.date).toBe('20260805');
    expect(d.points).toHaveLength(6);
    expect(d.points[0]).toMatchObject({ time: '0930', price: 1822.42 });
    expect(d.points[5]).toMatchObject({ time: '1500', price: 1830.5 });
  });

  it('ignores malformed rows', () => {
    const d = parseMinuteResponse(
      JSON.stringify({
        data: {
          [SYM]: {
            data: { date: '20260805', data: ['abc 1 2', 'xyz 3 4'] },
          },
        },
      }),
      SYM,
    );
    expect(d.date).toBe('20260805');
    expect(d.points).toHaveLength(0);
  });

  it('returns empty for missing symbol', () => {
    const d = parseMinuteResponse(raw, 'sh999999');
    expect(d.date).toBe('');
    expect(d.points).toHaveLength(0);
  });

  it('returns empty for invalid json', () => {
    const d = parseMinuteResponse('not json', SYM);
    expect(d.date).toBe('');
    expect(d.points).toHaveLength(0);
  });

  it('builds spark with up color when last > prevClose', () => {
    const d = parseMinuteResponse(raw, SYM);
    const s = buildSpark(d, 1822.42);
    expect(s).not.toBeNull();
    expect(s!.color).toBe('up');
    expect(s!.line).toContain(',');
  });

  it('anchors curve start at market open (0930)', () => {
    const d = parseMinuteResponse(raw, SYM);
    const s = buildSpark(d, 1822.42);
    expect(s!.line.split(' ')[0].split(',')[0]).toBe('1.0');
  });

  it('adds baseline at prevClose y', () => {
    const d = parseMinuteResponse(raw, SYM);
    const s = buildSpark(d, 1822.42);
    expect(s).not.toBeNull();
    expect(s!.baseY).toBeGreaterThanOrEqual(1);
    expect(s!.baseY).toBeLessThanOrEqual(17);
  });

  it('scales curve width to elapsed session time', () => {
    const body = (times: string[]) =>
      JSON.stringify({
        data: {
          [SYM]: {
            data: {
              date: '20260805',
              data: times.map((t) => `${t} 10.00 1 1.00`),
            },
          },
        },
      });
    const open = buildSpark(parseMinuteResponse(body(['0930', '0931']), SYM), 10);
    const morning = buildSpark(
      parseMinuteResponse(body(['0930', '1130']), SYM),
      10,
    );
    const midday = buildSpark(
      parseMinuteResponse(body(['0930', '1300']), SYM),
      10,
    );
    const close = buildSpark(
      parseMinuteResponse(body(['0930', '1500']), SYM),
      10,
    );
    const xEnd = (s: SparkData) => {
      const parts = s.line.split(' ');
      return Number(parts[parts.length - 1].split(',')[0]);
    };
    expect(xEnd(open!)).toBeLessThan(xEnd(morning!));
    expect(xEnd(morning!)).toBeCloseTo(50, 0);
    expect(xEnd(midday!)).toBeCloseTo(50, 0);
    expect(xEnd(close!)).toBeCloseTo(99, 0);
  });

  it('returns null for insufficient points', () => {
    const d = { date: '211008', points: [{ time: '0930', price: 10 }] };
    expect(buildSpark(d, 10)).toBeNull();
  });
});

describe('minute series & chart', () => {
  const SYM = 'sz000001';
  const minuteJSON = (rows: string[]) =>
    JSON.stringify({
      data: {
        [SYM]: {
          data: {
            date: '20260805',
            data: rows,
          },
        },
      },
    });
  // vol in 手, amt = price * vol * 100 元
  const rows = [
    '0930 10.00 100 100000.00',
    '0931 10.20 300 303000.00',
    '0932 10.10 400 402800.00',
    '0933 10.00 400 400000.00',
  ];

  it('parses cumulative volume and amount', () => {
    const d = parseMinuteResponse(minuteJSON(rows), SYM);
    expect(d.points[0]).toEqual({ time: '0930', price: 10.0, vol: 100, amt: 100000 });
    expect(d.points[3].vol).toBe(400);
  });

  it('parses 2-field rows without volume info', () => {
    const d = parseMinuteResponse(minuteJSON(['0930 10.00', '0931 10.10']), SYM);
    expect(d.points[0].vol).toBeUndefined();
  });

  it('computes cumulative average price and per-minute volume', () => {
    const s = buildMinuteSeries(parseMinuteResponse(minuteJSON(rows), SYM));
    expect(s).toHaveLength(4);
    expect(s[0]).toEqual({ time: '0930', price: 10.0, avg: 10.0, volume: 0 });
    expect(s[1].avg).toBeCloseTo(10.1, 4);
    expect(s[1].volume).toBe(200);
    expect(s[2].avg).toBeCloseTo(10.07, 4);
    expect(s[2].volume).toBe(100);
    expect(s[3].volume).toBe(0);
  });

  it('skips points without volume info', () => {
    const d = parseMinuteResponse(minuteJSON(['0930 10.00', '0931 10.10 200 202000.00']), SYM);
    const s = buildMinuteSeries(d);
    expect(s).toHaveLength(1);
    expect(s[0].time).toBe('0931');
  });

  it('builds a chart layout with line, avg, baseline and volume bars', () => {
    const c = buildMinuteChart(parseMinuteResponse(minuteJSON(rows), SYM), 10.0);
    expect(c).not.toBeNull();
    expect(c!.priceLine.split(' ')).toHaveLength(4);
    expect(c!.avgLine).toBeTruthy();
    expect(c!.baseY).toBeGreaterThan(0);
    expect(c!.lastPrice).toBe(10.0);
    expect(c!.lastAvg).toBeCloseTo(10.0, 4);
    expect(c!.bars).toHaveLength(4);
    expect(c!.bars[0].h).toBe(0);
    expect(c!.xTicks.map((t) => t.label)).toEqual([
      '09:30',
      '10:30',
      '11:30',
      '14:00',
      '15:00',
    ]);
  });

  it('returns null for insufficient points', () => {
    const d = parseMinuteResponse(minuteJSON(['0930 10.00 100 100000.00']), SYM);
    expect(buildMinuteChart(d, 10)).toBeNull();
  });

  it('drops avg when avg unit mismatches price (index-like)', () => {
    const indexRows = [
      '0930 3896.49 4763106 9005773968.70',
      '0931 3893.03 17978590 34271023623.20',
      '0932 3890.05 31411251 61233091457.00',
      '0933 3893.92 39690844 79500731107.60',
    ];
    const c = buildMinuteChart(
      parseMinuteResponse(minuteJSON(indexRows), SYM),
      3900.35,
    )!;
    expect(c.avgLine).toBeNull();
    expect(c.lastAvg).toBeNull();
    expect(c.pts[0].avg).toBeNull();
    expect(c.pts[0].ay).toBeNull();
  });

  it('spreads price line across full height without bogus avg', () => {
    const indexRows = [
      '0930 3896.49 4763106 9005773968.70',
      '0931 3893.03 17978590 34271023623.20',
      '0932 3890.05 31411251 61233091457.00',
      '0933 3893.92 39690844 79500731107.60',
    ];
    const c = buildMinuteChart(
      parseMinuteResponse(minuteJSON(indexRows), SYM),
      3900.35,
    )!;
    const ys = c.pts.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(c.mainH * 0.5);
  });

  it('keeps avg when it falls inside the price range', () => {
    const c = buildMinuteChart(parseMinuteResponse(minuteJSON(rows), SYM), 10.0)!;
    expect(c.avgLine).not.toBeNull();
    expect(c.lastAvg).not.toBeNull();
    expect(c.pts[0].avg).not.toBeNull();
  });

  it('sizes volume bars by max per-minute volume', () => {
    const c = buildMinuteChart(parseMinuteResponse(minuteJSON(rows), SYM), 10.0)!;
    const maxBar = Math.max(...c.bars.map((b) => b.h));
    expect(maxBar).toBeCloseTo(c.volH - 2, 1);
  });

  it('returns null for series with no volume data', () => {
    const d = parseMinuteResponse(minuteJSON(['0930 10.00', '0931 10.10']), SYM);
    expect(buildMinuteChart(d, 10)).toBeNull();
  });
});

describe('sessionMinute', () => {
  it('maps open, close and lunch break', () => {
    expect(sessionMinute('0930')).toBe(0);
    expect(sessionMinute('1130')).toBe(120);
    expect(sessionMinute('1300')).toBe(120);
    expect(sessionMinute('1500')).toBe(240);
  });

  it('clamps before open and after close', () => {
    expect(sessionMinute('0900')).toBe(0);
    expect(sessionMinute('0905')).toBe(0);
    expect(sessionMinute('1530')).toBe(240);
  });
});

describe('isTradingTime', () => {
  // beijing 2026-08-05 is Wednesday; beijing wall time = UTC + 8h
  const bj = (h: number, m: number) => new Date(Date.UTC(2026, 7, 5, h - 8, m));

  it('allows trading windows from 09:15 auction to close', () => {
    expect(isTradingTime(bj(9, 14))).toBe(false);
    expect(isTradingTime(bj(9, 15))).toBe(true);
    expect(isTradingTime(bj(11, 29))).toBe(true);
    expect(isTradingTime(bj(11, 30))).toBe(false);
    expect(isTradingTime(bj(12, 59))).toBe(false);
    expect(isTradingTime(bj(13, 0))).toBe(true);
    expect(isTradingTime(bj(14, 59))).toBe(true);
    expect(isTradingTime(bj(15, 0))).toBe(false);
  });

  it('returns false on weekends', () => {
    const sat = new Date(Date.UTC(2026, 7, 8, 2, 0)); // beijing sat 10:00
    const sun = new Date(Date.UTC(2026, 7, 2, 2, 0)); // beijing sun 10:00
    expect(isTradingTime(sat)).toBe(false);
    expect(isTradingTime(sun)).toBe(false);
  });
});

describe('beijingDateStr', () => {
  it('formats a beijing wall date as YYYYMMDD', () => {
    const now = new Date(Date.UTC(2026, 7, 4, 22, 0)); // beijing 2026-08-05 06:00
    expect(beijingDateStr(now)).toBe('20260805');
  });
});

describe('noteMarketDate', () => {
  // beijing 2026-08-05 is Wednesday; wall time = UTC + 8h
  const bj = (h: number, m: number) => new Date(Date.UTC(2026, 7, 5, h - 8, m));

  it('flags a closed day when no quote date is today', () => {
    noteMarketDate(['20260803', '20260804'], bj(10, 0));
    expect(isTradingTime(bj(10, 0))).toBe(false);
  });

  it('recovers when a today-dated quote arrives', () => {
    noteMarketDate(['20260805'], bj(10, 0));
    expect(isTradingTime(bj(10, 0))).toBe(true);
  });

  it('resets a stale closed-day flag on a new day', () => {
    noteMarketDate(['20260803'], bj(10, 0)); // closedDay = 20260805
    const next = new Date(Date.UTC(2026, 7, 6, 2, 0)); // beijing thu 10:00
    expect(isTradingTime(next)).toBe(true);
  });

  it('stays trading when no quote date is parsed', () => {
    noteMarketDate([], bj(10, 0));
    expect(isTradingTime(bj(10, 0))).toBe(true);
  });
});

describe('parseKlineResponse', () => {
  const SYM = 'sh600519';
  // 腾讯 K 线行格式: [date, open, close, high, low, volume]
  const klineJSON = (key: string, rows: string[][]) =>
    JSON.stringify({ data: { [SYM]: { [key]: rows } } });

  it('parses day kline from qfqday', () => {
    const rows = [
      ['20260803', '1800', '1810', '1815', '1790', '30000'],
      ['20260804', '1810', '1795', '1820', '1780', '40000'],
    ];
    const pts = parseKlineResponse(klineJSON('qfqday', rows), SYM, 'day');
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual({
      date: '20260803',
      open: 1800,
      close: 1810,
      high: 1815,
      low: 1790,
      volume: 30000,
    });
  });

  it('maps week and month to their response keys', () => {
    const weekRows = [['20260803', '1800', '1810', '1815', '1790', '30000']];
    const monthRows = [['20260731', '1700', '1810', '1820', '1690', '50000']];
    expect(parseKlineResponse(klineJSON('qfqweek', weekRows), SYM, 'week')).toHaveLength(1);
    expect(parseKlineResponse(klineJSON('qfqmonth', monthRows), SYM, 'month')).toHaveLength(1);
    // wrong key → empty
    expect(parseKlineResponse(klineJSON('qfqday', weekRows), SYM, 'week')).toHaveLength(0);
  });

  it('filters out rows with zero close', () => {
    const rows = [
      ['20260803', '1800', '1810', '1815', '1790', '30000'],
      ['20260804', '1810', '0', '1820', '1780', '40000'],
    ];
    const pts = parseKlineResponse(klineJSON('qfqday', rows), SYM, 'day');
    expect(pts).toHaveLength(1);
  });

  it('returns empty for invalid json or missing data', () => {
    expect(parseKlineResponse('not json', SYM, 'day')).toHaveLength(0);
    expect(parseKlineResponse(JSON.stringify({ data: {} }), SYM, 'day')).toHaveLength(0);
    expect(parseKlineResponse(JSON.stringify({}), SYM, 'day')).toHaveLength(0);
  });
});

describe('buildKlineLayout', () => {
  const klines: KlinePoint[] = [
    { date: '20260730', open: 10, close: 10.5, high: 10.8, low: 9.8, volume: 1000 },
    { date: '20260731', open: 10.5, close: 10.2, high: 10.6, low: 10.0, volume: 2000 },
    { date: '20260803', open: 10.2, close: 10.7, high: 10.9, low: 10.1, volume: 1500 },
  ];

  it('builds one candle and volume bar per point', () => {
    const L = buildKlineLayout(klines);
    expect(L.candles).toHaveLength(3);
    expect(L.volBars).toHaveLength(3);
    expect(L.lastPrice).toBe(10.7);
  });

  it('marks up candles (close >= open) as up and down otherwise', () => {
    const L = buildKlineLayout(klines);
    expect(L.candles[0].cls).toBe('up');
    expect(L.candles[1].cls).toBe('down');
    expect(L.candles[2].cls).toBe('up');
  });

  it('sizes volume bars by max volume', () => {
    const L = buildKlineLayout(klines);
    const maxBar = Math.max(...L.volBars.map((b) => b.h));
    expect(maxBar).toBeCloseTo(L.volH - 2, 1);
  });

  it('produces x-axis ticks and y-axis ticks', () => {
    const L = buildKlineLayout(klines);
    expect(L.xTicks.length).toBeGreaterThan(0);
    expect(L.yTicks.length).toBe(5);
  });
});