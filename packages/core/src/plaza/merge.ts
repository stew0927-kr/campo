// 평지 합치기(merge): 두 평지에서 고른 변(edge) 사이의 다리 영역을 만들어 두 평지를 하나의 평지로 합치는 기하.
// 변의 방향(반시계/시계)이 서로 달라도 선이 꼬이지 않도록 끝점 짝을 골라 다리를 만들고, 두 평지 + 다리의 합집합을
// 구합니다. 결과는 평지 규칙(E16·E17)을 지나야 하고, 구멍은 합친 뒤에도 남습니다.
import { union } from '@turf/union';
import type { FeatureCollection, Polygon } from 'geojson';
import type { Position } from '../types.ts';
import {
  PLAZA_EPS_M,
  closeRingPositions,
  localFrame,
  normalizePlazaRings,
  plazaProblem,
  ringAreaXY,
  ringSelfIntersectsXY,
  type XY,
} from './geometry.ts';

/** A side of a plaza ring: ring 0 is the outer ring, 1 and up are holes. */
export interface PlazaEdgeRef {
  ring: number;
  segment: number;
}

/** The merged rings, or why the two edges cannot be joined (Korean). */
export type PlazaMergeGeometry = { polygon: Position[][] } | { error: string };

const NO_EDGE = '고른 변을 찾을 수 없습니다. 평지의 변을 다시 눌러 주세요.';
const NO_ROOM = '두 변 사이에 채울 공간이 없습니다. 마주 보는 두 변을 골라 주세요.';
const TWISTED = '두 변을 이으면 선이 꼬입니다. 마주 보는 두 변을 골라 주세요.';
const NOT_ONE = '두 평지를 이어도 한 덩어리가 되지 않습니다. 마주 보는 두 변을 골라 주세요.';
/** 평지 합치기의 다리 영역이 가질 수 있는 최소 폭(m): 이보다 얇으면 두 변이 붙아 있는 것입니다. */
export const MIN_BRIDGE_WIDTH_M = 1e-3;

/** The two ends of the side `ref` of these (closed) rings, or null. */
export function edgeEnds(rings: readonly Position[][], ref: PlazaEdgeRef): { a: Position; b: Position } | null {
  const ring = rings[ref.ring];
  if (!ring || !Number.isInteger(ref.segment) || ref.segment < 0) return null;
  const a = ring[ref.segment];
  const b = ring[ref.segment + 1];
  return a && b ? { a, b } : null;
}

const dist = (a: Position, b: Position): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * 다리 영역(두 변과 그 끝을 잇는 두 선분으로 둘러싸인 사각형). 두 변의 진행 방향이 서로 반대일 수도, 같을 수도
 * 있으므로 끝점을 잇는 두 가지 짝을 모두 만들어 보고, 스스로 겹치지 않는 쪽을 고릅니다. 둘 다 되면 잇는 선이
 * 짧은 쪽(자연스러운 사다리꼴)을 고릅니다.
 */
export function bridgeRing(ringsA: readonly Position[][], aRef: PlazaEdgeRef, ringsB: readonly Position[][], bRef: PlazaEdgeRef): Position[] | { error: string } {
  const a = edgeEnds(ringsA, aRef);
  const b = edgeEnds(ringsB, bRef);
  if (!a || !b) return { error: NO_EDGE };
  const frame = localFrame(a.a);
  const xy = (p: Position): XY => frame.toXY(p);
  const candidates: { ring: Position[]; links: number }[] = [
    // a2 → b2, b1 → a1
    { ring: [a.a, a.b, b.b, b.a, a.a], links: dist(a.b, b.b) + dist(b.a, a.a) },
    // a2 → b1, b2 → a1
    { ring: [a.a, a.b, b.a, b.b, a.a], links: dist(a.b, b.a) + dist(b.b, a.a) },
  ];
  const usable = candidates.filter(({ ring }) => {
    const framed = ring.map(xy);
    const area = Math.abs(ringAreaXY(framed));
    let longest = 0;
    for (let i = 0; i + 1 < framed.length; i++) longest = Math.max(longest, Math.hypot(framed[i + 1]![0] - framed[i]![0], framed[i + 1]![1] - framed[i]![1]));
    // A bridge thinner than a millimetre is no space at all (the two sides touch), and a crossed quad is no quad.
    return longest > 0 && area / longest >= MIN_BRIDGE_WIDTH_M && !ringSelfIntersectsXY(framed);
  });
  if (usable.length === 0) return { error: TWISTED };
  usable.sort((x, y) => x.links - y.links);
  const { ring } = usable[0]!;
  if (ringAreaXY(ring.map(xy)) < 0) {
    // Keep the outer ring counter-clockwise, like every plaza ring the state holds.
    ring.reverse();
  }
  return ring.map((p): Position => [p[0], p[1]]);
}

/** A GeoJSON Polygon feature for turf, with the rings closed and oriented the way the state keeps them. */
function polygonOf(rings: Position[][]): Polygon {
  return { type: 'Polygon', coordinates: normalizePlazaRings(rings) };
}

/**
 * 두 평지를, 고른 두 변 사이를 채우며 하나로 합친 결과. 겹침(E18)은 여기서 보지 않습니다: 이 동작 자체가 두 평지를
 * 합치는 것이라 합친 결과가 제3의 평지와 겹치는지는 부르는 쪽(edit action)이 봅니다.
 */
export function mergePlazaPolygons(ringsA: Position[][], aRef: PlazaEdgeRef, ringsB: Position[][], bRef: PlazaEdgeRef): PlazaMergeGeometry {
  const bridge = bridgeRing(ringsA, aRef, ringsB, bRef);
  if ('error' in bridge) return bridge;
  const parts: FeatureCollection<Polygon> = {
    type: 'FeatureCollection',
    features: [polygonOf(ringsA), polygonOf([bridge]), polygonOf(ringsB)].map((geometry) => ({ type: 'Feature', properties: {}, geometry })),
  };
  let combined;
  try {
    combined = union(parts);
  } catch {
    return { error: '두 평지의 모양을 합칠 수 없습니다. 변을 다시 골라 주세요.' };
  }
  if (!combined) return { error: NO_ROOM };
  const geometry = combined.geometry;
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.length === 1 ? geometry.coordinates[0]! : null;
  if (!rings) return { error: NOT_ONE };
  const polygon = normalizePlazaRings(rings.map((ring) => closeRingPositions(ring as Position[])));
  const problem = plazaProblem(polygon);
  return problem ? { error: problem } : { polygon };
}

/**
 * 편집기에서 변을 눌렀을 때 쓰는 값: 닫힌 링 목록(저장된 순서 그대로)과 변 참조. 링 방향은 건드리지 않습니다.
 */
export const closedRings = (rings: readonly Position[][]): Position[][] => rings.map((ring) => closeRingPositions(ring));
