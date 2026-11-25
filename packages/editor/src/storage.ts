// Where the campus is loaded from and saved to.
//  - local (default, `npm run editor` on a PC): the dev server's /api/campuses (server/campus-api.ts) on this PC's disk.
//  - supabase: the campus_map_files table (supabase/migrations/0006_campus_maps.sql). Only the build the admin web serves
//    at /map/ (admin/scripts/build-map.mjs sets VITE_EDITOR_STORAGE=supabase) — putting Supabase values in .env alone
//    never switches a PC editor to the server. Same origin as the admin web, so the admin login is shared.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { LoadedFile } from '@campo/core';

export const SERVER_MODE = import.meta.env.VITE_EDITOR_STORAGE === 'supabase';

/** What the dev-server-only features say in the server build. */
export const PC_ONLY = '이 기능은 PC 편집기에서만 됩니다.';

/** The paths the server keeps: same rule as server/campus-api.ts CAMPUS_PATH and the check in 0006. */
export const MAP_PATH = /^(campus\.json|outdoor\.geojson|connections\.geojson|buildings\/[A-Za-z0-9]+\/(building|L-?[1-9][0-9]*)\.geojson)$/;

const PAGE = 500;

export interface ServerError {
  code?: string;
  message?: string;
}

/** A save or load error in Korean, never the raw 401/RLS text. */
export function serverMessage(e: ServerError): string {
  const msg = e.message ?? '';
  if (e.code === 'PT409') {
    return '다른 곳에서 먼저 저장했습니다. 관리자 웹의 "편집 화면 다시 불러오기"(또는 새로고침)로 서버 지도를 다시 불러온 뒤 고쳐 주세요. 지금 고친 내용은 다시 불러오면 사라지니, 필요하면 무엇을 고쳤는지 적어 두세요.';
  }
  if (e.code === '22023') return msg; // our own Korean messages from save_campus_map()
  if (e.code === '42501' || /permission denied|row-level security/i.test(msg)) {
    return '관리자 계정만 저장할 수 있습니다. 관리자 웹에서 관리자 계정으로 로그인했는지 확인해 주세요.';
  }
  if (/JWT|token is expired|invalid claim/i.test(msg)) return '로그인이 만료됐습니다. 관리자 웹에서 다시 로그인한 뒤 저장해 주세요.';
  if (/Failed to fetch|NetworkError|fetch failed|Load failed/i.test(msg)) return '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.';
  return msg || '알 수 없는 오류가 났습니다.';
}

/** The parts of a Supabase client the store uses, so tests can pass a fake. */
export type StoreClient = Pick<SupabaseClient, 'from' | 'rpc' | 'auth'>;

let shared: StoreClient | null = null;

function client(): StoreClient {
  if (shared) return shared;
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  if (!url || !key) throw new Error('편집기 서버 설정(VITE_SUPABASE_URL·VITE_SUPABASE_PUBLISHABLE_KEY)이 빌드에 없습니다. admin에서 npm run build로 다시 만들어 주세요.');
  if (key.startsWith('sb_secret_')) throw new Error('비밀 키(sb_secret_...)는 브라우저에 넣으면 안 됩니다. 공개 키(sb_publishable_...)로 다시 빌드해 주세요.');
  shared = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  return shared;
}

/** Tests only: use this client instead of one made from the build's values. */
export function setStoreClientForTests(c: StoreClient | null): void {
  shared = c;
  seen.clear();
}

/** Per campus: path -> updated_at as last loaded or saved. save_campus_map() refuses the save if the server moved on since. */
const seen = new Map<string, Record<string, string>>();

export async function loadFromServer(campusId: string): Promise<LoadedFile[]> {
  const rows: { path: string; text: string; updated_at: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client()
      .from('campus_map_files')
      .select('path,text,updated_at')
      .eq('campus_id', campusId)
      .order('path')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`서버에서 지도를 불러오지 못했습니다. ${serverMessage(error)}`);
    const page = (data ?? []) as typeof rows;
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  if (rows.length === 0) throw new Error('서버에 지도가 없습니다. 관리자 웹 매핑 탭의 "파일 올리기·내려받기"에서 캠퍼스 폴더를 먼저 올려 주세요.');
  seen.set(campusId, Object.fromEntries(rows.map((r) => [r.path, r.updated_at])));
  return rows.map(({ path, text }) => ({ path, text }));
}

export interface ServerSaveResult {
  /** Files whose content changed on the server (unchanged files are not rewritten). */
  written: string[];
  /** *.geojson the server had and this save no longer has. */
  removed: string[];
  /** Files of the save the server does not keep (overrides.json, observations/…): they stay PC-only. */
  skipped: string[];
}

export async function saveToServer(campusId: string, files: Record<string, string>): Promise<ServerSaveResult> {
  const c = client();
  const { data: auth } = await c.auth.getSession();
  if (!auth.session) throw new Error('관리자 웹에서 로그인한 뒤 저장해 주세요.');
  const expected = seen.get(campusId);
  if (!expected) throw new Error('불러온 지도 정보가 없습니다. 새로고침(F5) 후 다시 저장해 주세요.');
  const keep = Object.entries(files).filter(([path]) => MAP_PATH.test(path));
  const skipped = Object.keys(files).filter((path) => !MAP_PATH.test(path)).sort();
  const { data, error } = await c.rpc('save_campus_map', {
    p_campus_id: campusId,
    p_files: keep.map(([path, text]) => ({ path, text })),
    p_expected: expected,
    p_prune: true,
  });
  if (error) throw new Error(serverMessage(error));
  const result = data as { written: string[]; removed: string[]; state: Record<string, string> };
  seen.set(campusId, result.state);
  return { written: result.written, removed: result.removed, skipped };
}
