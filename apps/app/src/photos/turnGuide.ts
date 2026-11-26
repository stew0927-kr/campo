// 로드뷰 사진 위 안내: "앞으로 25m 직진" / "25m 직진 후 왼쪽" / "바로 왼쪽". React를 import하지 않는 순수 모듈.
//
// 1) straightRun: 경로선의 한 점에서 앞으로 걸으며, 진행 방향이 처음 방향(지금까지 걸은 곧은 구간의 방위)에서
//    STRAIGHT_TOL_DEG(45°)를 넘게 꺾이는 첫 구간까지의 실제 거리(m)와 그 꺾임 각도를 잰다. 아주 짧은 꺾임(JOG_M 미만)은
//    복도 선의 흔들림으로 보고 곧은 길에 넣는다. 같은 자리 점이 이어지면(엘리베이터처럼 층만 바뀜) 거기서 멈춘다(꺾임 없음).
// 2) turnGuide: 그 결과와 사진 기준 지금 방향(deltaDeg = 가야 할 방향 − 사진 방향)을 합쳐 화면 문구와 화살표 모양을 정한다.
//    - |deltaDeg| > TURN_ARROW_DEG(45°): 사진에서 바로 꺾는다 → "바로 왼쪽"(ㄱ자).
//    - 앞에 45° 넘는 꺾임이 있으면 → "OOm 직진 후 왼쪽"(ㄱ자), 5m 미만이면 "바로 왼쪽".
//    - 꺾임 없이 끝까지(도착·층 이동) → "앞으로 OOm 직진"(곧은 화살표).
//    거리는 5m 단위 반올림(나침반·GPS 오차가 그보다 크다).
import { initialBearingDeg, signedDiffDeg, type LngLat } from '@campo/core';

/** 이 각도 안의 구간은 곧은 길로 본다. 이보다 크게 꺾이면 "직진 후 왼쪽/오른쪽". */
export const STRAIGHT_TOL_DEG = 45;
/**
 * 사진에서 지금 가야 할 방향이 이보다 크게 어긋나면 바로 꺾는다(ㄱ자). 그 안이면 곧은 화살표(대각선 화살표는 그리지 않는다):
 * 아주 살짝(±SLIGHT_DEG)이면 사진 가운데, 그보다 크면 사진 속 그 방향 쪽으로 조금 옮겨(arrowShift) 곧게 세운다.
 */
export const TURN_ARROW_DEG = 45;
export const SLIGHT_DEG = 15;

/** 곧은 화살표의 가로 위치(0 왼쪽 … 1 오른쪽): 코어 arrowFor의 xRatio를 0.3~0.7로 묶는다. ±SLIGHT_DEG 안이면 가운데. */
export function arrowShift(deltaDeg: number | null, xRatio: number | undefined): number {
  if (deltaDeg === null || Math.abs(deltaDeg) <= SLIGHT_DEG || xRatio === undefined) return 0.5;
  return Math.min(0.7, Math.max(0.3, xRatio));
}
/** 이보다 짧은 꺾인 구간은 선의 흔들림으로 본다(m). */
export const JOG_M = 1.5;
/** 거리 반올림 단위(m). 이보다 짧으면 "바로". */
export const ROUND_M = 5;

const M_PER_DEG_LAT = 110_540, M_PER_DEG_LNG = 111_320;
const metres = (a: LngLat, b: LngLat) => Math.hypot((b[0] - a[0]) * M_PER_DEG_LNG * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * M_PER_DEG_LAT);

export interface StraightRun {
  /** 꺾이기 전까지 곧게 걷는 거리(m, 반올림 전). */
  distanceM: number;
  /** 그 끝에서 꺾는 각도(-180..180, 양수 = 오른쪽). 꺾임 없이 경로 끝·층 이동에 닿으면 null. */
  turnDeg: number | null;
}

