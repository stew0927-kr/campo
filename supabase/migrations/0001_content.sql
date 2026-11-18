-- 0001: 논술·축제·학교행사 콘텐츠 표, 관리자 판정, 보안 규칙(RLS)
-- 앱(공개 키)은 is_published = true인 행만 읽는다. 쓰기는 profiles.role = 'admin'인 로그인 사용자만 한다.
-- 여러 번 실행해도 안전하게 썼다(if not exists, drop ... if exists).

-- ---------------------------------------------------------------------------
-- 1. 관리자 프로필과 판정 함수
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  display_name text,
  created_at timestamptz not null default now()
);

-- 지금 로그인한 사용자가 관리자인지. security definer라 profiles의 RLS에 막히지 않는다.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 수정할 때마다 updated_at을 지금 시각으로.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. 콘텐츠 표
-- ---------------------------------------------------------------------------
create table if not exists public.essay_sessions (
  id uuid primary key default gen_random_uuid(),
  season_label text not null,                -- 예: 2027학년도
  track_label text not null,                 -- 예: 상경계열, 인문계열(오후1)
  exam_date date not null,
  starts_at time not null,
  ends_at time not null,
  check_in_by time,                          -- 입실 마감
  building_code text,
  room_label text,                           -- 예: 301호 (고사장 배정 전이면 비움)
  destination_node_id text,                  -- 지도 데이터의 지점 id. 없으면 null
  check_in_node_id text,
  items jsonb not null default '[]'::jsonb,  -- 준비물: ["수험표", "신분증"]
  notices jsonb not null default '[]'::jsonb,
  is_published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint essay_items_is_array check (jsonb_typeof(items) = 'array'),
  constraint essay_notices_is_array check (jsonb_typeof(notices) = 'array'),
  constraint essay_time_order check (ends_at > starts_at)
);

create table if not exists public.festivals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  summary text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint festival_date_order check (ends_on >= starts_on)
);

create table if not exists public.festival_days (
  id uuid primary key default gen_random_uuid(),
  festival_id uuid not null references public.festivals (id) on delete cascade,
  day_date date not null,
  opens_at time,
  closes_at time,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint festival_day_unique unique (festival_id, day_date)
);

create table if not exists public.festival_stalls (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references public.festival_days (id) on delete cascade,
  name text not null,
  category text not null check (category in ('주점', '부스', '공연', '편의')),
  building_code text,
  node_id text,
  entrance_node_id text,
  exit_node_id text,
  opens_at time,
  closes_at time,
  queue_note text,
  description text,
  is_published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.festival_performances (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references public.festival_days (id) on delete cascade,
  starts_at time not null,
  ends_at time,
  artist text not null,
  stage_label text,
  node_id text,
  description text,
  is_published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.school_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null check (category in ('입학', '설명회', '강연', '행사', '공지')),
  starts_at timestamptz not null,            -- +09:00을 붙여 넣는다
  ends_at timestamptz,
  all_day boolean not null default false,
  place_label text,
  building_code text,
  node_id text,
  host text,
  summary text,
  link_url text,
  is_published boolean not null default false,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_time_order check (ends_at is null or ends_at >= starts_at)
);

create index if not exists essay_sessions_date_idx on public.essay_sessions (exam_date, sort_order);
create index if not exists festival_days_festival_idx on public.festival_days (festival_id, sort_order);
create index if not exists festival_stalls_day_idx on public.festival_stalls (day_id, sort_order);
create index if not exists festival_performances_day_idx on public.festival_performances (day_id, starts_at);
create index if not exists school_events_start_idx on public.school_events (starts_at);

-- updated_at 자동 갱신
drop trigger if exists touch_updated_at on public.essay_sessions;
create trigger touch_updated_at before update on public.essay_sessions
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_updated_at on public.festivals;
create trigger touch_updated_at before update on public.festivals
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_updated_at on public.festival_days;
create trigger touch_updated_at before update on public.festival_days
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_updated_at on public.festival_stalls;
create trigger touch_updated_at before update on public.festival_stalls
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_updated_at on public.festival_performances;
create trigger touch_updated_at before update on public.festival_performances
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_updated_at on public.school_events;
create trigger touch_updated_at before update on public.school_events
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. 권한(테이블 단위) — 실제로 무엇을 읽고 쓸지는 아래 RLS가 정한다
-- ---------------------------------------------------------------------------
grant select on
  public.essay_sessions, public.festivals, public.festival_days,
  public.festival_stalls, public.festival_performances, public.school_events
  to anon, authenticated;
grant insert, update, delete on
  public.essay_sessions, public.festivals, public.festival_days,
  public.festival_stalls, public.festival_performances, public.school_events
  to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS — 켜기만 하고 정책이 없으면 아무도 못 읽는다(안전한 기본값)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.essay_sessions enable row level security;
alter table public.festivals enable row level security;
alter table public.festival_days enable row level security;
alter table public.festival_stalls enable row level security;
alter table public.festival_performances enable row level security;
alter table public.school_events enable row level security;

-- 4.1 공개 읽기: is_published = true인 행만
drop policy if exists essay_sessions_public_read on public.essay_sessions;
create policy essay_sessions_public_read on public.essay_sessions
  for select to anon, authenticated using (is_published);

drop policy if exists festivals_public_read on public.festivals;
create policy festivals_public_read on public.festivals
  for select to anon, authenticated using (is_published);

drop policy if exists school_events_public_read on public.school_events;
create policy school_events_public_read on public.school_events
  for select to anon, authenticated using (is_published);

-- 하위 표: 부모 축제가 공개된 것만(부스·공연은 자기 is_published도 true여야 함)
drop policy if exists festival_days_public_read on public.festival_days;
create policy festival_days_public_read on public.festival_days
  for select to anon, authenticated
  using (exists (
    select 1 from public.festivals f
    where f.id = festival_days.festival_id and f.is_published
  ));

drop policy if exists festival_stalls_public_read on public.festival_stalls;
create policy festival_stalls_public_read on public.festival_stalls
  for select to anon, authenticated
  using (is_published and exists (
    select 1 from public.festival_days d
    join public.festivals f on f.id = d.festival_id
    where d.id = festival_stalls.day_id and f.is_published
  ));

drop policy if exists festival_performances_public_read on public.festival_performances;
create policy festival_performances_public_read on public.festival_performances
  for select to anon, authenticated
  using (is_published and exists (
    select 1 from public.festival_days d
    join public.festivals f on f.id = d.festival_id
    where d.id = festival_performances.day_id and f.is_published
  ));

-- 4.2 관리자: 읽기(비공개 포함)·쓰기·삭제 전부
drop policy if exists essay_sessions_admin on public.essay_sessions;
create policy essay_sessions_admin on public.essay_sessions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists festivals_admin on public.festivals;
create policy festivals_admin on public.festivals
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists festival_days_admin on public.festival_days;
create policy festival_days_admin on public.festival_days
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists festival_stalls_admin on public.festival_stalls;
create policy festival_stalls_admin on public.festival_stalls
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists festival_performances_admin on public.festival_performances;
create policy festival_performances_admin on public.festival_performances
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists school_events_admin on public.school_events;
create policy school_events_admin on public.school_events
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 4.3 프로필: 자기 행은 읽을 수 있고(관리자 화면이 내 역할을 확인), 쓰기는 관리자만. 공개 키로는 읽지 못한다.
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists profiles_admin on public.profiles;
create policy profiles_admin on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
