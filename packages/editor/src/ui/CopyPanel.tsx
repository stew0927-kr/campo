// The small window of 다른 층에 복사. Not modal, like CrossPicker: the map stays clickable while it is open.
// It lists the other floors of the building (a checkbox each, and 전체 선택); 복사하기 runs one Plan; the result stays here to be read.
import { useState } from 'react';
import { floorLabel } from '../model/scope.ts';

interface Props {
  buildingName: string;
  /** From-floor and the floors a copy can go to, top floor first. */
  fromLevel: number;
  levels: number[];
  /** "지점 5개, 구간 4개" */
  summary: string;
  /** Set after a copy ran: the lines to read (counts, what was skipped and why). */
  result: string[] | null;
  /** Runs the copy; returns an error text or undefined. `joinSync`: points reused on the target floor join the floor link. */
  onRun: (levels: number[], joinSync: boolean) => string | undefined;
  onClose: () => void;
}

export function CopyPanel({ buildingName, fromLevel, levels, summary, result, onRun, onClose }: Props) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [joinSync, setJoinSync] = useState(true);
  const [error, setError] = useState<string>();
  const all = levels.length > 0 && levels.every((l) => checked.has(l));
  const toggle = (l: number) => setChecked((s) => {
    const next = new Set(s);
    if (next.has(l)) next.delete(l);
    else next.add(l);
    return next;
  });
  return (
    <section className="copy-panel" aria-label="다른 층에 복사">
      <h2 className="copy-title">다른 층에 복사: {buildingName} {floorLabel(fromLevel)}</h2>
      <p className="field-help">{summary}를 같은 자리에 복사합니다. 속성은 그대로이고 층만 바뀝니다. 원본과 복사본은 층 연동으로 묶여, 연동된 두 지점 사이에 구간을 만들거나 지우면 다른 층에도 똑같이 적용됩니다.</p>
      {result === null ? (
        <>
          <fieldset className="copy-floors">
            <legend className="visually-hidden">복사할 층</legend>
            <label>
              <input type="checkbox" checked={all} onChange={() => setChecked(all ? new Set() : new Set(levels))} />
              전체 선택
            </label>
            {levels.map((l) => (
              <label key={l}>
                <input type="checkbox" checked={checked.has(l)} onChange={() => toggle(l)} />
                {floorLabel(l)}
              </label>
            ))}
          </fieldset>
          <label className="copy-option">
            <input type="checkbox" checked={joinSync} onChange={(e) => setJoinSync(e.target.checked)} />
            같은 자리의 기존 지점도 층 연동에 넣기
          </label>
          <p className="field-help">같은 자리(1.5m 안)에 같은 종류의 지점이 이미 있으면 그 지점을 쓰고, 기존 복도 가까이(1.5m 안)에 놓이는 지점은 그 복도 위에 이어 줍니다. 계단참과 엘리베이터 정차 지점도 복사합니다(있으면 그대로 쓰고, 없으면 만듭니다). 층 사이 계단·에스컬레이터·연결통로 구간은 복사하지 않습니다.</p>
          {error && <p className="dialog-error" role="alert">{error}</p>}
          <div className="copy-actions">
            <button type="button" onClick={onClose}>취소 (Esc)</button>
            <button type="button" className="primary" disabled={checked.size === 0} onClick={() => setError(onRun([...checked], joinSync))}>
              복사하기{checked.size > 0 ? ` (${checked.size}개 층)` : ''}
            </button>
          </div>
        </>
      ) : (
        <>
          <ul className="copy-result" aria-label="복사 결과">
            {result.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
          <div className="copy-actions">
            <button type="button" className="primary" onClick={onClose}>닫기</button>
          </div>
        </>
      )}
    </section>
  );
}
