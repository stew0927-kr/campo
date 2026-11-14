// 건물 추가: a building that is not in the campus data yet becomes one on site, either from the OpenStreetMap outlines
// bundled into the app (tap inside it) or from an outline drawn point by point. The same data as the editor's
// "OSM 건물 가져오기" and "건물 외곽선 그리기" make: code OSM{w|r}{id}, source "osm", needs_check, floors from building:levels,
// so the survey file opens in the editor like anything drawn there. Each is one core action: one 되돌리기.
import { addBuilding, compose, setProps, type Action, type EditContext, type EditState, type Position } from '@campo/core';
import type { Scope } from '../model/scope.ts';

/** `source` of a building read from OpenStreetMap (the editor uses the same). */
export const OSM_SOURCE = 'osm';

export interface OsmBuilding {
  /** "w123" for a way, "r45" for a relation. */
  osmId: string;
  name: string | null;
  /** 1 … building:levels and -1 … building:levels:underground; [1] when OpenStreetMap does not say. */
  levels: number[];
  levelsKnown: boolean;
  /** Closed outer ring, [lng, lat]. */
  ring: Position[];
}

export interface OsmCampus {
  /** [west, south, east, north]: where the bundled buildings were read. */
  bbox: readonly number[];
  buildings: OsmBuilding[];
}

export function pointInRing([x, y]: Position, ring: readonly Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const area = (ring: readonly Position[]): number => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j]![0] + ring[i]![0]) * (ring[j]![1] - ring[i]![1]);
  return Math.abs(a / 2);
};

export const osmCode = (osmId: string): string => `OSM${osmId}`;

export type OsmLookup = { building: OsmBuilding } | { error: string };

/** The bundled OSM building whose outline holds `position` (the smallest when outlines are nested), or why there is none. */
export function lookupOsmBuilding(osm: OsmCampus | null, state: EditState, position: Position): OsmLookup {
  if (!osm || osm.buildings.length === 0) return { error: '이 앱에는 이 캠퍼스의 OSM 건물 데이터가 들어 있지 않습니다. 외곽선을 직접 그려 주세요.' };
  for (const b of Object.values(state.buildings)) {
    if (pointInRing(position, b.polygon[0] ?? [])) return { error: `여기에는 이미 건물(${b.props.name})이 있습니다. 건물이 없는 자리를 눌러 주세요.` };
  }
  const hit = osm.buildings.filter((b) => pointInRing(position, b.ring)).sort((a, z) => area(a.ring) - area(z.ring))[0];
  return hit ? { building: hit } : { error: '십자선 자리에 OSM 건물이 없습니다. 건물 안쪽에 맞추시거나 외곽선을 직접 그려 주세요.' };
}

export interface BuildingPlan {
  action: Action;
  /** Where the surveyor stands afterwards: the new building's first ground floor, ready for indoor mapping. */
  scope: Scope;
  buildingId: string;
  notices: string[];
}

/** addBuilding for an OSM outline, marked needs_check; the name and floors come from OSM. */
export function planOsmBuilding(state: EditState, b: OsmBuilding): BuildingPlan | { error: string } {
  const code = osmCode(b.osmId);
  if (state.buildings[code]) return { error: `이 건물은 이미 가져왔습니다(${state.buildings[code]!.props.name}).` };
  const name = b.name ?? `이름 없는 건물 ${b.osmId}`;
  const id = `bldg_${code}`;
  const action = compose([
    addBuilding({ polygon: [b.ring.map(([x, y]): Position => [x, y])], code, name, levels: b.levels, source: OSM_SOURCE }),
    setProps([id], { needs_check: true }),
  ], `OSM 건물 "${name}" 가져오기`);
  const reason = action.disabled(state);
  if (reason !== false) return { error: reason };
  const ground = b.levels.includes(1) ? 1 : b.levels[0]!;
  return {
    action, buildingId: id, scope: { kind: 'building', buildingId: id, level: ground },
    notices: [
      b.levelsKnown ? `${name}: OSM의 층수(${b.levels.length}개 층)를 넣었습니다.` : `${name}: OSM에 층수가 없어 1층만 넣었습니다.`,
      '이름·층은 편집기의 상세 정보에서 고칠 수 있습니다.',
    ],
  };
}

export interface DrawnBuilding {
  name: string;
  /** Floors as typed, e.g. -1 … 4. */
  levels: number[];
}

/** A drawn outline (at least three corners) becomes a building. The code is made from the id tail, as the editor's drawn buildings are. */
export function planDrawnBuilding(state: EditState, ctx: EditContext, ring: readonly Position[], form: DrawnBuilding): BuildingPlan | { error: string } {
  if (ring.length < 3) return { error: '외곽선은 점이 세 개 이상 필요합니다.' };
  const name = form.name.trim();
  if (name === '') return { error: '건물 이름을 입력해 주세요.' };
  let code = '';
  for (let i = 0; i < 100; i++) {
    code = `N${ctx.ids.tail().toUpperCase()}`;
    if (!state.buildings[code]) break;
  }
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  const closed = first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
  const levels = [...new Set(form.levels)].sort((a, z) => a - z);
  const id = `bldg_${code}`;
  const action = compose([
    addBuilding({ polygon: [closed.map(([x, y]): Position => [x, y])], code, name, levels, source: 'field-survey' }),
    setProps([id], { needs_check: true }),
  ], `건물 "${name}" 추가`);
  const reason = action.disabled(state);
  if (reason !== false) return { error: reason };
  return { action, buildingId: id, scope: { kind: 'building', buildingId: id, level: levelOneOr(levels) }, notices: [`${name}을(를) 추가했습니다. 코드 ${code}는 편집기에서 바꿀 수 있습니다.`] };
}

const levelOneOr = (levels: readonly number[]): number => (levels.includes(1) ? 1 : levels[0] ?? 1);

/** "-1~4" (0 is skipped: there is no 0층) or "1,2,3" → floors; null when it is not that. */
export function parseLevelRange(text: string): number[] | null {
  const t = text.replace(/\s/g, '');
  let list: number[];
  const range = /^(-?\d+)~(-?\d+)$/.exec(t);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    if (Math.abs(b - a) > 200) return null;
    list = Array.from({ length: Math.abs(b - a) + 1 }, (_, k) => Math.min(a, b) + k);
  } else if (/^-?\d+(,-?\d+)*$/.test(t)) list = t.split(',').map(Number);
  else return null;
  list = [...new Set(list)].filter((l) => l !== 0).sort((a, z) => a - z);
  return list.length > 0 ? list : null;
}
