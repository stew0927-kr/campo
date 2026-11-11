// Route steps and their Korean sentences (SPEC-v0.2 3.6). Display only: this is
// the one routing file that reads floor numbers (node `level`), to print floor
// names and to pick 올라가세요 / 내려가세요 when an edge has no `incline`. It
// never chooses or connects anything; the route is fixed before it gets here.
import type { CampusGraph, GraphLinkData } from './graph.ts';
import type { EdgeFeature, Level, NodeFeature } from './types.ts';

/** One traversed graph link, with campus node ids in travel direction (a car counts as its stop). */
export interface Leg {
  data: GraphLinkData;
  from: string;
  to: string;
}

export type RouteStepKind = 'walk' | 'ramp' | 'stairs' | 'elevator' | 'bridge' | 'portal';

export interface RouteStep {
  kind: RouteStepKind;
  /** Campus node ids where the step starts and ends. */
  fromNodeId: string;
  toNodeId: string;
  /** Display only: `level` of the start / end node, null outdoors or when unknown. */
  fromLevel: Level | null;
  toLevel: Level | null;
  distanceM: number;
  timeSec: number;
  /** Campus edges walked or ridden in this step, in order. */
  edgeIds: string[];
  /** Korean, polite form. */
  text: string;
}

type Direction = 'up' | 'down' | null;

/**
 * Group the legs of a found route into steps:
 * - board … hops … alight: one 'elevator' step, sentence made at the alight.
 * - consecutive steps edges: one 'stairs' step, as long as no other edge
 *   branches off at the landing in between (in the route's graph).
 * - each bridge or portal edge: its own step.
 * - consecutive plain walking edges ('walk') or ramps ('ramp'): one step each run.
 */
export function buildSteps(g: CampusGraph, legs: readonly Leg[]): RouteStep[] {
  const steps: RouteStep[] = [];
  let i = 0;
  while (i < legs.length) {
    const kind = kindOf(legs[i]!);
    let j = i;
    if (kind === 'elevator') {
      while (j + 1 < legs.length && kindOf(legs[j + 1]!) === 'elevator' && legs[j]!.data.kind !== 'alight') j++;
    } else if (kind === 'stairs') {
      while (j + 1 < legs.length && kindOf(legs[j + 1]!) === 'stairs' && !branchesAt(g, legs[j]!, legs[j + 1]!)) j++;
    } else if (kind === 'walk' || kind === 'ramp') {
      while (j + 1 < legs.length && kindOf(legs[j + 1]!) === kind) j++;
    }
    steps.push(makeStep(g, kind, legs.slice(i, j + 1)));
    i = j + 1;
  }
  return steps;
}

function kindOf(leg: Leg): RouteStepKind {
  const d = leg.data;
  if (d.kind !== 'walk') return 'elevator'; // board, hop, alight (sink never reaches here)
  const { highway, edge_type } = d.edge.properties;
  if (highway === 'steps') return 'stairs';
  if (edge_type === 'bridge') return 'bridge';
  if (edge_type === 'portal') return 'portal';
  if (highway === 'ramp') return 'ramp';
  return 'walk';
}

function edgeOf(leg: Leg): EdgeFeature | null {
  return leg.data.kind === 'walk' || leg.data.kind === 'hop' ? leg.data.edge : null;
}

/** Does any edge other than these two stair edges touch the landing between them? */
function branchesAt(g: CampusGraph, a: Leg, b: Leg): boolean {
  const pass = new Set([edgeOf(a)?.id, edgeOf(b)?.id]);
  for (const link of g.graph.getLinks(a.to) ?? []) {
    const edge = link.data.kind === 'walk' || link.data.kind === 'hop' ? link.data.edge : null;
    if (edge === null || !pass.has(edge.id)) return true; // a board / alight link is a branch too
  }
  return false;
}

function makeStep(g: CampusGraph, kind: RouteStepKind, legs: readonly Leg[]): RouteStep {
  const start = g.nodes.get(legs[0]!.from)!;
  const end = g.nodes.get(legs[legs.length - 1]!.to)!;
  let distanceM = 0;
  let timeSec = 0;
  const edgeIds: string[] = [];
  for (const leg of legs) {
    timeSec += leg.data.timeSec;
    if (leg.data.kind === 'walk') distanceM += leg.data.lengthM;
    const edge = edgeOf(leg);
    if (edge) edgeIds.push(edge.id);
  }
  return {
    kind,
    fromNodeId: start.id,
    toNodeId: end.id,
    fromLevel: levelOf(start),
    toLevel: levelOf(end),
    distanceM: round1(distanceM),
    timeSec: round1(timeSec),
    edgeIds,
    text: sentence(g, kind, legs, start, end, distanceM),
  };
}

