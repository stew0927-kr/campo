import { floorOutlineKey, outlineOfLevel, outlineProblem } from '../../outline.ts';
import type { Level, Position } from '../../types.ts';
import { bumpRev, defineAction, type Action } from '../action.ts';
import { clone, type EditState } from '../state.ts';

const floorName = (level: number): string => (level < 0 ? `지하 ${-level}층` : `${level}층`);
const same = (a: readonly Position[][], b: readonly Position[][]): boolean => JSON.stringify(a) === JSON.stringify(b);

function buildingProblem(state: EditState, code: string, level: Level | null): string | false {
  const building = state.buildings[code];
  if (!building) return `건물 "${code}"이(가) 없습니다.`;
  if (level !== null && !building.props.levels.includes(level)) return `${floorName(level)}은(는) 건물 ${code}의 층이 아닙니다.`;
  return false;
}

/**
 * Change an outline of a building (the building's rev + 1, one history entry). With a level it is that floor's own
 * outline (floor_outlines[String(level)], made when the floor had none); without one (null) it is the building's
 * geometry, which every floor without its own outline follows.
 */
export function setBuildingOutline(code: string, level: Level | null, polygon: Position[][]): Action {
  const next = clone(polygon);
  return defineAction({
    annotation: level === null ? `건물 ${code} 외곽선 수정` : `건물 ${code} ${floorName(level)} 외곽선 수정`,
    disabled(state) {
      const problem = buildingProblem(state, code, level) || outlineProblem(next);
      if (problem) return problem;
      const b = state.buildings[code]!;
      const now = level === null ? b.polygon : b.props.floor_outlines?.[floorOutlineKey(level)];
      return now !== undefined && same(now, next) ? '바뀐 내용이 없습니다.' : false;
    },
    recipe(draft) {
      const b = draft.buildings[code]!;
      if (level === null) {
        b.polygon = clone(next);
      } else {
        b.props.floor_outlines = { ...(b.props.floor_outlines ?? {}), [floorOutlineKey(level)]: clone(next) };
      }
      bumpRev(b.props);
    },
  });
}

/** The floor goes back to the building's outline: its own outline is removed (floor_outlines goes when it is the last one). */
export function resetFloorOutline(code: string, level: Level): Action {
  return defineAction({
    annotation: `건물 ${code} ${floorName(level)} 외곽선 되돌리기`,
    disabled(state) {
      const problem = buildingProblem(state, code, level);
      if (problem) return problem;
      return state.buildings[code]!.props.floor_outlines?.[floorOutlineKey(level)] === undefined ? `${floorName(level)}은(는) 이미 건물 외곽선을 따릅니다.` : false;
    },
    recipe(draft) {
      const props = draft.buildings[code]!.props;
      const rest = { ...props.floor_outlines };
      delete rest[floorOutlineKey(level)];
      if (Object.keys(rest).length > 0) props.floor_outlines = rest;
      else delete props.floor_outlines;
      bumpRev(props);
    },
  });
}

/** The outline a floor's edit starts from: its own, else a copy of the building's. */
export const outlineToEdit = (state: EditState, code: string, level: Level | null): Position[][] | undefined => {
  const b = state.buildings[code];
  return b ? clone(outlineOfLevel(b, level)) : undefined;
};
