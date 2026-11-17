import { describe, expect, it } from 'vitest';
import {
  classifyPlazaRing,
  framePlaza,
  locateInPlaza,
  normalizePlazaRings,
  plazaAreaM2,
  plazaPerimeterM,
  plazaProblem,
  plazaRegionsOverlap,
  plazaTouchesNetwork,
  segmentInPlazaDomain,
  signedAreaM2,
} from '../../src/index.ts';
import { F, P, rect, ring } from './helpers.ts';

const square = [rect(0, 0, 20, 20), rect(7, 7, 13, 13, false)];

describe('local frame and rings', () => {
  it('round-trips metres and keeps orientation', () => {
    const [x, y] = F.toXY(F.toPos(12.5, -3.25));
    expect(x).toBeCloseTo(12.5, 9);
    expect(y).toBeCloseTo(-3.25, 9);
    expect(signedAreaM2(rect(0, 0, 10, 5))).toBeCloseTo(50, 6);
    expect(signedAreaM2(rect(0, 0, 10, 5, false))).toBeCloseTo(-50, 3);
  });

  it('normalizes: closed, outer CCW, holes CW, input untouched', () => {
    const open = rect(0, 0, 20, 20, false).slice(0, -1);
    const hole = rect(7, 7, 13, 13, true);
    const input = [open, hole];
    const copy = JSON.parse(JSON.stringify(input)) as typeof input;
    const out = normalizePlazaRings(input);
    expect(input).toEqual(copy);
    expect(out[0]![0]).toEqual(out[0]![out[0]!.length - 1]);
    expect(signedAreaM2(out[0]!)).toBeGreaterThan(0);
    expect(signedAreaM2(out[1]!)).toBeLessThan(0);
  });

  it('area is outer minus holes, perimeter sums every ring', () => {
    expect(plazaAreaM2(square)).toBeCloseTo(400 - 36, 4);
    expect(plazaPerimeterM(square)).toBeCloseTo(80 + 24, 4);
  });
});

describe('locateInPlaza', () => {
  it('solid, hole, outside and boundary', () => {
    expect(locateInPlaza(square, P(3, 3))).toBe('solid');
    expect(locateInPlaza(square, P(10, 10))).toBe('hole');
    expect(locateInPlaza(square, P(25, 3))).toBe('outside');
    expect(locateInPlaza(square, P(0, 5))).toBe('solid'); // outer boundary
    expect(locateInPlaza(square, P(7, 10))).toBe('solid'); // hole boundary
    expect(locateInPlaza(square, P(20.2, 5), 0.3)).toBe('solid');
    expect(locateInPlaza(square, P(20.2, 5))).toBe('outside');
  });
});

describe('plazaProblem (E16 / E17)', () => {
  it('accepts a plaza with a hole', () => {
    expect(plazaProblem(square)).toBe(false);
  });
  it('open ring and too few points', () => {
    expect(plazaProblem([rect(0, 0, 5, 5).slice(0, -1)])).toMatch(/닫힌 고리/);
    expect(plazaProblem([[P(0, 0), P(1, 0), P(0, 0)]])).toMatch(/닫힌 고리/);
    expect(plazaProblem([])).toMatch(/닫힌 고리/);
  });
  it('bow tie crosses itself', () => {
    expect(plazaProblem([ring([[0, 0], [10, 10], [10, 0], [0, 10]])])).toBe('평지 외곽선이 스스로 겹칩니다.');
  });
  it('hole outside, touching, overlapping and closer than 0.1 m', () => {
    expect(plazaProblem([rect(0, 0, 20, 20), rect(15, 5, 25, 10, false)])).toBe('구멍이 평지 바깥으로 나갑니다.');
    expect(plazaProblem([rect(0, 0, 20, 20), rect(30, 5, 35, 10, false)])).toBe('구멍이 평지 바깥으로 나갑니다.');
    expect(plazaProblem([rect(0, 0, 20, 20), rect(0, 5, 5, 10, false)])).toMatch(/너무 가깝습니다/);
    expect(plazaProblem([rect(0, 0, 20, 20), rect(0.05, 5, 5, 10, false)])).toMatch(/너무 가깝습니다/);
    expect(plazaProblem([rect(0, 0, 20, 20), rect(0.2, 5, 5, 10, false)])).toBe(false);
    expect(plazaProblem([rect(0, 0, 20, 20), rect(2, 2, 8, 8, false), rect(6, 6, 12, 12, false)])).toBe('구멍끼리 겹칩니다.');
    expect(plazaProblem([rect(0, 0, 20, 20), rect(2, 2, 8, 8, false), rect(8.05, 2, 12, 8, false)])).toMatch(/구멍끼리 너무 가깝습니다/);
    expect(plazaProblem([rect(0, 0, 20, 20), rect(2, 2, 12, 12, false), rect(4, 4, 6, 6, false)])).toBe('구멍끼리 겹칩니다.');
  });
  it('more than 500 positions', () => {
    const pts: [number, number][] = Array.from({ length: 501 }, (_, i) => [10 * Math.cos((2 * Math.PI * i) / 501), 10 * Math.sin((2 * Math.PI * i) / 501)]);
    expect(plazaProblem([ring(pts)])).toMatch(/500/);
  });
});

