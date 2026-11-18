// 고도 Δh panel: the rows of the store's Δh edges, and the dirty marks a removal leaves.
import { describe, expect, it } from 'vitest';
import { dirtyCount, emptyDirty, emptyElevationStore, removeEdge, type DhEdge, type ElevationStore, type HeightNode } from '@campo/core/elevation';
import { dhEdgeRows, dirtyAfterEdgeRemoved, localDateTime, mergePhoneStore } from '../src/model/elevation.ts';

const A = { kind: 'outdoor_point', key: 'op:a', position: { lat: 37.5, lng: 127 }, influenceRadiusM: 1, createdAt: 1 } as HeightNode;
const B = { kind: 'floor_plane', key: 'fp:bldg:3F', buildingId: 'bldg', floorId: '3F', createdAt: 1 } as unknown as HeightNode;
const edge = (edgeId: string, from: string, to: string, dhM: number, createdAt: number, qc: DhEdge['qc'] = 'pending', sessionId = 'session-abcdef-1'): DhEdge => ({
  edgeId, from, to, dhM, sigmaM: 0.35, dtS: 30, offsetFromM: 0, offsetToM: 0, sessionId, method: 'static_pair', qc, createdAt,
  model: { tempC: 15, sigmaInstFloorHpa: 0.01, driftHpaPerHour: 0.1 },
}) as unknown as DhEdge;
const store = (edges: DhEdge[]): ElevationStore => ({ ...emptyElevationStore(), nodes: [A, B], edges });

describe('dhEdgeRows', () => {
  it('lists live edges newest first: ends in words, signed Δh, σ, local time, qc badge and a short session', () => {
    const t = new Date(2026, 10, 18, 14, 32).getTime();
    const rows = dhEdgeRows(store([edge('old', 'op:a', 'fp:bldg:3F', 2.44, t - 1000), edge('gone', 'op:a', 'fp:bldg:3F', 9, t, 'superseded'), edge('new', 'fp:bldg:3F', 'op:a', -1.1, t, 'ok')]));
    expect(rows.map((r) => r.edgeId)).toEqual(['new', 'old']);
    expect(rows[0]).toMatchObject({ from: '3층', to: '바깥 지점', dh: '-1.1m', sigma: 'σ 0.35m', at: '2026-11-18 14:32', qc: { key: 'ok', label: '정상' }, session: 'sessio' });
    expect(rows[1]).toMatchObject({ dh: '+2.4m', qc: { key: 'pending', label: '대기' }, fromKey: 'op:a', toKey: 'fp:bldg:3F' });
  });
  it('no store → no rows', () => {
    expect(dhEdgeRows(null)).toEqual([]);
    expect(dhEdgeRows(emptyElevationStore())).toEqual([]);
  });
  it('local date-time pads to two digits', () => {
    expect(localDateTime(new Date(2026, 0, 2, 3, 4).getTime())).toBe('2026-01-02 03:04');
  });
});

describe('removing a Δh edge in the editor', () => {
  it('marks both of its measured heights dirty, so 고도 다시 계산 필요 N곳 grows by two', () => {
    const d = emptyDirty();
    expect(dirtyCount(d)).toBe(0);
    const after = dirtyAfterEdgeRemoved(d, { from: 'op:a', to: 'fp:bldg:3F' });
    expect(dirtyCount(after)).toBe(2);
    expect(dirtyCount(dirtyAfterEdgeRemoved(after, { from: 'op:a', to: 'fp:bldg:3F' }))).toBe(2); // already marked: no double count
    expect(dirtyCount(d)).toBe(0); // the input is not changed
  });

  it('a phone that did not delete the edge brings it back on its next export (same-install replace, the rule that already held)', () => {
    const onPhone = { ...store([edge('e1', 'op:a', 'fp:bldg:3F', 2.4, 5)]), sessions: [{ sessionId: 'session-abcdef-1', installId: 'phone-1', mode: 'static', platform: 'android', startedAt: 1 }] } as unknown as ElevationStore;
    const inEditor = removeEdge(onPhone, 'e1').store;
    expect(inEditor.edges).toHaveLength(0);
    const r = mergePhoneStore(inEditor, onPhone);
    if ('error' in r) throw new Error(r.error);
    expect(r.store.edges.map((e) => e.edgeId)).toEqual(['e1']);
    // …and one the phone deleted too stays gone.
    const phoneAfter = { ...onPhone, edges: [] } as ElevationStore;
    const r2 = mergePhoneStore(onPhone, phoneAfter);
    if ('error' in r2) throw new Error(r2.error);
    expect(r2.store.edges).toHaveLength(0);
  });
});
