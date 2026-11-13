// 건물 상세 정보 패널의 편집: 이름, 코드, 층 목록. 화면은 새 코드를 따라가야 한다.
import { describe, expect, it } from 'vitest';
import { levelRemoveBlocked, planRenameBuilding, planSetBuildingLevels, planSetBuildingName, renameBlocked } from '../src/model/buildingEdit.ts';
import { isError, runPlan } from '../src/model/plan.ts';
import { followBuildingRename, initialUi, reconcileUi, type UiState } from '../src/ui/ui-state.ts';
import { fixtureSession } from './fixture.ts';

describe('건물 이름', () => {
  it('can be changed freely, but not emptied', () => {
    const s = fixtureSession();
    const plan = planSetBuildingName(s.history.current(), 'B', '  새 이름 ');
    if (isError(plan)) throw new Error(plan.error);
    expect(runPlan(s.history, plan).ok).toBe(true);
    expect(s.history.current().buildings['B']!.props.name).toBe('새 이름');
    expect(isError(planSetBuildingName(s.history.current(), 'B', '   '))).toBe(true);
  });
});

describe('건물 코드', () => {
  it('is one history entry; one undo restores the data', () => {
    const s = fixtureSession();
    const before = structuredClone(s.history.current());
    const plan = planRenameBuilding(s.ctx, 'A', 'ENG1');
    if (isError(plan)) throw new Error(plan.error);
    expect(runPlan(s.history, plan).ok).toBe(true);
    expect(s.history.current().buildings['ENG1']).toBeDefined();
    s.history.undo();
    expect(s.history.current()).toEqual(before);
  });

  it('says why a code is not allowed while it is typed', () => {
    const s = fixtureSession();
    const st = s.history.current();
    expect(renameBlocked(st, s.ctx, 'A', 'B')).toMatch(/이미 있는 건물 코드/);
    expect(renameBlocked(st, s.ctx, 'A', 'a b')).toMatch(/영문자와 숫자/);
    expect(renameBlocked(st, s.ctx, 'A', 'ENG1')).toBe(false);
  });

  it('the screen follows: selection, building picker and the shown floor keep pointing at the renamed building', () => {
    const ui: UiState = { ...initialUi, scope: { kind: 'building', buildingId: 'bldg_A', level: 3 }, selectedBuildingId: 'bldg_A', selection: ['bldg_A'] };
    const next = followBuildingRename(ui, 'bldg_A', 'bldg_ENG1');
    expect(next.scope).toEqual({ kind: 'building', buildingId: 'bldg_ENG1', level: 3 });
    expect(next.selectedBuildingId).toBe('bldg_ENG1');
    expect(next.selection).toEqual(['bldg_ENG1']);
    // and nothing is dropped when the screen is reconciled with the renamed data
    const s = fixtureSession();
    const plan = planRenameBuilding(s.ctx, 'A', 'ENG1');
    if (isError(plan)) throw new Error(plan.error);
    runPlan(s.history, plan);
    expect(reconcileUi(next, s.history.current())).toBe(next);
  });
});

describe('층 목록', () => {
  it('adds a floor', () => {
    const s = fixtureSession();
    const plan = planSetBuildingLevels('B', [1, 2, 3]);
    if (isError(plan)) throw new Error(plan.error);
    expect(runPlan(s.history, plan).ok).toBe(true);
    expect(s.history.current().buildings['B']!.props.levels).toEqual([1, 2, 3]);
  });

  it('will not take out a floor that has points, and says so; an empty floor can go', () => {
    const s = fixtureSession();
    const st = s.history.current();
    expect(levelRemoveBlocked(st, 'A', 4)).toMatch(/4층.*지점 \d+개/);
    const plan = planSetBuildingLevels('A', [1, 2, 3]);
    if (isError(plan)) throw new Error(plan.error);
    const run = runPlan(s.history, plan);
    expect(run.ok).toBe(false);
    expect(s.history.current()).toBe(st);

    const grown = planSetBuildingLevels('B', [1, 2, 3]);
    if (isError(grown)) throw new Error(grown.error);
    runPlan(s.history, grown);
    expect(levelRemoveBlocked(s.history.current(), 'B', 3)).toBe(false);
  });

  it('the last floor cannot be removed', () => {
    const s = fixtureSession();
    expect(levelRemoveBlocked(s.history.current(), 'C', 5)).toMatch(/하나뿐/);
  });
});
