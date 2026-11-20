// Form value <-> database value. Pure functions (tested in test/convert.test.ts).
// Form inputs are always strings or booleans; the database wants null for "empty", arrays for jsonb lists,
// and timestamps with an explicit Korean time zone.

export type FieldType = 'text' | 'textarea' | 'date' | 'time' | 'datetime' | 'number' | 'boolean' | 'select' | 'lines';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: readonly string[];
  hint?: string;
  /** Value for a new row. */
  initial?: string | boolean;
}

export type FormValue = string | boolean;
export type FormState = Record<string, FormValue>;
export type Row = Record<string, unknown>;

const KST = 'Asia/Seoul';

/** 을/를 by the last syllable's final consonant; 을(를) when the word does not end in Hangul. */
export function eulReul(word: string): string {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (Number.isNaN(code) || code < 0 || code > 11171) return `${word}을(를)`;
  return `${word}${code % 28 === 0 ? '를' : '을'}`;
}

/** "2026-12-02T05:00:00+00:00" -> "2026-12-02T14:00" (Korean time, for <input type="datetime-local">). */
export function isoToKstInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** "2026-12-02T14:00" (typed as Korean time) -> "2026-12-02T14:00:00+09:00". */
export const kstInputToIso = (v: string): string => `${v}:00+09:00`;

/** Database row -> form state, for every field. Missing values become the field's empty form value. */
export function rowToForm(fields: readonly FieldDef[], row: Row | null): FormState {
  const form: FormState = {};
  for (const f of fields) {
    const v = row ? row[f.key] : undefined;
    if (v === undefined || v === null) {
      form[f.key] = row === null && f.initial !== undefined ? f.initial : f.type === 'boolean' ? false : '';
      continue;
    }
    switch (f.type) {
      case 'boolean': form[f.key] = v === true; break;
      case 'time': form[f.key] = String(v).slice(0, 5); break;
      case 'datetime': form[f.key] = isoToKstInput(String(v)); break;
      case 'lines': form[f.key] = Array.isArray(v) ? v.map(String).join('\n') : ''; break;
      default: form[f.key] = String(v);
    }
  }
  return form;
}

export interface Converted {
  values: Row;
  /** Korean messages; empty when the form can be saved. */
  errors: string[];
}

/** Form state -> values to insert/update. Required fields are checked here. */
export function formToRow(fields: readonly FieldDef[], form: FormState): Converted {
  const values: Row = {};
  const errors: string[] = [];
  for (const f of fields) {
    const raw = form[f.key];
    if (f.type === 'boolean') {
      values[f.key] = raw === true;
      continue;
    }
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (s === '') {
      if (f.required) errors.push(`${eulReul(f.label)} 입력해 주세요.`);
      values[f.key] = f.type === 'lines' ? [] : f.type === 'number' ? 0 : null;
      continue;
    }
    switch (f.type) {
      case 'number': {
        const n = Number(s);
        if (!Number.isInteger(n)) errors.push(`${f.label}은(는) 정수로 입력해 주세요.`);
        values[f.key] = Number.isInteger(n) ? n : 0;
        break;
      }
      case 'datetime': values[f.key] = kstInputToIso(s); break;
      case 'lines': values[f.key] = s.split('\n').map((l) => l.trim()).filter((l) => l !== ''); break;
      case 'select':
        if (f.options && !f.options.includes(s)) errors.push(`${f.label}: 목록에 있는 값을 골라 주세요.`);
        values[f.key] = s;
        break;
      default: values[f.key] = s;
    }
  }
  return { values, errors };
}

/** Short text for a list cell. */
export function cellText(field: FieldDef, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field.type === 'time') return String(value).slice(0, 5);
  if (field.type === 'datetime') return isoToKstInput(String(value)).replace('T', ' ');
  if (field.type === 'boolean') return value === true ? '예' : '아니요';
  if (field.type === 'lines') return Array.isArray(value) ? `${value.length}개` : '—';
  return String(value);
}

interface DbError {
  code?: string;
  message?: string;
  details?: string | null;
}

/** Supabase/Postgres error -> Korean sentence a non-developer can act on. */
export function koreanError(e: DbError | null | undefined): string {
  if (!e) return '알 수 없는 오류가 났습니다.';
  const msg = e.message ?? '';
  if (e.code === '42501' || /row-level security|permission denied/i.test(msg)) return '권한이 없습니다. 관리자 계정으로 로그인했는지 확인해 주세요.';
  if (e.code === '23514') return `입력값이 규칙에 맞지 않습니다(예: 끝나는 시각이 시작보다 빠름). ${msg}`;
  if (e.code === '23505') return '이미 같은 값이 있습니다(예: 같은 축제에 같은 날짜).';
  if (e.code === '23502') return `꼭 필요한 칸이 비어 있습니다. ${msg}`;
  if (e.code === '22007' || e.code === '22008' || e.code === '22P02') return '날짜·시간·숫자 형식이 올바르지 않습니다.';
  if (/Invalid login credentials/i.test(msg)) return '이메일 또는 비밀번호가 틀렸습니다.';
  if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) return '서버에 연결하지 못했습니다. 인터넷 연결과 .env.local의 주소를 확인해 주세요.';
  return msg || '알 수 없는 오류가 났습니다.';
}
