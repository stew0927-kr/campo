// Calling the floorplan-to-geojson Edge Function: where it is, the request, and what came back. No React Native import:
// fetch is injected in tests (success, error, timeout). Every failure is a Korean sentence for the surveyor.

export interface FloorplanEnv {
  floorplanUrl?: string | undefined;
  supabaseUrl?: string | undefined;
}

export const FUNCTION_PATH = '/functions/v1/floorplan-to-geojson';
export const DEFAULT_TIMEOUT_MS = 90_000;

export const MSG_REFUSED = '안내도 매핑 서버가 이 앱의 요청을 거부했습니다. Supabase anon 키 설정을 확인해 주세요.';
export const MSG_TIMEOUT = '안내도 분석이 시간 안에 끝나지 않았습니다. 사진을 조금 작게 다시 시도해 주세요.';
export const MSG_NETWORK = '안내도 매핑 서버에 연결하지 못했습니다.';
export const MSG_BAD_RESPONSE = '안내도 매핑 서버가 알 수 없는 응답을 보냈습니다.';
export const MSG_NOT_CONFIGURED = '안내도 자동 매핑 서버가 설정되지 않았습니다. EXPO_PUBLIC_SUPABASE_URL 또는 EXPO_PUBLIC_FLOORPLAN_URL을 넣어 주세요.';

const clean = (v: string | undefined): string | undefined => {
  const t = v?.trim().replace(/\/+$/, '');
  return t === undefined || t === '' ? undefined : t;
};

/** EXPO_PUBLIC_FLOORPLAN_URL as it is, else EXPO_PUBLIC_SUPABASE_URL + the function path, else null. */
export function floorplanEndpoint(env: FloorplanEnv): string | null {
  const own = clean(env.floorplanUrl);
  if (own !== undefined) return own;
  const supabase = clean(env.supabaseUrl);
  return supabase !== undefined ? `${supabase}${FUNCTION_PATH}` : null;
}

export interface FloorplanRequest {
  imageBase64: string;
  mimeType: string;
  buildingId: string;
  level: number;
  buildingPolygon: number[][];
  rotationDeg: 0 | 90 | 180 | 270;
  /** Pixel size of the photo sent (optional): the server keeps the plan's aspect ratio with it. */
  imageWidth?: number;
  imageHeight?: number;
}

export interface FloorplanResult {
  geojson: unknown;
  summary: { nodeCount: number; edgeCount: number; warnings?: string[] };
}

export interface RequestOptions {
  endpoint: string;
  anonKey?: string | undefined;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function summaryOf(v: unknown, geojson: Record<string, unknown>): FloorplanResult['summary'] {
  const features = Array.isArray(geojson.features) ? geojson.features : [];
  const geomType = (f: unknown) => (isRecord(f) && isRecord(f.geometry) ? f.geometry.type : undefined);
  const s = isRecord(v) ? v : {};
  const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
  const warnings = Array.isArray(s.warnings) ? s.warnings.filter((w): w is string => typeof w === 'string') : [];
  return {
    nodeCount: num(s.nodeCount, features.filter((f) => geomType(f) === 'Point').length),
    edgeCount: num(s.edgeCount, features.filter((f) => geomType(f) === 'LineString').length),
    warnings,
  };
}

export async function requestFloorplan(req: FloorplanRequest, opts: RequestOptions): Promise<FloorplanResult | { error: string }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.anonKey !== undefined && opts.anonKey.trim() !== '') headers.authorization = `Bearer ${opts.anonKey.trim()}`;

  let res: Response;
  let body: unknown;
  try {
    res = await doFetch(opts.endpoint, { method: 'POST', headers, body: JSON.stringify(req), signal: controller.signal });
    const raw = await res.text();
    try {
      body = raw === '' ? null : JSON.parse(raw);
    } catch {
      body = null;
    }
  } catch (err) {
    if (timedOut || (err as Error | undefined)?.name === 'AbortError') return { error: MSG_TIMEOUT };
    return { error: MSG_NETWORK };
  } finally {
    clearTimeout(timer);
  }

  if (isRecord(body) && body.ok === false && typeof body.error === 'string' && body.error.trim() !== '') return { error: body.error };
  if (res.status === 401 || res.status === 403) return { error: MSG_REFUSED };
  if (!res.ok) return { error: `안내도 매핑 서버가 요청을 처리하지 못했습니다(HTTP ${res.status}). 잠시 뒤 다시 시도해 주세요.` };
  if (!isRecord(body) || body.ok !== true) return { error: MSG_BAD_RESPONSE };
  const geojson = body.geojson;
  if (!isRecord(geojson) || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    return { error: '안내도 매핑 서버가 지도 형식(FeatureCollection)이 아닌 결과를 보냈습니다.' };
  }
  return { geojson, summary: summaryOf(body.summary, geojson) };
}
