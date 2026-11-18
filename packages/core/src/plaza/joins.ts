// 평지가 잇는 지점들: 평지(또는 맞닿거나 겹친 평지 묶음)는 그 위에 있거나 테두리에서 PLAZA_NODE_TOL_M 안의 바깥 지점, 그리고
// 그 테두리를 가로지르는 바깥 구간의 양 끝 지점을 서로 이어 줍니다(길찾기 routing/plaza.ts의 접점과 같은 규칙).
// 검사(validate W1·W2·W4)와 편집기의 끊긴 지점 찾기가 함께 씁니다. 층 번호·높이는 읽지 않습니다.
import type { Position } from '../types.ts';
import { localFrame, locateXY, normalizePlazaRings, plazaClusters, segmentIntersections, type XY } from './geometry.ts';

/** A node this close to a plaza's boundary (outside it too) stands on the plaza. Same as routing's PLAZA_NODE_TOL_M. */
export const PLAZA_JOIN_TOL_M = 0.3;

export interface JoinNode {
  id: string;
  coord: Position;
  /** Outdoors (no building). Only outdoor nodes stand on a plaza. */
  outdoor: boolean;
}

export interface JoinEdge {
  from: string;
  to: string;
  /** The edge's line, end to end. */
  line: readonly Position[];
}

type Box = [number, number, number, number];

function boxOf(lines: readonly (readonly XY[])[], pad = 0): Box {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const line of lines) for (const [x, y] of line) {
    b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
  }
  return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
}

const overlaps = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

function crossesRings(line: readonly XY[], domains: readonly XY[][][]): boolean {
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i]!, line[i + 1]!];
    const sb = boxOf([[a, b]]);
    for (const rings of domains) for (const ring of rings) {
      for (let j = 0; j + 1 < ring.length; j++) {
        const [c, d] = [ring[j]!, ring[j + 1]!];
        if (!overlaps(sb, boxOf([[c, d]]))) continue;
        if (segmentIntersections(a, b, c, d).length > 0) return true;
      }
    }
  }
  return false;
}

/**
 * The groups of nodes each plaza joins, per cluster of linked plazas (plazaClusters): outdoor nodes on its solid area or
 * within PLAZA_JOIN_TOL_M of its boundary, and both ends of every edge (pass only the walkable outdoor ones) whose line
 * crosses one of its rings. Each group in id order; groups of fewer than two nodes join nothing and are left out.
 * Plazas with unusable rings should be left out by the caller.
 */
export function plazaJoins(
  plazas: Iterable<{ id: string; polygon: Position[][] }>,
  nodes: Iterable<JoinNode>,
  edges: Iterable<JoinEdge>,
): string[][] {
  const list = [...plazas].filter((p) => (p.polygon[0]?.length ?? 0) >= 4);
  if (list.length === 0) return [];
  const frame = localFrame(list[0]!.polygon[0]![0]!);
  const byId = new Map(list.map((p) => [p.id, p]));
  const points = [...nodes].filter((n) => n.outdoor).map((n) => ({ id: n.id, xy: frame.toXY(n.coord) }));
  const lines = [...edges].flatMap((e) => {
    const line = e.line.map((p) => frame.toXY(p));
    return line.length < 2 ? [] : [{ e, line, box: boxOf([line]) }];
  });
  const out: string[][] = [];
  for (const ids of plazaClusters(list)) {
    const domains = ids.map((id) => normalizePlazaRings(byId.get(id)!.polygon).map((r) => r.map((q) => frame.toXY(q))));
    const box = boxOf(domains.flat(), PLAZA_JOIN_TOL_M);
    const members = new Set<string>();
    for (const n of points) {
      if (n.xy[0] < box[0] || n.xy[0] > box[2] || n.xy[1] < box[1] || n.xy[1] > box[3]) continue;
      if (domains.some((rings) => locateXY(rings, n.xy, PLAZA_JOIN_TOL_M) === 'solid')) members.add(n.id);
    }
    for (const { e, line, box: eb } of lines) {
      if (!overlaps(box, eb) || !crossesRings(line, domains)) continue;
      members.add(e.from);
      members.add(e.to);
    }
    if (members.size >= 2) out.push([...members].sort());
  }
  return out;
}
