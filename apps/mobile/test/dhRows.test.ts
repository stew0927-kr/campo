import { describe, expect, it } from 'vitest';
import { floorNodeKey, outdoorNodeKey, type DhEdge, type ElevationStore } from '@campo/core/elevation';
import { dhRows, measuredAtText } from '../src/survey/dhRows.ts';

const A = outdoorNodeKey('A');
const B = floorNodeKey('bldg_A', '3F');
const edge = (edgeId: string, from: string, to: string, dhM: number, createdAt: number, qc: DhEdge['qc'] = 'pending'): DhEdge =>
  ({ edgeId, from, to, dhM, sigmaM: 0.3, dtS: 60, offsetFromM: 0, offsetToM: 0, sessionId: 's', method: 'static_pair', qc, createdAt, model: { tempC: 15, sigmaInstFloorHpa: 0.03, driftHpaPerHour: 0.3 } }) as unknown as DhEdge;
const store = {
  nodes: [
    { kind: 'outdoor_point', key: A, position: { lat: 37, lng: 127 }, influenceRadiusM: 1, createdAt: 0 },
    { kind: 'floor_plane', key: B, buildingId: 'bldg_A', floorId: '3F', createdAt: 0 },
  ],
  edges: [edge('e1', A, B, 2.44, new Date(2026, 10, 17, 9, 5).getTime()), edge('e2', B, A, -1.1, new Date(2026, 10, 18, 14, 32).getTime()), edge('e3', A, B, 9, 1, 'superseded')],
} as unknown as ElevationStore;

describe('저장된 높이 차 rows', () => {
  it('lists the live edges newest first with names, signed Δh and local time', () => {
    const now = new Date(2026, 10, 18, 18, 0).getTime();
    expect(dhRows(store, now)).toEqual([
      { edgeId: 'e2', from: '3층', to: '바깥 지점', dh: '-1.1m', at: '오늘 14:32' },
      { edgeId: 'e1', from: '바깥 지점', to: '3층', dh: '+2.4m', at: '11-17 09:05' },
    ]);
  });
  it('adds the year when the measurement is from another year', () => {
    expect(measuredAtText(new Date(2025, 11, 31, 23, 59).getTime(), new Date(2026, 0, 2).getTime())).toBe('2025-12-31 23:59');
  });
});
