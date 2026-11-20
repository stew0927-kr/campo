// One table: list + publish switch + add/edit form + delete. Every screen of the admin web is made of this.
import { useCallback, useContext, useEffect, useId, useState } from 'react';
import { cellText, eulReul, formToRow, koreanError, rowToForm, type FieldDef, type FormState, type Row } from '../lib/convert.ts';
import { EditingContext } from '../lib/editing.ts';
import { supabase } from '../lib/supabase.ts';
import type { TableConfig } from '../tables.ts';
import { PublishSwitch } from './PublishSwitch.tsx';

interface Props {
  config: TableConfig;
  /** Parent row id when config.parentKey is set (e.g. the selected festival). */
  parentId?: string;
  /** Row the user picked, for screens that drill down (festival -> days -> stalls). */
  selectedId?: string | null;
  onSelect?: (row: Row | null) => void;
}

type Status = { kind: 'ok' | 'error'; text: string } | null;

const CUSTOM = '__custom__';

export function ResourcePanel({ config, parentId, selectedId, onSelect }: Props) {
  const panelId = useId();
  const tracker = useContext(EditingContext);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>(null);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [busy, setBusy] = useState(false);
  /** Choices for 'option' fields, by field key, and which of them are in "직접 입력" mode. */
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, boolean>>({});
  const publishField = config.fields.find((f) => f.type === 'publish');
  const columnFields = config.columns.map((k) => config.fields.find((f) => f.key === k)).filter((f) => f !== undefined);

  useEffect(() => {
    tracker.report(panelId, editing !== null);
    return () => tracker.report(panelId, false);
  }, [tracker, panelId, editing]);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from(config.table).select('*');
    if (config.parentKey && parentId) q = q.eq(config.parentKey, parentId);
    for (const o of config.order) q = q.order(o.column, { ascending: o.ascending });
    const { data, error } = await q;
    setLoading(false);
    if (error) setStatus({ kind: 'error', text: koreanError(error) });
    else setRows((data ?? []) as Row[]);
  }, [config, parentId]);

  useEffect(() => {
    setEditing(null);
    setStatus(null);
    void load();
  }, [load]);

  /** Reads the current choices of every 'option' field (the admin may have just changed the list). */
  const loadChoices = async (): Promise<Record<string, string[]>> => {
    const out: Record<string, string[]> = {};
    for (const f of config.fields) {
      if (f.type !== 'option' || !f.optionsFrom) continue;
      const { table, column } = f.optionsFrom;
      const { data, error } = await supabase.from(table).select(column).order('sort_order', { ascending: true }).order(column, { ascending: true });
      if (error) {
        setStatus({ kind: 'error', text: `${f.label} 목록을 읽지 못했습니다: ${koreanError(error)}` });
        out[f.key] = [];
      } else {
        out[f.key] = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => String(r[column]));
      }
    }
    setChoices(out);
    return out;
  };

  const openForm = async (row: Row | 'new') => {
    const next = rowToForm(config.fields, row === 'new' ? null : row);
    setStatus(null);
    const lists = await loadChoices();
    const modes: Record<string, boolean> = {};
    for (const f of config.fields) {
      if (f.type !== 'option') continue;
      const list = lists[f.key] ?? [];
      const v = String(next[f.key] ?? '');
      if (row === 'new' && v === '' && list.length > 0) next[f.key] = list[0] ?? '';
      // A stored value that is not in the list (or an empty list) opens in typing mode.
      modes[f.key] = v !== '' ? !list.includes(v) : list.length === 0;
    }
    setCustom(modes);
    setForm(next);
    setEditing(row);
  };

  /** New values typed in "직접 입력" are added to their option table before the row is saved. */
  const addTypedChoices = async (values: Row): Promise<string | null> => {
    for (const f of config.fields) {
      if (f.type !== 'option' || !f.optionsFrom?.allowCustom) continue;
      const v = values[f.key];
      if (typeof v !== 'string' || v === '' || (choices[f.key] ?? []).includes(v)) continue;
      const { table, column } = f.optionsFrom;
      const newOption: Record<string, unknown> = { [column]: v };
      const { error } = await supabase.from(table).upsert(newOption, { onConflict: column, ignoreDuplicates: true });
      if (error) return `"${v}"을(를) ${f.label} 목록에 추가하지 못했습니다: ${koreanError(error)}`;
    }
    return null;
  };

  const save = async () => {
    const { values, errors } = formToRow(config.fields, form);
    if (errors.length > 0) {
      setStatus({ kind: 'error', text: errors.join(' ') });
      return;
    }
    if (config.parentKey && parentId) values[config.parentKey] = parentId;
    setBusy(true);
    const optionError = await addTypedChoices(values);
    if (optionError) {
      setBusy(false);
      setStatus({ kind: 'error', text: optionError });
      return;
    }
    const res = editing === 'new'
      ? await supabase.from(config.table).insert(values).select()
      : await supabase.from(config.table).update(values).eq('id', (editing as Row)['id'] as string).select();
    setBusy(false);
    if (res.error) {
      setStatus({ kind: 'error', text: koreanError(res.error) });
      return;
    }
    // RLS does not raise an error when it blocks an update; it just changes 0 rows.
    if (!res.data || res.data.length === 0) {
      setStatus({ kind: 'error', text: '저장되지 않았습니다. 관리자 권한을 확인해 주세요.' });
      return;
    }
    setStatus({ kind: 'ok', text: editing === 'new' ? `${eulReul(config.noun)} 추가했습니다.` : '저장했습니다.' });
    setEditing(null);
    await load();
  };

  const setPublished = async (row: Row, next: boolean) => {
    const { data, error } = await supabase.from(config.table).update({ is_published: next }).eq('id', row['id'] as string).select('id');
    if (error || !data || data.length === 0) {
      setStatus({ kind: 'error', text: error ? koreanError(error) : '바꾸지 못했습니다. 관리자 권한을 확인해 주세요.' });
      return;
    }
    setStatus({ kind: 'ok', text: next ? '앱에 공개했습니다. 앱을 새로고침하면 보입니다.' : '앱에서 숨겼습니다.' });
    await load();
  };

  const remove = async (row: Row) => {
    const note = config.deleteNote ? `\n${config.deleteNote}` : '';
    if (!window.confirm(`삭제하면 앱에서도 사라집니다. 계속할까요?${note}`)) return;
    const { data, error } = await supabase.from(config.table).delete().eq('id', row['id'] as string).select('id');
    if (error || !data || data.length === 0) {
      setStatus({ kind: 'error', text: error ? koreanError(error) : '삭제하지 못했습니다. 관리자 권한을 확인해 주세요.' });
      return;
    }
    if (selectedId === row['id']) onSelect?.(null);
    setStatus({ kind: 'ok', text: '삭제했습니다.' });
    await load();
  };

  const renderInput = (f: FieldDef) => {
    const v = form[f.key];
    const id = `${config.table}-${f.key}`;
    const set = (value: string | boolean) => setForm((s) => ({ ...s, [f.key]: value }));
    if (f.type === 'publish') {
      return (
        <div key={f.key} className="field">
          <span>{f.label}</span>
          <PublishSwitch value={v === true} onChange={(next) => set(next)} />
        </div>
      );
    }
    if (f.type === 'boolean') {
      return (
        <label key={f.key} htmlFor={id} className="check">
          <input id={id} type="checkbox" checked={v === true} onChange={(e) => set(e.target.checked)} /> {f.label}
        </label>
      );
    }
    const title = (
      <span>
        {f.label}
        {f.required && <b className="req"> *</b>}
      </span>
    );
    let control;
    if (f.type === 'option') {
      const list = choices[f.key] ?? [];
      const typing = custom[f.key] === true;
      control = (
        <>
          <select
            id={id}
            value={typing ? CUSTOM : String(v ?? '')}
            onChange={(e) => {
              if (e.target.value === CUSTOM) {
                setCustom((c) => ({ ...c, [f.key]: true }));
                set('');
              } else {
                setCustom((c) => ({ ...c, [f.key]: false }));
                set(e.target.value);
              }
            }}
          >
            {list.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
            {f.optionsFrom?.allowCustom && <option value={CUSTOM}>직접 입력…</option>}
          </select>
          {typing && (
            <input id={`${id}-custom`} type="text" placeholder="새 계열 이름" value={String(v ?? '')} onChange={(e) => set(e.target.value)} />
          )}
        </>
      );
    } else if (f.type === 'textarea' || f.type === 'lines') {
      control = <textarea id={id} rows={f.type === 'lines' ? 4 : 3} value={String(v ?? '')} onChange={(e) => set(e.target.value)} />;
    } else if (f.type === 'select') {
      control = (
        <select id={id} value={String(v ?? '')} onChange={(e) => set(e.target.value)}>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    } else {
      control = (
        <input
          id={id}
          type={f.type === 'datetime' ? 'datetime-local' : f.type === 'number' ? 'number' : f.type === 'text' ? 'text' : f.type}
          value={String(v ?? '')}
          onChange={(e) => set(e.target.value)}
        />
      );
    }
    return (
      <label key={f.key} htmlFor={id} className={f.type === 'textarea' || f.type === 'lines' ? 'wide' : ''}>
        {title}
        {control}
        {f.hint && <small>{f.hint}</small>}
      </label>
    );
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{config.title}</h2>
        <button className="primary" onClick={() => void openForm('new')} disabled={editing !== null}>
          + {config.noun} 추가
        </button>
      </div>

      {status && <p className={`status ${status.kind}`}>{status.text}</p>}

      {editing !== null && (
        <form
          className="editor"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3>{editing === 'new' ? `새 ${config.noun}` : `${config.noun} 수정`}</h3>
          <div className="grid">{config.fields.map(renderInput)}</div>
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>{busy ? '저장 중…' : '저장'}</button>
            <button type="button" onClick={() => setEditing(null)} disabled={busy}>취소</button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="muted">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="muted">아직 없습니다. 위의 추가 버튼으로 만드세요.</p>
      ) : (
        <table>
          <thead>
            <tr>
              {columnFields.map((f) => (
                <th key={f.key}>{f.label}</th>
              ))}
              {publishField && <th>앱에 공개</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r['id'])} className={selectedId === r['id'] ? 'selected' : ''}>
                {columnFields.map((f) => (
                  <td key={f.key}>{cellText(f, r[f.key])}</td>
                ))}
                {publishField && (
                  <td>
                    <PublishSwitch compact value={r['is_published'] === true} onChange={(next) => void setPublished(r, next)} />
                  </td>
                )}
                <td className="row-actions">
                  {onSelect && <button onClick={() => onSelect(r)}>선택</button>}
                  <button onClick={() => void openForm(r)} disabled={editing !== null}>수정</button>
                  <button className="danger" onClick={() => void remove(r)}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
