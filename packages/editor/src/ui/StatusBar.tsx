import { dirtyLabel } from '../model/elevation.ts';

interface Props {
  scopeLabel: string;
  nodes: number;
  edges: number;
  dirty: boolean;
  notice: { text: string; tone: 'info' | 'warn' | 'error' } | null;
  hint: string | null;
  /** Places waiting for a height recompute (0: nothing to do, nothing shown) and the button that runs it. */
  elevation: { count: number; busy: boolean; onRecompute: () => void };
}

export function StatusBar({ scopeLabel, nodes, edges, dirty, notice, hint, elevation }: Props) {
  return (
    <footer className="status">
      <span className="status-mode">{scopeLabel === '바깥' ? '바깥 모드' : scopeLabel}</span>
      <span>지점 {nodes}개</span>
      <span>구간 {edges}개</span>
      <span className={dirty ? 'status-dirty' : 'status-clean'}>{dirty ? '저장하지 않은 변경이 있습니다' : '저장됨'}</span>
      {(elevation.count > 0 || elevation.busy) && (
        <span className="status-elev">
          <span className="status-elev-count">{elevation.busy ? '고도를 계산하는 중입니다' : dirtyLabel(elevation.count)}</span>
          <button
            type="button"
            className="status-elev-run"
            disabled={elevation.busy}
            title="바뀐 곳과 그 주변만 고도 계산기(campo_height_solver.py)로 다시 풀고, 결과를 되돌리기 한 번으로 취소할 수 있게 반영합니다."
            onClick={elevation.onRecompute}
          >
            {elevation.busy ? '계산 중…' : '고도 다시 계산'}
          </button>
        </span>
      )}
      <span className="status-message" role="status" aria-live="polite">
        {notice ? <span className={`notice-${notice.tone}`} title={notice.text}>{notice.text}</span> : hint}
      </span>
    </footer>
  );
}
