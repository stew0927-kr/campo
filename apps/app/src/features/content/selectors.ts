import type { ContentData, EventCategory, StallCategory } from './types.ts';
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ko').trim();
export function matchesQuery(query: string, values: readonly (string | null | undefined)[]): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const text = normalize(values.filter((value): value is string => typeof value === 'string').join(' '));
  return words.every((word) => text.includes(word));
}
export function selectEssays(data: ContentData, date: string, query: string) {
  return data.essays.filter((row) => row.examDate === date && matchesQuery(query, [row.trackLabel, row.buildingCode, row.roomLabel]))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.sortOrder - b.sortOrder);
}
export function selectStalls(data: ContentData, dayId: string | undefined, category: '전체' | StallCategory, query: string) {
  return data.stalls.filter((row) => row.dayId === dayId && (category === '전체' || category === row.category) && matchesQuery(query, [row.name, row.category, row.buildingCode, row.description]))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'));
}
export function selectEvents(data: ContentData, category: '전체' | EventCategory, query: string, period: '전체' | '다가오는 행사' = '전체', now = Date.now()) {
  return data.events.filter((row) => (period === '전체' || Date.parse(row.startsAt) >= now) && (category === '전체' || row.category === category) && matchesQuery(query, [row.title, row.placeLabel, row.host]))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export function eventSections(events: ContentData['events'], now = Date.now()) {
  // Calendar boundaries are Korea dates, independent of the host's timezone.
  const today = new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
  const dayStart = Date.parse(`${today}T00:00:00+09:00`);
  const sections = ['고정 공지', '이번 주', '이번 달', '이후 행사', '지난 행사'].map((title) => ({ title, data: [] as ContentData['events'] }));
  for (const event of events) {
    const start = Date.parse(event.startsAt);
    const koreaDate = new Date(start + 9 * 3600_000).toISOString().slice(0, 10);
    const index = event.pinned ? 0 : start < dayStart ? 4 : start < dayStart + 7 * 86400_000 ? 1 : koreaDate.slice(0, 7) === today.slice(0, 7) ? 2 : 3;
    sections[index]!.data.push(event);
  }
  return sections.filter((section) => section.data.length > 0);
}
