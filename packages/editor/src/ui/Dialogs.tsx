// Forms for the tools that need more than a click. Each submit returns an error message, or nothing on success.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { EditBuilding, RestroomGender, Wheelchair } from '@campo/core';
import { GENDERS, WHEELCHAIRS, type RestroomForm } from '../model/doors.ts';
import { parseLevels } from '../model/building.ts';
import { floorLabel } from '../model/scope.ts';

type Submit<T> = (value: T) => string | undefined;

function Modal({ title, submitLabel, error, onSubmit, onCancel, children }: {
  title: string;
  submitLabel: string;
  error: string | undefined;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    return () => dialog.close();
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="dialog-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <form onSubmit={submit}>
        <h2 id="dialog-title">{title}</h2>
        {children}
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>취소</button>
          <button type="submit" className="primary">{submitLabel}</button>
        </div>
      </form>
    </dialog>
  );
}

export interface BuildingForm { name: string; code: string; levels: number[]; groundLevels: number[] }

export function BuildingDialog({ onSubmit, onCancel }: { onSubmit: Submit<BuildingForm>; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [levels, setLevels] = useState('1-4');
  const [ground, setGround] = useState('1');
  const [error, setError] = useState<string>();
  const submit = () => {
    const l = parseLevels(levels);
    if ('error' in l) return setError(`층 목록: ${l.error}`);
    const g = parseLevels(ground);
    if ('error' in g) return setError(`지면 층: ${g.error}`);
    setError(onSubmit({ name, code, levels: l.levels, groundLevels: g.levels }));
  };
  return (
    <Modal title="건물 등록" submitLabel="건물 만들기" error={error} onSubmit={submit} onCancel={onCancel}>
      <label className="field">이름<input value={name} onChange={(e) => setName(e.target.value)} placeholder="제1공학관" autoFocus /></label>
      <label className="field">코드<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ENG1" /></label>
      <label className="field">층 목록<input value={levels} onChange={(e) => setLevels(e.target.value)} aria-describedby="levels-help" /></label>
      <p className="field-help" id="levels-help">예: 1-4, -1~5, 1,2,4. 지하 1층은 -1입니다.</p>
      <label className="field">지면과 닿는 층<input value={ground} onChange={(e) => setGround(e.target.value)} aria-describedby="ground-help" /></label>
      <p className="field-help" id="ground-help">언덕 때문에 4층 문이 땅에 닿으면 1, 4처럼 함께 적습니다.</p>
    </Modal>
  );
}

export function ClassroomDialog({ onSubmit, onCancel }: { onSubmit: Submit<{ ref: string; spaceName: string }>; onCancel: () => void }) {
  const [ref, setRef] = useState('');
  const [spaceName, setSpaceName] = useState('');
  const [error, setError] = useState<string>();
  return (
    <Modal title="강의실 문" submitLabel="문 만들기" error={error} onSubmit={() => setError(onSubmit({ ref, spaceName }))} onCancel={onCancel}>
      <label className="field">호수<input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="408" autoFocus /></label>
      <label className="field">이름<input value={spaceName} onChange={(e) => setSpaceName(e.target.value)} placeholder={ref ? `${ref}호 강의실` : '408호 강의실'} /></label>
    </Modal>
  );
}

/** Stop floors of an elevator: new (all floors checked) or an existing one (`initial` = the floors it stops at now). */
export function ElevatorDialog({ building, initial, onSubmit, onCancel }: { building: EditBuilding; initial?: number[]; onSubmit: Submit<number[]>; onCancel: () => void }) {
  const levels = [...building.props.levels].sort((a, b) => b - a);
  const [checked, setChecked] = useState<Set<number>>(new Set(initial ?? levels));
  const [error, setError] = useState<string>();
  const toggle = (l: number) => setChecked((s) => {
    const next = new Set(s);
    if (next.has(l)) next.delete(l);
    else next.add(l);
    return next;
  });
  return (
    <Modal title="엘리베이터 정차 층" submitLabel={initial ? '정차 층 바꾸기' : '엘리베이터 만들기'} error={error} onSubmit={() => setError(onSubmit([...checked]))} onCancel={onCancel}>
      <p className="field-help">고른 층마다 같은 자리에 정차 지점이 생기고, 이웃한 정차 층끼리 이어집니다. 그 층에 복도가 가까이 있으면 복도에도 이어집니다.</p>
      <fieldset className="checks">
        <legend className="visually-hidden">정차 층</legend>
        {levels.map((l) => (
          <label key={l}><input type="checkbox" checked={checked.has(l)} onChange={() => toggle(l)} />{floorLabel(l)}</label>
        ))}
      </fieldset>
    </Modal>
  );
}

export function RestroomDialog({ onSubmit, onCancel }: { onSubmit: Submit<RestroomForm>; onCancel: () => void }) {
  const [gender, setGender] = useState<RestroomGender>('male');
  const [wheelchair, setWheelchair] = useState<Wheelchair>('unknown');
  const [table, setTable] = useState<'unknown' | 'yes' | 'no'>('unknown');
  const [error, setError] = useState<string>();
  const submit = () => setError(onSubmit({ gender, wheelchair, changingTable: table === 'unknown' ? null : table === 'yes' }));
  return (
    <Modal title="화장실" submitLabel="화장실 만들기" error={error} onSubmit={submit} onCancel={onCancel}>
      <fieldset className="checks">
        <legend>성별</legend>
        {GENDERS.map((g) => (
          <label key={g.id}><input type="radio" name="restroom-gender" checked={gender === g.id} onChange={() => setGender(g.id)} />{g.label}</label>
        ))}
      </fieldset>
      <label className="field">휠체어
        <select value={wheelchair} onChange={(e) => setWheelchair(e.target.value as Wheelchair)}>
          {WHEELCHAIRS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
      </label>
      <p className="field-help">'쓸 수 있어요'는 현장에서 확인했을 때만 고르세요. 확인하지 않았으면 그대로 두세요.</p>
      <label className="field">기저귀 교환대
        <select value={table} onChange={(e) => setTable(e.target.value as 'unknown' | 'yes' | 'no')}>
          <option value="unknown">모르겠어요</option>
          <option value="yes">있어요</option>
          <option value="no">없어요</option>
        </select>
      </label>
    </Modal>
  );
}

export function StairsDialog({ building, startLevel, onSubmit, onCancel }: {
  building: EditBuilding;
  startLevel: number;
  onSubmit: Submit<{ from: number; to: number }>;
  onCancel: () => void;
}) {
  const levels = [...building.props.levels].sort((a, b) => a - b);
  const [from, setFrom] = useState(startLevel);
  const [to, setTo] = useState(levels.find((l) => l !== startLevel && l > startLevel) ?? levels[levels.length - 1]!);
  const [error, setError] = useState<string>();
  const select = (value: number, set: (n: number) => void, label: string) => (
    <label className="field">{label}
      <select value={value} onChange={(e) => set(Number(e.target.value))}>
        {levels.map((l) => <option key={l} value={l}>{floorLabel(l)}</option>)}
      </select>
    </label>
  );
  return (
    <Modal title="계단" submitLabel="계단 만들기" error={error} onSubmit={() => setError(onSubmit({ from, to }))} onCancel={onCancel}>
      <p className="field-help">두 층 사이의 모든 층에 계단참 지점이 생기고, 한 층씩 계단 구간으로 이어집니다.</p>
      {select(from, setFrom, '시작 층')}
      {select(to, setTo, '끝 층')}
    </Modal>
  );
}

export function PoiDialog({ onSubmit, onCancel }: { onSubmit: Submit<string>; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  return (
    <Modal title="출발·도착 후보" submitLabel="후보 만들기" error={error} onSubmit={() => setError(onSubmit(name))} onCancel={onCancel}>
      <label className="field">이름<input value={name} onChange={(e) => setName(e.target.value)} placeholder="한양대역 2번 출구" autoFocus /></label>
      <p className="field-help">길찾기 탭에서 이 이름으로 검색합니다. 바깥 길과 잇기 도구로 이어 주세요.</p>
    </Modal>
  );
}

export interface DeleteBuildingItem { code: string; name: string; nodes: number; edges: number; rooms: number }

/** Confirmation before a building goes (SPEC-v0.2 4.1 deleteBuilding): shows what goes with it. */
export function DeleteBuildingDialog({ items, onConfirm, onCancel }: { items: DeleteBuildingItem[]; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal title="건물 삭제" submitLabel="삭제" error={undefined} onSubmit={onConfirm} onCancel={onCancel}>
      {items.map((b) => (
        <p key={b.code} className="delete-building" data-code={b.code}>
          <strong>{b.name}({b.code})</strong>를 지우면 안에 있는 지점 {b.nodes}개, 구간 {b.edges}개, 강의실 영역 {b.rooms}개도 함께 지워집니다.
        </p>
      ))}
      <p className="field-help">구간 개수에는 포탈과 연결통로가 들어 있습니다. 지운 뒤에도 Ctrl+Z로 되돌릴 수 있습니다.</p>
    </Modal>
  );
}

export interface AttachReportItem { label: string; reason: string }

/** Result of 연결 안 된 지점 잇기: how many were attached, and the ones that could not be, each with the reason. */
export function AttachReportDialog({ attached, failed, onClose }: { attached: number; failed: AttachReportItem[]; onClose: () => void }) {
  return (
    <Modal title="연결 안 된 지점 잇기" submitLabel="확인" error={undefined} onSubmit={onClose} onCancel={onClose}>
      <p>{attached > 0 ? `${attached}개를 복도에 이었습니다.` : '복도에 이은 지점이 없습니다.'} 잇지 못한 지점 {failed.length}개입니다.</p>
      <ul className="attach-failed">
        {failed.map((f, i) => <li key={i}><strong>{f.label}</strong>: {f.reason}</li>)}
      </ul>
      <p className="field-help">복도를 가까이 그리거나 지점을 복도 쪽으로 옮긴 다음 다시 눌러 주세요.</p>
    </Modal>
  );
}
