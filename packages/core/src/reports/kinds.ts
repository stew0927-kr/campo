// Report kinds and how each is handled (SPEC-v0.2 7.3 table).
//   temporary: goes to overrides.json with an expiry; the map data is not touched.
//   permanent: becomes a pre-filled edit action, then a changeset file.
import type { ReportKind } from './types.ts';

export type ReportHandling = 'temporary' | 'permanent';

export interface ReportKindInfo {
  handling: ReportHandling;
  /** Korean label for the 제보 tab. */
  label: string;
  /** temporary: hours until the override expires when the report has no `until`. */
  defaultHours?: number;
}

export const REPORT_KIND_INFO: Readonly<Record<ReportKind, ReportKindInfo>> = {
  elevator_out: { handling: 'temporary', label: '엘리베이터 고장', defaultHours: 72 },
  door_locked: { handling: 'temporary', label: '문 잠김', defaultHours: 24 },
  construction: { handling: 'temporary', label: '공사로 막힘', defaultHours: 24 * 7 },
  stairs_unmarked: { handling: 'permanent', label: '지도에 없는 계단·턱' },
  wrong_room_location: { handling: 'permanent', label: '강의실 문 위치가 틀림' },
  new_restroom: { handling: 'permanent', label: '지도에 없는 화장실' },
  step_free_confirmed: { handling: 'permanent', label: '계단·턱 없음 확인' },
};

export function isTemporaryKind(kind: ReportKind): boolean {
  return REPORT_KIND_INFO[kind].handling === 'temporary';
}

export function isPermanentKind(kind: ReportKind): boolean {
  return REPORT_KIND_INFO[kind].handling === 'permanent';
}

/** `source` written on Features changed by a report: "report-" + report id (step_free_confirmed and the other permanent kinds). */
export function reportSource(reportId: string): string {
  return `report-${reportId}`;
}
