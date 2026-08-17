import { describe, expect, it } from 'bun:test';
import {
  buildTelegraphQuery,
  fmtPct,
  fmtReading,
  formatTelegraphTime,
  parseTelegraphResponse,
  pctSign,
  toTelegraphDisplayItem,
} from '../src/telegraph';

describe('buildTelegraphQuery', () => {
  it('computes sign = md5(sha1(sorted query))', () => {
    const sp = buildTelegraphQuery(1700000000, 30);
    const sign = sp.get('sign');
    expect(sign).toBe('399998d8aa76570e9bfc259b690c1dfd');
  });

  it('exposes all base params and extra params', () => {
    const sp = buildTelegraphQuery(1700000000, 30);
    expect(sp.get('appName')).toBe('CailianpressWeb');
    expect(sp.get('os')).toBe('web');
    expect(sp.get('sv')).toBe('7.7.5');
    expect(sp.get('last_time')).toBe('1700000000');
    expect(sp.get('refresh_type')).toBe('1');
    expect(sp.get('rn')).toBe('30');
  });
});

describe('parseTelegraphResponse', () => {
  const raw = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 123,
    title: '标题',
    brief: '摘要',
    content: '全量正文',
    level: 'C',
    reading_num: 0,
    stock_list: [],
    ctime: 1700000000,
    is_ad: 0,
    ...over,
  });

  it('maps fields and converts ctime seconds to ms', () => {
    const items = parseTelegraphResponse(
      JSON.stringify({ data: { roll_data: [raw()] } }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      id: 123,
      title: '标题',
      brief: '摘要',
      content: '全量正文',
      level: 'C',
      reading: 0,
      stocks: [],
      url: 'https://www.cls.cn/detail/123',
      ctime: 1700000000000,
    });
  });

  it('maps level, reading and stock_list', () => {
    const items = parseTelegraphResponse(
      JSON.stringify({
        data: {
          roll_data: [
            raw({
              level: 'B',
              reading_num: 422843,
              stock_list: [
                { name: '国航远洋', RiseRange: 4.68 },
                { name: '平开票', RiseRange: 0 },
                { name: '无值票', RiseRange: null },
                { bad: 1 },
              ],
            }),
          ],
        },
      }),
    );
    expect(items[0].level).toBe('B');
    expect(items[0].reading).toBe(422843);
    expect(items[0].stocks).toEqual([
      { name: '国航远洋', pct: 4.68 },
      { name: '平开票', pct: 0 },
      { name: '无值票', pct: null },
    ]);
  });

  it('filters out ads', () => {
    const items = parseTelegraphResponse(
      JSON.stringify({
        data: { roll_data: [raw({ is_ad: 1 }), raw({ id: 456 })] },
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(456);
  });

  it('drops rows with invalid id or ctime', () => {
    const items = parseTelegraphResponse(
      JSON.stringify({
        data: {
          roll_data: [
            raw({ id: 'x' }),
            raw({ ctime: 0 }),
            raw({ id: 7, ctime: 1700000000 }),
          ],
        },
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(7);
  });

  it('returns [] for invalid json, missing data, or non-array roll_data', () => {
    expect(parseTelegraphResponse('not json')).toHaveLength(0);
    expect(parseTelegraphResponse(JSON.stringify({ success: true }))).toHaveLength(0);
    expect(
      parseTelegraphResponse(JSON.stringify({ data: { roll_data: 'x' } })),
    ).toHaveLength(0);
  });
});

describe('fmtReading', () => {
  it('formats >=1万 as X.X万 and trims .0', () => {
    expect(fmtReading(422843)).toBe('42.3万');
    expect(fmtReading(10000)).toBe('1万');
    expect(fmtReading(100000)).toBe('10万');
    expect(fmtReading(8932)).toBe('8932');
    expect(fmtReading(0)).toBe('0');
  });
});

describe('pctSign / fmtPct', () => {
  it('classifies direction', () => {
    expect(pctSign(4.68)).toBe('up');
    expect(pctSign(-2.1)).toBe('down');
    expect(pctSign(0)).toBe('flat');
    expect(pctSign(null)).toBe('flat');
  });

  it('formats pct with sign', () => {
    expect(fmtPct(4.68)).toBe('+4.68%');
    expect(fmtPct(-2.1)).toBe('-2.10%');
    expect(fmtPct(0)).toBe('0.00%');
    expect(fmtPct(null)).toBe('');
  });
});

describe('formatTelegraphTime', () => {
  const now = new Date('2026-08-17T04:00:00Z'); // 北京 12:00 08-17

  it('today → HH:MM', () => {
    expect(formatTelegraphTime(Date.parse('2026-08-17T02:04:00Z'), now)).toBe('10:04');
  });

  it('yesterday → 昨天 HH:MM', () => {
    expect(formatTelegraphTime(Date.parse('2026-08-16T03:00:00Z'), now)).toBe('昨天 11:00');
  });

  it('earlier → MM-DD HH:MM', () => {
    expect(formatTelegraphTime(Date.parse('2026-08-10T03:00:00Z'), now)).toBe('08-10 11:00');
  });
});

describe('toTelegraphDisplayItem', () => {
  const now = new Date('2026-08-17T04:00:00Z');
  const item = {
    id: 1,
    title: '标题',
    brief: '摘要',
    content: '全量正文',
    level: 'B',
    reading: 422843,
    stocks: [{ name: '国航远洋', pct: 4.68 }],
    url: 'https://www.cls.cn/detail/1',
    ctime: Date.parse('2026-08-17T02:00:00Z'),
  };

  it('flattens item with time/text/level/reading/stocks', () => {
    expect(toTelegraphDisplayItem(item, now)).toEqual({
      time: '10:00',
      text: '全量正文',
      level: 'B',
      reading: 422843,
      stocks: [{ name: '国航远洋', pct: 4.68 }],
    });
  });

  it('falls back to title when content empty', () => {
    expect(toTelegraphDisplayItem({ ...item, content: '' }, now).text).toBe('标题');
  });
});