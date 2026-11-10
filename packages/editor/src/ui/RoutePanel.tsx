import { useId } from 'react';
import type { Profile, RouteResult } from '@campo/core';
import type { Place } from '../model/places.ts';

export const PROFILE_INFO: Record<Profile, { title: string; className: string }> = {
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
        <section key={r.profile} className={`route-card ${PROFILE_INFO[r.profile].className}`} aria-label={PROFILE_INFO[r.profile].title}>
          <h3><span className="route-swatch" aria-hidden="true" />{PROFILE_INFO[r.profile].title}</h3>
          {r.found ? (
            <>
              <dl className="route-stats">
                <div><dt>거리</dt><dd>{Math.round(r.distanceM)}m</dd></div>
                <div><dt>시간</dt><dd>{r.durationMin}분</dd></div>
                <div><dt>계단</dt><dd>{r.stairCount}곳</dd></div>
              </dl>
              {r.floorChanges.length > 0 ? (
                <ol className="route-steps">{r.floorChanges.map((s, i) => <li key={i}>{s}</li>)}</ol>
              ) : <p className="route-note">층을 옮기지 않습니다.</p>}
            </>
          ) : <p className="route-note">{r.message}</p>}
        </section>
      ))}
    </div>
  );
}
