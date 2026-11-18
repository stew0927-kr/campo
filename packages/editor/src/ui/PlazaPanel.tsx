// 상세 정보 of a 평지(plaza): 이름, 표면, 고정 높이 (비우면 자동), 면적·둘레, 구멍 목록과 삭제, 평지 삭제.
// Every change is asked of the Workspace as an edit (setProps, removePlazaHole, deletePlazas plans); nothing is written here.
import { useEffect, useState } from 'react';
import { PLAZA_SURFACES, type EditPlaza, type PlazaSurface } from '@campo/core';
import { PLAZA_SURFACE_LABELS, formatArea, plazaFacts, type PlazaEdits } from '../model/plaza.ts';

interface Props {
  plaza: EditPlaza;
  /** Returns the error to show, or undefined when it ran. */
  onEdit: (edits: PlazaEdits) => string | undefined;
  onRemoveHole: (index: number) => void;
  onDelete: () => void;
  /** Start 평지 모양 수정: the corners of the outer ring and the holes are dragged on the map. */
  onEditShape: () => void;
  /** Start 평지 합치기: press a side here and a side of another plaza to join them into one. */
  onMerge: () => void;
}

export function PlazaPanel({ plaza, onEdit, onRemoveHole, onDelete, onEditShape, onMerge }: Props) {
  const p = plaza.props;
  const [name, setName] = useState(p.name ?? '');
  const [height, setHeight] = useState(p.fixed_height_m === undefined ? '' : String(p.fixed_height_m));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(p.name ?? ''), [p.name, plaza.id]);
  useEffect(() => setHeight(p.fixed_height_m === undefined ? '' : String(p.fixed_height_m)), [p.fixed_height_m, plaza.id]);
  const facts = plazaFacts(plaza);
  const commit = (edits: PlazaEdits, unchanged: boolean) => {
    if (unchanged) return;
    setError(onEdit(edits) ?? null);
  };

  return (
    <form className="props plaza-panel" onSubmit={(e) => e.preventDefault()}>
      <p className="props-kind">평지</p>
      <p className="props-id">{plaza.id}</p>
      <label className="field">이름
        <input
          aria-label="평지 이름"
          value={name}
          placeholder="예: 분수 광장"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => commit({ name }, name.trim() === (p.name ?? ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit({ name }, name.trim() === (p.name ?? ''));
            }
          }}
        />
      </label>
      <label className="field">표면
        <select aria-label="표면" value={p.surface ?? ''} onChange={(e) => commit({ surface: e.target.value === '' ? null : (e.target.value as PlazaSurface) }, false)}>
          <option value="">정하지 않음</option>
          {PLAZA_SURFACES.map((s) => <option key={s} value={s}>{PLAZA_SURFACE_LABELS[s]}</option>)}
        </select>
      </label>
      <label className="field">고정 높이 (m, 정표고)
        <input
          aria-label="고정 높이"
          inputMode="decimal"
          value={height}
          placeholder="자동"
          aria-invalid={error !== null}
          onChange={(e) => setHeight(e.target.value)}
          onBlur={() => commit({ height }, height.trim() === (p.fixed_height_m === undefined ? '' : String(p.fixed_height_m)))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit({ height }, height.trim() === (p.fixed_height_m === undefined ? '' : String(p.fixed_height_m)));
            }
          }}
        />
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <p className="field-help">비워 두면 자동입니다: 평지 위 지점들의 높이, 지점이 없으면 평지 안 지형의 가운데값으로 정합니다. 표면은 안내용이고 길찾기에는 쓰이지 않습니다.</p>
      <dl className="plaza-facts">
        <div><dt>면적</dt><dd data-fact="area">{formatArea(facts.areaM2)}</dd></div>
        <div><dt>둘레</dt><dd data-fact="perimeter">{facts.perimeterM.toFixed(1)} m</dd></div>
        <div><dt>구멍</dt><dd data-fact="holes">{facts.holes.length}개</dd></div>
      </dl>
      {facts.holes.length > 0 && (
        <ul className="plaza-holes" aria-label="구멍 목록">
          {facts.holes.map((h) => (
            <li key={h.index}>
              구멍 {h.index + 1} · {formatArea(h.areaM2)}
              <button type="button" onClick={() => onRemoveHole(h.index)}>삭제</button>
            </li>
          ))}
        </ul>
      )}
      <p className="field-help">구멍을 더 뚫으려면 평지 도구(G)로 이 평지 안쪽에 닫힌 도형을 그리세요.</p>
      <div className="plaza-shape-actions">
        <button type="button" onClick={onEditShape} title="지도에서 꼭짓점을 끌어 옮기고, 선 위 우클릭으로 더하고, 꼭짓점 우클릭으로 지웁니다">모양 수정</button>
        <button type="button" onClick={onMerge} title="두 평지에서 한 변씩 눌러 그 사이를 채우며 하나로 합칩니다">다른 평지와 합치기</button>
      </div>
      <button type="button" className="danger" onClick={onDelete}>평지 삭제</button>
    </form>
  );
}
