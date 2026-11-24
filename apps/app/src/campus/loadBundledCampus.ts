// 번들된 캠퍼스 파일을 읽어 길찾기 그래프와 GPS 매칭 망까지 만든다. 화면·React와 상관없는 순수 함수라
// Node에서 그대로 테스트한다(test/loadBundledCampus.test.ts).
import { buildGraph, buildMatchNetwork, parseCampus, type NodeFeature, type Position } from '@campo/core';
import type { CampusBuilding, CampusPlace, CampusSummary } from '../contracts.ts';
import type { BundledCampus, CampusRuntime } from './types.ts';

/** 앱에 든 캠퍼스 데이터를 쓸 수 없을 때. message는 화면에 그대로 보여 줄 수 있는 한국어다. */
export class CampusDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampusDataError';
  }
}

function kindOf(feature: unknown): string | null {
  const kind = (feature as { properties?: { kind?: unknown } } | null)?.properties?.kind;
  return typeof kind === 'string' ? kind : null;
}

/** 이름이 없는 지점을 화면에 보일 때 쓰는 한국어 종류 이름. */
const TYPE_LABEL: Readonly<Record<string, string>> = {
  poi: '장소',
  entrance: '출입구',
  restroom: '화장실',
};

const nonEmpty = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/**
 * 문 지점의 강의실 참조(호수). 강의실 문이 아니면(문이 아니거나 참조가 하나도 없으면) null.
 * v0.2 데이터(편집기 문 놓기 도구·현장 조사 앱)는 `room_ref`만 쓰므로 그것을 먼저 보고, 예전 데이터의 `ref`,
 * 마지막으로 `space_name` 순서로 고른다. 코어의 isClassroomDoor는 ref·space_name만 보므로 앱에서는 이 함수를 쓴다.
 */
export function classroomRefOf(node: NodeFeature): string | null {
  const props = node.properties;
  if (props.node_type !== 'door') return null;
  return nonEmpty(props.room_ref) ?? nonEmpty(props.ref) ?? nonEmpty(props.space_name);
}

/**
 * 지도 목록에 올릴 지점의 화면 이름. 올리지 않을 지점(이름 없는 복도·계단 등)이면 null.
 * - 이름(name)이 있으면 그대로.
 * - 강의실 문(classroomRefOf가 참조를 주는 문)은 space_name, 없으면 `<참조>호`.
 * - 이름 없는 장소·출입구·화장실은 건물 이름을 붙인 한국어 종류 이름(영어 코드를 그대로 보이지 않는다).
 */
function placeName(node: NodeFeature, buildingName: string | undefined): string | null {
  const props = node.properties;
  const roomRef = classroomRefOf(node);
  // 강의실이 아닌 문은 이름이 있어도 올리지 않는다(contracts.ts CampusPlace: places의 문은 모두 roomRef가 있다).
  if (props.node_type === 'door' && roomRef === null) return null;
  const name = nonEmpty(props.name);
  if (name !== null) return name;
  if (roomRef !== null) return nonEmpty(props.space_name) ?? `${roomRef}호`;
  const label = TYPE_LABEL[props.node_type];
  if (label === undefined) return null;
  return buildingName ? `${buildingName} ${label}` : label;
}

export function loadBundledCampus(bundle: BundledCampus, options: { now?: Date } = {}): CampusRuntime {
  const files = Array.isArray(bundle.files) ? bundle.files : [];
  const loaded = parseCampus(files);
  const meta = loaded.meta as { id?: unknown; name?: unknown; center?: unknown; bbox?: unknown } | undefined;
  if (!meta || typeof meta.id !== 'string' || !Array.isArray(meta.center) || meta.center.length < 2) {
    throw new CampusDataError('캠퍼스 데이터를 읽을 수 없습니다. 앱에 campus.json이 들어 있지 않거나 형식이 다릅니다.');
  }
  const center = meta.center as [number, number];
  const bbox = Array.isArray(meta.bbox) && meta.bbox.length === 4 ? (meta.bbox as [number, number, number, number]) : null;

  const graph = buildGraph(loaded, options.now !== undefined ? { now: options.now } : {});
  const network = buildMatchNetwork(graph);

  let edges = 0;
  for (const { feature } of loaded.features) if (kindOf(feature) === 'edge') edges++;

  const info: CampusSummary = {
    id: meta.id,
    name: typeof meta.name === 'string' ? meta.name : meta.id,
    center: { lat: center[1], lng: center[0] },
    bbox,
  };

  const places: CampusPlace[] = [];
  for (const node of graph.nodes.values()) {
    const props = node.properties;
    const name = placeName(node, graph.buildings.get(props.building_id ?? '')?.properties.name);
    if (name === null) continue;
    const [lng, lat] = node.geometry.coordinates as Position;
    const place: CampusPlace = {
      id: node.id,
      name,
      nodeType: props.node_type,
      buildingId: props.building_id ?? null,
      level: props.level ?? null,
      lat,
      lng,
    };
    const roomRef = classroomRefOf(node);
    if (roomRef !== null) place.roomRef = roomRef;
    if (props.node_type === 'restroom' && props.restroom_gender !== undefined && props.restroom_gender !== null) place.restroomGender = props.restroom_gender;
    places.push(place);
  }
  places.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));

  const buildings: CampusBuilding[] = [];
  for (const building of graph.buildings.values()) {
    buildings.push({ id: building.id, name: building.properties.name, levels: [...building.properties.levels] });
  }
  buildings.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));

  const issues = [
    ...loaded.fileErrors.map((e) => `${e.file}: ${e.message}`),
    ...graph.warnings,
  ];

  return {
    info,
    graph,
    network,
    counts: { nodes: graph.nodes.size, edges, buildings: graph.buildings.size },
    places,
    buildings,
    issues,
  };
}
