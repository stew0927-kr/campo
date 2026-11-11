// Loaded campus <-> edit state (SPEC-v0.2 §4, 4.2 I2).
import type {
  BuildingFeature,
  CampoFeature,
  EdgeFeature,
  LoadedCampus,
  NodeFeature,
  RoomFeature,
} from '../types.ts';
import { isValidFeature } from '../validate.ts';
import { clone, emptyState, samePosition, sortedValues, type EditState } from './state.ts';

export interface LoadIssue {
  /** Path relative to the campus folder. */
  file: string;
  featureId: string | null;
  /** schema: failed the schema, left out. I1: edge end node missing, left out. I2: line end off its node, kept (the save puts it on the node). I3: id used twice, the later one left out. */
  code: 'schema' | 'I1' | 'I2' | 'I3';
  /** Korean. */
  message: string;
}

export interface FromCampusResult {
  state: EditState;
  issues: LoadIssue[];
}

/** Build the edit state from a loaded campus. Only schema-valid Features go in; the rest come back as issues. */
export function fromCampus(loaded: LoadedCampus): FromCampusResult {
  const state = emptyState();
  const issues: LoadIssue[] = [];
  const firstFile = new Map<string, string>();
  const edges: { file: string; feature: EdgeFeature }[] = [];

  for (const { file, feature } of loaded.features) {
    if (!isValidFeature(feature)) {
      const id = typeof (feature as { id?: unknown } | null)?.id === 'string' ? (feature as { id: string }).id : null;
      issues.push({ file, featureId: id, code: 'schema', message: '스키마에 맞지 않아 편집 상태에 넣지 않았습니다. npm run validate로 원인을 확인해 주세요.' });
      continue;
    }
    const f = clone(feature) as CampoFeature;
    const first = firstFile.get(f.id);
    if (first !== undefined) {
      issues.push({ file, featureId: f.id, code: 'I3', message: `id "${f.id}"가 겹칩니다(처음 나온 파일: ${first}). 뒤의 것은 편집 상태에 넣지 않았습니다.` });
      continue;
    }
    switch (f.properties.kind) {
      case 'building': {
        const b = f as BuildingFeature;
        if (b.properties.code in state.buildings) {
          issues.push({ file, featureId: b.id, code: 'I3', message: `건물 code "${b.properties.code}"가 겹칩니다. 뒤의 것은 편집 상태에 넣지 않았습니다.` });
          continue;
        }
        state.buildings[b.properties.code] = { id: b.id, polygon: b.geometry.coordinates, props: b.properties };
        break;
      }
      case 'node': {
        const n = f as NodeFeature;
        state.nodes[n.id] = { id: n.id, coord: n.geometry.coordinates, props: n.properties };
        break;
      }
      case 'room': {
        const r = f as RoomFeature;
        state.rooms[r.id] = { id: r.id, polygon: r.geometry.coordinates, props: r.properties };
        break;
      }
      case 'edge':
        edges.push({ file, feature: f as EdgeFeature });
        break;
    }
    firstFile.set(f.id, file);
  }

  for (const { file, feature: e } of edges) {
    const { from, to } = e.properties;
    const a = state.nodes[from];
    const b = state.nodes[to];
    if (!a || !b) {
      const gone = [!a ? from : null, !b ? to : null].filter((x) => x !== null).join(', ');
      issues.push({ file, featureId: e.id, code: 'I1', message: `없는 지점(${gone})을 가리켜 편집 상태에 넣지 않았습니다.` });
      continue;
    }
    const coords = e.geometry.coordinates;
    const start = coords[0]!;
    const end = coords[coords.length - 1]!;
    if (!samePosition(start, a.coord) || !samePosition(end, b.coord)) {
      issues.push({ file, featureId: e.id, code: 'I2', message: '선의 끝 좌표가 from / to 지점 좌표와 정확히 같지 않습니다. 저장하면 지점 좌표로 맞춥니다.' });
    }
    state.edges[e.id] = { id: e.id, vertices: coords.slice(1, -1), props: e.properties };
  }
  return { state, issues };
}

/** The state as saved Features: edges become full LineStrings with the node coordinates at both ends. */
export function toFeatures(state: EditState): CampoFeature[] {
  const out: CampoFeature[] = [];
  for (const b of sortedValues(state.buildings)) {
    out.push({ type: 'Feature', id: b.id, geometry: { type: 'Polygon', coordinates: clone(b.polygon) }, properties: clone(b.props) });
  }
  for (const n of sortedValues(state.nodes)) {
    out.push({ type: 'Feature', id: n.id, geometry: { type: 'Point', coordinates: [n.coord[0], n.coord[1]] }, properties: clone(n.props) });
  }
  for (const e of sortedValues(state.edges)) {
    const from = state.nodes[e.props.from];
    const to = state.nodes[e.props.to];
    if (!from || !to) throw new Error(`edge ${e.id} points at a missing node (I1)`);
    const coordinates = [from.coord, ...e.vertices, to.coord].map((p) => [p[0], p[1]] as [number, number]);
    out.push({ type: 'Feature', id: e.id, geometry: { type: 'LineString', coordinates }, properties: clone(e.props) });
  }
  for (const r of sortedValues(state.rooms)) {
    out.push({ type: 'Feature', id: r.id, geometry: { type: 'Polygon', coordinates: clone(r.polygon) }, properties: clone(r.props) });
  }
  return out;
}

/** `target` values of the loaded observations, for EditContext.observationTargets. */
export function observationTargetsOf(loaded: LoadedCampus): Set<string> {
  const out = new Set<string>();
  for (const { record } of loaded.observations ?? []) {
    const t = (record as { target?: unknown } | null)?.target;
    if (typeof t === 'string') out.add(t);
  }
  return out;
}

/** `feature_id` values of overrides.json, for EditContext.overrideIds. */
export function overrideIdsOf(loaded: LoadedCampus): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(loaded.overrides)) return out;
  for (const o of loaded.overrides as unknown[]) {
    const id = (o as { feature_id?: unknown } | null)?.feature_id;
    if (typeof id === 'string') out.add(id);
  }
  return out;
}
