// 사진 안내에서 화면과 스크린리더가 그대로 쓰는 한국어 문구(존댓말). 화면에서 새로 만들지 않고 여기 것을 쓴다.
// React를 import하지 않는 순수 모듈.
import type { PhotoArrow } from '../contracts.ts';
import { turnGuide, type TurnGuide } from './turnGuide.ts';

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
 * 화살표를 말로(turnGuide): "앞으로 25m 직진하세요.", "25m 직진 후 왼쪽으로 가세요.", "바로 오른쪽으로 가세요.".
 * `guide`(경로선에서 잰 직진 거리·꺾임)가 있으면 그 문장, 없으면 화살표 각도만으로("앞으로 직진하세요." / "바로 왼쪽으로 가세요.").
 * 사용자가 직접 고른 뒤쪽 사진(U턴)만 "뒤로 돌아서(약 155°) 가세요."(각도 5° 단위).
 */
export function arrowSentence(arrow: PhotoArrow, guide: TurnGuide | null = null): string {
  if (arrow.mode === 'behind') return `뒤로 돌아서(약 ${Math.round(Math.abs(arrow.rotateDeg) / 5) * 5}°) 가세요.`;
  return (guide ?? turnGuide(null, arrow.rotateDeg)!).sentence;
}

/** 스크린리더 레이블: "사진 3/7, 공학관 2층 엘리베이터 앞. 25m 직진 후 오른쪽으로 가세요. 사진 오른쪽 두 번째 문." */
export function photoAccessibilityLabel(input: {
  index: number;
  total: number;
  place?: string | null;
  arrow: PhotoArrow | null;
  guide?: TurnGuide | null;
  hint?: string | null;
  badge?: string | null;
}): string {
  const parts = [`사진 ${input.index + 1}/${input.total}${input.place ? `, ${input.place}` : ''}.`];
  if (input.arrow) parts.push(arrowSentence(input.arrow, input.guide ?? null));
  if (input.hint) parts.push(`${input.hint}.`);
  if (input.badge) parts.push(`${input.badge}.`);
  return parts.join(' ');
}
