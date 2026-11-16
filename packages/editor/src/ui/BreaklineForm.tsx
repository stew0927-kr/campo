import { useEffect, useState } from 'react';
import type { BreakLine, BreakLineSide } from '@campo/core/elevation';
import { parseDropM, sideLabel } from '../model/elevation.ts';
import { toolDef } from './registry.ts';

/** How a 고도 단절선 is drawn, in order (the options row shows it while the tool is on). */
export const BREAKLINE_STEPS = ['시작점 클릭', '꺾이는 곳마다 클릭', '끝점 더블클릭 또는 Enter로 완료', '낮은 쪽 면 클릭'] as const;

/** The wall symbol of the map (a solid edge with teeth on one side), small, for the row and the list. */
function WallSwatch() {
  return (
    <svg className="breakline-swatch" width="22" height="12" viewBox="0 0 22 12" aria-hidden="true" focusable="false">
      <path d="M1 3.5 H21" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M3 4.5 L6 4.5 L4.5 9 Z M10 4.5 L13 4.5 L11.5 9 Z M17 4.5 L20 4.5 L18.5 9 Z" fill="currentColor" />
    </svg>
  );
}

/** "단절선 2" for the line with this id (1-based in drawing order). */
export const breaklineTitle = (lines: readonly BreakLine[], id: string): string => `단절선 ${lines.findIndex((b) => b.id === id) + 1}`;

/**
 * 고도 단절선 options row: what the line is (one sentence), how to draw it, and the lines drawn so far (a click selects
 * one for editing, the × removes it).
 */
export function BreaklineForm({ lines, selected, onSelect, onRemove }: {
  lines: readonly BreakLine[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="breakline-form">
      <p className="breakline-what">
        <WallSwatch />
        {toolDef('breakline').description}
      </p>
      <ol className="breakline-steps" aria-label="그리는 순서">
        {BREAKLINE_STEPS.map((s, i) => (
          <li key={s}><span className="breakline-step-n" aria-hidden="true">{i + 1}</span>{s}</li>
        ))}
        <li className="breakline-esc"><kbd>Esc</kbd> {selected ? '선택 해제' : '취소'}</li>
      </ol>
      {lines.length > 0 && (
        <ul className="breakline-list" aria-label="그린 고도 단절선">
          {lines.map((b, i) => (
            <li key={b.id} data-selected={b.id === selected ? 'true' : undefined}>
              <button
                type="button"
                className="breakline-pick"
                aria-pressed={b.id === selected}
                title="골라서 고치기"
                onClick={() => onSelect(b.id === selected ? null : b.id)}
              >
                <WallSwatch />
                단절선 {i + 1}
                {b.lowSide === undefined && <span className="breakline-todo" title="낮은 쪽 면을 아직 정하지 않았습니다"> · 면?</span>}
                {b.dropM !== undefined && <span> · {b.dropM} m</span>}
              </button>
              <button type="button" className="breakline-remove" aria-label={`고도 단절선 ${i + 1} 지우기`} title="지우기" onClick={() => onRemove(b.id)}>
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 상세 정보 of the selected 고도 단절선: its low side (set on the map or here, or flipped), its drop, its points, delete. */
export function BreaklinePanel({ line, title, onSide, onDrop, onDelete, onClose }: {
  line: BreakLine;
  title: string;
  onSide: (side: BreakLineSide | null) => void;
  onDrop: (dropM: number | null) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [drop, setDrop] = useState(line.dropM === undefined ? '' : String(line.dropM));
  const [error, setError] = useState<string | null>(null);
  // Another line, or the value changed elsewhere (the right-click menu): the field follows.
  useEffect(() => {
    setDrop(line.dropM === undefined ? '' : String(line.dropM));
    setError(null);
  }, [line.id, line.dropM]);
  const applyDrop = () => {
    const v = parseDropM(drop);
    if (v !== null && typeof v === 'object') return setError(v.error);
    setError(null);
    if (v !== (line.dropM ?? null)) onDrop(v);
  };

  return (
    <section className="breakline-panel" aria-label="고도 단절선 속성">
      <h3><WallSwatch /> 고도 단절선 · {title}</h3>
      <p className="field-help">
        {line.lowSide === undefined
          ? '지도에서 선 옆을 가리키면 그쪽 면에 흐린 톱니가 보입니다. 낮은 쪽 면을 누르면 정해집니다.'
          : '톱니가 달린 쪽이 낮은 쪽입니다. 반대쪽 면을 누르거나 [면 반전]으로 바꿉니다.'}
      </p>
      <fieldset className="breakline-sides">
        <legend>낮은 쪽 면 (그린 방향 기준): {sideLabel(line.lowSide)}</legend>
        <button type="button" aria-pressed={line.lowSide === 'left'} onClick={() => onSide('left')}>왼쪽</button>
        <button type="button" aria-pressed={line.lowSide === 'right'} onClick={() => onSide('right')}>오른쪽</button>
        <button type="button" disabled={line.lowSide === undefined} onClick={() => line.lowSide && onSide(line.lowSide === 'left' ? 'right' : 'left')}>면 반전</button>
        {line.lowSide !== undefined && <button type="button" onClick={() => onSide(null)}>모름으로</button>}
      </fieldset>
      <label className="breakline-drop">높이차 (m, 높은 쪽 − 낮은 쪽)
        <input
          aria-label="높이차(m)"
          inputMode="decimal"
          value={drop}
          placeholder="예: 1.5 (비우면 모름)"
          aria-invalid={error !== null}
          onChange={(e) => setDrop(e.target.value)}
          onBlur={applyDrop}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyDrop();
            }
          }}
        />
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <p className="field-help">
        꺾은점 {line.coordinates.length}개. 점을 끌어 옮기고, 선분을 클릭하면 점이 생깁니다. 우클릭하면 점을 지우거나 더하는 메뉴가 열립니다.
        낮은 쪽 면과 높이차가 둘 다 있으면 고도 다시 계산이 이 선을 가로지르는 길에 높이차를 넣습니다.
      </p>
      <div className="breakline-actions">
        <button type="button" className="danger" onClick={onDelete}>단절선 삭제 <kbd>Delete</kbd></button>
        <button type="button" onClick={onClose}>선택 해제 <kbd>Esc</kbd></button>
      </div>
    </section>
  );
}
