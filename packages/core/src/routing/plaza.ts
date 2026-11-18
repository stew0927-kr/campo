// 평지 위의 점에서 길망까지: 평지가 길과 닿는 접점, 구멍을 돌아가는 가시성 그래프, 접점까지의 최단 직선 경로.
// 맞닿거나 겹친 평지(이어진 평지, SPEC-v0.2 2.8)는 한 묶음으로 봅니다: 묶음의 고체 영역 합집합 안을 곧게 걸어 건너가고,
// 묶음의 어느 평지에 있는 접점이든 씁니다(평지 A → A·B 공유 경계 → 평지 B → B의 접점 → 길). 층 번호·높이는 읽지 않습니다.
import type { CampusGraph } from '../graph.ts';
import {
  PLAZA_EPS_M,
  PLAZA_LINK_TOL_M,
  locateXY,
  localFrame,
  normalizePlazaRings,
  plazaClusters,
  pointSegmentDistance,
  segmentInPlazasDomain,
  segmentIntersections,
  solidInAny,
  type LocalFrame,
  type XY,
} from '../plaza/geometry.ts';
import type { PlazaFeature, Position } from '../types.ts';

export const PLAZA_NODE_TOL_M = 0.3;
export const PLAZA_CONTACT_MERGE_M = 0.05;

export interface PlazaPoint {
  plazaId: string;
  point: Position;
}

export type PlazaContact =
  | { kind: 'node'; nodeId: string; at: Position }
  | { kind: 'edge'; edgeId: string; at: Position; along: number };

export interface PlazaGeodesic {
  lengthM: number;
  path: Position[];
  /** The plazas the walk crosses, in the order it enters them (the start plaza first). Linked plazas only. */
  plazaIds: string[];
}

interface VisNode {
  xy: XY;
  pos: Position;
  contact?: number;
}

/** One plaza, or several linked plazas walked as one area, on one local plane. */
interface ClusterData {
  /** Plaza ids of the cluster, in id order. */
  ids: string[];
  plazas: PlazaFeature[];
  frame: LocalFrame;
  /** Rings per plaza (outer CCW, holes CW, closed), same order as ids. */
  domains: XY[][][];
  /** Tolerance of the solid test: PLAZA_EPS_M for a lone plaza, PLAZA_LINK_TOL_M across linked ones (a touching seam). */
  tolM: number;
  contacts: PlazaContact[];
  /** 접점 i가 평지 영역 안에서 쓰는 점(테두리 밖 0.3 m 안의 지점은 테두리 위 가장 가까운 점). */
  contactXY: XY[];
  vis: VisNode[];
  /** vis 사이의 보이는 쌍과 길이. */
  adj: { to: number; w: number }[][];
}

interface GraphPlazas {
  /** plaza id → its cluster (shared by every plaza of the cluster). */
  byPlaza: Map<string, ClusterData | null>;
  /** plaza id → the ids of its cluster, in id order. */
  groups: Map<string, string[]>;
}

/**
 * Per graph. A CampusGraph is never changed after buildGraph (an edit builds a new graph), so contacts and visibility
 * pairs computed for one graph stay right for it, and a graph built after an edit starts from nothing.
 */
const cache = new WeakMap<CampusGraph, GraphPlazas>();

const hyp = (a: XY, b: XY): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

function closestOnRings(rings: readonly XY[][], p: XY): XY {
  let best: XY = p;
  let bestD = Infinity;
  for (const r of rings) {
    for (let i = 0; i + 1 < r.length; i++) {
      const a = r[i]!;
      const b = r[i + 1]!;
      const d = pointSegmentDistance(p, a, b);
      if (d < bestD) {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
        best = [a[0] + t * dx, a[1] + t * dy];
        bestD = d;
      }
    }
  }
  return best;
}

