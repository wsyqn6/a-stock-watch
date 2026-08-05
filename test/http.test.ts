import { describe, expect, it } from 'bun:test';
import { fetchWithTimeout } from '../src/http';

describe('fetchWithTimeout', () => {
  it('returns the response when fetch resolves in time', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      const body = JSON.stringify({ ok: true });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    try {
      const res = await fetchWithTimeout('https://example.test');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('aborts and rejects when fetch exceeds timeout', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      await new Promise<void>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal));
        init?.signal?.addEventListener('abort', () => resolve());
      });
      throw new Error('unreachable');
    }) as typeof fetch;
    try {
      await expect(fetchWithTimeout('https://example.test', 20)).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
