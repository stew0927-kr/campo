// The floorplan server's GeoJSON draft → one core action on the survey state (one 되돌리기). Nothing from the server is
// trusted as it came: the Features are checked, only schema keys are kept, building_id / level come from the floor the
// surveyor is on, and ids are the app's own (the same builder as the record buttons). A point that is already on the
// map (same floor, same kind, within SNAP_M) is used instead of a new one, so the same draft twice adds nothing.
import {
  buildingById,
  metres,
  type Action,
  type DoorRole,
  type EditContext,
  type EditNode,
  type EditState,
  type NodeType,
  type Position,
  type RestroomGender,
  type Wheelchair,
} from '@campo/core';
import { SNAP_M, builder, nearestNode, nearestWhere, type EdgeProps, type NodeProps } from '../survey/plans.ts';

export interface FloorplanApplyInput {
  state: EditState;
  ctx: EditContext;
  scope: { kind: 'building'; buildingId: string; level: number };
  /** 서버가 준 FeatureCollection (형식이 깨졌을 수 있으니 검사). */
  geojson: unknown;
  /** 새 Feature의 source, 예: 'school-floorplan-ai'. */
  source: string;
}

export interface FloorplanApplyCounts {
  /** New points made. */
  nodes: number;
  /** New edges made. */
  edges: number;
  /** Server points that were already on the map (used as they are). */
  reused: number;
  /** Lines that could not be drawn: an end missing, both ends the same point, or the pair already joined. */
  skippedEdges: number;
}

export type FloorplanApplyResult = { action: Action | null; counts: FloorplanApplyCounts; notices: string[] } | { error: string };

export const FLOORPLAN_SOURCE = 'school-floorplan-ai';
export const NO_POINTS = '안내도에서 읽은 지점이 없습니다.';
/** An elevator of the draft is the shaft of an existing stop in the building (any floor) this close; it then takes that spot (I5). */
export const SHAFT_MATCH_M = 5;

const INDOOR_TYPES: readonly NodeType[] = ['entrance', 'door', 'corridor', 'elevator_stop', 'stair_landing', 'poi', 'restroom'];
const DOOR_ROLES: readonly DoorRole[] = ['front', 'back', 'other'];
const GENDERS: readonly RestroomGender[] = ['male', 'female', 'unisex', 'family'];
const WHEELCHAIR: readonly Wheelchair[] = ['yes', 'limited', 'no', 'unknown'];
/** Free-text node keys of the schema that a draft may carry. */
const TEXT_KEYS = ['name', 'ref', 'space_name', 'room_ref', 'hours', 'closed_period', 'access_condition'] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPos = (p: unknown): p is Position =>
  Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
  && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
const pick = <T extends string>(allowed: readonly T[], v: unknown): T | undefined => (allowed as readonly unknown[]).includes(v) ? (v as T) : undefined;

interface DraftPoint {
  featureId: string;
  coord: Position;
  type: NodeType;
  props: Record<string, unknown>;
}
interface DraftLine {
  from: string;
  to: string;
  props: Record<string, unknown>;
}

/** The points and lines of a FeatureCollection that can be read; null when it is not one. */
function readDraft(geojson: unknown): { points: DraftPoint[]; lines: DraftLine[]; unreadable: number } | null {
  if (!isRecord(geojson) || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) return null;
  const points: DraftPoint[] = [];
  const lines: DraftLine[] = [];
  let unreadable = 0;
  for (const f of geojson.features) {
    const props = isRecord(f) && isRecord(f.properties) ? f.properties : undefined;
    const geom = isRecord(f) && isRecord(f.geometry) ? f.geometry : undefined;
    const id = isRecord(f) && (typeof f.id === 'string' || typeof f.id === 'number') ? String(f.id) : undefined;
    if (!props || !geom || id === undefined) {
      unreadable++;
      continue;
    }
    if (props.kind === 'node' && geom.type === 'Point' && isPos(geom.coordinates)) {
      const type = pick(INDOOR_TYPES, props.node_type);
      if (type === undefined) {
        unreadable++;
        continue;
      }
      points.push({ featureId: id, coord: [geom.coordinates[0], geom.coordinates[1]], type, props });
    } else if (props.kind === 'edge' && geom.type === 'LineString') {
      const from = typeof props.from === 'string' ? props.from : undefined;
      const to = typeof props.to === 'string' ? props.to : undefined;
      if (from === undefined || to === undefined) {
        unreadable++;
        continue;
      }
      lines.push({ from, to, props });
    } else {
      unreadable++;
    }
  }
  return { points, lines, unreadable };
}

