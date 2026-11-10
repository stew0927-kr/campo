import type { OutdoorKind } from '../model/outdoor-path.ts';
import { basemaps, type BasemapId } from '../map/basemaps.ts';
import type { Tool, UiState } from './ui-state.ts';

const KINDS: { id: OutdoorKind; label: string; sample: 'solid-footway' | 'dash-steps' | 'solid-ramp' }[] = [
  { id: 'flat', label: '평지', sample: 'solid-footway' },
  { id: 'steps', label: '계단', sample: 'dash-steps' },
  { id: 'ramp', label: '경사로', sample: 'solid-ramp' },
];

interface Props {
  ui: UiState;
  campusName: string;
  canSave: boolean;
  saving: boolean;
  onChange: (patch: Partial<UiState>) => void;
  onSave: () => void;
}

export function Toolbar({ ui, campusName, canSave, saving, onChange, onSave }: Props) {
  const tool = (t: Tool, label: string, hint: string) => (
    <button
      type="button"
      className="tool"
      aria-pressed={ui.tool === t}
      title={hint}
      onClick={() => onChange({ tool: t })}
    >
      {label}
    </button>
  );

  return (
    <header className="toolbar">
      <h1 className="brand">
        캠포 편집기 <span className="brand-campus">{campusName}</span>
      </h1>

      <div className="toolbar-group" role="group" aria-label="도구">
        {tool('pan', '이동', '지도를 끌어서 옮깁니다')}
        {tool('outdoor-path', '바깥 길', '지도를 클릭하며 바깥 길을 그립니다')}
      </div>

      <fieldset className="kinds" disabled={ui.tool !== 'outdoor-path'}>
        <legend className="visually-hidden">길 종류</legend>
        {KINDS.map((k) => (
          <label key={k.id} className="kind">
            <input
              type="radio"
              name="outdoor-kind"
              value={k.id}
              checked={ui.outdoorKind === k.id}
              onChange={() => onChange({ outdoorKind: k.id })}
            />
            <svg className={`kind-sample ${k.sample}`} viewBox="0 0 28 8" aria-hidden="true">
              <line x1="2" y1="4" x2="26" y2="4" />
            </svg>
            {k.label}
          </label>
        ))}
      </fieldset>

      <label className="basemap">
        배경
        <select value={ui.basemap} onChange={(e) => onChange({ basemap: e.target.value as BasemapId })}>
          {basemaps().map((b) => (
            <option key={b.id} value={b.id} disabled={!b.source} title={b.unavailableReason}>
              {b.label}{b.source ? '' : ' (API 키 필요)'}
            </option>
          ))}
        </select>
      </label>

      <button type="button" className="save" onClick={onSave} disabled={!canSave || saving} title="Ctrl+S">
        {saving ? '저장하는 중…' : '저장'}
      </button>
    </header>
  );
}
