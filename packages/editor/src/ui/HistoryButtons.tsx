import { OPERATIONS, tooltip, type OperationId } from './registry.ts';

/** A U-turn arrow bending to the left; the right one is the same drawing mirrored (as in the survey app's HistoryButtons). */
function Arrow({ flip }: { flip: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M9 14 L4 9 L9 4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 9 H14.5 A5.5 5.5 0 0 1 14.5 20 H11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface Props {
  /** Why an operation cannot run now, or false. */
  blocked: Record<'undo' | 'redo', string | false>;
  onRun: (id: OperationId) => void;
}

/** Two floating round buttons over the map, right of the zoom control: 되돌리기 and 다시 하기. */
export function HistoryButtons({ blocked, onRun }: Props) {
  return (
    <div className="history" role="group" aria-label="편집 이력">
      {(['undo', 'redo'] as const).map((id) => {
        const def = OPERATIONS.find((o) => o.id === id)!;
        return (
          <button
            key={id}
            type="button"
            className="history-btn"
            data-op={id}
            aria-label={def.label}
            aria-keyshortcuts={def.key?.replace('Ctrl', 'Control')}
            aria-disabled={blocked[id] !== false}
            title={tooltip(def, blocked[id])}
            onClick={() => onRun(id)}
          >
            <Arrow flip={id === 'redo'} />
          </button>
        );
      })}
    </div>
  );
}
