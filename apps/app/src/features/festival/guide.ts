// Pure helpers for the festival tab. No React import: tested in Node (test/festivalGuide.test.ts).
// The optional guide comes from a jsonb column the server may or may not have, so every part is checked here and a
// malformed part is dropped rather than failing the whole tab.
import type {
  ContentData, Festival, FestivalDay, FestivalFlowGuide, FestivalGate, FestivalGuide, FestivalNotice, FestivalPerformance,
  FestivalStall, FestivalZone, GoodsItem, SponsorPromo, WristbandGuide,
} from '../content/types.ts';

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const texts = (value: unknown): string[] => (Array.isArray(value) ? value.map(text).filter((item): item is string => item !== null) : []);
function list<T>(value: unknown, pick: (row: Loose, index: number) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row, index) => { if (!isObject(row)) return []; const out = pick(row, index); return out ? [out] : []; });
}
const FLOW_KINDS = ['queue', 'enter', 'exit', 'evacuation'] as const;
const TONES = ['traffic', 'alert', 'info'] as const;

export interface NormalizedGuide {
  notices: FestivalNotice[]; zones: FestivalZone[]; gates: FestivalGate[]; flows: FestivalFlowGuide[]; timetableNote: string | null;
  wristband: WristbandGuide | null; goods: GoodsItem[]; goodsNotes: string[]; sponsors: SponsorPromo[];
  unplacedBooths: { name: string; description: string | null }[]; prohibitedItems: string[]; stageRules: string[]; safety: string[]; afterCare: string[];
}
export const EMPTY_GUIDE: NormalizedGuide = {
  notices: [], zones: [], gates: [], flows: [], timetableNote: null, wristband: null, goods: [], goodsNotes: [], sponsors: [],
  unplacedBooths: [], prohibitedItems: [], stageRules: [], safety: [], afterCare: [],
};

/** Checked copy of `festival.guide`. Unknown or malformed values become empty sections. */
export function festivalGuide(festival: Pick<Festival, 'guide'> | null | undefined): NormalizedGuide {
  const raw: unknown = festival?.guide;
  if (!isObject(raw)) return EMPTY_GUIDE;
  const g = raw as Loose & Partial<Record<keyof FestivalGuide, unknown>>;
  const wristband = isObject(g.wristband) ? {
    audience: text(g.wristband['audience']), locationLabel: text(g.wristband['locationLabel']), hours: text(g.wristband['hours']),
    magicPass: text(g.wristband['magicPass']), steps: texts(g.wristband['steps']), cautions: texts(g.wristband['cautions']),
  } : null;
  return {
    notices: list(g.notices, (row, i) => {
      const title = text(row['title']); if (!title) return null;
      const tone = TONES.find((value) => value === row['tone']) ?? 'info';
      return { id: text(row['id']) ?? `notice-${i}`, tone, title, body: text(row['body']), dayIds: texts(row['dayIds']) };
    }),
    zones: list(g.zones, (row, i) => { const name = text(row['name']); return name ? { id: text(row['id']) ?? `zone-${i}`, name, gates: texts(row['gates']), note: text(row['note']), dayIds: texts(row['dayIds']) } : null; }),
    gates: list(g.gates, (row, i) => { const label = text(row['label']); return label ? { id: text(row['id']) ?? `gate-${i}`, label, zone: text(row['zone']), nearBy: text(row['nearBy']), nodeId: text(row['nodeId']) } : null; }),
    flows: list(g.flows, (row, i) => {
      const title = text(row['title']); const kind = FLOW_KINDS.find((value) => value === row['kind']);
      return title && kind ? { id: text(row['id']) ?? `flow-${i}`, kind, title, description: text(row['description']), colorName: text(row['colorName']), placeLabel: text(row['placeLabel']), nodeId: text(row['nodeId']), fromNodeId: text(row['fromNodeId']) } : null;
    }),
    timetableNote: text(g.timetableNote),
    wristband: wristband && Object.values(wristband).some((value) => (Array.isArray(value) ? value.length > 0 : value !== null)) ? wristband : null,
    goods: list(g.goods, (row, i) => {
      const name = text(row['name']); if (!name) return null;
      const price = typeof row['price'] === 'number' && Number.isFinite(row['price']) && row['price'] >= 0 ? row['price'] : null;
      return { id: text(row['id']) ?? `goods-${i}`, name, subtitle: text(row['subtitle']), price, sizes: texts(row['sizes']), boothLabel: text(row['boothLabel']), hours: text(row['hours']) };
    }),
    goodsNotes: texts(g.goodsNotes),
    sponsors: list(g.sponsors, (row, i) => {
      const name = text(row['name']); const title = text(row['title']); if (!name || !title) return null;
      return { id: text(row['id']) ?? `sponsor-${i}`, name, title, condition: text(row['condition']), locationLabel: text(row['locationLabel']),
        items: list(row['items'], (item) => { const itemName = text(item['name']); return itemName ? { name: itemName, description: text(item['description']) } : null; }) };
    }),
    unplacedBooths: list(g.unplacedBooths, (row) => { const name = text(row['name']); return name ? { name, description: text(row['description']) } : null; }),
    prohibitedItems: texts(g.prohibitedItems), stageRules: texts(g.stageRules), safety: texts(g.safety), afterCare: texts(g.afterCare),
  };
}