describe('plazaRegionsOverlap', () => {
  it('overlapping, apart, sharing an edge, nested in a hole, nested in solid', () => {
    expect(plazaRegionsOverlap([rect(0, 0, 10, 10)], [rect(5, 5, 15, 15)])).toBe(true);
    expect(plazaRegionsOverlap([rect(0, 0, 10, 10)], [rect(20, 0, 30, 10)])).toBe(false);
    expect(plazaRegionsOverlap([rect(0, 0, 10, 10)], [rect(10, 0, 20, 10)])).toBe(false);
    expect(plazaRegionsOverlap(square, [rect(8, 8, 12, 12)])).toBe(false);
    expect(plazaRegionsOverlap(square, [rect(1, 1, 5, 5)])).toBe(true);
    expect(plazaRegionsOverlap([rect(1, 1, 5, 5)], square)).toBe(true);
    expect(plazaRegionsOverlap([rect(0, 0, 10, 10)], [rect(0, 0, 10, 10)])).toBe(true);
  });
});

describe('classifyPlazaRing', () => {
  const plazas = [
    { id: 'pA', polygon: square },
    { id: 'pB', polygon: [rect(40, 0, 60, 20)] },
  ];
  it('inside solid: a hole of that plaza', () => {
    expect(classifyPlazaRing(plazas, rect(2, 2, 5, 5))).toEqual({ kind: 'hole', plazaId: 'pA' });
  });
  it('around an existing hole: error', () => {
    expect(classifyPlazaRing(plazas, rect(5, 5, 15, 15))).toEqual({ kind: 'error', message: expect.stringMatching(/먼저 그 구멍을 지워/) });
  });
  it('around a whole plaza: error', () => {
    expect(classifyPlazaRing(plazas, rect(35, -5, 65, 25))).toEqual({ kind: 'error', message: expect.stringMatching(/바깥 평지를 먼저 그리고/) });
  });
  it('crossing a ring: error', () => {
    expect(classifyPlazaRing(plazas, rect(15, 2, 25, 5))).toEqual({ kind: 'error', message: '다른 평지의 테두리를 가로지릅니다.' });
    expect(classifyPlazaRing(plazas, rect(9, 9, 15, 11))).toEqual({ kind: 'error', message: '다른 평지의 테두리를 가로지릅니다.' });
  });
  it('inside a hole: a new plaza (an island)', () => {
    expect(classifyPlazaRing(plazas, rect(8, 8, 12, 12))).toEqual({ kind: 'new', insideHoleOf: 'pA' });
  });
  it('apart from every plaza: new', () => {
    expect(classifyPlazaRing(plazas, rect(70, 0, 80, 10))).toEqual({ kind: 'new' });
    expect(classifyPlazaRing([], rect(0, 0, 3, 3).slice(0, -1))).toEqual({ kind: 'new' });
  });
  it('within 0.1 m of a ring: error', () => {
    expect(classifyPlazaRing(plazas, rect(0.05, 2, 5, 5)).kind).toBe('error');
    expect(classifyPlazaRing(plazas, rect(60.05, 0, 70, 10)).kind).toBe('error');
    expect(classifyPlazaRing(plazas, rect(7.05, 8, 12, 12)).kind).toBe('error');
  });
  it('self-crossing or degenerate drawings: error', () => {
    expect(classifyPlazaRing(plazas, ring([[70, 0], [80, 10], [80, 0], [70, 10]]))).toEqual({ kind: 'error', message: '그린 테두리가 스스로 겹칩니다.' });
    expect(classifyPlazaRing(plazas, [P(70, 0), P(71, 0)]).kind).toBe('error');
  });
});

describe('segmentInPlazaDomain', () => {
  const { frame, rings } = framePlaza(square);
  const xy = (x: number, y: number) => frame.toXY(P(x, y));
  it('inside, through a hole, along the boundary, through a vertex, outside', () => {
    expect(segmentInPlazaDomain(rings, xy(2, 2), xy(18, 2))).toBe(true);
    expect(segmentInPlazaDomain(rings, xy(2, 10), xy(18, 10))).toBe(false);
    expect(segmentInPlazaDomain(rings, xy(0, 0), xy(20, 0))).toBe(true);
    expect(segmentInPlazaDomain(rings, xy(7, 7), xy(13, 7))).toBe(true);
    expect(segmentInPlazaDomain(rings, xy(2, 2), xy(7, 7))).toBe(true);
    expect(segmentInPlazaDomain(rings, xy(7, 13), xy(13, 13))).toBe(true);
    expect(segmentInPlazaDomain(rings, xy(2, 2), xy(25, 2))).toBe(false);
    expect(segmentInPlazaDomain(rings, xy(2, 2), xy(2, 2))).toBe(true);
  });
  it('L-shaped plaza: a chord across the notch leaves the area', () => {
    const l = framePlaza([ring([[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]])]);
    const at = (x: number, y: number) => l.frame.toXY(P(x, y));
    expect(segmentInPlazaDomain(l.rings, at(15, 5), at(5, 15))).toBe(true); // passes the reflex corner (10, 10)
    expect(segmentInPlazaDomain(l.rings, at(18, 8), at(8, 18))).toBe(false);
  });
});

describe('plazaTouchesNetwork', () => {
  it('a node inside or near, an edge crossing, or nothing', () => {
    expect(plazaTouchesNetwork(square, [P(3, 3)], [])).toBe(true);
    expect(plazaTouchesNetwork(square, [P(-0.2, 3)], [])).toBe(true);
    expect(plazaTouchesNetwork(square, [P(-1, 3)], [])).toBe(false);
    expect(plazaTouchesNetwork(square, [], [[P(-5, 3), P(25, 3)]])).toBe(true);
    expect(plazaTouchesNetwork(square, [], [[P(-5, 30), P(25, 30)]])).toBe(false);
  });
});
