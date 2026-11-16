// 번들된 캠퍼스 파일을 읽어 길찾기 그래프와 GPS 매칭 망까지 만든다. 화면·React와 상관없는 순수 함수라
// Node에서 그대로 테스트한다(test/loadBundledCampus.test.ts).
import { buildGraph, buildMatchNetwork, parseCampus, type Position } from '@campo/core';
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
    const named = typeof props.name === 'string' && props.name !== '';
    if (!named && props.node_type !== 'poi' && props.node_type !== 'entrance' && props.node_type !== 'restroom') continue;
    const [lng, lat] = node.geometry.coordinates as Position;
    places.push({
      id: node.id,
      name: named ? props.name! : `${props.node_type}`,
      nodeType: props.node_type,
      buildingId: props.building_id ?? null,
      level: props.level ?? null,
      lat,
      lng,
    });
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
