import type { OutdoorKind } from '../model/outdoor-path.ts';
import { basemaps, type BasemapId } from '../map/basemaps.ts';
import { TOOL_HINTS, toolAvailable, type AddKind, type Tool, type UiState } from './ui-state.ts';

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'pan', label: '이동' },
  { id: 'outdoor-path', label: '바깥 길' },
  { id: 'building', label: '건물' },
  { id: 'select-building', label: '건물 선택' },
  { id: 'add-node', label: '지점 추가' },
  { id: 'connect', label: '잇기' },
];

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
  { id: 'elevator', label: '엘리베이터', dot: 'dot-elevator' },
  { id: 'stairs', label: '계단', dot: 'dot-stairs' },
];

interface Props {
  ui: UiState;
  campusName: string;
  canSave: boolean;
  saving: boolean;
  onTool: (tool: Tool) => void;
  onChange: (patch: Partial<UiState>) => void;
  onSave: () => void;
}

export function Toolbar({ ui, campusName, canSave, saving, onTool, onChange, onSave }: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar-main">
        <h1 className="brand">
          캠포 편집기 <span className="brand-campus">{campusName}</span>
        </h1>

        <div className="toolbar-group" role="group" aria-label="도구">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="tool"
              aria-pressed={ui.tool === t.id}
              disabled={!toolAvailable(t.id, ui.scope)}
              title={toolAvailable(t.id, ui.scope) ? undefined : t.id === 'add-node' ? '건물 선택으로 층을 먼저 골라 주세요' : '바깥 모드에서 쓸 수 있습니다'}
              onClick={() => onTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

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
      </div>

      {/* Fixed-height row: tool options or the tool's hint. Its height never changes, so the map never jumps under the cursor. */}
      <div className="toolbar-options">
        {ui.tool === 'outdoor-path' && (
          <fieldset className="kinds">
            <legend className="visually-hidden">길 종류</legend>
            {OUTDOOR_KINDS.map((k) => (
              <label key={k.id} className="kind">
                <input type="radio" name="outdoor-kind" checked={ui.outdoorKind === k.id} onChange={() => onChange({ outdoorKind: k.id })} />
                <svg className={`kind-sample ${k.sample}`} viewBox="0 0 28 8" aria-hidden="true"><line x1="2" y1="4" x2="26" y2="4" /></svg>
                {k.label}
              </label>
            ))}
          </fieldset>
        )}

        {ui.tool === 'add-node' && (
          <fieldset className="kinds">
            <legend className="visually-hidden">지점 종류</legend>
            {ADD_KINDS.map((k) => (
              <label key={k.id} className="kind">
                <input type="radio" name="add-kind" checked={ui.addKind === k.id} onChange={() => onChange({ addKind: k.id })} />
                <span className={`kind-dot ${k.dot}`} aria-hidden="true" />
                {k.label}
              </label>
            ))}
          </fieldset>
        )}
        {ui.tool !== 'outdoor-path' && ui.tool !== 'add-node' && <p className="tool-hint">{TOOL_HINTS[ui.tool] ?? '지도를 끌어서 옮기고, 휠로 확대합니다.'}</p>}
      </div>
    </header>
  );
}
