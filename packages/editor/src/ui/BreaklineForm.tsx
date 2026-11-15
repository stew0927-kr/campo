import type { BreakLine } from '@campo/core/elevation';
import { toolDef } from './registry.ts';

/** 불연속선 그리기 options row: the hint, and the lines drawn so far (each can be removed). */
export function BreaklineForm({ lines, onRemove }: { lines: readonly BreakLine[]; onRemove: (id: string) => void }) {
  return (
    <div className="breakline-form">
      <p className="tool-hint">{toolDef('breakline').hint}</p>
      {lines.length > 0 && (
        <ul className="breakline-list" aria-label="그린 불연속선">
          {lines.map((b, i) => (
            <li key={b.id}>
              <span className="breakline-swatch" aria-hidden="true" />
              선 {i + 1}
              <button type="button" className="breakline-remove" aria-label={`불연속선 ${i + 1} 지우기`} title="지우기" onClick={() => onRemove(b.id)}>
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
