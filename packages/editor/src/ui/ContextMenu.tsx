// The right-click menu on the map: edit kind / name / step_free of the selection, copy to other floors, 층 연동 취소, delete.
// A drawn 고도 단절선 has its own menu (BreaklineContextMenu): its drop, its low side, a point added or removed, delete.
// It is not modal: Esc, a click anywhere outside, or choosing an item closes it. Every item only asks App for a Plan
// (or, for a 고도 단절선, for a change of the elevation store).
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { BreakLineSide } from '@campo/core/elevation';
import { parseLevels } from '../model/building.ts';
import { parseDropM, sideLabel } from '../model/elevation.ts';
import type { MenuEdits, MenuFields } from '../model/menu.ts';
import { tabLabel } from './registry.ts';

interface Props {
  /** Page coordinates of the right-click. */
  x: number;
  y: number;
  /** "지점 5개, 구간 4개" */
  summary: string;
  fields: MenuFields;
  /** Why 다른 층에 복사 cannot run, or false. */
  copyBlocked: string | false;
  deleteBlocked: string | false;
  /** How many of the selected points are linked to other floors (sync_group); 층 연동 취소 is offered when there is one. */
  synced: number;
  onEdit: (edits: MenuEdits) => void;
  onCopy: () => void;
  onUnsync: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const STEP_FREE = [
  { value: 'null', label: '모름 (확인 전)' },
  { value: 'true', label: '있음 (현장 확인)' },
  { value: 'false', label: '없음 (계단·문턱)' },
];

/** The menu's frame: placed at the pointer and kept inside the window; Esc or a press outside closes it. */
function MenuShell({ x, y, label, onClose, relayout, children }: { x: number; y: number; label: string; onClose: () => void; relayout: unknown; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // Captured first, so Esc closes the menu before anything else reacts to it.
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  // Keep the menu inside the window.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
  }, [x, y, relayout]);

  return (
    <div ref={ref} className="ctx-menu" role="menu" aria-label={label} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>
  );
}

const menuItem = (label: string, blocked: string | false, run: () => void, id: string) => (
  <button
    type="button"
    role="menuitem"
    className="ctx-item"
    data-item={id}
    aria-disabled={blocked !== false}
    title={blocked !== false ? blocked : undefined}
    onClick={() => (blocked === false ? run() : undefined)}
  >
    {label}
  </button>
);

