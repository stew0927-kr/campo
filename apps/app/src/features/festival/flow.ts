import type { Destination } from '../../state/model.ts';
import type { FestivalStall } from '../content/types.ts';
import { stallDestination } from '../content/destinations.ts';
export type StallFlow = 'enter' | 'queue' | 'exit';
export function flowDestination(stall: FestivalStall, flow: StallFlow): Destination {
  const base = stallDestination(stall);
  if (flow === 'enter') return { ...base, key: `${base.key}:enter`, name: `${stall.name} 입장`, fromNodeId: stall.entranceNodeId, flow };
  if (flow === 'exit') return { ...base, key: `${base.key}:exit`, name: `${stall.name} 퇴장`, nodeId: stall.exitNodeId, fromNodeId: stall.nodeId, flow };
  // A queue is not a crowd model: show the existing walkable route only when a real stall id exists.
  return { ...base, key: `${base.key}:queue`, name: `${stall.name} 대기 위치`, fromNodeId: null, flow };
}
export function hasFlowNodes(stall: FestivalStall, flow: StallFlow): boolean {
  return flow === 'enter' ? Boolean(stall.nodeId && stall.entranceNodeId) : flow === 'exit' ? Boolean(stall.nodeId && stall.exitNodeId) : Boolean(stall.nodeId);
}
