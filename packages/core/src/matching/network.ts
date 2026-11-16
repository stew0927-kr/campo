// The walk network as the map matcher sees it (docs/MAP_MATCHING.md): every walk edge of a CampusGraph as a polyline
// in local metres, in typed arrays, with a 40 m grid index for candidate lookup, an undirected adjacency for bounded
// Dijkstra, and the portal list. Built once per graph; read-only afterwards except for the search scratch.
//
// The CampusGraph is only read. Connections come from its links (walk links, plus elevator hops as zero-plan-length
// connectors); floor numbers are copied per edge end only to filter candidates by MatchScope and to show the floor.
import { floorHeights } from '../buildingStack.ts';
import type { CampusGraph } from '../graph.ts';
import type { EdgeFeature, NodeType, Position } from '../types.ts';
import { createFrame, projectOnSegment, pointInRing, toX, toY, type LocalFrame } from './geo.ts';
import type { MatchScope, PortalRef } from './types.ts';

/** Edge flags (MatchNetwork.edgeFlags). */
export const EDGE_PORTAL = 1;
export const EDGE_STEPS = 2;
export const EDGE_ESCALATOR = 4;
/** Both ends inside buildings. */
export const EDGE_INDOOR = 8;
/** Candidate under the 'ground' scope. */
export const EDGE_GROUND = 16;

export interface MatchBuilding {
  id: string;
  /** Outer ring in local metres. */
  ringX: Float64Array;
  ringY: Float64Array;
  levels: number[];
  groundLevels: number[];
  /** Floor base height above the building's 1F floor, m (buildingStack's rule), for barometric floor matching. */
  levelBaseM: Map<number, number>;
}

export interface MatchNetwork {
  frame: LocalFrame;
  // Nodes.
  nodeIds: string[];
  nodeIndex: Map<string, number>;
  nodeX: Float64Array;
  nodeY: Float64Array;
  nodeType: NodeType[];
  /** Index into buildingIds, −1 outdoors. */
  nodeBuilding: Int32Array;
  /** Floor, NaN outdoors. */
  nodeLevel: Float64Array;
  // Walk edges (the candidates).
  edgeIds: string[];
  edgeIndex: Map<string, number>;
  edgeFrom: Int32Array;
  edgeTo: Int32Array;
  /** Polyline length in local metres. */
  edgeLen: Float64Array;
  edgeFlags: Uint8Array;
  /** Index into portals, −1 for other edges. */
  edgePortal: Int32Array;
  /** Vertices of edge e: vStart[e] up to vStart[e + 1] (exclusive); first = from node, last = to node. */
  vStart: Int32Array;
  vX: Float64Array;
  vY: Float64Array;
  /** Metres from the edge's from node to each vertex. */
  vCum: Float64Array;
  // Grid index of sub-segments (vertex index i: segment vX[i]..vX[i+1]).
  gridMinX: number;
  gridMinY: number;
  gridCell: number;
  gridCols: number;
  gridRows: number;
  cellStart: Int32Array;
  cellSeg: Int32Array;
  segEdge: Int32Array;
  // Undirected adjacency (CSR) over walk edges and elevator connectors.
  adjStart: Int32Array;
  adjNode: Int32Array;
  adjLen: Float64Array;
  portals: PortalRef[];
  portalEdge: Int32Array;
  buildingIds: string[];
  buildings: Map<string, MatchBuilding>;
  /** Mutable search scratch (single-threaded use). */
  scratch: SearchScratch;
}

interface SearchScratch {
  dist: Float64Array;
  stamp: Uint32Array;
  cur: number;
  heapNode: Int32Array;
  heapKey: Float64Array;
  srcEdge: number;
  srcT: number;
  // Candidate lookup.
  edgeStamp: Uint32Array;
  edgeCur: number;
  edgeBestD2: Float64Array;
  edgeBestAlong: Float64Array;
  touched: Int32Array;
  proj: Float64Array;
}

export interface BuildMatchNetworkOptions {
  /** Origin of the local frame. Default: the centre of the node bounding box. */
  origin?: Position;
  /** Grid cell size, m. Default 40. */
  cellM?: number;
}

