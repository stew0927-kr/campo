import { useId } from 'react';
import type { Profile, RouteResult } from '@campo/core';
import type { Place } from '../model/places.ts';

export const PROFILE_INFO: Record<Extract<Profile, 'shortest' | 'step_free'>, { title: string; className: string }> = {
  shortest: { title: '계단 포함 최단 경로', className: 'route-shortest' },
  step_free: { title: '계단 없는 경로', className: 'route-step-free' },
};

interface Props {
  places: Place[];
  fromId: string | null;
  toId: string | null;
  results: RouteResult[];
  onPick: (end: 'from' | 'to', id: string | null) => void;
}

const UNKNOWN_PROFILE = { title: '경로', className: 'route-shortest' };
const infoOf = (profile: string) => PROFILE_INFO[profile as keyof typeof PROFILE_INFO] ?? UNKNOWN_PROFILE;

/** Routes come straight from core's findRoute; this only shows them. */
export function RoutePanel({ places, fromId, toId, results, onPick }: Props) {
  const listId = useId();
  if (places.length < 2) {
    return <p className="panel-empty">출발·도착 후보(poi)나 강의실 문을 두 개 이상 만들면 경로를 찾을 수 있습니다.</p>;
  }
  const field = (end: 'from' | 'to', label: string, value: string | null) => (
    <label className="field">{label}
      <input
        list={listId}
        defaultValue={places.find((p) => p.id === value)?.label ?? ''}
        placeholder="이름으로 검색"
        onChange={(e) => onPick(end, places.find((p) => p.label === e.target.value)?.id ?? null)}
      />
    </label>
  );
  return (
    <div className="route-panel">
      <datalist id={listId}>{places.map((p) => <option key={p.id} value={p.label} />)}</datalist>
      {field('from', '출발', fromId)}
      {field('to', '도착', toId)}
      {fromId && toId && results.map((r) => (
        <section key={r.profile} className={`route-card ${infoOf(r.profile).className}`} aria-label={infoOf(r.profile).title}>
          <h3><span className="route-swatch" aria-hidden="true" />{infoOf(r.profile).title}</h3>
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
              {r.steps.length > 0 ? (
                <ol className="route-steps">{r.steps.map((s, i) => <li key={i}>{s.text}</li>)}</ol>
              ) : <p className="route-note">출발지와 도착지가 같습니다.</p>}
            </>
          ) : <p className="route-note">{r.message}</p>}
        </section>
      ))}
    </div>
  );
}
