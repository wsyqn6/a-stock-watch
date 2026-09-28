/** 生成 webview CSP nonce。 */
export function getNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** 价格小数位：基金类（沪 5xx / 深 1xx：ETF、LOF、债券等）最小变动 0.001 元取 3 位，但仅当参考价 ≤ 10 元时第三位才不小于涨跌幅显示精度（0.01%），更大的数回落 2 位；股票、指数恒 2 位。接受 sh510300 或 510300。 */
export function priceDecimals(codeOrSymbol: string, refPrice?: number): number {
  const c = codeOrSymbol.replace(/^(sh|sz|bj)/, '');
  const isFund = c.startsWith('5') || c.startsWith('1');
  if (!isFund) {
    return 2;
  }
  return refPrice === undefined || refPrice <= 10 ? 3 : 2;
}

/** 按标的精度格式化价格类数值（现价、涨跌额、开高低、均价、涨跌停等）。refPrice 为标的现价，决定精度。 */
export function fmtPrice(v: number, codeOrSymbol: string, refPrice?: number): string {
  return v.toFixed(priceDecimals(codeOrSymbol, refPrice));
}

/** 超出上限时按插入顺序淘汰最旧条目（轻量 FIFO，足以约束长时间会话的内存）。 */
export function trimCache<K, V>(cache: Map<K, V>, max: number): void {
  for (const key of cache.keys()) {
    if (cache.size <= max) {
      return;
    }
    cache.delete(key);
  }
}