/** Make the matcher's view of a routing graph. */
export function buildMatchNetwork(g: CampusGraph, options: BuildMatchNetworkOptions = {}): MatchNetwork {
  const nodeFeatures = [...g.nodes.values()];
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const n of nodeFeatures) {
    const [lng, lat] = n.geometry.coordinates;
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const origin: Position = options.origin ?? (nodeFeatures.length > 0 ? [(minLng + maxLng) / 2, (minLat + maxLat) / 2] : [0, 0]);
  const frame = createFrame(origin[0], origin[1]);

  // Buildings.
  const buildingIds = [...g.buildings.keys()];
  const buildingIndex = new Map(buildingIds.map((id, i) => [id, i]));
  const buildings = new Map<string, MatchBuilding>();
  for (const b of g.buildings.values()) {
    const ring = b.geometry.coordinates[0] ?? [];
    const heightOf = floorHeights({ props: b.properties });
    const levelBaseM = new Map<number, number>();
    for (const level of b.properties.levels) {
      let base = 0;
      if (level > 0) for (let l = 1; l < level; l++) base += heightOf(l).heightM;
      else for (let l = -1; l >= level; l--) base -= heightOf(l).heightM;
      levelBaseM.set(level, base);
    }
    buildings.set(b.id, {
      id: b.id,
      ringX: Float64Array.from(ring, (p) => toX(frame, p[0])),
      ringY: Float64Array.from(ring, (p) => toY(frame, p[1])),
      levels: [...b.properties.levels],
      groundLevels: [...(b.properties.ground_levels ?? [])],
      levelBaseM,
    });
  }

  // Nodes.
  const nNodes = nodeFeatures.length;
  const nodeIds = nodeFeatures.map((n) => n.id);
  const nodeIndex = new Map(nodeIds.map((id, i) => [id, i]));
  const nodeX = new Float64Array(nNodes);
  const nodeY = new Float64Array(nNodes);
  const nodeBuilding = new Int32Array(nNodes);
  const nodeLevel = new Float64Array(nNodes);
  const nodeType: NodeType[] = [];
  nodeFeatures.forEach((n, i) => {
    nodeX[i] = toX(frame, n.geometry.coordinates[0]);
    nodeY[i] = toY(frame, n.geometry.coordinates[1]);
    const b = n.properties.building_id;
    nodeBuilding[i] = b === null || b === undefined ? -1 : (buildingIndex.get(b) ?? -1);
    const lv = n.properties.level;
    nodeLevel[i] = typeof lv === 'number' && nodeBuilding[i]! >= 0 ? lv : Number.NaN;
    nodeType.push(n.properties.node_type);
  });

  // Walk edges (one per edge id) and elevator connectors.
  const walk: EdgeFeature[] = [];
  const connectors: [number, number][] = [];
  const seen = new Set<string>();
  g.graph.forEachLink((link) => {
    const d = link.data;
    if ((d.kind !== 'walk' && d.kind !== 'hop') || seen.has(d.edge.id)) return;
    seen.add(d.edge.id);
    const a = nodeIndex.get(d.edge.properties.from);
    const b = nodeIndex.get(d.edge.properties.to);
    if (a === undefined || b === undefined) return;
    if (d.kind === 'walk') walk.push(d.edge);
    else connectors.push([a, b]);
  });
  walk.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0)); // deterministic order

  const nEdges = walk.length;
  const edgeIds = walk.map((e) => e.id);
  const edgeIndex = new Map(edgeIds.map((id, i) => [id, i]));
  const edgeFrom = new Int32Array(nEdges);
  const edgeTo = new Int32Array(nEdges);
  const edgeLen = new Float64Array(nEdges);
  const edgeFlags = new Uint8Array(nEdges);
  const edgePortal = new Int32Array(nEdges).fill(-1);
  const vStart = new Int32Array(nEdges + 1);
  const vx: number[] = [];
  const vy: number[] = [];
  const vc: number[] = [];
  const portals: PortalRef[] = [];
  const portalEdge: number[] = [];

  const isGround = (node: number): boolean => {
    const bi = nodeBuilding[node]!;
    if (bi < 0) return true;
    const b = buildings.get(buildingIds[bi]!);
    return b !== undefined && b.groundLevels.includes(nodeLevel[node]!);
  };

  walk.forEach((edge, e) => {
    const a = nodeIndex.get(edge.properties.from)!;
    const b = nodeIndex.get(edge.properties.to)!;
    edgeFrom[e] = a;
    edgeTo[e] = b;
    vStart[e] = vx.length;
    // The line between its nodes: inner vertices from the drawn line (reversed if drawn to → from), ends at the nodes.
    let coords = edge.geometry.coordinates;
    if (coords.length >= 2) {
      const first = coords[0]!;
      const sq = (p: Position, n: number) => (toX(frame, p[0]) - nodeX[n]!) ** 2 + (toY(frame, p[1]) - nodeY[n]!) ** 2;
      if (sq(first, b) < sq(first, a)) coords = [...coords].reverse();
    }
    vx.push(nodeX[a]!);
    vy.push(nodeY[a]!);
    vc.push(0);
    for (let i = 1; i < coords.length - 1; i++) {
      const p = coords[i]!;
      vx.push(toX(frame, p[0]));
      vy.push(toY(frame, p[1]));
      vc.push(0);
    }
    vx.push(nodeX[b]!);
    vy.push(nodeY[b]!);
    vc.push(0);
    let cum = 0;
    for (let i = vStart[e]! + 1; i < vx.length; i++) {
      cum += Math.hypot(vx[i]! - vx[i - 1]!, vy[i]! - vy[i - 1]!);
      vc[i] = cum;
    }
    edgeLen[e] = cum;

    const p = edge.properties;
    let flags = 0;
    if (p.highway === 'steps') flags |= p.conveying !== undefined ? EDGE_ESCALATOR : EDGE_STEPS;
    if (nodeBuilding[a]! >= 0 && nodeBuilding[b]! >= 0) flags |= EDGE_INDOOR;
    if (isGround(a) && isGround(b)) flags |= EDGE_GROUND;
    if (p.edge_type === 'portal') {
      const outA = nodeBuilding[a]! < 0;
      const outB = nodeBuilding[b]! < 0;
      if (outA !== outB) {
        const inner = outA ? b : a;
        flags |= EDGE_PORTAL;
        edgePortal[e] = portals.length;
        portals.push({
          edgeId: edge.id,
          buildingId: buildingIds[nodeBuilding[inner]!]!,
          level: Number.isNaN(nodeLevel[inner]!) ? null : nodeLevel[inner]!,
          outdoorNode: nodeIds[outA ? a : b]!,
          indoorNode: nodeIds[inner]!,
        });
        portalEdge.push(e);
      }
    }
    edgeFlags[e] = flags;
  });
  vStart[nEdges] = vx.length;
  const vX = Float64Array.from(vx);
  const vY = Float64Array.from(vy);
  const vCum = Float64Array.from(vc);

  // Grid of sub-segments.
  const cell = options.cellM ?? 40;
  let gx0 = Infinity;
  let gy0 = Infinity;
  let gx1 = -Infinity;
  let gy1 = -Infinity;
  for (let i = 0; i < vX.length; i++) {
    gx0 = Math.min(gx0, vX[i]!);
    gy0 = Math.min(gy0, vY[i]!);
    gx1 = Math.max(gx1, vX[i]!);
    gy1 = Math.max(gy1, vY[i]!);
  }
  if (!Number.isFinite(gx0)) gx0 = gy0 = gx1 = gy1 = 0;
  const cols = Math.max(1, Math.floor((gx1 - gx0) / cell) + 1);
  const rows = Math.max(1, Math.floor((gy1 - gy0) / cell) + 1);
  const segs: number[] = [];
  const segEdgeList: number[] = [];
  for (let e = 0; e < nEdges; e++) {
    for (let i = vStart[e]!; i < vStart[e + 1]! - 1; i++) {
      segs.push(i);
      segEdgeList.push(e);
    }
  }
  const segEdge = Int32Array.from(segEdgeList);
  const cellOf = (x: number, y: number): [number, number] => [
    Math.min(cols - 1, Math.max(0, Math.floor((x - gx0) / cell))),
    Math.min(rows - 1, Math.max(0, Math.floor((y - gy0) / cell))),
  ];
  const counts = new Int32Array(cols * rows + 1);
  const eachCell = (s: number, fn: (c: number) => void) => {
    const i = segs[s]!;
    const [c0, r0] = cellOf(Math.min(vX[i]!, vX[i + 1]!), Math.min(vY[i]!, vY[i + 1]!));
    const [c1, r1] = cellOf(Math.max(vX[i]!, vX[i + 1]!), Math.max(vY[i]!, vY[i + 1]!));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * cols + c);
  };
  for (let s = 0; s < segs.length; s++) eachCell(s, (c) => { counts[c + 1]!++; });
  const cellStart = new Int32Array(cols * rows + 1);
  for (let c = 0; c < cols * rows; c++) cellStart[c + 1] = cellStart[c]! + counts[c + 1]!;
  const fill = cellStart.slice(0, cols * rows);
  const cellSeg = new Int32Array(cellStart[cols * rows]!);
  // cellSeg holds the segment's first vertex index; segEdge is looked up per segment slot via segSlot.
  const segSlotEdge = new Int32Array(cellSeg.length);
  for (let s = 0; s < segs.length; s++) {
    eachCell(s, (c) => {
      const k = fill[c]!++;
      cellSeg[k] = segs[s]!;
      segSlotEdge[k] = segEdge[s]!;
    });
  }

  // Adjacency (undirected; each walk edge and connector once each way).
  const deg = new Int32Array(nNodes + 1);
  const pairs: [number, number, number][] = [];
  for (let e = 0; e < nEdges; e++) pairs.push([edgeFrom[e]!, edgeTo[e]!, edgeLen[e]!]);
  for (const [a, b] of connectors) pairs.push([a, b, Math.hypot(nodeX[a]! - nodeX[b]!, nodeY[a]! - nodeY[b]!)]);
  for (const [a, b] of pairs) {
    deg[a + 1]!++;
    deg[b + 1]!++;
  }
  const adjStart = new Int32Array(nNodes + 1);
  for (let i = 0; i < nNodes; i++) adjStart[i + 1] = adjStart[i]! + deg[i + 1]!;
  const adjFill = adjStart.slice(0, nNodes);
  const adjNode = new Int32Array(adjStart[nNodes]!);
  const adjLen = new Float64Array(adjStart[nNodes]!);
  for (const [a, b, len] of pairs) {
    let k = adjFill[a]!++;
    adjNode[k] = b;
    adjLen[k] = len;
    k = adjFill[b]!++;
    adjNode[k] = a;
    adjLen[k] = len;
  }

  return {
    frame,
    nodeIds,
    nodeIndex,
    nodeX,
    nodeY,
    nodeType,
    nodeBuilding,
    nodeLevel,
    edgeIds,
    edgeIndex,
    edgeFrom,
    edgeTo,
    edgeLen,
    edgeFlags,
    edgePortal,
    vStart,
    vX,
    vY,
    vCum,
    gridMinX: gx0,
    gridMinY: gy0,
    gridCell: cell,
    gridCols: cols,
    gridRows: rows,
    cellStart,
    cellSeg,
    segEdge: segSlotEdge,
    adjStart,
    adjNode,
    adjLen,
    portals,
    portalEdge: Int32Array.from(portalEdge),
    buildingIds,
    buildings,
    scratch: {
      dist: new Float64Array(nNodes),
      stamp: new Uint32Array(nNodes),
      cur: 0,
      heapNode: new Int32Array(adjNode.length + 4),
      heapKey: new Float64Array(adjNode.length + 4),
      srcEdge: -1,
      srcT: 0,
      edgeStamp: new Uint32Array(nEdges),
      edgeCur: 0,
      edgeBestD2: new Float64Array(nEdges),
      edgeBestAlong: new Float64Array(nEdges),
      touched: new Int32Array(nEdges),
      proj: new Float64Array(4),
    },
  };
}

