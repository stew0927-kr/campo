import { describe, expect, it } from 'vitest';
import { DEMO_CONTENT } from '../src/features/content/mock.ts';
import { contentFromRows, type ContentRows } from '../src/features/content/rows.ts';
import { publishedContent } from '../src/features/content/published.ts';
import { selectStalls } from '../src/features/content/selectors.ts';
import { gateDestination, guideFlowDestination } from '../src/features/festival/flow.ts';
import {
  EMPTY_GUIDE, dayLabel, festivalGuide, groupRows, inArea, noticesForDay, shortDate, stallAreas, stallNumber, timetableSlots, won,
} from '../src/features/festival/guide.ts';

describe('festival guide normalisation (optional server column)', () => {
  it('treats a missing, null or non-object guide as empty sections', () => {
    expect(festivalGuide(undefined)).toEqual(EMPTY_GUIDE);
    expect(festivalGuide({ guide: null })).toEqual(EMPTY_GUIDE);
    expect(festivalGuide({ guide: 'oops' as never })).toEqual(EMPTY_GUIDE);
  });
  it('drops malformed parts instead of failing the tab', () => {
    const guide = festivalGuide({ guide: {
      notices: [{ id: 'a', title: '  ' }, { title: '버스 변경', tone: 'weird' }, 7],
      flows: [{ kind: 'teleport', title: 'x' }, { kind: 'queue', title: '대기열' }],
      goods: [{ name: '티셔츠', price: -1 }, { name: '모자', price: 12000, sizes: ['F', 3] }],
      prohibitedItems: ['우산', '', null], wristband: { hours: '  ' },
    } as never });
    expect(guide.notices).toEqual([{ id: 'notice-1', tone: 'info', title: '버스 변경', body: null, dayIds: [] }]);
    expect(guide.flows.map((f) => f.kind)).toEqual(['queue']);
    expect(guide.goods.map((g) => [g.name, g.price, g.sizes])).toEqual([['티셔츠', null, []], ['모자', 12000, ['F']]]);
    expect(guide.prohibitedItems).toEqual(['우산']);
    expect(guide.wristband).toBeNull();
  });
  it('applies day-less notices to every day and day notices only to their day', () => {
    const guide = festivalGuide({ guide: { notices: [{ title: '공통' }, { title: '둘째 날', dayIds: ['d2'] }] } as never });
    expect(noticesForDay(guide, 'd1').map((n) => n.title)).toEqual(['공통']);
    expect(noticesForDay(guide, 'd2').map((n) => n.title)).toEqual(['공통', '둘째 날']);
  });
});

