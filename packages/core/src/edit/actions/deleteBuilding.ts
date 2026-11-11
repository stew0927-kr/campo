import { defineAction, deletionWarnings, type Action, type EditContext } from '../action.ts';
import type { EditState } from '../state.ts';

export interface DeleteBuildingPreview {
  nodes: number;
  edges: number;
  rooms: number;
}

interface Doomed {
  nodes: string[];
  edges: string[];
  rooms: string[];
}

function doomed(state: EditState, code: string): Doomed | null {
  const building = state.buildings[code];
  if (!building) return null;
  const bid = building.id;
  const nodes = Object.keys(state.nodes).filter((id) => state.nodes[id]!.props.building_id === bid).sort();
  const set = new Set(nodes);
  const edges = Object.keys(state.edges)
    .filter((id) => set.has(state.edges[id]!.props.from) || set.has(state.edges[id]!.props.to))
    .sort();
  const rooms = Object.keys(state.rooms).filter((id) => state.rooms[id]!.props.building_id === bid).sort();
  return { nodes, edges, rooms };
}

/** How many nodes, edges (portals and bridges included) and rooms deleteBuilding(code) would remove. */
export function previewDeleteBuilding(state: EditState, code: string): DeleteBuildingPreview {
  const d = doomed(state, code);
  return { nodes: d?.nodes.length ?? 0, edges: d?.edges.length ?? 0, rooms: d?.rooms.length ?? 0 };
}

/** Delete a building with every node in it, every edge touching those nodes (portals and bridges too) and its rooms. */
export function deleteBuilding(code: string, ctx?: EditContext): Action {
  const action = defineAction({
    annotation: (state) => {
      const p = previewDeleteBuilding(state, code);
      return `건물 ${code} 삭제(지점 ${p.nodes}개, 구간 ${p.edges}개, 강의실 영역 ${p.rooms}개)`;
    },
    disabled: (state) => (state.buildings[code] ? false : `건물 "${code}"이(가) 없습니다.`),
    recipe(draft) {
      const d = doomed(draft, code)!;
      for (const id of d.edges) delete draft.edges[id];
      for (const id of d.nodes) delete draft.nodes[id];
      for (const id of d.rooms) delete draft.rooms[id];
      delete draft.buildings[code];
    },
    warnings: (state) => deletionWarnings(action, ctx, state),
  });
  return action;
}
