// 길찾기 '사진 보기' 토글(순수 모듈, React 없음).
// 경로 결과(route)와 위치 안내(nav)에서는 기본으로 경로만 보인다. 사진 칩을 켜야 경로 위 사진이 핀(누르면 미리보기)으로 뜬다.
// 켠 상태는 같은 길찾기 안에서 화면을 옮겨도(경로 결과 ↔ 위치 안내, 이동 방식·왕복 바꾸기, GPS 재탐색) 유지되고,
// 새 길찾기(epoch가 바뀜)는 꺼진 채 시작한다. 지도 탭 홈 화면의 사진 지점 핀은 이 토글과 상관없이 그대로 보인다.
import type { MarkerGroup, PhotoSpot } from '../../photos/roadviewModel.ts';

export interface PhotoToggle {
  on: boolean;
  /** 켜고 끈 길찾기의 번호. 지금 길찾기 번호와 다르면 꺼진 것으로 본다. */
  epoch: number;
}

/** 앱을 켰을 때: 꺼짐. */
export const PHOTOS_OFF: PhotoToggle = { on: false, epoch: -1 };

/** 지금 길찾기(`epoch`)에서 사진이 켜져 있는가. */
export const photosOn = (toggle: PhotoToggle, epoch: number): boolean => toggle.on && toggle.epoch === epoch;

/** 칩을 눌렀을 때. */
export const togglePhotos = (toggle: PhotoToggle, epoch: number): PhotoToggle => ({ on: !photosOn(toggle, epoch), epoch });

/** 사진을 켠다(단계 목록의 '사진'을 눌러 그 사진을 볼 때). */
export const showPhotos = (epoch: number): PhotoToggle => ({ on: true, epoch });

export type MapScreenKind = 'home' | 'plan' | 'route' | 'nav' | 'pick';

export interface PhotoLayers {
  photoSpots: readonly PhotoSpot[];
  stepGroups: readonly MarkerGroup[];
  /** 위치 안내에서 지금 단계의 사진을 말풍선으로 저절로 띄울지. */
  autoPreview: boolean;
}

/**
 * 화면별로 지도에 올릴 사진: 홈은 사진 지점(토글과 무관), 경로 결과는 경로 사진 묶음, 위치 안내는 지금 단계 사진.
 * 경로 결과·위치 안내는 `on`일 때만.
 */
export function photoLayers(screen: MapScreenKind, on: boolean, all: { spots: readonly PhotoSpot[]; stepGroups: readonly MarkerGroup[]; navGroups: readonly MarkerGroup[] }): PhotoLayers {
  if (screen === 'home') return { photoSpots: all.spots, stepGroups: [], autoPreview: false };
  if (screen === 'route' && on) return { photoSpots: [], stepGroups: all.stepGroups, autoPreview: false };
  if (screen === 'nav' && on) return { photoSpots: [], stepGroups: all.navGroups, autoPreview: true };
  return { photoSpots: [], stepGroups: [], autoPreview: false };
}
