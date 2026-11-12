import type { ReactNode } from 'react';
import { ELEVATOR_NOT_DRAWN, type OutdoorKind } from '../model/tools.ts';
import { basemaps, type BasemapId } from '../map/basemaps.ts';
import { INDOOR_ADD_KINDS, OUTDOOR_ADD_KINDS, TOOL_HINTS, TOOL_KEYS, effectiveAddKind, toolAvailable, type AddKind, type Tool, type UiState } from './ui-state.ts';

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'select', label: '선택' },
  { id: 'path', label: '길 그리기' },
  { id: 'building', label: '건물' },
  { id: 'select-building', label: '건물 선택' },
  { id: 'add-node', label: '지점 추가' },
  { id: 'connect', label: '잇기' },
  { id: 'portal', label: '포탈' },
  { id: 'bridge', label: '연결통로' },
  { id: 'door', label: '문 연속 찍기' },
  { id: 'strip', label: '강의실 줄' },
  { id: 'restroom', label: '화장실' },
  { id: 'elevator', label: '엘리베이터' },
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
  { id: 'stairs', label: '계단', dot: 'dot-stairs' },
  { id: 'outdoor', label: '바깥 지점', dot: 'dot-door' },
  { id: 'poi', label: '출발·도착 후보', dot: 'dot-poi' },
];

/** A button for an operation (SPEC-v0.2 5.1 작업): its key, and why it cannot run now. */
export interface Operation {
  id: string;
  label: string;
  shortcut: string;
  /** Korean reason shown as the tooltip, or false when it can run. */
  blocked: string | false;
  onClick: () => void;
}

interface Props {
  ui: UiState;
  operations: Operation[];
  /** Form of the tool that has one (강의실 줄). */
  toolForm?: ReactNode;
  campusName: string;
  canSave: boolean;
  saving: boolean;
  onTool: (tool: Tool) => void;
  onChange: (patch: Partial<UiState>) => void;
  onSave: () => void;
}

export function Toolbar({ ui, operations, toolForm, campusName, canSave, saving, onTool, onChange, onSave }: Props) {
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
              title={toolAvailable(t.id, ui.scope) ? (TOOL_KEYS[t.id] ? `${t.label} (${TOOL_KEYS[t.id]})` : undefined) : t.id === 'portal' || t.id === 'bridge' ? '건물 선택으로 층을 먼저 골라 주세요' : '바깥 모드에서 쓸 수 있습니다'}
              onClick={() => onTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="toolbar-group" role="group" aria-label="작업">
          {operations.map((o) => (
            <button
              key={o.id}
              type="button"
              className="tool op"
              data-op={o.id}
              aria-disabled={o.blocked !== false}
              title={o.blocked !== false ? o.blocked : `${o.label} (${o.shortcut})`}
              onClick={o.onClick}
            >
              {o.label}
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
        {ui.tool === 'path' && (
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
        )}
        {ui.tool === 'path' && <p className="tool-hint" role="note">{ELEVATOR_NOT_DRAWN}.</p>}

        {ui.tool === 'door' && (
          <>
            <label className="inline-field">다음 호실 번호
              <input
                className="door-ref"
                value={ui.doorRun.nextRef}
                placeholder="301"
                onChange={(e) => onChange({ doorRun: { ...ui.doorRun, nextRef: e.target.value } })}
              />
            </label>
            <fieldset className="kinds">
              <legend className="visually-hidden">번호 간격</legend>
              {([1, 2] as const).map((n) => (
                <label key={n} className="kind">
                  <input type="radio" name="door-step" checked={ui.doorRun.step === n} onChange={() => onChange({ doorRun: { ...ui.doorRun, step: n } })} />
                  간격 {n}{n === 2 ? ' (2)' : ' (1)'}
                </label>
              ))}
            </fieldset>
            <p className="tool-hint">Shift+누르기는 뒷문, F는 앞문·뒷문 뒤집기입니다.</p>
          </>
        )}
        {ui.tool === 'strip' && toolForm}

        {ui.tool === 'add-node' && (
          <fieldset className="kinds">
            <legend className="visually-hidden">지점 종류</legend>
            {ADD_KINDS.filter((k) => (ui.scope.kind === 'outdoor' ? OUTDOOR_ADD_KINDS : INDOOR_ADD_KINDS).includes(k.id)).map((k) => (
              <label key={k.id} className="kind">
                <input type="radio" name="add-kind" checked={effectiveAddKind(ui) === k.id} onChange={() => onChange({ addKind: k.id })} />
                <span className={`kind-dot ${k.dot}`} aria-hidden="true" />
                {k.label}
              </label>
            ))}
          </fieldset>
        )}
        {ui.tool !== 'path' && ui.tool !== 'add-node' && ui.tool !== 'door' && ui.tool !== 'strip' && <p className="tool-hint">{TOOL_HINTS[ui.tool] ?? '지도를 끌어서 옮기고, 휠로 확대합니다.'}</p>}
      </div>
    </header>
  );
}
