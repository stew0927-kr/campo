// Read-only screen DTOs follow supabase/migrations/0001_content.sql and the A guide.
// No schema or server changes are made here. Nullable map ids stay null until C supplies real ids.
export interface EssaySession {
  id: string; seasonLabel: string; trackLabel: string; examDate: string; startsAt: string; endsAt: string;
  checkInBy: string | null; buildingCode: string | null; roomLabel: string | null;
  destinationNodeId: string | null; checkInNodeId: string | null; items: string[]; notices: string[];
  isPublished: boolean; sortOrder: number;
}
export interface Festival { id: string; name: string; startsOn: string; endsOn: string; summary: string | null; isPublished: boolean }
export interface FestivalDay { id: string; festivalId: string; dayDate: string; opensAt: string | null; closesAt: string | null; sortOrder: number }
export const STALL_CATEGORIES = ['주점', '부스', '공연', '편의'] as const;
export type StallCategory = '주점' | '부스' | '공연' | '편의';
export interface FestivalStall {
  id: string; dayId: string; name: string; category: StallCategory; buildingCode: string | null; nodeId: string | null;
  entranceNodeId: string | null; exitNodeId: string | null; opensAt: string | null; closesAt: string | null;
  queueNote: string | null; description: string | null; isPublished: boolean; sortOrder: number;
}
export interface FestivalPerformance {
  id: string; dayId: string; startsAt: string; endsAt: string | null; artist: string; stageLabel: string | null;
  nodeId: string | null; description: string | null; isPublished: boolean; sortOrder: number;
}
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
