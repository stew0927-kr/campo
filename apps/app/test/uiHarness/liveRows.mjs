// Synthetic SQL-shaped fixtures for intercepted HTTP only. Not D's actual database contents.
export const LIVE_ROWS = {
  essay_sessions: [{ id: 'test-exam', season_label: '검사시즌', track_label: '검사 서버 논술', exam_date: '2026-11-28', starts_at: '09:00:00', ends_at: '10:30:00', check_in_by: '08:30:00', building_code: '검사 고사관', room_label: '101호', destination_node_id: null, check_in_node_id: null, items: ['검사 준비물'], notices: ['모의 응답입니다.'], is_published: true, sort_order: 0 }],
  festivals: [{ id: 'test-festival', name: '검사 서버 축제', starts_on: '2026-11-21', ends_on: '2026-11-21', summary: '모의 응답입니다.', is_published: true }],
  festival_days: [{ id: 'test-day', festival_id: 'test-festival', day_date: '2026-11-21', opens_at: '16:00:00', closes_at: '22:00:00', sort_order: 0 }],
  festival_stalls: [{ id: 'test-stall', day_id: 'test-day', name: '검사 서버 부스', category: '부스', building_code: '검사 축제관', node_id: null, entrance_node_id: null, exit_node_id: null, opens_at: '16:00:00', closes_at: '22:00:00', queue_note: '모의 응답입니다.', description: '모의 부스입니다.', is_published: true, sort_order: 0 }],
  festival_performances: [{ id: 'test-performance', day_id: 'test-day', starts_at: '18:00:00', ends_at: '19:00:00', artist: '검사 서버 출연진', stage_label: '검사 무대', node_id: null, description: '모의 공연입니다.', is_published: true, sort_order: 0 }],
  school_events: [{ id: 'test-event', title: '검사 서버 행사', category: '강연', starts_at: '2026-11-25T16:00:00+09:00', ends_at: null, all_day: false, place_label: '검사 행사관', building_code: null, node_id: null, host: '검사 주최', summary: '모의 행사입니다.', link_url: null, is_published: true, pinned: false }],
  campus_photos: [{ id: 'test-photo', campus_id: 'hanyang-seoul', node_id: 'unmapped-node', heading_deg: 90, heading_source: 'manual', direction_hint: null, hfov_deg: null, thumb_url: 'https://example.test/thumb.webp', full_url: 'https://example.test/full.webp' }],
};
