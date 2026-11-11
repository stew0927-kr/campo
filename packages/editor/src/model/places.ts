// Departure / arrival candidates for the 길찾기 tab (SPEC §8): poi points and classroom doors.
import { isClassroomDoor, type NodeFeature, type Position, type Route } from '@campo/core';
import type { CampusDoc } from './document.ts';
import { getBuilding, getNode } from './ids.ts';
import { floorLabel } from './scope.ts';

export interface Place {
  id: string;
  /** Unique, human-readable: "정문", "408호 강의실 (A동 4층)". */
  label: string;
}

export function routePlaces(doc: CampusDoc): Place[] {
  const places: Place[] = [];
  for (const f of doc.features.values()) {
    if (f.properties.kind !== 'node') continue;
    const n = f as NodeFeature;
    const p = n.properties;
    if (p.node_type === 'poi') {
      places.push({ id: n.id, label: p.name ?? n.id });
    } else if (isClassroomDoor(n)) {
      const b = p.building_id ? getBuilding(doc, p.building_id) : undefined;
      const where = [b?.properties.name, p.level !== null ? floorLabel(p.level) : null].filter(Boolean).join(' ');
      places.push({ id: n.id, label: `${p.space_name ?? p.ref ?? n.id}${where ? ` (${where})` : ''}` });
    }
  }
  places.sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  // Labels must be unique to search by name; fall back to the id when two collide.
  const seen = new Map<string, number>();
  for (const pl of places) seen.set(pl.label, (seen.get(pl.label) ?? 0) + 1);
  return places.map((pl) => (seen.get(pl.label)! > 1 ? { ...pl, label: `${pl.label} · ${pl.id}` } : pl));
}

/** Map line for a found route: the node positions in travel order. */
export function routeLine(route: Route, doc: Pick<CampusDoc, 'features'>): Position[] {
  return route.nodes.map((id) => getNode(doc, id)?.geometry.coordinates).filter((p): p is Position => !!p);
}
