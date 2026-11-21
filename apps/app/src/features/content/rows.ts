import type { ContentData, EssaySession, Festival, FestivalDay, FestivalPerformance, FestivalStall, SchoolEvent } from './types.ts';
// DTO ↔ SQL names only. Connection, credentials, RLS and writes remain D's responsibility.
type Snake<S extends string> = S extends `${infer First}${infer Rest}` ? `${First extends Lowercase<First> ? First : `_${Lowercase<First>}`}${Snake<Rest>}` : S;
type Row<T> = { [K in keyof T as K extends string ? Snake<K> : never]: T[K] };
export interface ContentRows {
  essay_sessions: Row<EssaySession>[]; festivals: Row<Festival>[]; festival_days: Row<FestivalDay>[];
  festival_stalls: Row<FestivalStall>[]; festival_performances: Row<FestivalPerformance>[]; school_events: Row<SchoolEvent>[];
}
function camel<T>(row: Row<T>): T {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value])) as T;
}
export function contentFromRows(rows: ContentRows): ContentData {
  return { essays: rows.essay_sessions.map((r) => camel<EssaySession>(r)), festivals: rows.festivals.map((r) => camel<Festival>(r)), days: rows.festival_days.map((r) => camel<FestivalDay>(r)), stalls: rows.festival_stalls.map((r) => camel<FestivalStall>(r)), performances: rows.festival_performances.map((r) => camel<FestivalPerformance>(r)), events: rows.school_events.map((r) => camel<SchoolEvent>(r)) };
}
