// 평지 위의 점에서 길망까지: 평지가 길과 닿는 접점, 구멍을 돌아가는 가시성 그래프, 접점까지의 최단 직선 경로.
// 맞닿거나 겹친 평지(이어진 평지, SPEC-v0.2 2.8)는 한 묶음으로 봅니다: 묶음의 고체 영역 합집합 안을 곧게 걸어 건너가고,
// 묶음의 어느 평지에 있는 접점이든 씁니다(평지 A → A·B 공유 경계 → 평지 B → B의 접점 → 길). 층 번호·높이는 읽지 않습니다.
import { PROFILES, WALK_SPEED_MPS, perProfile } from '../costs.ts';
import type { CampusGraph, PartialWalk, PlazaCrossing, PlazaLinkData, WalkLinkData } from '../graph.ts';
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
import { PLAZA_JOIN_TOL_M } from '../plaza/joins.ts';
import type { PlazaFeature, Position } from '../types.ts';

export const PLAZA_NODE_TOL_M = PLAZA_JOIN_TOL_M;
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
  /** segmentPlazas results, by segment. */
  segmentMemo?: Map<string, string[]>;
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
  // Only what comes near the plaza can meet it (a campus has many ways, a plaza few).
  let [bx0, by0, bx1, by1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (const [x, y] of r) {
    bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y);
  }
  [bx0, by0, bx1, by1] = [bx0 - PLAZA_NODE_TOL_M, by0 - PLAZA_NODE_TOL_M, bx1 + PLAZA_NODE_TOL_M, by1 + PLAZA_NODE_TOL_M];
  for (const [id, n] of g.nodes) {
    if (n.properties.building_id !== null) continue;
    const q = frame.toXY(n.geometry.coordinates);
    if (q[0] < bx0 || q[0] > bx1 || q[1] < by0 || q[1] > by1) continue;
    if (locateXY(rings, q, PLAZA_NODE_TOL_M) !== 'solid') continue;
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
    if (pts.every((p) => p[0] < bx0) || pts.every((p) => p[0] > bx1) || pts.every((p) => p[1] < by0) || pts.every((p) => p[1] > by1)) return;
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

/**
 * The plaza whose solid area holds `point` (boundary included), else one whose hole holds it, else null. A point up to
 * PLAZA_NODE_TOL_M outside a boundary (a corner snapped by the magnet and rounded) is on that plaza, like a contact node.
 * Deterministic: a plaza whose solid area holds the point exactly comes first, then one within the tolerance, by id.
 */
export function plazaAt(g: CampusGraph, point: Position): { plaza: PlazaFeature; hit: 'solid' | 'hole' } | null {
  let hole: PlazaFeature | null = null;
  let near: PlazaFeature | null = null;
  for (const id of [...g.plazas.keys()].sort()) {
    const d = dataOf(g, id)!;
    const rings = d.domains[d.ids.indexOf(id)]!;
    const p = d.frame.toXY(point);
    const where = locateXY(rings, p);
    if (where === 'solid') return { plaza: g.plazas.get(id)!, hit: 'solid' };
    if (!near && locateXY(rings, p, PLAZA_NODE_TOL_M) === 'solid') near = g.plazas.get(id)!;
    if (where === 'hole') hole ??= g.plazas.get(id)!;
  }
  if (near) return { plaza: near, hit: 'solid' };
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
  const pts = path.map((p) => d.frame.toXY(p));
  for (let i = 0; i + 1 < pts.length; i++) {
    for (const id of segmentPlazas(d, pts[i]!, pts[i + 1]!)) if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The plazas a straight walk from `a` to `b` is inside of, in the order it meets them (each once). Memoized per
 * cluster: the walks between contacts share their legs between the same bends.
 */
function segmentPlazas(d: ClusterData, a: XY, b: XY): string[] {
  const key = `${a[0]},${a[1]};${b[0]},${b[1]}`;
  const memo = (d.segmentMemo ??= new Map());
  const hit = memo.get(key);
  if (hit) return hit;
  const out: string[] = [];
  const ts = [0, 1];
  const [x0, x1, y0, y1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  for (const ring of d.domains.flat()) {
    for (let j = 0; j + 1 < ring.length; j++) {
      const [c, e] = [ring[j]!, ring[j + 1]!];
      if (Math.max(c[0], e[0]) < x0 || Math.min(c[0], e[0]) > x1 || Math.max(c[1], e[1]) < y0 || Math.min(c[1], e[1]) > y1) continue;
      for (const h of segmentIntersections(a, b, c, e)) ts.push(h.t);
    }
  }
  ts.sort((x, y) => x - y);
  for (let k = 0; k + 1 < ts.length; k++) {
    if (ts[k + 1]! - ts[k]! <= 1e-9) continue;
    const m = (ts[k]! + ts[k + 1]!) / 2;
    const p: XY = [a[0] + m * (b[0] - a[0]), a[1] + m * (b[1] - a[1])];
    d.domains.forEach((rings, n) => {
      const id = d.ids[n]!;
      if (!out.includes(id) && locateXY(rings, p, d.tolM) === 'solid' && ringDistance(p, rings) > d.tolM) out.push(id);
    });
  }
  memo.set(key, out);
  return out;
}

/**
 * Where a walk from `p` starts on the plaza `plazaId` of the cluster: `p` itself on its solid area, the nearest point of
 * its boundary when `p` is at most PLAZA_NODE_TOL_M outside (`stub` metres away), else null.
 */
function entryOf(d: ClusterData, plazaId: string, p: XY): { inner: XY; stub: number } | null {
  const k = d.ids.indexOf(plazaId);
  if (k < 0) return null;
  const rings = d.domains[k]!;
  if (locateXY(rings, p) === 'solid') return { inner: p, stub: 0 };
  if (locateXY(rings, p, PLAZA_NODE_TOL_M) !== 'solid') return null;
  const inner = closestOnRings(rings, p);
  return { inner, stub: hyp(inner, p) };
}

/**
 * Shortest straight walks from `p.point` to every contact it can reach, inside the plaza and the plazas linked to it, path
 * from the point to the contact (bends around holes and at the seams of linked plazas included).
 */
export function plazaGeodesics(g: CampusGraph, p: PlazaPoint): { contact: PlazaContact; geodesic: PlazaGeodesic }[] {
  const d = dataOf(g, p.plazaId);
  if (!d) return [];
  const entry = entryOf(d, p.plazaId, d.frame.toXY(p.point));
  if (!entry) return [];
  const { dist, prev } = shortest(d, entry.inner);
  const lead: Position[] = entry.stub > 0 ? [copy(p.point), d.frame.toPos(entry.inner[0], entry.inner[1])] : [copy(p.point)];
  const out: { contact: PlazaContact; geodesic: PlazaGeodesic }[] = [];
  d.vis.forEach((v, i) => {
    if (v.contact === undefined || dist[i] === Infinity) return;
    const contact = d.contacts[v.contact]!;
    const inner = d.contactXY[v.contact]!;
    const path = dedupe([...lead, ...pathTo(d, prev, i).map(copy)]);
    const stub = hyp(inner, d.frame.toXY(contact.at));
    if (stub > 0) path.push(copy(contact.at));
    out.push({ contact, geodesic: { lengthM: entry.stub + dist[i]! + stub, path, plazaIds: crossedPlazas(d, path, p.plazaId) } });
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
  const ea = entryOf(d, plazaId, d.frame.toXY(a));
  const eb = entryOf(d, toPlazaId, d.frame.toXY(b));
  if (!ea || !eb) return null;
  const { dist, prev } = shortest(d, ea.inner, [eb.inner]);
  const target = d.vis.length;
  if (dist[target] === Infinity) return null;
  const at = (q: XY): Position => d.frame.toPos(q[0], q[1]);
  const path = dedupe([
    copy(a), ...(ea.stub > 0 ? [at(ea.inner)] : []),
    ...pathTo(d, prev, target, [eb.stub > 0 ? at(eb.inner) : copy(b)]).map(copy),
    ...(eb.stub > 0 ? [copy(b)] : []),
  ]);
  return { lengthM: ea.stub + dist[target]! + eb.stub, path, plazaIds: crossedPlazas(d, path, plazaId) };
}

/** The path without a point equal to the one before it. */
function dedupe(path: Position[]): Position[] {
  const out: Position[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

// ---- 평지 전이: 평지에 닿는 길끼리 평지를 건너 잇는 링크 ----

/** One way into (or out of) a plaza at a contact: a campus node, and the stretch of edge between it and the contact. */
interface Way {
  nodeId: string;
  /** null at a node contact (the node is on the plaza). */
  walk: { data: WalkLinkData; partial: PartialWalk } | null;
  /** Into the plaza: node → contact. Out of it: contact → node. */
  line: Position[];
}

function walkLinkOf(g: CampusGraph, a: string, b: string, edgeId: string): WalkLinkData | null {
  for (const link of g.graph.getLinks(a) ?? []) {
    if (String(link.fromId) === a && String(link.toId) === b && link.data.kind === 'walk' && link.data.edge.id === edgeId) return link.data;
  }
  return null;
}

/** The edge's line cut at `at`, `along` of its length (measured on the cluster's plane, as plazaContactsOn does). */
function cutLine(d: ClusterData, coords: readonly Position[], along: number, at: Position): { head: Position[]; tail: Position[] } {
  const pts = coords.map((p) => d.frame.toXY(p));
  const seg = pts.slice(1).map((p, i) => hyp(pts[i]!, p));
  const goal = along * seg.reduce((s, x) => s + x, 0);
  let before = 0;
  let i = 0;
  while (i < seg.length - 1 && before + seg[i]! < goal) before += seg[i++]!;
  return { head: dedupe([...coords.slice(0, i + 1).map(copy), copy(at)]), tail: dedupe([copy(at), ...coords.slice(i + 1).map(copy)]) };
}

/** The ways in (`into`) or out of the plaza at contact `c`. A one-way edge gives only the ways it can be walked. */
function waysAt(g: CampusGraph, d: ClusterData, c: PlazaContact, into: boolean): Way[] {
  if (c.kind === 'node') return [{ nodeId: c.nodeId, walk: null, line: [copy(c.at)] }];
  let edge: WalkLinkData['edge'] | undefined;
  g.graph.forEachLink((l) => {
    if (!edge && l.data.kind === 'walk' && l.data.edge.id === c.edgeId) edge = l.data.edge;
  });
  if (!edge) return [];
  const { from, to } = edge.properties;
  const { head, tail } = cutLine(d, edge.geometry.coordinates, c.along, c.at);
  // [node the way starts or ends at, link from, link to, share of the link, line in travel direction]
  const options: [string, string, string, number, Position[]][] = into
    ? [[from, from, to, c.along, head], [to, to, from, 1 - c.along, [...tail].reverse()]]
    : [[to, from, to, 1 - c.along, tail], [from, to, from, c.along, [...head].reverse()]];
  const out: Way[] = [];
  for (const [nodeId, a, b, share, line] of options) {
    const data = walkLinkOf(g, a, b, c.edgeId);
    if (!data) continue;
    out.push({ nodeId, walk: { data, partial: { edge, from: a, to: b, share, gradePct: data.gradePct } }, line });
  }
  return out;
}

/** Dijkstra over the visibility pairs alone, from vis index `src`. */
function fromVis(d: ClusterData, src: number): { dist: number[]; prev: number[] } {
  const n = d.vis.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[src] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0) break;
    done[u] = true;
    for (const { to, w } of d.adj[u]!) {
      if (dist[u]! + w < dist[to]!) {
        dist[to] = dist[u]! + w;
        prev[to] = u;
      }
    }
  }
  return { dist, prev };
}

/** The plaza of the cluster a contact stands on (the first by id), for the order of crossed plazas. */
function plazaOfContact(d: ClusterData, i: number): string {
  const p = d.contactXY[i]!;
  return d.ids.find((_, k) => locateXY(d.domains[k]!, p, Math.max(d.tolM, PLAZA_NODE_TOL_M)) === 'solid') ?? d.ids[0]!;
}

function clusterLinks(g: CampusGraph, d: ClusterData): { from: string; to: string; data: PlazaLinkData }[] {
  const visOf = d.contacts.map((_, i) => d.vis.findIndex((v) => v.contact === i));
  const ins = d.contacts.map((c) => waysAt(g, d, c, true));
  const outs = d.contacts.map((c) => waysAt(g, d, c, false));
  // Per (from, to): the candidates, of which only those cheapest for some profile are kept.
  const byPair = new Map<string, { from: string; to: string; data: PlazaLinkData }[]>();
  d.contacts.forEach((ci, i) => {
    if (visOf[i]! < 0 || ins[i]!.length === 0) return;
    const { dist, prev } = fromVis(d, visOf[i]!);
    d.contacts.forEach((cj, j) => {
      if (i === j || dist[visOf[j]!] === Infinity || outs[j]!.length === 0) return;
      const stubIn = hyp(d.contactXY[i]!, d.frame.toXY(ci.at));
      const stubOut = hyp(d.contactXY[j]!, d.frame.toXY(cj.at));
      const lengthM = stubIn + dist[visOf[j]!]! + stubOut;
      const path = dedupe([copy(ci.at), ...pathTo(d, prev, visOf[j]!).map(copy), copy(cj.at)]);
      // Which plazas the walk crosses is only needed for a route that takes it (and for closures): worked out then.
      let ids: string[] | undefined;
      const idsOf = () => (ids ??= crossedPlazas(d, path, plazaOfContact(d, i)));
      const plazaT = lengthM / WALK_SPEED_MPS;
      const shut = d.ids.some((id) => g.closed.has(id)) && idsOf().some((id) => g.closed.has(id));
      for (const a of ins[i]!) {
        for (const b of outs[j]!) {
          if (a.nodeId === b.nodeId) continue;
          const walks = [a.walk, b.walk].filter((w): w is NonNullable<Way['walk']> => w !== null);
          let made: PlazaCrossing | undefined;
          const crossing = (): PlazaCrossing => (made ??= {
            plazaId: idsOf()[0]!, ...(idsOf().length > 1 ? { plazaIds: idsOf() } : {}),
            fromNodeId: a.nodeId, toNodeId: b.nodeId, path, lengthM,
            line: dedupe([...a.line, ...path, ...b.line]),
          });
          const data: PlazaLinkData = {
            kind: 'plaza', crossing,
            lengthM: lengthM + walks.reduce((s, w) => s + w.data.lengthM * w.partial.share, 0),
            partials: walks.map((w) => w.partial),
            timeSec: plazaT + walks.reduce((s, w) => s + w.data.timeSec * w.partial.share, 0),
            cost: perProfile((p) => plazaT + walks.reduce((s, w) => s + w.data.cost[p] * w.partial.share, 0)),
            blocked: perProfile((p) => shut || walks.some((w) => w.data.blocked[p])),
          };
          const key = `${a.nodeId}\u0000${b.nodeId}`;
          byPair.set(key, [...(byPair.get(key) ?? []), { from: a.nodeId, to: b.nodeId, data }]);
        }
      }
    });
  });
  const out: { from: string; to: string; data: PlazaLinkData }[] = [];
  for (const list of byPair.values()) {
    const keep = new Set<number>();
    for (const p of PROFILES) {
      let best = -1;
      list.forEach((c, k) => {
        if (!c.data.blocked[p] && (best < 0 || c.data.cost[p] < list[best]!.data.cost[p])) best = k;
      });
      if (best >= 0) keep.add(best);
    }
    // Blocked for every profile (a closed plaza): keep one, so the crossing is still there to be shown as closed.
    if (keep.size === 0) keep.add(0);
    for (const k of [...keep].sort((x, y) => x - y)) out.push(list[k]!);
  }
  return out;
}

/**
 * The links a plaza (or linked plazas) adds to the graph: between every way into it at one contact and every way out of
 * it at another, the shortest straight walk across it (around holes, over shared seams), as one node → node link. A
 * contact on an edge goes on to either end of that edge for its share of the edge's link. Campus nodes only. Flat
 * ground: every profile may cross, at cost = time = length / WALK_SPEED_MPS (the edge stretches cost what their links do).
 */
export function plazaTransferLinks(g: CampusGraph): { from: string; to: string; data: PlazaLinkData }[] {
  const out: { from: string; to: string; data: PlazaLinkData }[] = [];
  const done = new Set<ClusterData>();
  for (const id of [...g.plazas.keys()].sort()) {
    const d = dataOf(g, id);
    if (!d || done.has(d)) continue;
    done.add(d);
    out.push(...clusterLinks(g, d));
  }
  return out;
}
