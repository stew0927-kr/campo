// floorplan-to-geojson의 요청 처리(handler)와 응답 해석(parse)을 Node에서 검사한다. 제공자는 가짜로 바꾼다.
import { describe, expect, it } from 'vitest';
import { CORS_HEADERS, handleRequest, pickProvider } from '../../../supabase/functions/floorplan-to-geojson/src/handler.ts';
import { parseDraft } from '../../../supabase/functions/floorplan-to-geojson/src/parse.ts';
import { ProviderError, type ProviderCall } from '../../../supabase/functions/floorplan-to-geojson/src/types.ts';

const RING = [[127.0004, 37.0003], [127.0009, 37.0003], [127.0009, 37.0007], [127.0004, 37.0007], [127.0004, 37.0003]];
const BODY = { imageBase64: 'AAAA', mimeType: 'image/jpeg', buildingId: 'bldg_A', level: 3, buildingPolygon: RING, rotationDeg: 90 };
const MODEL_TEXT = '```json\n' + JSON.stringify({
  nodes: [{ kind: 'corridor', x: 100, y: 500 }, { kind: 'corridor', x: 600, y: 500 }, { kind: 'door', x: 580, y: 450, room_ref: 301, door_role: 'front' }],
  corridors: [{ from: 0, to: 1 }],
  warnings: [],
}) + '\n```';

const env = (vars: Record<string, string>) => (name: string) => vars[name];
const post = (body: unknown) => new Request('https://x.supabase.co/functions/v1/floorplan-to-geojson', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const fake = (text: string): ProviderCall => async () => text;

describe('parseDraft', () => {
  it('strips code fences, clamps and rounds coordinates, and drops unknown kinds with a warning', () => {
    const r = parseDraft('결과입니다:\n```json\n{"nodes":[{"kind":"corridor","x":-5,"y":1200.6},{"kind":"window","x":1,"y":1},{"kind":"door","x":"12.4","y":3,"room_ref":" 301 "}],"corridors":[{"from":0,"to":2},{"from":0,"to":1},{"from":0,"to":7}]}\n```');
    if ('error' in r) throw new Error(r.error);
    expect(r.nodes).toEqual([{ kind: 'corridor', x: 0, y: 1000 }, { kind: 'door', x: 12, y: 3, room_ref: '301' }]);
    // 인덱스는 남은 점 기준으로 다시 매긴다. 버린 점(1)을 가리키는 것과 범위 밖(7)은 버린다.
    expect(r.corridors).toEqual([{ from: 0, to: 1 }]);
    expect(r.warnings).toEqual(['종류를 알 수 없는 점 1개는 버렸습니다.', '없는 점을 가리키는 복도 구간 2개는 버렸습니다.']);
  });

  it('fails when there is no JSON at all', () => {
    expect(parseDraft('죄송합니다. 읽을 수 없습니다.')).toHaveProperty('error');
    expect(parseDraft('{"nodes": 3}')).toHaveProperty('error');
  });
});

describe('handleRequest', () => {
  it('answers the CORS preflight with 204', async () => {
    const res = await handleRequest(new Request('https://x', { method: 'OPTIONS' }), { env: env({}) });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe(CORS_HEADERS['Access-Control-Allow-Headers']);
  });

  it('turns a model answer into a FeatureCollection with a summary', async () => {
    const res = await handleRequest(post(BODY), { env: env({ GEMINI_API_KEY: 'test' }), providers: { gemini: fake(MODEL_TEXT) } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, buildingId: 'bldg_A', level: 3, rotationDeg: 90, provider: 'gemini', summary: { nodeCount: 3, edgeCount: 2, doors: 1 } });
    expect(body.geojson.type).toBe('FeatureCollection');
  });

  it('prefers Gemini, then Anthropic, and says no_api_key with neither', async () => {
    expect(pickProvider(env({ GEMINI_API_KEY: 'a', ANTHROPIC_API_KEY: 'b' }))).toBe('gemini');
    expect(pickProvider(env({ ANTHROPIC_API_KEY: 'b' }))).toBe('anthropic');
    const res = await handleRequest(post(BODY), { env: env({}) });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, code: 'no_api_key' });
  });

  it('refuses a malformed request with 400', async () => {
    const vars = env({ GEMINI_API_KEY: 'test' });
    for (const bad of [{ ...BODY, level: 0 }, { ...BODY, rotationDeg: 45 }, { ...BODY, buildingPolygon: [[127, 37]] }, { ...BODY, imageBase64: '' }]) {
      const res = await handleRequest(post(bad), { env: vars, providers: { gemini: fake(MODEL_TEXT) } });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ ok: false, code: 'bad_request' });
    }
    expect((await handleRequest(post('{not json'), { env: vars })).status).toBe(400);
  });

  it('maps an unreadable answer to 422 and a provider failure to 500', async () => {
    const vars = env({ ANTHROPIC_API_KEY: 'test' });
    const unreadable = await handleRequest(post(BODY), { env: vars, providers: { anthropic: fake('no json here') } });
    expect(unreadable.status).toBe(422);
    expect(await unreadable.json()).toMatchObject({ ok: false, code: 'extract_failed' });
    const empty = await handleRequest(post(BODY), { env: vars, providers: { anthropic: fake('{"nodes":[],"corridors":[],"warnings":[]}') } });
    expect(empty.status).toBe(422);
    const down: ProviderCall = async () => {
      throw new ProviderError('HTTP 503', 503);
    };
    const failed = await handleRequest(post(BODY), { env: vars, providers: { anthropic: down } });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ ok: false, code: 'provider_error' });
  });

  it('sends the Gemini request in the documented shape', async () => {
    let sent: { url: string; body: unknown } | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      sent = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: MODEL_TEXT }] } }] }), { status: 200 });
    }) as typeof fetch;
    const res = await handleRequest(post(BODY), { env: env({ GEMINI_API_KEY: 'k-test' }), fetchImpl });
    expect(res.status).toBe(200);
    expect(sent!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=k-test');
    expect(sent!.body).toMatchObject({
      contents: [{ parts: [{ text: expect.any(String) }, { inline_data: { mime_type: 'image/jpeg', data: 'AAAA' } }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    });
  });
});