/** Where one plaza (its rings on the cluster's plane) meets the network. Same rules as for a lone plaza (SPEC-v0.2 2.8). */
function plazaContactsOn(g: CampusGraph, frame: LocalFrame, rings: XY[][]): { node: { c: PlazaContact; xy: XY }[]; edge: { c: PlazaContact; xy: XY }[] } {
  const nodeContacts: { c: PlazaContact; xy: XY }[] = [];
  const asNode = (nodeId: string): { c: PlazaContact; xy: XY } | null => {
    const n = g.nodes.get(nodeId);
    if (!n || !g.graph.hasNode(nodeId)) return null;
    const at: Position = [n.geometry.coordinates[0], n.geometry.coordinates[1]];
    const p = frame.toXY(at);
    const inside = locateXY(rings, p) === 'solid';
    return { c: { kind: 'node', nodeId, at }, xy: inside ? p : closestOnRings(rings, p) };
  };
  for (const [id, n] of g.nodes) {
    if (n.properties.building_id !== null) continue;
    if (locateXY(rings, frame.toXY(n.geometry.coordinates), PLAZA_NODE_TOL_M) !== 'solid') continue;
    const c = asNode(id);
    if (c) nodeContacts.push(c);
  }

  const edgeContacts: { c: PlazaContact; xy: XY }[] = [];
  const seen = new Set<string>();
  g.graph.forEachLink((link) => {
    const data = link.data;
    if (data.kind !== 'walk' || seen.has(data.edge.id)) return;
    seen.add(data.edge.id);
    const edge = data.edge;
    if (edge.properties.edge_type === 'indoor') return;
    const pts = edge.geometry.coordinates.map((p) => frame.toXY(p));
    if (pts.length < 2) return;
    const seg = pts.slice(1).map((p, i) => hyp(pts[i]!, p));
    const total = seg.reduce((s, x) => s + x, 0);
    const fromXY = g.nodes.get(edge.properties.from) ? frame.toXY(g.nodes.get(edge.properties.from)!.geometry.coordinates) : pts[0]!;
    const toXY = g.nodes.get(edge.properties.to) ? frame.toXY(g.nodes.get(edge.properties.to)!.geometry.coordinates) : pts[pts.length - 1]!;
    let before = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      for (const ring of rings) {
        for (let j = 0; j + 1 < ring.length; j++) {
          for (const hit of segmentIntersections(pts[i]!, pts[i + 1]!, ring[j]!, ring[j + 1]!)) {
            const at = hit.at;
            const end = hyp(at, fromXY) <= PLAZA_NODE_TOL_M ? edge.properties.from : hyp(at, toXY) <= PLAZA_NODE_TOL_M ? edge.properties.to : null;
            if (end !== null) {
              const c = asNode(end);
              if (c) nodeContacts.push(c);
              continue;
            }
            const along = total > 0 ? Math.min(1, Math.max(0, (before + hit.t * seg[i]!) / total)) : 0;
            edgeContacts.push({ c: { kind: 'edge', edgeId: edge.id, at: frame.toPos(at[0], at[1]), along }, xy: at });
          }
        }
      }
      before += seg[i]!;
    }
  });
  return { node: nodeContacts, edge: edgeContacts };
}

/** Every contact of the cluster's plazas, without repeats (a node on two plazas, a seam crossed by one edge). */
function computeContacts(g: CampusGraph, frame: LocalFrame, domains: XY[][][]): { contacts: PlazaContact[]; xy: XY[] } {
  const nodeContacts: { c: PlazaContact; xy: XY }[] = [];
  const edgeContacts: { c: PlazaContact; xy: XY }[] = [];
  for (const rings of domains) {
    const got = plazaContactsOn(g, frame, rings);
    nodeContacts.push(...got.node);
    edgeContacts.push(...got.edge);
  }
  const key = (c: PlazaContact) => (c.kind === 'node' ? c.nodeId : c.edgeId);
  const byNode = (a: { c: PlazaContact }, b: { c: PlazaContact }) => {
    const [ka, kb] = [key(a.c), key(b.c)];
    if (ka !== kb) return ka < kb ? -1 : 1;
    return (a.c.kind === 'edge' ? a.c.along : 0) - (b.c.kind === 'edge' ? b.c.along : 0);
  };
  const ordered = [...nodeContacts.sort(byNode), ...edgeContacts.sort(byNode)];
  const kept: { c: PlazaContact; xy: XY }[] = [];
  for (const item of ordered) {
    const dup = kept.some((k) =>
      (k.c.kind === 'node' && item.c.kind === 'node' && k.c.nodeId === item.c.nodeId) || hyp(k.xy, item.xy) <= PLAZA_CONTACT_MERGE_M);
    if (!dup) kept.push(item);
  }
  return { contacts: kept.map((k) => k.c), xy: kept.map((k) => k.xy) };
}

