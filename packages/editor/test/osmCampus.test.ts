// 학교 캠퍼스 건물 사전 내장 (osmCampus.ts): the campus area, the school pick, and the embedded Hanyang file.
import { describe, expect, it } from 'vitest';
import type { Position } from '@campo/core';
import { CAMPUS_BUFFER_M, boundsBbox, bufferBbox, campusBuildingsQuery, inBbox, lookupCampusBuilding, pickCampus, schoolWord, universityQuery, type OsmCampusData } from '../src/model/osmCampus.ts';
import { embeddedOsmBuilding } from '../src/model/osmCampusData.ts';
import { planOsmBuilding } from '../src/model/osm.ts';
import { isError, runPlan } from '../src/model/plan.ts';
import hanyang from '../src/data/osm-campus/hanyang-seoul.json';
import { fixtureSession } from './fixture.ts';

describe('campus area', () => {
  it('grows the boundary box by the buffer on every side', () => {
    const box = boundsBbox({ minlon: 127.04, minlat: 37.55, maxlon: 127.05, maxlat: 37.56 });
    const [w, s, e, n] = bufferBbox(box, CAMPUS_BUFFER_M);
    expect(CAMPUS_BUFFER_M).toBe(100);
    expect((37.55 - s) * 111_320).toBeCloseTo(100, 0);
    expect((n - 37.56) * 111_320).toBeCloseTo(100, 0);
    expect((127.04 - w) * 111_320 * Math.cos((37.555 * Math.PI) / 180)).toBeCloseTo(100, 0);
    expect(e).toBeGreaterThan(127.05);
  });

  it('asks for the school by name and for buildings by box (south, west, north, east)', () => {
    expect(schoolWord('한양대학교 서울캠퍼스')).toBe('한양대학교');
    expect(universityQuery('한양대학교 서울캠퍼스')).toContain('["amenity"="university"]["name"~"한양대학교"]');
    expect(campusBuildingsQuery([127, 37, 127.1, 37.1])).toContain('["building"](37,127,37.1,127.1)');
  });

  it('picks the campus asked for among a school\'s university objects', () => {
    const bounds = { minlat: 37, minlon: 127, maxlat: 37.01, maxlon: 127.01 };
    const erica = { type: 'relation', id: 1, tags: { name: '한양대학교 ERICA캠퍼스' }, bounds: { ...bounds, maxlat: 37.5 } };
    const seoul = { type: 'way', id: 2, tags: { name: '한양대학교 서울캠퍼스' }, bounds };
    const plain = { type: 'way', id: 3, tags: { name: '한양대학교' }, bounds: { ...bounds, maxlat: 37.5 } };
    expect(pickCampus([erica, plain, seoul], '한양대학교 서울캠퍼스')).toBe(seoul);
    expect(pickCampus([erica, plain], '한양대학교 서울캠퍼스')).toBe(plain);
    expect(pickCampus([{ type: 'way', id: 4, tags: { name: '다른대학교' }, bounds }], '한양대학교 서울캠퍼스')).toBeNull();
  });
});

describe('embedded Hanyang Seoul file', () => {
  const data = hanyang as unknown as OsmCampusData;
  const named = data.buildings.find((b) => b.name === '국제관')!;
  const inside = (b: typeof named): Position => {
    const [x, y] = b.ring.reduce(([sx, sy], p) => [sx + p[0], sy + p[1]], [0, 0]);
    return [x! / b.ring.length, y! / b.ring.length];
  };

  it('holds the campus buildings with names and floors, boundary plus 100 m', () => {
    expect(data.area).toBe('university-boundary');
    expect(data.bufferM).toBe(100);
    expect(data.buildings.length).toBeGreaterThan(100);
    expect(data.buildings.some((b) => b.levels.some((l) => l < 0))).toBe(true);
    expect(named.levels).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(data.buildings.every((b) => b.ring.some((p) => inBbox(p, data.bbox)))).toBe(true);
  });

  it('answers a click from the file: the building that holds it, nothing for an empty spot, outside for another place', async () => {
    expect(lookupCampusBuilding(data, inside(named))).toMatchObject({ building: { osmId: named.osmId } });
    expect(await embeddedOsmBuilding(inside(named))).toMatchObject({ building: { osmId: named.osmId } });
    expect(await embeddedOsmBuilding([126.9, 37.5])).toEqual({ outside: true });
    expect(lookupCampusBuilding(data, [data.bbox[0] + 1e-5, data.bbox[1] + 1e-5])).not.toHaveProperty('outside');
  });

  it('becomes a normal campo building with the OSM name and floors', async () => {
    const session = fixtureSession();
    const found = await embeddedOsmBuilding(inside(named));
    if (!('building' in found)) throw new Error('no building');
    // The fixture campus is elsewhere, so the outline lands in no existing building.
    const plan = planOsmBuilding(session.history.current(), found.building);
    if (isError(plan)) throw new Error(plan.error);
    expect(runPlan(session.history, plan)).toMatchObject({ ok: true });
    const b = session.history.current().buildings[`OSM${named.osmId}`]!;
    expect(b.props).toMatchObject({ name: '국제관', levels: [1, 2, 3, 4, 5, 6, 7], source: 'osm' });
  });
});
