import type { EditBuilding } from '@campo/core';
import { floorLabel, type Scope } from '../model/scope.ts';

interface Props {
  building: EditBuilding;
  scope: Scope;
  onPick: (level: number) => void;
  onOutdoor: () => void;
}

/** Floor buttons stacked top floor first, like the panel inside a lift. */
export function FloorPicker({ building, scope, onPick, onOutdoor }: Props) {
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
              aria-label={`${floorLabel(level)}${ground_levels.includes(level) ? ', 지면과 닿는 층' : ''}`}
              onClick={() => onPick(level)}
            >
              {level < 0 ? `B${-level}` : level}
              {ground_levels.includes(level) && <span className="floor-ground" aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="floors-out" onClick={onOutdoor}>바깥으로</button>
    </nav>
  );
}