/** 영역을 왼쪽에 두고 돌 때 오른쪽으로 꺾이는 꼭짓점(바깥 링의 오목 꼭짓점, 구멍 링의 볼록 꼭짓점). */
function isReflex(ring: XY[], i: number): boolean {
  const n = ring.length - 1;
  const prev = ring[(i - 1 + n) % n]!;
  const v = ring[i]!;
  const next = ring[(i + 1) % n]!;
  return (v[0] - prev[0]) * (next[1] - v[1]) - (v[1] - prev[1]) * (next[0] - v[0]) < 0;
}

function ringDistance(p: XY, rings: readonly XY[][]): number {
  let best = Infinity;
  for (const r of rings) for (let i = 0; i + 1 < r.length; i++) best = Math.min(best, pointSegmentDistance(p, r[i]!, r[i + 1]!));
  return best;
}

/**
 * Where a shortest walk across the cluster may bend. A lone plaza: its reflex corners. Linked plazas: the union's boundary
 * can bend at a reflex corner of one plaza (not buried inside another), at any corner that lies on another plaza's edge
 * (a shared corner, a corner on a shared side), and where the edges of two plazas cross (an overlap).
 */
function bendCandidates(c: Pick<ClusterData, 'domains' | 'frame' | 'tolM'>): VisNode[] {
  const out: VisNode[] = [];
  const { domains, frame } = c;
  const lone = domains.length === 1;
  domains.forEach((rings, k) => {
    const others = domains.filter((_, j) => j !== k);
    rings.forEach((ring) => {
      for (let i = 0; i + 1 < ring.length; i++) {
        const v = ring[i]!;
        const onOther = !lone && others.some((o) => ringDistance(v, o) <= c.tolM);
        const buried = !lone && !onOther && solidInAny(others, v, 0);
        if ((isReflex(ring, i) && !buried) || onOther) out.push({ xy: v, pos: frame.toPos(v[0], v[1]) });
      }
    });
  });
  if (!lone) {
    for (let a = 0; a < domains.length; a++) {
      for (let b = a + 1; b < domains.length; b++) {
        for (const ra of domains[a]!) for (const rb of domains[b]!) {
          for (let i = 0; i + 1 < ra.length; i++) for (let j = 0; j + 1 < rb.length; j++) {
            for (const hit of segmentIntersections(ra[i]!, ra[i + 1]!, rb[j]!, rb[j + 1]!)) out.push({ xy: hit.at, pos: frame.toPos(hit.at[0], hit.at[1]) });
          }
        }
      }
    }
  }
  // Corners met twice (a shared corner, a crossing on a corner) are one bend.
  const kept: VisNode[] = [];
  for (const v of out) if (!kept.some((k) => hyp(k.xy, v.xy) <= PLAZA_EPS_M)) kept.push(v);
  return kept;
}

function plazasOf(g: CampusGraph): GraphPlazas {
  let hit = cache.get(g);
  if (hit) return hit;
  const groups = new Map<string, string[]>();
  for (const group of plazaClusters([...g.plazas.values()].map((p) => ({ id: p.id, polygon: p.geometry.coordinates })))) {
    for (const id of group) groups.set(id, group);
  }
  hit = { byPlaza: new Map(), groups };
  cache.set(g, hit);
  return hit;
}

/** The ids of the plazas linked to `plazaId` (itself included), in id order. Empty for an unknown plaza. */
export function linkedPlazas(g: CampusGraph, plazaId: string): string[] {
  return plazasOf(g).groups.get(plazaId) ?? [];
}

