// What the 연결통로 and 에스컬레이터 tools share: the end of the line is an existing node, or an empty spot on the floor being shown
// (a new node is made there, in the same Plan, so one Ctrl+Z takes both back).
import { footOnLine, type EditBuilding, type EditState, type Position } from '@campo/core';
import { defaultLevel } from './scope.ts';

export type CrossEnd =
  | { nodeId: string }
  /** An empty spot: indoors a corridor node of `buildingId` / `level`, outdoors (both null) an outdoor node. */
  | { position: Position; buildingId: string | null; level: number | null };

export interface BridgeTarget {
  building: EditBuilding;
  /** Floors, lowest first. */
  levels: number[];
  /** The floor shown first: the start node's own floor number when this building has it, else its default floor. */
  level: number;
  /** From the start node to the outline, metres. */
  distanceM: number;
}

/** The buildings a bridge from `fromNodeId` can reach: every other building, nearest outline first. */
export function bridgeTargets(state: EditState, fromNodeId: string): BridgeTarget[] {
  const from = state.nodes[fromNodeId];
  if (!from || from.props.building_id === null) return [];
  const targets: BridgeTarget[] = [];
  for (const b of Object.values(state.buildings)) {
    if (b.id === from.props.building_id) continue;
    const ring = b.polygon[0] ?? [];
    const levels = [...b.props.levels].sort((a, c) => a - c);
    targets.push({
      building: b,
      levels,
      level: from.props.level !== null && levels.includes(from.props.level) ? from.props.level : defaultLevel(b),
      distanceM: ring.length >= 2 ? footOnLine(ring, from.coord).pointDistance : Infinity,
    });
  }
  return targets.sort((a, b) => a.distanceM - b.distanceM || a.building.props.name.localeCompare(b.building.props.name, 'ko'));
}
