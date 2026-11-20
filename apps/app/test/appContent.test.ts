import { describe, expect, it } from 'vitest';
import { DEMO_CONTENT, ESSAY_NOTICE } from '../src/features/content/mock.ts';
import { publishedContent } from '../src/features/content/published.ts';
import { contentFromRows, type ContentRows } from '../src/features/content/rows.ts';
import { checkInTimeline, seoulTime } from '../src/features/essay/time.ts';
import { flowDestination, hasFlowNodes } from '../src/features/festival/flow.ts';

describe('demo content and published data contracts', () => {
  it('labels the 2027 season as a demo and never invents real campus node ids', () => {
    expect(ESSAY_NOTICE).toContain('2027학년도'); expect(ESSAY_NOTICE).toContain('실제'); expect(ESSAY_NOTICE).toContain('시연용');
    expect([...new Set(DEMO_CONTENT.essays.map((row) => row.examDate))]).toEqual(['2026-11-28', '2026-11-29']);
    expect(DEMO_CONTENT.essays.every((row) => row.destinationNodeId === null && row.checkInNodeId === null)).toBe(true);
    expect(DEMO_CONTENT.stalls.every((row) => row.nodeId === null && row.entranceNodeId === null && row.exitNodeId === null)).toBe(true);
    expect(DEMO_CONTENT.events.every((row) => row.nodeId === null)).toBe(true);
  });
  it('retains the four festival tables, all categories and day-specific relationships', () => {
    expect(DEMO_CONTENT.days).toHaveLength(3);
    expect(new Set(DEMO_CONTENT.stalls.map((row) => row.category))).toEqual(new Set(['주점', '부스', '공연', '편의']));
    expect(DEMO_CONTENT.stalls.every((row) => DEMO_CONTENT.days.some((d) => d.id === row.dayId))).toBe(true);
    expect(DEMO_CONTENT.performances.every((row) => DEMO_CONTENT.days.some((d) => d.id === row.dayId))).toBe(true);
  });
  it('does not expose unpublished content or children of an unpublished festival', () => {
    const hidden = publishedContent({ ...DEMO_CONTENT, essays: DEMO_CONTENT.essays.map((r) => ({ ...r, isPublished: false })), festivals: DEMO_CONTENT.festivals.map((r) => ({ ...r, isPublished: false })), events: DEMO_CONTENT.events.map((r) => ({ ...r, isPublished: false })) });
    expect(hidden).toEqual({ essays: [], festivals: [], days: [], stalls: [], performances: [], events: [] });
  });
  it('accepts D SQL snake_case rows without dropping entrance, exit or queue fields', () => {
    const rows: ContentRows = { essay_sessions: [], festivals: [], festival_days: [], festival_performances: [], school_events: [], festival_stalls: [{ id: 'stall', day_id: 'day', name: '부스', category: '부스', building_code: 'A', node_id: 'n_stall', entrance_node_id: 'n_enter', exit_node_id: 'n_exit', opens_at: '16:00', closes_at: '22:00', queue_note: '입구에서 대기', description: null, is_published: true, sort_order: 2 }] };
    const stall = contentFromRows(rows).stalls[0]!;
    expect(stall).toMatchObject({ nodeId: 'n_stall', entranceNodeId: 'n_enter', exitNodeId: 'n_exit', queueNote: '입구에서 대기', opensAt: '16:00', isPublished: true });
    expect(flowDestination(stall, 'enter')).toMatchObject({ fromNodeId: 'n_enter', nodeId: 'n_stall' });
    expect(flowDestination(stall, 'exit')).toMatchObject({ fromNodeId: 'n_stall', nodeId: 'n_exit' });
    expect(hasFlowNodes(stall, 'queue')).toBe(true);
    expect(hasFlowNodes(DEMO_CONTENT.stalls[0]!, 'enter')).toBe(false);
  });
  it('handles empty published data without adding made-up entries', () => {
    const empty = { essays: [], festivals: [], days: [], stalls: [], performances: [], events: [] };
    expect(publishedContent(empty)).toEqual(empty);
  });
});
describe('essay check-in timeline uses Korea time', () => {
  it('does not fabricate a departure time until a route estimate exists', () => {
    const lines = checkInTimeline('2026-11-28', '08:30', null);
    expect(lines[0]).toContain('출발 시각을 추정하지 않습니다');
    expect(lines.join('\n')).toContain('08:00'); expect(lines.join('\n')).toContain('08:20');
  });
  it('subtracts real route duration and rolls over midnight on the prior day', () => {
    const lines = checkInTimeline('2026-11-28', '00:15', 20 * 60);
    expect(lines[0]).toContain('23:25');
    expect(lines[0]).toMatch(/11\D+27/);
    expect(lines[0]).toContain('출발 권장');
  });
  it('does not use the host timezone or accept an invalid check-in time', () => {
    expect(seoulTime('2026-11-28T00:00:00Z')).toContain('09:00');
    expect(checkInTimeline('2026-11-28', null, 300)[0]).toContain('마감 시각이 아직');
    expect(checkInTimeline('2026-11-28', '99:99', 300)[0]).toContain('확인');
  });
});
