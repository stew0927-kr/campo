import { STRIP_STAGE_TEXT, stripStage, type StripState } from './ui-state.ts';

interface Props {
  strip: StripState;
  /** Core's reason the row cannot be laid out yet, or the preview line ("문 20개 · Enter로 놓기"). */
  status: string | null;
  onChange: (patch: Partial<StripState>) => void;
  onRun: () => void;
  onReset: () => void;
}

/** The numbers of 강의실 자동 연결 (SPEC-v0.2 6.5): shown after both doors are clicked, the preview updates while typing. */
export function StripForm({ strip, status, onChange, onRun, onReset }: Props) {
  const stage = stripStage(strip);
  const enter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onRun();
    }
  };
  return (
    <>
      <p className="tool-hint" data-stage={stage}>{STRIP_STAGE_TEXT[stage]}</p>
      {stage === 'numbers' && (
        <>
          <label className="inline-field">개수
            <input className="strip-count" inputMode="numeric" value={strip.count} onChange={(e) => onChange({ count: e.target.value })} onKeyDown={enter} />
          </label>
          <label className="inline-field">시작 번호
            <input className="strip-ref" value={strip.startRef} placeholder="301" onChange={(e) => onChange({ startRef: e.target.value })} onKeyDown={enter} />
          </label>
          <label className="inline-field">번호 간격
            <select value={strip.refStep} onChange={(e) => onChange({ refStep: Number(e.target.value) === 2 ? 2 : 1 })}>
              <option value={1}>1씩</option>
              <option value={2}>2씩 (홀수만·짝수만)</option>
            </select>
          </label>
          <label className="inline-field">강의실마다 문
            <select value={strip.doorsPerRoom} onChange={(e) => onChange({ doorsPerRoom: Number(e.target.value) === 2 ? 2 : 1 })}>
              <option value={1}>앞문 1개</option>
              <option value={2}>앞문과 뒷문</option>
            </select>
          </label>
          <button type="button" className="primary" onClick={onRun}>놓기 (Enter)</button>
        </>
      )}
      {stage !== 'corridor' && <button type="button" onClick={onReset}>처음부터</button>}
      {status && stage === 'numbers' && <span className="strip-status" role="status">{status}</span>}
    </>
  );
}
