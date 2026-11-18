/**
 * 영속 고도 저장소(ElevationStore) 다루기 — 순수 함수만(파일·네트워크 없음).
 *
 * serializeElevationStore는 알려진 영속 필드만 골라 쓴다(화이트리스트). 버퍼의 휘발 관측(PressureAnchorObservation,
 * 절대 기압 포함)이 실수로 섞여 들어와도 파일에는 나가지 않는다.
 */
import type { AddResult } from './pressureSessionBuffer.ts';
import type { DhEdge, ElevationStore, HeightNode } from './types.ts';

export function emptyElevationStore(): ElevationStore {
  return { schemaVersion: 1, positionCrs: 'EPSG:4326', verticalDatum: 'KVD_INCHEON_MSL', nodes: [], sessions: [], edges: [] };
}

/**
 * 측정 하나를 저장소에 반영한 새 저장소: 노드를 넣거나 바꾸고(같은 key), 대체된 엣지는 qc='superseded',
 * 새 엣지는 뒤에 붙인다(같은 edgeId가 이미 있으면 건너뜀). 입력 저장소는 바꾸지 않는다.
 */
export function addMeasurement(store: ElevationStore, node: HeightNode, result: Pick<AddResult, 'newEdges' | 'supersede'>): ElevationStore {
  const nodes = store.nodes.some((n) => n.key === node.key)
    ? store.nodes.map((n) => (n.key === node.key ? node : n))
    : [...store.nodes, node];
  const superseded = new Set<string>(result.supersede);
  const known = new Set(store.edges.map((e) => e.edgeId));
  const edges: DhEdge[] = store.edges.map((e) => (superseded.has(e.edgeId) ? { ...e, qc: 'superseded' as const } : e));
  for (const e of result.newEdges) if (!known.has(e.edgeId)) edges.push(e);
  return { ...store, nodes, edges };
}

/**
 * The store without the measured height variable `key` (the surveyor deleted that spot): the node, every Δh edge at it
 * (superseded ones too), its estimate and anchor passes, and the profiles of the removed edges. `removed` lists the edges
 * taken out, so the variables at their other ends can be marked for a recompute. Unknown keys leave the store as it is.
 */
export function removeHeightNode(store: ElevationStore, key: string): { store: ElevationStore; removed: DhEdge[] } {
  const removed = store.edges.filter((e) => e.from === key || e.to === key);
  if (removed.length === 0 && !store.nodes.some((n) => n.key === key)) return { store, removed };
  const gone = new Set<string>(removed.map((e) => e.edgeId));
  const next: ElevationStore = {
    ...store,
    nodes: store.nodes.filter((n) => n.key !== key),
    edges: store.edges.filter((e) => !gone.has(e.edgeId)),
    ...(store.estimates ? { estimates: store.estimates.filter((x) => x.key !== key) } : {}),
    ...(store.anchorPasses ? { anchorPasses: store.anchorPasses.filter((x) => x.nodeKey !== key) } : {}),
    ...(store.profiles ? { profiles: store.profiles.filter((x) => !gone.has(x.edgeId)) } : {}),
  };
  return { store: next, removed };
}

/**
 * The store without the one Δh edge `edgeId` (a surveyor or editor user deleted that measurement). Both of its nodes stay:
 * they are measured spots in their own right. The edge's profiles go with it, and other edges stop listing it in
 * `supersedes` (an empty list is dropped). `removed` is the edge taken out (null when the id is unknown, and then the store
 * is returned as it was), so the caller can mark its two ends for a recompute.
 */
export function removeEdge(store: ElevationStore, edgeId: string): { store: ElevationStore; removed: DhEdge | null } {
  const removed = store.edges.find((e) => e.edgeId === edgeId) ?? null;
  if (!removed) return { store, removed };
  const edges = store.edges
    .filter((e) => e.edgeId !== edgeId)
    .map((e) => {
      if (!e.supersedes?.includes(removed.edgeId)) return e;
      const { supersedes: _old, ...rest } = e;
      const left = e.supersedes.filter((id) => id !== removed.edgeId);
      return left.length > 0 ? { ...rest, supersedes: left } : rest;
    });
  const next: ElevationStore = {
    ...store,
    edges,
    ...(store.profiles ? { profiles: store.profiles.filter((x) => x.edgeId !== edgeId) } : {}),
  };
  return { store: next, removed };
}

