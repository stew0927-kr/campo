// 평지 합치기(plaza merge): 두 평지에서 고른 변 사이의 다리, 합집합, 구멍 보존, 그리고 편집 action의 규칙(E16·E17, 다른 평지와 겹쳐도 됨).
import { describe, expect, it } from 'vitest';
import {
  addPlaza,
  checkInvariants,
  createHistory,
  emptyState,
  mergePlazas,
  mergedPlazaPolygon,
  nearestOnPlazaBoundary,
  normalizePlazaRings,
  plazaAreaM2,
  setPlazaOutline,
  signedAreaM2,
  type EditState,
  type Position,
} from '../../src/index.ts';
import { bridgeRing, mergePlazaPolygons } from '../../src/plaza/merge.ts';
import { P, rect } from './helpers.ts';
import { ctx, deepFreeze, expectInputUntouched } from '../edit/helpers.ts';

const props = { kind: 'plaza' as const, source: 'editor' };
/** A = left block (0..40 × 0..30), B = right block (60..100 × 0..30): a 20 m gap between the facing sides. */
const A = () => rect(0, 0, 40, 30);
const B = () => rect(60, 0, 100, 30);
/** A's right side, B's left side (both run along the gap). */
const A_RIGHT = { ring: 0, segment: 1 };
const B_LEFT = { ring: 0, segment: 3 };

function twoPlazas(): EditState {
  return addPlaza({ id: 'plaza_b', polygon: [B()], props }).apply(addPlaza({ id: 'plaza_a', polygon: [A()], props }).apply(emptyState()));
}

const near = (a: Position, b: Position, tol = 1e-6): boolean => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;

describe('nearestOnPlazaBoundary', () => {
  it('gives the foot of the perpendicular on the outer ring, with the ring and the side it is on', () => {
    const hit = nearestOnPlazaBoundary([A()], P(20, 40))!;
    expect(near(hit.position, P(20, 30))).toBe(true);
    expect(hit.distanceM).toBeCloseTo(10, 6);
    expect(hit).toMatchObject({ ring: 0, segment: 2 });
  });

  it('takes the nearest side for a point inside, and a hole edge is the boundary too', () => {
    const inside = nearestOnPlazaBoundary([A()], P(20, 5))!;
    expect(inside.distanceM).toBeCloseTo(5, 6);
    expect(inside).toMatchObject({ ring: 0, segment: 0 });
    const holed = normalizePlazaRings([A(), rect(10, 10, 20, 20, false)]);
    const inHole = nearestOnPlazaBoundary(holed, P(15, 15))!;
    expect(inHole.ring).toBe(1);
    expect(inHole.distanceM).toBeCloseTo(5, 6);
  });

  it('is null for an empty plaza', () => {
    expect(nearestOnPlazaBoundary([], P(0, 0))).toBeNull();
  });
});

describe('bridgeRing', () => {
  it('builds the quad between the facing sides, whichever way the two rings run', () => {
    const bridge = bridgeRing([A()], A_RIGHT, [B()], B_LEFT);
    if ('error' in bridge) throw new Error(bridge.error);
    expect(bridge).toHaveLength(5);
    expect(bridge[0]).toEqual(bridge[4]);
    expect(Math.abs(plazaAreaM2([bridge]))).toBeCloseTo(20 * 30, 6);
    // Every corner is an end of one of the two sides.
    const ends = [P(40, 0), P(40, 30), P(60, 0), P(60, 30)];
    for (const corner of bridge.slice(0, -1)) expect(ends.some((e) => near(e, corner))).toBe(true);
  });

  it('refuses two sides with no room between them (touching plazas)', () => {
    const touching = bridgeRing([A()], A_RIGHT, [rect(40, 0, 80, 30)], { ring: 0, segment: 3 });
    expect(touching).toMatchObject({ error: expect.any(String) });
    // The same side twice: no space either.
    expect(bridgeRing([A()], A_RIGHT, [A()], A_RIGHT)).toMatchObject({ error: expect.any(String) });
  });
});

describe('mergePlazaPolygons', () => {
  function merged(a: Position[][], b: Position[][], aRef = A_RIGHT, bRef = B_LEFT) {
    const made = mergePlazaPolygons(normalizePlazaRings(a), aRef, normalizePlazaRings(b), bRef);
    if ('error' in made) throw new Error(made.error);
    return made.polygon;
  }

  it('unions both plazas and the gap into one outer ring', () => {
    const polygon = merged([A()], [B()]);
    expect(polygon).toHaveLength(1);
    expect(plazaAreaM2(polygon)).toBeCloseTo(40 * 30 + 20 * 30 + 40 * 30, 3);
    expect(signedAreaM2(polygon[0]!)).toBeGreaterThan(0); // outer ring counter-clockwise, like every plaza ring
  });

  it('keeps the holes of both plazas', () => {
    const polygon = merged([A(), rect(10, 10, 20, 20, false)], [B(), rect(70, 5, 80, 15, false)]);
    expect(polygon).toHaveLength(3);
    expect(polygon.slice(1).every((hole) => signedAreaM2(hole) < 0)).toBe(true);
    expect(plazaAreaM2(polygon)).toBeCloseTo(40 * 30 + 20 * 30 + 40 * 30 - 100 - 100, 3);
  });

  it('says why when the two sides cannot be joined', () => {
    expect(mergePlazaPolygons([A()], A_RIGHT, [A()], A_RIGHT)).toMatchObject({ error: expect.any(String) });
    expect(mergePlazaPolygons([A()], A_RIGHT, [{ error: 'x' } as unknown as Position[]], B_LEFT)).toMatchObject({ error: expect.any(String) });
  });
});

