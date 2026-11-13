// 상세 정보 of a building outline: name, code and the list of floors, all editable.
import { useEffect, useState } from 'react';
import type { EditBuilding } from '@campo/core';
import { parseLevels } from '../model/building.ts';
import { floorLabel } from '../model/scope.ts';

interface Props {
  building: EditBuilding;
  /** Each returns the reason it did not happen (shown here), or undefined. */
  onName: (name: string) => string | undefined;
  onRename: (code: string) => string | undefined;
  onLevels: (levels: number[]) => string | undefined;
  /** Why the code cannot be that (while typing), why a floor cannot be taken out. */
  renameBlocked: (code: string) => string | false;
  removeBlocked: (level: number) => string | false;
}

export function BuildingPanel({ building, onName, onRename, onLevels, renameBlocked, removeBlocked }: Props) {
  const { code, name, levels, ground_levels } = building.props;
  const [nameText, setNameText] = useState(name);
  const [codeText, setCodeText] = useState(code);
  const [levelText, setLevelText] = useState('');
  const [error, setError] = useState<string>();
  // Another building was selected, or an undo changed this one.
  useEffect(() => setNameText(name), [name, building.id]);
  useEffect(() => setCodeText(code), [code, building.id]);
  useEffect(() => setError(undefined), [building.id]);

  const sorted = [...levels].sort((a, b) => b - a);
  const typedCode = codeText.trim();
  const unchanged = typedCode === code;
  const codeReason = unchanged ? false : renameBlocked(typedCode);

  const commitName = () => {
    if (nameText.trim() === name) return;
    const err = onName(nameText);
    setError(err);
    if (err) setNameText(name);
  };
  const commitCode = () => {
    if (unchanged || codeReason !== false) return;
    setError(onRename(typedCode));
  };
  const addLevels = () => {
    const parsed = parseLevels(levelText);
    if ('error' in parsed) return setError(`층 목록: ${parsed.error}`);
    const err = onLevels([...new Set([...levels, ...parsed.levels])]);
    setError(err);
    if (!err) setLevelText('');
  };

  return (
    <section className="building-panel" aria-label="건물 정보">
      <p className="props-kind">건물</p>
      <p className="props-id">{building.id}</p>

      <label className="field">이름
        <input
          value={nameText}
          onChange={(e) => setNameText(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </label>

      <div className="field">
        <label htmlFor="building-code">코드</label>
        <div className="inline-row">
          <input id="building-code" value={codeText} onChange={(e) => setCodeText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commitCode()} />
          <button type="button" aria-disabled={unchanged || codeReason !== false} title={codeReason || '코드를 바꿉니다'} onClick={commitCode}>
            코드 바꾸기
          </button>
        </div>
        {codeReason && <p className="field-error" role="alert">{codeReason}</p>}
        <p className="field-help">코드를 바꾸면 저장 폴더와 이 건물을 가리키는 지점·구간·강의실의 참조, 엘리베이터 ID가 함께 바뀝니다. 되돌리기 한 번으로 모두 원래대로 돌아갑니다.</p>
      </div>

      <fieldset className="field levels-field">
        <legend>층 목록</legend>
        <ul className="level-chips">
          {sorted.map((l) => {
            const reason = removeBlocked(l);
            return (
              <li key={l} className="level-chip" data-level={l}>
                <span>{floorLabel(l)}{ground_levels.includes(l) ? ' (지면)' : ''}</span>
                <button
                  type="button"
                  aria-label={`${floorLabel(l)} 지우기`}
                  aria-disabled={reason !== false}
                  title={reason || `${floorLabel(l)}을(를) 지웁니다`}
                  onClick={() => setError(reason === false ? onLevels(levels.filter((x) => x !== l)) : reason)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        <div className="inline-row">
          <input
            aria-label="추가할 층"
            value={levelText}
            placeholder="예: 5 또는 -1, 5~6"
            onChange={(e) => setLevelText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addLevels()}
          />
          <button type="button" onClick={addLevels}>층 추가</button>
        </div>
        <p className="field-help">지점이나 구간, 강의실 영역이 이미 있는 층은 지울 수 없습니다. 지하 1층은 -1입니다.</p>
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}
