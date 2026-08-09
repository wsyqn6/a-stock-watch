/** 生成 webview CSP nonce。 */
export function getNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
