// 경사 경고 묶기: 화면과 상관없는 순수 함수(React를 쓰지 않는다).
// 코어는 경사 구간을 구간(edge) 하나마다 돌려주므로, 길게 이어진 급경사는 같은 경고가 여러 장 생긴다.
// 경로 순서상 바로 이어지고 등급·방향이 같은 경고를 한 구간으로 묶고, 경로선에서 잘라 낸 좌표를 함께 담는다.
import { STEEP_NOTE } from '@campo/core';
import type { SlopeWarning } from '../contracts.ts';

const EARTH_RADIUS_M = 6_371_008.8;
/** 두 [경도, 위도] 사이의 대원 거리(m). */
export function distanceM(a: readonly [number, number], b: readonly [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 선의 길이(m). */
export function lineLengthM(coordinates: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let i = 1; i < coordinates.length; i++) sum += distanceM(coordinates[i - 1]!, coordinates[i]!);
  return sum;
}

export type SlopeDirection = 'up' | 'down' | 'flat';

/** 하나로 묶인 경사 구간. 하단 시트의 카드 한 장, 지도 위 강조선 하나. */
export interface SlopeSection {
  /** 묶인 첫 구간의 edgeId와 순서로 만든 고유 키. 같은 경로에서 바뀌지 않는다. */
  key: string;
  gradeClass: SlopeWarning['gradeClass'];
  direction: SlopeDirection;
  /** 묶인 구간 중 가장 가파른 경사(절댓값, %). */
  maxGradePct: number;
  /** 경로선 기준 길이(m). 좌표가 없으면 null. */
  lengthM: number | null;
  /** 경로선에서 잘라 낸 좌표([경도, 위도], 진행 방향). 경로선에서 자리를 찾지 못한 경고만 있으면 빈 배열. */
  coordinates: [number, number][];
  /** 묶인 원래 경고(진행 순서). */
  warnings: SlopeWarning[];
  /** 화면에 그대로 쓰는 문장. 예: "급경사 구간 (내리막 · 최대 12.6% · 약 45m) · 경사가 급한 길입니다". */
  message: string;
}

const directionOf = (gradePct: number): SlopeDirection => (gradePct > 0 ? 'up' : gradePct < 0 ? 'down' : 'flat');
const DIRECTION_LABEL: Record<SlopeDirection, string> = { up: '오르막', down: '내리막', flat: '평지' };

/** 앞 경고 바로 뒤에 이어지는가: 경로선 자리가 맞닿아야 한다(앞 구간의 끝 index = 다음 구간의 시작 index). */
function continues(previous: SlopeWarning, next: SlopeWarning): boolean {
  const a = previous.polylineRange;
  const b = next.polylineRange;
  return a !== undefined && b !== undefined && a[1] === b[0];
}

function messageOf(section: Omit<SlopeSection, 'message'>): string {
  const word = section.gradeClass === 'steep' ? '급경사 구간' : '경사 구간';
  const parts = [DIRECTION_LABEL[section.direction], `최대 ${section.maxGradePct}%`];
  if (section.lengthM !== null) parts.push(`약 ${Math.max(1, Math.round(section.lengthM))}m`);
  const tail = section.gradeClass === 'steep' ? ` · ${STEEP_NOTE}` : '';
  return `${word} (${parts.join(' · ')})${tail}`;
}

/**
 * 경로 순서상 바로 이어지고(경로선 자리가 맞닿고) 등급(급경사/경사)과 방향(오르막/내리막)이 같은 경고를 한 구간으로 묶는다.
 * 사이에 다른 등급의 경고나 경사 경고가 없는 길이 끼면 끊긴다. 좌표는 앞 구간의 끝점과 다음 구간의 첫 점이 같으므로 한 번만 담는다.
 */
export function slopeSections(warnings: readonly SlopeWarning[]): SlopeSection[] {
  const groups: SlopeWarning[][] = [];
  for (const warning of warnings) {
    const group = groups[groups.length - 1];
    const previous = group?.[group.length - 1];
    if (group && previous && previous.gradeClass === warning.gradeClass && directionOf(previous.gradePct) === directionOf(warning.gradePct)
      && directionOf(warning.gradePct) !== 'flat' && continues(previous, warning)) group.push(warning);
    else groups.push([warning]);
  }
  return groups.map((group, i) => {
    const first = group[0]!;
    const coordinates: [number, number][] = [];
    for (const warning of group) {
      const line = warning.coordinates ?? [];
      coordinates.push(...(coordinates.length > 0 ? line.slice(1) : line).map((p): [number, number] => [p[0], p[1]]));
    }
    const base = {
      key: `${i}:${first.edgeId}`,
      gradeClass: first.gradeClass,
      direction: directionOf(first.gradePct),
      maxGradePct: Math.max(...group.map((w) => Math.abs(w.gradePct))),
      lengthM: coordinates.length >= 2 ? lineLengthM(coordinates) : null,
      coordinates,
      warnings: group,
    };
    return { ...base, message: messageOf(base) };
  });
}
