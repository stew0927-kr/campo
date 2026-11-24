import { describe, expect, it, vi } from 'vitest';
import { createReadOnlySource, loadWithDemoFallback } from '../src/features/content/remote.ts';
import { DEMO_CONTENT } from '../src/features/content/mock.ts';
const config = { url: 'https://example.supabase.co', publicKey: 'sb_publishable_test_only' };
const tables = { essay_sessions: DEMO_CONTENT.essays, festivals: DEMO_CONTENT.festivals, festival_days: DEMO_CONTENT.days, festival_stalls: DEMO_CONTENT.stalls, festival_performances: DEMO_CONTENT.performances, school_events: DEMO_CONTENT.events };
function rows(value: object[]) { return value.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value]))); }
describe('optional public read-only source with mocked HTTP, not an actual server test', () => {
  it('reads the six declared tables with GET and explicit publication filters', async () => {
    const calls: { url: URL; method: string | undefined }[] = [];
    const fetcher = vi.fn(async (input, init) => {
      const url = new URL(String(input)); calls.push({ url, method: init?.method });
      const table = url.pathname.split('/').at(-1)! as keyof typeof tables;
      return new Response(JSON.stringify(rows(tables[table])));
    }) as typeof fetch;
    expect(await createReadOnlySource(config, fetcher).load()).toEqual(DEMO_CONTENT);
    expect(calls).toHaveLength(6); expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(calls.every((call) => call.url.pathname.endsWith('/festival_days') || call.url.searchParams.get('is_published') === 'eq.true')).toBe(true);
  });
  it('rejects malformed responses and HTTP errors instead of treating them as live content', async () => {
    await expect(createReadOnlySource(config, vi.fn(async () => new Response('{}')) as typeof fetch).load()).rejects.toThrow('목록');
    await expect(createReadOnlySource(config, vi.fn(async () => new Response('', { status: 403 })) as typeof fetch).load()).rejects.toThrow('불러오지 못했습니다');
  });
  it('aborts a slow request and falls back to explicitly marked demo content', async () => {
    const stalled = vi.fn(async (_input, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
    const result = await loadWithDemoFallback(createReadOnlySource({ ...config, timeoutMs: 5 }, stalled));
    expect(result.mode).toBe('demo'); expect(result.notice).toContain('예시 정보'); expect(result.data).toEqual(DEMO_CONTENT);
    expect((await loadWithDemoFallback(null)).mode).toBe('demo');
  });
  it('rejects service keys and non-HTTPS URLs without making requests', () => {
    expect(() => createReadOnlySource({ ...config, publicKey: 'sb_secret_test_only' })).toThrow('관리자 키');
    expect(() => createReadOnlySource({ ...config, url: 'http://example.test' })).toThrow('HTTPS');
  });
});
