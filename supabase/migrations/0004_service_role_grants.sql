-- 0004: 비밀 키(service_role)가 쓰는 표 권한
-- 이 프로젝트는 새 표에 API 역할 권한을 자동으로 주지 않는다. service_role은 RLS는 건너뛰지만
-- 표 권한(GRANT)은 따로 있어야 하므로, 사진 업로드 스크립트(supabase/photo-pipeline)가 쓰는 표에 직접 준다.
-- 비밀 키는 내 컴퓨터의 스크립트에서만 쓴다(앱·브라우저 금지). 여러 번 실행해도 안전하다.

grant select, insert, update, delete on public.campus_photos to service_role;

-- 나중에 스크립트로 콘텐츠를 넣거나 고칠 때를 위해 콘텐츠 표에도 같은 권한을 준다.
grant select, insert, update, delete on
  public.essay_sessions, public.festivals, public.festival_days,
  public.festival_stalls, public.festival_performances, public.school_events,
  public.profiles
  to service_role;
