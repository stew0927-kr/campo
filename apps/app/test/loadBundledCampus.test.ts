import { describe, expect, it } from 'vitest';
import { CampusDataError, loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import { CORE_FIXTURE_DIR, bundleOf, fixtureRuntime } from './helpers.ts';

describe('loadBundledCampus', () => {
  it('번들을 그래프·GPS 망·화면용 목록으로 읽는다', async () => {
    const runtime = await fixtureRuntime();

    expect(runtime.info.id).toBe('fixture-basic');
    expect(runtime.info.name).toBeTruthy();
    expect(runtime.info.center.lng).toBeGreaterThan(126);
    expect(runtime.info.center.lat).toBeGreaterThan(36);
    expect(runtime.counts.nodes).toBeGreaterThan(0);
    expect(runtime.counts.edges).toBeGreaterThan(0);
    expect(runtime.counts.buildings).toBeGreaterThanOrEqual(3);

    // 같은 그래프에서 만든 GPS 매칭 망
    expect(runtime.network.nodeIds.length).toBeGreaterThan(0);
    expect(runtime.network.edgeIds.length).toBeGreaterThan(0);

    // 화면이 바로 쓸 수 있는 목록
    expect(runtime.places.some((place) => place.id === 'n_out_0001')).toBe(true);
    expect(runtime.places[0]?.lat).toBeTypeOf('number');
    expect(runtime.buildings.map((building) => building.id)).toContain('bldg_A');
    expect(runtime.buildings.every((building) => building.levels.length > 0)).toBe(true);
  });

  it('campus.json이 없으면 화면에 보여 줄 한국어 오류를 던진다', () => {
    expect(() => loadBundledCampus({ campus: 'none', files: [] })).toThrow(CampusDataError);
    expect(() => loadBundledCampus({ campus: 'none', files: [] })).toThrow('캠퍼스 데이터를 읽을 수 없습니다');
  });

  it('GeoJSON만 있고 campus.json이 없어도 같은 오류다', async () => {
    const bundle = await bundleOf(CORE_FIXTURE_DIR);
    expect(() => loadBundledCampus({ campus: 'x', files: bundle.files.filter((file) => file.path !== 'campus.json') })).toThrow(CampusDataError);
  });

  it('아직 지점이 없는 캠퍼스(현재 data/campuses 상태)도 오류 없이 읽는다', () => {
    const runtime = loadBundledCampus({
      campus: 'hanyang-seoul',
      files: [
        { path: 'campus.json', text: JSON.stringify({ id: 'hanyang-seoul', schema_version: '0.2', name: '한양대학교 서울캠퍼스', center: [127.045, 37.5572], bbox: [127.0395, 37.553, 127.0505, 37.5615] }) },
        { path: 'outdoor.geojson', text: JSON.stringify({ type: 'FeatureCollection', features: [] }) },
      ],
    });
    expect(runtime.counts).toEqual({ nodes: 0, edges: 0, buildings: 0 });
    expect(runtime.places).toEqual([]);
    expect(runtime.network.nodeIds).toEqual([]);
  });
});
