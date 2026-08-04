import { describe, expect, it } from 'bun:test';
import { parseTencentResponse } from '../src/dataSource';

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