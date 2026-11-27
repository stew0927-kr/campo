import type { Destination } from '../../state/model.ts';
import type { FestivalFlowGuide, FestivalGate, FestivalStall } from '../content/types.ts';
import { stallDestination } from '../content/destinations.ts';
export type StallFlow = 'enter' | 'queue' | 'exit';
export function flowDestination(stall: FestivalStall, flow: StallFlow, demo = true): Destination {
  const base = stallDestination(stall, demo);
  if (flow === 'enter') return { ...base, key: `${base.key}:enter`, name: `${stall.name} 입장`, fromNodeId: stall.entranceNodeId, flow };
  if (flow === 'exit') return { ...base, key: `${base.key}:exit`, name: `${stall.name} 퇴장`, nodeId: stall.exitNodeId, fromNodeId: stall.nodeId, flow };
  // A queue is not a crowd model: show the existing walkable route only when a real stall id exists.
  return { ...base, key: `${base.key}:queue`, name: `${stall.name} 대기 위치`, fromNodeId: null, flow };
}
export function hasFlowNodes(stall: FestivalStall, flow: StallFlow): boolean {
  return flow === 'enter' ? Boolean(stall.nodeId && stall.entranceNodeId) : flow === 'exit' ? Boolean(stall.nodeId && stall.exitNodeId) : Boolean(stall.nodeId);
}
/**
 * Route intent for a festival-wide flow (stage queue, gate entry, exit, evacuation). Uses real node ids only when the
 * guide has them; otherwise it opens the map's place search with the named place instead of inventing a pin.
 * Evacuation is shown as an exit route (the map has no separate evacuation mode).
 */
export function guideFlowDestination(flow: FestivalFlowGuide, demo = true): Destination {
  const searchTerm = flow.placeLabel ?? flow.title;
  const kind = flow.kind === 'evacuation' ? 'exit' : flow.kind;
  return { key: `festival-flow:${flow.id}`, name: flow.title, searchTerm, nodeId: flow.nodeId ?? null, kind: 'stage', demo,
    fromNodeId: kind === 'queue' ? null : flow.fromNodeId ?? null, flow: kind };
}
/** Route intent for a stage gate, searched by the building it stands next to. */
export function gateDestination(gate: FestivalGate, demo = true): Destination {
  return { key: `festival-gate:${gate.id}`, name: `${gate.zone ? `${gate.zone} ` : ''}${gate.label}`, searchTerm: gate.nearBy ?? gate.label, nodeId: gate.nodeId ?? null, kind: 'stage', demo };
}
