// "측정" under the 속성 tab: what the selected edge or elevator is predicted to take, how many measurements there are,
// what the calibration says now, and the button that adds one. The numbers come from core (see model/measure.ts).
import { directionLabel, type MeasureSummary } from '../model/measure.ts';

interface Props {
  /** The summary, or why nothing can be measured. */
  summary: MeasureSummary | { reason: string };
  /** Measurements typed for this target and not saved yet. */
  pending: number;
  onAdd: () => void;
  onClearPending: () => void;
}

const sec = (n: number) => `${n.toFixed(1)}초`;

export function MeasurePanel({ summary, pending, onAdd, onClearPending }: Props) {
  const reason = 'reason' in summary ? summary.reason : undefined;
  return (
    <section className="measure" aria-label="측정">
      <h3 className="measure-title">측정</h3>
      {'target' in summary && (
        <>
          <p className="measure-target">{summary.target.label}</p>
          {summary.directions.map((d) => (
            <div key={d.key} className="measure-direction-block" data-direction={d.direction}>
              {summary.target.isEdge && <p className="measure-direction">{directionLabel(d.direction)}</p>}
              <dl className="measure-stats">
                <div><dt>예측값</dt><dd>{sec(d.predictedSec)}</dd></div>
                <div><dt>측정</dt><dd>{d.count}개</dd></div>
                <div><dt>현재 추정값</dt><dd>{d.estimateSec !== undefined ? sec(d.estimateSec) : '아직 없음'}</dd></div>
              </dl>
              {d.stale && <p className="measure-stale">저장한 뒤 npm run calibrate를 다시 돌리세요.</p>}
            </div>
          ))}
        </>
      )}
      <div className="measure-actions">
        <button type="button" className="measure-add" aria-disabled={reason !== undefined} title={reason} onClick={() => reason === undefined && onAdd()}>측정 추가</button>
        {pending > 0 && (
          <button type="button" className="measure-clear" onClick={onClearPending}>저장 전 측정 {pending}개 · 지우기</button>
        )}
      </div>
      {reason !== undefined && <p className="field-help">{reason}</p>}
      <p className="field-help">측정은 지도 편집이 아니어서 Ctrl+Z로 취소되지 않습니다. 저장하면 observations/editor.jsonl에 한 줄씩 더해집니다.</p>
    </section>
  );
}
