// The 상세 정보 panel of a building: name, code, levels. Each edit is a Plan of one core action (one Ctrl+Z).
import { renameBuilding, setBuildingLevels, setProps, type EditContext, type EditState } from '@campo/core';
import { isError, planReason, type PlanResult } from './plan.ts';

export function planSetBuildingName(state: EditState, code: string, name: string): PlanResult {
  const building = state.buildings[code];
  if (!building) return { error: '건물을 찾을 수 없습니다.' };
  const next = name.trim();
  if (next === '') return { error: '건물 이름을 입력해 주세요.' };
  return { annotation: `건물 이름을 "${next}"(으)로 바꾸기`, steps: [() => setProps([building.id], { name: next })] };
}

export function planRenameBuilding(ctx: EditContext, code: string, newCode: string): PlanResult {
  const next = newCode.trim();
  return { annotation: `건물 코드 ${code} → ${next}`, steps: [() => renameBuilding(code, next, ctx)] };
}

export function planSetBuildingLevels(code: string, levels: readonly number[]): PlanResult {
  return { annotation: `건물 ${code} 층 목록 바꾸기`, steps: [() => setBuildingLevels(code, levels)] };
}

/** Why the code cannot be changed to `newCode` (Korean), or false. */
export function renameBlocked(state: EditState, ctx: EditContext, code: string, newCode: string): string | false {
  const plan = planRenameBuilding(ctx, code, newCode);
  return isError(plan) ? plan.error : planReason(state, plan);
}

/** Why `level` cannot be taken out of the building (it has points, edges or rooms on it), or false. */
export function levelRemoveBlocked(state: EditState, code: string, level: number): string | false {
  const building = state.buildings[code];
  if (!building) return '건물을 찾을 수 없습니다.';
  if (building.props.levels.length === 1) return '층이 하나뿐인 건물은 층을 지울 수 없습니다.';
  return setBuildingLevels(code, building.props.levels.filter((l) => l !== level)).disabled(state);
}
