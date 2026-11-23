// Departure / arrival candidates for the 길찾기 tab (SPEC §8): poi points and classroom doors.
// Named restrooms and entrances are candidates too, so the 건물 → 층 → 장소 browser can reach them.
import { buildingById, type EditState, type NodeType, type Position, type RestroomGender, type Route } from '@campo/core';
import { floorLabel } from './scope.ts';

export interface Place {
  id: string;
  /** Unique, human-readable: "정문", "408호 강의실 (A동 4층)". */
  label: string;
  /** The building it stands in; null outdoors (pois) or when the point has no building. */
  buildingId: string | null;
  /** That building's name ('' when there is none). */
  buildingName: string;
  /** Its floor; null when it has none (outdoors, or not recorded). */
  level: number | null;
  /** poi: an outdoor place; door: a classroom door; other: a restroom or a named entrance. */
  kind: 'poi' | 'door' | 'other';
  /** The point's node_type, for the 강의실 / 화장실 / 출입구 / 기타 headings. */
  nodeType: NodeType;
  /** restroom only, as recorded (absent when not recorded). */
  gender?: RestroomGender;
}

/** Restroom words for a restroom that has no name of its own. */
const RESTROOM_WORD: Record<string, string> = {
  male: '남자 화장실',
  female: '여자 화장실',
  unisex: '남녀공용 화장실',
  family: '가족 화장실',
};
export const restroomWord = (gender: string | null | undefined): string => (gender ? RESTROOM_WORD[gender] : undefined) ?? '화장실';

/** Pois and doors of a building with no known level sort after every placed floor. */
const NO_LEVEL = Number.MAX_SAFE_INTEGER;

export function routePlaces(state: EditState): Place[] {
  const places: Place[] = [];
  for (const n of Object.values(state.nodes)) {
    const p = n.props;
    const indoor = (name: string, kind: Place['kind']) => {
      const b = p.building_id ? buildingById(state, p.building_id) : undefined;
      const where = [b?.props.name, p.level !== null ? floorLabel(p.level) : null].filter(Boolean).join(' ');
      places.push({
        id: n.id,
        label: `${name}${where ? ` (${where})` : ''}`,
        buildingId: p.building_id ?? null,
        buildingName: b?.props.name ?? '',
        level: p.level ?? null,
        kind,
        nodeType: p.node_type,
        ...(p.node_type === 'restroom' && p.restroom_gender !== undefined ? { gender: p.restroom_gender } : {}),
      });
    };
    if (p.node_type === 'poi') {
      places.push({ id: n.id, label: p.name ?? n.id, buildingId: null, buildingName: '', level: null, kind: 'poi', nodeType: 'poi' });
    } else if (p.node_type === 'door' && (p.space_name !== undefined || p.ref !== undefined || (p.room_ref !== undefined && p.door_role !== 'back'))) {
      indoor(p.space_name ?? p.ref ?? (p.room_ref !== undefined ? `${p.room_ref}호` : n.id), 'door');
    } else if (p.node_type === 'restroom') {
      indoor(p.name ?? restroomWord(p.restroom_gender), 'other');
    } else if (p.node_type === 'entrance' && p.name !== undefined) {
      indoor(p.name, 'other');
    }
  }
  // Building name first, so rooms of one building stay together; then floor, then room number (9호 before 10호).
  const levelKey = (pl: Place) => pl.level ?? NO_LEVEL;
  places.sort(
    (a, b) =>
      a.buildingName.localeCompare(b.buildingName, 'ko') ||
      levelKey(a) - levelKey(b) ||
      a.label.localeCompare(b.label, 'ko', { numeric: true }),
  );
  // Labels must be unique to search by name; fall back to the id when two collide.
  const seen = new Map<string, number>();
  for (const pl of places) seen.set(pl.label, (seen.get(pl.label) ?? 0) + 1);
  return places.map((pl) => (seen.get(pl.label)! > 1 ? { ...pl, label: `${pl.label} · ${pl.id}` } : pl));
}

/** Map line for a found route: the node positions in travel order. */
export function routeLine(route: Route, state: Pick<EditState, 'nodes'>): Position[] {
  return route.nodes.map((id) => state.nodes[id]?.coord).filter((p): p is Position => !!p);
}
