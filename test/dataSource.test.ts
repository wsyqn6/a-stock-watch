import { describe, expect, it } from 'bun:test';
import {
  parseTencentResponse,
  parseMinuteResponse,
  buildSpark,
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

  it('ignores malformed lines', () => {
    const q = parseTencentResponse('garbage;');
    expect(q).toHaveLength(0);
  });

  it('skips truncated field rows', () => {
    const q = parseTencentResponse('v_sh12345="1~短~600519";');
    expect(q).toHaveLength(0);
  });
});

describe('parseMinuteResponse', () => {
  const raw = `min_data="\\n\\
date:211008\\n\\
0930 1822.42 2098\\n\\
0931 1811.05 2644\\n\\
0932 1817.01 3174\\n\\
1130 1818.00 100\\n\\
1301 1820.00 200\\n\\
1500 1830.50 300\\n\\
";`;

  it('parses date and points', () => {
    const d = parseMinuteResponse(raw);
    expect(d.date).toBe('211008');
    expect(d.points).toHaveLength(6);
    expect(d.points[0]).toEqual({ time: '0930', price: 1822.42 });
    expect(d.points[5]).toEqual({ time: '1500', price: 1830.5 });
  });

  it('ignores malformed lines', () => {
    const d = parseMinuteResponse('garbage\\ndate:123456\\nabc 1 2\\n');
    expect(d.date).toBe('123456');
    expect(d.points).toHaveLength(0);
  });

  it('builds spark with up color when last > prevClose', () => {
    const d = parseMinuteResponse(raw);
    const s = buildSpark(d, 1822.42);
    expect(s).not.toBeNull();
    expect(s!.color).toBe('up');
    expect(s!.line).toContain(',');
  });

  it('returns null for insufficient points', () => {
    const d = { date: '211008', points: [{ time: '0930', price: 10 }] };
    expect(buildSpark(d, 10)).toBeNull();
  });
});