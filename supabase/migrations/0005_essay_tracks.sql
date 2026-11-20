-- 0005: 논술 계열 목록(관리자 웹 드롭다운의 선택지)
-- 관리자가 목록을 추가·이름 변경·삭제한다. essay_sessions.track_label은 이 목록의 label만 쓸 수 있고(외래 키),
-- 목록에서 이름을 바꾸면 그 계열을 쓰던 논술 일정도 함께 바뀐다(on update cascade).
-- 쓰고 있는 계열은 지울 수 없다(on delete restrict). 여러 번 실행해도 안전하다.

create table if not exists public.essay_tracks (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint essay_tracks_label_not_blank check (btrim(label) <> '')
);

drop trigger if exists touch_updated_at on public.essay_tracks;
create trigger touch_updated_at before update on public.essay_tracks
  for each row execute function public.touch_updated_at();

-- 기본 선택지(2027학년도 한양대 논술 계열) + 이미 논술 일정에 쓰인 값
insert into public.essay_tracks (label, sort_order) values
  ('상경계열', 1), ('인문계열(오후1)', 2), ('인문계열(오후2)', 3), ('자연계열', 4)
on conflict (label) do nothing;
insert into public.essay_tracks (label, sort_order)
  select distinct track_label, 100 from public.essay_sessions
on conflict (label) do nothing;

alter table public.essay_sessions drop constraint if exists essay_sessions_track_fk;
alter table public.essay_sessions
  add constraint essay_sessions_track_fk foreign key (track_label)
  references public.essay_tracks (label) on update cascade on delete restrict;

-- 권한: 이 프로젝트는 새 표에 권한을 자동으로 주지 않으므로 직접 준다(0004 참고)
grant select on public.essay_tracks to anon, authenticated;
grant insert, update, delete on public.essay_tracks to authenticated;
grant select, insert, update, delete on public.essay_tracks to service_role;

alter table public.essay_tracks enable row level security;

-- 선택지 이름은 공개 정보라 누구나 읽을 수 있다. 쓰기는 관리자만.
drop policy if exists essay_tracks_public_read on public.essay_tracks;
create policy essay_tracks_public_read on public.essay_tracks
  for select to anon, authenticated using (true);

drop policy if exists essay_tracks_admin on public.essay_tracks;
create policy essay_tracks_admin on public.essay_tracks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
