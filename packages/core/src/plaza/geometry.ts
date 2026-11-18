// 평지(plaza) 기하: 링 정규화, 점 위치, 링 검사, 평지끼리 겹침, 새로 그린 링의 분류, 영역 안 선분 판정.
// 모든 계산은 국소 미터 평면에서 합니다. 표시·검사·길찾기 보조용 순수 함수이고, 높이는 읽지 않습니다.
import type { Position } from '../types.ts';

/** 국소 미터 평면 좌표 [동, 북](m). */
export type XY = [number, number];

/**
 * 기하 판정의 허용오차(m). 위경도를 미터로 바꾼 좌표는 수백 m 범위에서 1e-9 m 수준의 반올림 오차가 있어,
 * 그보다 충분히 크고 사람이 그린 도형의 의미 있는 크기(수 cm)보다 충분히 작은 값으로 한 곳에 둡니다.
 */
export const PLAZA_EPS_M = 1e-6;
/** 구멍과 다른 링, 새로 그린 링과 기존 링 사이에 둬야 하는 최소 간격(m). */
export const PLAZA_MIN_GAP_M = 0.1;
/** 한 평지의 점(모든 링 합계) 상한. */
export const PLAZA_MAX_POSITIONS = 500;

/** 구(球) 반지름(m). @turf/distance와 같은 값이라 길찾기 그래프의 거리와 맞습니다. */
const EARTH_RADIUS_M = 6371008.8;
const M_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;

export interface LocalFrame {
  toXY(p: Position): XY;
  toPos(x: number, y: number): Position;
}

/**
 * 등각 국소 미터 평면: 원점 위도의 cos로 경도를 줄입니다(elevation/breakline.ts의 planar와 같은 방식).
 * 좌우가 뒤집히지 않아 링 방향(CCW = 넓이 양수)이 그대로 유지됩니다.
 */
export function localFrame(origin: Position): LocalFrame {
  const [lng0, lat0] = origin;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const ky = M_PER_DEG;
  return {
    toXY: (p) => [(p[0] - lng0) * kx, (p[1] - lat0) * ky],
    toPos: (x, y) => [lng0 + x / kx, lat0 + y / ky],
  };
}

// ---- 평면 기본 연산 ----

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const cross = (a: XY, b: XY): number => a[0] * b[1] - a[1] * b[0];
const dot = (a: XY, b: XY): number => a[0] * b[0] + a[1] * b[1];
const dist = (a: XY, b: XY): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 닫힌 링(첫 점 = 끝 점)의 부호 있는 넓이. CCW 양수. */
export function ringAreaXY(ring: readonly XY[]): number {
  let s = 0;
  for (let i = 0; i + 1 < ring.length; i++) s += cross(ring[i]!, ring[i + 1]!);
  return s / 2;
}

export function pointSegmentDistance(p: XY, a: XY, b: XY): number {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
  return dist(p, [a[0] + t * ab[0], a[1] + t * ab[1]]);
}

/** 두 선분이 닿거나 교차하는지(허용오차 포함). */
function segmentsTouch(a: XY, b: XY, c: XY, d: XY, eps = PLAZA_EPS_M): boolean {
  return segmentDistance(a, b, c, d) <= eps;
}

/** 두 선분 사이 최소 거리. 교차하면 0. */
export function segmentDistance(a: XY, b: XY, c: XY, d: XY): number {
  if (properOrTouchingCross(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

function properOrTouchingCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** 두 선분이 서로의 안쪽 점에서 엇갈려 지나는지(끝점 접촉·공선은 아님). */
function properCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const scale = Math.max(dist(a, b), dist(c, d), 1);
  const tol = PLAZA_EPS_M * scale;
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return ((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol)) && ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol));
}

