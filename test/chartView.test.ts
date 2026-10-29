import { describe, expect, it } from 'bun:test';
import {
  buildChartScale,
  layoutKlineView,
  layoutMinuteView,
  panKlineView,
  zoomKlineView,
} from '../src/chartView';
import { buildKlineSeries, KlinePoint } from '../src/dataSource';

const makeKlines = (n: number, step = 0.5): KlinePoint[] =>
  Array.from({ length: n }, (_, i) => {
    const c = 10 + i * step;
    return {
      date: `2026${String(Math.floor(i / 28) + 1).padStart(2, '0')}${String((i % 28) + 1).padStart(2, '0')}`,
      open: c,
      close: c,
      high: c + 1,
      low: c - 1,
      volume: 500 + i,
    };
  });

describe('buildChartScale', () => {
  it('spreads values across mainH and pads the range', () => {
    const s = buildChartScale(10, 20, false, 2, 200);
    expect(s.y(10)).toBeGreaterThan(s.y(20));
    expect(s.yTicks).toHaveLength(5);
    expect(s.yTicks[0].y).toBe(0);
    expect(s.yTicks[4].y).toBe(200);
  });

  it('flattens a degenerate range instead of dividing by zero', () => {
    const s = buildChartScale(10, 10, true, 2, 200);
    expect(s.yMax).toBeGreaterThan(s.yMin);
    expect(Number.isFinite(s.y(10))).toBe(true);
  });
});

describe('layoutMinuteView', () => {
  const series = (points: number[][]) =>
    points.map(([sm, price, volume]) => ({
      time: '0930',
      price,
      avg: price,
      volume,
      sm,
    }));

  it('draws one point per sample and maps sm to x', () => {
    const g = layoutMinuteView(series([[0, 10, 5], [60, 10.2, 8], [240, 10.1, 0]]), 10, undefined, 2, 640, 276)!;
    expect(g.pts).toHaveLength(3);
    expect(g.pts[0].x).toBeCloseTo(g.padL, 6);
    expect(g.pts[2].x).toBeCloseTo(g.padL + g.plotW, 6);
    expect(g.volBottom).toBe(g.mainH + 6 + g.volH);
  });

  it('returns null for a single point or a zero-size box', () => {
    expect(layoutMinuteView(series([[0, 10, 5]]), 10, undefined, 2, 640, 276)).toBeNull();
    expect(layoutMinuteView(series([[0, 10, 5], [1, 10, 5]]), 10, undefined, 2, 0, 276)).toBeNull();
  });
});

