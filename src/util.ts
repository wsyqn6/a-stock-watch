/** 生成 webview CSP nonce。 */
export function getNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
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