function sentence(g: CampusGraph, kind: RouteStepKind, legs: readonly Leg[], start: NodeFeature, end: NodeFeature, distanceM: number): string {
  switch (kind) {
    case 'walk':
      return distanceM < 1 ? '바로 앞으로 이동하세요' : `${Math.round(distanceM)}m 걸어가세요`;
    case 'ramp':
      return `경사로를 따라 ${Math.round(distanceM)}m 가세요`;
    case 'elevator': {
      const floor = floorName(levelOf(end));
      return floor ? `엘리베이터를 타고 ${floor}${ro(floor)} 가세요` : '엘리베이터를 타고 이동하세요';
    }
    case 'stairs':
      return stairsSentence(legs, start, end);
    case 'bridge': {
      const to = place(g, end);
      return `${place(g, start)} 연결통로를 건너 ${to}${ro(to)} 가세요`;
    }
    case 'portal': {
      const fromOutside = !start.properties.building_id;
      const toOutside = !end.properties.building_id;
      if (fromOutside && !toOutside) return `${place(g, end)} 출입구로 들어가세요`;
      if (!fromOutside && toOutside) return `${place(g, start)} 출입구로 나가세요`;
      const to = place(g, end);
      return `${to}${ro(to)} 이동하세요`;
    }
  }
}

/**
 * "계단으로 3층 올라가세요". Direction: the edges' `incline` read in travel
 * direction (SPEC-v0.2 2.6), else the two end floors, else none ("이동하세요").
 * Floors: the gap between the end floors, else one per indoor steps edge
 * (SPEC §3: one indoor steps edge per floor), else no count ("계단을 올라가세요").
 */
function stairsSentence(legs: readonly Leg[], start: NodeFeature, end: NodeFeature): string {
  const a = levelOf(start);
  const b = levelOf(end);
  const edges = legs.map(edgeOf).filter((e): e is EdgeFeature => e !== null);

  let direction: Direction = null;
  const inclines = new Set<Direction>();
  for (const leg of legs) {
    const edge = edgeOf(leg);
    const incline = edge?.properties.incline;
    if (!edge || (incline !== 'up' && incline !== 'down')) continue;
    const along = leg.from === edge.properties.from;
    inclines.add(along ? incline : incline === 'up' ? 'down' : 'up');
  }
  if (inclines.size === 1) direction = [...inclines][0]!;
  else if (a !== null && b !== null && a !== b) direction = b > a ? 'up' : 'down';

  let floors = 0;
  if (a !== null && b !== null) floors = floorGap(a, b);
  else if (edges.length > 0 && edges.every((e) => e.properties.edge_type === 'indoor')) floors = edges.length;

  const verb = direction === 'up' ? '올라가세요' : direction === 'down' ? '내려가세요' : null;
  if (floors > 0) return `계단으로 ${floors}층 ${verb ?? '이동하세요'}`;
  return `계단을 ${verb ?? '이용하세요'}`;
}

/** "A동 3층"; "바깥" outdoors. */
function place(g: CampusGraph, node: NodeFeature): string {
  const id = node.properties.building_id;
  if (id === null || id === undefined) return '바깥';
  const name = g.buildings.get(id)?.properties.name ?? id;
  return [name, floorName(levelOf(node))].filter(Boolean).join(' ');
}

function levelOf(node: NodeFeature): Level | null {
  const level = node.properties.level;
  return typeof level === 'number' && Number.isFinite(level) ? level : null;
}

/** 1 → "1층", -1 → "지하 1층"; empty when unknown. */
function floorName(level: Level | null): string {
  if (level === null) return '';
  return level < 0 ? `지하 ${-level}층` : `${level}층`;
}

/** Floors between two levels; there is no floor 0, so B1 → 1F is one floor. */
function floorGap(a: Level, b: Level): number {
  const diff = Math.abs(b - a);
  return a * b < 0 ? diff - 1 : diff;
}

/** The particle 로 / 으로 after `word` (로 after a vowel or ㄹ). */
function ro(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  if (last >= 0xac00 && last <= 0xd7a3) {
    const final = (last - 0xac00) % 28;
    return final === 0 || final === 8 ? '로' : '으로';
  }
  // Digits read in Korean: 0 영, 3 삼, 6 육 end in a consonant other than ㄹ.
  return '036'.includes(word.at(-1) ?? '') ? '으로' : '로';
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
