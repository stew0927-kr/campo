// 평지 모양 수정과 평지 합치기의 options row: what is being edited, how, its own 되돌리기 / 다시 하기, and 완료 / 취소.
// 건물 외곽선 수정(OutlineForm)과 같은 모양을 씁니다.
import { plazaLabel } from '../model/plaza.ts';
import type { PlazaEditDraft } from '../model/plazaEdit.ts';
import { edgePickLabel, type PlazaEdgePick } from '../model/plazaMerge.ts';
import type { EditState } from '@campo/core';

interface EditProps {
  draft: PlazaEditDraft;
  state: EditState;
  /** The shape as it is now cannot be saved (E16·E17), with the reason. */
  problem: string | false;
  onUndo: () => void;
  onRedo: () => void;
  onCancel: () => void;
  onDone: () => void;
}

/** "평지 '분수 광장' 모양 수정": 꼭짓점 옮기기·추가·삭제, 되돌리기 / 다시 하기, 완료 / 취소. */
export function PlazaEditForm({ draft, state, problem, onUndo, onRedo, onCancel, onDone }: EditProps) {
  const p = state.plazas[draft.plazaId];
  const where = p ? plazaLabel(p) : draft.plazaId;
  const edits = draft.past.length;
  const holes = draft.rings.length - 1;
  return (
    <div className="outline-form">
      <p className="outline-what">
        <span className="outline-swatch" aria-hidden="true" />
        <strong>{where} 모양 수정</strong>
        <span className="outline-scope">
          꼭짓점 {draft.rings.reduce((n, r) => n + r.length, 0)}개{holes > 0 ? ` · 구멍 ${holes}개` : ''}
        </span>
      </p>
      <ul className="outline-how" aria-label="조작 방법">
        <li><kbd>끌기</kbd> 꼭짓점 옮기기</li>
        <li><kbd>선 위 우클릭</kbd> 꼭짓점 추가</li>
        <li><kbd>꼭짓점 우클릭</kbd> 삭제</li>
      </ul>
      {problem && <p className="field-error" role="alert">{problem}</p>}
      <div className="outline-actions">
        <button type="button" className="outline-step" aria-disabled={edits === 0} title="모양 수정 안에서 방금 한 것을 취소합니다 (Ctrl+Z)" onClick={() => edits > 0 && onUndo()}>되돌리기</button>
        <button type="button" className="outline-step" aria-disabled={draft.future.length === 0} title="되돌린 것을 다시 합니다 (Ctrl+Shift+Z)" onClick={() => draft.future.length > 0 && onRedo()}>다시 하기</button>
        <button type="button" className="outline-cancel" title="고친 것을 버립니다 (Esc)" onClick={onCancel}>취소</button>
        <button type="button" className="outline-done" title="고친 모양을 반영합니다. 되돌리기 한 번으로 취소할 수 있습니다 (Enter)" onClick={onDone}>
          완료{edits > 0 ? ` (${edits})` : ''}
        </button>
      </div>
    </div>
  );
}

interface MergeProps {
  state: EditState;
  first: PlazaEdgePick | null;
  onCancel: () => void;
}

/** "평지 합치기": 두 평지에서 한 변씩 누르면 그 사이를 채워 하나로 합칩니다. */
export function PlazaMergeForm({ state, first, onCancel }: MergeProps) {
  return (
    <div className="outline-form">
      <p className="outline-what">
        <span className="outline-swatch" aria-hidden="true" />
        <strong>평지 합치기</strong>
        <span className="outline-scope">
          {first ? `${edgePickLabel(state, first)} 골랐습니다` : '두 평지에서 합칠 변을 하나씩 누르세요'}
        </span>
      </p>
      <ul className="outline-how" aria-label="조작 방법">
        <li><kbd>변 클릭</kbd> 첫 번째 평지의 변</li>
        <li><kbd>변 클릭</kbd> 두 번째 평지의 변 → 두 변 사이를 채워 하나로</li>
      </ul>
      <p className="field-help">
        두 번째 변을 누르면 그 사이 공간까지 하나의 평지가 됩니다. 구멍은 그대로 남고, 결과는 되돌리기 한 번으로 취소됩니다.
        {first ? ' 같은 평지의 다른 변을 누르면 취소됩니다.' : ''}
      </p>
      <div className="outline-actions">
        <button type="button" className="outline-cancel" title="합치기를 그만둡니다 (Esc)" onClick={onCancel}>취소</button>
      </div>
    </div>
  );
}
