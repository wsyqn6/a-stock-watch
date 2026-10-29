/**
 * 图表几何：把数据序列映射成 SVG 坐标（纯函数，零依赖）。
 *
 * 这些函数会被 detailHtml 用 `Function#toString` 内联进 webview 脚本，
 * 因此必须自包含——不得引用模块作用域的常量、导入或未内联的函数，
 * 否则浏览器侧会因标识符缺失而报错（bun test 覆盖不到这一点）。
 * 内联清单见 detailHtml 的 INLINE_VIEW。
 */

export interface ChartScale {
  yMin: number;
  yMax: number;
  y: (p: number) => number;
  yTicks: { y: number; label: string }[];
}

/** 纵轴比例尺。reversed=true 时刻度顶为大值（K 线），false 时底为大值（分时）。 */
export function buildChartScale(
  lo: number,
  hi: number,
  reversed: boolean,
  digits: number,
  mainH: number,
): ChartScale {
  let min = lo;
  let max = hi;
  if (max - min < 1e-9) {
    max += 1;
    min -= 1;
  }
  const pad = (max - min) * 0.05;
  const yMin = min - pad;
  const yMax = max + pad;
  const y = (p: number) => mainH - ((p - yMin) / (yMax - yMin)) * mainH;
  const divs = 4;
  const yTicks = Array.from({ length: divs + 1 }, (_, i) => {
    const ratio = reversed ? (divs - i) / divs : i / divs;
    return {
      y: (mainH * i) / divs,
      label: (yMin + (yMax - yMin) * ratio).toFixed(digits),
    };
  });
  return { yMin, yMax, y, yTicks };
}

/** 分时序列点。sm 为交易时段分钟序号（0..240），由 host 预计算，webview 不重算交易时段规则。 */
export interface MinuteSeriesPoint {
  time: string;
  price: number;
  avg: number | null;
  volume: number;
  /** 交易时段分钟序号（09:30 起算，午休折叠） */
  sm: number;
}

export interface MinuteChartGeometry {
  width: number;
  height: number;
  mainH: number;
  volH: number;
  padL: number;
  plotW: number;
  volBottom: number;
  priceLine: string;
  avgLine: string | null;
  baseY: number;
  bars: { x: number; w: number; y: number; h: number; cls: 'up' | 'down' }[];
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
  pts: { x: number; y: number; ay: number | null; price: number; avg: number | null; volume: number; time: string }[];
  lastPrice: number;
  lastAvg: number | null;
  /** 涨停/跌停线 y 坐标（价格在当日范围内时提供，否则 undefined） */
  limitUpY?: number;
  limitDownY?: number;
}

