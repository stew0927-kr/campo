// Forms for the tools that need more than a click. Each submit returns an error message, or nothing on success.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { BuildingFeature } from '@campo/core';
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

export function ElevatorDialog({ building, onSubmit, onCancel }: { building: BuildingFeature; onSubmit: Submit<number[]>; onCancel: () => void }) {
  const levels = [...building.properties.levels].sort((a, b) => b - a);
  const [checked, setChecked] = useState<Set<number>>(new Set(levels));
  const [error, setError] = useState<string>();
  const toggle = (l: number) => setChecked((s) => {
    const next = new Set(s);
    if (next.has(l)) next.delete(l);
    else next.add(l);
    return next;
  });
  return (
    <Modal title="엘리베이터 정차 층" submitLabel="엘리베이터 만들기" error={error} onSubmit={() => setError(onSubmit([...checked]))} onCancel={onCancel}>
      <p className="field-help">고른 층마다 같은 자리에 정차 지점이 생기고, 이웃한 정차 층끼리 이어집니다.</p>
      <fieldset className="checks">
        <legend className="visually-hidden">정차 층</legend>
        {levels.map((l) => (
          <label key={l}><input type="checkbox" checked={checked.has(l)} onChange={() => toggle(l)} />{floorLabel(l)}</label>
        ))}
      </fieldset>
    </Modal>
  );
}

export function StairsDialog({ building, startLevel, onSubmit, onCancel }: {
  building: BuildingFeature;
  startLevel: number;
  onSubmit: Submit<{ from: number; to: number }>;
  onCancel: () => void;
}) {
  const levels = [...building.properties.levels].sort((a, b) => a - b);
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
