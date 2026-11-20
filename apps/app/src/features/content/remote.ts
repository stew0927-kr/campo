import { contentFromRows, type ContentRows } from './rows.ts';
import { publishedContent } from './published.ts';
import { DEMO_SOURCE } from './mock.ts';
import type { ContentSource } from './types.ts';
export interface ReadConfig { url: string; publicKey: string; timeoutMs?: number }
const TABLES = ['essay_sessions', 'festivals', 'festival_days', 'festival_stalls', 'festival_performances', 'school_events'] as const;
type Table = (typeof TABLES)[number];
const TEXT: Record<Table, string[]> = {
  essay_sessions: ['season_label', 'track_label', 'exam_date', 'starts_at', 'ends_at'],
  festivals: ['name', 'starts_on', 'ends_on'], festival_days: ['festival_id', 'day_date'],
  festival_stalls: ['day_id', 'name', 'category'], festival_performances: ['day_id', 'starts_at', 'artist'],
  school_events: ['title', 'category', 'starts_at'],
};
const OPTIONAL_TEXT: Record<Table, string[]> = {
  essay_sessions: ['check_in_by', 'building_code', 'room_label', 'destination_node_id', 'check_in_node_id'],
  festivals: ['summary'], festival_days: ['opens_at', 'closes_at'],
  festival_stalls: ['building_code', 'node_id', 'entrance_node_id', 'exit_node_id', 'opens_at', 'closes_at', 'queue_note', 'description'],
  festival_performances: ['ends_at', 'stage_label', 'node_id', 'description'],
  school_events: ['ends_at', 'place_label', 'building_code', 'node_id', 'host', 'summary', 'link_url'],
};
function acceptsPublicKey(key: string): boolean {
  if (key.startsWith('sb_publishable_')) return true;
  // Legacy anon JWTs are accepted only when their public role can be checked. Never accept service keys.
  try {
    const payload = key.split('.')[1];
    return Boolean(payload && typeof globalThis.atob === 'function' && JSON.parse(globalThis.atob(payload.replace(/-/g, '+').replace(/_/g, '/')))['role'] === 'anon');
  } catch { return false; }
}
function checkedRows(table: Table, value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('공개 콘텐츠 응답이 목록 형식이 아닙니다.');
  for (const row of value) {
    if (row === null || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !row.id || TEXT[table].some((key) => typeof row[key] !== 'string') || OPTIONAL_TEXT[table].some((key) => row[key] !== null && typeof row[key] !== 'string')) throw new Error('공개 콘텐츠의 필수 항목이 올바르지 않습니다.');
    if (!['festivals', 'school_events'].includes(table) && !Number.isFinite(row.sort_order)) throw new Error('콘텐츠 정렬 값을 확인해 주세요.');
    if (table !== 'festival_days' && typeof row.is_published !== 'boolean') throw new Error('콘텐츠 공개 상태를 확인할 수 없습니다.');
    if (table === 'essay_sessions' && (['items', 'notices'].some((key) => !Array.isArray(row[key]) || row[key].some((item: unknown) => typeof item !== 'string')))) throw new Error('준비물·주의사항 형식이 올바르지 않습니다.');
    if (table === 'school_events' && (typeof row.pinned !== 'boolean' || typeof row.all_day !== 'boolean' || !Number.isFinite(Date.parse(row.starts_at)))) throw new Error('행사 일시·표시 정보가 올바르지 않습니다.');
    if (table === 'festival_stalls' && !['주점', '부스', '공연', '편의'].includes(row.category)) throw new Error('부스 분류를 확인해 주세요.');
    if (table === 'school_events' && !['입학', '설명회', '강연', '행사', '공지'].includes(row.category)) throw new Error('행사 분류를 확인해 주세요.');
  }
  return value;
}
export type PublicTable = Table | 'campus_photos';
/** GET-only, bounded-time, paged reader. Publishable keys are sent as apikey, not as fake JWTs. */
export function createPublicReader(config: ReadConfig, fetcher: typeof fetch = fetch) {
  const base = new URL(config.url);
  if (base.protocol !== 'https:' || base.username || base.password || !acceptsPublicKey(config.publicKey)) throw new Error('HTTPS 주소와 공개 읽기 키가 필요합니다. 관리자 키는 앱에서 사용할 수 없습니다.');
  const timeout = config.timeoutMs ?? 5000;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('응답 제한 시간을 확인해 주세요.');
  return async (table: PublicTable, query: Record<string, string> = {}): Promise<unknown[]> => {
    const rows: unknown[] = [];
    for (let offset = 0; ; offset += 500) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const url = new URL(`/rest/v1/${table}`, base);
        const params = { select: '*', order: 'id.asc', ...query, limit: '500', offset: String(offset) };
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        const headers: Record<string, string> = { apikey: config.publicKey };
        if (!config.publicKey.startsWith('sb_publishable_')) headers['Authorization'] = `Bearer ${config.publicKey}`;
        const response = await fetcher(url.toString(), { method: 'GET', headers, signal: controller.signal });
        if (!response.ok) throw new Error('공개 콘텐츠를 불러오지 못했습니다.');
        const page: unknown = await response.json();
        if (!Array.isArray(page)) throw new Error('공개 콘텐츠 응답이 목록 형식이 아닙니다.');
        rows.push(...page);
        if (page.length < 500) return rows;
      } finally { clearTimeout(timer); }
    }
  };
}
export function createReadOnlySource(config: ReadConfig, fetcher: typeof fetch = fetch): ContentSource {
  const read = createPublicReader(config, fetcher);
  return { mode: 'live', async load() {
    const pairs = await Promise.all(TABLES.map(async (table) => {
      const query = table === 'festival_days' ? {} : { is_published: 'eq.true' };
      return [table, checkedRows(table, await read(table, query))] as const;
    }));
    return publishedContent(contentFromRows(Object.fromEntries(pairs) as unknown as ContentRows));
  } };
}
/** Ready for a later UI source switch: failures remain explicitly labelled as demo, never as live success. */
export async function loadWithDemoFallback(remote: ContentSource | null) {
  if (remote) {
    try { return { data: await remote.load(), mode: remote.mode, notice: null }; }
    catch { return { data: await DEMO_SOURCE.load(), mode: 'demo' as const, notice: '서버에 연결하지 못해 시연용 데이터를 표시합니다.' }; }
  }
  return { data: await DEMO_SOURCE.load(), mode: 'demo' as const, notice: '서버 연결 정보가 없어 시연용 데이터를 표시합니다.' };
}
