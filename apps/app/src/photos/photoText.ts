// 사진 안내에서 화면과 스크린리더가 그대로 쓰는 한국어 문구(존댓말). 화면에서 새로 만들지 않고 여기 것을 쓴다.
// React를 import하지 않는 순수 모듈.
import type { PhotoArrow } from '../contracts.ts';

/** ±45° 밖(±90° 안)에서 고른 사진에 붙는 배지. */
export const APPROXIMATE_BADGE = '정면이 아닐 수 있습니다';
/** 단계에 사진이 없을 때. */
export const NO_PHOTO_TEXT = '이 지점은 아직 사진이 없습니다. 안내 문구와 지도를 보고 이동해 주세요.';
/** 사진을 불러오지 못했을 때. */
export const PHOTO_LOAD_FAILED_TEXT = '사진을 불러오지 못했습니다. 안내 문구와 지도를 보고 이동해 주세요.';
/** 도착 지점 페이지의 단계 문구. */
export const ARRIVAL_TEXT = '도착 지점입니다.';

/** "3 / 7 · 공학관 2층 엘리베이터 앞". 장소 이름이 없으면 번호만. */
export function photoCounterText(index: number, total: number, place?: string | null): string {
  const head = `${index + 1} / ${total}`;
  return place ? `${head} · ${place}` : head;
}

/** "이 지점 다른 사진(2)". */
export const otherPhotosButtonText = (count: number): string => `이 지점 다른 사진(${count})`;

/**
 * 화살표를 말로: "사진 정면 방향으로 가세요", "사진 정면에서 약간 오른쪽(약 30°)으로 가세요", "뒤로 돌아서 가세요".
 * 각도는 5° 단위로 반올림한다(나침반 오차가 그보다 크다).
 */
export function arrowSentence(arrow: PhotoArrow): string {
  const deg = Math.round(Math.abs(arrow.rotateDeg) / 5) * 5;
  if (arrow.label === '정면') return '사진 정면 방향으로 가세요.';
  if (arrow.label === '뒤로' || arrow.mode === 'behind') return `뒤로 돌아서(약 ${deg}°) 가세요.`;
  return `사진 정면에서 ${arrow.label}(약 ${deg}°)으로 가세요.`;
}

/** 스크린리더 레이블: "사진 3/7, 공학관 2층 엘리베이터 앞. 사진 정면에서 오른쪽(약 30°)으로 가세요. 사진 오른쪽 두 번째 문." */
export function photoAccessibilityLabel(input: {
  index: number;
  total: number;
  place?: string | null;
  arrow: PhotoArrow | null;
  hint?: string | null;
  badge?: string | null;
}): string {
  const parts = [`사진 ${input.index + 1}/${input.total}${input.place ? `, ${input.place}` : ''}.`];
  if (input.arrow) parts.push(arrowSentence(input.arrow));
  if (input.hint) parts.push(`${input.hint}.`);
  if (input.badge) parts.push(`${input.badge}.`);
  return parts.join(' ');
}