/** 짝홀 규칙의 점-in-링. 경계 위는 따로 판정해야 합니다. */
export function pointInRingXY(p: XY, ring: readonly XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringBoundaryDistance(p: XY, ring: readonly XY[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < ring.length; i++) best = Math.min(best, pointSegmentDistance(p, ring[i]!, ring[i + 1]!));
  return best;
}

function ringsDistance(a: readonly XY[], b: readonly XY[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      best = Math.min(best, segmentDistance(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!));
      if (best === 0) return 0;
    }
  }
  return best;
}

function ringsProperlyCross(a: readonly XY[], b: readonly XY[]): boolean {
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) if (properCross(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) return true;
  }
  return false;
}

/** 링이 스스로 겹치는지: 이웃하지 않은 변이 닿거나, 이웃한 변이 되돌아 겹치거나, 길이 0인 변이 있음. */
export function ringSelfIntersectsXY(ring: readonly XY[]): boolean {
  const n = ring.length - 1; // 변 개수(닫힌 링)
  if (n < 3) return true;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    if (dist(a, b) <= PLAZA_EPS_M) return true;
    for (let j = i + 1; j < n; j++) {
      const c = ring[j]!;
      const d = ring[j + 1]!;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // 공유하는 꼭짓점 말고 다른 점에서 닿으면(되돌아가 겹침) 문제입니다.
        const otherA = j === i + 1 ? a : b;
        const otherC = j === i + 1 ? d : c;
        if (pointSegmentDistance(otherA, c, d) <= PLAZA_EPS_M || pointSegmentDistance(otherC, a, b) <= PLAZA_EPS_M) return true;
        continue;
      }
      if (segmentsTouch(a, b, c, d)) return true;
    }
  }
  return false;
}

// ---- 링과 평지 ----

