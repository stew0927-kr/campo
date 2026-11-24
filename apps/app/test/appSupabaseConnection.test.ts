import { describe, expect, it, vi } from 'vitest';
import { createPublicReader, loadWithDemoFallback } from '../src/features/content/remote.ts';
import { createPhotoReader } from '../src/features/content/photos.ts';
import { connectionFromValues } from '../src/features/content/connection.ts';
import { DEMO_CONTENT } from '../src/features/content/mock.ts';
import { essayDestination, eventDestination, stallDestination } from '../src/features/content/destinations.ts';
const config = { url: 'https://example.test', publicKey: 'sb_publishable_test_only' };
describe('Supabase public read connection (mocked transport)', () => {
  it('sends only GET and apikey for publishable keys, never a fake bearer JWT', async () => {
    const fetcher = vi.fn(async (_input, init) => {
      expect(init?.method).toBe('GET'); expect(init?.headers).toEqual({ apikey: config.publicKey });
      expect(init?.body).toBeUndefined(); return new Response('[]');
    }) as typeof fetch;
    const connection = connectionFromValues(config.url, config.publicKey, fetcher);
    const snapshot = await loadWithDemoFallback(connection.source);
    expect(snapshot.mode).toBe('live');
    expect(snapshot.data).toEqual({ essays: [], festivals: [], days: [], stalls: [], performances: [], events: [] });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it('keeps content and photo reads independent and validates the campus and safe image URLs', async () => {
    const row = { id: 'photo', campus_id: 'hanyang-seoul', node_id: 'n_A_4_408door', heading_deg: 90, thumb_url: 'https://example.test/thumb.webp', full_url: 'https://example.test/full.webp' };
    const fetcher = vi.fn(async (input, init) => {
      const url = new URL(String(input)); expect(init?.method).toBe('GET');
      expect(url.pathname).toBe('/rest/v1/campus_photos'); expect(url.searchParams.get('campus_id')).toBe('eq.hanyang-seoul');
      expect(url.searchParams.has('is_published')).toBe(false);
      return new Response(JSON.stringify([row, { ...row, id: 'other', campus_id: 'other-campus' }, { ...row, id: 'unsafe', full_url: 'javascript:alert(1)' }]));
    }) as typeof fetch;
    const catalog = await createPhotoReader(config, fetcher)();
    expect(catalog.size).toBe(1); expect(catalog.byNodeId('n_A_4_408door')[0]?.fullUrl).toBe(row.full_url);
    expect((await createPhotoReader(config, vi.fn(async () => new Response('[]')) as typeof fetch)()).size).toBe(0);
  });
  it('pages large result sets rather than silently stopping at the server default limit', async () => {
    const seen: string[] = [];
    const fetcher = vi.fn(async (input) => {
      const url = new URL(String(input)); seen.push(url.searchParams.get('offset')!);
      return new Response(JSON.stringify(Array.from({ length: seen.length === 1 ? 500 : 1 }, (_, index) => ({ id: `photo-${seen.length}-${index}` }))));
    }) as typeof fetch;
    expect(await createPublicReader(config, fetcher)('campus_photos')).toHaveLength(501);
    expect(seen).toEqual(['0', '500']);
  });
  it('does not call the server with absent or admin credentials and keeps fallback explicitly demo', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const missing = connectionFromValues(undefined, undefined, fetcher);
    expect(missing.source).toBeNull(); expect(missing.notice).toContain('예시 정보');
    const invalid = connectionFromValues(config.url, 'sb_secret_test_only', fetcher);
    expect(invalid.source).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
    const failed = connectionFromValues(config.url, config.publicKey, vi.fn(async () => { throw Error('offline'); }) as typeof fetch);
    const fallback = await loadWithDemoFallback(failed.source);
    expect(fallback.mode).toBe('demo'); expect(fallback.notice).toContain('예시 정보');
  });
  it('preserves server destination ids without falsely marking live rows as local demo', () => {
    for (const target of [essayDestination({ ...DEMO_CONTENT.essays[0]!, destinationNodeId: 'real-node' }, false), stallDestination({ ...DEMO_CONTENT.stalls[0]!, nodeId: 'real-node' }, false), eventDestination({ ...DEMO_CONTENT.events[0]!, nodeId: 'real-node' }, false)]) {
      expect(target.nodeId).toBe('real-node'); expect(target.demo).toBe(false);
    }
  });
});