describe('mergePlazas action', () => {
  it('keeps the first plaza (rev + 1), drops the second, and one undo brings both back', () => {
    const s0 = deepFreeze(twoPlazas());
    const action = mergePlazas('plaza_a', 'plaza_b', { into: A_RIGHT, from: B_LEFT });
    expect(action.disabled(s0)).toBe(false);
    const s1 = expectInputUntouched(s0, action);
    expect(Object.keys(s1.plazas)).toEqual(['plaza_a']);
    expect(s1.plazas['plaza_a']!.props.rev).toBe(s0.plazas['plaza_a']!.props.rev + 1);
    expect(plazaAreaM2(s1.plazas['plaza_a']!.polygon)).toBeCloseTo(40 * 30 + 20 * 30 + 40 * 30, 3);
    expect(checkInvariants(s1)).toEqual([]);
    const history = createHistory(s0);
    history.perform(action);
    expect(Object.keys(history.current().plazas)).toEqual(['plaza_a']);
    history.undo();
    expect(history.current()).toEqual(s0);
  });

  it('refuses the same plaza twice and a missing plaza; a merge running into a third plaza is allowed (linked plazas)', () => {
    const s = twoPlazas();
    expect(mergePlazas('plaza_a', 'plaza_a', { into: A_RIGHT, from: B_LEFT }).disabled(s)).toMatch(/같은 평지/);
    expect(mergePlazas('plaza_a', 'plaza_x', { into: A_RIGHT, from: B_LEFT }).disabled(s)).toMatch(/없습니다/);
    const third = addPlaza({ id: 'plaza_c', polygon: [rect(45, 5, 55, 25)], props: { ...props } }).apply(emptyState());
    const withThird = addPlaza({ id: 'plaza_b', polygon: [B()], props }).apply(addPlaza({ id: 'plaza_a', polygon: [A()], props }).apply(third));
    // The bridge runs straight through plaza_c.
    expect(withThird.plazas['plaza_c']).toBeDefined();
    expect(mergePlazas('plaza_a', 'plaza_b', { into: A_RIGHT, from: B_LEFT }).disabled(withThird)).toBe(false);
  });

  it('works between a hole edge and another plaza, and reports the merged rings without writing', () => {
    const holed = addPlaza({ id: 'plaza_a', polygon: [A(), rect(20, 5, 30, 25, false)], props }).apply(emptyState());
    const s = addPlaza({ id: 'plaza_b', polygon: [B()], props }).apply(holed);
    const made = mergedPlazaPolygon(s, 'plaza_a', 'plaza_b', { into: { ring: 1, segment: 3 }, from: B_LEFT });
    if ('error' in made) throw new Error(made.error);
    expect(made.polygon.length).toBeGreaterThanOrEqual(1);
    expect(s.plazas['plaza_b']).toBeDefined(); // nothing written
  });
});

describe('setPlazaOutline action (평지 모양 수정)', () => {
  it('replaces the rings, rev + 1, and one undo restores the old shape', () => {
    const s0 = deepFreeze(addPlaza({ id: 'plaza_a', polygon: [A()], props }).apply(emptyState()));
    const ring = normalizePlazaRings([rect(0, 0, 40, 34)]);
    const action = setPlazaOutline('plaza_a', ring);
    expect(action.disabled(s0)).toBe(false);
    const s1 = expectInputUntouched(s0, action);
    expect(plazaAreaM2(s1.plazas['plaza_a']!.polygon)).toBeCloseTo(40 * 34, 6);
    expect(s1.plazas['plaza_a']!.props.rev).toBe(2);
    const history = createHistory(s0);
    history.perform(action);
    history.undo();
    expect(history.current()).toEqual(s0);
  });

  it('refuses a broken ring and a self-crossing shape; overlapping another plaza is allowed (linked plazas)', () => {
    const s = twoPlazas();
    expect(setPlazaOutline('plaza_a', [[P(0, 0), P(10, 0)]]).disabled(s)).toMatch(/닫힌 고리/);
    expect(setPlazaOutline('plaza_a', [[P(0, 0), P(40, 30), P(40, 0), P(0, 30), P(0, 0)]]).disabled(s)).toMatch(/겹칩|닫힌|넓이/);
    expect(setPlazaOutline('plaza_a', normalizePlazaRings([rect(30, 0, 80, 30)])).disabled(s)).toBe(false);
    expect(setPlazaOutline('plaza_x', normalizePlazaRings([A()])).disabled(s)).toMatch(/없습니다/);
  });
});
