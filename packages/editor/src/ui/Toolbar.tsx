import type { ReactNode } from 'react';
import { basemaps, type BasemapId } from '../map/basemaps.ts';
import { OPERATIONS, TOOLBAR_GROUPS, TOOLS, toolBlocked, toolDef, tooltip, type OperationId, type Tool } from './registry.ts';
import { TOOL_OPTIONS } from './ToolOptions.tsx';
import type { UiState } from './ui-state.ts';

/** What an operation button needs to know right now. Its name, key and description come from the registry. */
export interface OperationState {
  /** Korean reason shown in the tooltip, or false when it can run. */
  blocked: string | false;
  /** How many things it would act on, shown next to the name. */
  count?: number;
}

interface Props {
  ui: UiState;
  operations: Record<OperationId, OperationState>;
  /** Form of the active tool when it keeps its own state (강의실 자동 연결). */
  toolForm?: ReactNode;
  campusName: string;
  canSave: boolean;
  saving: boolean;
  onTool: (tool: Tool) => void;
  onOperation: (id: OperationId) => void;
  onChange: (patch: Partial<UiState>) => void;
  onSave: () => void;
  onHelp: () => void;
}

export function Toolbar({ ui, operations, toolForm, campusName, canSave, saving, onTool, onOperation, onChange, onSave, onHelp }: Props) {
  const Options = TOOL_OPTIONS[ui.tool];
  return (
    <header className="toolbar">
      <div className="toolbar-main">
        <h1 className="brand">
          캠포 편집기 <span className="brand-campus">{campusName}</span>
        </h1>

        {TOOLBAR_GROUPS.map((group) => (
          <section key={group.id} className="toolbar-section" data-group={group.id} role="group" aria-labelledby={`toolbar-${group.id}`}>
            <span className="toolbar-caption" id={`toolbar-${group.id}`}>{group.label}</span>
            <div className="toolbar-group">
              {TOOLS.filter((t) => t.group === group.id).map((t) => {
                const blocked = toolBlocked(t.id, ui.scope);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className="tool"
                    data-tool={t.id}
                    aria-pressed={ui.tool === t.id}
                    aria-keyshortcuts={t.key}
                    disabled={blocked !== false}
                    title={tooltip(t, blocked)}
                    onClick={() => onTool(t.id)}
                  >
                    {t.label}
                  </button>
                );
              })}
              {OPERATIONS.filter((o) => o.group === group.id).map((o) => {
                const { blocked, count } = operations[o.id];
                return (
                  <button
                    key={o.id}
                    type="button"
                    className="tool op"
                    data-op={o.id}
                    aria-disabled={blocked !== false}
                    aria-keyshortcuts={o.key?.replace('Ctrl', 'Control')}
                    title={tooltip(o, blocked)}
                    onClick={() => onOperation(o.id)}
                  >
                    {count ? `${o.label} (${count})` : o.label}
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        <div className="toolbar-end">
          <label className="basemap" title="따라 그릴 배경 지도를 고릅니다.">
            배경
            <select value={ui.basemap} onChange={(e) => onChange({ basemap: e.target.value as BasemapId })}>
              {basemaps().map((b) => (
                <option key={b.id} value={b.id} disabled={!b.source} title={b.unavailableReason}>
                  {b.label}{b.source ? '' : ' (API 키 필요)'}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="help-button" onClick={onHelp} title="도구와 단축키 목록을 엽니다 (?)" aria-keyshortcuts="?">도움말</button>
          <button
            type="button"
            className="save"
            onClick={onSave}
            disabled={!canSave || saving}
            title={canSave ? '바뀐 내용을 data/ 폴더의 파일에 씁니다 (Ctrl+S)' : '저장할 변경이 없습니다 (Ctrl+S)'}
            aria-keyshortcuts="Control+S"
          >
            {saving ? '저장하는 중…' : '저장'}
          </button>
        </div>
      </div>

      {/* Fixed-height row: the active tool's options, its form, or its hint. Its height never changes, so the map never jumps under the cursor. */}
      <div className="toolbar-options">
        <span className="toolbar-active">{toolDef(ui.tool).label}</span>
        {Options ? <Options ui={ui} onChange={onChange} /> : toolForm ?? <p className="tool-hint">{toolDef(ui.tool).hint}</p>}
      </div>
    </header>
  );
}
