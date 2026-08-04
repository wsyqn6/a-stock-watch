export interface NormalizedCode {
  ok: true;
  code: string;
  market: 'sh' | 'sz';
  symbol: string;
}

export interface NormalizeError {
  ok: false;
  reason: string;
}

export type NormalizeResult = NormalizedCode | NormalizeError;

export function isValidCode(raw: string): boolean {
  return /^\d{6}$/.test(raw.trim());
}

export function normalizeCode(raw: string): NormalizeResult {
  const input = raw.trim();
  if (!/^\d{6}$/.test(input)) {
    return { ok: false, reason: `无效代码: "${raw}"，需为 6 位数字` };
  }
  const market = detectMarket(input);
  if (!market) {
    return { ok: false, reason: `无法识别市场: "${input}"` };
  }
  return { ok: true, code: `${market}${input}`, market, symbol: input };
}

function detectMarket(code: string): 'sh' | 'sz' | null {
  const first = code[0];
  switch (first) {
    case '6':
    case '9':
      return 'sh';
    case '0':
    case '3':
      return 'sz';
    case '1':
      return code[1] === '1' ? 'sh' : code[1] === '2' ? 'sz' : null;
    case '2':
      return 'sz';
    case '4':
    case '8':
      return null;
    case '5':
    case '7':
      return null;
    default:
      return null;
  }
}