/** Notices for one day: a notice without day ids applies to every day. */
export function noticesForDay(guide: NormalizedGuide, dayId: string | undefined): FestivalNotice[] {
  return guide.notices.filter((notice) => !notice.dayIds?.length || (dayId !== undefined && notice.dayIds.includes(dayId)));
}
export function zonesForDay(guide: NormalizedGuide, dayId: string | undefined): FestivalZone[] {
  return guide.zones.filter((zone) => !zone.dayIds?.length || (dayId !== undefined && zone.dayIds.includes(dayId)));
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
/** '2026-10-02' → '10/2(금)'. Weekday from the calendar date itself, independent of the device time zone. */
export function shortDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const weekday = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
  return `${Number(match[2])}/${Number(match[3])}(${WEEKDAYS[weekday]})`;
}
export function dayLabel(day: FestivalDay, index: number): string {
  return `${text(day.label) ?? `DAY ${index + 1}`} · ${shortDate(day.dayDate)}`;
}

/** Performances of one day grouped into time slots ('15:10' → rows), in time order. */
export function timetableSlots(performances: readonly FestivalPerformance[]): { startsAt: string; rows: FestivalPerformance[] }[] {
  const sorted = [...performances].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.sortOrder - b.sortOrder);
  const slots: { startsAt: string; rows: FestivalPerformance[] }[] = [];
  for (const row of sorted) {
    const last = slots.at(-1);
    if (last && last.startsAt === row.startsAt) last.rows.push(row); else slots.push({ startsAt: row.startsAt, rows: [row] });
  }
  return slots;
}
/** Consecutive rows of one slot that share a group ('동아리' …) become one block. */
export function groupRows(rows: readonly FestivalPerformance[]): { group: string | null; rows: FestivalPerformance[] }[] {
  const blocks: { group: string | null; rows: FestivalPerformance[] }[] = [];
  for (const row of rows) {
    const group = text(row.group);
    const last = blocks.at(-1);
    if (last && group !== null && last.group === group) last.rows.push(row); else blocks.push({ group, rows: [row] });
  }
  return blocks;
}

/** Areas present on one day, in first-seen order (sortOrder). Only real labels; no '기타' bucket is invented. */
export function stallAreas(data: ContentData, dayId: string | undefined): string[] {
  const rows = data.stalls.filter((row) => row.dayId === dayId).sort((a, b) => a.sortOrder - b.sortOrder);
  return [...new Set(rows.map((row) => text(row.areaLabel)).filter((value): value is string => value !== null))];
}
export function inArea(row: FestivalStall, area: string): boolean { return area === '전체' || text(row.areaLabel) === area; }
export function stallNumber(row: FestivalStall): number | null {
  return typeof row.mapNumber === 'number' && Number.isInteger(row.mapNumber) && row.mapNumber > 0 ? row.mapNumber : null;
}
export function stallPerks(row: FestivalStall): string[] { return texts(row.perks); }

/** '38000' → '38,000원'. */
export function won(price: number | null | undefined): string | null {
  return typeof price === 'number' && Number.isFinite(price) ? `${price.toLocaleString('ko-KR')}원` : null;
}

const FLOW_LABEL: Record<FestivalFlowGuide['kind'], string> = { queue: '대기 동선', enter: '입장 동선', exit: '퇴장 동선', evacuation: '비상 대피' };
export function flowKindLabel(kind: FestivalFlowGuide['kind']): string { return FLOW_LABEL[kind]; }
