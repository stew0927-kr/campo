-- 0007: 관리자가 편집기(관리자 웹 /map/)에서 현장 사진을 바꾸고 지울 수 있게
-- 0002는 campus_photos에 읽기 정책만 두고 쓰기는 비밀 키 스크립트(supabase/photo-pipeline)만 했다.
-- 이제 로그인한 관리자(0001의 public.is_admin())도 공개 키 + 로그인 세션으로 행을 고치고 지우며, campus-photos 버킷에 올리고 지운다.
-- 관리자가 아니면 RLS가 막는다(행 갱신·삭제는 0줄, 업로드·삭제는 403). 비밀 키는 브라우저에 넣지 않는다.
-- 여러 번 실행해도 안전하다(drop ... if exists).

-- ---------------------------------------------------------------------------
-- 1. campus_photos 표: 관리자 쓰기
-- ---------------------------------------------------------------------------
-- 이 프로젝트는 새 표에 API 역할 권한을 자동으로 주지 않으므로 직접 준다(0004 참고). 행 단위 허용은 아래 정책이 정한다.
grant insert, update, delete on public.campus_photos to authenticated;

drop policy if exists campus_photos_admin_insert on public.campus_photos;
create policy campus_photos_admin_insert on public.campus_photos
  for insert to authenticated with check (public.is_admin());

drop policy if exists campus_photos_admin_update on public.campus_photos;
create policy campus_photos_admin_update on public.campus_photos
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists campus_photos_admin_delete on public.campus_photos;
create policy campus_photos_admin_delete on public.campus_photos
  for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. campus-photos 버킷: 관리자 올리기·바꾸기·지우기
-- ---------------------------------------------------------------------------
-- 버킷은 공개라 읽기(공개 URL)는 정책 없이 된다. 크기(2 MB)·형식(WebP)은 0002의 버킷 설정이 그대로 막는다.
-- 편집기는 교체할 때 새 이름(thumbs/<id>-<지문 8자>.webp, full/…)으로 올리고 옛 파일을 지운다(공개 URL 1년 캐시 때문).
-- 지우기(remove)는 대상 객체를 select로 찾으므로 관리자 select 정책도 둔다.
drop policy if exists campus_photos_bucket_admin_select on storage.objects;
create policy campus_photos_bucket_admin_select on storage.objects
  for select to authenticated using (bucket_id = 'campus-photos' and public.is_admin());

drop policy if exists campus_photos_bucket_admin_insert on storage.objects;
create policy campus_photos_bucket_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'campus-photos' and public.is_admin());

drop policy if exists campus_photos_bucket_admin_update on storage.objects;
create policy campus_photos_bucket_admin_update on storage.objects
  for update to authenticated using (bucket_id = 'campus-photos' and public.is_admin())
  with check (bucket_id = 'campus-photos' and public.is_admin());

drop policy if exists campus_photos_bucket_admin_delete on storage.objects;
create policy campus_photos_bucket_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'campus-photos' and public.is_admin());
