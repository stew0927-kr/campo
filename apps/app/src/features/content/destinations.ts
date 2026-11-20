import type { Destination } from '../../state/model.ts';
import type { EssaySession, FestivalStall, SchoolEvent, FestivalPerformance } from './types.ts';
export function essayDestination(row: EssaySession, demo = true): Destination {
  return { key: `essay:${row.id}`, name: `${row.buildingCode ?? '고사장'} ${row.roomLabel ?? ''}`.trim(), searchTerm: [row.buildingCode, row.roomLabel].filter(Boolean).join(' ') || row.trackLabel, nodeId: row.destinationNodeId, kind: 'essay', demo };
}
export function stallDestination(row: FestivalStall, demo = true): Destination {
  return { key: `stall:${row.id}`, name: row.name, searchTerm: row.buildingCode ?? row.name, nodeId: row.nodeId, kind: 'stall', demo };
}
export function eventDestination(row: SchoolEvent, demo = true): Destination {
  return { key: `event:${row.id}`, name: row.title, searchTerm: row.placeLabel ?? row.buildingCode ?? row.title, nodeId: row.nodeId, kind: 'event', demo };
}
export function stageDestination(row: FestivalPerformance, demo = true): Destination {
  return { key: `stage:${row.id}`, name: row.stageLabel ?? row.artist, searchTerm: row.stageLabel ?? row.artist, nodeId: row.nodeId, kind: 'stage', demo };
}