function samePos(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** 첫 점 = 끝 점이 되게 복사합니다. */
export function closeRingPositions(ring: readonly Position[]): Position[] {
  const out = ring.map((p): Position => [p[0], p[1]]);
  if (out.length > 0 && !samePos(out[0]!, out[out.length - 1]!)) out.push([out[0]![0], out[0]![1]]);
  return out;
}

/** 국소 평면에서 잰 링의 부호 있는 넓이(㎡). CCW 양수. */
export function signedAreaM2(ring: Position[]): number {
  if (ring.length < 3) return 0;
  const frame = localFrame(ring[0]!);
  return ringAreaXY(closeRingPositions(ring).map(frame.toXY));
}

/** 닫힘을 보장하고 바깥 링은 CCW, 구멍은 CW로 맞춥니다. 입력은 바꾸지 않습니다. */
export function normalizePlazaRings(rings: Position[][]): Position[][] {
  if (rings.length === 0) return [];
  const frame = localFrame(rings[0]![0] ?? [0, 0]);
  return rings.map((ring, i) => {
    const closed = closeRingPositions(ring);
    const area = ringAreaXY(closed.map(frame.toXY));
    const wantPositive = i === 0;
    return (area > 0) === wantPositive || area === 0 ? closed : closed.reverse();
  });
}

/** 평지 링들을 한 평면(바깥 링 첫 꼭짓점 기준)으로 옮긴 것. */
export interface FramedPlaza {
  frame: LocalFrame;
  /** 정규화된 링(바깥 CCW, 구멍 CW), 닫힘. */
  rings: XY[][];
  /** rings와 같은 순서의 원래 좌표. */
  positions: Position[][];
}

export function framePlaza(rings: Position[][]): FramedPlaza {
  const positions = normalizePlazaRings(rings);
  const frame = localFrame(positions[0]?.[0] ?? [0, 0]);
  return { frame, rings: positions.map((r) => r.map(frame.toXY)), positions };
}

/** 바깥 넓이 − 구멍 넓이(㎡). */
export function plazaAreaM2(rings: Position[][]): number {
  const { rings: xy } = framePlaza(rings);
  return xy.reduce((s, r, i) => s + (i === 0 ? Math.abs(ringAreaXY(r)) : -Math.abs(ringAreaXY(r))), 0);
}

/** 모든 링 둘레의 합(m). */
export function plazaPerimeterM(rings: Position[][]): number {
  const { rings: xy } = framePlaza(rings);
  let s = 0;
  for (const r of xy) for (let i = 0; i + 1 < r.length; i++) s += dist(r[i]!, r[i + 1]!);
  return s;
}

export type PlazaHit = 'solid' | 'hole' | 'outside';

/** 국소 평면의 링들에서 점의 위치. 경계(바깥·구멍 테두리)에서 `tolM` 안이면 'solid'. */
export function locateXY(rings: readonly (readonly XY[])[], p: XY, tolM = PLAZA_EPS_M): PlazaHit {
  for (const r of rings) if (ringBoundaryDistance(p, r) <= tolM) return 'solid';
  const outer = rings[0];
  if (!outer || !pointInRingXY(p, outer)) return 'outside';
  for (let i = 1; i < rings.length; i++) if (pointInRingXY(p, rings[i]!)) return 'hole';
  return 'solid';
}

/** 점이 평지의 고체 영역 안('solid', 테두리 포함)인지, 구멍 안인지, 바깥인지. */
export function locateInPlaza(rings: Position[][], p: Position, tolM = PLAZA_EPS_M): PlazaHit {
  if (rings.length === 0 || rings[0]!.length === 0) return 'outside';
  const { frame, rings: xy } = framePlaza(rings);
  return locateXY(xy, frame.toXY(p), tolM);
}

function isPos(p: unknown): p is Position {
  return Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}

/** E16: 링 모양 문제(닫힘·점 4개 이상·자기 교차·넓이·점 500개 이하, 한국어) 또는 false. */
export function plazaRingProblem(rings: unknown): string | false {
  const shapeOk = Array.isArray(rings) && rings.length > 0 && rings.every((ring) =>
    Array.isArray(ring) && ring.length >= 4 && ring.every(isPos) && samePos(ring[0] as Position, ring[ring.length - 1] as Position));
  if (!shapeOk) return '평지 테두리는 닫힌 고리(첫 점 = 끝 점, 점 4개 이상)여야 합니다.';
  const list = rings as Position[][];
  const total = list.reduce((s, r) => s + r.length, 0);
  if (total > PLAZA_MAX_POSITIONS) return `평지의 점이 너무 많습니다(모두 합쳐 ${PLAZA_MAX_POSITIONS}개 이하로 그려 주세요).`;
  const { rings: xy } = framePlaza(list);
  for (let i = 0; i < xy.length; i++) {
    if (ringSelfIntersectsXY(xy[i]!)) return i === 0 ? '평지 외곽선이 스스로 겹칩니다.' : '구멍 테두리가 스스로 겹칩니다.';
    if (Math.abs(ringAreaXY(xy[i]!)) <= PLAZA_EPS_M) return i === 0 ? '평지 외곽선의 넓이가 없습니다.' : '구멍의 넓이가 없습니다.';
  }
  return false;
}

/** E17: 구멍 배치 문제(바깥으로 나감, 다른 링과 0.1 m 미만, 구멍끼리 겹침, 한국어) 또는 false. 링 모양은 plazaRingProblem이 먼저 봅니다. */
export function plazaHoleProblem(rings: Position[][]): string | false {
  const { rings: xy } = framePlaza(rings);
  const outer = xy[0]!;
  for (let i = 1; i < xy.length; i++) {
    const hole = xy[i]!;
    const d = ringsDistance(hole, outer);
    if (d <= PLAZA_EPS_M && ringsProperlyCross(hole, outer)) return '구멍이 평지 바깥으로 나갑니다.';
    if (!hole.every((p) => pointInRingXY(p, outer) || ringBoundaryDistance(p, outer) <= PLAZA_EPS_M)) return '구멍이 평지 바깥으로 나갑니다.';
    if (d < PLAZA_MIN_GAP_M) return '구멍이 평지 테두리에 너무 가깝습니다(0.1 m 이상 떨어뜨려 주세요).';
  }
  for (let i = 1; i < xy.length; i++) {
    for (let j = i + 1; j < xy.length; j++) {
      const a = xy[i]!;
      const b = xy[j]!;
      const d = ringsDistance(a, b);
      if (d <= PLAZA_EPS_M || pointInRingXY(a[0]!, b) || pointInRingXY(b[0]!, a)) return '구멍끼리 겹칩니다.';
      if (d < PLAZA_MIN_GAP_M) return '구멍끼리 너무 가깝습니다(0.1 m 이상 떨어뜨려 주세요).';
    }
  }
  return false;
}

/**
 * 평지 링의 문제(E16·E17, 한국어) 또는 false. 모든 링은 닫혀 있고 점 4개 이상, 스스로 겹치지 않음.
 * 구멍은 바깥 링 안쪽에 있고 다른 링과 0.1 m 이상 떨어져 있으며 서로 겹치지 않음. 점 합계 500개 이하.
 */
export function plazaProblem(rings: unknown): string | false {
  return plazaRingProblem(rings) || plazaHoleProblem(rings as Position[][]);
}

/** 평지 테두리에서 가장 가까운 점과, 그 점이 어느 링의 어느 변에 있는지. */
export interface PlazaBoundaryHit {
  /** 테두리 위의 점(변의 수선의 발, 꼭짓점에 가까우면 꼭짓점). */
  position: Position;
  /** 점에서 그 점까지의 곧은 거리(m). */
  distanceM: number;
  /** 0 = 바깥 링, 1 이상 = 구멍. */
  ring: number;
  /** 그 링의 변 번호(ring[i] → ring[i+1]). */
  segment: number;
}

/**
 * 평지 테두리(바깥 링·구멍 모두)에서 `p`에 가장 가까운 점. 길찾기용 수선의 발(출입문 → 평지)과 지점 마그넷 스냅이
 * 같은 계산을 썻니다. 빈 평지면 null.
 */
export function nearestOnPlazaBoundary(rings: Position[][], p: Position): PlazaBoundaryHit | null {
  if (rings.length === 0 || rings[0]!.length === 0) return null;
  const { frame, rings: xy } = framePlaza(rings);
  const target = frame.toXY(p);
  let bestAt: XY | null = null;
  let bestD = Infinity;
  let bestRing = 0;
  let bestSegment = 0;
  for (let r = 0; r < xy.length; r++) {
    const ring = xy[r]!;
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[i + 1]!;
      const ab = sub(b, a);
      const len2 = dot(ab, ab);
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(target, a), ab) / len2));
      const at: XY = [a[0] + t * ab[0], a[1] + t * ab[1]];
      const d = dist(target, at);
      if (d < bestD) {
        bestAt = at;
        bestD = d;
        bestRing = r;
        bestSegment = i;
      }
    }
  }
  if (!bestAt) return null;
  return { position: frame.toPos(bestAt[0], bestAt[1]), distanceM: bestD, ring: bestRing, segment: bestSegment };
}

