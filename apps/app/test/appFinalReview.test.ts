import { describe, expect, it } from 'vitest';
import { screenLayout } from '../src/ui/layout.ts';
import { matchesQuery, selectEssays, selectEvents, selectStalls } from '../src/features/content/selectors.ts';
import { DEMO_CONTENT } from '../src/features/content/mock.ts';
import { appReducer, INITIAL_STATE, TABS } from '../src/state/model.ts';
const windows = [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1024, height: 1366 }];
describe('responsive layout policy (native visuals remain unverified)', () => {
  it.each(windows.flatMap((window) => [1, 1.6, 2].map((fontScale) => ({ ...window, fontScale }))))('$width x $height at font $fontScale', (window) => {
    const layout = screenLayout(window.width, window.height, window.fontScale);
    const usable = Math.min(window.width, layout.maxContentWidth);
    expect(usable - 2 * layout.padding).toBeGreaterThan(250);
    expect(usable / TABS.length).toBeGreaterThanOrEqual(44);
    expect(layout.mapHeight).toBeGreaterThanOrEqual(200);
    expect(layout.mapHeight).toBeLessThanOrEqual(440);
    expect(layout.stackActions).toBe(window.width < 380 || window.fontScale > 1.3);
    expect(layout.shortTabLabels).toBe(window.width < 380 || window.fontScale > 1.3);
    expect(layout.tablet).toBe(window.width >= 768);
  });
});
describe('screen search and filter behavior', () => {
  it('normalizes width, case, spacing and multiple words without searching null', () => {
    expect(matchesQuery('  ＣＡＭＰＯ  301 ', ['Campo 강의실', '301호'])).toBe(true);
    expect(matchesQuery('null', [null, undefined, '강의실'])).toBe(false);
    expect(matchesQuery('강의실 401', ['강의실 301'])).toBe(false);
  });
  it('combines essay date, building and room filtering', () => {
    expect(selectEssays(DEMO_CONTENT, '2026-11-28', '오후   402').map((r) => r.id)).toEqual(['demo-exam-2']);
    expect(selectEssays(DEMO_CONTENT, '2026-11-29', '402')).toEqual([]);
  });
  it('combines festival day, category and multiword query', () => {
    expect(selectStalls(DEMO_CONTENT, 'demo-day-0', '부스', '가상 만들기').map((r) => r.id)).toEqual(['demo-stall-2']);
    expect(selectStalls(DEMO_CONTENT, 'demo-day-1', '부스', '만들기')).toEqual([]);
    expect(selectStalls(DEMO_CONTENT, 'demo-day-0', '주점', '만들기')).toEqual([]);
  });
  it('combines event category, title and host and sorts actual instants', () => {
    expect(selectEvents(DEMO_CONTENT, '강연', '가상 학술팀').map((r) => r.id)).toEqual(['demo-event-2']);
    expect(selectEvents(DEMO_CONTENT, '입학', '특강')).toEqual([]);
    const event = DEMO_CONTENT.events[1]!;
    const data = { ...DEMO_CONTENT, events: [{ ...event, id: 'later', startsAt: '2026-11-26T09:00:00Z' }, { ...event, id: 'earlier', startsAt: '2026-11-26T17:00:00+09:00' }] };
    expect(selectEvents(data, '전체', '').map((r) => r.id)).toEqual(['earlier', 'later']);
  });
  it('navigates every tab and clears stale estimates when walking preferences change', () => {
    for (const tab of TABS) expect(appReducer(INITIAL_STATE, { type: 'tab', tab }).tab).toBe(tab);
    let state = appReducer(INITIAL_STATE, { type: 'estimate', nodeId: 'room', timeSec: 120 });
    state = appReducer(state, { type: 'mode', mode: 'wheelchair' });
    expect(state.lastEstimate).toBeNull(); expect(state.defaultMode).toBe('wheelchair');
  });
});
