import type { CampoFeature } from '@campo/core';
import type { CommonEdits } from '../model/links.ts';

const SOURCES = [
  { value: 'field-survey-2026-11', label: '현장 확인 (2026-11)' },
  { value: 'ngii-imagery', label: '영상지도 보고 그림' },
  { value: 'school-floorplan', label: '학교 안내도' },
  { value: 'estimate', label: '추정 (현장 확인 필요)' },
];

const KIND_LABELS: Record<string, string> = {
  building: '건물', outdoor: '바깥 지점', entrance: '출입구', door: '문', corridor: '복도 지점',
  elevator_stop: '엘리베이터 정차', stair_landing: '계단참', poi: '출발·도착 후보',
  footway: '평지 길', steps: '계단', corridor_edge: '복도', elevator: '엘리베이터', ramp: '경사로',
};

/** What the delete button removes along with the chosen feature, so nobody is surprised. */
const DELETE_HINTS: Record<CampoFeature['properties']['kind'], string> = {
  node: '이 지점에 이어진 구간도 함께 삭제됩니다.',
  edge: '이 구간만 삭제합니다. 양 끝 지점은 그대로 남습니다.',
  building: '건물 안의 지점과 구간, 다른 건물로 이어진 연결통로도 함께 삭제됩니다.',
};

const DELETE_LABELS: Record<CampoFeature['properties']['kind'], string> = {
  node: '지점 삭제',
  edge: '구간 삭제',
  building: '건물 삭제',
};

/** SPEC §8: step_free, needs_check and source are always shown. Other fields come later. */
export function PropertiesPanel({ feature, onEdit, onDelete }: {
  feature: CampoFeature | undefined;
  onEdit: (edits: CommonEdits) => void;
  onDelete?: (featureId: string) => void;
}) {
  if (!feature) return <p className="panel-empty">이동 도구로 지점이나 구간을 누르면 여기에서 속성을 고칠 수 있습니다.</p>;
  const p = feature.properties;
  const kind = p.kind === 'node' ? KIND_LABELS[p.node_type] : p.kind === 'edge'
    ? (p.edge_type === 'portal' ? '포탈' : p.edge_type === 'bridge' ? '연결통로' : KIND_LABELS[p.highway === 'corridor' ? 'corridor_edge' : p.highway])
    : KIND_LABELS.building;
  const sources = SOURCES.some((s) => s.value === p.source) ? SOURCES : [...SOURCES, { value: p.source, label: p.source }];
  return (
    <form className="props" onSubmit={(e) => e.preventDefault()}>
      <p className="props-kind">{kind}</p>
      <p className="props-id">{feature.id}</p>
      {p.kind === 'edge' && (
        <label className="check-field">
          <input type="checkbox" checked={p.step_free} onChange={(e) => onEdit({ step_free: e.target.checked })} />
          계단·문턱 없이 지날 수 있음 (step_free)
        </label>
      )}
      <label className="check-field">
        <input type="checkbox" checked={p.needs_check === true} onChange={(e) => onEdit({ needs_check: e.target.checked })} />
        현장 확인 필요 (needs_check)
      </label>
      <label className="field">출처 (source)
        <select value={p.source} onChange={(e) => onEdit({ source: e.target.value })}>
          {sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      {p.kind === 'edge' && <p className="field-help">step_free는 현장에서 확인했을 때만 켜 주세요.</p>}
      {onDelete && (
        <div className="props-delete">
          <p className="field-help">{DELETE_HINTS[p.kind]} 저장하지 않고 새로 고치면 되돌릴 수 있습니다.</p>
          <button type="button" className="btn-danger" onClick={() => onDelete(feature.id)}>
            {DELETE_LABELS[p.kind]}
          </button>
        </div>
      )}
    </form>
  );
}
