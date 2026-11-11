// Campus data checks (docs/SPEC.md §7, docs/v0.2/SPEC-v0.2.md §8).
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import distance from '@turf/distance';
import schema from '../../../data/schema/campo.schema.json' with { type: 'json' };
import {
  ERROR_CODES as E,
  WARNING_CODES as W,
  type BuildingFeature,
  type CampoFeature,
  type CampusMeta,
  type EdgeFeature,
  type ErrorCode,
  type LoadedCampus,
  type NodeFeature,
  type Override,
  type Position,
  type ValidationIssue,
  type ValidationResult,
  type WarningCode,
} from './types.ts';
import { CAMPUS_META_FILE, OVERRIDES_FILE } from './load.ts';
import { isStepFreePassable } from './costs.ts';

/** Max distance (m) between an edge's line ends and its from/to nodes (§7 error 4). */
export const ENDPOINT_TOLERANCE_M = 1;

const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
ajv.addSchema(schema);
const validateFeatureSchema = schemaFor<CampoFeature>('feature');
const validateMetaSchema = schemaFor<CampusMeta>('campus');
const validateOverridesSchema = schemaFor<Override[]>('overrides');

function schemaFor<T>(def: string): ValidateFunction<T> {
  const fn = ajv.getSchema<T>(`${schema.$id}#/$defs/${def}`);
  if (!fn) throw new Error(`campo.schema.json has no $defs/${def}`);
  return fn as ValidateFunction<T>; // the schema has no $async, so validation is synchronous
}

/** Schema check for one feature (§7 error 1). */
export function isValidFeature(feature: unknown): feature is CampoFeature {
  return validateFeatureSchema(feature);
}

interface Located<F> {
  file: string;
  feature: F;
}

export interface ValidateOptions {
  /** The clock for W7 (expired overrides). Tests pass a fixed time. Default: now. */
  now?: Date;
}

