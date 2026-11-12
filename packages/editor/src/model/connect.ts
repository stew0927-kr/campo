// Working in any order (SPEC-v0.2 6.5 "작업 순서와 상관없이 잇기"): a door, restroom or elevator stop may be placed before the corridor.
// This file only READS the state; every change is a core action (addNode, attachDoorAction, ...) in a Plan.
import {
  addedKeys,
  attachDoorAction,
  edgesAt,
  previewAttachDoor,
  type Action,
  type EditContext,
  type EditNode,
  type EditState,
  type Position,
} from '@campo/core';
import { isError, type Plan, type PlanResult, type Step } from './plan.ts';
import { planPath, idMaker, nodeStep, DRAWN_SOURCE, type NodeProps, type OutdoorKind, type PathVertex } from './tools.ts';
import type { Scope } from './scope.ts';

export const NOT_CONNECTED_NOTICE = '아직 복도와 연결되지 않았어요. 복도를 그리면 자동으로 이어집니다';

/** Node types that must hang on a corridor and may be placed before it. */
export const ATTACHABLE_TYPES: readonly string[] = ['elevator_stop', 'restroom', 'door'];

/**
 * Points that have no way to walk to yet: an elevator stop, restroom or door inside a building with no edge except
 * elevator edges (an elevator stop's own ride does not count).
 */
