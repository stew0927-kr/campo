// 위치 안내 경과 시간과 '안내 종료' 요약(걸린 시간 · 이동 거리 · 오르막)을 위한 순수 모듈(React 없음).
// 시간은 시작 시각과 지금 시각의 차이로만 잰다(1초 타이머를 세지 않는다): 앱이 백그라운드에 있거나 화면이 꺼져도 맞다.
// 거리는 GPS fix 사이의 거리를 더한다. 정확도가 나쁜 fix, 제자리 떨림(정확도보다 작은 움직임), 사람이 걸을 수 없는 속도의
// 튐은 거른다. 오르막은 기압 고도(baroDeltaM) 변화 중 올라간 것만 더하고, 기압 떨림은 히스테리시스로 거른다.
import type { SensorFix } from '@campo/core';

/** 이보다 정확도가 나쁜(m) fix는 거리 계산에 쓰지 않는다. */
export const MAX_ACCURACY_M = 25;
/** 이보다 작은 움직임(m)은 제자리 떨림으로 보고 더하지 않는다(두 fix 정확도가 나쁘면 그만큼 더 크게 본다). */
export const MIN_MOVE_M = 3;
/** 이보다 빠른(m/s) 이동은 GPS 튐으로 보고 거리를 더하지 않는다(뛰어도 넘기 어려운 값). */
export const MAX_SPEED_MPS = 7;
/** 기압 고도가 기준보다 이만큼(m) 올라가야 오르막으로 센다. 내려가면 기준만 따라 내려간다. */
export const CLIMB_STEP_M = 1;

export interface NavTrack {
  startMs: number;
  distanceM: number;
  climbM: number;
  /** 거리를 잰 마지막 기준점. */
  anchor: { lat: number; lng: number; tMs: number; accuracyM: number } | null;
  /** 오르막을 잰 기압 고도 기준(m). null: 기압 값을 아직 받지 못함. */
  baroRef: number | null;
  /** 거리 계산에 쓸 만한 fix를 받았는가. */
  hasPosition: boolean;
}

export const startTrack = (startMs: number): NavTrack => ({ startMs, distanceM: 0, climbM: 0, anchor: null, baroRef: null, hasPosition: false });

/** 두 점 사이 거리(m, 하버사인). */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_008.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** fix 하나를 더한 새 기록(원래 기록은 바꾸지 않는다). */
export function addFix(track: NavTrack, fix: SensorFix): NavTrack {
  let next = track;
  if (typeof fix.baroDeltaM === 'number' && Number.isFinite(fix.baroDeltaM)) {
    const h = fix.baroDeltaM;
    if (next.baroRef === null) next = { ...next, baroRef: h };
    else if (h - next.baroRef >= CLIMB_STEP_M) next = { ...next, climbM: next.climbM + (h - next.baroRef), baroRef: h };
    else if (next.baroRef - h >= CLIMB_STEP_M) next = { ...next, baroRef: h };
  }
  if (!(fix.accuracyM <= MAX_ACCURACY_M) || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return next;
  const here = { lat: fix.lat, lng: fix.lng, tMs: fix.tMs, accuracyM: fix.accuracyM };
  if (next.anchor === null) return { ...next, anchor: here, hasPosition: true };
  const d = haversineM(next.anchor, here);
  // 제자리 떨림: 두 fix의 정확도 평균의 절반과 MIN_MOVE_M 중 큰 값보다 작으면 기준점을 그대로 둔다(천천히 걸어도 쌓이면 넘는다).
  if (d < Math.max(MIN_MOVE_M, (next.anchor.accuracyM + here.accuracyM) / 4)) return next;
  const dt = (here.tMs - next.anchor.tMs) / 1000;
  // 튐: 너무 빠르면 거리를 더하지 않고 기준점만 옮긴다(그 자리에 머물면 다음부터 다시 쌓인다).
  if (dt <= 0 || d / dt > MAX_SPEED_MPS) return { ...next, anchor: here };
  return { ...next, distanceM: next.distanceM + d, anchor: here };
}

export interface NavSummary {
  elapsedSec: number;
  /** null: 위치를 받지 못해 재지 못함. */
  distanceM: number | null;
  /** null: 기압 값을 받지 못해 재지 못함. */
  climbM: number | null;
}

export function summarize(track: NavTrack, nowMs: number): NavSummary {
  return {
    elapsedSec: elapsedSec(track.startMs, nowMs),
    distanceM: track.hasPosition ? track.distanceM : null,
    climbM: track.baroRef === null ? null : track.climbM,
  };
}

/** 시작 시각부터 지금까지 지난 초(음수·NaN이면 0). */
export const elapsedSec = (startMs: number, nowMs: number): number => (Number.isFinite(nowMs - startMs) ? Math.max(0, Math.floor((nowMs - startMs) / 1000)) : 0);

/** MM:SS. 한 시간을 넘으면 분이 60을 넘어간다(예: 75:03). */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export interface Measure { value: string; unit: string }
/** 걸린 시간: 1분 미만은 초, 1시간 미만은 분(반올림 없이 내림)·초, 그 위는 시간·분. */
export function formatDuration(sec: number): Measure[] {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return [{ value: String(s), unit: '초' }];
  if (s < 3600) return [{ value: String(Math.floor(s / 60)), unit: '분' }, ...(s % 60 ? [{ value: String(s % 60), unit: '초' }] : [])];
  return [{ value: String(Math.floor(s / 3600)), unit: '시간' }, ...(Math.floor(s / 60) % 60 ? [{ value: String(Math.floor(s / 60) % 60), unit: '분' }] : [])];
}
/** 이동 거리: 1 km 미만은 m(정수), 그 위는 km(소수 한 자리). */
export function formatDistance(m: number): Measure {
  return m < 1000 ? { value: String(Math.round(m)), unit: 'm' } : { value: (m / 1000).toFixed(1), unit: 'km' };
}
/** 오르막: m(정수). */
export const formatClimb = (m: number): Measure => ({ value: String(Math.round(m)), unit: 'm' });

/** 값이 없을 때의 표시. */
export const NOT_MEASURED = '측정 안 됨';
