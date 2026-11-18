import { useId, type KeyboardEvent } from 'react';
import type { PointRouteResult } from '@campo/core';
import { plazaLines } from '../model/plazaRoute.ts';
import { GRADE_LIMITS, slopeSummary } from '../model/elevation.ts';
import type { Place } from '../model/places.ts';
import type { RouteKind } from './ui-state.ts';

export const PROFILE_INFO: Record<RouteKind, { title: string; className: string }> = {
  step_free: { title: '계단 없는 경로', className: 'route-step-free' },
  shortest: { title: '계단 포함 최단 경로', className: 'route-shortest' },
  elevator_first: { title: '엘리베이터 우선 경로', className: 'route-elevator' },
};

/** What the 출발 / 도착 boxes offer besides the places. */
const DIRECT = '직접 선택 (지도에서 누르기)';
const NEAREST: Record<'any' | 'wheelchair', string> = {
  any: '가장 가까운 화장실',
  wheelchair: '휠체어로 갈 수 있는 가장 가까운 화장실',
};

type End = 'from' | 'to';

interface Props {
  places: Place[];
  fromId: string | null;
  toId: string | null;
  /** A 직접 선택 point is set for that end. */
  fromPoint: boolean;
  toPoint: boolean;
  /** The end the next map click sets. */
  picking: End | null;
  results: { kind: RouteKind; result: PointRouteResult }[];
  /** Routes drawn on the map. */
  shown: RouteKind[];
  /** 가장 가까운 화장실, when asked for (it replaces the destination). */
  nearest: { kind: 'any' | 'wheelchair'; result: PointRouteResult } | null;
  /** buildGraph's graph.warnings: edges the route search had to leave out. Shown when there is no route. */
  warnings: string[];
  /** Notes about the picked ends (a point in a plaza's hole). */
  notices?: readonly string[];
  /** A plaza's name for the route card's plaza line ('평지 …을 가로질러 …'); its id when it has none. */
  plazaName?: (plazaId: string) => string;
  onPick: (end: End, id: string | null) => void;
  onDirect: (end: End) => void;
  onNearest: (kind: 'any' | 'wheelchair') => void;
  onToggle: (kind: RouteKind) => void;
}