/** 고체 영역 쪽(정규화 후 진행 방향 왼쪽)으로 아주 조금 들어간 표본점들. */
function interiorSamples(rings: readonly XY[][]): XY[] {
  const out: XY[] = [];
  const step = 1e-3;
  for (const r of rings) {
    for (let i = 0; i + 1 < r.length; i++) {
      const a = r[i]!;
      const b = r[i + 1]!;
      const len = dist(a, b);
      if (len === 0) continue;
      const nx = -(b[1] - a[1]) / len;
      const ny = (b[0] - a[0]) / len;
      out.push([(a[0] + b[0]) / 2 + nx * step, (a[1] + b[1]) / 2 + ny * step]);
    }
  }
  return out;
}

/** 두 평지의 고체 영역이 겹치는지. 한 평지가 다른 평지의 구멍 안에 들어 있으면 겹침이 아니고, 테두리만 맞닿아도 겹침이 아닙니다. */
export function plazaRegionsOverlap(a: Position[][], b: Position[][]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const origin = normalizePlazaRings(a)[0]![0]!;
  const frame = localFrame(origin);
  const ra = normalizePlazaRings(a).map((r) => r.map(frame.toXY));
  const rb = normalizePlazaRings(b).map((r) => r.map(frame.toXY));
  for (const x of ra) for (const y of rb) if (ringsProperlyCross(x, y)) return true;
  const strictlySolid = (rings: XY[][], p: XY) => locateXY(rings, p, 0) === 'solid' && rings.every((r) => ringBoundaryDistance(p, r) > PLAZA_EPS_M);
  return interiorSamples(ra).some((p) => strictlySolid(rb, p)) || interiorSamples(rb).some((p) => strictlySolid(ra, p));
}

