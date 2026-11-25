// 서버 캠퍼스 지도(campus_map_files) 읽기와 앱 번들 폴백. 가짜 fetch만 쓴다(실제 서버 없음).
import { describe, expect, it, vi } from 'vitest';
import { campusDataWithFallback, createCampusMapReader, loadRemoteCampus, NOTICE } from '../src/campus/remote.ts';
import { connectionFromValues } from '../src/features/content/connection.ts';
import { startCampusBundle } from '../src/hooks/useCampusBundle.ts';
import { CORE_FIXTURE_DIR, bundleOf } from './helpers.ts';

const config = { url: 'https://example.supabase.co', publicKey: 'sb_publishable_test_only' };
const rowsFetcher = (rows: unknown[], calls: URL[] = []) =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new URL(String(input)));
    expect(init?.method).toBe('GET');
    return new Response(JSON.stringify(rows));
  }) as unknown as typeof fetch;

describe('createCampusMapReader + loadRemoteCampus', () => {
  it('(a) reads path,text of hanyang-seoul in path order and makes the app bundle', async () => {
    const calls: URL[] = [];
    const fetcher = rowsFetcher([
      { path: 'outdoor.geojson', text: '{"type":"FeatureCollection","features":[]}' },
      { path: 'campus.json', text: '{"id":"hanyang-seoul"}' },
      { path: 'buildings/A1/L-1.geojson', text: '{"type":"FeatureCollection","features":[]}' },
    ], calls);
    const remote = await loadRemoteCampus(createCampusMapReader(config, fetcher));
    expect(remote.source).toBe('server');
    expect(remote.message).toBeNull();
    expect(remote.bundle?.campus).toBe('hanyang-seoul');
    expect(remote.bundle?.files.map((f) => f.path)).toEqual(['buildings/A1/L-1.geojson', 'campus.json', 'outdoor.geojson']);
    const url = calls[0]!;
    expect(url.pathname).toBe('/rest/v1/campus_map_files');
    expect(url.searchParams.get('campus_id')).toBe('eq.hanyang-seoul');
    expect(url.searchParams.get('select')).toBe('path,text');
    expect(url.searchParams.get('order')).toBe('path.asc');
  });
  it('(b) a failed request falls back to the app bundle, with a small notice', async () => {
    const failing = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await loadRemoteCampus(createCampusMapReader(config, failing))).toEqual({ bundle: null, source: 'bundled', message: NOTICE.failed });
    const http500 = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    expect((await loadRemoteCampus(createCampusMapReader(config, http500))).source).toBe('bundled');
  });
  it('(c) an empty answer or one without campus.json falls back', async () => {
    expect((await loadRemoteCampus(createCampusMapReader(config, rowsFetcher([])))).source).toBe('bundled');
    const noCampus = rowsFetcher([{ path: 'outdoor.geojson', text: '{}' }]);
    expect((await loadRemoteCampus(createCampusMapReader(config, noCampus))).source).toBe('bundled');
  });
  it('(d) a secret key is refused before any request; no connection means the app bundle', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const conn = connectionFromValues(config.url, 'sb_secret_test_only', fetcher);
    expect(conn.readCampus).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(connectionFromValues(undefined, undefined, fetcher).readCampus).toBeNull();
    expect(await loadRemoteCampus(null)).toEqual({ bundle: null, source: 'bundled', message: NOTICE.noConnection });
  });
  it('a row with a path outside the map rule, or a stalled server, falls back', async () => {
    const odd = rowsFetcher([{ path: 'campus.json', text: '{}' }, { path: 'overrides.json', text: '{}' }]);
    expect((await loadRemoteCampus(createCampusMapReader(config, odd))).source).toBe('bundled');
    const stalled = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    expect((await loadRemoteCampus(createCampusMapReader({ ...config, timeoutMs: 5 }, stalled))).source).toBe('bundled');
  });
});

describe('campusDataWithFallback', () => {
  it('(e) a server map that cannot be read gives the app bundle and says so first', async () => {
    const bundled = await bundleOf(CORE_FIXTURE_DIR);
    const broken = { campus: 'hanyang-seoul', files: [{ path: 'campus.json', text: '{"id": ' }] };
    const data = campusDataWithFallback({ bundle: broken, source: 'server', message: null }, bundled);
    expect(data.status).toBe('ready');
    expect(data.counts.nodes).toBeGreaterThan(0);
    expect(data.issues[0]).toBe(NOTICE.unreadable);
  });
  it('a good server map is used as it is, without a notice', async () => {
    const bundled = await bundleOf(CORE_FIXTURE_DIR);
    const server = await bundleOf(CORE_FIXTURE_DIR, 'from-server');
    const data = campusDataWithFallback({ bundle: server, source: 'server', message: null }, { campus: 'x', files: [] });
    expect(data.status).toBe('ready');
    expect(data.issues).not.toContain(NOTICE.unreadable);
    // before the answer (null) or after a failure: the app bundle, the failure's notice first
    expect(campusDataWithFallback(null, bundled).issues).not.toContain(NOTICE.failed);
    expect(campusDataWithFallback({ bundle: null, source: 'bundled', message: NOTICE.failed }, bundled).issues[0]).toBe(NOTICE.failed);
  });
});

describe('startCampusBundle', () => {
  it('asks the server once, however many screens start it', async () => {
    const read = vi.fn(async () => [{ path: 'campus.json', text: '{}' }]);
    const first = startCampusBundle(read);
    const second = startCampusBundle(read);
    expect(first).toBe(second);
    expect((await first).source).toBe('server');
    expect(read).toHaveBeenCalledTimes(1);
  });
});
