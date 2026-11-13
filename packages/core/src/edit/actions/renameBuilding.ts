import { bumpRev, defineAction, type Action, type EditContext } from '../action.ts';
import { buildingById, type EditState } from '../state.ts';

/** Same rule as addBuilding: letters and digits only. The Feature id is "bldg_{code}" (SPEC.md 4.4) and the record key is the code. */
export const BUILDING_CODE = /^[A-Za-z0-9]+$/;

/** "A-EV1" and "A_elevA" of building A become "ENG1-EV1" and "ENG1_elevA"; an id that does not start with the code is left alone. */
export function renamedElevatorId(elevatorId: string, from: string, to: string): string {
  const rest = elevatorId.startsWith(from) ? elevatorId.slice(from.length) : null;
  return rest !== null && (rest === '' || /^[^A-Za-z0-9]/.test(rest)) ? `${to}${rest}` : elevatorId;
}

/** The elevator_id values of the building's stops that change, old -> new. */
function elevatorRenames(state: EditState, buildingId: string, from: string, to: string): Map<string, string> {
  const renames = new Map<string, string>();
  for (const n of Object.values(state.nodes)) {
    const id = n.props.elevator_id;
    if (n.props.building_id === buildingId && id !== undefined) {
      const next = renamedElevatorId(id, from, to);
      if (next !== id) renames.set(id, next);
    }
  }
  return renames;
}

/**
 * Change a building's code (SPEC-v0.2 4.1). Everything that points at the building follows in one action, so one undo takes it all back:
 * the building's record key, Feature id and `code` (and with them its folder buildings/{code}/ when saved), the `building_id` of
 * its nodes and rooms, the `building_from` / `building_to` of the edges that leave it, and the `elevator_id` of its elevators
 * when they start with the old code. Every Feature it touches gets rev + 1.
 *
 * Node, edge and room ids stay as they are: overrides.json, measurements, reports and changesets point at them.
 */
export function renameBuilding(code: string, newCode: string, ctx?: EditContext): Action {
  const oldId = `bldg_${code}`;
  const newId = `bldg_${newCode}`;
  return defineAction({
    annotation: `건물 코드 ${code} → ${newCode}`,
    disabled(state) {
      if (!state.buildings[code]) return `건물 "${code}"이(가) 없습니다.`;
      if (!BUILDING_CODE.test(newCode)) return '건물 코드는 영문자와 숫자만 쓸 수 있습니다.';
      if (newCode === code) return '현재 코드와 같습니다.';
      if (state.buildings[newCode] || buildingById(state, newId)) return `이미 있는 건물 코드입니다: ${newCode}`;
      const building = state.buildings[code]!;
      for (const [from, to] of elevatorRenames(state, building.id, code, newCode)) {
        const used = Object.values(state.nodes).some((n) => n.props.building_id !== building.id && n.props.elevator_id === to);
        if (used) return `엘리베이터 ${from}의 새 이름 ${to}(elevator_id)을(를) 다른 건물이 이미 쓰고 있습니다.`;
      }
      return false;
    },
    warnings(state) {
      const targets = ctx?.observationTargets;
      const building = state.buildings[code];
      if (!targets || !building) return [];
      return [...elevatorRenames(state, building.id, code, newCode).keys()]
        .filter((id) => targets.has(`elevator:${id}`))
        .map((id) => `엘리베이터 ${id}의 이름이 바뀌어 그 측정(observations)과 보정값은 옛 이름을 가리킵니다. 측정의 target을 새 이름으로 고치거나 다시 재 주세요.`);
    },
    recipe(draft) {
      const building = draft.buildings[code]!;
      const renames = elevatorRenames(draft, building.id, code, newCode);
      delete draft.buildings[code];
      building.id = newId;
      building.props.code = newCode;
      bumpRev(building.props);
      draft.buildings[newCode] = building;
      for (const n of Object.values(draft.nodes)) {
        if (n.props.building_id !== oldId) continue;
        n.props.building_id = newId;
        const elevatorId = n.props.elevator_id;
        if (elevatorId !== undefined && renames.has(elevatorId)) n.props.elevator_id = renames.get(elevatorId)!;
        bumpRev(n.props);
      }
      for (const e of Object.values(draft.edges)) {
        const p = e.props;
        if (p.building_from !== oldId && p.building_to !== oldId) continue;
        if (p.building_from === oldId) p.building_from = newId;
        if (p.building_to === oldId) p.building_to = newId;
        bumpRev(p);
      }
      for (const r of Object.values(draft.rooms)) {
        if (r.props.building_id !== oldId) continue;
        r.props.building_id = newId;
        bumpRev(r.props);
      }
    },
  });
}
