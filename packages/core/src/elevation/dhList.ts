/**
 * How a Δh edge is listed to a person (the survey app's 측정된 기압 sheet and the editor's 고도 Δh panel share these rules):
 * the live edges newest first, a node's name, and the height difference as "+2.4m" / "-1.1m". Pure; no clocks, no React.
 */
import type { DhEdge, ElevationStore, HeightNode, HeightNodeKey } from './types.ts';

/** The edges a person still sees: everything but the ones a later roundtrip superseded. Newest measurement first. */
export function liveDhEdges(store: ElevationStore): DhEdge[] {
  return store.edges.filter((e) => e.qc !== 'superseded').sort((a, b) => b.createdAt - a.createdAt);
}

/** "3F" → "3층", "B1" → "지하 1층"; anything else as it is. */
export function floorWord(floorId: string): string {
  const up = /^(\d+)F$/i.exec(floorId);
  if (up) return `${Number(up[1])}층`;
  const down = /^B(\d+)$/i.exec(floorId);
  if (down) return `지하 ${Number(down[1])}층`;
  return floorId;
}

/** The node's own label when it has one; else "3층" for a floor and "바깥 지점" for an outdoor point; "알 수 없는 지점" when the node is gone. */
export function heightNodeLabel(node: HeightNode | undefined): string {
  if (!node) return '알 수 없는 지점';
  const own = node.label?.trim();
  if (own) return own;
  return node.kind === 'floor_plane' ? floorWord(node.floorId) : '바깥 지점';
}

/** `from → to` of an edge in words, nodes looked up in the store. */
export function dhEdgeEnds(store: Pick<ElevationStore, 'nodes'>, edge: Pick<DhEdge, 'from' | 'to'>): { from: string; to: string } {
  const by = (key: HeightNodeKey) => store.nodes.find((n) => n.key === key);
  return { from: heightNodeLabel(by(edge.from)), to: heightNodeLabel(by(edge.to)) };
}

/** Height difference with its sign always shown and one decimal: "+2.4m", "-1.1m", "+0.0m" (never "-0.0m"). */
export function formatDhM(dhM: number): string {
  const r = Math.round(Math.abs(dhM) * 10) / 10;
  return `${dhM < 0 && r !== 0 ? '-' : '+'}${r.toFixed(1)}m`;
}
