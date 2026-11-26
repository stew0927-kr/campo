// 3D 보기 토글 아이콘의 모양(순수 모듈, React 없음). 24 격자 안에 비스듬히 본 층판(마름모) 셋을 촘촘히 쌓는다.
// 코어 LAYER_STACK_ICON(편집기·현장 조사 앱의 SVG)과 같은 중심·크기라서 세 앱의 아이콘이 같은 덩어리로 보인다.

/** 아이콘 한 변(dp). */
export const STACK_ICON_SIZE = 24;
/** 층판(마름모)의 가로·세로(dp). 세로가 낮을수록 낮은 각도에서 본 판처럼 보인다. */
export const STACK_PLATE_W = 18;
export const STACK_PLATE_H = 3.6;
/** 층판 중심 사이 간격(dp). 판 세로(3.6)보다 커서 겹치지 않고, 꼭짓점 사이에 0.4dp 틈이 남는다. */
export const STACK_STEP = 4;
/** 아래 → 위 순서의 농도. 위 판이 가장 진하다(켜짐이면 primary). */
export const STACK_OPACITY = [0.35, 0.6, 1] as const;

export interface StackPlate { /** 판 중심 y(dp). */ cy: number; opacity: number }

/** 아래 판부터 위 판까지. 세 판 덩어리의 가운데가 아이콘 가운데(12)에 온다. */
export function stackPlates(): StackPlate[] {
  const mid = STACK_ICON_SIZE / 2;
  return STACK_OPACITY.map((opacity, i) => ({ cy: mid + (1 - i) * STACK_STEP, opacity }));
}

/**
 * React Native View로 마름모를 그리는 값: 한 변 `side`의 정사각형을 45° 돌린 뒤(가로·세로 모두 W가 된다) 세로만 H/W로 줄인다.
 * RN transform 배열은 뒤에서부터 적용되므로 [{ scaleY }, { rotate }] 순서로 쓴다.
 */
export const STACK_SQUARE = STACK_PLATE_W / Math.SQRT2;
export const STACK_SCALE_Y = STACK_PLATE_H / STACK_PLATE_W;
