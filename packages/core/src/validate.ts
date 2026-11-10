// Campus data checks (docs/SPEC.md §7).
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
  type Position,
  type ValidationIssue,
  type ValidationResult,
  type WarningCode,
} from './types.ts';
import { CAMPUS_META_FILE } from './load.ts';
import { isStepFreePassable } from './costs.ts';

/** Max distance (m) between an edge's line ends and its from/to nodes (§7 error 4). */
export const ENDPOINT_TOLERANCE_M = 1;

const ajv = new Ajv2020({ allErrors: true, strictTypes: false });
ajv.addSchema(schema);
const validateFeatureSchema = schemaFor<CampoFeature>('feature');
const validateMetaSchema = schemaFor<CampusMeta>('campus');

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

export function validateCampus(campus: LoadedCampus): ValidationResult {
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
  } else if (!validateMetaSchema(campus.meta)) {
    error(CAMPUS_META_FILE, null, E.schema, formatSchemaErrors(validateMetaSchema.errors));
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
    else edges.push(item as Located<EdgeFeature>);
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

  return { errors, warnings };
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
