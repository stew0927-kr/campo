// 경로 테스트 → 찾아보기: 건물 → 층 → 장소, one level at a time (model/placeTree.ts). A row on the last level picks the place.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Place } from '../model/places.ts';
import { restroomWord } from '../model/places.ts';
import { buildingGroups, groupOf, levelGroups, placeSections, placesOnFloor } from '../model/placeTree.ts';

/** Where the browser stands: nothing (the buildings), a building (its floors) or a floor (its places). */
interface At {
  buildingId: string | null;
  /** undefined: the floor list; null: the 층 미확인 group. */
  level: number | null | undefined;
}

/** How many rows a level shows before 전체 보기. */
const FIRST_ROWS = 20;

interface Props {
  /** 출발 / 도착: used in the labels. */
  endLabel: string;
  places: Place[];
  selectedId: string | null;
  onPick: (id: string) => void;
  /** Esc: closes the browser (focus goes back to its button). */
  onClose: () => void;
}

export function RoutePlaceTree({ endLabel, places, selectedId, onPick, onClose }: Props) {
  // Opens on the floor of the place picked now, so it shows highlighted.
  const [at, setAt] = useState<At>(() => {
    const cur = places.find((p) => p.id === selectedId);
    return cur ? { buildingId: groupOf(cur), level: cur.level } : { buildingId: null, level: undefined };
  });
  const [all, setAll] = useState(false);
  const firstRow = useRef<HTMLButtonElement>(null);
  const buildings = useMemo(() => buildingGroups(places), [places]);
  const building = buildings.find((b) => b.id === at.buildingId) ?? null;
  const levels = useMemo(() => (building ? levelGroups(places, building.id) : []), [places, building]);
  const floor = building && at.level !== undefined ? levels.find((l) => l.level === at.level) ?? null : null;
  const onFloor = useMemo(() => (building && floor ? placesOnFloor(places, building.id, floor.level) : []), [places, building, floor]);
  const stage: 'buildings' | 'levels' | 'places' = !building ? 'buildings' : !floor ? 'levels' : 'places';

  const go = (next: At) => {
    setAt(next);
    setAll(false);
  };
  const up = () => go(stage === 'places' ? { buildingId: at.buildingId, level: undefined } : { buildingId: null, level: undefined });
  // A new level: the first row takes the focus, so the keyboard keeps going down without a Tab hunt.
  useEffect(() => firstRow.current?.focus(), [stage, at.buildingId, at.level]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  const limit = <T,>(rows: T[]) => (all ? rows : rows.slice(0, FIRST_ROWS));
  const more = (n: number) => !all && n > FIRST_ROWS && (
    <li><button type="button" className="tree-more" onClick={() => setAll(true)}>전체 보기 ({n}곳)</button></li>
  );
  let first = true;
  const ref = () => {
    if (!first) return undefined;
    first = false;
    return firstRow;
  };

  return (
    <div className="route-tree" role="group" aria-label={`${endLabel} 찾아보기`} onKeyDown={onKeyDown}>
      <nav className="tree-crumbs" aria-label="위치">
        <button type="button" className="tree-crumb" aria-current={stage === 'buildings' ? 'location' : undefined} onClick={() => go({ buildingId: null, level: undefined })}>전체 건물</button>
        {building && (
          <>
            <span aria-hidden="true"> › </span>
            <button type="button" className="tree-crumb" aria-current={stage === 'levels' ? 'location' : undefined} onClick={() => go({ buildingId: building.id, level: undefined })}>{building.name}</button>
          </>
        )}
        {floor && (
          <>
            <span aria-hidden="true"> › </span>
            <span className="tree-crumb-here" aria-current="location">{floor.label}</span>
          </>
        )}
        {stage !== 'buildings' && <button type="button" className="tree-up" onClick={up} title="한 단계 위로">위로</button>}
      </nav>
      {stage === 'buildings' && (
        <ul className="tree-list" aria-label="건물">
          {limit(buildings).map((b) => (
            <li key={b.id}>
              <button type="button" ref={ref()} className="tree-row" onClick={() => go({ buildingId: b.id, level: undefined })}>
                {b.name} · {b.levelCount}개 층 · 장소 {b.count}곳
              </button>
            </li>
          ))}
          {more(buildings.length)}
        </ul>
      )}
      {stage === 'levels' && (
        <ul className="tree-list" aria-label={`${building!.name} 층`}>
          {levels.map((l) => (
            <li key={String(l.level)}>
              <button type="button" ref={ref()} className="tree-row" onClick={() => go({ buildingId: at.buildingId, level: l.level })}>
                {l.label} · 시설 {l.count}곳
              </button>
            </li>
          ))}
        </ul>
      )}
      {stage === 'places' && placeSections(onFloor).map((s) => (
        <section key={s.id} className="tree-section" aria-label={s.title}>
          <h4>{s.title}</h4>
          <ul className="tree-list">
            {limit(s.places).map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  ref={ref()}
                  className={`tree-row tree-place${p.id === selectedId ? ' tree-current' : ''}`}
                  aria-pressed={p.id === selectedId}
                  title={`${endLabel}: ${p.label}`}
                  onClick={() => onPick(p.id)}
                >
                  {p.label}
                  {p.nodeType === 'restroom' && <span className="tree-tag">{restroomWord(p.gender)}</span>}
                </button>
              </li>
            ))}
            {more(s.places.length)}
          </ul>
        </section>
      ))}
    </div>
  );
}
