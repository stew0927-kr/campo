import type { BreakLine } from '@campo/core/elevation';
import { toolDef } from './registry.ts';

/** How a 고도 단절선 is drawn, in order (the options row shows it while the tool is on). */
export const BREAKLINE_STEPS = ['시작점 클릭', '꺾이는 곳마다 클릭', '끝점 더블클릭 또는 Enter로 완료'] as const;

/** The wall symbol of the map (a solid edge with teeth on one side), small, for the row and the list. */
function WallSwatch() {
  return (
    <svg className="breakline-swatch" width="22" height="12" viewBox="0 0 22 12" aria-hidden="true" focusable="false">
      <path d="M1 3.5 H21" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M3 4.5 L6 4.5 L4.5 9 Z M10 4.5 L13 4.5 L11.5 9 Z M17 4.5 L20 4.5 L18.5 9 Z" fill="currentColor" />
    </svg>
  );
}

/** 고도 단절선 options row: what the line is (one sentence), how to draw it, and the lines drawn so far (each can be removed). */
export function BreaklineForm({ lines, onRemove }: { lines: readonly BreakLine[]; onRemove: (id: string) => void }) {
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
        <li className="breakline-esc"><kbd>Esc</kbd> 취소</li>
      </ol>
      {lines.length > 0 && (
        <ul className="breakline-list" aria-label="그린 고도 단절선">
          {lines.map((b, i) => (
            <li key={b.id}>
              <WallSwatch />
              단절선 {i + 1}
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