export function validateCampus(campus: LoadedCampus, options: ValidateOptions = {}): ValidationResult {
  const errors: ValidationIssue<ErrorCode>[] = [];
  const warnings: ValidationIssue<WarningCode>[] = [];
  const error = (file: string, featureId: string | null, code: ErrorCode, message: string) =>
    errors.push({ file, featureId, code, message });
  const warn = (file: string, featureId: string | null, code: WarningCode, message: string) =>
    warnings.push({ file, featureId, code, message });

  // ---- 1. JSON Schema ----
  for (const { file, message } of campus.fileErrors) error(file, null, E.schema, message);

  if (campus.meta === undefined) {
    error(CAMPUS_META_FILE, null, E.schema, 'campus.json 파일이 없습니다.');
  } else if (isRecord(campus.meta) && campus.meta['schema_version'] === undefined) {
    error(CAMPUS_META_FILE, null, E.schema, 'campus.json에 schema_version이 없습니다. v0.1 데이터이면 npm run migrate를 먼저 돌려 주세요.');
  } else if (!validateMetaSchema(campus.meta)) {
    error(CAMPUS_META_FILE, null, E.schema, formatSchemaErrors(validateMetaSchema.errors));
  }

  let overrides: Override[] = [];
  if (campus.overrides !== undefined) {
    if (validateOverridesSchema(campus.overrides)) overrides = campus.overrides;
    else error(OVERRIDES_FILE, null, E.schema, formatSchemaErrors(validateOverridesSchema.errors));
  }

  const valid: Located<CampoFeature>[] = [];
  /** Every id seen, valid or not, so a schema error does not cascade into dangling-ref errors. */
  const allIds = new Set<string>();
  const firstFileById = new Map<string, string>();

  for (const { file, feature } of campus.features) {
    const id = featureId(feature);
    if (!validateFeatureSchema(feature)) {
      error(file, id, E.schema, formatSchemaErrors(validateFeatureSchema.errors));
    }

    // ---- 2. Duplicate ids (whole campus) ----
    if (id !== null) {
      const first = firstFileById.get(id);
      if (first !== undefined) {
        error(file, id, E.duplicateId, `ID "${id}"가 중복됩니다. 처음 나온 파일: ${first}`);
        continue;
      }
      firstFileById.set(id, file);
      allIds.add(id);
    }
    if (isValidFeature(feature)) valid.push({ file, feature });
  }

  const buildings = new Map<string, Located<BuildingFeature>>();
  const nodes = new Map<string, Located<NodeFeature>>();
  const edges: Located<EdgeFeature>[] = [];
  for (const item of valid) {
    const f = item.feature;
    if (f.properties.kind === 'building') buildings.set(f.id, item as Located<BuildingFeature>);
    else if (f.properties.kind === 'node') nodes.set(f.id, item as Located<NodeFeature>);
    else if (f.properties.kind === 'edge') edges.push(item as Located<EdgeFeature>);
    // Room outlines (kind "room") are only schema-checked for now.
  }

  const nonNodeIds = new Set([...buildings.keys(), ...edges.map((e) => e.feature.id)]);
  /** Edges whose both ends exist; the graph checks below only use these. */
  const linked: { file: string; edge: EdgeFeature; from: NodeFeature; to: NodeFeature }[] = [];

  for (const { file, feature: edge } of edges) {
    const p = edge.properties;

    // ---- 3. from/to must point at existing nodes ----
    const from = nodes.get(p.from);
    const to = nodes.get(p.to);
    for (const [end, ref, node] of [['from', p.from, from], ['to', p.to, to]] as const) {
      if (node) continue;
      if (!allIds.has(ref)) {
        error(file, edge.id, E.danglingRef, `${end}가 없는 지점 "${ref}"를 가리킵니다.`);
      } else if (nonNodeIds.has(ref)) {
        error(file, edge.id, E.danglingRef, `${end}가 지점이 아닌 Feature "${ref}"를 가리킵니다.`);
      }
      // Otherwise the target exists but failed the schema check, which is already reported.
    }
    if (!from || !to) continue;
    linked.push({ file, edge, from: from.feature, to: to.feature });

    // ---- E9 (I4): flat edges stay inside one scope; only portals and bridges cross ----
    if ((p.highway === 'footway' || p.highway === 'corridor') && p.edge_type !== 'portal' && p.edge_type !== 'bridge') {
      if (scopeOf(from.feature) !== scopeOf(to.feature)) {
        error(file, edge.id, E.flatEdgeCrossesScope,
          `평지 구간이 서로 다른 범위(${scopeOf(from.feature)} → ${scopeOf(to.feature)})를 잇습니다. 포탈이나 연결통로로 이어야 합니다.`);
      }
    }

    // ---- 4. Line ends must sit on the from/to nodes (elevators excepted) ----
    if (p.highway !== 'elevator') {
      const coords = edge.geometry.coordinates;
      const ends: [string, Position, NodeFeature][] = [
        ['시작', coords[0]!, from.feature],
        ['끝', coords[coords.length - 1]!, to.feature],
      ];
      for (const [label, pos, node] of ends) {
        const d = distance(pos, node.geometry.coordinates, { units: 'meters' });
        if (d > ENDPOINT_TOLERANCE_M) {
          error(file, edge.id, E.endpointMismatch,
            `선의 ${label}점이 지점 "${node.id}"에서 ${d.toFixed(1)}m 떨어져 있습니다(허용 ${ENDPOINT_TOLERANCE_M}m).`);
        }
      }
    }

    // ---- 6. Elevator / indoor stair levels must match their end nodes ----
    if (p.highway === 'elevator' || (p.highway === 'steps' && p.edge_type === 'indoor')) {
      const what = p.highway === 'elevator' ? '엘리베이터' : '계단';
      for (const [key, value, node] of [['level_from', p.level_from, from.feature], ['level_to', p.level_to, to.feature]] as const) {
        if (value === undefined) {
          error(file, edge.id, E.verticalLevelMismatch, `${what} 구간에 ${key}가 없습니다.`);
        } else if (value !== node.properties.level) {
          error(file, edge.id, E.verticalLevelMismatch,
            `${what} 구간의 ${key}(${value})가 지점 "${node.id}"의 level(${String(node.properties.level)})과 다릅니다.`);
        }
      }
    }
  }

  // ---- 5. Indoor node levels must exist in their building ----
  for (const { file, feature: node } of nodes.values()) {
    const { building_id, level } = node.properties;
    if (building_id === null) continue;
    const building = buildings.get(building_id);
    if (!building) {
      error(file, node.id, E.levelNotInBuilding, `building_id "${building_id}"인 건물이 없습니다.`);
    } else if (level !== null && !building.feature.properties.levels.includes(level)) {
      error(file, node.id, E.levelNotInBuilding,
        `level ${level}이 건물 "${building_id}"의 levels(${building.feature.properties.levels.join(', ')})에 없습니다.`);
    }
  }

  // ---- 7. Every ground level needs an entrance ----
  for (const { file, feature: building } of buildings.values()) {
    for (const level of building.properties.ground_levels) {
      const hasEntrance = [...nodes.values()].some(({ feature: n }) =>
        n.properties.node_type === 'entrance' && n.properties.building_id === building.id && n.properties.level === level);
      if (!hasEntrance) {
        error(file, building.id, E.groundLevelWithoutEntrance, `지면에 닿는 ${level}층에 출입구(entrance) 지점이 없습니다.`);
      }
    }
  }

  // ---- 8. Every entrance needs a portal edge ----
  // Use every portal edge, even one with a broken far end: that is error 3's job, not this one's.
  const portalEnds = new Set<string>();
  for (const { feature: edge } of edges) {
    if (edge.properties.edge_type === 'portal') {
      portalEnds.add(edge.properties.from);
      portalEnds.add(edge.properties.to);
    }
  }
  for (const { file, feature: node } of nodes.values()) {
    if (node.properties.node_type === 'entrance' && !portalEnds.has(node.id)) {
      error(file, node.id, E.entranceWithoutPortal, '출입구가 포탈 구간으로 바깥 지점과 이어지지 않았습니다.');
    }
  }

  // ---- Warnings ----
  const neighbours = new Map<string, Set<string>>();
  for (const id of nodes.keys()) neighbours.set(id, new Set());
  for (const { from, to } of linked) {
    neighbours.get(from.id)!.add(to.id);
    neighbours.get(to.id)!.add(from.id);
  }

  // W1. Nodes not used by any edge
  const referenced = new Set<string>();
  for (const { feature: edge } of edges) {
    referenced.add(edge.properties.from);
    referenced.add(edge.properties.to);
  }
  for (const { file, feature: node } of nodes.values()) {
    if (!referenced.has(node.id)) warn(file, node.id, W.isolatedNode, '어떤 구간에도 연결되지 않은 지점입니다.');
  }

  // W2. Graph pieces cut off from the rest (isolated single nodes are W1's job)
  const components = connectedComponents(neighbours).filter((c) => c.length > 1);
  if (components.length > 1) {
    components.sort((a, b) => b.length - a.length || (a[0]! < b[0]! ? -1 : 1));
    for (const component of components.slice(1)) {
      const first = component[0]!;
      warn(nodes.get(first)!.file, first, W.disconnectedComponent,
        `이 지점을 포함한 ${component.length}개 지점이 나머지 길과 끊겨 있습니다.`);
    }
  }

  // W3. needs_check list
  for (const { file, feature } of valid) {
    if (feature.properties.needs_check === true) warn(file, feature.id, W.needsCheck, '현장 확인이 필요합니다.');
  }

  // W4. Every classroom door should be reachable step-free from every poi
  const stepFreeNext = new Map<string, string[]>();
  for (const id of nodes.keys()) stepFreeNext.set(id, []);
  for (const { edge } of linked) {
    if (!isStepFreePassable(edge.properties)) continue;
    stepFreeNext.get(edge.properties.from)!.push(edge.properties.to);
    if (edge.properties.bidirectional) stepFreeNext.get(edge.properties.to)!.push(edge.properties.from);
  }
  const pois = [...nodes.values()].filter(({ feature: n }) => n.properties.node_type === 'poi');
  const doors = [...nodes.values()].filter(({ feature: n }) => isClassroomDoor(n));
  for (const { feature: poi } of pois) {
    const reachable = reach(poi.id, stepFreeNext);
    for (const { file, feature: door } of doors) {
      if (!reachable.has(door.id)) {
        warn(file, door.id, W.noStepFreeRoute,
          `"${label(poi)}"에서 "${label(door)}"까지 계단 없는 경로가 없습니다.`);
      }
    }
  }

  // ---- v0.2 checks (SPEC-v0.2 §8). Comparing levels is fine here: this is validation, not routing. ----
  const nodeList = [...nodes.values()];
  /** Edges touching each node, from the edges whose both ends exist. */
  const edgesAt = new Map<string, EdgeFeature[]>();
  for (const id of nodes.keys()) edgesAt.set(id, []);
  for (const { edge, from, to } of linked) {
    edgesAt.get(from.id)!.push(edge);
    edgesAt.get(to.id)!.push(edge);
  }
  const otherEnd = (edge: EdgeFeature, id: string): NodeFeature | undefined =>
    nodes.get(edge.properties.from === id ? edge.properties.to : edge.properties.from)?.feature;

  // E10. A restroom must be joined to the path network.
  for (const { file, feature: node } of nodeList) {
    if (node.properties.node_type === 'restroom' && edgesAt.get(node.id)!.length === 0) {
      error(file, node.id, E.restroomNotConnected, '화장실 지점이 어떤 구간에도 이어져 있지 않습니다.');
    }
  }

  // E11. Every elevator stop has an elevator_id, and one id means one elevator (stops joined by elevator edges).
  const stops = nodeList.filter(({ feature: n }) => n.properties.node_type === 'elevator_stop');
  const stopsById = new Map<string, Located<NodeFeature>[]>();
  for (const stop of stops) {
    const id = stop.feature.properties.elevator_id;
    if (id === undefined) {
      error(stop.file, stop.feature.id, E.elevatorIdMissing, '엘리베이터 정차 지점에 elevator_id가 없습니다.');
    } else {
      stopsById.set(id, [...(stopsById.get(id) ?? []), stop]);
    }
  }
  const stopIds = new Set(stops.map((s) => s.feature.id));
  const liftNext = new Map<string, string[]>();
  for (const id of stopIds) liftNext.set(id, []);
  for (const { edge } of linked) {
    const { highway, from, to } = edge.properties;
    if (highway === 'elevator' && stopIds.has(from) && stopIds.has(to)) {
      liftNext.get(from)!.push(to);
      liftNext.get(to)!.push(from);
    }
  }
  for (const [elevatorId, group] of [...stopsById].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const first = group[0]!;
    const joined = reach(first.feature.id, liftNext);
    const apart = group.filter((s) => !joined.has(s.feature.id));
    if (apart.length > 0) {
      error(first.file, first.feature.id, E.elevatorGroupSplit,
        `elevator_id "${elevatorId}"의 정차 지점 ${apart.map((s) => `"${s.feature.id}"`).join(', ')}이(가) 엘리베이터 구간으로 이어져 있지 않습니다.`);
    }

    // E9 (I5): the stops of one elevator share a shaft, so they sit at the same coordinate.
    const origin = first.feature.geometry.coordinates;
    for (const s of group.slice(1)) {
      const d = distance(origin, s.feature.geometry.coordinates, { units: 'meters' });
      if (d > ENDPOINT_TOLERANCE_M) {
        error(s.file, s.feature.id, E.elevatorStopsApart,
          `elevator_id "${elevatorId}"의 정차 지점이 "${first.feature.id}"에서 ${d.toFixed(1)}m 떨어져 있습니다(같은 승강로는 같은 자리여야 합니다).`);
      }
    }

    // W9. All stops on one level: nobody can ride it anywhere.
    const levels = new Set(group.map((s) => `${String(s.feature.properties.building_id)}/${String(s.feature.properties.level)}`));
    if (levels.size === 1) {
      warn(first.file, first.feature.id, W.elevatorSingleLevel, `elevator_id "${elevatorId}"의 정차 지점이 모두 같은 층입니다.`);
    }
  }

  // W8. A stop with only elevator edges: you can ride in but there is no way out.
  for (const { file, feature: node } of stops) {
    if (!edgesAt.get(node.id)!.some((e) => e.properties.highway !== 'elevator')) {
      warn(file, node.id, W.elevatorDeadEnd, '엘리베이터 정차 지점에 복도 쪽으로 이어진 구간이 없습니다(타기만 하고 내릴 곳이 없습니다).');
    }
  }

  // W5. A door should open onto a corridor.
  for (const { file, feature: node } of nodeList) {
    if (node.properties.node_type !== 'door') continue;
    const onCorridor = edgesAt.get(node.id)!.some((e) => otherEnd(e, node.id)?.properties.node_type === 'corridor');
    if (!onCorridor) warn(file, node.id, W.doorNotOnCorridor, '문이 복도와 이어져 있지 않습니다.');
  }

  // W6. One front door per room (room numbers repeat across buildings, so key by building too).
  const frontDoors = new Map<string, Located<NodeFeature>[]>();
  for (const door of nodeList) {
    const p = door.feature.properties;
    if (p.node_type !== 'door' || p.door_role !== 'front' || p.room_ref === undefined) continue;
    const key = `${String(p.building_id)}/${p.room_ref}`;
    frontDoors.set(key, [...(frontDoors.get(key) ?? []), door]);
  }
  for (const group of [...frontDoors.values()].filter((g) => g.length > 1)) {
    for (const { file, feature } of group.slice(1)) {
      warn(file, feature.id, W.duplicateFrontDoor,
        `호실 "${feature.properties.room_ref}"에 앞문(front)이 ${group.length}개 있습니다: ${group.map((d) => d.feature.id).join(', ')}`);
    }
  }

  // W7. Expired overrides should be cleaned out of overrides.json.
  const now = (options.now ?? new Date()).getTime();
  for (const o of overrides) {
    const until = Date.parse(o.until);
    if (Number.isNaN(until)) {
      error(OVERRIDES_FILE, o.feature_id, E.schema, `until "${o.until}"을(를) 시각으로 읽을 수 없습니다.`);
    } else if (until < now) {
      warn(OVERRIDES_FILE, o.feature_id, W.expiredOverride, `override(제보 ${o.report_id})가 ${o.until}에 만료되었습니다. 지워 주세요.`);
    }
  }

  // W10. A bridge exists to join two buildings.
  for (const { file, edge, from, to } of linked) {
    if (edge.properties.edge_type === 'bridge' && from.properties.building_id === to.properties.building_id) {
      warn(file, edge.id, W.bridgeSameBuilding, '연결통로의 양 끝 지점이 같은 건물에 있습니다.');
    }
  }

  return { errors, warnings };
}

