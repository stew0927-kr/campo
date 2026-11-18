// 평지 위의 점에서 길망까지: 평지가 길과 닿는 접점, 구멍을 돌아가는 가시성 그래프, 접점까지의 최단 직선 경로.
import type { CampusGraph } from '../graph.ts';
import { framePlaza, locateXY, pointSegmentDistance, segmentInPlazaDomain, segmentIntersections, type FramedPlaza, type XY } from '../plaza/geometry.ts';
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
}

interface VisNode {
  xy: XY;
  pos: Position;
  contact?: number;
}

interface PlazaData {
  plaza: PlazaFeature;
  framed: FramedPlaza;
  contacts: PlazaContact[];
  /** 접점 i가 평지 영역 안에서 쓰는 점(테두리 밖 0.3 m 안의 지점은 테두리 위 가장 가까운 점). */
  contactXY: XY[];
  vis: VisNode[];
  /** vis 사이의 보이는 쌍과 길이. */
  adj: { to: number; w: number }[][];
}

const cache = new WeakMap<CampusGraph, Map<string, PlazaData>>();

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

function computeContacts(g: CampusGraph, framed: FramedPlaza): { contacts: PlazaContact[]; xy: XY[] } {
  const { frame, rings } = framed;
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
  const absorbed: { c: PlazaContact; xy: XY }[] = [];
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
              if (c) absorbed.push(c);
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

  const byNode = (a: { c: PlazaContact }, b: { c: PlazaContact }) => {
    const ka = a.c.kind === 'node' ? a.c.nodeId : `${a.c.edgeId}`;
    const kb = b.c.kind === 'node' ? b.c.nodeId : `${b.c.edgeId}`;
    if (ka !== kb) return ka < kb ? -1 : 1;
    return (a.c.kind === 'edge' ? a.c.along : 0) - (b.c.kind === 'edge' ? b.c.along : 0);
  };
  const ordered = [...[...nodeContacts, ...absorbed].sort(byNode), ...edgeContacts.sort(byNode)];
  const kept: { c: PlazaContact; xy: XY }[] = [];
  for (const item of ordered) {
    const dup = kept.some((k) =>
      (k.c.kind === 'node' && item.c.kind === 'node' && k.c.nodeId === item.c.nodeId) || hyp(k.xy, item.xy) <= PLAZA_CONTACT_MERGE_M);
    if (!dup) kept.push(item);
  }
  return { contacts: kept.map((k) => k.c), xy: kept.map((k) => k.xy) };
}

/** 영역을 왼쪽에 두고 돌 때 오른쪽으로 꺾이는 꼭짓점(바깥 링의 오목 꼭짓점, 구멍 링의 볼록 꼭짓점). */
function bendCandidates(framed: FramedPlaza): VisNode[] {
  const out: VisNode[] = [];
  framed.rings.forEach((ring, ri) => {
    const n = ring.length - 1;
    for (let i = 0; i < n; i++) {
      const prev = ring[(i - 1 + n) % n]!;
      const v = ring[i]!;
      const next = ring[(i + 1) % n]!;
      const turn = (v[0] - prev[0]) * (next[1] - v[1]) - (v[1] - prev[1]) * (next[0] - v[0]);
      if (turn < 0) out.push({ xy: v, pos: framed.positions[ri]![i]! });
    }
  });
  return out;
}

function dataOf(g: CampusGraph, plazaId: string): PlazaData | null {
  let byId = cache.get(g);
  if (!byId) cache.set(g, (byId = new Map()));
  const hit = byId.get(plazaId);
  if (hit) return hit;
  const plaza = g.plazas.get(plazaId);
  if (!plaza) return null;
  const framed = framePlaza(plaza.geometry.coordinates);
  const { contacts, xy } = computeContacts(g, framed);
  const vis: VisNode[] = [
    ...bendCandidates(framed),
    ...contacts.map((c, i): VisNode => {
      const inner = xy[i]!;
      const same = hyp(inner, framed.frame.toXY(c.at)) === 0;
      return { xy: inner, pos: same ? c.at : framed.frame.toPos(inner[0], inner[1]), contact: i };
    }),
  ];
  const adj: { to: number; w: number }[][] = vis.map(() => []);
  for (let i = 0; i < vis.length; i++) {
    for (let j = i + 1; j < vis.length; j++) {
      if (!segmentInPlazaDomain(framed.rings, vis[i]!.xy, vis[j]!.xy)) continue;
      const w = hyp(vis[i]!.xy, vis[j]!.xy);
      adj[i]!.push({ to: j, w });
      adj[j]!.push({ to: i, w });
    }
  }
  const data: PlazaData = { plaza, framed, contacts, contactXY: xy, vis, adj };
  byId.set(plazaId, data);
  return data;
}

