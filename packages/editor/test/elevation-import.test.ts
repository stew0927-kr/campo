// The survey app's elevation_store.json merged into the campus's elevation store (현장 기록 불러오기).
import { describe, expect, it } from 'vitest';
import { emptyElevationStore, type BreakLine, type DhEdge, type EdgeId, type ElevationStore, type HeightNode, type MeasurementSession } from '@campo/core/elevation';
import { mergePhoneStore } from '../src/model/elevation.ts';

const session = (sessionId: string, installId: string): MeasurementSession =>
  ({ sessionId, installId, mode: 'static', platform: 'android', startedAt: 1 }) as MeasurementSession;
const node = (key: string): HeightNode => ({ kind: 'outdoor_point', key, position: { lat: 37.5, lng: 127 }, influenceRadiusM: 1, createdAt: 1 }) as HeightNode;
const edge = (edgeId: string, from: string, to: string, sessionId: string, dhM = 1): DhEdge => ({
  edgeId, from, to, dhM, sigmaM: 0.1, dtS: 30, offsetFromM: 0, offsetToM: 0, sessionId, method: 'static_pair', qc: 'pending',
  model: { tempC: 15, sigmaInstFloorHpa: 0.01, driftHpaPerHour: 0.1 },
}) as DhEdge;
const store = (part: Partial<ElevationStore>): ElevationStore => ({ ...emptyElevationStore(), ...part });

describe('mergePhoneStore', () => {
  it('into an empty store: the phone’s store as it is, every height variable it touches marked', () => {
    const phone = store({ nodes: [node('op:a'), node('op:b')], sessions: [session('s1', 'phone-1')], edges: [edge('e1', 'op:a', 'op:b', 's1')] });
    const r = mergePhoneStore(emptyElevationStore(), phone);
    if ('error' in r) throw new Error(r.error);
    expect(r.store.edges).toEqual(phone.edges);
    expect(r.store.nodes).toEqual(phone.nodes);
    expect([...r.heightNodes].sort()).toEqual(['op:a', 'op:b']);
    expect(r.changed).toBe(true);
  });

  it('a later export of the same phone replaces what that phone brought before (a deleted or superseded Δh stays gone), other phones and drawn lines stay', () => {
    const drawn = { id: 'bl-1', coordinates: [{ lat: 37.5, lng: 127 }, { lat: 37.5001, lng: 127 }], source: 'manual', createdAt: 1 } as BreakLine;
    const before = store({
      nodes: [node('op:a'), node('op:b'), node('op:c'), node('op:x'), node('op:y')],
      sessions: [session('s1', 'phone-1'), session('s9', 'phone-2')],
      edges: [edge('e1', 'op:a', 'op:b', 's1'), edge('e2', 'op:b', 'op:c', 's1'), edge('e9', 'op:x', 'op:y', 's9')],
      breaklines: [drawn],
    });
    // phone-1 deleted spot op:c (and e2), and measured a → b again (e3 supersedes e1).
    const phone = store({
      nodes: [node('op:a'), node('op:b')], sessions: [session('s1', 'phone-1'), session('s2', 'phone-1')],
      edges: [{ ...edge('e3', 'op:a', 'op:b', 's2', 1.2), supersedes: ['e1' as EdgeId] }],
    });
    const r = mergePhoneStore(before, phone);
    if ('error' in r) throw new Error(r.error);
    expect(r.store.edges.map((e) => e.edgeId).sort()).toEqual(['e3', 'e9']);
    expect(r.store.sessions.map((s) => s.sessionId).sort()).toEqual(['s1', 's2', 's9']);
    expect(r.store.nodes.map((n) => n.key).sort()).toEqual(['op:a', 'op:b', 'op:x', 'op:y']);
    expect(r.store.breaklines).toEqual([drawn]);
    expect([...r.heightNodes].sort()).toEqual(['op:a', 'op:b', 'op:c']);
  });

  it('the same export again changes nothing', () => {
    const phone = store({ nodes: [node('op:a'), node('op:b')], sessions: [session('s1', 'phone-1')], edges: [edge('e1', 'op:a', 'op:b', 's1')] });
    const once = mergePhoneStore(emptyElevationStore(), phone);
    if ('error' in once) throw new Error(once.error);
    const twice = mergePhoneStore(once.store, phone);
    if ('error' in twice) throw new Error(twice.error);
    expect(twice.changed).toBe(false);
    expect(twice.heightNodes.size).toBe(0);
  });

  it('refuses a file that is not an elevation store, another height datum, or absolute pressures', () => {
    expect(mergePhoneStore(emptyElevationStore(), '{"schemaVersion":2}')).toMatchObject({ error: expect.stringContaining('고도') });
    expect(mergePhoneStore(emptyElevationStore(), 'nope')).toMatchObject({ error: expect.stringContaining('JSON') });
    expect(mergePhoneStore(emptyElevationStore(), JSON.stringify({ ...emptyElevationStore(), verticalDatum: 'WGS84_ELLIPSOID' }))).toMatchObject({ error: expect.stringContaining('높이 기준') });
    expect(mergePhoneStore(emptyElevationStore(), JSON.stringify({ ...emptyElevationStore(), x: { pressureHpa: 1000 } }))).toMatchObject({ error: expect.stringContaining('기압') });
  });
});
