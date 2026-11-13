// Deleting a building while its floor is on screen used to leave the screen "on" a floor that no longer exists:
// 건물 외곽선 그리기 is only offered outdoors, so no new building could be drawn afterwards.
import { describe, expect, it } from 'vitest';
import { buildingById } from '@campo/core';
import { runPlan, isError } from '../src/model/plan.ts';
import { planDelete } from '../src/model/ops.ts';
import { OUTDOOR } from '../src/model/scope.ts';
import { toolAvailable } from '../src/ui/registry.ts';
import { initialUi, reconcileUi, type UiState } from '../src/ui/ui-state.ts';
import { fixtureSession } from './fixture.ts';

const onFloor = (level: number): UiState => ({
  ...initialUi,
  scope: { kind: 'building', buildingId: 'bldg_A', level },
  selectedBuildingId: 'bldg_A',
  selection: ['bldg_A'],
  tool: 'select',
});

describe('건물 삭제 뒤의 화면 범위', () => {
  it('goes back to the outdoors at once, and 건물 외곽선 그리기 can be used again', () => {
    const s = fixtureSession();
    const plan = planDelete(s.history.current(), s.ctx, ['bldg_A'], false);
    if (isError(plan)) throw new Error(plan.error);
    expect(runPlan(s.history, plan).ok).toBe(true);
    const after = s.history.current();
    expect(buildingById(after, 'bldg_A')).toBeUndefined();

    const ui = reconcileUi({ ...onFloor(3), tool: 'select' }, after);
    expect(ui.scope).toEqual(OUTDOOR);
    expect(ui.selectedBuildingId).toBeNull();
    expect(toolAvailable('building', ui.scope)).toBe(true);
  });

  it('drops a tool that needs a floor and a first pick that no longer exists', () => {
    const s = fixtureSession();
    const first = Object.values(s.history.current().nodes).find((n) => n.props.building_id === 'bldg_A')!;
    const plan = planDelete(s.history.current(), s.ctx, ['bldg_A'], false);
    if (isError(plan)) throw new Error(plan.error);
    runPlan(s.history, plan);
    const ui = reconcileUi({ ...onFloor(1), tool: 'portal', pickFrom: first.id }, s.history.current());
    expect(ui.tool).toBe('select');
    expect(ui.pickFrom).toBeNull();
  });

  it('keeps everything while the building and its floor still exist', () => {
    const s = fixtureSession();
    const ui = onFloor(3);
    expect(reconcileUi(ui, s.history.current())).toBe(ui);
  });

  it('leaves the floor when the shown level itself is gone', () => {
    const s = fixtureSession();
    const ui = reconcileUi(onFloor(99), s.history.current());
    expect(ui.scope).toEqual(OUTDOOR);
  });

  it('Ctrl+Z brings back the building and everything in it, exactly', () => {
    const s = fixtureSession();
    const before = structuredClone(s.history.current());
    const plan = planDelete(s.history.current(), s.ctx, ['bldg_A'], false);
    if (isError(plan)) throw new Error(plan.error);
    runPlan(s.history, plan);
    expect(s.history.current().buildings).not.toEqual(before.buildings);
    s.history.undo();
    expect(s.history.current()).toEqual(before); // every node, edge, room and the building itself (key order may differ)
    const ui = reconcileUi(onFloor(3), s.history.current());
    expect(ui.scope).toEqual({ kind: 'building', buildingId: 'bldg_A', level: 3 });
  });
});
