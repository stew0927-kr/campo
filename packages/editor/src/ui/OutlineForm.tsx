import { floorLabel } from '../model/scope.ts';
import type { OutlineDraft } from '../model/outlineEdit.ts';

interface Props {
  draft: OutlineDraft;
  buildingName: string;
  /** The floor already has its own outline (it can go back to the building's). */
  ownOutline: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onCancel: () => void;
  onDone: () => void;
}

/** 외곽선 수정 options row: what is edited, how, its own 되돌리기 / 다시 하기, and 완료 / 취소. */
export function OutlineForm({ draft, buildingName, ownOutline, onUndo, onRedo, onReset, onCancel, onDone }: Props) {
  const what = draft.level === null ? `${buildingName} 건물 외곽선` : `${buildingName} ${floorLabel(draft.level)} 외곽선`;
  const scopeNote = draft.level === null ? '층만의 외곽선이 없는 모든 층' : ownOutline ? '이 층만의 외곽선' : '완료하면 이 층만의 외곽선이 생깁니다';
  const edits = draft.past.length;
  return (
    <div className="outline-form">
      <p className="outline-what">
        <span className="outline-swatch" aria-hidden="true" />
        <strong>{what}</strong>
        <span className="outline-scope">{scopeNote} · 꼭짓점 {draft.corners.length}개</span>
      </p>
      <ul className="outline-how" aria-label="조작 방법">
        <li><kbd>끌기</kbd> 꼭짓점 옮기기</li>
        <li><kbd>선 위 우클릭</kbd> 꼭짓점 추가</li>
        <li><kbd>꼭짓점 우클릭</kbd> 삭제</li>
      </ul>
      <div className="outline-actions">
        <button type="button" className="outline-step" aria-disabled={edits === 0} title="외곽선 안에서 방금 한 것을 취소합니다 (Ctrl+Z)" onClick={() => edits > 0 && onUndo()}>되돌리기</button>
        <button type="button" className="outline-step" aria-disabled={draft.future.length === 0} title="되돌린 것을 다시 합니다 (Ctrl+Shift+Z)" onClick={() => draft.future.length > 0 && onRedo()}>다시 하기</button>
        {draft.level !== null && ownOutline && (
          <button type="button" className="outline-step" title="이 층만의 외곽선을 지우고 건물 외곽선을 따르게 합니다" onClick={onReset}>건물 외곽선으로 되돌리기</button>
        )}
        <button type="button" className="outline-cancel" title="고친 것을 버립니다 (Esc)" onClick={onCancel}>취소</button>
        <button type="button" className="outline-done" title="고친 외곽선을 반영합니다. 되돌리기 한 번으로 취소할 수 있습니다 (Enter)" onClick={onDone}>
          완료{edits > 0 ? ` (${edits})` : ''}
        </button>
      </div>
    </div>
  );
}