export function unattachedNodes(state: EditState): EditNode[] {
  return Object.values(state.nodes)
    .filter((n) => ATTACHABLE_TYPES.includes(n.props.node_type) && n.props.building_id !== null)
    .filter((n) => edgesAt(state, n.id).every((e) => e.props.highway === 'elevator'))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export const unattachedIds = (state: EditState): Set<string> => new Set(unattachedNodes(state).map((n) => n.id));

/** previewAttachDoor failed only because no corridor is near (not for a scope error or a refused split). */
export function noCorridor(reason: string): boolean {
  return /복도 구간이 없습니다/.test(reason);
}

/**
 * The steps that connect the point `id` (already placed, or placed by an earlier step of the same plan) to a corridor.
 * Connected when the preview succeeds; no corridor in reach is fine (`connected: false`); any other failure is an error.
 */
export function attachSteps(state: EditState, ctx: EditContext, id: string, at: { building_id: string; level: number; coord: Position }): { steps: Step[]; connected: boolean } | { error: string } {
  const pv = previewAttachDoor(state, at.coord, { building_id: at.building_id, level: at.level });
  if (pv.ok) return { steps: [() => attachDoorAction(id, {}, ctx)], connected: true };
  if (noCorridor(pv.reason)) return { steps: [], connected: false };
  return { error: pv.reason };
}

export interface NewPoint {
  position: Position;
  buildingId: string;
  level: number;
  /** Everything but building_id and level. */
  props: Omit<NodeProps, 'building_id' | 'level' | 'kind' | 'source'> & { source?: string };
  annotation: string;
}

/** A door, restroom or other attachable point: addNode, then attachDoorAction when a corridor is in reach (one history entry). */
export function planPointWithAttach(state: EditState, ctx: EditContext, p: NewPoint): PlanResult {
  const props: NodeProps = { kind: 'node', ...p.props, building_id: p.buildingId, level: p.level, source: p.props.source ?? DRAWN_SOURCE };
  const id = idMaker(state, ctx)(props);
  const attach = attachSteps(state, ctx, id, { building_id: p.buildingId, level: p.level, coord: p.position });
  if ('error' in attach) return { error: attach.error };
  return {
    annotation: p.annotation,
    steps: [nodeStep(id, p.position, props, ctx), ...attach.steps],
    ...(attach.connected ? {} : { notices: [NOT_CONNECTED_NOTICE] }),
  };
}

export interface AttachOutcome {
  steps: Step[];
  attached: string[];
  failed: { id: string; reason: string }[];
  /** The state after every attach. */
  state: EditState;
}

/**
 * Try to attach each of `ids` in turn, the way the plan will run them. `edgeIds`: only these corridor edges are candidates
 * (the corridor just drawn); the pieces a split leaves join the set, as roomStrip does.
 */
export function simulateAttach(state: EditState, ctx: EditContext, ids: readonly string[], edgeIds?: ReadonlySet<string>): AttachOutcome {
  let s = state;
  const steps: Step[] = [];
  const attached: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  const allowed = edgeIds ? new Set(edgeIds) : undefined;
  for (const id of ids) {
    const n = s.nodes[id];
    if (!n || n.props.building_id === null || n.props.level === null) {
      failed.push({ id, reason: '건물 안의 지점이 아닙니다.' });
      continue;
    }
    const pv = previewAttachDoor(s, n.coord, { building_id: n.props.building_id, level: n.props.level, ...(allowed ? { edgeIds: allowed } : {}) });
    if (!pv.ok) {
      failed.push({ id, reason: pv.reason });
      continue;
    }
    const action = attachDoorAction(id, allowed ? { edgeIds: new Set(allowed) } : {}, ctx);
    const run = action.run(s);
    if (!run.ok) {
      failed.push({ id, reason: run.reason });
      continue;
    }
    for (const e of addedKeys(s, run.state, 'edges')) allowed?.add(e);
    s = run.state;
    steps.push(() => action as Action);
    attached.push(id);
  }
  return { steps, attached, failed, state: s };
}

/**
 * A drawn path as a plan. Finishing a corridor also attaches the unattached points of its floor within reach of the NEW corridor
 * edges, in the same plan (one Ctrl+Z takes both back).
 */
export function planDrawnPath(state: EditState, ctx: EditContext, vertices: readonly PathVertex[], kind: OutdoorKind, scope: Scope): PlanResult | null {
  const base = planPath(state, ctx, vertices, kind, scope);
  if (base === null || isError(base) || scope.kind !== 'building' || kind !== 'flat') return base;
  // The same action objects go into the plan: an action keeps the ids it drew, so the corridor edges the attach step looks for exist by the same ids when the plan runs.
  let s = state;
  const drawn: Action[] = [];
  for (const step of base.steps) {
    const action = step(s);
    if (!action) continue;
    drawn.push(action);
    s = action.apply(s);
  }
  const added = new Set(addedKeys(state, s, 'edges'));
  const waiting = unattachedNodes(s).filter((n) => n.props.building_id === scope.buildingId && n.props.level === scope.level);
  const sim = simulateAttach(s, ctx, waiting.map((n) => n.id), added);
  if (sim.attached.length === 0) return base;
  return {
    annotation: `${base.annotation}, 지점 ${sim.attached.length}개 잇기`,
    steps: [...drawn.map((a): Step => () => a), ...sim.steps],
    notices: [`지점 ${sim.attached.length}개를 복도에 이었어요`],
  };
}

const TYPE_WORD: Record<string, string> = { door: '문', restroom: '화장실', elevator_stop: '엘리베이터 정차 지점' };

export function pointLabel(n: EditNode): string {
  const p = n.props;
  return `${TYPE_WORD[p.node_type] ?? p.node_type} ${p.room_ref ?? p.name ?? n.id}`;
}

export interface AttachAll {
  plan: Plan | null;
  /** Points that could not be attached, with the reason. */
  failed: { id: string; label: string; reason: string }[];
  /** How many points there were on this floor. */
  total: number;
}

/** "연결 안 된 지점 잇기": every unattached point of the floor, in one plan. Those that cannot be attached are listed with why. */
export function planAttachUnattached(state: EditState, ctx: EditContext, scope: Scope): AttachAll {
  if (scope.kind !== 'building') return { plan: null, failed: [], total: 0 };
  const waiting = unattachedNodes(state).filter((n) => n.props.building_id === scope.buildingId && n.props.level === scope.level);
  const sim = simulateAttach(state, ctx, waiting.map((n) => n.id));
  const failed = sim.failed.map((f) => ({ ...f, label: pointLabel(state.nodes[f.id]!) }));
  return {
    plan: sim.attached.length > 0 ? { annotation: `연결 안 된 지점 ${sim.attached.length}개 잇기`, steps: sim.steps } : null,
    failed,
    total: waiting.length,
  };
}