/** Fixed-size output of findCandidates, sorted by distance (nearest first). */
export interface CandidateSet {
  count: number;
  edge: Int32Array;
  t: Float64Array;
  x: Float64Array;
  y: Float64Array;
  /** Unit direction (east, north) of the edge line at the candidate, from → to. */
  dx: Float64Array;
  dy: Float64Array;
  dist: Float64Array;
}

export function createCandidateSet(max: number): CandidateSet {
  return {
    count: 0, edge: new Int32Array(max), t: new Float64Array(max), x: new Float64Array(max), y: new Float64Array(max),
    dx: new Float64Array(max), dy: new Float64Array(max), dist: new Float64Array(max),
  };
}

/** Whether edge e may be a candidate under `scope`; buildingIdx is the scope's building index (−2 when not found). */
function inScope(net: MatchNetwork, e: number, scope: MatchScope, buildingIdx: number): boolean {
  if (scope.kind === 'all') return true;
  if (scope.kind === 'ground') return (net.edgeFlags[e]! & EDGE_GROUND) !== 0;
  const a = net.edgeFrom[e]!;
  const b = net.edgeTo[e]!;
  return (net.nodeBuilding[a] === buildingIdx && net.nodeLevel[a] === scope.level) ||
    (net.nodeBuilding[b] === buildingIdx && net.nodeLevel[b] === scope.level);
}

