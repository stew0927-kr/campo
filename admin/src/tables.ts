// What each screen shows and edits. Column names follow supabase/migrations/0001_content.sql exactly.
import type { FieldDef } from './lib/convert.ts';

export interface TableConfig {
  table: string;
  title: string;
  /** Singular noun for buttons ("논술 일정 추가"). */
  noun: string;
  fields: readonly FieldDef[];
  /** Field keys shown as list columns (is_published is always shown as a toggle when present). */
  columns: readonly string[];
  order: readonly { column: string; ascending: boolean }[];
  /** Field key that ties the row to a parent row (festival_days.festival_id, ...). */
  parentKey?: string;
  /** Extra warning in the delete confirmation. */
  deleteNote?: string;
}

const NODE_HINT = '지도 데이터의 지점 id. 아직 모르면 비워 두세요.';

export const essaySessions: TableConfig = {
  table: 'essay_sessions',
  title: '논술',
  noun: '논술 일정',
  fields: [
    { key: 'season_label', label: '학년도', type: 'text', required: true, initial: '2027학년도' },
    { key: 'track_label', label: '계열', type: 'text', required: true, hint: '예: 상경계열, 인문계열(오후1)' },
    { key: 'exam_date', label: '시험 날짜', type: 'date', required: true },
    { key: 'starts_at', label: '시작', type: 'time', required: true },
    { key: 'ends_at', label: '끝', type: 'time', required: true },
    { key: 'check_in_by', label: '입실 마감', type: 'time' },
    { key: 'building_code', label: '건물 코드', type: 'text' },
    { key: 'room_label', label: '고사장', type: 'text', hint: '예: 301호. 배정 전이면 비워 두세요.' },
    { key: 'destination_node_id', label: '고사장 지점 id', type: 'text', hint: NODE_HINT },
    { key: 'check_in_node_id', label: '입실 확인 지점 id', type: 'text', hint: NODE_HINT },
    { key: 'items', label: '준비물', type: 'lines', hint: '한 줄에 하나씩' },
    { key: 'notices', label: '유의사항', type: 'lines', hint: '한 줄에 하나씩' },
    { key: 'sort_order', label: '정렬 순서', type: 'number', initial: '0' },
    { key: 'is_published', label: '앱에 공개', type: 'boolean' },
  ],
  columns: ['exam_date', 'starts_at', 'ends_at', 'track_label', 'room_label'],
  order: [{ column: 'exam_date', ascending: true }, { column: 'sort_order', ascending: true }, { column: 'starts_at', ascending: true }],
};

export const festivals: TableConfig = {
  table: 'festivals',
  title: '축제',
  noun: '축제',
  fields: [
    { key: 'name', label: '축제 이름', type: 'text', required: true },
    { key: 'starts_on', label: '시작 날짜', type: 'date', required: true },
    { key: 'ends_on', label: '끝 날짜', type: 'date', required: true },
    { key: 'summary', label: '소개', type: 'textarea' },
    { key: 'is_published', label: '앱에 공개', type: 'boolean' },
  ],
  columns: ['name', 'starts_on', 'ends_on'],
  order: [{ column: 'starts_on', ascending: false }],
  deleteNote: '이 축제의 날짜·부스·공연도 함께 지워집니다.',
};

export const festivalDays: TableConfig = {
  table: 'festival_days',
  title: '축제 날짜',
  noun: '날짜',
  parentKey: 'festival_id',
  fields: [
    { key: 'day_date', label: '날짜', type: 'date', required: true },
    { key: 'opens_at', label: '여는 시각', type: 'time' },
    { key: 'closes_at', label: '닫는 시각', type: 'time' },
    { key: 'sort_order', label: '정렬 순서', type: 'number', initial: '0' },
  ],
  columns: ['day_date', 'opens_at', 'closes_at'],
  order: [{ column: 'day_date', ascending: true }],
  deleteNote: '이 날짜의 부스·공연도 함께 지워집니다.',
};

export const festivalStalls: TableConfig = {
  table: 'festival_stalls',
  title: '부스',
  noun: '부스',
  parentKey: 'day_id',
  fields: [
    { key: 'name', label: '부스 이름', type: 'text', required: true },
    { key: 'category', label: '종류', type: 'select', required: true, options: ['주점', '부스', '공연', '편의'], initial: '부스' },
    { key: 'opens_at', label: '여는 시각', type: 'time' },
    { key: 'closes_at', label: '닫는 시각', type: 'time' },
    { key: 'queue_note', label: '대기 안내', type: 'text', hint: '예: 대기 20분 예상' },
    { key: 'building_code', label: '건물 코드', type: 'text' },
    { key: 'node_id', label: '부스 지점 id', type: 'text', hint: NODE_HINT },
    { key: 'entrance_node_id', label: '입장 지점 id', type: 'text', hint: NODE_HINT },
    { key: 'exit_node_id', label: '퇴장 지점 id', type: 'text', hint: NODE_HINT },
    { key: 'description', label: '설명', type: 'textarea' },
    { key: 'sort_order', label: '정렬 순서', type: 'number', initial: '0' },
    { key: 'is_published', label: '앱에 공개', type: 'boolean' },
  ],
  columns: ['name', 'category', 'opens_at', 'closes_at'],
  order: [{ column: 'sort_order', ascending: true }, { column: 'name', ascending: true }],
};

export const festivalPerformances: TableConfig = {
  table: 'festival_performances',
  title: '공연',
  noun: '공연',
  parentKey: 'day_id',
  fields: [
    { key: 'artist', label: '공연팀', type: 'text', required: true },
    { key: 'starts_at', label: '시작', type: 'time', required: true },
    { key: 'ends_at', label: '끝', type: 'time' },
    { key: 'stage_label', label: '무대', type: 'text' },
    { key: 'node_id', label: '무대 지점 id', type: 'text', hint: NODE_HINT },
    { key: 'description', label: '설명', type: 'textarea' },
    { key: 'sort_order', label: '정렬 순서', type: 'number', initial: '0' },
    { key: 'is_published', label: '앱에 공개', type: 'boolean' },
  ],
  columns: ['starts_at', 'ends_at', 'artist', 'stage_label'],
  order: [{ column: 'starts_at', ascending: true }],
};

export const schoolEvents: TableConfig = {
  table: 'school_events',
  title: '학교행사',
  noun: '학교행사',
  fields: [
    { key: 'title', label: '행사 이름', type: 'text', required: true },
    { key: 'category', label: '종류', type: 'select', required: true, options: ['입학', '설명회', '강연', '행사', '공지'], initial: '행사' },
    { key: 'starts_at', label: '시작 (한국 시간)', type: 'datetime', required: true },
    { key: 'ends_at', label: '끝 (한국 시간)', type: 'datetime' },
    { key: 'all_day', label: '하루 종일', type: 'boolean' },
    { key: 'place_label', label: '장소', type: 'text', hint: '예: 백남학술정보관 6층' },
    { key: 'building_code', label: '건물 코드', type: 'text' },
    { key: 'node_id', label: '장소 지점 id', type: 'text', hint: NODE_HINT },
    { key: 'host', label: '주최', type: 'text' },
    { key: 'summary', label: '소개', type: 'textarea' },
    { key: 'link_url', label: '링크', type: 'text', hint: 'https://로 시작하는 주소' },
    { key: 'pinned', label: '목록 맨 위에 고정', type: 'boolean' },
    { key: 'is_published', label: '앱에 공개', type: 'boolean' },
  ],
  columns: ['starts_at', 'title', 'category', 'place_label', 'pinned'],
  order: [{ column: 'pinned', ascending: false }, { column: 'starts_at', ascending: true }],
};
