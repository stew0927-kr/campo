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

/** 우클릭 메뉴의 층고(m): building.ext.floor_height_m. Blank clears it (the elevation code then uses 3.9 m). */
export function planSetFloorHeight(state: EditState, code: string, text: string): PlanResult {
  const building = state.buildings[code];
  if (!building) return { error: '건물을 찾을 수 없습니다.' };
  const t = text.trim().replace(',', '.').replace(/\s*m$/i, '');
  const { floor_height_m: _old, ...rest } = building.props.ext ?? {};
  if (t === '') return { annotation: `건물 ${code} 층고 지우기`, steps: [() => setProps([building.id], { ext: Object.keys(rest).length > 0 ? rest : undefined })] };
  const v = Number(t);
  if (!Number.isFinite(v) || v < 2 || v > 12) return { error: '층고는 2~12 m 사이 숫자로 넣어 주세요.' };
  const value = Math.round(v * 100) / 100;
  return { annotation: `건물 ${code} 층고를 ${value} m로 바꾸기`, steps: [() => setProps([building.id], { ext: { ...rest, floor_height_m: value } })] };
}

/**
 * 대장 총층수: building.ext.registry_floors. Floors it counts beyond the levels are the plinth (core plinthFloors), drawn
 * as one block under the building when the 3D terrain is on. Blank clears it (no plinth).
 */
export function planSetRegistryFloors(state: EditState, code: string, text: string): PlanResult {
  const building = state.buildings[code];
  if (!building) return { error: '건물을 찾을 수 없습니다.' };
  const t = text.trim().replace(/\s*층$/, '');
  const { registry_floors: _old, ...rest } = building.props.ext ?? {};
  if (t === '') return { annotation: `건물 ${code} 대장 총층수 지우기`, steps: [() => setProps([building.id], { ext: Object.keys(rest).length > 0 ? rest : undefined })] };
  const v = Number(t);
  if (!Number.isInteger(v) || v < 1 || v > 200) return { error: '대장 총층수는 1~200 사이 정수로 넣어 주세요.' };
  return { annotation: `건물 ${code} 대장 총층수를 ${v}층으로 바꾸기`, steps: [() => setProps([building.id], { ext: { ...rest, registry_floors: v } })] };
}
