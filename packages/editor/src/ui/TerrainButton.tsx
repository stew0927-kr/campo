import type { TerrainGrid } from '../model/terrain3d.ts';

/** Three contour lines over a slope: ground seen as relief, not as a building. */
function ReliefIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2 20 L8 12 L12 16 L16 9 L22 20 Z" fill="currentColor" fillOpacity={0.28} stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      <path d="M5.2 16 C7.5 15 9.5 16.4 12 15.4 S16.8 13.2 19.2 15.2" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
      <path d="M8.5 12.6 C10.3 12.2 12 12.9 13.8 11.8 S16.4 10.6 17.6 11.6" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
      <path d="M15 7 C15.6 6 16.6 5.4 17.8 6.2" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" />
    </svg>
  );
}

const SOURCE_TEXT: Record<TerrainGrid['source'], string> = { corrected: '보정 지형', dem: 'DEM(보정 전)', sample: '샘플 지형' };

interface Props {
  on: boolean;
  /** Where the heights come from, while on and loaded. */
  source: TerrainGrid['source'] | null;
  /** Lowest and highest height (metres above sea level) of the grid. */
  range: [number, number] | null;
  onToggle: () => void;
}

/** 지형 3D, beside 건물 3D (each turns on and off by itself), and while on a small note of what the relief is made from. */
export function TerrainButton({ on, source, range, onToggle }: Props) {
  return (
    <div className="terrain3d">
      <button
        type="button"
        className="view3d-btn terrain3d-btn"
        aria-pressed={on}
        aria-label="지형 3D"
        title={on ? '지형 3D를 끕니다' : '보정한 고도 그리드(없으면 DEM)로 지형을 입체로 그리고, 바깥 길과 건물 1층 외곽선을 그 높이에 올립니다'}
        onClick={onToggle}
      >
        <ReliefIcon />
        <span className="view3d-label">지형</span>
      </button>
      {on && source && (
        <p className={`terrain3d-note terrain3d-${source}`} role="status">
          {SOURCE_TEXT[source]}
          {range && <span> · {range[0].toFixed(0)}~{range[1].toFixed(0)} m</span>}
          {source === 'sample' && <span> · 실제 고도 아님</span>}
        </p>
      )}
    </div>
  );
}
