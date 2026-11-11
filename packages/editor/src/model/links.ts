// "포탈" and "연결통로" tools (SPEC §8), and property edits from the 속성 tab.
import { FLIGHT_SEC_MAX, FLIGHT_SEC_MIN, type CampoFeature, type EdgeFeature, type Position } from '@campo/core';
import { withFeatures, type CampusDoc } from './document.ts';
import { edgeIdFor, freeId, getBuilding, getNode, tail } from './ids.ts';
import { DRAWN_SOURCE, outdoorId } from './outdoor-path.ts';

type Fail = { error: string };

/** Entrance ↔ outdoor point. step_free is null (not known) until checked on site (SPEC-v0.2 §2.1). */
export function addPortal(doc: CampusDoc, entranceId: string, outdoorId: string): { doc: CampusDoc; id: string } | Fail {
  const entrance = getNode(doc, entranceId);
  const outside = getNode(doc, outdoorId);
  if (!entrance || entrance.properties.node_type !== 'entrance') return { error: '포탈은 건물 출입구에서 시작합니다. 출입구 지점을 먼저 골라 주세요.' };
  if (!outside || outside.properties.building_id !== null) return { error: '이어질 바깥 지점을 골라 주세요.' };
  const linked = [...doc.features.values()].some((f) => f.properties.kind === 'edge' && f.properties.edge_type === 'portal' &&
    [f.properties.from, f.properties.to].includes(entranceId) && [f.properties.from, f.properties.to].includes(outdoorId));
  if (linked) return { error: '이 출입구와 바깥 지점은 이미 포탈로 이어져 있습니다.' };

  const id = freeId(doc.features, `e_portal_${tail(entranceId)}`, '_');
  const edge: EdgeFeature = {
    type: 'Feature',
    id,
    geometry: { type: 'LineString', coordinates: [entrance.geometry.coordinates, outside.geometry.coordinates] },
    properties: {
      kind: 'edge', highway: 'footway', edge_type: 'portal', step_free: null,
      from: entranceId, to: outdoorId, bidirectional: true, source: DRAWN_SOURCE, rev: 1,
    },
  };
  return { doc: withFeatures(doc, [edge]), id };
}

/** Corridor between two buildings (SPEC §4.2 bridge: building_from/to and level_from/to required). */
export function addBridge(doc: CampusDoc, fromId: string, toId: string): { doc: CampusDoc; id: string } | Fail {
  const a = getNode(doc, fromId);
  const b = getNode(doc, toId);
  if (!a || !b) return { error: '이을 지점을 찾을 수 없습니다.' };
  const [pa, pb] = [a.properties, b.properties];
  if (pa.building_id === null || pb.building_id === null) return { error: '연결통로는 두 건물 안의 지점을 잇습니다.' };
  if (pa.building_id === pb.building_id) return { error: '같은 건물 안은 잇기 도구로 이어 주세요.' };
  if (!getBuilding(doc, pa.building_id) || !getBuilding(doc, pb.building_id)) return { error: '건물 정보를 찾을 수 없습니다.' };

  const id = edgeIdFor(doc.features, fromId, toId);
  const edge: EdgeFeature = {
    type: 'Feature',
    id,
    geometry: { type: 'LineString', coordinates: [a.geometry.coordinates, b.geometry.coordinates] },
    properties: {
      kind: 'edge', highway: 'corridor', edge_type: 'bridge', step_free: null,
      from: fromId, to: toId, bidirectional: true,
      building_from: pa.building_id, building_to: pb.building_id, level_from: pa.level!, level_to: pb.level!,
      source: DRAWN_SOURCE, rev: 1,
    },
  };
  return { doc: withFeatures(doc, [edge]), id };
}

/** "지점 추가" outdoors: a plain outdoor point, or a departure/arrival candidate (poi) with a name. */
export function addOutdoorNode(doc: CampusDoc, position: Position, poiName?: string): { doc: CampusDoc; id: string } | Fail {
  const name = poiName?.trim();
  if (poiName !== undefined && !name) return { error: '출발·도착 후보의 이름을 입력해 주세요. 예: 정문, 한양대역 2번 출구' };
  let n = 1;
  for (const id of doc.features.keys()) {
    const m = /^n_out_(\d+)$/.exec(id);
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }
  const id = outdoorId(n);
  const node: CampoFeature = {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [position[0], position[1]] },
    properties: {
      kind: 'node', node_type: name ? 'poi' : 'outdoor', building_id: null, level: null,
      ...(name ? { name } : {}), source: DRAWN_SOURCE, rev: 1,
    },
  };
  return { doc: withFeatures(doc, [node]), id };
}

/** Fields the 속성 tab always shows (SPEC §8). */
export interface CommonEdits {
  /** true: checked on site. false: steps or a sill. null: not known. */
  step_free?: boolean | null;
  /** Indoor steps edges: seconds to climb the flight (0-30). null puts it back to the default. */
  flight_sec?: number | null;
  needs_check?: boolean;
  source?: string;
}

/** Every real change adds 1 to rev (SPEC-v0.2 §2.5); an edit that changes nothing leaves the feature alone. */
export function updateProperties(doc: CampusDoc, id: string, edits: CommonEdits): CampusDoc {
  const f = doc.features.get(id);
  if (!f) return doc;
  const props: Record<string, unknown> = { ...f.properties };
  if (edits.source !== undefined) props['source'] = edits.source;
  if (edits.needs_check !== undefined) {
    if (edits.needs_check) props['needs_check'] = true;
    else delete props['needs_check']; // absent means false; keeps files short
  }
  if (edits.step_free !== undefined && f.properties.kind === 'edge') props['step_free'] = edits.step_free;
  if (edits.flight_sec !== undefined && f.properties.kind === 'edge' && f.properties.highway === 'steps' && f.properties.edge_type === 'indoor') {
    if (edits.flight_sec === null) delete props['flight_sec'];
    else props['flight_sec'] = Math.min(FLIGHT_SEC_MAX, Math.max(FLIGHT_SEC_MIN, Math.round(edits.flight_sec)));
  }
  if (JSON.stringify(props) === JSON.stringify(f.properties)) return doc;
  props['rev'] = f.properties.rev + 1;
  return withFeatures(doc, [{ ...f, properties: props } as unknown as CampoFeature]);
}