export function ContextMenu({ x, y, summary, fields, copyBlocked, deleteBlocked, synced, onEdit, onCopy, onUnsync, onDelete, onClose }: Props) {
  // 속성 바로 편집 opens unfolded: the right-click is usually for exactly that.
  const [editing, setEditing] = useState(true);
  const [name, setName] = useState(fields.nameValue ?? '');
  const editable = fields.kinds !== null || fields.name || fields.stepFree;

  return (
    <MenuShell x={x} y={y} label="선택한 것의 메뉴" onClose={onClose} relayout={editing}>
      <p className="ctx-head">{summary}</p>
      {editable
        ? <button type="button" role="menuitem" className="ctx-item" data-item="props" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>속성 바로 편집 {editing ? '▴' : '▾'}</button>
        : <button type="button" role="menuitem" className="ctx-item" data-item="props" aria-disabled="true" title={`이 선택은 ${tabLabel('properties')} 탭에서 하나씩 고쳐 주세요.`}>속성 바로 편집</button>}
      {!editable && <p className="ctx-reason">지점과 구간이 섞여 있거나 종류가 달라 한꺼번에 고칠 수 없습니다. 하나씩 골라 {tabLabel('properties')} 탭에서 고쳐 주세요.</p>}
      {editable && editing && (
        <div className="ctx-props">
          {fields.kinds && (
            <label>종류
              <select aria-label="종류" value={fields.kind ?? ''} onChange={(e) => onEdit({ kind: e.target.value })}>
                {fields.kind === null && <option value="" disabled>여러 종류</option>}
                {fields.kinds.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
          {fields.name && (
            <label>이름
              <input
                aria-label="이름"
                value={name}
                placeholder={fields.nameValue === null ? '여러 이름' : ''}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onEdit({ name });
                  }
                }}
              />
            </label>
          )}
          {fields.stepFree && (
            <label>계단·문턱 없이 지날 수 있는지 (step_free)
              <select aria-label="step_free" value={fields.stepFreeValue ?? ''} onChange={(e) => onEdit({ step_free: e.target.value === 'null' ? null : e.target.value === 'true' })}>
                {fields.stepFreeValue === null && <option value="" disabled>여러 값</option>}
                {STEP_FREE.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
          {fields.name && <p className="field-help">이름은 Enter를 눌러 넣습니다.</p>}
        </div>
      )}
      {menuItem('다른 층에 복사…', copyBlocked, onCopy, 'copy')}
      {copyBlocked !== false && <p className="ctx-reason">{copyBlocked}</p>}
      {synced > 0 && menuItem('층 연동 취소', false, onUnsync, 'unsync')}
      {synced > 0 && <p className="ctx-reason">지점 {synced}개가 다른 층과 연동되어 있습니다. 취소하면 이 층의 지점만 따로 고칠 수 있습니다.</p>}
      {menuItem('삭제', deleteBlocked, onDelete, 'delete')}
    </MenuShell>
  );
}

interface BreaklineMenuProps {
  x: number;
  y: number;
  /** "고도 단절선 2" */
  title: string;
  lowSide: BreakLineSide | undefined;
  dropM: number | undefined;
  /** How many points the line has (a point can be removed while there are more than two). */
  points: number;
  /** The point right-clicked, if any. */
  point: number | undefined;
  /** Whether a segment was right-clicked (a point can be added there). */
  onSegment: boolean;
  onDrop: (dropM: number | null) => void;
  onSide: (side: BreakLineSide) => void;
  onAddPoint: () => void;
  onRemovePoint: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/** The right-click menu of a drawn 고도 단절선: 높이차, 낮은 쪽 면(반전), a point added or removed, 삭제. */
export function BreaklineContextMenu(p: BreaklineMenuProps) {
  const [editing, setEditing] = useState(true);
  const [drop, setDrop] = useState(p.dropM === undefined ? '' : String(p.dropM));
  const [error, setError] = useState<string | null>(null);
  const applyDrop = () => {
    const v = parseDropM(drop);
    if (v !== null && typeof v === 'object') return setError(v.error);
    setError(null);
    p.onDrop(v);
  };
  const flipBlocked = p.lowSide ? false : '낮은 쪽 면을 먼저 정해 주세요(아래 왼쪽·오른쪽 또는 지도에서 면 클릭).';

  return (
    <MenuShell x={p.x} y={p.y} label="고도 단절선 메뉴" onClose={p.onClose} relayout={`${editing}${error ?? ''}`}>
      <p className="ctx-head">{p.title} · 낮은 쪽 {sideLabel(p.lowSide)}{p.dropM !== undefined ? ` · 높이차 ${p.dropM} m` : ''}</p>
      <button type="button" role="menuitem" className="ctx-item" data-item="props" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>속성 바로 편집 {editing ? '▴' : '▾'}</button>
      {editing && (
        <div className="ctx-props">
          <label>높이차 (m, 높은 쪽 − 낮은 쪽)
            <input
              aria-label="높이차"
              inputMode="decimal"
              value={drop}
              placeholder="예: 1.5 (비우면 지움)"
              aria-invalid={error !== null}
              onChange={(e) => setDrop(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyDrop();
                }
              }}
            />
          </label>
          {error && <p className="ctx-reason" role="alert">{error}</p>}
          <label>낮은 쪽 면 (그린 방향 기준)
            <select aria-label="낮은 쪽 면" value={p.lowSide ?? ''} onChange={(e) => e.target.value && p.onSide(e.target.value as BreakLineSide)}>
              {!p.lowSide && <option value="" disabled>정하지 않음</option>}
              <option value="left">왼쪽</option>
              <option value="right">오른쪽</option>
            </select>
          </label>
          <p className="field-help">높이차는 Enter를 눌러 넣습니다.</p>
        </div>
      )}
      {menuItem('면 반전', flipBlocked, () => p.lowSide && p.onSide(p.lowSide === 'left' ? 'right' : 'left'), 'flip-side')}
      {p.onSegment && menuItem('여기에 꺾은점 추가', false, p.onAddPoint, 'add-point')}
      {p.point !== undefined && menuItem('이 꺾은점 삭제', p.points > 2 ? false : '점이 두 개뿐이라 지울 수 없습니다.', p.onRemovePoint, 'remove-point')}
      {menuItem('단절선 삭제', false, p.onDelete, 'delete')}
    </MenuShell>
  );
}

interface BuildingMenuProps {
  x: number;
  y: number;
  /** "건물 1개" */
  summary: string;
  name: string;
  levels: number[];
  /** ext.floor_height_m, when set. */
  floorHeight: number | undefined;
  /** Each returns the reason it did not happen (shown in the menu), or undefined (the menu closes). */
  onName: (name: string) => string | undefined;
  onLevels: (levels: number[]) => string | undefined;
  onFloorHeight: (text: string) => string | undefined;
  onEditOutline: () => void;
  deleteBlocked: string | false;
  onDelete: () => void;
  onClose: () => void;
}

/** The right-click menu of a building outline: 이름, 층 목록, 층고 (unfolded), 외곽선 수정, 삭제. */
export function BuildingContextMenu(p: BuildingMenuProps) {
  const [editing, setEditing] = useState(true);
  const [name, setName] = useState(p.name);
  const [levels, setLevels] = useState([...p.levels].sort((a, b) => b - a).join(', '));
  const [height, setHeight] = useState(p.floorHeight === undefined ? '' : String(p.floorHeight));
  const [error, setError] = useState<string | null>(null);
  const enter = (run: () => string | undefined) => (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    setError(run() ?? null);
  };

  return (
    <MenuShell x={p.x} y={p.y} label="건물 메뉴" onClose={p.onClose} relayout={`${editing}${error ?? ''}`}>
      <p className="ctx-head">{p.summary}</p>
      <button type="button" role="menuitem" className="ctx-item" data-item="props" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>속성 바로 편집 {editing ? '▴' : '▾'}</button>
      {editing && (
        <div className="ctx-props">
          <label>건물 이름
            <input aria-label="건물 이름" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={enter(() => p.onName(name))} />
          </label>
          <label>층 목록 (예: -1, 1~5)
            <input
              aria-label="층 목록"
              value={levels}
              onChange={(e) => setLevels(e.target.value)}
              onKeyDown={enter(() => {
                const parsed = parseLevels(levels);
                return 'error' in parsed ? parsed.error : p.onLevels(parsed.levels);
              })}
            />
          </label>
          <label>층고 (m, 비우면 기본 3.9 m)
            <input aria-label="층고" inputMode="decimal" value={height} placeholder="예: 3.9" onChange={(e) => setHeight(e.target.value)} onKeyDown={enter(() => p.onFloorHeight(height))} />
          </label>
          {error && <p className="ctx-reason" role="alert">{error}</p>}
          <p className="field-help">각 칸은 Enter를 눌러 넣습니다.</p>
        </div>
      )}
      {menuItem('외곽선 수정', false, p.onEditOutline, 'edit-outline')}
      {menuItem('삭제', p.deleteBlocked, p.onDelete, 'delete')}
    </MenuShell>
  );
}