export type PlazaDraw =
  | { kind: 'hole'; plazaId: string }
  | { kind: 'new'; insideHoleOf?: string }
  | { kind: 'error'; message: string };

/**
 * 편집기에서 새로 그린 닫힌 링이 무엇인지: 어떤 평지의 고체 영역 안에 통째로 있으면(테두리와 0.1 m 이상 떨어져) 그 평지의
 * 구멍, 그 밖에는 새 평지입니다. 새 평지는 다른 평지와 떨어져 있어도, 테두리가 맞닿아도, 일부 겹쳐도 됩니다(맞닿거나 겹친
 * 평지끼리는 서로 이어진 평지로 봅니다, SPEC-v0.2 2.8). 거절하는 것: 스스로 겹침·넓이 없음, 이미 있는 구멍을 감싸는 구멍,
 * 테두리에 0.1 m 안으로 붙은 구멍(구멍-테두리 간격 규칙), 다른 평지를 통째로 감싸는 새 평지.
 */
export function classifyPlazaRing(plazas: Iterable<{ id: string; polygon: Position[][] }>, ring: Position[]): PlazaDraw {
  const closed = closeRingPositions(ring);
  if (closed.length < 4) return { kind: 'error', message: '점을 세 개 이상 찍어 닫힌 도형을 그려 주세요.' };
  const frame = localFrame(closed[0]!);
  const r = closed.map(frame.toXY);
  if (ringSelfIntersectsXY(r)) return { kind: 'error', message: '그린 테두리가 스스로 겹칩니다.' };
  if (Math.abs(ringAreaXY(r)) <= PLAZA_EPS_M) return { kind: 'error', message: '그린 도형의 넓이가 없습니다.' };

  let holeOf: string | undefined;
  let insideHoleOf: string | undefined;
  const list = [...plazas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const insideOrOn = (p: XY) => pointInRingXY(p, r) || ringBoundaryDistance(p, r) <= PLAZA_EPS_M;
  for (const p of list) {
    if (p.polygon.length === 0) continue;
    const rings = normalizePlazaRings(p.polygon).map((x) => x.map(frame.toXY));
    const outer = rings[0]!;
    const hits = r.slice(0, -1).map((v) => locateXY(rings, v, 0));
    if (hits.every((h) => h === 'solid') && !ringsProperlyCross(r, outer)) {
      // Inside the plaza: a hole of it, kept clear of every ring of the plaza.
      if (rings.slice(1).some((x) => pointInRingXY(x[0]!, r))) return { kind: 'error', message: '이 안에 이미 구멍이 있습니다. 먼저 그 구멍을 지워 주세요.' };
      const dOuter = ringsDistance(r, outer);
      const dHoles = Math.min(Infinity, ...rings.slice(1).map((x) => ringsDistance(r, x)));
      if (dHoles <= PLAZA_EPS_M) return { kind: 'error', message: '구멍 테두리를 가로지릅니다. 구멍과 떨어뜨려 그려 주세요.' };
      if (Math.min(dOuter, dHoles) < PLAZA_MIN_GAP_M) return { kind: 'error', message: '평지 테두리에 너무 가깝습니다(구멍은 테두리와 0.1 m 이상 떨어뜨려 주세요).' };
      holeOf ??= p.id;
      continue;
    }
    // Around the whole plaza (its outline inside the new ring, the two not crossing): one would hide the other.
    if (!ringsProperlyCross(r, outer) && outer.every(insideOrOn) && hits.every((h) => h === 'outside')) {
      return { kind: 'error', message: '다른 평지를 통째로 감쌉니다. 바깥 평지를 먼저 그리고 안쪽에 구멍을 뚫어 주세요.' };
    }
    // Apart, touching, overlapping in part: a new plaza. Wholly in one hole of the plaza: an island in it.
    if (hits.every((h) => h === 'hole') && !rings.some((x) => ringsProperlyCross(r, x))) {
      const holeIdx = rings.findIndex((x, i) => i > 0 && pointInRingXY(r[0]!, x));
      if (holeIdx > 0 && r.every((v) => pointInRingXY(v, rings[holeIdx]!) || ringBoundaryDistance(v, rings[holeIdx]!) <= PLAZA_EPS_M)) insideHoleOf ??= p.id;
    }
  }
  if (holeOf !== undefined) return { kind: 'hole', plazaId: holeOf };
  return insideHoleOf !== undefined ? { kind: 'new', insideHoleOf } : { kind: 'new' };
}

/** 평지끼리 맞닿았다고 보는 거리(m). 이 안이면 테두리가 맞닿은 것으로 보고 서로 오갈 수 있습니다. */
export const PLAZA_LINK_TOL_M = 0.01;

/**
 * 두 평지가 이어져 있는지: 테두리(바깥·구멍)끼리 PLAZA_LINK_TOL_M 안으로 맞닿거나(변·꼭짓점), 고체 영역이 일부라도 겹치면
 * true. 한 평지가 다른 평지의 구멍 안에 떨어져 있으면 false.
 */
export function plazasLinked(a: Position[][], b: Position[][], tolM = PLAZA_LINK_TOL_M): boolean {
  if (a.length === 0 || b.length === 0 || a[0]!.length === 0 || b[0]!.length === 0) return false;
  const frame = localFrame(normalizePlazaRings(a)[0]![0]!);
  const ra = normalizePlazaRings(a).map((r) => r.map(frame.toXY));
  const rb = normalizePlazaRings(b).map((r) => r.map(frame.toXY));
  for (const x of ra) for (const y of rb) if (ringsDistance(x, y) <= tolM) return true;
  return plazaRegionsOverlap(a, b);
}

/**
 * 서로 이어진 평지 묶음(맞닿음·겹침을 따라 이어진 연결 요소). 각 묶음은 id 순, 묶음은 첫 id 순입니다.
 * 묶음 안의 평지끼리는 걸어서 건너갈 수 있습니다(길찾기의 평지 전이).
 */
export function plazaClusters(plazas: Iterable<{ id: string; polygon: Position[][] }>, tolM = PLAZA_LINK_TOL_M): string[][] {
  const list = [...plazas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const parent = list.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const frame = list.length > 0 && list[0]!.polygon[0]?.[0] ? localFrame(list[0]!.polygon[0]![0]!) : null;
  const box = list.map((p) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of p.polygon.slice(0, 1)) for (const q of ring) {
      const [x, y] = frame!.toXY(q);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return [x0, y0, x1, y1] as const;
  });
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [box[i]!, box[j]!];
      if (a[0] > b[2] + tolM || b[0] > a[2] + tolM || a[1] > b[3] + tolM || b[1] > a[3] + tolM) continue;
      if (find(i) === find(j)) continue;
      if (plazasLinked(list[i]!.polygon, list[j]!.polygon, tolM)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, string[]>();
  list.forEach((p, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), p.id]);
  });
  return [...groups.values()].sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
}

