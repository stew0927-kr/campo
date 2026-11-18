// The 저장된 높이 차 list of the 측정된 기압 sheet: one row per live Δh edge, newest first. No React, so it is tested in Node.
import { dhEdgeEnds, formatDhM, liveDhEdges, type ElevationStore } from '@campo/core/elevation';

export interface DhRow {
  edgeId: string;
  from: string;
  to: string;
  /** "+2.4m" / "-1.1m". */
  dh: string;
  /** "오늘 14:32" or "11-18 14:32", in the phone's own time. */
  at: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `ms` in the device's local time: "오늘 14:32" when it is the same day as `now`, else "11-18 14:32" (the year when it differs). */
export function measuredAtText(ms: number, now: number = Date.now()): string {
  const d = new Date(ms);
  const n = new Date(now);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return `오늘 ${clock}`;
  const day = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${d.getFullYear() === n.getFullYear() ? '' : `${d.getFullYear()}-`}${day} ${clock}`;
}

export function dhRows(store: ElevationStore, now: number = Date.now()): DhRow[] {
  return liveDhEdges(store).map((e) => ({ edgeId: e.edgeId, ...dhEdgeEnds(store, e), dh: formatDhM(e.dhM), at: measuredAtText(e.createdAt, now) }));
}
