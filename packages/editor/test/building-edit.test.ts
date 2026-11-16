// 건물 상세 정보 패널의 편집: 이름, 코드, 층 목록. 화면은 새 코드를 따라가야 한다.
import { describe, expect, it } from 'vitest';
import { plinthFloors } from '@campo/core';
import { levelRemoveBlocked, planRenameBuilding, planSetBuildingLevels, planSetBuildingName, planSetFloorHeight, planSetPlinthFloors, renameBlocked } from '../src/model/buildingEdit.ts';
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

describe('층고 (우클릭 메뉴)', () => {
  it('sets ext.floor_height_m, keeps other ext values, clears on blank, refuses nonsense', () => {
    const s = fixtureSession();
    const run = (text: string) => {
      const plan = planSetFloorHeight(s.history.current(), 'B', text);
      if (isError(plan)) return plan.error;
      return runPlan(s.history, plan).ok ? 'ok' : 'failed';
    };
    expect(run('4,2 m')).toBe('ok');
    expect(s.history.current().buildings['B']!.props.ext?.floor_height_m).toBe(4.2);
    expect(run('')).toBe('ok');
    expect(s.history.current().buildings['B']!.props.ext?.floor_height_m).toBeUndefined();
    expect(run('abc')).toContain('층고');
    expect(run('40')).toContain('층고');
    expect(isError(planSetFloorHeight(s.history.current(), 'nope', '3'))).toBe(true);
  });
});

describe('기반층', () => {
  it('sets ext.plinth_floors (decimals too), keeps other ext values, clears on blank or 0, refuses nonsense', () => {
    const s = fixtureSession();
    const run = (text: string) => {
      const plan = planSetPlinthFloors(s.history.current(), 'A', text);
      if (isError(plan)) return plan.error;
      return runPlan(s.history, plan).ok ? 'ok' : 'failed';
    };
    const a = () => s.history.current().buildings['A']!;
    expect(run('-1')).toContain('기반층');
    expect(run('2층')).toBe('ok');
    expect(a().props.ext?.plinth_floors).toBe(2);
    expect(run('0.5')).toBe('ok');
    expect(plinthFloors(a())).toBe(0.5);
    const height = planSetFloorHeight(s.history.current(), 'A', '4');
    if (isError(height)) throw new Error(height.error);
    expect(runPlan(s.history, height).ok).toBe(true);
    expect(run('1')).toBe('ok');
    expect(a().props.ext).toEqual({ floor_height_m: 4, plinth_floors: 1 });
    expect(run('')).toBe('ok');
    expect(a().props.ext).toEqual({ floor_height_m: 4 });
    expect(run('1')).toBe('ok');
    expect(run('0')).toBe('ok');
    expect(a().props.ext).toEqual({ floor_height_m: 4 });
    expect(run('abc')).toContain('기반층');
  });
});
