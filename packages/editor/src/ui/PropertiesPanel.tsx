import { useEffect, useId, useState, type ReactNode } from 'react';
import { ACCESS_LABELS, ACCESS_PLACEHOLDERS, ACCESS_PRESETS, ACCESS_PROPS, FLIGHT_SEC_MAX, FLIGHT_SEC_MIN, FLOOR_FLIGHT_SEC, type AccessProp } from '@campo/core';
import { elevationBadges, flagBlocked } from '../model/elevation.ts';
import type { CommonEdits } from '../model/ops.ts';
import type { AnyProps } from '../model/session.ts';

const SOURCES = [
  { value: 'field-survey-2026-11', label: '현장 확인 (2026-11)' },
  { value: 'ngii-imagery', label: '영상지도 보고 그림' },
  { value: 'school-floorplan', label: '학교 안내도' },
  { value: 'estimate', label: '추정 (현장 확인 필요)' },
  { value: 'osm', label: 'OpenStreetMap (© OSM 기여자)' },
];

const KIND_LABELS: Record<string, string> = {
  building: '건물', outdoor: '바깥 지점', entrance: '출입구', door: '문', corridor: '복도 지점',
  elevator_stop: '엘리베이터 정차', stair_landing: '계단참', poi: '출발·도착 후보', restroom: '화장실',
  footway: '평지 길', steps: '계단', corridor_edge: '복도', elevator: '엘리베이터', ramp: '경사로', plaza: '평지',
};

/** What `conveying` says, read from the drawn direction (from → to). Turning it round is the 뒤집기 operation (F). */
const CONVEYING_TEXT: Record<string, string> = {
  forward: '움직이는 방향: 그린 방향(시작 → 끝)으로 움직입니다.',
  backward: '움직이는 방향: 그린 방향의 반대(끝 → 시작)로 움직입니다.',
  reversible: '움직이는 방향: 시간에 따라 바뀝니다(양쪽으로 갈 수 있음).',
};

/** SPEC §8: step_free, needs_check and source are always shown. Other fields come later. */
const STEP_FREE_OPTIONS = [
  { value: 'true', label: '있음: 계단·문턱 없이 지날 수 있음 (현장 확인)' },
  { value: 'false', label: '없음: 계단이나 문턱이 있음' },
  { value: 'null', label: '모름 (확인 전)' },
];

/**
 * One of 개방시간 / 폐쇄기간 / 개방조건: the presets as one-press buttons, anything else typed in. Typing is kept here and
 * written on Enter or when the field is left, so one value is one history entry.
 */