export function layoutMinuteView(
  series: MinuteSeriesPoint[],
  prevClose: number,
  limits: { limitUp?: number; limitDown?: number } | undefined,
  digits: number,
  width: number,
  height: number,
): MinuteChartGeometry | null {
  if (series.length < 2 || width <= 0 || height <= 0) {
    return null;
  }
  const padL = 6;
  const axisR = 46;
  const gap = 6;
  const labelH = 14;
  const sessionTotal = 240;
  const plotW = Math.max(40, width - padL - axisR);
  const plotH = Math.max(80, height - labelH);
  const mainH = Math.round((plotH - gap) * 0.78125);
  const volH = plotH - gap - mainH;
  const volBottom = mainH + gap + volH;
  const x = (sm: number) => padL + (sm / sessionTotal) * plotW;

  let priceMin = Infinity;
  let priceMax = -Infinity;
  for (const p of series) {
    if (p.price < priceMin) priceMin = p.price;
    if (p.price > priceMax) priceMax = p.price;
  }
  const slack = Math.max(priceMax - priceMin, priceMin * 0.5, 1e-6);
  // 均价需全量有效（含单位合理）才绘制，缺成交额的点使 avg 线整体隐藏
  let avgUsable = true;
  for (const p of series) {
    if (p.avg === null || p.avg < priceMin - slack || p.avg > priceMax + slack) {
      avgUsable = false;
      break;
    }
  }
  let lo = prevClose;
  let hi = prevClose;
  for (const p of series) {
    if (p.price < lo) lo = p.price;
    if (p.price > hi) hi = p.price;
    if (avgUsable && p.avg !== null) {
      if (p.avg < lo) lo = p.avg;
      if (p.avg > hi) hi = p.avg;
    }
  }
  // 涨跌停价仅在贴近当日价格区间时纳入坐标范围，避免异常值或指数（无涨跌停）拉爆图表。
  // 阈值取 25% 价格幅，覆盖主板 10% / 创业板科创板 20% 涨跌停。
  const span = Math.max(hi - lo, prevClose * 0.25, 1e-6);
  const limitUp = limits ? limits.limitUp : undefined;
  const limitDown = limits ? limits.limitDown : undefined;
  const limitUpIn = limitUp !== undefined && limitUp >= lo - span && limitUp <= hi + span;
  const limitDownIn = limitDown !== undefined && limitDown >= lo - span && limitDown <= hi + span;
  if (limitUpIn) hi = Math.max(hi, limitUp as number);
  if (limitDownIn) lo = Math.min(lo, limitDown as number);

  const scale = buildChartScale(lo, hi, false, digits, mainH);
  const y = scale.y;

  const pricePts: string[] = [];
  const avgPts: string[] = [];
  const pts: MinuteChartGeometry['pts'] = [];
  const bars: MinuteChartGeometry['bars'] = [];
  let vmax = 1;
  for (const p of series) {
    if (p.volume > vmax) vmax = p.volume;
  }
  // 柱宽按时间槽（每分钟）取，不随 series 长度缩放：缺量分钟被跳过时若按点数摊宽度，
  // 柱宽会大于时间槽间距，相邻柱互相重叠。柱在时间槽内居中，与价格折线顶点对齐。
  const bw = Math.max(0.5, plotW / sessionTotal);
  for (const p of series) {
    const px = x(p.sm);
    const py = y(p.price);
    pricePts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    const ay = avgUsable && p.avg !== null ? y(p.avg) : null;
    if (ay !== null) {
      avgPts.push(`${px.toFixed(1)},${ay.toFixed(1)}`);
    }
    const h = p.volume > 0 ? (p.volume / vmax) * (volH - 2) : 0;
    const cx = padL + ((p.sm + 0.5) / sessionTotal) * plotW;
    bars.push({
      x: cx - bw / 2,
      w: bw,
      y: mainH + gap + (volH - h),
      h,
      cls: p.price >= prevClose ? 'up' : 'down',
    });
    pts.push({
      x: px,
      y: py,
      ay,
      price: p.price,
      avg: avgUsable ? p.avg : null,
      volume: p.volume,
      time: p.time,
    });
  }
  const xTicks = [0, 60, 120, 180, 240].map((sm) => ({
    x: x(sm),
    label: sm === 0 ? '09:30' : sm === 60 ? '10:30' : sm === 120 ? '11:30' : sm === 180 ? '14:00' : '15:00',
  }));
  const last = series[series.length - 1];
  return {
    width,
    height,
    mainH,
    volH,
    padL,
    plotW,
    volBottom,
    priceLine: pricePts.join(' '),
    avgLine: avgUsable && avgPts.length > 0 ? avgPts.join(' ') : null,
    baseY: y(prevClose),
    bars,
    xTicks,
    yTicks: scale.yTicks,
    pts,
    lastPrice: last.price,
    lastAvg: avgUsable ? last.avg : null,
    limitUpY: limitUpIn ? y(limitUp as number) : undefined,
    limitDownY: limitDownIn ? y(limitDown as number) : undefined,
  };
}

