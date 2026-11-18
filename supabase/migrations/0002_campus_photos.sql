-- 0002: 현장 사진 주소 표, 읽기 전용 보안 규칙, 공개 버킷
-- 칸 이름은 apps/app/src/contracts.ts의 PhotoRow(id, node_id, heading_deg, heading_source, direction_hint,
-- hfov_deg, thumb_url, full_url)와 같다. 값은 data/schema/survey.schema.json의 photo_meta에서 온다.
-- 쓰기는 비밀 키(secret)를 쓰는 업로드 스크립트만 한다. 공개 키로는 읽기만 된다.

create table if not exists public.campus_photos (
  id text primary key,                                   -- 지점 id + 파일 이름(재실행해도 같은 값)
  campus_id text not null default 'hanyang-seoul',
  node_id text not null,                                 -- survey.json attachments의 키
  building_id text,                                      -- 지도 데이터에서 찾으면 채움, 없으면 null
  level integer,                                         -- 1층 = 1, 지하 1층 = -1 (0은 쓰지 않음)
  heading_deg double precision,                          -- 사진이 보는 방향(도). 소수도 들어온다
  heading_source text,                                   -- sensor / dial / manual
  hfov_deg double precision,                             -- 수평 화각(도)
  direction_hint text,                                   -- 예: 사진 오른쪽 두 번째 문
  thumb_url text not null,
  full_url text not null,
  sha256 text,                                           -- 원본 파일 내용의 지문(중복 방지)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campus_photos_level_nonzero check (level is null or level <> 0),
  constraint campus_photos_heading_range check (heading_deg is null or (heading_deg >= 0 and heading_deg < 360)),
  constraint campus_photos_heading_source check (heading_source is null or heading_source in ('sensor', 'dial', 'manual')),
  constraint campus_photos_hfov_range check (hfov_deg is null or (hfov_deg > 0 and hfov_deg < 180)),
  constraint campus_photos_sha256_format check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$')
);

create index if not exists campus_photos_campus_node_idx on public.campus_photos (campus_id, node_id);
create unique index if not exists campus_photos_sha256_key on public.campus_photos (sha256) where sha256 is not null;

drop trigger if exists touch_updated_at on public.campus_photos;
create trigger touch_updated_at before update on public.campus_photos
  for each row execute function public.touch_updated_at();

grant select on public.campus_photos to anon, authenticated;

alter table public.campus_photos enable row level security;

-- 읽기만 허용. 쓰기 정책은 만들지 않는다(비밀 키는 RLS를 통과하므로 스크립트는 쓸 수 있다).
drop policy if exists campus_photos_public_read on public.campus_photos;
create policy campus_photos_public_read on public.campus_photos
  for select to anon, authenticated using (true);

-- 공개 버킷: 주소만 알면 누구나 볼 수 있다. WebP만, 한 장 2 MB까지.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campus-photos', 'campus-photos', true, 2097152, array['image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