/**
 * The nearest point of every in-scope walk edge within `radiusM` of (x, y), best `out.edge.length` edges kept, nearest
 * first. Returns the count (also in out.count).
 */
export function findCandidates(net: MatchNetwork, x: number, y: number, radiusM: number, scope: MatchScope, out: CandidateSet): number {
  const s = net.scratch;
  s.edgeCur = (s.edgeCur + 1) >>> 0;
  if (s.edgeCur === 0) {
    s.edgeStamp.fill(0);
    s.edgeCur = 1;
  }
  const stamp = s.edgeCur;
  const found = scope.kind === 'floor' ? net.buildingIds.indexOf(scope.buildingId) : -1;
  const buildingIdx = found >= 0 ? found : -2;
  const cell = net.gridCell;
  const c0 = Math.max(0, Math.floor((x - radiusM - net.gridMinX) / cell));
  const c1 = Math.min(net.gridCols - 1, Math.floor((x + radiusM - net.gridMinX) / cell));
  const r0 = Math.max(0, Math.floor((y - radiusM - net.gridMinY) / cell));
  const r1 = Math.min(net.gridRows - 1, Math.floor((y + radiusM - net.gridMinY) / cell));
  const r2 = radiusM * radiusM;
  const proj = s.proj;
  let nTouched = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cellIdx = r * net.gridCols + c;
      for (let k = net.cellStart[cellIdx]!; k < net.cellStart[cellIdx + 1]!; k++) {
        const e = net.segEdge[k]!;
        const i = net.cellSeg[k]!;
        if (s.edgeStamp[e] !== stamp) {
          if (!inScope(net, e, scope, buildingIdx)) continue;
          s.edgeStamp[e] = stamp;
          s.edgeBestD2[e] = Infinity;
          s.touched[nTouched++] = e;
        }
        projectOnSegment(x, y, net.vX[i]!, net.vY[i]!, net.vX[i + 1]!, net.vY[i + 1]!, proj);
        if (proj[0]! < s.edgeBestD2[e]!) {
          s.edgeBestD2[e] = proj[0]!;
          s.edgeBestAlong[e] = net.vCum[i]! + proj[1]! * (net.vCum[i + 1]! - net.vCum[i]!);
        }
      }
    }
  }
  // Keep the nearest max by insertion into the sorted output.
  const max = out.edge.length;
  let n = 0;
  for (let k = 0; k < nTouched; k++) {
    const e = s.touched[k]!;
    const d2 = s.edgeBestD2[e]!;
    if (d2 > r2) continue;
    const d = Math.sqrt(d2);
    if (n === max && d >= out.dist[n - 1]!) continue;
    let j = n < max ? n++ : n - 1;
    while (j > 0 && (out.dist[j - 1]! > d || (out.dist[j - 1] === d && out.edge[j - 1]! > e))) {
      out.dist[j] = out.dist[j - 1]!;
      out.edge[j] = out.edge[j - 1]!;
      out.t[j] = out.t[j - 1]!;
      j--;
    }
    const len = net.edgeLen[e]!;
    out.dist[j] = d;
    out.edge[j] = e;
    out.t[j] = len > 0 ? Math.min(1, Math.max(0, s.edgeBestAlong[e]! / len)) : 0;
  }
  for (let j = 0; j < n; j++) {
    positionAt(net, out.edge[j]!, out.t[j]!, proj);
    out.x[j] = proj[0]!;
    out.y[j] = proj[1]!;
    out.dx[j] = proj[2]!;
    out.dy[j] = proj[3]!;
  }
  out.count = n;
  return n;
}