/** The plaza whose solid area holds `point` (boundary included), else one whose hole holds it, else null. */
export function plazaAt(g: CampusGraph, point: Position): { plaza: PlazaFeature; hit: 'solid' | 'hole' } | null {
  let hole: PlazaFeature | null = null;
  for (const id of [...g.plazas.keys()].sort()) {
    const d = dataOf(g, id)!;
    const where = locateXY(d.framed.rings, d.framed.frame.toXY(point));
    if (where === 'solid') return { plaza: d.plaza, hit: 'solid' };
    if (where === 'hole') hole ??= d.plaza;
  }
  return hole ? { plaza: hole, hit: 'hole' } : null;
}

/** Where the plaza meets the network: outdoor nodes on it (within PLAZA_NODE_TOL_M of it) and walkable edges crossing its rings. */
export function plazaContacts(g: CampusGraph, plazaId: string): PlazaContact[] {
  return dataOf(g, plazaId)?.contacts ?? [];
}

/** Dijkstra from `start` over the visibility graph plus `extra` targets. Returns distance and previous per vis index. */
function shortest(d: PlazaData, start: XY, extra: XY[] = []): { dist: number[]; prev: number[]; startSees: boolean[] } {
  const n = d.vis.length + extra.length;
  const pointOf = (i: number): XY => (i < d.vis.length ? d.vis[i]!.xy : extra[i - d.vis.length]!);
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const startSees = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (segmentInPlazaDomain(d.framed.rings, start, pointOf(i))) {
      dist[i] = hyp(start, pointOf(i));
      startSees[i] = true;
    }
  }
  const extraAdj: { to: number; w: number }[][] = Array.from({ length: n }, () => []);
  for (let e = d.vis.length; e < n; e++) {
    for (let i = 0; i < d.vis.length; i++) {
      if (!segmentInPlazaDomain(d.framed.rings, pointOf(e), pointOf(i))) continue;
      const w = hyp(pointOf(e), pointOf(i));
      extraAdj[i]!.push({ to: e, w });
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
  return { dist, prev, startSees };
}

function pathTo(d: PlazaData, prev: number[], target: number, extraPos: Position[] = []): Position[] {
  const out: Position[] = [];
  for (let i = target; i >= 0; i = prev[i]!) out.push(i < d.vis.length ? d.vis[i]!.pos : extraPos[i - d.vis.length]!);
  return out.reverse();
}

const copy = (p: Position): Position => [p[0], p[1]];

/** Shortest straight walks inside the plaza from `p.point` to every contact it can reach, path from the point to the contact. */
export function plazaGeodesics(g: CampusGraph, p: PlazaPoint): { contact: PlazaContact; geodesic: PlazaGeodesic }[] {
  const d = dataOf(g, p.plazaId);
  if (!d) return [];
  const start = d.framed.frame.toXY(p.point);
  if (locateXY(d.framed.rings, start) !== 'solid') return [];
  const { dist, prev } = shortest(d, start);
  const out: { contact: PlazaContact; geodesic: PlazaGeodesic }[] = [];
  d.vis.forEach((v, i) => {
    if (v.contact === undefined || dist[i] === Infinity) return;
    const contact = d.contacts[v.contact]!;
    const inner = d.contactXY[v.contact]!;
    const path = [copy(p.point), ...pathTo(d, prev, i).map(copy)];
    const stub = hyp(inner, d.framed.frame.toXY(contact.at));
    if (stub > 0) path.push(copy(contact.at));
    out.push({ contact, geodesic: { lengthM: dist[i]! + stub, path } });
  });
  return out;
}

/** The shortest straight walk between two points of one plaza (both in its solid area), or null. */
export function plazaDistance(g: CampusGraph, plazaId: string, a: Position, b: Position): PlazaGeodesic | null {
  const d = dataOf(g, plazaId);
  if (!d) return null;
  const sa = d.framed.frame.toXY(a);
  const sb = d.framed.frame.toXY(b);
  if (locateXY(d.framed.rings, sa) !== 'solid' || locateXY(d.framed.rings, sb) !== 'solid') return null;
  const { dist, prev } = shortest(d, sa, [sb]);
  const target = d.vis.length;
  if (dist[target] === Infinity) return null;
  return { lengthM: dist[target]!, path: [copy(a), ...pathTo(d, prev, target, [b]).map(copy)] };
}
