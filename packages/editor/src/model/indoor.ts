// "지점 추가", "엘리베이터", "계단", "잇기" tools (SPEC §8).
// step_free defaults follow SPEC-v0.2 §2.1: steps false, elevator true, everything else null (not known).
import type { EdgeFeature, EdgeProperties, NodeFeature, NodeProperties, Position } from '@campo/core';
import { withFeatures, type CampusDoc } from './document.ts';
import { edgeIdFor, freeId, getBuilding, getNode } from './ids.ts';
import { DRAWN_SOURCE } from './outdoor-path.ts';
import { floorLabel } from './scope.ts';

export const INDOOR_NODE_KINDS = ['entrance', 'door', 'classroom', 'corridor'] as const;
export type IndoorNodeKind = (typeof INDOOR_NODE_KINDS)[number];

type Fail = { error: string };

export interface NewIndoorNode {
  buildingId: string;
  level: number;
  kind: IndoorNodeKind;
  position: Position;
  /** Room number, for classroom doors ("408"). */
  ref?: string;
  /** Room name, for classroom doors ("408호 강의실"). */
  spaceName?: string;
}

export function addIndoorNode(doc: CampusDoc, n: NewIndoorNode): { doc: CampusDoc; id: string } | Fail {
  const building = getBuilding(doc, n.buildingId);
  if (!building) return { error: '건물을 먼저 골라 주세요.' };
  if (!building.properties.levels.includes(n.level)) return { error: `${floorLabel(n.level)}은 이 건물의 층 목록에 없습니다.` };
  const { code } = building.properties;

  let name: string;
  const extra: Partial<Pick<NodeProperties, 'ref' | 'space_name'>> = {};
  if (n.kind === 'classroom') {
    const ref = n.ref?.trim() ?? '';
    if (!/^[A-Za-z0-9-]+$/.test(ref)) return { error: '호수는 영문, 숫자, - 만 쓸 수 있습니다. 예: 408, B102' };
    name = `${ref}door`;
    extra.ref = ref;
    extra.space_name = n.spaceName?.trim() || `${ref}호 강의실`;
  } else {
    name = { entrance: 'entrance', door: 'door', corridor: 'hall' }[n.kind];
  }
  const id = freeId(doc.features, `n_${code}_${n.level}_${name}`);
  const node: NodeFeature = {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [n.position[0], n.position[1]] },
    properties: {
      kind: 'node',
      node_type: n.kind === 'classroom' ? 'door' : n.kind,
      building_id: building.id,
      level: n.level,
      ...extra,
      source: DRAWN_SOURCE,
      rev: 1,
    },
  };
  return { doc: withFeatures(doc, [node]), id };
}

export interface VerticalResult {
  doc: CampusDoc;
  nodeIds: string[];
  edgeIds: string[];
}

/**
 * One stop per checked level, all at the same spot, and an elevator edge between
 * each pair of neighbouring stops (SPEC §3 엘리베이터).
 */
export function addElevator(doc: CampusDoc, e: { buildingId: string; position: Position; levels: number[] }): VerticalResult | Fail {
  const building = getBuilding(doc, e.buildingId);
  if (!building) return { error: '건물을 먼저 골라 주세요.' };
  const stops = building.properties.levels.filter((l) => e.levels.includes(l));
  if (stops.length < 2) return { error: '정차 층을 두 개 이상 골라 주세요.' };
  const { code } = building.properties;
  const letter = freeLetter((x) => [...doc.features.keys()].some((id) => id.startsWith(`n_${code}_elev${x}_`)));
  if (!letter) return { error: '이 건물에는 엘리베이터를 더 만들 수 없습니다(A~Z 모두 사용 중).' };

  const shaft = `elev${letter}`;
  const nodes = stops.map((level): NodeFeature => ({
    type: 'Feature',
    id: `n_${code}_${shaft}_L${level}`,
    geometry: { type: 'Point', coordinates: [e.position[0], e.position[1]] },
    properties: { kind: 'node', node_type: 'elevator_stop', building_id: building.id, level, elevator_id: `${code}_${shaft}`, source: DRAWN_SOURCE, rev: 1 },
  }));
  return chain(doc, nodes, { highway: 'elevator', edge_type: 'indoor', step_free: true });
}

