import type { BuildingProperties, Position } from '../../types.ts';
import { defineAction, type Action } from '../action.ts';
import { clone, idTaken } from '../state.ts';
import { polygonProblem } from './common.ts';

export interface NewBuilding {
  polygon: Position[][];
  /** Letters and digits only. The Feature id is "bldg_{code}" (SPEC.md 4.4) and the record key is the code. */
  code: string;
  name: string;
  levels: readonly number[];
  /** Levels that touch the ground. Default: 1 when the building has it, else its lowest level. */
  ground_levels?: readonly number[];
  /** A footbridge registered as a one-level building (SPEC-v0.2 2.6). */
  building_type?: 'bridge';
  /** Default "estimate". */
  source?: string;
}

/** Add a building outline with its code and levels (rev 1). */
export function addBuilding(input: NewBuilding): Action {
  const id = `bldg_${input.code}`;
  const levels = [...input.levels].sort((a, b) => a - b);
  const ground = input.ground_levels ? [...input.ground_levels].sort((a, b) => a - b) : levels.length > 0 ? [levels.includes(1) ? 1 : levels[0]!] : [];
  return defineAction({
    annotation: `건물 "${input.name}" 추가`,
    disabled(state) {
      if (!/^[A-Za-z0-9]+$/.test(input.code)) return '건물 코드는 영문자와 숫자만 쓸 수 있습니다.';
      if (typeof input.name !== 'string' || input.name.trim() === '') return '건물 이름을 입력해 주세요.';
      if (state.buildings[input.code] || idTaken(state, id)) return `이미 있는 건물 코드입니다: ${input.code}`;
      if (levels.length === 0) return '층을 하나 이상 입력해 주세요.';
      if (!levels.every((l) => Number.isInteger(l) && l !== 0)) return '층은 0이 아닌 정수여야 합니다(지하 1층은 -1).';
      if (new Set(levels).size !== levels.length) return '같은 층이 두 번 들어 있습니다.';
      if (!ground.every((l) => levels.includes(l))) return '지면에 닿는 층(ground_levels)은 건물의 층(levels) 안에 있어야 합니다.';
      if (input.building_type === 'bridge' && levels.length > 1) return '구름다리 건물은 층이 하나여야 합니다.';
      return polygonProblem(input.polygon);
    },
    recipe(draft) {
      const props: BuildingProperties = {
        kind: 'building',
        source: input.source ?? 'estimate',
        rev: 1,
        name: input.name.trim(),
        code: input.code,
        levels,
        ground_levels: ground,
        ...(input.building_type ? { building_type: input.building_type } : {}),
      };
      draft.buildings[input.code] = { id, polygon: clone(input.polygon), props };
    },
  });
}