/** Routes come straight from core (findRouteBetween, findNearestRestroomFrom); this only shows them. */
export function RoutePanel(p: Props) {
  const { places, fromId, toId, fromPoint, toPoint, picking, results, shown, nearest, warnings, notices = [] } = p;
  const nameOf = p.plazaName ?? ((id: string) => id);
  const fromList = useId();
  const toList = useId();
  const hasFrom = fromId !== null || fromPoint;
  const hasTo = toId !== null || toPoint;

  const field = (end: End, label: string, value: string | null, point: boolean) => {
    const listId = end === 'from' ? fromList : toList;
    const current = picking === end ? DIRECT
      : point ? '지도에서 고른 위치'
      : end === 'to' && nearest ? NEAREST[nearest.kind]
      : places.find((x) => x.id === value)?.label ?? '';
    return (
      <div className="route-end">
        <label className="field">{label}
          <input
            key={current /* shows what was picked, also when it was picked on the map */}
            list={listId}
            defaultValue={current}
            placeholder="이름으로 검색하거나 직접 선택"
            onChange={(e) => {
              const v = e.target.value;
              if (v === DIRECT) return p.onDirect(end);
              if (end === 'to' && v === NEAREST.any) return p.onNearest('any');
              if (end === 'to' && v === NEAREST.wheelchair) return p.onNearest('wheelchair');
              p.onPick(end, places.find((x) => x.label === v)?.id ?? null);
            }}
          />
        </label>
        <datalist id={listId}>
          <option value={DIRECT} />
          {end === 'to' && <option value={NEAREST.any} />}
          {end === 'to' && <option value={NEAREST.wheelchair} />}
          {places.map((x) => <option key={x.id} value={x.label} />)}
        </datalist>
        <button
          type="button"
          className="route-direct"
          aria-pressed={picking === end}
          title={`${label} 위치를 지도에서 누릅니다. 가장 가까운 길에 수선을 내려 잇습니다.`}
          onClick={() => p.onDirect(end)}
        >
          직접 선택
        </button>
        {picking === end && <p className="route-hint" role="status">지도에서 {label} 위치를 눌러 주세요. 가장 가까운 길에 수선을 내려 잇습니다.</p>}
      </div>
    );
  };

  const fastest = results.reduce<{ kind: RouteKind; t: number } | null>(
    (best, { kind, result }) => (result.found && (!best || result.timeSec < best.t) ? { kind, t: result.timeSec } : best), null)?.kind;

  return (
    <div className="route-panel">
      {places.length === 0 && <p className="route-note">이름 있는 장소가 아직 없습니다. [직접 선택]으로 지도에서 출발·도착 위치를 눌러 바로 경로를 볼 수 있습니다.</p>}
      {field('from', '출발', fromId, fromPoint)}
      {field('to', '도착', toId, toPoint)}
      {notices.map((n) => <p key={n} className="route-note route-notice" role="status">{n}</p>)}
      <div className="nearest" role="group" aria-label="가장 가까운 화장실">
        <button type="button" className="nearest-any" disabled={!hasFrom} title={hasFrom ? undefined : '출발 지점을 먼저 고르세요'} onClick={() => p.onNearest('any')}>{NEAREST.any}</button>
        <button type="button" className="nearest-wheelchair" disabled={!hasFrom} title={hasFrom ? undefined : '출발 지점을 먼저 고르세요'} onClick={() => p.onNearest('wheelchair')}>{NEAREST.wheelchair}</button>
      </div>
      {hasFrom && nearest && (
        <RouteCard
          title={nearest.kind === 'wheelchair' ? '가장 가까운 휠체어 화장실 (휠체어 경로)' : '가장 가까운 화장실'}
          className={nearest.kind === 'wheelchair' ? 'route-wheelchair' : 'route-shortest'}
          result={nearest.result}
          nameOf={nameOf}
        />
      )}
      {hasFrom && hasTo && !nearest && results.length > 0 && (
        <p className="route-note">가장 빠른 경로만 먼저 그립니다. 다른 경로 상자를 누르면 지도에 함께 켜서 비교할 수 있습니다.</p>
      )}
      {hasFrom && hasTo && !nearest && results.map(({ kind, result }) => (
        <RouteCard
          key={kind}
          title={PROFILE_INFO[kind].title}
          className={PROFILE_INFO[kind].className}
          result={result}
          badge={kind === fastest ? '가장 빠름' : undefined}
          toggle={{ on: shown.includes(kind), onChange: () => p.onToggle(kind) }}
          nameOf={nameOf}
        />
      ))}
      {warnings.length > 0 && (
        (nearest && !nearest.result.found) || (hasFrom && hasTo && results.some((r) => !r.result.found))
      ) && (
        <section className="route-warnings" aria-label="길찾기에서 뺀 구간">
          <h3>길찾기에서 뺀 구간</h3>
          <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

interface CardProps {
  title: string;
  className: string;
  result: PointRouteResult;
  badge?: string | undefined;
  /** 지도에 표시: draw this route on the map. */
  toggle?: { on: boolean; onChange: () => void };
  nameOf: (plazaId: string) => string;
}

function RouteCard({ title, className, result: r, badge, toggle, nameOf }: CardProps) {
  const plaza = r.found ? plazaLines(r, nameOf) : [];
  const direct = r.found && r.startPlaza?.contact.kind === 'direct';
  // With a toggle the whole card is the switch: a press anywhere on it shows or hides the route on the map.
  const switchable = toggle !== undefined && r.found;
  const on = switchable && toggle.on;
  return (
    <section
      className={`route-card ${className}${switchable ? ' route-switch' : ''}${on ? ' route-on' : ''}${switchable && !on ? ' route-off' : ''}`}
      aria-label={title}
      {...(switchable ? {
        role: 'switch',
        'aria-checked': on,
        tabIndex: 0,
        title: on ? '눌러서 지도에서 숨기기' : '눌러서 지도에 함께 표시',
        onClick: toggle.onChange,
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle.onChange();
          }
        },
      } : {})}
    >
      <div className="route-head">
        <h3><span className="route-swatch" aria-hidden="true" />{title}{badge && <span className="route-badge">{badge}</span>}</h3>
        {switchable && <span className="route-state" aria-hidden="true">{on ? '지도에 표시 중' : '꺼짐'}</span>}
      </div>
      {r.found ? (
        <>
          <dl className="route-stats">
            <div><dt>거리</dt><dd>{Math.round(r.distanceM)}m</dd></div>
            <div><dt>시간</dt><dd>{(r.timeSec / 60).toFixed(1)}분</dd></div>
            <div><dt>계단</dt><dd>{r.stairsCount}곳</dd></div>
          </dl>
          {r.fallback && <p className="route-note">{r.fallback.message}</p>}
          {r.uncertainSegments.length > 0 && (
            <p className="route-note">계단·턱 여부를 확인하지 못한 구간 {r.uncertainSegments.length}곳을 지납니다.</p>
          )}
          <SlopeRow segments={r.slopeSegments} />
          {plaza.map((line) => <p key={line} className="route-note route-plaza">{line}</p>)}
          {r.steps.length > 0 ? (
            <ol className="route-steps">{r.steps.map((s, i) => <li key={i} className={s.steep ? 'step-steep' : undefined}>{s.text}</li>)}</ol>
          ) : direct ? null : <p className="route-note">출발지와 도착지가 같은 지점에 이어져 있습니다.</p>}
        </>
      ) : <p className="route-note">경로 없음. {r.message}</p>}
    </section>
  );
}

/** Caution (5–8 %) and steep (over 8 %) parts of the route, as on the map's stripes. Nothing when the route has none. */
function SlopeRow({ segments }: { segments: Parameters<typeof slopeSummary>[0] }) {
  const sum = slopeSummary(segments);
  if (!sum) return null;
  return (
    <p className="route-slope" aria-label="경사 구간">
      {sum.steep > 0 && <span className="slope-chip slope-steep" title={`경사 ${GRADE_LIMITS.caution}% 초과`}>급경사 {sum.steep}곳</span>}
      {sum.caution > 0 && <span className="slope-chip slope-caution" title={`경사 ${GRADE_LIMITS.gentle}~${GRADE_LIMITS.caution}%`}>주의 {sum.caution}곳</span>}
      <span className="slope-max">가장 가파른 곳 {sum.maxPct.toFixed(1)}%</span>
    </p>
  );
}
