// 3D 보기 토글 아이콘의 모양(순수 모듈, React 없음). 디자인 원본: 24 격자 SVG(rh-1.svg) — 두꺼운 마름모 층판 셋이 둥근 모서리로
// 촘촘히 겹쳐 있고, 위 판이 아래 판을 가리며(마스크 1.8 = 판 둘레 0.9 지움), 위 판이 가장 진하다.
// 앱에는 react-native-svg가 없어서 RN View로 같은 인상을 낸다: 정사각형을 45° 돌린 뒤 세로만 눌러 마름모를 만들고(borderRadius로 둥근 모서리),
// 위 판 바로 밑에 버튼 바탕색의 "틈" 판(halo, 위 판보다 STACK_GAP만큼 큰 같은 마름모)을 깔아 SVG 마스크와 같은 틈을 낸다.

/** 아이콘 한 변(dp). */
export const STACK_ICON_SIZE = 24;
/**
 * 층판(마름모)의 가로·세로(dp): SVG 경로 18×9에 stroke 0.8(둘레 0.4)을 더한 보이는 크기. 가로:세로 = 2:1(SVG와 같은 기울기).
 * 판이 두꺼워(9.8) "선 3개"가 아니라 겹친 판 덩어리로 읽힌다.
 */
export const STACK_PLATE_W = 19.6;
export const STACK_PLATE_H = 9.8;
/** 층판 중심 사이 간격(dp). 판 세로(9.8)보다 훨씬 작아서 판이 크게 겹치고, 아래 판은 위 판 아래로 쐐기 띠만 보인다. */
export const STACK_STEP = 4;
/**
 * 판 사이 틈(dp, 마름모 변에 수직인 거리). SVG 마스크(stroke 1.8 → 경로 둘레 0.9)에서 보이는 판 둘레(0.4)를 뺀 0.5.
 * 마름모를 변에 수직으로 g만큼 키우면 가로는 2·g·√5, 세로는 g·√5만큼 커진다(2:1 마름모).
 */
export const STACK_GAP = 0.5;
/** 아래 → 위 순서의 농도. 같은 회색(켜짐이면 primary) 한 색에서 위 판이 가장 진하다. */
export const STACK_OPACITY = [0.4, 0.66, 1] as const;
/** 마름모 모서리 둥글기(돌리기 전 정사각형 기준, dp). SVG stroke-linejoin: round(반지름 0.4)를 눌린 마름모에서 비슷하게 보이게 한 값. */
export const STACK_CORNER = 1.6;

export interface StackPlate {
  /** 판 중심 y(dp). */ cy: number;
  opacity: number;
  /** 이 판 바로 밑에 까는 틈 판(halo)의 가로·세로(dp). 가장 아래 판은 가릴 판이 없어 0. */
  haloW: number; haloH: number;
}

const HALO_GROW_W = 2 * STACK_GAP * Math.sqrt(5);
const HALO_GROW_H = STACK_GAP * Math.sqrt(5);

/** 아래 판부터 위 판까지. SVG처럼 판 중심이 8·12·16(덩어리 가운데가 아이콘 가운데 12). */
export function stackPlates(): StackPlate[] {
  const mid = STACK_ICON_SIZE / 2;
  return STACK_OPACITY.map((opacity, i) => ({
    cy: mid + (1 - i) * STACK_STEP,
    opacity,
    haloW: i === 0 ? 0 : STACK_PLATE_W + HALO_GROW_W,
    haloH: i === 0 ? 0 : STACK_PLATE_H + HALO_GROW_H,
  }));
}

/**
 * React Native View로 가로 `w`·세로 `h` 마름모를 그리는 값: 한 변 w/√2의 정사각형을 45° 돌린 뒤(가로·세로 모두 w) 세로만 h/w로 줄인다.
 * RN transform 배열은 뒤에서부터 적용되므로 [{ scaleY }, { rotate }] 순서로 쓴다.
 */
export function diamond(w: number, h: number): { side: number; scaleY: number } {
  return { side: w / Math.SQRT2, scaleY: h / w };
}
