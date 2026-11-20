import { describe, expect, it } from 'vitest';
import { cellText, eulReul, formToRow, isoToKstInput, kstInputToIso, koreanError, rowToForm, type FieldDef } from '../src/lib/convert.ts';
import { essaySessions, schoolEvents } from '../src/tables.ts';

describe('time zones', () => {
  it('shows a UTC timestamp in Korean time and saves it back with +09:00', () => {
    expect(isoToKstInput('2026-12-02T05:00:00+00:00')).toBe('2026-12-02T14:00');
    expect(isoToKstInput('2026-12-02T14:00:00+09:00')).toBe('2026-12-02T14:00');
    expect(kstInputToIso('2026-12-02T14:00')).toBe('2026-12-02T14:00:00+09:00');
    expect(new Date(kstInputToIso('2026-12-02T14:00')).toISOString()).toBe('2026-12-02T05:00:00.000Z');
  });

  it('a time near midnight lands on the right Korean date', () => {
    expect(isoToKstInput('2026-12-01T16:30:00Z')).toBe('2026-12-02T01:30');
  });
});

describe('rowToForm / formToRow', () => {
  it('a new essay form starts with defaults', () => {
    const f = rowToForm(essaySessions.fields, null);
    expect(f['season_label']).toBe('2027학년도');
    expect(f['sort_order']).toBe('0');
    expect(f['is_published']).toBe(false);
    expect(f['items']).toBe('');
  });

  it('round-trips a stored essay row', () => {
    const row = {
      season_label: '2027학년도', track_label: '상경계열', exam_date: '2026-11-28', starts_at: '09:30:00', ends_at: '11:00:00',
      check_in_by: null, building_code: null, room_label: '시연용 고사장 A', destination_node_id: null, check_in_node_id: null,
      items: ['수험표', '신분증'], notices: [], is_published: true, sort_order: 1,
    };
    const form = rowToForm(essaySessions.fields, row);
    expect(form['starts_at']).toBe('09:30');
    expect(form['items']).toBe('수험표\n신분증');
    const back = formToRow(essaySessions.fields, form);
    expect(back.errors).toEqual([]);
    expect(back.values).toMatchObject({ starts_at: '09:30', items: ['수험표', '신분증'], notices: [], check_in_by: null, room_label: '시연용 고사장 A', sort_order: 1, is_published: true });
  });

  it('lines: blank lines and spaces are dropped', () => {
    const fields: FieldDef[] = [{ key: 'items', label: '준비물', type: 'lines' }];
    expect(formToRow(fields, { items: ' 수험표 \n\n 신분증\n' }).values['items']).toEqual(['수험표', '신분증']);
  });

  it('required fields are reported in Korean and nothing is saved', () => {
    const form = rowToForm(schoolEvents.fields, null);
    const r = formToRow(schoolEvents.fields, form);
    expect(r.errors).toContain('행사 이름을 입력해 주세요.');
    expect(r.errors).toContain('시작 (한국 시간)을(를) 입력해 주세요.');
  });

  it('school event: datetime saved with +09:00, empty end becomes null', () => {
    const form = { ...rowToForm(schoolEvents.fields, null), title: '설명회', starts_at: '2026-12-02T14:00' };
    const r = formToRow(schoolEvents.fields, form);
    expect(r.errors).toEqual([]);
    expect(r.values).toMatchObject({ title: '설명회', category: '행사', starts_at: '2026-12-02T14:00:00+09:00', ends_at: null, pinned: false, is_published: false });
  });

  it('a select value outside the list is refused', () => {
    const form = { ...rowToForm(schoolEvents.fields, null), title: 'x', starts_at: '2026-12-02T14:00', category: '파티' };
    expect(formToRow(schoolEvents.fields, form).errors.join()).toContain('종류');
  });
});

describe('particles', () => {
  it('을/를 follows the last syllable', () => {
    expect(eulReul('축제')).toBe('축제를');
    expect(eulReul('논술 일정')).toBe('논술 일정을');
    expect(eulReul('공연')).toBe('공연을');
    expect(eulReul('시작 (한국 시간)')).toBe('시작 (한국 시간)을(를)');
  });
});

describe('display and errors', () => {
  it('cells', () => {
    expect(cellText({ key: 't', label: 't', type: 'time' }, '09:30:00')).toBe('09:30');
    expect(cellText({ key: 'd', label: 'd', type: 'datetime' }, '2026-12-02T05:00:00+00:00')).toBe('2026-12-02 14:00');
    expect(cellText({ key: 'x', label: 'x', type: 'text' }, null)).toBe('—');
  });

  it('publish cells and the 계열 field type', () => {
    expect(cellText({ key: 'p', label: 'p', type: 'publish' }, true)).toBe('공개 중');
    expect(cellText({ key: 'p', label: 'p', type: 'publish' }, false)).toBe('숨김');
    const track = essaySessions.fields.find((f) => f.key === 'track_label');
    expect(track?.type).toBe('option');
    expect(track?.optionsFrom).toEqual({ table: 'essay_tracks', column: 'label', allowCustom: true });
  });

  it('foreign key errors: in use vs not in the list', () => {
    expect(koreanError({ code: '23001', message: 'update or delete on table "essay_tracks" violates RESTRICT setting' })).toContain('지울 수 없습니다');
    expect(koreanError({ code: '23503', message: 'Key is still referenced from table "essay_sessions".' })).toContain('지울 수 없습니다');
    expect(koreanError({ code: '23503', message: 'Key (track_label)=(x) is not present in table "essay_tracks".' })).toContain('목록에 없는 값');
  });

  it('turns database errors into Korean', () => {
    expect(koreanError({ code: '42501', message: 'permission denied for table school_events' })).toContain('권한이 없습니다');
    expect(koreanError({ code: '23514', message: 'violates check constraint "event_time_order"' })).toContain('규칙에 맞지 않습니다');
    expect(koreanError({ message: 'Invalid login credentials' })).toBe('이메일 또는 비밀번호가 틀렸습니다.');
  });
});