describe('layoutKlineView', () => {
  const series = buildKlineSeries(makeKlines(20));

  it('builds one candle and volume bar per point', () => {
    const g = layoutKlineView(series, { start: 0, count: 20 }, 640, 276, 2)!;
    expect(g.candles).toHaveLength(20);
    expect(g.volBars).toHaveLength(20);
    expect(g.lastPrice).toBe(series.points[19].close);
    expect(g.yTicks).toHaveLength(5);
  });

  it('marks up candles when close >= open and down otherwise', () => {
    const mixed = buildKlineSeries([
      { date: '20260801', open: 10, close: 10.5, high: 11, low: 9, volume: 100 },
      { date: '20260802', open: 10.5, close: 10, high: 11, low: 9, volume: 100 },
    ]);
    const g = layoutKlineView(mixed, { start: 0, count: 2 }, 640, 276, 2)!;
    expect(g.candles[0].cls).toBe('up');
    expect(g.candles[1].cls).toBe('down');
  });

  it('sizes volume bars by the max volume in the window', () => {
    const g = layoutKlineView(series, { start: 0, count: 20 }, 640, 276, 2)!;
    const maxBar = Math.max(...g.volBars.map((b) => b.h));
    expect(maxBar).toBeCloseTo(g.volH - 2, 1);
  });

  it('formats price labels with the given decimals', () => {
    for (const t of layoutKlineView(series, { start: 0, count: 20 }, 640, 276, 2)!.yTicks) {
      expect(t.label.split('.')[1]).toHaveLength(2);
    }
    for (const t of layoutKlineView(series, { start: 0, count: 20 }, 640, 276, 3)!.yTicks) {
      expect(t.label.split('.')[1]).toHaveLength(3);
    }
  });

  it('right-aligns a short series against the price axis', () => {
    const g = layoutKlineView(series, { start: 0, count: 3 }, 640, 276, 2)!;
    const slot = g.candles[0].w / 0.65;
    const lastCenter = g.candles[2].x + g.candles[2].w / 2;
    expect(lastCenter).toBeCloseTo(g.padL + g.plotW - slot / 2, 6);
  });

  it('adapts plot size to the given box', () => {
    const g = layoutKlineView(series, { start: 0, count: 20 }, 800, 400, 2)!;
    expect(g.width).toBe(800);
    expect(g.height).toBe(400);
    expect(g.plotW).toBe(800 - 6 - 46);
    expect(g.volBottom).toBe(400 - 14);
    expect(g.mainH).toBeGreaterThan(g.volH);
  });

  it('restricts y range to the visible window', () => {
    const wide = buildKlineSeries([
      ...makeKlines(10, 0.1),
      { date: '20260901', open: 100, close: 100, high: 101, low: 99, volume: 900 },
      { date: '20260902', open: 20, close: 20, high: 21, low: 19, volume: 900 },
    ]);
    const all = layoutKlineView(wide, { start: 0, count: 12 }, 640, 276, 2)!;
    const tail = layoutKlineView(wide, { start: 11, count: 1 }, 640, 276, 2)!;
    expect(Number(all.yTicks[0].label)).toBeGreaterThan(50);
    expect(Number(tail.yTicks[0].label)).toBeLessThan(30);
  });

  it('slices MA values to the window while keeping warmup from full history', () => {
    const long = buildKlineSeries(makeKlines(79));
    const g = layoutKlineView(long, { start: 19, count: 60 }, 640, 276, 2)!;
    expect(g.candles).toHaveLength(60);
    expect(g.maValues[2].vals).toHaveLength(60);
    // 窗口首根（全量第 19 根）已有 MA20：窗口外历史参与计算
    expect(g.maValues[2].vals[0]).not.toBeNull();
    expect(g.maLines[2].points!.split(' ')).toHaveLength(60);
    expect(g.volMaVals).toHaveLength(60);
  });

  it('caps candle width when zoomed in', () => {
    const g = layoutKlineView(series, { start: 17, count: 3 }, 640, 276, 2)!;
    expect(g.candles[0].w).toBeCloseTo(60 * 0.65, 6);
    expect(g.view).toEqual({ start: 17, count: 3 });
  });

  it('clamps a view beyond the data bounds', () => {
    const g = layoutKlineView(series, { start: 100, count: 500 }, 640, 276, 2)!;
    expect(g.view.count).toBe(20);
    expect(g.view.start).toBe(0);
  });

  it('exposes the slot width for pixel-to-bar conversion', () => {
    const g = layoutKlineView(series, { start: 0, count: 20 }, 640, 276, 2)!;
    expect(g.cw).toBeCloseTo(g.plotW / 20, 6);
    const zoomed = layoutKlineView(series, { start: 17, count: 3 }, 640, 276, 2)!;
    expect(zoomed.cw).toBeCloseTo(60, 6);
  });

  it('labels the newest candle with a trimmed date', () => {
    const g = layoutKlineView(series, { start: 0, count: 20 }, 640, 276, 2)!;
    expect(g.xTicks[g.xTicks.length - 1].label).toBe(series.points[19].date.slice(5));
  });

  it('returns null for empty input instead of NaN layout', () => {
    expect(layoutKlineView(buildKlineSeries([]), { start: 0, count: 0 }, 640, 276, 2)).toBeNull();
    expect(layoutKlineView(series, { start: 0, count: 20 }, 0, 276, 2)).toBeNull();
  });
});

describe('buildKlineSeries', () => {
  it('computes MA over the full history', () => {
    const closes = Array.from({ length: 25 }, (_, i) => 10 + i);
    const klines: KlinePoint[] = closes.map((c, i) => ({
      date: `202608${String((i % 9) + 1).padStart(2, '0')}`,
      open: c,
      close: c,
      high: c + 1,
      low: c - 1,
      volume: 100,
    }));
    const s = buildKlineSeries(klines);
    expect(s.points).toHaveLength(25);
    expect(s.maValues.map((m) => m.n)).toEqual([5, 10, 20]);
    for (const mv of s.maValues) expect(mv.vals).toHaveLength(25);
    expect(s.maValues[0].vals[3]).toBeNull();
    expect(s.maValues[0].vals[4]).toBeCloseTo((10 + 11 + 12 + 13 + 14) / 5, 6);
    expect(s.maValues[1].vals[8]).toBeNull();
    expect(s.maValues[1].vals[9]).toBeCloseTo(14.5, 6);
    expect(s.maValues[2].vals[18]).toBeNull();
    expect(s.maValues[2].vals[19]).toBeCloseTo(19.5, 6);
    expect(s.volMaVals[3]).toBeNull();
    expect(s.volMaVals[4]).toBeCloseTo(100, 6);
  });

  it('keeps only the fields the view needs', () => {
    const s = buildKlineSeries(makeKlines(2));
    expect(Object.keys(s.points[0]).sort()).toEqual([
      'close',
      'date',
      'high',
      'low',
      'open',
      'volume',
    ]);
  });
});

