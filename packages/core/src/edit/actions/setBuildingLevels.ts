import { bumpRev, defineAction, type Action } from '../action.ts';
import type { EditState } from '../state.ts';

/** What stands on one level of a building. */
function contentOf(state: EditState, buildingId: string, level: number): { nodes: number; edges: number; rooms: number } {
  const here = new Set(
    Object.values(state.nodes).filter((n) => n.props.building_id === buildingId && n.props.level === level).map((n) => n.id),
  );
  const edges = Object.values(state.edges).filter((e) => here.has(e.props.from) || here.has(e.props.to)).length;
  const rooms = Object.values(state.rooms).filter((r) => r.props.building_id === buildingId && r.props.level === level).length;
  return { nodes: here.size, edges, rooms };
}

function floorName(level: number): string {
  return level < 0 ? `지하 ${-level}층` : `${level}층`;
}

/**
 * Replace a building's list of levels. A level that is taken out must be empty (no nodes, edges or rooms on it);
 * otherwise the action refuses and says what is still there. `ground_levels` keeps only levels that exist,
 * and falls back to 1 (or the lowest level) when none is left.
 */
export function setBuildingLevels(code: string, levels: readonly number[]): Action {
  const next = [...levels].sort((a, b) => a - b);
  return defineAction({
    annotation: `건물 ${code} 층 목록 바꾸기`,
    disabled(state) {
      const building = state.buildings[code];
      if (!building) return `건물 "${code}"이(가) 없습니다.`;
      if (next.length === 0) return '층을 하나 이상 입력해 주세요.';
      if (!next.every((l) => Number.isInteger(l) && l !== 0)) return '층은 0이 아닌 정수여야 합니다(지하 1층은 -1).';
      if (new Set(next).size !== next.length) return '같은 층이 두 번 들어 있습니다.';
      if (building.props.building_type === 'bridge' && next.length > 1) return '구름다리 건물은 층이 하나여야 합니다.';
      const busy = building.props.levels
        .filter((l) => !next.includes(l))
        .map((l) => ({ level: l, ...contentOf(state, building.id, l) }))
        .filter((c) => c.nodes + c.edges + c.rooms > 0);
      if (busy.length === 0) return false;
      const what = busy.map((c) => {
        const parts = [c.nodes > 0 ? `지점 ${c.nodes}개` : '', c.edges > 0 ? `구간 ${c.edges}개` : '', c.rooms > 0 ? `강의실 영역 ${c.rooms}개` : ''].filter(Boolean);
        return `${floorName(c.level)}(${parts.join(', ')})`;
      });
      return `${what.join(', ')}이(가) 있어 층을 지울 수 없습니다. 먼저 그 층의 내용을 지워 주세요.`;
    },
    recipe(draft) {
      const props = draft.buildings[code]!.props;
      props.levels = next;
      const kept = props.ground_levels.filter((l) => next.includes(l));
      props.ground_levels = kept.length > 0 ? kept : [next.includes(1) ? 1 : next[0]!];
      bumpRev(props);
    },
  });
}