type Obj = Record<string, unknown>;

/** Only `keys`, in that order, leaving out undefined. Nested objects are picked by `nested`. */
function pick(value: unknown, keys: readonly string[], nested: Readonly<Record<string, readonly string[]>> = {}): Obj {
  const src = value as Obj;
  const out: Obj = {};
  for (const k of keys) {
    const v = src[k];
    if (v === undefined) continue;
    const inner = nested[k];
    out[k] = inner && typeof v === 'object' && v !== null && !Array.isArray(v) ? pick(v, inner) : v;
  }
  return out;
}

const LATLNG = ['lat', 'lng'];
const OUTDOOR_NODE = ['kind', 'key', 'position', 'influenceRadiusM', 'label', 'horizontalAccuracyM', 'createdAt'];
const FLOOR_NODE = ['kind', 'key', 'buildingId', 'floorId', 'label', 'createdAt'];
const SESSION = ['sessionId', 'mode', 'platform', 'deviceModel', 'installId', 'startedAt', 'endedAt', 'airTempC', 'routeId', 'appVersion'];
const EDGE = ['edgeId', 'from', 'to', 'dhM', 'sigmaM', 'dtS', 'offsetFromM', 'offsetToM', 'sessionId', 'method', 'qc', 'robustWeight',
  'supersedes', 'model', 'createdAt', 'profileId'];
/** σ-model parameters the edge was made with (not measurements). */
const EDGE_MODEL = ['tempC', 'sigmaInstFloorHpa', 'driftHpaPerHour'];
const BREAKLINE = ['id', 'coordinates', 'source', 'note', 'createdAt', 'lowSide', 'dropM'];
const PROFILE = ['profileId', 'edgeId', 'sM', 'relHM', 'sigmaM'];
const ANCHOR_PASS = ['sessionId', 'nodeKey', 'at', 'alongM', 'how'];
const PHOTO = ['photoId', 'sessionId', 'capturedAt', 'localUri', 'headingDeg', 'headingAccuracyDeg', 'alongM', 'decision', 'decidedAt'];
const PHOTO_ASSIGNMENT = ['photoId', 'routeId', 'segmentIndex', 'alongM', 'direction', 'confidence', 'nearestNodeKey', 'method'];
const ESTIMATE = ['key', 'hM', 'sigmaM', 'sigmaRelM', 'floating'];
const LAST_SOLVE = ['runId', 'solvedAt', 'nNodes', 'nEdges', 'chi2', 'dof', 'globalTestPassed', 'rejectedEdgeIds'];

/** The store as JSON text (2-space indent, trailing newline), with persisted fields only. */
export function serializeElevationStore(store: ElevationStore): string {
  const list = (items: readonly unknown[] | undefined, keys: readonly string[], nested: Readonly<Record<string, readonly string[]>> = {}) =>
    items?.map((x) => pick(x, keys, nested));
  const out: Obj = {
    schemaVersion: store.schemaVersion,
    positionCrs: store.positionCrs,
    verticalDatum: store.verticalDatum,
    nodes: store.nodes.map((n) => (n.kind === 'outdoor_point' ? pick(n, OUTDOOR_NODE, { position: LATLNG }) : pick(n, FLOOR_NODE))),
    sessions: list(store.sessions, SESSION),
    edges: list(store.edges, EDGE, { model: EDGE_MODEL }),
    breaklines: store.breaklines?.map((b) => ({ ...pick(b, BREAKLINE), coordinates: b.coordinates.map((c) => pick(c, LATLNG)) })),
    profiles: list(store.profiles, PROFILE),
    anchorPasses: list(store.anchorPasses, ANCHOR_PASS),
    photos: list(store.photos, PHOTO),
    photoAssignments: list(store.photoAssignments, PHOTO_ASSIGNMENT),
    estimates: list(store.estimates, ESTIMATE),
    lastSolve: store.lastSolve === undefined ? undefined : pick(store.lastSolve, LAST_SOLVE),
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}
