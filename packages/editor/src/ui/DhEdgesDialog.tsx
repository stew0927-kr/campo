// 고도 Δh: the height differences measured on site (the store's Δh edges), newest first, each with a 삭제 button. Opened from
// the status bar. Deleting asks once, then the dev server removes the edge from store.json; the list below follows the store.
import { useEffect, useRef, useState } from 'react';
import type { DhEdgeRow } from '../model/elevation.ts';

export function DhEdgesDialog({ rows, onDelete, onClose }: {
  rows: readonly DhEdgeRow[];
  /** Resolves to whether the edge was removed (the failure is announced by the caller). */
  onDelete: (edgeId: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    return () => dialog.close();
  }, []);
  const remove = async (row: DhEdgeRow) => {
    if (busy) return;
    if (!window.confirm(`${row.from} → ${row.to} ${row.dh}를 지울까요? 고도 저장소에서 사라지고 되돌릴 수 없습니다.`)) return;
    setBusy(row.edgeId);
    try {
      await onDelete(row.edgeId);
    } finally {
      setBusy(null);
    }
  };
  return (
    <dialog ref={ref} className="dialog dialog-dh" aria-labelledby="dh-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); onClose(); }}>
        <h2 id="dh-title">고도 Δh {rows.length > 0 && <span className="dh-count">{rows.length}개</span>}</h2>
        <p className="dh-note">현장에서 기압으로 잰 두 지점 사이의 높이 차입니다. 지우면 고도 저장소(store.json)에서 빠지고, 고도를 다시 계산해야 지도에 반영됩니다. 휴대폰에 남아 있는 측정은 다음에 불러올 때 다시 들어옵니다.</p>
        {rows.length === 0 ? (
          <p className="dh-empty">높이 차가 없습니다.</p>
        ) : (
          <ul className="dh-list" aria-label="높이 차 목록">
            {rows.map((r) => (
              <li key={r.edgeId} className="dh-row">
                <div className="dh-main">
                  <span className="dh-ends">{r.from} → {r.to}</span>
                  <span className="dh-sub">
                    측정 {r.at} · {r.sigma} · 세션 {r.session}
                    {r.qc.key !== 'ok' && <span className="dh-qc" data-qc={r.qc.key}>{r.qc.label}</span>}
                  </span>
                </div>
                <span className="dh-value">{r.dh}</span>
                <button
                  type="button"
                  className="dh-remove"
                  disabled={busy !== null}
                  aria-label={`${r.from}에서 ${r.to}까지 높이 차 ${r.dh} 삭제`}
                  onClick={() => void remove(r)}
                >
                  {busy === r.edgeId ? '지우는 중…' : '삭제'}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button type="submit" className="primary">닫기</button>
        </div>
      </form>
    </dialog>
  );
}
