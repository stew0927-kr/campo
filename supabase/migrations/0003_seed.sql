-- 0003: 시연용 데이터. 논술 날짜·시간은 2027학년도 한양대 수시 모집요강의 공개 일정(2026-11-28)을 따르고,
-- 고사장·준비물·축제·행사는 가상이다. id를 고정해 두어 여러 번 실행해도 중복되지 않는다.
-- 지도 데이터(data/campuses/hanyang-seoul)가 아직 비어 있어 지점 id(*_node_id)는 모두 null이다.

-- 논술 3건 (11/28 상경·인문 계열)
insert into public.essay_sessions
  (id, season_label, track_label, exam_date, starts_at, ends_at, check_in_by, building_code, room_label,
   items, notices, is_published, sort_order)
values
  ('00000000-0000-4000-8000-000000000101', '2027학년도', '상경계열', '2026-11-28', '09:30', '11:00', null,
   null, '시연용 고사장 A',
   '["수험표", "신분증", "필기구"]'::jsonb,
   '["시연용 데이터입니다. 실제 고사장과 입실 시간은 수험표와 입학처 공지를 확인해 주세요."]'::jsonb,
   true, 1),
  ('00000000-0000-4000-8000-000000000102', '2027학년도', '인문계열(오후1)', '2026-11-28', '13:30', '15:00', null,
   null, '시연용 고사장 B',
   '["수험표", "신분증", "필기구"]'::jsonb,
   '["시연용 데이터입니다. 실제 고사장과 입실 시간은 수험표와 입학처 공지를 확인해 주세요."]'::jsonb,
   true, 2),
  ('00000000-0000-4000-8000-000000000103', '2027학년도', '인문계열(오후2)', '2026-11-28', '17:00', '18:30', null,
   null, '시연용 고사장 C',
   '["수험표", "신분증", "필기구"]'::jsonb,
   '["시연용 데이터입니다. 실제 고사장과 입실 시간은 수험표와 입학처 공지를 확인해 주세요."]'::jsonb,
   true, 3)
on conflict (id) do nothing;

-- 축제 1개 + 이틀 + 부스 2개 + 공연 1개 (가상)
insert into public.festivals (id, name, starts_on, ends_on, summary, is_published)
values ('00000000-0000-4000-8000-000000000201', '시연용 축제', '2026-12-03', '2026-12-04',
        '시연용 축제 데이터입니다.', true)
on conflict (id) do nothing;

insert into public.festival_days (id, festival_id, day_date, opens_at, closes_at, sort_order)
values
  ('00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-000000000201', '2026-12-03', '11:00', '22:00', 1),
  ('00000000-0000-4000-8000-000000000212', '00000000-0000-4000-8000-000000000201', '2026-12-04', '11:00', '22:00', 2)
on conflict (id) do nothing;

insert into public.festival_stalls
  (id, day_id, name, category, opens_at, closes_at, queue_note, description, is_published, sort_order)
values
  ('00000000-0000-4000-8000-000000000221', '00000000-0000-4000-8000-000000000211', '주점 A', '주점',
   '17:00', '22:00', '대기 20분 예상', '시연용 부스입니다.', true, 1),
  ('00000000-0000-4000-8000-000000000222', '00000000-0000-4000-8000-000000000211', '먹거리 부스', '부스',
   '12:00', '20:00', '대기 없음', '시연용 부스입니다.', true, 2)
on conflict (id) do nothing;

insert into public.festival_performances
  (id, day_id, starts_at, ends_at, artist, stage_label, description, is_published, sort_order)
values
  ('00000000-0000-4000-8000-000000000231', '00000000-0000-4000-8000-000000000211', '18:30', '19:30',
   '시연용 공연팀', '중앙 무대', '시연용 공연입니다.', true, 1)
on conflict (id) do nothing;

-- 학교행사 3건 (가상) + 비공개 1건(보안 규칙 확인용: 공개 키로는 보이면 안 된다)
insert into public.school_events
  (id, title, category, starts_at, ends_at, place_label, host, summary, is_published, pinned)
values
  ('00000000-0000-4000-8000-000000000301', '시연용 입학설명회', '입학',
   '2026-12-02 14:00+09', '2026-12-02 16:00+09', '시연용 장소', '시연용 주최', '시연용 일정입니다.', true, true),
  ('00000000-0000-4000-8000-000000000302', '시연용 특강', '강연',
   '2026-12-03 16:00+09', '2026-12-03 18:00+09', '시연용 장소', '시연용 주최', '시연용 일정입니다.', true, false),
  ('00000000-0000-4000-8000-000000000303', '시연용 동아리 박람회', '행사',
   '2026-12-05 11:00+09', '2026-12-05 17:00+09', '시연용 장소', '시연용 주최', '시연용 일정입니다.', true, false),
  ('00000000-0000-4000-8000-000000000304', '비공개 확인용 행사', '행사',
   '2026-12-06 11:00+09', null, null, null, '공개 키로 보이면 보안 규칙이 잘못된 것입니다.', false, false)
on conflict (id) do nothing;
