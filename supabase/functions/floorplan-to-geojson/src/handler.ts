// The whole request → response path, without Deno globals: index.ts hands it Deno.env, tests hand it a record and a
// fake provider. Request (1.1) → check → prompt → provider → parse → assemble → response (1.2).
import { assembleFloorplan } from './assemble.ts';
import { isRing } from './geometry.ts';
import { parseDraft } from './parse.ts';
import { buildPrompt } from './prompt.ts';
import { callAnthropic } from './providers/anthropic.ts';
import { callGemini } from './providers/gemini.ts';
import {
  ROTATIONS, ProviderError,
  type EnvGet, type ErrorCode, type FloorplanFail, type FloorplanOk, type FloorplanRequest, type Provider, type ProviderCall, type RotationDeg,
} from './types.ts';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const STATUS: Record<ErrorCode, number> = { bad_request: 400, extract_failed: 422, no_api_key: 500, provider_error: 500 };

const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface HandlerDeps {
  env: EnvGet;
  /** Replace the providers (tests). */
  providers?: Partial<Record<Provider, ProviderCall>>;
  fetchImpl?: typeof fetch;
}

function json(body: FloorplanOk | FloorplanFail, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' } });
}

export const fail = (code: ErrorCode, error: string): Response => json({ ok: false, code, error }, STATUS[code]);

/** The request body checked, or the sentence that says what is wrong with it. */
export function readRequest(body: unknown): FloorplanRequest | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: '요청 본문이 JSON 객체가 아닙니다.' };
  const b = body as Record<string, unknown>;
  if (typeof b.imageBase64 !== 'string' || b.imageBase64.trim() === '') return { error: 'imageBase64(사진)가 없습니다.' };
  if (typeof b.mimeType !== 'string' || !MIME_TYPES.includes(b.mimeType)) return { error: `mimeType은 ${MIME_TYPES.join(', ')} 중 하나여야 합니다.` };
  if (typeof b.buildingId !== 'string' || b.buildingId.trim() === '') return { error: 'buildingId(건물 코드)가 없습니다.' };
  if (typeof b.level !== 'number' || !Number.isInteger(b.level) || b.level === 0) return { error: 'level은 0이 아닌 정수여야 합니다(1층 = 1, 지하 1층 = -1).' };
  if (!isRing(b.buildingPolygon)) return { error: 'buildingPolygon은 [경도, 위도] 점 4개 이상인 건물 외곽 고리여야 합니다.' };
  const rotation = b.rotationDeg ?? 0;
  if (!ROTATIONS.includes(rotation as RotationDeg)) return { error: 'rotationDeg는 0, 90, 180, 270 중 하나여야 합니다.' };
  const req: FloorplanRequest = {
    // A data URL prefix is tolerated: the providers want the bare base64.
    imageBase64: b.imageBase64.replace(/^data:[^,]*,/, ''),
    mimeType: b.mimeType,
    buildingId: b.buildingId.trim(),
    level: b.level,
    buildingPolygon: b.buildingPolygon,
    rotationDeg: rotation as RotationDeg,
  };
  const w = b.imageWidth;
  const h = b.imageHeight;
  if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h)) {
    req.imageWidth = w;
    req.imageHeight = h;
  }
  return req;
}

/** Gemini when its key is set, else Anthropic, else none. */
export function pickProvider(env: EnvGet): Provider | null {
  if (env('GEMINI_API_KEY')) return 'gemini';
  if (env('ANTHROPIC_API_KEY')) return 'anthropic';
  return null;
}

export async function handleRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return fail('bad_request', 'POST로 요청해 주세요.');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('bad_request', '요청 본문을 JSON으로 읽지 못했습니다.');
  }
  const input = readRequest(body);
  if ('error' in input) return fail('bad_request', input.error);

  const provider = pickProvider(deps.env);
  if (provider === null) return fail('no_api_key', '안내도 분석 키가 설정되지 않았습니다. 서버에 GEMINI_API_KEY 또는 ANTHROPIC_API_KEY를 넣어 주세요.');
  const call: ProviderCall = deps.providers?.[provider] ?? (provider === 'gemini' ? callGemini : callAnthropic);

  let text: string;
  try {
    text = await call({ imageBase64: input.imageBase64, mimeType: input.mimeType, prompt: buildPrompt(input) }, deps.env, deps.fetchImpl);
  } catch (err) {
    const why = err instanceof ProviderError ? err.message : (err as Error).message;
    return fail('provider_error', `안내도 분석 서비스가 응답하지 않았습니다. 잠시 뒤 다시 시도해 주세요. (${why})`);
  }

  const draft = parseDraft(text);
  if ('error' in draft) return fail('extract_failed', draft.error);
  if (draft.nodes.length === 0) {
    const why = draft.warnings[0] !== undefined ? ` (${draft.warnings[0]})` : '';
    return fail('extract_failed', `안내도에서 지점을 하나도 읽지 못했습니다. 사진을 더 가까이, 반듯하게 다시 찍어 주세요.${why}`);
  }

  const aspect = input.imageWidth !== undefined && input.imageHeight !== undefined ? input.imageWidth / input.imageHeight : undefined;
  const { geojson, summary } = assembleFloorplan(draft, {
    buildingId: input.buildingId, level: input.level, rotationDeg: input.rotationDeg, buildingPolygon: input.buildingPolygon,
    ...(aspect !== undefined ? { aspect } : {}),
  });
  return json({ ok: true, geojson, summary, buildingId: input.buildingId, level: input.level, rotationDeg: input.rotationDeg, provider }, 200);
}
