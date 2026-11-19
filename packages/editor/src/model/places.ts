// Departure / arrival candidates for the 길찾기 tab (SPEC §8): poi points and classroom doors.
import { buildingById, type EditState, type Position, type Route } from '@campo/core';
import { floorLabel } from './scope.ts';

export interface Place {
  id: string;
  /** Unique, human-readable: "정문", "408호 강의실 (A동 4층)". */
  label: string;
}

/** A candidate while sorting: the label plus where it stands, building first (pois have no building). */
interface SortablePlace extends Place {
  buildingName: string;
  level: number;
}

/** Pois and doors of a building with no known level sort after every placed floor. */
const NO_LEVEL = Number.MAX_SAFE_INTEGER;

export function routePlaces(state: EditState): Place[] {
  const places: SortablePlace[] = [];
  for (const n of Object.values(state.nodes)) {
    const p = n.props;
    if (p.node_type === 'poi') {
      places.push({ id: n.id, label: p.name ?? n.id, buildingName: '', level: NO_LEVEL });
    } else if (p.node_type === 'door' && (p.space_name !== undefined || p.ref !== undefined || (p.room_ref !== undefined && p.door_role !== 'back'))) {
      const b = p.building_id ? buildingById(state, p.building_id) : undefined;
      const where = [b?.props.name, p.level !== null ? floorLabel(p.level) : null].filter(Boolean).join(' ');
      places.push({
        id: n.id,
        label: `${p.space_name ?? p.ref ?? (p.room_ref !== undefined ? `${p.room_ref}호` : n.id)}${where ? ` (${where})` : ''}`,
        buildingName: b?.props.name ?? '',
        level: p.level ?? NO_LEVEL,
      });
    }
  }
  // Building name first, so rooms of one building stay together; then floor, then room number (9호 before 10호).
  places.sort(
    (a, b) =>
      a.buildingName.localeCompare(b.buildingName, 'ko') ||
      a.level - b.level ||
      a.label.localeCompare(b.label, 'ko', { numeric: true }),
  );
  // Labels must be unique to search by name; fall back to the id when two collide.
  const seen = new Map<string, number>();
  for (const pl of places) seen.set(pl.label, (seen.get(pl.label) ?? 0) + 1);
  return places.map((pl) => ({ id: pl.id, label: seen.get(pl.label)! > 1 ? `${pl.label} · ${pl.id}` : pl.label }));
}

/** Map line for a found route: the node positions in travel order. */
export function routeLine(route: Route, state: Pick<EditState, 'nodes'>): Position[] {
  return route.nodes.map((id) => state.nodes[id]?.coord).filter((p): p is Position => !!p);
}
