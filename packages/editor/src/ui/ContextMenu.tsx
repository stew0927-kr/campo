// The right-click menu on the map: edit kind / name / step_free of the selection, copy to other floors, delete.
// It is not modal: Esc, a click anywhere outside, or choosing an item closes it. Every item only asks App for a Plan.
import { useEffect, useRef, useState } from 'react';
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
  onEdit: (edits: MenuEdits) => void;
  onCopy: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const STEP_FREE = [
  { value: 'null', label: '모름 (확인 전)' },
  { value: 'true', label: '있음 (현장 확인)' },
  { value: 'false', label: '없음 (계단·문턱)' },
];

export function ContextMenu({ x, y, summary, fields, copyBlocked, deleteBlocked, onEdit, onCopy, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(fields.nameValue ?? '');
  const [pos, setPos] = useState({ left: x, top: y });
  const editable = fields.kinds !== null || fields.name || fields.stepFree;

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
  }, [x, y, editing]);

  const item = (label: string, blocked: string | false, run: () => void, id: string) => (
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

  return (
    <div ref={ref} className="ctx-menu" role="menu" aria-label="선택한 것의 메뉴" style={pos} onContextMenu={(e) => e.preventDefault()}>
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
      {item('다른 층에 복사…', copyBlocked, onCopy, 'copy')}
      {copyBlocked !== false && <p className="ctx-reason">{copyBlocked}</p>}
      {item('삭제', deleteBlocked, onDelete, 'delete')}
    </div>
  );
}