/**
 * 국소 평면의 선분 a→b가 평지 영역(고체, 테두리 포함) 안에만 있는지. 선분을 모든 링과의 교차 매개변수에서 쪼갠 뒤
 * 각 조각의 중점이 'solid'인지 봅니다. 테두리를 따라가거나 꼭짓점을 지나는 것은 허용합니다.
 */
export function segmentInPlazaDomain(frameRings: readonly (readonly XY[])[], a: XY, b: XY): boolean {
  const r = sub(b, a);
  const len2 = dot(r, r);
  if (len2 <= PLAZA_EPS_M * PLAZA_EPS_M) return locateXY(frameRings, a) === 'solid';
  const ts = [0, 1];
  const tTol = 1e-12;
  for (const ring of frameRings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const c = ring[i]!;
      const d = ring[i + 1]!;
      const s = sub(d, c);
      const denom = cross(r, s);
      const ca = sub(c, a);
      if (Math.abs(denom) > 1e-12 * Math.sqrt(len2 * dot(s, s))) {
        const t = cross(ca, s) / denom;
        const u = cross(ca, r) / denom;
        if (t > tTol && t < 1 - tTol && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
      } else if (Math.abs(cross(ca, r)) <= PLAZA_EPS_M * Math.sqrt(len2)) {
        for (const q of [c, d]) {
          const t = dot(sub(q, a), r) / len2;
          if (t > tTol && t < 1 - tTol) ts.push(t);
        }
      }
    }
  }
  ts.sort((x, y) => x - y);
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if (t1 - t0 <= tTol) continue;
    const m = (t0 + t1) / 2;
    if (locateXY(frameRings, [a[0] + m * r[0], a[1] + m * r[1]]) !== 'solid') return false;
  }
  return true;
}