function dataOf(g: CampusGraph, plazaId: string): ClusterData | null {
  const all = plazasOf(g);
  if (all.byPlaza.has(plazaId)) return all.byPlaza.get(plazaId)!;
  const ids = all.groups.get(plazaId);
  if (!ids) return null;
  const plazas = ids.map((id) => g.plazas.get(id)!);
  const normalized = plazas.map((p) => normalizePlazaRings(p.geometry.coordinates));
  const frame = localFrame(normalized[0]![0]![0]!);
  const domains = normalized.map((rings) => rings.map((r) => r.map(frame.toXY)));
  const tolM = ids.length > 1 ? PLAZA_LINK_TOL_M : PLAZA_EPS_M;
  const { contacts, xy } = computeContacts(g, frame, domains);
  const vis: VisNode[] = [
    ...bendCandidates({ domains, frame, tolM }),
    ...contacts.map((c, i): VisNode => {
      const inner = xy[i]!;
      const same = hyp(inner, frame.toXY(c.at)) === 0;
      return { xy: inner, pos: same ? c.at : frame.toPos(inner[0], inner[1]), contact: i };
    }),
  ];
  const adj: { to: number; w: number }[][] = vis.map(() => []);
  for (let i = 0; i < vis.length; i++) {
    for (let j = i + 1; j < vis.length; j++) {
      if (!segmentInPlazasDomain(domains, vis[i]!.xy, vis[j]!.xy, tolM)) continue;
      const w = hyp(vis[i]!.xy, vis[j]!.xy);
      adj[i]!.push({ to: j, w });
      adj[j]!.push({ to: i, w });
    }
  }
  const data: ClusterData = { ids, plazas, frame, domains, tolM, contacts, contactXY: xy, vis, adj };
  for (const id of ids) all.byPlaza.set(id, data);
  return data;
}

/** The plaza whose solid area holds `point` (boundary included), else one whose hole holds it, else null. */
export function plazaAt(g: CampusGraph, point: Position): { plaza: PlazaFeature; hit: 'solid' | 'hole' } | null {
  let hole: PlazaFeature | null = null;
  for (const id of [...g.plazas.keys()].sort()) {
    const d = dataOf(g, id)!;
    const where = locateXY(d.domains[d.ids.indexOf(id)]!, d.frame.toXY(point));
    if (where === 'solid') return { plaza: g.plazas.get(id)!, hit: 'solid' };
    if (where === 'hole') hole ??= g.plazas.get(id)!;
  }
  // A point in one plaza's hole that another plaza covers is on that plaza (found above); only an uncovered hole is a hole.
  return hole ? { plaza: hole, hit: 'hole' } : null;
}

/**
 * Where the plaza meets the network: outdoor nodes on it (within PLAZA_NODE_TOL_M of it) and walkable edges crossing its
 * rings — its own and those of every plaza linked to it (touching or overlapping), since the walk crosses into them.
 */
export function plazaContacts(g: CampusGraph, plazaId: string): PlazaContact[] {
  return dataOf(g, plazaId)?.contacts ?? [];
}

/** Dijkstra from `start` over the visibility graph plus `extra` targets. Returns distance and previous per vis index. */
function shortest(d: ClusterData, start: XY, extra: XY[] = []): { dist: number[]; prev: number[] } {
  const n = d.vis.length + extra.length;
  const pointOf = (i: number): XY => (i < d.vis.length ? d.vis[i]!.xy : extra[i - d.vis.length]!);
  const sees = (a: XY, b: XY) => segmentInPlazasDomain(d.domains, a, b, d.tolM);
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) if (sees(start, pointOf(i))) dist[i] = hyp(start, pointOf(i));
  const extraAdj: { to: number; w: number }[][] = Array.from({ length: n }, () => []);
  for (let e = d.vis.length; e < n; e++) {
    for (let i = 0; i < d.vis.length; i++) {
      if (!sees(pointOf(e), pointOf(i))) continue;
      extraAdj[i]!.push({ to: e, w: hyp(pointOf(e), pointOf(i)) });
    }
  }
  const done = new Array<boolean>(n).fill(false);
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0) break;
    done[u] = true;
    const out = [...(u < d.vis.length ? d.adj[u]! : []), ...extraAdj[u]!];
    for (const { to, w } of out) {
      if (dist[u]! + w < dist[to]!) {
        dist[to] = dist[u]! + w;
        prev[to] = u;
      }
    }
  }
  return { dist, prev };
}

