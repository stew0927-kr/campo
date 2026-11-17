import { describe, expect, it } from 'vitest';
import { CampusDataError, loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import { META, CORE_FIXTURE_DIR, bundleFrom, bundleOf, fixtureRuntime, nodeFeature } from './helpers.ts';

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

  it('강의실 문(space_name/ref)도 places에 들어가고 호수를 준다', async () => {
    const runtime = await fixtureRuntime();
    const room = runtime.places.find((place) => place.id === 'n_A_4_408door');
    expect(room).toBeDefined();
    expect(room?.name).toBe('408호 강의실');
    expect(room?.nodeType).toBe('door');
    expect(room?.roomRef).toBe('408');
    expect(room?.buildingId).toBe('bldg_A');
    expect(room?.level).toBe(4);
    // 강의실이 아닌 문은 일부러 넣지 않는다.
    expect(runtime.places.filter((place) => place.nodeType === 'door').every((place) => place.roomRef !== undefined)).toBe(true);
  });

  it('room_ref만 있는 문(v0.2 편집기·현장 조사 앱이 만드는 문)도 강의실 문으로 places에 들어간다', () => {
    const runtime = loadBundledCampus(
      bundleFrom(META, [nodeFeature('n_door_v02', 127.0, 37.0, { node_type: 'door', room_ref: '301', door_role: 'front' })]),
    );
    expect(runtime.places).toHaveLength(1);
    const room = runtime.places[0]!;
    expect(room.id).toBe('n_door_v02');
    expect(room.name).toBe('301호');
    expect(room.nodeType).toBe('door');
    expect(room.roomRef).toBe('301');
  });

  it('강의실 참조는 room_ref → ref → space_name 순서, 표시 이름은 name → space_name → <참조>호 순서', () => {
    const runtime = loadBundledCampus(
      bundleFrom(META, [
        nodeFeature('n_both', 127.0, 37.0, { node_type: 'door', room_ref: '302', ref: '999' }),
        nodeFeature('n_space', 127.0001, 37.0, { node_type: 'door', room_ref: '303', ref: '998', space_name: '303호 세미나실' }),
        nodeFeature('n_space_only', 127.0002, 37.0, { node_type: 'door', space_name: '학생회실' }),
        nodeFeature('n_named', 127.0003, 37.0, { node_type: 'door', room_ref: '304', name: '304호 앞문' }),
        nodeFeature('n_empty_ref', 127.0004, 37.0, { node_type: 'door', room_ref: '', ref: '305' }),
        nodeFeature('n_named_plain_door', 127.0005, 37.0, { node_type: 'door', name: '비상문' }),
      ]),
    );
    const byId = Object.fromEntries(runtime.places.map((place) => [place.id, { name: place.name, roomRef: place.roomRef }]));
    expect(byId).toEqual({
      n_both: { name: '302호', roomRef: '302' },
      n_space: { name: '303호 세미나실', roomRef: '303' },
      n_space_only: { name: '학생회실', roomRef: '학생회실' },
      n_named: { name: '304호 앞문', roomRef: '304' },
      n_empty_ref: { name: '305호', roomRef: '305' },
      // 강의실 참조가 없는 문은 이름이 있어도 들어가지 않는다.
    });
  });

  it('이름이 없는 지점은 영어 코드 대신 한국어 종류 이름을 쓴다', () => {
    const runtime = loadBundledCampus(
      bundleFrom(META, [
        nodeFeature('n_poi', 127.0, 37.0, { node_type: 'poi' }),
        nodeFeature('n_wc', 127.0001, 37.0, { node_type: 'restroom' }),
        nodeFeature('n_gate', 127.0002, 37.0, { node_type: 'entrance' }),
        nodeFeature('n_plain', 127.0003, 37.0, { node_type: 'outdoor' }),
        nodeFeature('n_door_plain', 127.0004, 37.0, { node_type: 'door' }),
        nodeFeature('n_door_ref', 127.0005, 37.0, { node_type: 'door', ref: '101' }),
      ]),
    );
    const names = Object.fromEntries(runtime.places.map((place) => [place.id, place.name]));
    expect(names).toEqual({ n_poi: '장소', n_wc: '화장실', n_gate: '출입구', n_door_ref: '101호' });
    expect(runtime.places.some((place) => /^[a-z_]+$/.test(place.name))).toBe(false);
  });
});
