import { useEffect, useState } from 'react';
import { EXAGGERATION_MAX, EXAGGERATION_MIN, clampExaggeration } from '../model/terrain3d.ts';

interface Props {
  value: number;
  onChange: (value: number) => void;
}

/**
 * 높이 과장 on the map's lower left while 건물 3D or 지형 3D is on: a slider and a box to type the factor in. The same
 * factor lifts the relief, the floors, the routes and the relief picking. It lives for the session only (not saved).
 */
export function ExaggerationControl({ value, onChange }: Props) {
  // What is being typed, until it is confirmed (Enter or leaving the box); the slider moves the value at once.
  const [text, setText] = useState(value.toFixed(1));
  useEffect(() => setText(value.toFixed(1)), [value]);
  const commit = () => {
    const v = clampExaggeration(Number(text.replace(',', '.')));
    setText(v.toFixed(1));
    if (v !== value) onChange(v);
  };
  return (
    <div className="exaggeration" role="group" aria-label="높이 과장">
      <label className="exaggeration-title" htmlFor="exaggeration-range">높이 과장</label>
      <input
        id="exaggeration-range"
        type="range"
        min={EXAGGERATION_MIN}
        max={EXAGGERATION_MAX}
        step={0.1}
        value={value}
        onChange={(e) => onChange(clampExaggeration(Number(e.target.value)))}
        aria-valuetext={`${value.toFixed(1)}배`}
        title="지형·건물 층·경로의 높이를 몇 배로 그릴지 정합니다. 저장되지 않습니다"
      />
      <span className="exaggeration-num">
        <input
          type="number"
          inputMode="decimal"
          min={EXAGGERATION_MIN}
          max={EXAGGERATION_MAX}
          step={0.1}
          value={text}
          aria-label="높이 과장 배율"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              setText(value.toFixed(1));
              (e.target as HTMLInputElement).blur();
            }
            e.stopPropagation(); // typed digits are not the editor's shortcuts
          }}
        />
        <span aria-hidden="true">×</span>
      </span>
      {value !== 1 && (
        <button type="button" className="exaggeration-reset" onClick={() => onChange(1)} title="실제 높이(1배)로 되돌립니다">
          1×
        </button>
      )}
    </div>
  );
}
