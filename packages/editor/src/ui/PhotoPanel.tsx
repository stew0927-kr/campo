// 사진 토글 버튼(3D 버튼 아래)과, 핀을 누르면 뜨는 그 지점 사진 목록(교체 · 삭제).
import { useRef } from 'react';
import { SERVER_ONLY, type PhotoPin, type PhotoRow } from '../photos/photoModel.ts';
import type { PhotoManager } from '../photos/usePhotos.ts';

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="6" width="18" height="14" rx="3" fill="currentColor" fillOpacity={0.14} stroke="currentColor" strokeWidth={1.8} />
      <circle cx="12" cy="13" r="3.4" fill="none" stroke="currentColor" strokeWidth={1.8} />
      <path d="M8.5 6l1.4-2.2h4.2L15.5 6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
    </svg>
  );
}

/** 사진 토글. PC 편집기(서버 없음)에서는 누르면 '관리자 웹(/map/)에서만 됩니다'만 알린다. */
export function PhotoButton({ manager, onUnavailable }: { manager: PhotoManager; onUnavailable: (text: string) => void }) {
  const total = manager.rows?.length ?? null;
  return (
    <button
      type="button"
      className="view3d-btn photo-btn"
      aria-pressed={manager.available ? manager.on : false}
      data-unavailable={manager.available ? undefined : 'true'}
      aria-label="사진 지점 보기"
      title={manager.available ? (manager.on ? '사진 지점을 숨깁니다' : '서버에 올라간 사진 지점을 지도에 표시합니다. 핀을 누르면 사진을 바꾸거나 지울 수 있습니다') : SERVER_ONLY}
      onClick={() => (manager.available ? manager.toggle() : onUnavailable(SERVER_ONLY))}
    >
      <CameraIcon />
      <span className="view3d-label">사진</span>
      {manager.on && total !== null && <span className="photo-btn-count">{total}</span>}
    </button>
  );
}

const headingText = (deg: number | null) => (deg === null ? '방향 없음' : `${Math.round(deg)}°`);

/** 핀을 누른 지점의 사진 목록. 사진마다 교체(파일 고르기)와 삭제(확인 후). */
export function PhotoPanel({ pin, manager, floor, onDelete }: { pin: PhotoPin; manager: PhotoManager; floor: string; onDelete: (row: PhotoRow) => void }) {
  return (
    <section className="photo-panel" aria-labelledby="photo-panel-title">
      <header className="photo-panel-head">
        <div>
          <h2 id="photo-panel-title">사진 {pin.photos.length}장</h2>
          <p className="photo-panel-sub">{floor} · 지점 <code>{pin.nodeId}</code></p>
        </div>
        <button type="button" className="photo-panel-close" aria-label="사진 목록 닫기" onClick={() => manager.setOpen(null)}>✕</button>
      </header>
      {manager.admin === false && <p className="photo-panel-note" role="alert">관리자 계정만 사진을 바꿀 수 있습니다.</p>}
      <ul className="photo-list">
        {pin.photos.map((row) => <PhotoItem key={row.id} row={row} manager={manager} onDelete={onDelete} />)}
      </ul>
      <p className="photo-panel-help">교체할 사진은 브라우저에서 WebP(원본 1280px · 썸네일 128px)로 바꿔 올립니다. 한 장 2 MB까지입니다.</p>
    </section>
  );
}

function PhotoItem({ row, manager, onDelete }: { row: PhotoRow; manager: PhotoManager; onDelete: (row: PhotoRow) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const busy = manager.busy === row.id;
  const locked = manager.busy !== null || manager.admin !== true;
  return (
    <li className="photo-item" aria-busy={busy}>
      <a className="photo-thumb" href={row.full_url} target="_blank" rel="noreferrer" title="원본 사진을 새 탭에서 봅니다">
        <img src={row.thumb_url} alt={`사진 ${row.id}`} loading="lazy" width={88} height={66} />
      </a>
      <div className="photo-meta">
        <span className="photo-id" title={row.id}>{row.id}</span>
        <span className="photo-detail">{headingText(row.heading_deg)} · {row.updated_at.slice(0, 10)}</span>
        <div className="photo-actions">
          <button type="button" disabled={locked} onClick={() => input.current?.click()}>{busy ? '처리 중…' : '교체'}</button>
          <button type="button" className="danger" disabled={locked} onClick={() => onDelete(row)}>삭제</button>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void manager.replace(row, file);
            }}
          />
        </div>
      </div>
    </li>
  );
}