describe('panKlineView', () => {
  it('moves the window by whole bars and keeps its length', () => {
    const v = panKlineView({ start: 10, count: 20 }, 79, 5);
    expect(v).toEqual({ start: 15, count: 20 });
    expect(panKlineView({ start: 10, count: 20 }, 79, -4)).toEqual({ start: 6, count: 20 });
  });

  it('stops at both ends instead of running past the data', () => {
    expect(panKlineView({ start: 5, count: 20 }, 79, -50)).toEqual({ start: 0, count: 20 });
    expect(panKlineView({ start: 50, count: 20 }, 79, 999)).toEqual({ start: 59, count: 20 });
  });

  it('rounds fractional bars and clamps an oversized window', () => {
    expect(panKlineView({ start: 10, count: 20 }, 79, 1.6)).toEqual({ start: 12, count: 20 });
    expect(panKlineView({ start: 0, count: 500 }, 30, 5)).toEqual({ start: 0, count: 30 });
  });

  it('keeps the sub-bar offset so panning after a zoom does not snap back', () => {
    const v = panKlineView({ start: 10.4, count: 20 }, 79, 3);
    expect(v.start).toBeCloseTo(13.4, 6);
  });
});

describe('layoutKlineView with a fractional start', () => {
  const series = buildKlineSeries(makeKlines(139));
  const plotW = 640 - 6 - 46;

  it('draws one extra bar so the right edge never shows a gap', () => {
    const g = layoutKlineView(series, { start: 10.5, count: 20 }, 640, 276, 2)!;
    expect(g.view.start).toBeCloseTo(10.5, 6);
    expect(g.candles).toHaveLength(21);
    // 最右那根只露出一半，探出绘图区的部分由 webview 裁掉
    const slotLeft = g.candles[20].x + g.candles[20].w / 2 - g.cw / 2;
    expect(slotLeft).toBeCloseTo(g.padL + g.plotW - g.cw / 2, 6);
  });

  it('keeps the bar under the cursor fixed across repeated zoom steps', () => {
    const anchorPx = 120;
    const slotLeftOf = (g: NonNullable<ReturnType<typeof layoutKlineView>>, i: number) =>
      g.candles[i].x - (g.cw - g.candles[0].w) / 2;
    let view = { start: 139 - 100, count: 100 };
    for (let step = 0; step < 6; step++) {
      const g = layoutKlineView(series, view, 640, 276, 2)!;
      // 锚点落在该窗口的第几根上，以及在槽内的相对位置
      const hit = g.candles.findIndex((c) => c.x + c.w / 2 - g.cw / 2 > g.padL + anchorPx);
      expect(hit).toBeGreaterThan(0);
      const before = Math.floor(view.start) + hit;
      const at = (g2: NonNullable<ReturnType<typeof layoutKlineView>>, i: number) =>
        (g2.padL + anchorPx - slotLeftOf(g2, i)) / g2.cw;
      const posBefore = at(g, hit);
      view = zoomKlineView(view, 139, Math.round(view.count * 0.8), anchorPx, plotW);
      const g2 = layoutKlineView(series, view, 640, 276, 2)!;
      expect(at(g2, before - Math.floor(view.start))).toBeCloseTo(posBefore, 6);
    }
  });

  it('matches the plot width when the start is a whole bar', () => {
    const g = layoutKlineView(series, { start: 19, count: 60 }, 640, 276, 2)!;
    expect(g.candles).toHaveLength(60);
    const lastSlotLeft = g.candles[59].x + g.candles[59].w / 2 - g.cw / 2;
    expect(lastSlotLeft + g.cw).toBeCloseTo(g.padL + g.plotW, 6);
  });
});

describe('zoomKlineView', () => {
  const total = 139;
  const plotW = 640 - 6 - 46;

  it('shrinks the window and holds the anchor bar in place', () => {
    const view = { start: total - 100, count: 100 };
    const zoomed = zoomKlineView(view, total, 50, 200, plotW);
    expect(zoomed.count).toBe(50);
    // 锚点像素下仍是原来那根
    const cwOld = Math.min(plotW / 100, 60);
    const anchor = view.start + 100 - (plotW - 200) / cwOld;
    const cwNew = Math.min(plotW / 50, 60);
    expect(zoomed.start).toBeCloseTo(anchor - 50 + (plotW - 200) / cwNew, 6);
  });

  it('clamps at the data edges without changing the count', () => {
    expect(zoomKlineView({ start: 0, count: 20 }, total, 60, 0, plotW).start).toBe(0);
    const wide = zoomKlineView({ start: total - 20, count: 20 }, total, 60, plotW, plotW);
    expect(wide.start).toBe(total - 60);
    expect(wide.count).toBe(60);
  });

  it('returns the same window when the count does not change', () => {
    const view = { start: 12.25, count: 40 };
    expect(zoomKlineView(view, total, 40, 100, plotW)).toEqual(view);
  });

  it('never asks for more bars than exist', () => {
    expect(zoomKlineView({ start: 0, count: 10 }, 10, 100, 50, plotW)).toEqual({ start: 0, count: 10 });
  });
});
