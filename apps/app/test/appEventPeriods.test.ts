import { describe, expect, it, vi } from 'vitest';
import { eventSections, selectEvents } from '../src/features/content/selectors.ts';
import { DEMO_CONTENT } from '../src/features/content/mock.ts';
import { openPublicLink, publicLink } from '../src/ui/external.ts';
const now = Date.parse('2026-11-20T12:00:00+09:00');
describe('event periods and source links', () => {
  it('combines upcoming, category and text without changing the source', () => {
    const data = { ...DEMO_CONTENT, events: [DEMO_CONTENT.events[1]!, { ...DEMO_CONTENT.events[1]!, id: 'past', startsAt: '2026-11-19T12:00:00+09:00' }] };
    expect(selectEvents(data, '강연', '학술팀', '다가오는 행사', now).map((x) => x.id)).toEqual(['demo-event-2']);
    expect(selectEvents(data, '강연', '학술팀', '전체', now)).toHaveLength(2);
    expect(selectEvents(data, '입학', '학술팀', '다가오는 행사', now)).toEqual([]);
    expect(data.events).toHaveLength(2);
  });
  it('groups pinned, next seven days, current month, future and past using Korea dates', () => {
    const row = DEMO_CONTENT.events[1]!;
    const events = [
      { ...row, id: 'past', startsAt: '2026-11-18T22:00:00+09:00' },
      { ...row, id: 'week', startsAt: '2026-11-22T11:00:00+09:00' },
      { ...row, id: 'month', startsAt: '2026-11-29T11:00:00+09:00' },
      { ...row, id: 'future', startsAt: '2026-12-20T11:00:00+09:00' },
      { ...row, id: 'pinned', pinned: true, startsAt: '2026-11-22T11:00:00+09:00' },
    ];
    expect(eventSections(events, now).map((s) => [s.title, s.data[0]?.id])).toEqual([['고정 공지', 'pinned'], ['이번 주', 'week'], ['이번 달', 'month'], ['이후 행사', 'future'], ['지난 행사', 'past']]);
  });
  it('allows empty upcoming results and recovers the full demo without moving its dates', () => {
    expect(selectEvents(DEMO_CONTENT, '전체', '', '다가오는 행사', Date.parse('2027-01-01T00:00:00+09:00'))).toEqual([]);
    expect(selectEvents(DEMO_CONTENT, '전체', '', '전체', Date.parse('2027-01-01T00:00:00+09:00'))).toHaveLength(7);
    expect(DEMO_CONTENT.events.some((x) => x.category === '공지' && x.pinned)).toBe(true);
  });
  it('opens valid external source URLs and reports failure without inventing an URL', async () => {
    const open = vi.fn(async (_url: string) => undefined);
    expect(await openPublicLink('https://example.test/source', open)).toBeNull();
    expect(open).toHaveBeenCalledWith('https://example.test/source');
    expect(await openPublicLink(null, open)).toContain('없습니다');
    expect(await openPublicLink('https://example.test/source', async () => { throw Error('offline'); })).toContain('열지 못했습니다');
    for (const url of ['javascript:alert(1)', 'http://example.test', 'https://user:password@example.test', 'bad']) expect(publicLink(url)).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
  });
});
