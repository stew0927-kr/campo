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

/** SPEC §8: step_free, needs_check and source are always shown. Other fields come later. */
export function PropertiesPanel({ feature, onEdit }: { feature: CampoFeature | undefined; onEdit: (edits: CommonEdits) => void }) {
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
    </form>
  );
}