/**
 * Local position of share t along edge e, written to out[0], out[1]; when out has room, the unit direction of the
 * edge line there (from → to) goes to out[2], out[3] (0, 0 for a zero-length edge).
 */
export function positionAt(net: MatchNetwork, e: number, t: number, out: Float64Array): void {
  const v0 = net.vStart[e]!;
  const v1 = net.vStart[e + 1]! - 1;
  const along = t * net.edgeLen[e]!;
  let i = v0;
  while (i < v1 - 1 && net.vCum[i + 1]! < along) i++;
  const seg = net.vCum[i + 1]! - net.vCum[i]!;
  const s = seg > 0 ? (along - net.vCum[i]!) / seg : 0;
  const vx = net.vX[i + 1]! - net.vX[i]!;
  const vy = net.vY[i + 1]! - net.vY[i]!;
  out[0] = net.vX[i]! + s * vx;
  out[1] = net.vY[i]! + s * vy;
  if (out.length >= 4) {
    out[2] = seg > 0 ? vx / seg : 0;
    out[3] = seg > 0 ? vy / seg : 0;
  }
}

/**
 * Bounded Dijkstra over the undirected network from share t of edge e: settles every node within limitM. Read the
 * results with routeDistance until the next search.
 */
export function searchFrom(net: MatchNetwork, e: number, t: number, limitM: number): void {
  const s = net.scratch;
  s.cur = (s.cur + 1) >>> 0;
  if (s.cur === 0) {
    s.stamp.fill(0);
    s.cur = 1;
  }
  const cur = s.cur;
  const dist = s.dist;
  const stamp = s.stamp;
  const hn = s.heapNode;
  const hk = s.heapKey;
  s.srcEdge = e;
  s.srcT = t;
  let size = 0;
  const push = (node: number, key: number) => {
    if (size >= hn.length) return; // cannot happen: each relaxation pushes at most once per adjacency entry
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p]! <= key) break;
      hn[i] = hn[p]!;
      hk[i] = hk[p]!;
      i = p;
    }
    hn[i] = node;
    hk[i] = key;
  };
  const relax = (node: number, d: number) => {
    if (d > limitM) return;
    if (stamp[node] === cur && dist[node]! <= d) return;
    stamp[node] = cur;
    dist[node] = d;
    push(node, d);
  };
  const len = net.edgeLen[e]!;
  relax(net.edgeFrom[e]!, t * len);
  relax(net.edgeTo[e]!, (1 - t) * len);
  while (size > 0) {
    const node = hn[0]!;
    const key = hk[0]!;
    // Pop.
    size--;
    if (size > 0) {
      const ln = hn[size]!;
      const lk = hk[size]!;
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= size) break;
        if (c + 1 < size && hk[c + 1]! < hk[c]!) c++;
        if (hk[c]! >= lk) break;
        hn[i] = hn[c]!;
        hk[i] = hk[c]!;
        i = c;
      }
      hn[i] = ln;
      hk[i] = lk;
    }
    if (key > dist[node]!) continue; // stale entry
    for (let k = net.adjStart[node]!; k < net.adjStart[node + 1]!; k++) relax(net.adjNode[k]!, key + net.adjLen[k]!);
  }
}

