-- 0006: 캠퍼스 지도 파일을 서버에 둔다
-- 편집기 폴더 data/campuses/<캠퍼스 id>/의 campus.json과 *.geojson을 파일 하나당 한 줄로 저장한다.
-- 앱은 공개 키로 읽고(로그인 없음), 쓰기는 관리자(profiles.role = 'admin')만 한다.
-- 저장은 public.save_campus_map() 한 번으로 한다: 관리자 웹의 '폴더 올리기'와 매핑 편집기 저장이 같이 쓴다.
-- 여러 번 실행해도 안전하다(if not exists, create or replace, drop ... if exists).

-- ---------------------------------------------------------------------------
-- 1. 표
-- ---------------------------------------------------------------------------
create table if not exists public.campus_map_files (
  campus_id text not null,                      -- 예: hanyang-seoul
  path text not null,                           -- 캠퍼스 폴더 안의 경로. 예: buildings/OSMw187181264/L1.geojson
  text text not null,                           -- 파일 내용 그대로(JSON 문자열)
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,  -- 저장한 관리자. DB가 채운다
  primary key (campus_id, path),
  -- 편집기 개발 서버(packages/editor/server/campus-api.ts)의 CAMPUS_ID·CAMPUS_PATH와 같은 규칙.
  -- 층 파일은 L1, L2 …, 지하는 L-1, L-2 … (0층은 없다)
  constraint campus_map_files_campus_id_format check (campus_id ~ '^[a-z0-9][a-z0-9-]*$'),
  constraint campus_map_files_path_format check (
    path ~ '^(campus\.json|outdoor\.geojson|connections\.geojson|buildings/[A-Za-z0-9]+/(building|L-?[1-9][0-9]*)\.geojson)$'
  )
);

drop trigger if exists touch_updated_at on public.campus_map_files;
create trigger touch_updated_at before update on public.campus_map_files
  for each row execute function public.touch_updated_at();

-- 누가 저장했는지는 브라우저가 보내는 값 대신 로그인 세션(auth.uid())으로 채운다. 비밀 키로 쓰면 null.
create or replace function public.campus_map_files_set_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists set_updated_by on public.campus_map_files;
create trigger set_updated_by before insert or update on public.campus_map_files
  for each row execute function public.campus_map_files_set_updated_by();

-- ---------------------------------------------------------------------------
-- 2. 권한과 보안 규칙(RLS)
-- ---------------------------------------------------------------------------
-- 이 프로젝트는 새 표에 API 역할 권한을 자동으로 주지 않으므로 직접 준다(0004 참고).
grant select on public.campus_map_files to anon, authenticated;
grant insert, update, delete on public.campus_map_files to authenticated;
grant select, insert, update, delete on public.campus_map_files to service_role;

alter table public.campus_map_files enable row level security;

-- 읽기: 누구나. 앱이 로그인 없이 지도를 받아야 한다. 그래서 지도 파일에는 개인 정보를 넣지 않는다.
drop policy if exists campus_map_files_public_read on public.campus_map_files;
create policy campus_map_files_public_read on public.campus_map_files
  for select to anon, authenticated using (true);

