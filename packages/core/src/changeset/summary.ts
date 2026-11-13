// Human summary of a changeset: added / deleted / changed counts per building (SPEC-v0.2 7.2 step 5).
import { edgeFileScope } from '../edit/ids.ts';
import { buildingById, findFeature, type EditState } from '../edit/state.ts';
import type { Changeset } from './types.ts';
import { changeIdOf } from './conflicts.ts';

/** "outdoor", "connections" or a building Feature id. */
export type ChangeGroupKey = string;

export interface ChangeGroup {
  key: ChangeGroupKey;
  /** Korean: "A동(A)", "바깥", "건물 사이 연결". */
  label: string;
  added: number;
  deleted: number;
  changed: number;
}

export const OUTDOOR_GROUP = 'outdoor';
export const CONNECTIONS_GROUP = 'connections';

/** Where a Feature of `state` belongs for the summary. */
export function groupOf(state: EditState, id: string): ChangeGroupKey {
  const where = findFeature(state, id);
  if (!where) return OUTDOOR_GROUP;
  switch (where.collection) {
    case 'buildings':
      return state.buildings[where.key]!.id;
    case 'nodes':
      return state.nodes[id]!.props.building_id ?? OUTDOOR_GROUP;
    case 'rooms':
      return state.rooms[id]!.props.building_id;
    case 'edges': {
      const e = state.edges[id]!;
      const from = state.nodes[e.props.from];
      const to = state.nodes[e.props.to];
      if (!from || !to) return CONNECTIONS_GROUP;
      const scope = edgeFileScope(e.props.edge_type, from.props, to.props);
      return scope.kind === 'outdoor' ? OUTDOOR_GROUP : scope.kind === 'connections' ? CONNECTIONS_GROUP : scope.buildingId;
    }
  }
}

function labelOf(before: EditState, after: EditState, key: ChangeGroupKey): string {
  if (key === OUTDOOR_GROUP) return '바깥';
  if (key === CONNECTIONS_GROUP) return '건물 사이 연결';
  const b = buildingById(after, key) ?? buildingById(before, key);
  return b ? `${b.props.name}(${b.props.code})` : key;
}

/**
 * Counts per group. Created and modified Features are placed by `after`, deleted ones by `before`.
 * Groups come in label order, with 바깥 and 건물 사이 연결 last.
 */
export function summarizeChangeset(before: EditState, after: EditState, cs: Changeset): ChangeGroup[] {
  const groups = new Map<ChangeGroupKey, ChangeGroup>();
  const bump = (key: ChangeGroupKey, field: 'added' | 'deleted' | 'changed') => {
    let g = groups.get(key);
    if (!g) {
      g = { key, label: labelOf(before, after, key), added: 0, deleted: 0, changed: 0 };
      groups.set(key, g);
    }
    g[field]++;
  };
  for (const c of cs.changes) {
    const id = changeIdOf(c);
    if (c.op === 'delete') bump(groupOf(before, id), 'deleted');
    else bump(groupOf(after, id), c.op === 'create' ? 'added' : 'changed');
  }
  const rank = (g: ChangeGroup) => (g.key === OUTDOOR_GROUP ? 1 : g.key === CONNECTIONS_GROUP ? 2 : 0);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}
