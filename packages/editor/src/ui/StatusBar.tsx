import { dirtyLabel } from '../model/elevation.ts';

interface Props {
  scopeLabel: string;
  nodes: number;
  edges: number;
  dirty: boolean;
  notice: { text: string; tone: 'info' | 'warn' | 'error' } | null;
  hint: string | null;
  /** Places waiting for a height recompute and the button that runs it. Always shown, so the feature is there to find. */
  elevation: { count: number; busy: boolean; onRecompute: () => void; /** Measured Δh edges in the store, and the button that opens their list. */ dhCount: number; onOpenDh: () => void };
}

const RUN_TITLE = '바뀐 곳과 그 주변만 고도 계산기(campo_height_solver.py)로 다시 풀고, 결과를 되돌리기 한 번으로 취소할 수 있게 반영합니다.';
const FRESH_TITLE = '다시 계산할 곳이 없습니다. 지점·구간을 고치거나, 고도 단절선을 그리거나, 현장 측정을 불러오면 바뀐 곳만 골라 다시 계산합니다.';

/** 고도 상태: 최신 (nothing to do: the button stays, but only explains), 다시 계산 필요 N곳, or 계산 중. */
function ElevationStatus({ count, busy, onRecompute, dhCount, onOpenDh }: Props['elevation']) {
  const state = busy ? 'busy' : count > 0 ? 'stale' : 'fresh';
  return (
    <span className="status-elev" data-state={state}>
      <span className="status-elev-mark" aria-hidden="true">
        {state === 'fresh' ? (
          <svg width="12" height="12" viewBox="0 0 12 12" focusable="false"><path d="M2.5 6.3 L5 8.6 L9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" focusable="false"><circle cx="6" cy="6" r="3.5" fill="currentColor" /></svg>
        )}
      </span>
      <span className="status-elev-count">{busy ? '고도를 계산하는 중입니다' : count > 0 ? dirtyLabel(count) : '고도 최신'}</span>
      <button
        type="button"
        className="status-elev-run"
        // Not `disabled` when there is nothing to do: a disabled button shows no tooltip, and the tooltip is the explanation.
        aria-disabled={state !== 'stale'}
        title={state === 'fresh' ? FRESH_TITLE : RUN_TITLE}
        onClick={() => {
          if (state === 'stale') onRecompute();
        }}
      >
        {busy ? '계산 중…' : '고도 다시 계산'}
      </button>
      <button type="button" className="status-elev-run" title="현장에서 잰 높이 차(Δh)를 보고 하나씩 지웁니다." onClick={onOpenDh}>
        높이 차 {dhCount}개
      </button>
    </span>
  );
}

export function StatusBar({ scopeLabel, nodes, edges, dirty, notice, hint, elevation }: Props) {
  return (
    <footer className="status">
      <span className="status-mode">{scopeLabel === '바깥' ? '바깥 모드' : scopeLabel}</span>
      <span>지점 {nodes}개</span>
      <span>구간 {edges}개</span>
      <span className={dirty ? 'status-dirty' : 'status-clean'}>{dirty ? '저장하지 않은 변경이 있습니다' : '저장됨'}</span>
      <ElevationStatus {...elevation} />
      <span className="status-message" role="status" aria-live="polite">
        {notice ? <span className={`notice-${notice.tone}`} title={notice.text}>{notice.text}</span> : hint}
      </span>
    </footer>
  );
}
