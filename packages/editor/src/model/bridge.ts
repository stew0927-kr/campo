// The 연결통로 tool (SPEC-v0.2 5.2.1): one bridge edge between two buildings. Floor numbers may differ (A동 3층 <-> C동 5층):
// routing follows edges, never floor numbers. An empty spot as the end makes a corridor node there first (one Plan = one Ctrl+Z).
import { buildingById, type EditContext, type EditState } from '@campo/core';
import type { CrossEnd } from './cross.ts';
import type { PlanResult, Step } from './plan.ts';
import { DRAWN_SOURCE, edgeStep, idMaker, nodeStep } from './tools.ts';

/**
 * `covered: false` is written only when the person says there is no roof; true or not known leaves the property out
 * (SPEC-v0.2 2.6). building_from / building_to / level_from / level_to come from the two nodes.
 */
export function planBridge(state: EditState, ctx: EditContext, fromId: string, end: string | CrossEnd, opts: { covered?: boolean | null | undefined } = {}): PlanResult {
  const a = state.nodes[fromId];
  if (!a) return { error: '이을 지점을 찾을 수 없습니다.' };
  const target: CrossEnd = typeof end === 'string' ? { nodeId: end } : end;
  if (a.props.building_id === null) return { error: '연결통로는 두 건물 안의 지점을 잇습니다.' };

  const steps: Step[] = [];
  let toId: string;
  let toBuilding: string;
  let toLevel: number;
  if ('nodeId' in target) {
    const b = state.nodes[target.nodeId];
    if (!b) return { error: '이을 지점을 찾을 수 없습니다.' };
    if (b.props.building_id === null || b.props.level === null) return { error: '연결통로는 두 건물 안의 지점을 잇습니다.' };
    [toId, toBuilding, toLevel] = [b.id, b.props.building_id, b.props.level];
  } else {
    if (target.buildingId === null || target.level === null) return { error: '연결통로는 두 건물 안의 지점을 잇습니다. 건물 안쪽을 눌러 주세요.' };
    const building = buildingById(state, target.buildingId);
    if (!building) return { error: '건물 정보를 찾을 수 없습니다.' };
    if (!building.props.levels.includes(target.level)) return { error: '이 건물의 층 목록에 없는 층입니다.' };
    [toBuilding, toLevel] = [building.id, target.level];
    toId = idMaker(state, ctx)({ building_id: toBuilding, level: toLevel, node_type: 'corridor' });
    steps.push(nodeStep(toId, target.position, { kind: 'node', node_type: 'corridor', building_id: toBuilding, level: toLevel, source: DRAWN_SOURCE }, ctx));
  }
  if (toId === fromId) return { error: '같은 지점입니다. 다른 건물의 지점을 골라 주세요.' };
  if (a.props.building_id === toBuilding) return { error: '같은 건물 안은 잇기 도구로 이어 주세요. 연결통로는 다른 건물의 지점과 이어집니다.' };
  if (!buildingById(state, a.props.building_id) || !buildingById(state, toBuilding)) return { error: '건물 정보를 찾을 수 없습니다.' };

  steps.push(edgeStep({
    kind: 'edge', highway: 'corridor', edge_type: 'bridge', step_free: null, from: fromId, to: toId, bidirectional: true,
    building_from: a.props.building_id, building_to: toBuilding, level_from: a.props.level!, level_to: toLevel,
    ...(opts.covered === false ? { covered: false } : {}),
    source: DRAWN_SOURCE,
  }, ctx));
  return { annotation: '연결통로 추가', steps };
}
