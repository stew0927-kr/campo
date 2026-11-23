// 안내도 매핑 서버 호출: 주소 결정과 응답 해석. fetch를 주입해 성공·실패·시간 초과를 본다.
import { describe, expect, it } from 'vitest';
import {
  FUNCTION_PATH, MSG_BAD_RESPONSE, MSG_NETWORK, MSG_REFUSED, MSG_TIMEOUT, floorplanEndpoint, requestFloorplan, type FloorplanRequest,
} from '../src/floorplan/client.ts';
import { FLOORPLAN_MAX_PX, shrinkTo } from '../src/floorplan/photo.ts';
import { noopFloorplanStore } from '../src/floorplan/store.ts';

const REQ: FloorplanRequest = {
  imageBase64: 'AAAA', mimeType: 'image/jpeg', buildingId: 'bldg_A', level: 3,
  buildingPolygon: [[127.0004, 37.0003], [127.0009, 37.0003], [127.0009, 37.0007], [127.0004, 37.0007], [127.0004, 37.0003]], rotationDeg: 90,
};
const ENDPOINT = 'https://example.supabase.co/functions/v1/floorplan-to-geojson';
const FC = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'fp-n-1', geometry: { type: 'Point', coordinates: [127, 37] }, properties: { kind: 'node' } }] };

/** A fetch that answers `status` with `body` and remembers what it was sent. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
}

describe('floorplanEndpoint', () => {
  it('uses EXPO_PUBLIC_FLOORPLAN_URL as it is when set', () => {
    expect(floorplanEndpoint({ floorplanUrl: 'https://fp.example.com/run/', supabaseUrl: 'https://x.supabase.co' })).toBe('https://fp.example.com/run');
  });
  it('else joins EXPO_PUBLIC_SUPABASE_URL and the function path', () => {
    expect(floorplanEndpoint({ supabaseUrl: 'https://x.supabase.co/' })).toBe(`https://x.supabase.co${FUNCTION_PATH}`);
    expect(floorplanEndpoint({ floorplanUrl: '  ', supabaseUrl: 'https://x.supabase.co' })).toBe(`https://x.supabase.co${FUNCTION_PATH}`);
  });
  it('is null when neither is set', () => {
    expect(floorplanEndpoint({})).toBeNull();
    expect(floorplanEndpoint({ floorplanUrl: undefined, supabaseUrl: '' })).toBeNull();
  });
});

describe('requestFloorplan', () => {
  it('returns the FeatureCollection and the summary on 200, and sends the anon key as a bearer token', async () => {
    const f = fakeFetch(200, { ok: true, geojson: FC, summary: { nodeCount: 1, edgeCount: 0, warnings: ['흐림'] }, provider: 'gemini' });
    const r = await requestFloorplan(REQ, { endpoint: ENDPOINT, anonKey: 'anon-test', fetchImpl: f.impl });
    expect(r).toEqual({ geojson: FC, summary: { nodeCount: 1, edgeCount: 0, warnings: ['흐림'] } });
    expect(f.calls[0]!.url).toBe(ENDPOINT);
    expect(f.calls[0]!.init.method).toBe('POST');
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer anon-test');
    expect(JSON.parse(String(f.calls[0]!.init.body))).toMatchObject({ buildingId: 'bldg_A', level: 3, rotationDeg: 90 });
  });

  it('sends no authorization header without a key', async () => {
    const f = fakeFetch(200, { ok: true, geojson: FC, summary: { nodeCount: 1, edgeCount: 0 } });
    await requestFloorplan(REQ, { endpoint: ENDPOINT, fetchImpl: f.impl });
    expect(f.calls[0]!.init.headers as Record<string, string>).not.toHaveProperty('authorization');
  });

  it('passes the server sentence on through for a 422', async () => {
    const f = fakeFetch(422, { ok: false, code: 'extract_failed', error: '안내도에서 지점을 하나도 읽지 못했습니다.' });
    expect(await requestFloorplan(REQ, { endpoint: ENDPOINT, fetchImpl: f.impl })).toEqual({ error: '안내도에서 지점을 하나도 읽지 못했습니다.' });
  });

  it('says the anon key was refused on 401 and 403', async () => {
    expect(await requestFloorplan(REQ, { endpoint: ENDPOINT, fetchImpl: fakeFetch(401, { msg: 'Invalid JWT' }).impl })).toEqual({ error: MSG_REFUSED });
    expect(await requestFloorplan(REQ, { endpoint: ENDPOINT, fetchImpl: fakeFetch(403, '').impl })).toEqual({ error: MSG_REFUSED });
  });

  it('gives up after the timeout', async () => {
    const hang = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as unknown as typeof fetch;
    expect(await requestFloorplan(REQ, { endpoint: ENDPOINT, fetchImpl: hang, timeoutMs: 20 })).toEqual({ error: MSG_TIMEOUT });
  });

  it('says the server could not be reached when fetch throws', async () => {
    const down = (async () => {
      throw new TypeError('Network request failed');
    }) as typeof fetch;
    expect(await requestFloorplan(REQ, { endpoint: ENDPOINT, fetchImpl: down })).toEqual({ error: MSG_NETWORK });
  });

  it('refuses ok:true without a FeatureCollection, and an answer that is not JSON', async () => {
    const r = await requestFloorplan(REQ, { endpoint: ENDPOINT, fetchImpl: fakeFetch(200, { ok: true, geojson: { type: 'Feature' } }).impl });
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error).toContain('FeatureCollection');
    expect(await requestFloorplan(REQ, { endpoint: ENDPOINT, fetchImpl: fakeFetch(200, '<html>').impl })).toEqual({ error: MSG_BAD_RESPONSE });
  });

  it('counts the features when the summary is missing', async () => {
    const r = await requestFloorplan(REQ, { endpoint: ENDPOINT, fetchImpl: fakeFetch(200, { ok: true, geojson: FC }).impl });
    expect(r).toMatchObject({ summary: { nodeCount: 1, edgeCount: 0, warnings: [] } });
  });
});

describe('noopFloorplanStore', () => {
  it('accepts a record and does nothing', async () => {
    await expect(noopFloorplanStore().save({ campus: 'c', buildingId: 'bldg_A', level: 3, rotationDeg: 0, geojson: FC, createdAt: '2026-11-23T10:00:00+09:00' })).resolves.toBeUndefined();
  });
});

describe('안내도 사진 크기', () => {
  it('shrinks the long side to 1600 px and leaves small photos alone', () => {
    expect(FLOORPLAN_MAX_PX).toBe(1600);
    expect(shrinkTo(4032, 3024)).toEqual({ width: 1600 });
    expect(shrinkTo(3024, 4032)).toEqual({ height: 1600 });
    expect(shrinkTo(1200, 900)).toBeNull();
    expect(shrinkTo(0, 0)).toBeNull();
  });
});
