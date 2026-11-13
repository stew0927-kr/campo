// The 에스컬레이터 tool (SPEC-v0.2 2.7): a steps edge with `conveying`, drawn from the lower point to the upper one.
// 상행 = forward, 하행 = backward, 양방향 전환 = reversible, 한 쌍 = two parallel edges between the same two points (forward + backward).
// Outdoors and indoors it is the same data; only the scope differs. step_free is always false (check E12).
import { buildingById, type Conveying, type EditContext, type EditState } from '@campo/core';
import type { CrossEnd } from './cross.ts';
import type { PlanResult, Step } from './plan.ts';
import { floorLabel } from './scope.ts';
import { DRAWN_SOURCE, edgeStep, idMaker, nodeStep, type EdgeProps } from './tools.ts';

export type EscalatorMode = 'up' | 'down' | 'reversible' | 'pair';

export const ESCALATOR_MODES: { id: EscalatorMode; label: string }[] = [
  { id: 'up', label: '상행' },
  { id: 'down', label: '하행' },
  { id: 'reversible', label: '양방향 전환' },
  { id: 'pair', label: '상행+하행 한 쌍' },
];

interface Belt { conveying: Conveying; bidirectional: boolean }
const UP: Belt = { conveying: 'forward', bidirectional: false };
const DOWN: Belt = { conveying: 'backward', bidirectional: false };
const BELT: Record<Exclude<EscalatorMode, 'pair'>, Belt> = { up: UP, down: DOWN, reversible: { conveying: 'reversible', bidirectional: true } };

/**
 * `lowerId` is the first click. The end is the second click (a node, or an empty spot that gets a new node). Drawn from the lower point
 * to the upper one; when the second click is on a lower floor the two swap, so 상행 always goes up.
 */
export function planEscalator(state: EditState, ctx: EditContext, lowerId: string, upper: string | CrossEnd, mode: EscalatorMode): PlanResult {
  const a = state.nodes[lowerId];
  if (!a) return { error: '시작 지점을 찾을 수 없습니다.' };
  const end: CrossEnd = typeof upper === 'string' ? { nodeId: upper } : upper;
  const startBuilding = a.props.building_id;

  let endId: string | undefined;
  let endBuilding: string | null;
  let endLevel: number | null;
  if ('nodeId' in end) {
    const b = state.nodes[end.nodeId];
    if (!b) return { error: '끝 지점을 찾을 수 없습니다.' };
    [endId, endBuilding, endLevel] = [b.id, b.props.building_id, b.props.level];
  } else {
    [endBuilding, endLevel] = [end.buildingId, end.level];
  }
  if (endId === lowerId) return { error: '같은 지점입니다. 다른 지점을 골라 주세요.' };
  if ((startBuilding === null) !== (endBuilding === null)) {
    return { error: '바깥과 건물 안은 에스컬레이터로 바로 잇지 않습니다. 출입구는 출입구 연결 도구로 이어 주세요.' };
  }
  const indoor = startBuilding !== null;
  if (indoor && startBuilding !== endBuilding) return { error: '다른 건물끼리는 연결통로로 이어 주세요. 에스컬레이터는 한 건물 안에서만 만듭니다.' };
  if (indoor) {
    if (endLevel === null) return { error: '끝 지점의 층을 알 수 없습니다.' };
    if (a.props.level === endLevel) return { error: `같은 층(${floorLabel(endLevel)})끼리는 에스컬레이터로 잇지 않습니다. 층이 다른 지점을 골라 주세요.` };
    if (!buildingById(state, startBuilding)?.props.levels.includes(endLevel)) return { error: '이 건물의 층 목록에 없는 층입니다.' };
  }

  const steps: Step[] = [];
  if (endId === undefined) {
    if (!('position' in end)) return { error: '끝 지점을 찾을 수 없습니다.' };
    const type = indoor ? 'corridor' : 'outdoor';
    const here = { building_id: endBuilding, level: endLevel };
    endId = idMaker(state, ctx)({ ...here, node_type: type });
    steps.push(nodeStep(endId, end.position, { kind: 'node', node_type: type, ...here, source: DRAWN_SOURCE }, ctx));
  }

  const swap = indoor && endLevel! < a.props.level!;
  const [from, to] = swap ? [endId, lowerId] : [lowerId, endId];
  const [levelFrom, levelTo] = swap ? [endLevel!, a.props.level!] : [a.props.level!, endLevel!];
  const make = (belt: Belt): EdgeProps => ({
    kind: 'edge', highway: 'steps', edge_type: indoor ? 'indoor' : 'outdoor', step_free: false, from, to, source: DRAWN_SOURCE,
    ...(indoor ? { level_from: levelFrom, level_to: levelTo } : {}),
    ...belt,
  });
  if (mode === 'pair') steps.push(edgeStep(make(UP), ctx), edgeStep(make(DOWN), ctx));
  else steps.push(edgeStep(make(BELT[mode]), ctx));
  const label = ESCALATOR_MODES.find((m) => m.id === mode)!.label;
  return { annotation: `에스컬레이터 추가(${label})`, steps };
}