/** One landing per level from `from` to `to`, and one steps edge per floor in between (SPEC §3 계단). */
export function addStairs(doc: CampusDoc, s: { buildingId: string; position: Position; from: number; to: number }): VerticalResult | Fail {
  const building = getBuilding(doc, s.buildingId);
  if (!building) return { error: '건물을 먼저 골라 주세요.' };
  const { levels, code } = building.properties;
  if (!levels.includes(s.from) || !levels.includes(s.to)) return { error: '시작 층과 끝 층은 이 건물의 층 목록에서 골라 주세요.' };
  if (s.from === s.to) return { error: '시작 층과 끝 층이 같습니다.' };
  const [lo, hi] = [Math.min(s.from, s.to), Math.max(s.from, s.to)];
  const flights = levels.filter((l) => l >= lo && l <= hi);
  const letter = freeLetter((x) => [...doc.features.keys()].some((id) => new RegExp(`^n_${code}_-?\\d+_stair${x}$`).test(id)));
  if (!letter) return { error: '이 건물에는 계단을 더 만들 수 없습니다(A~Z 모두 사용 중).' };

  const nodes = flights.map((level): NodeFeature => ({
    type: 'Feature',
    id: `n_${code}_${level}_stair${letter}`,
    geometry: { type: 'Point', coordinates: [s.position[0], s.position[1]] },
    properties: { kind: 'node', node_type: 'stair_landing', building_id: building.id, level, source: DRAWN_SOURCE, rev: 1 },
  }));
  return chain(doc, nodes, { highway: 'steps', edge_type: 'indoor', step_free: false });
}

/**
 * "잇기": an edge between two nodes on the same floor of one building (corridor),
 * or between two outdoor nodes (footway). Floors, buildings and the outside are
 * joined by the stairs / elevator / portal / bridge tools instead.
 */
export function connectNodes(doc: CampusDoc, fromId: string, toId: string): { doc: CampusDoc; id: string } | Fail {
  const from = getNode(doc, fromId);
  const to = getNode(doc, toId);
  if (!from || !to) return { error: '이을 지점을 찾을 수 없습니다.' };
  if (from.id === to.id) return { error: '같은 지점입니다. 다른 지점을 골라 주세요.' };
  const [a, b] = [from.properties, to.properties];

  let props: Pick<EdgeProperties, 'highway' | 'edge_type' | 'step_free'>;
  if (a.building_id === null && b.building_id === null) {
    props = { highway: 'footway', edge_type: 'outdoor', step_free: null };
  } else if (a.building_id === null || b.building_id === null) {
    return { error: '건물 안과 바깥은 포탈 도구로 이어 주세요.' };
  } else if (a.building_id !== b.building_id) {
    return { error: '다른 건물끼리는 연결통로 도구로 이어 주세요.' };
  } else if (a.level !== b.level) {
    return { error: '다른 층끼리는 계단이나 엘리베이터 도구로 이어 주세요.' };
  } else {
    props = { highway: 'corridor', edge_type: 'indoor', step_free: null };
  }
  const already = [...doc.features.values()].some((f) => f.properties.kind === 'edge' &&
    ((f.properties.from === fromId && f.properties.to === toId) || (f.properties.from === toId && f.properties.to === fromId)));
  if (already) return { error: '두 지점은 이미 이어져 있습니다.' };

  const id = edgeIdFor(doc.features, fromId, toId);
  const edge: EdgeFeature = {
    type: 'Feature',
    id,
    geometry: { type: 'LineString', coordinates: [from.geometry.coordinates, to.geometry.coordinates] },
    properties: { kind: 'edge', ...props, from: fromId, to: toId, bidirectional: true, source: DRAWN_SOURCE, rev: 1 },
  };
  return { doc: withFeatures(doc, [edge]), id };
}

/** Nodes in floor order, joined one floor at a time. */
function chain(doc: CampusDoc, nodes: NodeFeature[], props: Pick<EdgeProperties, 'highway' | 'edge_type' | 'step_free'>): VerticalResult | Fail {
  const clash = nodes.find((n) => doc.features.has(n.id));
  if (clash) return { error: `ID ${clash.id}가 이미 있습니다.` };
  const taken = new Set(doc.features.keys());
  const edges: EdgeFeature[] = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const [lo, hi] = [nodes[i]!, nodes[i + 1]!];
    const id = edgeIdFor(taken, lo.id, hi.id);
    taken.add(id);
    edges.push({
      type: 'Feature',
      id,
      geometry: { type: 'LineString', coordinates: [lo.geometry.coordinates, hi.geometry.coordinates] },
      properties: {
        kind: 'edge',
        ...props,
        from: lo.id,
        to: hi.id,
        bidirectional: true,
        level_from: lo.properties.level!,
        level_to: hi.properties.level!,
        source: DRAWN_SOURCE,
        rev: 1,
      },
    });
  }
  return {
    doc: withFeatures(doc, [...nodes, ...edges]),
    nodeIds: nodes.map((n) => n.id),
    edgeIds: edges.map((e) => e.id),
  };
}

function freeLetter(used: (letter: string) => boolean): string | undefined {
  for (let c = 65; c <= 90; c++) if (!used(String.fromCharCode(c))) return String.fromCharCode(c);
  return undefined;
}