describe('festival example data matches the official notices only', () => {
  const festival = DEMO_CONTENT.festivals[0]!;
  const guide = festivalGuide(festival);
  it('keeps every guide section the notices cover', () => {
    expect(festival.name).toBe('2026 애국한양응원제 : 오름');
    expect(guide.notices[0]?.title).toContain('03-2번 버스');
    expect(guide.zones.map((z) => z.name)).toEqual(['한양존', '프렌즈존']);
    expect(guide.flows.map((f) => f.kind)).toEqual(['queue', 'queue', 'queue', 'evacuation']);
    expect(guide.wristband?.hours).toBe('10:00 ~ 20:00');
    expect(guide.goods[0]).toMatchObject({ name: '축구 유니폼', price: 38000, sizes: ['S', 'M', 'L', 'XL', '2XL', '3XL'] });
    expect(guide.sponsors[0]?.items?.map((i) => i.name)).toEqual(['토마토 마라탕', '사천훠궈마라탕', '마라 비빔']);
    expect(guide.prohibitedItems).toEqual(['카메라', '유리병', '셀카봉', '밀폐되지 않은 음료', '우산', '날카로운 물품', '가연성·폭발성 물질', '주류']);
    // Not in the notices: left empty rather than invented.
    expect(guide.afterCare).toEqual([]); expect(guide.safety).toEqual([]); expect(guide.wristband?.magicPass).toBeNull();
  });
  it('numbers 한마당 booths and pubs like the layout maps, without map pins', () => {
    const day2 = DEMO_CONTENT.stalls.filter((s) => s.dayId === 'orum-day-2');
    expect(day2.filter((s) => s.category === '주점').map(stallNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(day2.filter((s) => s.kind === '학내단체 부스').map(stallNumber)).toEqual([4, 5, 6, 7, 8, 9, 11, 12, 13, 14]);
    expect(DEMO_CONTENT.stalls.every((s) => s.nodeId === null)).toBe(true);
    expect(stallAreas(DEMO_CONTENT, 'orum-day-2')).toEqual(['국제관 옆', '한마당']);
    expect(selectStalls(DEMO_CONTENT, 'orum-day-2', '전체', '').filter((s) => inArea(s, '국제관 옆')).map((s) => s.name)).toEqual(['팔찌 부스', '굿즈 부스']);
  });
  it('groups the DAY 2 line-up into two time slots and four groups', () => {
    const slots = timetableSlots(DEMO_CONTENT.performances.filter((p) => p.dayId === 'orum-day-2'));
    expect(slots.map((s) => s.startsAt)).toEqual(['15:10', '20:00']);
    expect(groupRows(slots[0]!.rows).map((b) => [b.group, b.rows.length])).toEqual([['동아리', 4], ['기획단', 1], ['응원제', 1]]);
    expect(slots[1]!.rows.map((r) => r.artist)).toEqual(['데이먼스 이어', '창모', '다영', 'HIGHLIGHT', 'fromis_9']);
  });
});

describe('festival display helpers and route intents', () => {
  it('formats Korean short dates and day labels from the calendar date', () => {
    expect(shortDate('2026-10-01')).toBe('10/1(목)'); expect(shortDate('2026-11-28')).toBe('11/28(토)'); expect(shortDate('soon')).toBe('soon');
    expect(dayLabel(DEMO_CONTENT.days[1]!, 1)).toBe('DAY 2 · 10/2(금)');
    expect(dayLabel({ ...DEMO_CONTENT.days[0]!, label: null }, 0)).toBe('DAY 1 · 10/1(목)');
    expect(won(38000)).toBe('38,000원'); expect(won(null)).toBeNull();
  });
  it('turns guide flows and gates into searches, not invented pins', () => {
    const guide = festivalGuide(DEMO_CONTENT.festivals[0]);
    const queue = guideFlowDestination(guide.flows[0]!);
    expect(queue).toMatchObject({ nodeId: null, fromNodeId: null, flow: 'queue', searchTerm: '백남학술정보관', kind: 'stage', demo: true });
    expect(guideFlowDestination(guide.flows[3]!, false)).toMatchObject({ flow: 'exit', searchTerm: '노천극장', demo: false });
    expect(gateDestination(guide.gates[2]!)).toMatchObject({ name: '프렌즈존 GATE C', searchTerm: '역사관', nodeId: null });
    expect(guideFlowDestination({ id: 'x', kind: 'enter', title: '입장', nodeId: 'n1', fromNodeId: 'n0' })).toMatchObject({ nodeId: 'n1', fromNodeId: 'n0', flow: 'enter' });
  });
  it('carries the optional stall columns through snake_case rows', () => {
    const rows: ContentRows = { essay_sessions: [], festivals: [], festival_days: [], festival_performances: [], school_events: [], festival_stalls: [{
      id: 's', day_id: 'd', name: 'TIME', category: '주점', building_code: null, node_id: null, entrance_node_id: null, exit_node_id: null, opens_at: null, closes_at: null,
      queue_note: null, description: null, is_published: true, sort_order: 0, area_label: '한마당', map_number: 1, kind: '주점', perks: ['경품'], condition: '팔로우',
    }] };
    expect(contentFromRows(rows).stalls[0]).toMatchObject({ areaLabel: '한마당', mapNumber: 1, perks: ['경품'], condition: '팔로우' });
    expect(publishedContent(DEMO_CONTENT)).toEqual(DEMO_CONTENT);
  });
});