/** 경로선 `line`의 `from`번째 점에서 앞으로 곧게 걷는 거리와 그 끝의 꺾임. 점이 없으면 null. */
export function straightRun(line: readonly LngLat[], from: number): StraightRun | null {
  if (from < 0 || from >= line.length) return null;
  const start = line[from]!;
  let walked = 0;
  /** 지금까지 곧은 구간의 방위: 시작점 → 지금 점(흔들림에 강하다). 처음 JOG_M 전에는 첫 구간 방위. */
  let ref: number | null = null;
  for (let j = from; j + 1 < line.length; j++) {
    const a = line[j]!, b = line[j + 1]!;
    const len = metres(a, b);
    if (len < 0.05) {
      // 같은 자리에서 층만 바뀐다(엘리베이터 등): 곧은 길은 여기까지.
      if (walked > 0) return { distanceM: walked, turnDeg: null };
      continue;
    }
    const seg = initialBearingDeg(a, b);
    if (ref !== null) {
      const turn = signedDiffDeg(seg, ref); // 양수 = 오른쪽
      if (Math.abs(turn) > STRAIGHT_TOL_DEG && (len >= JOG_M || j + 2 >= line.length || turnsOn(line, j + 1, ref))) return { distanceM: walked, turnDeg: turn };
    }
    walked += len;
    const end = line[j + 1]!;
    ref = walked >= JOG_M && metres(start, end) > 0.5 ? initialBearingDeg(start, end) : (ref ?? seg);
  }
  return { distanceM: walked, turnDeg: null };
}

/** 짧은 꺾인 구간 다음도 같은 쪽으로 꺾여 있으면(짧은 구간이 이어진 진짜 모퉁이) true. */
function turnsOn(line: readonly LngLat[], at: number, ref: number): boolean {
  let m = 0;
  for (let j = at; j + 1 < line.length && m < JOG_M * 2; j++) {
    const len = metres(line[j]!, line[j + 1]!);
    if (len < 0.05) continue;
    if (Math.abs(signedDiffDeg(initialBearingDeg(line[j]!, line[j + 1]!), ref)) <= STRAIGHT_TOL_DEG) return false;
    m += len;
  }
  return true;
}

/** 5m 단위 반올림. 5m 미만이면 0("바로"). */
export const roundRunM = (m: number): number => (m < ROUND_M ? 0 : Math.round(m / ROUND_M) * ROUND_M);

export type TurnSide = 'left' | 'right';
export interface TurnGuide {
  /** straight: 곧은 화살표, turn: ㄱ자로 꺾인 화살표. */
  kind: 'straight' | 'turn';
  side: TurnSide | null;
  /** 5m 단위로 반올림한 직진 거리. 0이면 "바로". */
  distanceM: number;
  /** 사진 위 짧은 문구: "앞으로 25m 직진" / "25m 직진 후 왼쪽" / "바로 왼쪽". */
  label: string;
  /** 카드·스크린리더 문장: "앞으로 25m 직진하세요." / "25m 직진 후 왼쪽으로 가세요." */
  sentence: string;
}

const SIDE_WORD: Record<TurnSide, string> = { left: '왼쪽', right: '오른쪽' };

/** ㄱ자 안내 하나. */
function turn(side: TurnSide, distanceM: number): TurnGuide {
  const word = SIDE_WORD[side];
  if (distanceM === 0) return { kind: 'turn', side, distanceM, label: `바로 ${word}`, sentence: `바로 ${word}으로 가세요.` };
  return { kind: 'turn', side, distanceM, label: `${distanceM}m 직진 후 ${word}`, sentence: `${distanceM}m 직진 후 ${word}으로 가세요.` };
}
/** 곧은 안내 하나. */
function straight(distanceM: number): TurnGuide {
  if (distanceM === 0) return { kind: 'straight', side: null, distanceM, label: '앞으로 직진', sentence: '앞으로 직진하세요.' };
  return { kind: 'straight', side: null, distanceM, label: `앞으로 ${distanceM}m 직진`, sentence: `앞으로 ${distanceM}m 직진하세요.` };
}

/**
 * 사진 위 안내. `run`: 그 지점에서의 straightRun(모르면 null), `deltaDeg`: 가야 할 방향 − 사진 방향(모르면 null).
 * 둘 다 모르면 null(화살표·문구 없음).
 */
export function turnGuide(run: StraightRun | null, deltaDeg: number | null): TurnGuide | null {
  if (deltaDeg !== null && Math.abs(deltaDeg) > TURN_ARROW_DEG) return turn(deltaDeg > 0 ? 'right' : 'left', 0);
  if (run === null) return deltaDeg === null ? null : straight(0);
  const d = roundRunM(run.distanceM);
  if (run.turnDeg === null) return straight(d);
  return turn(run.turnDeg > 0 ? 'right' : 'left', d);
}