function pathTo(d: ClusterData, prev: number[], target: number, extraPos: Position[] = []): Position[] {
  const out: Position[] = [];
  for (let i = target; i >= 0; i = prev[i]!) out.push(i < d.vis.length ? d.vis[i]!.pos : extraPos[i - d.vis.length]!);
  return out.reverse();
}

const copy = (p: Position): Position => [p[0], p[1]];

/** The plazas a walk along `path` crosses, in the order it enters them; `first` (the plaza it starts on) leads. */
function crossedPlazas(d: ClusterData, path: Position[], first: string): string[] {
  const out = [first];
  if (d.ids.length === 1) return out;
  const add = (p: XY) => {
    d.domains.forEach((rings, k) => {
      const id = d.ids[k]!;
      if (!out.includes(id) && locateXY(rings, p, d.tolM) === 'solid' && ringDistance(p, rings) > d.tolM) out.push(id);
    });
  };
  const pts = path.map((p) => d.frame.toXY(p));
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i]!, pts[i + 1]!];
    const ts = [0, 1];
    for (const ring of d.domains.flat()) for (let j = 0; j + 1 < ring.length; j++) for (const hit of segmentIntersections(a, b, ring[j]!, ring[j + 1]!)) ts.push(hit.t);
    ts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      if (ts[k + 1]! - ts[k]! <= 1e-9) continue;
      const m = (ts[k]! + ts[k + 1]!) / 2;
      add([a[0] + m * (b[0] - a[0]), a[1] + m * (b[1] - a[1])]);
    }
  }
  return out;
}

/** Whether `point` is on the solid area of the plaza `plazaId` of the cluster. */
function onPlaza(d: ClusterData, plazaId: string, p: XY): boolean {
  const k = d.ids.indexOf(plazaId);
  return k >= 0 && locateXY(d.domains[k]!, p) === 'solid';
}

/**
 * Shortest straight walks from `p.point` to every contact it can reach, inside the plaza and the plazas linked to it, path
 * from the point to the contact (bends around holes and at the seams of linked plazas included).
 */
export function plazaGeodesics(g: CampusGraph, p: PlazaPoint): { contact: PlazaContact; geodesic: PlazaGeodesic }[] {
  const d = dataOf(g, p.plazaId);
  if (!d) return [];
  const start = d.frame.toXY(p.point);
  if (!onPlaza(d, p.plazaId, start)) return [];
  const { dist, prev } = shortest(d, start);
  const out: { contact: PlazaContact; geodesic: PlazaGeodesic }[] = [];
  d.vis.forEach((v, i) => {
    if (v.contact === undefined || dist[i] === Infinity) return;
    const contact = d.contacts[v.contact]!;
    const inner = d.contactXY[v.contact]!;
    const path = [copy(p.point), ...pathTo(d, prev, i).map(copy)];
    const stub = hyp(inner, d.frame.toXY(contact.at));
    if (stub > 0) path.push(copy(contact.at));
    out.push({ contact, geodesic: { lengthM: dist[i]! + stub, path, plazaIds: crossedPlazas(d, path, p.plazaId) } });
  });
  return out;
}

/**
 * The shortest straight walk between two points of one plaza, or of two linked plazas (`a` on `plazaId`, `b` on `toPlazaId`,
 * default the same plaza), or null when they are not linked or a point is off its plaza.
 */
export function plazaDistance(g: CampusGraph, plazaId: string, a: Position, b: Position, toPlazaId: string = plazaId): PlazaGeodesic | null {
  const d = dataOf(g, plazaId);
  if (!d || !d.ids.includes(toPlazaId)) return null;
  const sa = d.frame.toXY(a);
  const sb = d.frame.toXY(b);
  if (!onPlaza(d, plazaId, sa) || !onPlaza(d, toPlazaId, sb)) return null;
  const { dist, prev } = shortest(d, sa, [sb]);
  const target = d.vis.length;
  if (dist[target] === Infinity) return null;
  const path = [copy(a), ...pathTo(d, prev, target, [b]).map(copy)];
  return { lengthM: dist[target]!, path, plazaIds: crossedPlazas(d, path, plazaId) };
}