/** The schema keys of a draft point, checked, on the surveyor's floor. elevator_id is set by the caller. */
function nodeProps(p: DraftPoint, scope: FloorplanApplyInput['scope'], source: string): NodeProps | null {
  const out: NodeProps = { kind: 'node', node_type: p.type, building_id: scope.buildingId, level: scope.level, source, needs_check: true };
  for (const key of TEXT_KEYS) {
    const v = text(p.props[key]);
    if (v !== undefined) out[key] = v;
  }
  const role = pick(DOOR_ROLES, p.props.door_role);
  if (role !== undefined) out.door_role = role;
  if (p.type === 'restroom') {
    const gender = pick(GENDERS, p.props.restroom_gender);
    if (gender === undefined) return null;
    out.restroom_gender = gender;
    out.wheelchair = pick(WHEELCHAIR, p.props.wheelchair) ?? 'unknown';
    const table = p.props.changing_table;
    if (typeof table === 'boolean' || table === null) out.changing_table = table;
  }
  return out;
}

/** The checked line props: a flat way inside the floor (corridor or ramp), indoor, both ends on the surveyor's floor. */
function edgeProps(l: DraftLine, from: string, to: string, scope: FloorplanApplyInput['scope'], source: string): EdgeProps {
  const highway = l.props.highway === 'ramp' ? 'ramp' : 'corridor';
  const stepFree = l.props.step_free;
  const out: EdgeProps = {
    kind: 'edge', highway, edge_type: 'indoor', from, to,
    bidirectional: typeof l.props.bidirectional === 'boolean' ? l.props.bidirectional : true,
    step_free: typeof stepFree === 'boolean' ? stepFree : null,
    level_from: scope.level, level_to: scope.level, building_from: scope.buildingId, building_to: scope.buildingId,
    source, needs_check: true,
  };
  const width = l.props.width_m;
  if (typeof width === 'number' && width >= 0.5 && width <= 20) out.width_m = width;
  return out;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function applyFloorplanDraft(input: FloorplanApplyInput): FloorplanApplyResult {
  const { state, ctx, scope, source } = input;
  const draft = readDraft(input.geojson);
  if (!draft || draft.points.length === 0) return { error: NO_POINTS };
  const building = buildingById(state, scope.buildingId);
  if (!building) return { error: '건물을 찾을 수 없습니다. 위쪽에서 건물과 층을 다시 골라 주세요.' };
  if (!building.props.levels.includes(scope.level)) return { error: '이 건물의 층 목록에 없는 층입니다. 건물 정보에서 층을 먼저 더해 주세요.' };

  const b = builder(state, ctx);
  const notices: string[] = [];
  /** Server feature id → app node id. */
  const idOf = new Map<string, string>();
  /** Points made by this draft (a second server point at the same spot joins the first). */
  const made: { id: string; coord: Position; type: NodeType; elevatorId?: string }[] = [];
  let reused = 0;
  let droppedPoints = 0;

  // Elevators: a server id (EV1) is one shaft of this building. It is an existing shaft when a stop of the building
  // stands near on any floor (it then takes that spot, I5), else a new "{code}_elev{A-Z}" not used yet.
  const shaftOf = new Map<string, { elevatorId: string; coord: Position | null } | null>();
  const usedIds = new Set(Object.values(state.nodes).map((n) => n.props.elevator_id).filter((v): v is string => v !== undefined));
  const newShaftId = (): string | undefined => {
    for (let c = 65; c <= 90; c++) {
      const id = `${building.props.code}_elev${String.fromCharCode(c)}`;
      if (!usedIds.has(id)) {
        usedIds.add(id);
        return id;
      }
    }
    return undefined;
  };
  let snappedShafts = 0;
  const shaftFor = (p: DraftPoint): { elevatorId: string; coord: Position | null } | null => {
    const key = text(p.props.elevator_id) ?? `#${p.featureId}`;
    if (shaftOf.has(key)) return shaftOf.get(key)!;
    const near = nearestWhere(state, p.coord, SHAFT_MATCH_M, (n) =>
      n.props.building_id === scope.buildingId && n.props.node_type === 'elevator_stop' && n.props.elevator_id !== undefined);
    let shaft: { elevatorId: string; coord: Position | null } | null;
    if (near) {
      shaft = { elevatorId: near.props.elevator_id!, coord: near.coord };
      snappedShafts++;
    } else {
      const id = newShaftId();
      shaft = id !== undefined ? { elevatorId: id, coord: null } : null;
    }
    shaftOf.set(key, shaft);
    return shaft;
  };

  for (const p of draft.points) {
    const props = nodeProps(p, scope, source);
    if (!props) {
      droppedPoints++;
      continue;
    }
    let coord = p.coord;
    let elevatorId: string | undefined;
    if (p.type === 'elevator_stop') {
      const shaft = shaftFor(p);
      if (!shaft) {
        droppedPoints++;
        continue;
      }
      elevatorId = shaft.elevatorId;
      props.elevator_id = elevatorId;
      if (shaft.coord) coord = shaft.coord;
    }
    const same = (n: Pick<EditNode, 'props'>): boolean =>
      n.props.node_type === p.type && (elevatorId === undefined || n.props.elevator_id === elevatorId);
    const existing = nearestNode(state, scope, coord, SNAP_M, same);
    if (existing) {
      idOf.set(p.featureId, existing.id);
      reused++;
      continue;
    }
    const twin = made.find((m) => m.type === p.type && m.elevatorId === elevatorId && metres(m.coord, coord) <= SNAP_M);
    if (twin) {
      idOf.set(p.featureId, twin.id);
      continue;
    }
    const id = b.node(coord, props);
    idOf.set(p.featureId, id);
    made.push({ id, coord, type: p.type, ...(elevatorId !== undefined ? { elevatorId } : {}) });
  }

  const joined = new Set(Object.values(state.edges).map((e) => pairKey(e.props.from, e.props.to)));
  let edges = 0;
  let skippedEdges = 0;
  for (const l of draft.lines) {
    const from = idOf.get(l.from);
    const to = idOf.get(l.to);
    if (from === undefined || to === undefined || from === to || joined.has(pairKey(from, to))) {
      skippedEdges++;
      continue;
    }
    joined.add(pairKey(from, to));
    b.edge(edgeProps(l, from, to, scope, source));
    edges++;
  }

  const counts: FloorplanApplyCounts = { nodes: made.length, edges, reused, skippedEdges };
  if (made.length > 0 || edges > 0) notices.push(`지점 ${made.length}개, 복도 ${edges}개를 지도에 놓았습니다.`);
  else notices.push('새로 놓을 지점이 없습니다. 안내도의 지점이 이미 지도에 있습니다.');
  if (reused > 0) notices.push(`이미 있던 지점 ${reused}개는 그대로 썼습니다.`);
  if (snappedShafts > 0) notices.push(`엘리베이터 ${snappedShafts}개는 이미 있는 승강로 자리에 맞췄습니다.`);
  if (skippedEdges > 0) notices.push(`연결하지 못한 선 ${skippedEdges}개는 편집기에서 이어 주세요.`);
  if (droppedPoints + draft.unreadable > 0) notices.push(`읽지 못한 항목 ${droppedPoints + draft.unreadable}개는 빼고 놓았습니다.`);
  return { action: b.action('안내도 자동 매핑'), counts, notices };
}