-- 쓰기: 관리자만(0001의 is_admin()).
drop policy if exists campus_map_files_admin on public.campus_map_files;
create policy campus_map_files_admin on public.campus_map_files
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. 저장 함수
-- ---------------------------------------------------------------------------
-- p_files    [{ "path": "...", "text": "..." }, ...]  올릴 파일들(campus.json·*.geojson)
-- p_expected { "<path>": "<updated_at>", ... }       불러올 때 본 서버 상태. 그 사이 누가 저장했으면(경로가
--            늘거나 줄거나 시각이 다르면) 아무것도 바꾸지 않고 PT409로 멈춘다.
-- p_prune    true면 p_files에 없는 *.geojson 줄을 지운다(편집기 저장은 true, 폴더 올리기는 고른 경우만).
-- 내용이 같은 파일은 다시 쓰지 않는다. 모두 한 트랜잭션이라 중간에 끊겨도 반쯤 저장되지 않는다.
-- 돌려주는 값: { "written": [경로], "removed": [경로], "state": { 경로: updated_at } }
create or replace function public.save_campus_map(
  p_campus_id text,
  p_files jsonb,
  p_expected jsonb,
  p_prune boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_file jsonb;
  v_path text;
  v_written jsonb;
  v_removed jsonb := '[]'::jsonb;
  v_state jsonb;
begin
  if not public.is_admin() then
    raise exception '관리자 계정만 지도를 저장할 수 있습니다.' using errcode = '42501';
  end if;
  if p_campus_id is null or p_campus_id !~ '^[a-z0-9][a-z0-9-]*$' then
    raise exception '캠퍼스 id가 올바르지 않습니다: %', coalesce(p_campus_id, '(없음)') using errcode = '22023';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    raise exception '올릴 파일 목록이 없습니다.' using errcode = '22023';
  end if;
  if p_expected is null or jsonb_typeof(p_expected) <> 'object' then
    raise exception '불러올 때의 서버 상태가 없습니다. 새로고침(F5) 후 다시 저장해 주세요.' using errcode = '22023';
  end if;

  -- 파일마다: 경로 규칙, 내용이 JSON인지
  for v_file in select value from jsonb_array_elements(p_files) loop
    v_path := v_file ->> 'path';
    if jsonb_typeof(v_file -> 'path') is distinct from 'string' or jsonb_typeof(v_file -> 'text') is distinct from 'string' then
      raise exception '파일 항목에는 path와 text 글자가 있어야 합니다.' using errcode = '22023';
    end if;
    if v_path !~ '^(campus\.json|outdoor\.geojson|connections\.geojson|buildings/[A-Za-z0-9]+/(building|L-?[1-9][0-9]*)\.geojson)$' then
      raise exception '지도 파일 경로 규칙에 맞지 않습니다: %', v_path using errcode = '22023';
    end if;
    begin
      perform (v_file ->> 'text')::jsonb;
    exception when others then
      raise exception '올바른 JSON이 아닙니다: %', v_path using errcode = '22023';
    end;
  end loop;
  if (select count(*) from jsonb_array_elements(p_files)) <>
     (select count(distinct value ->> 'path') from jsonb_array_elements(p_files)) then
    raise exception '같은 경로의 파일이 두 번 들어 있습니다.' using errcode = '22023';
  end if;

  -- 같은 캠퍼스 저장은 한 번에 하나씩
  perform pg_advisory_xact_lock(hashtextextended('campus_map_files:' || p_campus_id, 0));

  -- 그 사이 다른 저장이 있었는지
  if exists (
    select 1
    from (select path, updated_at from public.campus_map_files where campus_id = p_campus_id) cur
    full join (select key as path, (value #>> '{}')::timestamptz as updated_at from jsonb_each(p_expected)) seen
      using (path)
    where cur.updated_at is distinct from seen.updated_at
  ) then
    raise exception '다른 곳에서 먼저 저장했습니다. 새로고침(F5) 후 다시 저장해 주세요.' using errcode = 'PT409';
  end if;

  with incoming as (
    select value ->> 'path' as path, value ->> 'text' as text from jsonb_array_elements(p_files)
  ), saved as (
    insert into public.campus_map_files as t (campus_id, path, text)
    select p_campus_id, i.path, i.text from incoming i
    on conflict (campus_id, path) do update set text = excluded.text
      where t.text is distinct from excluded.text
    returning t.path
  )
  select coalesce(jsonb_agg(path order by path), '[]'::jsonb) into v_written from saved;

  if p_prune then
    with incoming as (
      select value ->> 'path' as path from jsonb_array_elements(p_files)
    ), gone as (
      delete from public.campus_map_files t
      where t.campus_id = p_campus_id
        and t.path like '%.geojson'
        and not exists (select 1 from incoming i where i.path = t.path)
      returning t.path
    )
    select coalesce(jsonb_agg(path order by path), '[]'::jsonb) into v_removed from gone;
  end if;

  if not exists (select 1 from public.campus_map_files where campus_id = p_campus_id and path = 'campus.json') then
    raise exception 'campus.json이 없습니다. 캠퍼스 폴더(campus.json이 든 폴더)를 올려 주세요.' using errcode = '22023';
  end if;

  select coalesce(jsonb_object_agg(path, updated_at), '{}'::jsonb) into v_state
  from public.campus_map_files where campus_id = p_campus_id;

  return jsonb_build_object('written', v_written, 'removed', v_removed, 'state', v_state);
end;
$$;

revoke all on function public.save_campus_map(text, jsonb, jsonb, boolean) from public;
revoke all on function public.save_campus_map(text, jsonb, jsonb, boolean) from anon;
grant execute on function public.save_campus_map(text, jsonb, jsonb, boolean) to authenticated;
