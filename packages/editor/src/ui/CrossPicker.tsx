// The small window of 연결통로 and 에스컬레이터 (SPEC-v0.2 5.2.1), open between the first click and the second.
// It does not take the map from the person: the floor chosen here is shown on the map, only that floor's points stay dark and clickable,
// and the second click (a point there, or an empty spot for a new point) makes the line.
import type { ReactNode } from 'react';
import { buildingById, type EditState } from '@campo/core';
import { bridgeTargets } from '../model/cross.ts';
import { ESCALATOR_MODES, type EscalatorMode } from '../model/escalator.ts';
import { floorLabel, type Scope } from '../model/scope.ts';
import type { CrossPick } from './ui-state.ts';

interface Props {
  tool: 'bridge' | 'escalator';
  state: EditState;
  /** The first click. */
  fromId: string;
  /** The floor shown now: the one the second click lands on. */
  scope: Scope;
  pick: CrossPick;
  onPick: (patch: Partial<CrossPick>) => void;
  onShow: (scope: Scope) => void;
  onCancel: () => void;
}

export function CrossPicker({ tool, state, fromId, scope, pick, onPick, onShow, onCancel }: Props) {
  const from = state.nodes[fromId];
  if (!from) return null;
  const shownBuilding = scope.kind === 'building' ? scope.buildingId : null;
  const fromBuilding = from.props.building_id !== null ? buildingById(state, from.props.building_id) : undefined;

  const floors = (levels: number[], current: number | null, show: (level: number) => void, disabled?: (level: number) => string | undefined, label?: string) => (
    <div className="cross-floors" role="group" aria-label={label}>
      {[...levels].sort((a, b) => b - a).map((level) => (
        <button
          key={level}
          type="button"
          className="cross-floor"
          aria-pressed={current === level}
          disabled={disabled?.(level) !== undefined}
          title={disabled?.(level)}
          onClick={() => show(level)}
        >
          {floorLabel(level)}
        </button>
      ))}
    </div>
  );

  let body: ReactNode;
  if (tool === 'bridge') {
    const targets = bridgeTargets(state, fromId);
    const target = targets.find((t) => t.building.id === shownBuilding);
    body = targets.length === 0 ? (
      <p className="field-help">이어질 다른 건물이 없습니다.</p>
    ) : (
      <>
        <div className="cross-buildings" role="group" aria-label="이어질 건물 (가까운 순)">
          {targets.map((t) => (
            <button
              key={t.building.id}
              type="button"
              className="cross-building"
              aria-pressed={t.building.id === shownBuilding}
              onClick={() => onShow({ kind: 'building', buildingId: t.building.id, level: t.level })}
            >
              <span>{t.building.props.name}</span>
              <span className="cross-distance">{Number.isFinite(t.distanceM) ? `${Math.round(t.distanceM)}m` : ''}</span>
            </button>
          ))}
        </div>
        {target && floors(target.levels, scope.kind === 'building' ? scope.level : null, (level) => onShow({ kind: 'building', buildingId: target.building.id, level }), undefined, '이어질 층')}
        <label className="check-field">
          <input type="checkbox" checked={pick.noRoof} onChange={(e) => onPick({ noRoof: e.target.checked })} />
          지붕 없음
        </label>
      </>
    );
  } else {
    body = (
      <>
        <fieldset className="cross-modes">
          <legend>방향</legend>
          {ESCALATOR_MODES.map((m) => (
            <label key={m.id}>
              <input type="radio" name="escalator-mode" checked={pick.mode === m.id} onChange={() => onPick({ mode: m.id as EscalatorMode })} />
              {m.label}
            </label>
          ))}
        </fieldset>
        {fromBuilding ? (
          floors(
            fromBuilding.props.levels,
            scope.kind === 'building' && scope.buildingId === fromBuilding.id ? scope.level : null,
            (level) => onShow({ kind: 'building', buildingId: fromBuilding.id, level }),
            (level) => (level === from.props.level ? '시작 지점과 같은 층은 에스컬레이터로 잇지 않습니다.' : undefined),
            '위쪽 층',
          )
        ) : (
          <p className="field-help">바깥 에스컬레이터는 층을 고르지 않습니다.</p>
        )}
      </>
    );
  }

  return (
    <section className="cross" aria-label={tool === 'bridge' ? '연결통로 끝 지점 고르기' : '에스컬레이터 끝 지점 고르기'}>
      <h2 className="cross-title">{tool === 'bridge' ? '연결통로: 이어질 곳' : '에스컬레이터: 방향과 층'}</h2>
      {body}
      <p className="field-help">
        {tool === 'bridge'
          ? '고른 층의 지점을 누르면 이어집니다. 빈자리를 누르면 그 자리에 새 지점을 만들어 이어 줍니다.'
          : fromBuilding
            ? '고른 층의 지점이나 빈자리를 누르면 이어집니다. 빈자리에는 새 지점이 생깁니다.'
            : '바깥 지점이나 빈자리를 누르면 이어집니다. 빈자리에는 새 바깥 지점이 생깁니다.'}
      </p>
      <button type="button" className="cross-cancel" onClick={onCancel}>취소 (Esc)</button>
    </section>
  );
}
