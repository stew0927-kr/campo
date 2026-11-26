import { LAYER_STACK_ICON } from '@campo/core';

/**
 * The layer-stack icon of core (three thin floors in one block), the same one the survey app and the user app show. A hairline
 * stroke only softens the edges: a wider one would close the 0.4 gap between the plates' tips.
 */
function StackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {LAYER_STACK_ICON.map((p, i) => (
        <path key={i} d={p.d} fill="currentColor" fillOpacity={p.opacity} stroke="currentColor" strokeWidth={0.4} strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/** 3D 보기 on the map, beside 되돌리기 / 다시 하기: off a plain round button, on a filled one with a glow. */
export function View3DButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="view3d-btn"
      aria-pressed={on}
      aria-label="3D 보기"
      title={on ? '3D 보기를 끄고 평면 지도로 돌아갑니다' : '건물의 층을 층고대로 쌓아 입체로 봅니다. 지금 보는 층이 강조됩니다'}
      onClick={onToggle}
    >
      <StackIcon />
      <span className="view3d-label">3D</span>
    </button>
  );
}