/** 선분 a→b와 선분 c→d의 교점(매개변수 t는 a→b 기준). 평행이면 공선 겹침의 끝점들. */
export function segmentIntersections(a: XY, b: XY, c: XY, d: XY): { t: number; at: XY }[] {
  const r = sub(b, a);
  const s = sub(d, c);
  const len2 = dot(r, r);
  if (len2 === 0) return [];
  const denom = cross(r, s);
  const ca = sub(c, a);
  const out: { t: number; at: XY }[] = [];
  if (Math.abs(denom) > 1e-12 * Math.sqrt(len2 * dot(s, s))) {
    const t = cross(ca, s) / denom;
    const u = cross(ca, r) / denom;
    if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) {
      const tc = Math.max(0, Math.min(1, t));
      out.push({ t: tc, at: [a[0] + tc * r[0], a[1] + tc * r[1]] });
    }
  } else if (Math.abs(cross(ca, r)) <= PLAZA_EPS_M * Math.sqrt(len2)) {
    for (const q of [c, d]) {
      const t = dot(sub(q, a), r) / len2;
      if (t >= 0 && t <= 1) out.push({ t, at: [a[0] + t * r[0], a[1] + t * r[1]] });
    }
  }
  return out;
}

/**
 * 검사 W17용: 평지가 길망과 닿는지. 바깥 지점 하나라도 고체 영역 안(테두리에서 `tolM` 안 포함)이거나,
 * 걷는 구간 하나라도 평지의 어느 링과 만나면 true.
 */
export function plazaTouchesNetwork(rings: Position[][], nodes: Iterable<Position>, edges: Iterable<readonly Position[]>, tolM = 0.3): boolean {
  if (rings.length === 0 || rings[0]!.length === 0) return false;
  const { frame, rings: xy } = framePlaza(rings);
  for (const n of nodes) if (locateXY(xy, frame.toXY(n), tolM) === 'solid') return true;
  for (const line of edges) {
    const pts = line.map(frame.toXY);
    for (let i = 0; i + 1 < pts.length; i++) {
      for (const ring of xy) {
        for (let j = 0; j + 1 < ring.length; j++) {
          if (segmentDistance(pts[i]!, pts[i + 1]!, ring[j]!, ring[j + 1]!) <= PLAZA_EPS_M) return true;
        }
      }
    }
  }
  return false;
}
