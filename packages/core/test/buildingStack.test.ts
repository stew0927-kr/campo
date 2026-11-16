// Floors stacked by height for the 3D views: base and top of every floor, measured heights first, then the building's
// floor_height_m, then 3.9 m; basements below the ground; each floor with its own outline.
import { describe, expect, it } from 'vitest';
import { DEFAULT_FLOOR_HEIGHT_M, buildingStack, floorHeights, measuredFloorLevels, plinthFloors, stackLayout, type EditBuilding, type Position } from '../src/index.ts';

const square = (d: number): Position[][] => [[[0, 0], [d, 0], [d, d], [0, d], [0, 0]]];
const building = (levels: number[], extra: Partial<EditBuilding['props']> = {}): EditBuilding => ({
  id: 'bldg_X', polygon: square(1),
  props: { kind: 'building', name: 'X', code: 'X', levels, ground_levels: [1], source: 's', rev: 1, ...extra },
});
const span = (b: EditBuilding, m?: Map<number, number>) => buildingStack(b, m).map((s) => [s.level, +s.baseM.toFixed(2), +s.topM.toFixed(2)]);

describe('buildingStack', () => {
  it('without any height the floors are 3.9 m: 1F on the ground, B1 and B2 below it', () => {
    expect(DEFAULT_FLOOR_HEIGHT_M).toBe(3.9);
    expect(span(building([-2, -1, 1, 2, 3]))).toEqual([[-2, -7.8, -3.9], [-1, -3.9, 0], [1, 0, 3.9], [2, 3.9, 7.8], [3, 7.8, 11.7]]);
    expect(buildingStack(building([1])).map((s) => s.heightFrom)).toEqual(['default']);
  });

  it("the building's floor_height_m is used for every floor", () => {
    expect(span(building([-1, 1, 2], { ext: { floor_height_m: 4.5 } }))).toEqual([[-1, -4.5, 0], [1, 0, 4.5], [2, 4.5, 9]]);
  });

  it('a measured difference to the floor above wins for that floor; floors without one keep the fallback', () => {
    const measured = new Map([[-1, 26], [1, 30.2], [2, 35.4]]);
    const b = building([-1, 1, 2, 3], { ext: { floor_height_m: 4 } });
    expect(span(b, measured)).toEqual([[-1, -4.2, 0], [1, 0, 5.2], [2, 5.2, 9.2], [3, 9.2, 13.2]]);
    expect(buildingStack(b, measured).map((s) => s.heightFrom)).toEqual(['measured', 'measured', 'building', 'building']);
    // A difference that cannot be a floor (under 0.5 m) is not taken.
    expect(floorHeights(b, new Map([[1, 30], [2, 30.1]]))(1)).toEqual({ heightM: 4, from: 'building' });
  });

  it('floors missing from the list still count: a building whose lowest floor is 5F stands four floors up', () => {
    expect(span(building([5]))).toEqual([[5, 15.6, 19.5]]);
  });

  it('each floor carries its own outline (floor_outlines), the others the building outline', () => {
    const b = building([-1, 1], { floor_outlines: { '-1': square(3) } });
    const stack = buildingStack(b);
    expect(stack[0]!.outline).toEqual(square(3));
    expect(stack[1]!.outline).toBe(b.polygon);
  });

  it('plinthFloors reads ext.plinth_floors as typed (decimals too), 0 when unset, and ignores the listed floors', () => {
    expect(plinthFloors(building([-1, 1, 2, 3, 4, 5, 6]))).toBe(0);
    expect(plinthFloors(building([-1, 1, 2, 3, 4, 5, 6], { ext: { plinth_floors: 3 } }))).toBe(3);
    expect(plinthFloors(building([-1, 1, 2], { ext: { plinth_floors: 0.5 } }))).toBe(0.5);
    expect(plinthFloors(building([-1, 1], { ext: { plinth_floors: 0 } }))).toBe(0);
    expect(plinthFloors(building([-1, 1], { ext: { plinth_floors: -1 } }))).toBe(0);
  });

  it("stackLayout 'flat' (terrain off): no plinth, 1F on the ground, basements below it", () => {
    const b = building([-2, -1, 1, 2], { ext: { plinth_floors: 3 } });
    const flat = stackLayout(b, undefined, 'flat');
    expect(flat.plinth).toBeNull();
    expect(flat.floors.map((s) => [s.level, +s.baseM.toFixed(2), +s.topM.toFixed(2)])).toEqual([[-2, -7.8, -3.9], [-1, -3.9, 0], [1, 0, 3.9], [2, 3.9, 7.8]]);
  });

  it("stackLayout 'terrain': one plinth block on the ground, then B2, B1, 1F, 2F right on top of it", () => {
    const b = building([-2, -1, 1, 2], { ext: { plinth_floors: 3, floor_height_m: 4 } });
    const { plinth, floors } = stackLayout(b, undefined, 'terrain');
    expect(plinth).toEqual({ floors: 3, baseM: 0, topM: 12, outline: b.polygon });
    expect(floors.map((s) => [s.level, +s.baseM.toFixed(2), +s.topM.toFixed(2)])).toEqual([[-2, 12, 16], [-1, 16, 20], [1, 20, 24], [2, 24, 28]]);
    // Without basements 1F stands on the plinth.
    const noBasement = stackLayout(building([1, 2], { ext: { plinth_floors: 2 } }), undefined, 'terrain');
    expect(noBasement.floors.map((s) => +s.baseM.toFixed(2))).toEqual([7.8, 11.7]);
    // Without plinth floors the terrain layout is the flat one.
    const none = stackLayout(building([-1, 1]), undefined, 'terrain');
    expect(none.plinth).toBeNull();
    expect(none.floors.map((s) => s.baseM)).toEqual([-3.9, 0]);
  });

  it('a fractional plinth makes a block of that many floors; changing the floor list does not change it', () => {
    const half = stackLayout(building([1, 2, 3], { ext: { plinth_floors: 0.5 } }), undefined, 'terrain');
    expect(half.plinth!.floors).toBe(0.5);
    expect(+half.plinth!.topM.toFixed(2)).toBe(1.95);
    expect(+half.floors[0]!.baseM.toFixed(2)).toBe(1.95);
    const fewer = stackLayout(building([1, 2], { ext: { plinth_floors: 0.5 } }), undefined, 'terrain');
    expect(fewer.plinth!.topM).toBe(half.plinth!.topM);
  });

  it('reads measured floor heights from the recompute estimates of one building', () => {
    const m = measuredFloorLevels([
      { key: 'fp:bldg_X:1F', hM: 30 }, { key: 'fp:bldg_X:B1', hM: 26 }, { key: 'fp:bldg_Y:2F', hM: 40 }, { key: 'op:abc', hM: 1 },
    ], 'bldg_X');
    expect([...m.entries()].sort((a, b) => a[0] - b[0])).toEqual([[-1, 26], [1, 30]]);
    expect(measuredFloorLevels(undefined, 'bldg_X').size).toBe(0);
  });
});