function AccessField({ name, value, onCommit }: { name: AccessProp; value: string | undefined; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const label = ACCESS_LABELS[name];
  const commit = () => {
    if (draft.trim() !== (value ?? '')) onCommit(draft);
  };
  return (
    <div className="field access-field" data-access={name}>
      <label>{label} ({name})
        <input
          value={draft}
          placeholder={ACCESS_PLACEHOLDERS[name]}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
      </label>
      {(ACCESS_PRESETS[name].length > 0 || value !== undefined) && (
        <div className="presets" role="group" aria-label={`${label} 빠른 선택`}>
          {ACCESS_PRESETS[name].map((preset) => (
            <button key={preset} type="button" className="preset" aria-pressed={value === preset} onClick={() => onCommit(value === preset ? '' : preset)}>{preset}</button>
          ))}
          {value !== undefined && <button type="button" className="preset preset-clear" onClick={() => onCommit('')}>지우기</button>}
        </div>
      )}
    </div>
  );
}

export type ElevationFlag = 'flat_exact' | 'is_breakline';

interface PanelProps {
  feature: { id: string; props: AnyProps } | undefined;
  selectedCount: number;
  onEdit: (edits: CommonEdits) => void;
  /** 평지 확인 / 단절선 on an edge. */
  onFlag: (flag: ElevationFlag, on: boolean) => void;
}

export function PropertiesPanel({ feature, selectedCount, onEdit, onFlag }: PanelProps) {
  if (selectedCount > 1) return <p className="panel-empty">{selectedCount}개를 골랐습니다. 속성은 하나만 골랐을 때 고칠 수 있습니다.</p>;
  if (!feature) return <p className="panel-empty">선택 도구로 지점이나 구간을 누르면 여기에서 속성을 고칠 수 있습니다.</p>;
  const p = feature.props;
  const isBuilding = p.kind === 'building'; // its name, code and floors are in BuildingPanel above
  const kind = p.kind === 'node' ? KIND_LABELS[p.node_type] : p.kind === 'edge'
    ? (p.conveying !== undefined && p.highway === 'steps' ? '에스컬레이터' : p.conveying !== undefined ? '무빙워크'
      : p.edge_type === 'portal' ? '출입구 연결' : p.edge_type === 'bridge' ? '연결통로' : KIND_LABELS[p.highway === 'corridor' ? 'corridor_edge' : p.highway])
    : p.kind === 'room' ? '강의실 영역' : p.kind === 'plaza' ? KIND_LABELS.plaza : KIND_LABELS.building;
  const sources = SOURCES.some((s) => s.value === p.source) ? SOURCES : [...SOURCES, { value: p.source, label: p.source }];
  return (
    <form className="props" onSubmit={(e) => e.preventDefault()}>
      {!isBuilding && <p className="props-kind">{kind}</p>}
      {!isBuilding && <p className="props-id">{feature.id}</p>}
      {p.kind === 'edge' && p.conveying !== undefined && (
        <p className="conveying-note">{CONVEYING_TEXT[p.conveying] ?? p.conveying} 방향을 바꾸려면 뒤집기(F)를 쓰세요.</p>
      )}
      {p.kind === 'edge' && (
        <label className="field">계단·문턱 없이 지날 수 있는지 (step_free)
          <select value={String(p.step_free)} onChange={(e) => onEdit({ step_free: e.target.value === 'null' ? null : e.target.value === 'true' })}>
            {STEP_FREE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      )}
      {p.kind === 'edge' && p.highway === 'steps' && p.conveying === undefined && p.edge_type === 'indoor' && p.step_count === undefined && (
        <div className="field">
          <label>한 층 오르는 시간: {p.flight_sec ?? FLOOR_FLIGHT_SEC}초{p.flight_sec === undefined ? ' (기본값)' : ''}
            <input
              type="range"
              min={FLIGHT_SEC_MIN}
              max={FLIGHT_SEC_MAX}
              step={1}
              value={p.flight_sec ?? FLOOR_FLIGHT_SEC}
              onChange={(e) => onEdit({ flight_sec: Number(e.target.value) })}
            />
          </label>
          {p.flight_sec !== undefined && (
            <button type="button" onClick={() => onEdit({ flight_sec: null })}>기본값({FLOOR_FLIGHT_SEC}초)으로 되돌리기</button>
          )}
          <p className="field-help">계단 칸 수(step_count)를 모를 때만 쓰입니다. 내려갈 때는 올라갈 때의 3분의 2로 계산합니다.</p>
        </div>
      )}
      {p.kind === 'edge' && <ElevationSection props={p} onFlag={onFlag} />}
      {p.kind === 'node' && (
        <>
          <AccessSection key={feature.id} filled={ACCESS_PROPS.filter((name) => !!p[name]).length}>
            {ACCESS_PROPS.map((name) => <AccessField key={`${feature.id}:${name}`} name={name} value={p[name]} onCommit={(value) => onEdit({ access: { [name]: value } })} />)}
            <p className="field-help">빠른 선택을 누르거나 직접 적고 Enter를 누르세요. 비우면 지워집니다. 길찾기에는 쓰이지 않고 안내에만 보입니다.</p>
          </AccessSection>
          {p.sync_group !== undefined && <p className="field-help sync-note">다른 층의 같은 자리 지점과 연동되어 있습니다({p.sync_group}). 우클릭 메뉴에서 연동을 취소할 수 있습니다.</p>}
        </>
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
      {p.kind === 'edge' && <p className="field-help">'있음'은 현장에서 확인했을 때만 골라 주세요. 모르면 '모름'으로 두세요.</p>}
    </form>
  );
}

/**
 * 출입 정보 (개방시간 · 폐쇄기간 · 개방조건), folded away because it is mostly left empty: a chevron button opens it.
 * It starts open when the point already has any of them (`filled`: how many). Keyed by the Feature, so each point starts afresh.
 */
function AccessSection({ filled, children }: { filled: number; children: ReactNode }) {
  const [open, setOpen] = useState(filled > 0);
  const bodyId = useId();
  return (
    <fieldset className="access disclosure" aria-label="출입 정보">
      <legend>
        <button type="button" className="disclosure-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
          <svg className="disclosure-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path d="M4 2.5 L7.5 6 L4 9.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          출입 정보
          <span className="disclosure-summary">{filled > 0 ? `${filled}개 입력됨` : '개방시간 · 개방조건 · 폐쇄기간'}</span>
        </button>
      </legend>
      {open && <div id={bodyId} className="disclosure-body">{children}</div>}
    </fieldset>
  );
}

const FLAGS: { flag: ElevationFlag; label: string; help: string }[] = [
  { flag: 'flat_exact', label: '완전 평지 (flat_exact)', help: '현장에서 평지로 확인했습니다. 높이 차를 0으로 묶습니다.' },
  { flag: 'is_breakline', label: '단절선 (is_breakline)', help: '연석·옹벽처럼 높이가 끊깁니다. 보정이 이 선을 넘지 않습니다.' },
];

const GRADE_WORD = { gentle: '완만', caution: '주의', steep: '급경사' } as const;

/**
 * 고도: the two facts a person checks on site, as toggles (each greyed out with the reason where the schema does not
 * allow it), and what the last recompute wrote, read only.
 */
function ElevationSection({ props: p, onFlag }: { props: Extract<AnyProps, { kind: 'edge' }>; onFlag: (flag: ElevationFlag, on: boolean) => void }) {
  const badges = elevationBadges(p);
  return (
    <fieldset className="elev" aria-label="고도">
      <legend className="elev-legend">고도</legend>
      {FLAGS.map(({ flag, label, help }) => {
        const on = p[flag] === true;
        const blocked = on ? false : flagBlocked(p, flag);
        return (
          <label key={flag} className={`check-field elev-flag${blocked ? ' is-blocked' : ''}`} title={blocked || undefined}>
            <input type="checkbox" checked={on} disabled={blocked !== false} onChange={(e) => onFlag(flag, e.target.checked)} />
            <span>
              {label}
              <span className="elev-help">{blocked || help}</span>
            </span>
          </label>
        );
      })}
      {badges ? (
        <div className="elev-values" role="group" aria-label="계산한 고도 값 (읽기 전용)">
          {badges.diff && <span className="elev-badge" title="끝 지점 높이 − 시작 지점 높이 (elev_diff_m)"><b>높이 차</b>{badges.diff}</span>}
          {badges.sigma && <span className="elev-badge" title="높이 차의 표준편차 (elev_sigma_m)"><b>오차</b>{badges.sigma}</span>}
          {badges.grade && (
            <span className={`elev-badge elev-grade grade-${badges.grade.cls}`} title="그린 방향(시작 → 끝) 경사 (grade_pct)">
              <b>경사</b>{badges.grade.text}<i>{GRADE_WORD[badges.grade.cls]}</i>
            </span>
          )}
        </div>
      ) : <p className="field-help">아직 계산한 고도 값이 없습니다. 상태 표시줄의 [고도 다시 계산]으로 채웁니다.</p>}
    </fieldset>
  );
}