/** Undirected network distance from the last searchFrom source to share t of edge f; Infinity when beyond its limit. */
export function routeDistance(net: MatchNetwork, f: number, t: number): number {
  const s = net.scratch;
  const len = net.edgeLen[f]!;
  let d = Infinity;
  if (f === s.srcEdge) d = Math.abs(t - s.srcT) * len;
  const a = net.edgeFrom[f]!;
  const b = net.edgeTo[f]!;
  if (s.stamp[a] === s.cur) d = Math.min(d, s.dist[a]! + t * len);
  if (s.stamp[b] === s.cur) d = Math.min(d, s.dist[b]! + (1 - t) * len);
  return d;
}

/** Distance from (x, y) to the segment of portal p (outdoor node → indoor node), m. */
export function portalDistance(net: MatchNetwork, p: number, x: number, y: number): number {
  const e = net.portalEdge[p]!;
  const proj = net.scratch.proj;
  let best = Infinity;
  for (let i = net.vStart[e]!; i < net.vStart[e + 1]! - 1; i++) {
    projectOnSegment(x, y, net.vX[i]!, net.vY[i]!, net.vX[i + 1]!, net.vY[i + 1]!, proj);
    best = Math.min(best, proj[0]!);
  }
  return Math.sqrt(best);
}

/** The nearest portal to (x, y), optionally only those `accept` keeps; null when there is none. */
export function nearestPortal(net: MatchNetwork, x: number, y: number, accept?: (p: PortalRef) => boolean): { index: number; distM: number } | null {
  let best: { index: number; distM: number } | null = null;
  for (let p = 0; p < net.portals.length; p++) {
    if (accept && !accept(net.portals[p]!)) continue;
    const d = portalDistance(net, p, x, y);
    if (best === null || d < best.distM) best = { index: p, distM: d };
  }
  return best;
}

/** Whether local (x, y) lies inside the outline of building `buildingId`. */
export function isInsideBuilding(net: MatchNetwork, buildingId: string, x: number, y: number): boolean {
  const b = net.buildings.get(buildingId);
  return b !== undefined && b.ringX.length >= 3 && pointInRing(x, y, b.ringX, b.ringY);
}

/** Edge index of an edge id, −1 when the network has no such walk edge. */
export function edgeIndexOf(net: MatchNetwork, edgeId: string): number {
  return net.edgeIndex.get(edgeId) ?? -1;
}
