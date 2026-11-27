// Read-only screen DTOs follow supabase/migrations/0001_content.sql and the A guide.
// No schema or server changes are made here. Nullable map ids stay null until C supplies real ids.
export interface EssaySession {
  id: string; seasonLabel: string; trackLabel: string; examDate: string; startsAt: string; endsAt: string;
  checkInBy: string | null; buildingCode: string | null; roomLabel: string | null;
  destinationNodeId: string | null; checkInNodeId: string | null; items: string[]; notices: string[];
  isPublished: boolean; sortOrder: number;
}
export interface Festival {
  id: string; name: string; startsOn: string; endsOn: string; summary: string | null; isPublished: boolean;
  /**
   * Optional festival-wide guide (zones·gates·flows·notices·wristband·goods·safety). Read from an optional `guide` jsonb
   * column when the server has one; absent everywhere else. Screens read it only through `festival/guide.ts`, which
   * drops malformed parts instead of failing, so old rows and servers without the column keep working.
   */
  guide?: FestivalGuide | null;
}
export interface FestivalDay {
  id: string; festivalId: string; dayDate: string; opensAt: string | null; closesAt: string | null; sortOrder: number;
  /** Optional short label such as 'DAY 1'. Screens fall back to the day's order. */
  label?: string | null;
}
export const STALL_CATEGORIES = ['주점', '부스', '공연', '편의'] as const;
export type StallCategory = '주점' | '부스' | '공연' | '편의';
export interface FestivalStall {
  id: string; dayId: string; name: string; category: StallCategory; buildingCode: string | null; nodeId: string | null;
  entranceNodeId: string | null; exitNodeId: string | null; opensAt: string | null; closesAt: string | null;
  queueNote: string | null; description: string | null; isPublished: boolean; sortOrder: number;
  /** Optional finer kind inside the four categories (학내단체·주점·푸드트럭·포토부스·스폰서·굿즈·팔찌 …). */
  kind?: string | null;
  /** Optional area name used by the area filter (한마당·국제관 옆 …). */
  areaLabel?: string | null;
  /** Optional number printed on the official layout map, so list rows match the map. */
  mapNumber?: number | null;
  /** Optional participation condition (sampling, events) and what visitors receive. */
  condition?: string | null;
  perks?: string[] | null;
}
export interface FestivalPerformance {
  id: string; dayId: string; startsAt: string; endsAt: string | null; artist: string; stageLabel: string | null;
  nodeId: string | null; description: string | null; isPublished: boolean; sortOrder: number;
  /** Optional line-up group: 동아리·기획단·응원제·아티스트 … */
  group?: string | null;
}
/** Festival-wide guide. Every part is optional; screens hide a section that has no data. */
export interface FestivalGuide {
  notices?: FestivalNotice[];
  zones?: FestivalZone[];
  gates?: FestivalGate[];
  flows?: FestivalFlowGuide[];
  timetableNote?: string | null;
  wristband?: WristbandGuide | null;
  goods?: GoodsItem[];
  goodsNotes?: string[];
  sponsors?: SponsorPromo[];
  /** Booths announced without a day or map position. */
  unplacedBooths?: { name: string; description?: string | null }[];
  prohibitedItems?: string[];
  stageRules?: string[];
  safety?: string[];
  afterCare?: string[];
}
export interface FestivalNotice { id: string; tone?: 'traffic' | 'alert' | 'info'; title: string; body?: string | null; dayIds?: string[] }
export interface FestivalZone { id: string; name: string; gates?: string[]; note?: string | null; dayIds?: string[] }
export interface FestivalGate { id: string; label: string; zone?: string | null; nearBy?: string | null; nodeId?: string | null }
export interface FestivalFlowGuide {
  id: string; kind: 'queue' | 'enter' | 'exit' | 'evacuation'; title: string; description?: string | null;
  /** A swatch for the line color on the official map, e.g. '주황'. */
  colorName?: string | null; placeLabel?: string | null; nodeId?: string | null; fromNodeId?: string | null;
}
export interface WristbandGuide { audience?: string | null; locationLabel?: string | null; hours?: string | null; magicPass?: string | null; steps?: string[]; cautions?: string[] }
export interface GoodsItem { id: string; name: string; subtitle?: string | null; price?: number | null; sizes?: string[]; boothLabel?: string | null; hours?: string | null }
export interface SponsorPromo { id: string; name: string; title: string; condition?: string | null; items?: { name: string; description?: string | null }[]; locationLabel?: string | null }
export type EventCategory = '입학' | '설명회' | '강연' | '행사' | '공지';
export interface SchoolEvent {
  id: string; title: string; category: EventCategory; startsAt: string; endsAt: string | null; allDay: boolean;
  placeLabel: string | null; buildingCode: string | null; nodeId: string | null; host: string | null;
  summary: string | null; linkUrl: string | null; isPublished: boolean; pinned: boolean;
}
export interface ContentData {
  essays: EssaySession[]; festivals: Festival[]; days: FestivalDay[];
  stalls: FestivalStall[]; performances: FestivalPerformance[]; events: SchoolEvent[];
}
export interface ContentSource { readonly mode: 'demo' | 'live'; load(): Promise<ContentData> }
