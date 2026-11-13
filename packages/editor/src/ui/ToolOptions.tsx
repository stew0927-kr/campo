// The options row of the tools that have choices to make before clicking the map.
// A tool gets its row by adding a component to TOOL_OPTIONS; tools without one show their hint there.
import type { ComponentType } from 'react';
import { ELEVATOR_NOT_DRAWN, type OutdoorKind } from '../model/tools.ts';
import type { Tool } from './registry.ts';
import { addKindsIn, effectiveAddKind, type AddKind, type UiState } from './ui-state.ts';

export interface ToolOptionsProps {
  ui: UiState;
  onChange: (patch: Partial<UiState>) => void;
}

const OUTDOOR_KINDS: { id: OutdoorKind; label: string; sample: string }[] = [
  { id: 'flat', label: '평지', sample: 'solid-footway' },
  { id: 'steps', label: '계단', sample: 'dash-steps' },
  { id: 'ramp', label: '경사로', sample: 'solid-ramp' },
];

const ADD_KINDS: { id: AddKind; label: string; dot: string }[] = [
  { id: 'entrance', label: '출입구', dot: 'dot-entrance' },
  { id: 'door', label: '문', dot: 'dot-door' },
  { id: 'classroom', label: '강의실 문', dot: 'dot-classroom' },
  { id: 'corridor', label: '복도', dot: 'dot-door' },
  { id: 'stairs', label: '계단', dot: 'dot-stairs' },
  { id: 'outdoor', label: '바깥 지점', dot: 'dot-door' },
  { id: 'poi', label: '출발·도착 후보', dot: 'dot-poi' },
];

/** 길 그리기: the kind of way. Each option shows the same line the map draws. */
function PathOptions({ ui, onChange }: ToolOptionsProps) {
  return (
    <>
      <fieldset className="kinds">
        <legend className="visually-hidden">길 종류</legend>
        {OUTDOOR_KINDS.map((k) => (
          <label key={k.id} className="kind">
            <input type="radio" name="outdoor-kind" checked={ui.outdoorKind === k.id} onChange={() => onChange({ outdoorKind: k.id })} />
            <svg className={`kind-sample ${k.sample}`} viewBox="0 0 28 8" aria-hidden="true"><line x1="2" y1="4" x2="26" y2="4" /></svg>
            {k.label}
          </label>
        ))}
        <label className="kind kind-disabled" title={ELEVATOR_NOT_DRAWN}>
          <input type="radio" name="outdoor-kind" disabled checked={false} readOnly />
          <span className="kind-dot dot-elevator" aria-hidden="true" />
          엘리베이터
        </label>
      </fieldset>
      <p className="tool-hint" role="note">{ELEVATOR_NOT_DRAWN}.</p>
    </>
  );
}

/** 지점 추가: the kinds that can be placed in the scope being shown. */
function AddNodeOptions({ ui, onChange }: ToolOptionsProps) {
  const allowed = addKindsIn(ui.scope);
  return (
    <fieldset className="kinds">
      <legend className="visually-hidden">지점 종류</legend>
      {ADD_KINDS.filter((k) => allowed.includes(k.id)).map((k) => (
        <label key={k.id} className="kind">
          <input type="radio" name="add-kind" checked={effectiveAddKind(ui) === k.id} onChange={() => onChange({ addKind: k.id })} />
          <span className={`kind-dot ${k.dot}`} aria-hidden="true" />
          {k.label}
        </label>
      ))}
    </fieldset>
  );
}

/** 호실 연속 입력: the number the next room gets, and how far the numbers are apart. */
function DoorOptions({ ui, onChange }: ToolOptionsProps) {
  const setRun = (patch: Partial<UiState['doorRun']>) => onChange({ doorRun: { ...ui.doorRun, ...patch } });
  return (
    <>
      <label className="inline-field">다음 호실 번호
        <input className="door-ref" value={ui.doorRun.nextRef} placeholder="301" onChange={(e) => setRun({ nextRef: e.target.value })} />
      </label>
      <fieldset className="kinds">
        <legend className="visually-hidden">번호 간격</legend>
        {([1, 2] as const).map((n) => (
          <label key={n} className="kind" title={n === 2 ? '한쪽에 홀수(또는 짝수) 호실만 있을 때 씁니다. 키 2' : '번호가 1씩 늘어납니다. 키 1'}>
            <input type="radio" name="door-step" checked={ui.doorRun.step === n} onChange={() => setRun({ step: n })} />
            간격 {n} ({n})
          </label>
        ))}
      </fieldset>
      <p className="tool-hint">Shift+누르기는 뒷문, F는 앞문·뒷문 뒤집기입니다.</p>
    </>
  );
}

export const TOOL_OPTIONS: Partial<Record<Tool, ComponentType<ToolOptionsProps>>> = {
  path: PathOptions,
  'add-node': AddNodeOptions,
  door: DoorOptions,
};
