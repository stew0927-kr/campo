import { describe, expect, it } from 'vitest';
import { dhEdgeEnds, floorWord, formatDhM, heightNodeLabel, liveDhEdges, type DhEdge, type ElevationStore, type HeightNode } from '../../src/elevation/index.ts';

const edge = (id: string, createdAt: number, qc: DhEdge['qc'] = 'pending'): DhEdge => ({
  edgeId: id, from: 'op:a', to: 'fp:b:3F', dhM: 1, sigmaM: 0.3, dtS: 60, offsetFromM: 0, offsetToM: 0, sessionId: 's',
  method: 'static_pair', qc, model: { tempC: 15, sigmaInstFloorHpa: 0.03, driftHpaPerHour: 0.3 }, createdAt,
} as unknown as DhEdge);

describe('Δh list rules', () => {
  it('lists live edges newest first and hides superseded ones', () => {
    const store = { edges: [edge('old', 1), edge('gone', 2, 'superseded'), edge('new', 3)] } as unknown as ElevationStore;
    expect(liveDhEdges(store).map((e) => e.edgeId)).toEqual(['new', 'old']);
    expect(store.edges.map((e) => e.edgeId)).toEqual(['old', 'gone', 'new']); // not sorted in place
  });

  it('names nodes: own label, else 층 / 바깥 지점, else unknown', () => {
    const out = { kind: 'outdoor_point', key: 'op:a', position: { lat: 0, lng: 0 }, influenceRadiusM: 1, createdAt: 0 } as HeightNode;
    const floor = { kind: 'floor_plane', key: 'fp:b:3F', buildingId: 'b', floorId: '3F', createdAt: 0 } as unknown as HeightNode;
    expect(heightNodeLabel(out)).toBe('바깥 지점');
    expect(heightNodeLabel(floor)).toBe('3층');
    expect(heightNodeLabel({ ...floor, label: '공학관 3층' } as HeightNode)).toBe('공학관 3층');
    expect(heightNodeLabel({ ...out, label: '  ' } as HeightNode)).toBe('바깥 지점');
    expect(heightNodeLabel(undefined)).toBe('알 수 없는 지점');
    expect(floorWord('B1')).toBe('지하 1층');
    expect(dhEdgeEnds({ nodes: [out, floor] }, edge('x', 0))).toEqual({ from: '바깥 지점', to: '3층' });
  });

  it('writes the height difference with a sign and one decimal, never "-0.0m"', () => {
    expect(formatDhM(2.44)).toBe('+2.4m');
    expect(formatDhM(-1.1)).toBe('-1.1m');
    expect(formatDhM(0)).toBe('+0.0m');
    expect(formatDhM(-0.04)).toBe('+0.0m');
    expect(formatDhM(-0.06)).toBe('-0.1m');
  });
});
