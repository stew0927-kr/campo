// 측정된 기압 on the map: one pin per measured height variable of the phone's elevation store, with how long its pressure
// stays in memory (the 30-minute buffer) or, once forgotten, that only its Δh is kept. No React, so it is tested in Node.
import { buildingById, type EditBuilding, type EditState, type Position } from '@campo/core';
import type { DhEdge, ElevationStore, PressureAnchorObservation } from '@campo/core/elevation';

export interface PressurePin {
  /** The height variable (op:…, fp:building:floor). */
  key: string;
  /** Where the pin stands: the measured spot outdoors, the building's middle for a floor. */
  at: Position;
  /** "바깥 지점 2", "공학관 3F". */
  label: string;
  /** The short text on the pin: "3F" for a floor, "" outdoors. */
  short: string;
  /** Milliseconds until the pressure in memory is forgotten; null when none is held (only the saved Δh remain). */
  leftMs: number | null;
  /** Δh edges kept at the variable (superseded ones left out). */
  edges: number;
  /** Pins of one building's floors share a spot: 0, 1, 2 … stacks them upward on the screen. */
  stack: number;
}

/** The middle of a building outline (its corners averaged): where the pins of its floors stand. */
export function buildingCentre(b: EditBuilding): Position {
  const ring = b.polygon[0] ?? [];
  const n = Math.max(ring.length, 1);
  return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
}

const liveEdges = (edges: readonly DhEdge[], key: string) => edges.filter((e) => e.qc !== 'superseded' && (e.from === key || e.to === key)).length;

/** The pins of every measured variable that can be placed (a floor of a building no longer on the map is left out). */
export function pressurePins(store: ElevationStore, observations: readonly PressureAnchorObservation[], state: EditState, now: number): PressurePin[] {
  const latest = new Map<string, number>();
  for (const o of observations) if (o.expiresAt > now) latest.set(o.nodeKey, Math.max(latest.get(o.nodeKey) ?? 0, o.expiresAt));
  const pins: PressurePin[] = [];
  const stacked = new Map<string, number>();
  let outdoor = 0;
  for (const n of store.nodes) {
    const left = latest.get(n.key);
    const base = { key: n.key, leftMs: left === undefined ? null : left - now, edges: liveEdges(store.edges, n.key) };
    if (n.kind === 'outdoor_point') {
      outdoor++;
      pins.push({ ...base, at: [n.position.lng, n.position.lat], label: n.label ?? `바깥 지점 ${outdoor}`, short: '', stack: 0 });
      continue;
    }
    const b = buildingById(state, n.buildingId);
    if (!b) continue;
    const stack = stacked.get(b.id) ?? 0;
    stacked.set(b.id, stack + 1);
    pins.push({ ...base, at: buildingCentre(b), label: `${b.props.name} ${n.floorId}`, short: n.floorId, stack });
  }
  return pins;
}

/** "24분", "1분 미만", or "저장됨" (no pressure left in memory). */
export function pinText(pin: Pick<PressurePin, 'leftMs' | 'short'>): string {
  const time = pin.leftMs === null ? '저장됨' : pin.leftMs < 60_000 ? '1분 미만' : `${Math.ceil(pin.leftMs / 60_000)}분`;
  return pin.short === '' ? time : `${pin.short} · ${time}`;
}