/** "outdoor" or "건물id/층": the area an edge may stay in. */
function scopeOf(node: NodeFeature): string {
  const { building_id, level } = node.properties;
  return building_id === null ? 'outdoor' : `${building_id}/${String(level)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A classroom door is a `door` node with a room name or number (§4.2). */
export function isClassroomDoor(node: NodeFeature): boolean {
  return node.properties.node_type === 'door' &&
    (node.properties.space_name !== undefined || node.properties.ref !== undefined);
}

function label(node: NodeFeature): string {
  return node.properties.space_name ?? node.properties.name ?? node.id;
}

function featureId(feature: unknown): string | null {
  if (typeof feature === 'object' && feature !== null && 'id' in feature && typeof feature.id === 'string') {
    return feature.id;
  }
  return null;
}

function reach(start: string, next: Map<string, string[]>): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const n of next.get(id) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}

/** Components of an undirected graph, each sorted by id. */
function connectedComponents(neighbours: Map<string, Set<string>>): string[][] {
  const next = new Map([...neighbours].map(([id, set]) => [id, [...set]]));
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const start of [...next.keys()].sort()) {
    if (seen.has(start)) continue;
    const component = [...reach(start, next)].sort();
    for (const id of component) seen.add(id);
    result.push(component);
  }
  return result;
}

function formatSchemaErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return '스키마에 맞지 않습니다.';
  // if/then wrappers only say "must match then schema"; the real causes are listed alongside.
  const useful = errors.filter((e) => e.keyword !== 'if');
  const parts = [...new Set(useful.map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim()))];
  return `스키마에 맞지 않습니다: ${parts.join('; ')}`;
}
