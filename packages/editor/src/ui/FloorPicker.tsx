import type { EditBuilding } from '@campo/core';
import { floorLabel, type Scope } from '../model/scope.ts';

interface Props {
  building: EditBuilding;
  scope: Scope;
  onPick: (level: number) => void;
  onOutdoor: () => void;
  /** Broken points per level (끊긴 지점 찾기): shown as a count on the floor's button. */
  broken?: ReadonlyMap<number, number>;
  /** 외곽선 수정 of the floor shown; null while it is already on. */
  onOutline?: ((level: number) => void) | null;
}

/** Floor buttons stacked top floor first, like the panel inside a lift. */
export function FloorPicker({ building, scope, onPick, onOutdoor, broken, onOutline }: Props) {
  const { name, levels, ground_levels } = building.props;
  const current = scope.kind === 'building' && scope.buildingId === building.id ? scope.level : null;
  return (
    <nav className="floors" aria-label={`${name} 층 선택`}>
      <p className="floors-name">{name}</p>
      <ol className="floors-list">
        {[...levels].sort((a, b) => b - a).map((level) => (
          <li key={level}>
            <button
              type="button"
              className="floor"
              aria-pressed={current === level}
              aria-label={`${floorLabel(level)}${ground_levels.includes(level) ? ', 지면과 닿는 층' : ''}${broken?.get(level) ? `, 끊긴 지점 ${broken.get(level)}개` : ''}`}
              onClick={() => onPick(level)}
            >
              {level < 0 ? `B${-level}` : level}
              {ground_levels.includes(level) && <span className="floor-ground" aria-hidden="true" />}
              {broken?.get(level) ? <span className="floor-broken" aria-hidden="true">{broken.get(level)}</span> : null}
            </button>
          </li>
        ))}
      </ol>
      {current !== null && onOutline && (
        <button
          type="button"
          className="floors-outline"
          title={`${floorLabel(current)}의 외곽선을 고칩니다. 층마다 모양이 다르면 그 층만의 외곽선이 됩니다.`}
          onClick={() => onOutline(current)}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
            <path d="M2.5 3.5 L10.5 2.5 L11.5 10.5 L3.5 11.5 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <circle cx="2.5" cy="3.5" r="1.6" fill="#fff" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="10.5" cy="2.5" r="1.6" fill="#fff" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="11.5" cy="10.5" r="1.6" fill="#fff" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="3.5" cy="11.5" r="1.6" fill="#fff" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          외곽선 수정
        </button>
      )}
      <button type="button" className="floors-out" onClick={onOutdoor}>바깥으로</button>
    </nav>
  );
}