export interface KlineSeriesPoint {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

/** K 线数据包：全量历史 + 与之对齐的均线值（均线已按全量历史算好，webview 只做窗口切片）。 */
export interface KlineSeries {
  points: KlineSeriesPoint[];
  maValues: { n: number; vals: (number | null)[] }[];
  volMaVals: (number | null)[];
}

export interface KlineGeometry {
  width: number;
  height: number;
  mainH: number;
  volH: number;
  padL: number;
  plotW: number;
  volBottom: number;
  /** start 允许小数（缩放锚定需要亚根精度），count 恒为整数 */
  view: { start: number; count: number };
  /** 单根 K 线占用的横向槽宽（含间隙），拖动平移与缩放锚定按它换算像素 */
  cw: number;
  candles: (KlineSeriesPoint & {
    x: number;
    w: number;
    bodyY: number;
    bodyH: number;
    wickY1: number;
    wickY2: number;
    cls: 'up' | 'down';
  })[];
  volBars: { x: number; w: number; y: number; h: number; cls: 'up' | 'down' }[];
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
  lastPrice: number;
  maLines: { n: number; points: string | null }[];
  maValues: { n: number; vals: (number | null)[] }[];
  volMaLine: string | null;
  volMaVals: (number | null)[];
}

/**
 * K 线几何：view 指定可见窗口（右端对齐最新），y 轴取窗口内的最高/最低，缩放即改窗口。
 * 蜡烛宽度随窗口根数变化，上限 60 防止极少数数据显示时被拉成巨柱。
 */
export function layoutKlineView(
  series: KlineSeries,
  view: { start: number; count: number },
  width: number,
  height: number,
  digits: number,
): KlineGeometry | null {
  const points = series.points;
  const total = points.length;
  if (total === 0 || width <= 0 || height <= 0) {
    return null;
  }
  const count = Math.max(1, Math.min(Math.round(view.count), total));
  // start 保留小数：缩放要钉住光标下的那根 K 线，取整会让每次滚轮都偏半根，
  // 连续滚十几格就会明显跑位。绘制时按整根取下标，位移用小数部分补足。
  const start = Math.max(0, Math.min(view.start, total - count));
  const base = Math.floor(start);
  const frac = start - base;
  // 可见槽位：窗口右端落在两根之间时多画一根垫住，右侧才不会露白
  const lastIdx = Math.min(total - 1, Math.ceil(start + count) - 1);
  const slots = lastIdx - base + 1;
  const padL = 6;
  const axisR = 46;
  const gap = 6;
  const labelH = 14;
  const candleWMax = 60;
  const minTickPx = 60;
  const plotW = Math.max(40, width - padL - axisR);
  const plotH = Math.max(80, height - labelH);
  const mainH = Math.round((plotH - gap) * 0.78125);
  const volH = plotH - gap - mainH;
  const volBottom = mainH + gap + volH;

  const cw = Math.min(plotW / count, candleWMax);
  const bw = cw * 0.65;
  // 右对齐：窗口右端（start+count）永远贴着绘图区右边，数据不足一屏时左侧留白
  const x0 = padL + plotW - (count + frac) * cw;
  const cx = (i: number) => x0 + i * cw + cw / 2;

  let lo = Infinity;
  let hi = -Infinity;
  let vmax = 0;
  for (let i = base; i <= lastIdx; i++) {
    const k = points[i];
    if (k.low < lo) lo = k.low;
    if (k.high > hi) hi = k.high;
    if (k.volume > vmax) vmax = k.volume;
  }
  const scale = buildChartScale(lo, hi, true, digits, mainH);
  const y = scale.y;

  const candles: KlineGeometry['candles'] = [];
  const volBars: KlineGeometry['volBars'] = [];
  for (let i = 0; i < slots; i++) {
    const k = points[base + i];
    const x = x0 + i * cw + (cw - bw) / 2;
    const cls: 'up' | 'down' = k.close >= k.open ? 'up' : 'down';
    const bodyY = y(Math.max(k.open, k.close));
    const bodyH = y(Math.min(k.open, k.close)) - bodyY;
    candles.push({
      x,
      w: bw,
      bodyY,
      bodyH: Math.max(bodyH, 1),
      wickY1: y(k.high),
      wickY2: y(k.low),
      cls,
      date: k.date,
      open: k.open,
      close: k.close,
      high: k.high,
      low: k.low,
      volume: k.volume,
    });
    const vh = k.volume > 0 ? (k.volume / vmax) * (volH - 2) : 0;
    volBars.push({
      x,
      w: bw,
      y: mainH + gap + (volH - vh),
      h: vh,
      cls,
    });
  }

  const volY = (v: number) => mainH + gap + (volH - (v / vmax) * (volH - 2));
  const line = (vals: (number | null)[], py: (v: number) => number): string | null => {
    const out: string[] = [];
    for (let i = 0; i < vals.length; i++) {
      const v = vals[i];
      if (v != null) {
        out.push(`${cx(i).toFixed(1)},${py(v).toFixed(1)}`);
      }
    }
    return out.length > 0 ? out.join(' ') : null;
  };

  const maValues = series.maValues.map((mv) => ({
    n: mv.n,
    vals: mv.vals.slice(base, base + slots) as (number | null)[],
  }));
  const maLines = series.maValues.map((mv) => ({
    n: mv.n,
    points: line(mv.vals.slice(base, base + slots) as (number | null)[], y),
  }));

  // 刻度自右向左铺：保证最新一根总有日期标签，且相邻标签间距不低于阈值。
  const labelStep = Math.max(1, Math.floor(minTickPx / cw));
  const xTicks: { x: number; label: string }[] = [];
  // 只给完整可见的 K 线打标签：最右那根可能只露半个槽，标签会压到价格刻度上
  for (let i = Math.min(slots, count) - 1; i >= 0; i -= labelStep) {
    xTicks.unshift({ x: cx(i), label: points[base + i].date.slice(5) });
  }

  return {
    width,
    height,
    mainH,
    volH,
    padL,
    plotW,
    volBottom,
    view: { start, count },
    cw,
    candles,
    volBars,
    xTicks,
    yTicks: scale.yTicks,
    lastPrice: points[lastIdx].close,
    maLines,
    maValues,
    volMaLine: line(series.volMaVals.slice(base, base + slots) as (number | null)[], volY),
    volMaVals: series.volMaVals.slice(base, base + slots) as (number | null)[],
  };
}

/**
 * 缩放视窗：把可见根数改成 nextCount，并让 anchorPx（相对绘图区左边界的像素）
 * 下的那根 K 线停在原地。plotW 与 layoutKlineView 用同一套映射（cw 上限 60、右对齐）。
 * 结果不取整，交给布局用小数部分补位移，否则每滚一格都会往同一边偏半根。
 */
export function zoomKlineView(
  view: { start: number; count: number },
  total: number,
  nextCount: number,
  anchorPx: number,
  plotW: number,
): { start: number; count: number } {
  const count = Math.max(1, Math.min(Math.round(view.count), total));
  const start = Math.max(0, Math.min(view.start, total - count));
  const next = Math.max(1, Math.min(Math.round(nextCount), total));
  if (next === count) {
    return { start, count };
  }
  const px = Math.max(0, Math.min(anchorPx, plotW));
  const cwOld = Math.min(plotW / count, 60);
  const cwNew = Math.min(plotW / next, 60);
  // 光标处的全局槽位（可为小数），缩放前后保持不变
  const anchor = start + count - (plotW - px) / cwOld;
  const nextStart = anchor - next + (plotW - px) / cwNew;
  return { start: Math.max(0, Math.min(nextStart, total - next)), count: next };
}

/**
 * 拖动平移视窗：deltaBars 为整数根数，正数表示视窗右移（看更晚的数据）。
 * 结果夹在数据范围内，长度保持不变；到边界后继续拖只停在边界，反向拖会立刻跟手
 * （因为调用方记的是拖动起点，而不是逐帧累加）。start 的小数部分原样保留。
 */
export function panKlineView(
  view: { start: number; count: number },
  total: number,
  deltaBars: number,
): { start: number; count: number } {
  const count = Math.max(1, Math.min(Math.round(view.count), total));
  const start = Math.max(0, Math.min(view.start, total - count));
  const moved = Math.max(0, Math.min(start + Math.round(deltaBars), total - count));
  return { start: moved, count };
}
