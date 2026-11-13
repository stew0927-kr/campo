// Report -> what to do with it (SPEC-v0.2 7.3). Pure: the state, the overrides and the time are arguments.
//   temporary kinds -> overrides.json entries (the map data is not touched)
//   permanent kinds -> one pre-filled edit action built only from packages/core/src/edit actions; the editor runs it with
//                      History.perform, shows the diff, and saves it as a changeset (historyToChangeset).
import type { NodeProperties, Override } from '../types.ts';
import type { Action, EditContext } from '../edit/action.ts';
import { compose } from '../edit/compose.ts';
import { freshId, nodeIdPrefix } from '../edit/ids.ts';
import { elevatorGroups } from '../edit/invariants.ts';
import { attachDoorAction } from '../edit/macros/attachDoor.ts';
import { addNode } from '../edit/actions/addNode.ts';
import { deleteEdges } from '../edit/actions/deleteEdges.ts';
import { moveNode } from '../edit/actions/moveNode.ts';
import { setProps, type PropsPatch } from '../edit/actions/setProps.ts';
import { COLLECTIONS, edgesAt, findFeature, samePosition, scopeOf, scopeOfNode, sortedValues, type EditState } from '../edit/state.ts';
import { duplicateOverride, bundleMembers } from './bundle.ts';
import { REPORT_KIND_INFO, isTemporaryKind, reportSource } from './kinds.ts';
import type { Report } from './types.ts';

export interface PlanOptions {
  /** The clock: decides whether an override is still active and when a new one ends. Never read from the system here. */
  now: Date;
  /** Current overrides.json entries (validated), for the duplicate check. Default []. */
  overrides?: readonly Override[];
  /** Id generator for new Features (new_restroom). */
  ctx: EditContext;
}

interface PlanBase {
  /** Reports the plan handles: the report, or a bundle with its primary first (the changeset's report_ids). */
  reportIds: string[];
}

/** Temporary kinds: entries to add to overrides.json. */
export interface OverridePlan extends PlanBase {
  type: 'override';
  overrides: Override[];
  /** Korean, e.g. "A_elevA 정차 지점 4곳을 2026-11-16T09:00:00.000Z까지 막습니다." */
  summary: string;
}

/** Permanent kinds: one action for History.perform (one history entry, one undo). */
export interface EditPlan extends PlanBase {
  type: 'edit';
  action: Action;
  /** Korean history label, "제보 처리: …". */
  annotation: string;
  /** Features the action changes (for highlighting). */
  featureIds: string[];
  /** Korean. Things the person should look at before saving. */
  warnings: string[];
}

/** A temporary report on a Feature that already has an active override. Mark it duplicate (duplicate_of: report_id). */
export interface DuplicatePlan extends PlanBase {
  type: 'duplicate';
  override: Override;
  reason: string;
}

/** Nothing to change: the data already says what the report says. Mark it already_fixed. */
export interface AlreadyFixedPlan extends PlanBase {
  type: 'already_fixed';
  reason: string;
}

/** A temporary report whose `until` is already past. Mark it expired. */
export interface ExpiredPlan extends PlanBase {
  type: 'expired';
  reason: string;
}

/** The plan cannot be filled in (no feature_id, a Feature that is not there, …). A person edits by hand. */
export interface ManualPlan extends PlanBase {
  type: 'manual';
  reason: string;
}

export type ReportPlan = OverridePlan | EditPlan | DuplicatePlan | AlreadyFixedPlan | ExpiredPlan | ManualPlan;

/** What to do with one report. */
export function planReport(report: Report, state: EditState, options: PlanOptions, reportIds: string[] = [report.id]): ReportPlan {
  const base = { reportIds };
  const manual = (reason: string): ManualPlan => ({ ...base, type: 'manual', reason });
  return isTemporaryKind(report.kind) ? planTemporary(report, state, options, base, manual) : planPermanent(report, state, options, base, manual);
}

/** The plan of a bundle: its primary's plan, for every member (report_ids primary first). */
export function planBundle(reports: readonly Report[], bundleId: string, state: EditState, options: PlanOptions): ReportPlan {
  const members = bundleMembers(reports, bundleId);
  const primary = members[0];
  if (!primary) return { reportIds: [], type: 'manual', reason: `묶음 "${bundleId}"에 제보가 없습니다.` };
  return planReport(primary, state, options, members.map((m) => m.id));
}

// ---- temporary ----

function planTemporary(report: Report, state: EditState, options: PlanOptions, base: PlanBase, manual: (r: string) => ManualPlan): ReportPlan {
  const id = report.feature_id;
  if (id === undefined) return manual('막을 Feature(feature_id)를 골라 주세요.');
  const where = findFeature(state, id);
  if (!where) return manual(`Feature "${id}"이(가) 지도에 없습니다.`);
  if (where.collection !== 'nodes' && where.collection !== 'edges') return manual('지점이나 구간을 골라 주세요(건물·강의실 영역은 막을 수 없습니다).');

  let targets = [id];
  let what = `"${id}"`;
  if (report.kind === 'elevator_out') {
    const elevatorId = elevatorIdOf(state, id);
    if (elevatorId === undefined) return manual('엘리베이터 정차 지점이나 엘리베이터 구간을 골라 주세요.');
    targets = (elevatorGroups(state).get(elevatorId) ?? []).map((n) => n.id);
    what = `엘리베이터 ${elevatorId}의 정차 지점 ${targets.length}곳`;
  }

  const now = options.now.getTime();
  const dup = duplicateOverride(report, options.overrides ?? [], options.now, targets);
  if (dup) return { ...base, type: 'duplicate', override: dup, reason: `"${dup.feature_id}"에 이미 제보 ${dup.report_id}의 override가 ${dup.until}까지 있습니다.` };

  let until: string;
  if (report.until !== undefined) {
    const end = Date.parse(report.until);
    if (Number.isNaN(end)) return manual(`until "${report.until}"을(를) 시각으로 읽을 수 없습니다.`);
    if (end <= now) return { ...base, type: 'expired', reason: `until(${report.until})이 이미 지났습니다.` };
    until = report.until;
  } else {
    until = new Date(now + (REPORT_KIND_INFO[report.kind].defaultHours ?? 24) * 3_600_000).toISOString();
  }
  const overrides = targets.map((feature_id) => ({ feature_id, status: report.kind, until, report_id: report.id }));
  return { ...base, type: 'override', overrides, summary: `${what}을(를) ${until}까지 막습니다.` };
}

function elevatorIdOf(state: EditState, id: string): string | undefined {
  const node = state.nodes[id];
  if (node) return node.props.node_type === 'elevator_stop' ? node.props.elevator_id : undefined;
  const edge = state.edges[id];
  if (!edge || edge.props.highway !== 'elevator') return undefined;
  return state.nodes[edge.props.from]?.props.elevator_id ?? state.nodes[edge.props.to]?.props.elevator_id;
}

/** overrides.json after adding a plan's entries (an entry already there for the same feature and report is not repeated). */
export function addOverrides(existing: readonly Override[], plan: OverridePlan): Override[] {
  const out = existing.map((o) => ({ ...o }));
  for (const o of plan.overrides) {
    if (!out.some((x) => x.feature_id === o.feature_id && x.report_id === o.report_id)) out.push({ ...o });
  }
  return out;
}

// ---- permanent ----

function planPermanent(report: Report, state: EditState, options: PlanOptions, base: PlanBase, manual: (r: string) => ManualPlan): ReportPlan {
  const source = reportSource(report.id);
  const label = `제보 처리: ${REPORT_KIND_INFO[report.kind].label}`;
  const edit = (steps: Action[], warnings: string[] = []): ReportPlan => {
    const action = compose(steps, label);
    const reason = action.disabled(state);
    if (reason !== false) return manual(reason);
    return { ...base, type: 'edit', action, annotation: label, featureIds: changedFeatureIds(state, action.apply(state)), warnings };
  };

  switch (report.kind) {
    case 'step_free_confirmed': {
      const edge = report.feature_id !== undefined ? state.edges[report.feature_id] : undefined;
      if (!edge) return manual('계단·턱이 없다고 확인한 구간(feature_id)을 골라 주세요.');
      if (edge.props.highway === 'steps') return manual('계단·에스컬레이터 구간은 step_free: true로 바꿀 수 없습니다. 구간 종류부터 확인해 주세요.');
      if (edge.props.step_free === true) return { ...base, type: 'already_fixed', reason: `구간 "${edge.id}"은(는) 이미 step_free: true입니다.` };
      return edit([setProps([edge.id], { step_free: true, source })]);
    }
    case 'stairs_unmarked': {
      const edge = report.feature_id !== undefined ? state.edges[report.feature_id] : undefined;
      if (!edge) return manual('계단·턱이 있는 구간(feature_id)을 골라 주세요.');
      if (edge.props.highway === 'steps') return { ...base, type: 'already_fixed', reason: `구간 "${edge.id}"은(는) 이미 계단입니다.` };
      const patch: Record<string, unknown> = { step_free: false, needs_check: true, source };
      const warnings: string[] = [];
      if (edge.props.edge_type === 'outdoor' && (edge.props.highway === 'footway' || edge.props.highway === 'ramp')) {
        patch['highway'] = 'steps';
        if (report.details?.step_count !== undefined) patch['step_count'] = report.details.step_count;
      } else {
        warnings.push('바깥 길이 아니라서 구간 종류는 그대로 두고 step_free만 false로 바꿉니다. 계단이면 계단 도구로 다시 그려 주세요.');
      }
      return edit([setProps([edge.id], patch as PropsPatch)], warnings);
    }
    case 'wrong_room_location':
      return planDoorMove(report, state, options, source, base, edit, manual);
    case 'new_restroom':
      return planRestroom(report, state, options, source, edit, manual);
    default:
      return manual(`처리 방법이 정해지지 않은 제보 종류입니다: ${report.kind}`);
  }
}

type EditFn = (steps: Action[], warnings?: string[]) => ReportPlan;

function planDoorMove(report: Report, state: EditState, options: PlanOptions, source: string, pb: PlanBase, edit: EditFn, manual: (r: string) => ManualPlan): ReportPlan {
  const scope = scopeOf(report.location);
  let doorId = report.feature_id;
  if (doorId === undefined) {
    const ref = report.details?.room_ref;
    if (ref === undefined) return manual('옮길 문(feature_id)이나 호실 번호(details.room_ref)를 알려 주세요.');
    const doors = sortedValues(state.nodes).filter((n) => n.props.node_type === 'door' && n.props.room_ref === ref && scopeOfNode(n) === scope);
    if (doors.length === 0) return manual(`이 층에 ${ref}호 문이 없습니다.`);
    if (doors.length > 1) return manual(`${ref}호 문이 ${doors.length}개라 어느 문인지 골라 주세요(feature_id).`);
    doorId = doors[0]!.id;
  }
  const door = state.nodes[doorId];
  if (!door || door.props.node_type !== 'door') return manual(`문 지점 "${doorId}"이(가) 없습니다.`);
  if (scopeOfNode(door) !== scope) return manual('제보 위치가 문과 다른 층(범위)입니다. 손으로 처리해 주세요.');
  if (samePosition(door.coord, report.location.coord)) return { ...pb, type: 'already_fixed', reason: '문이 이미 제보한 자리에 있습니다.' };

  const move = moveNode(doorId, report.location.coord);
  const mark = setProps([doorId], { source });
  const moved = mark.apply(move.apply(state));
  const links = edgesAt(moved, doorId).map((e) => e.id);
  const unlink = links.length > 0 ? deleteEdges(links, options.ctx) : undefined;
  const unlinked = unlink ? unlink.apply(moved) : moved;
  const attach = attachDoorAction(doorId, { source }, options.ctx);
  if (attach.disabled(unlinked) !== false) {
    return edit([move, mark], ['옮긴 자리 8m 안에 복도가 없어 기존 연결 구간을 그대로 두었습니다. 연결을 손으로 고쳐 주세요.']);
  }
  return edit(unlink ? [move, mark, unlink, attach] : [move, mark, attach]);
}

function planRestroom(report: Report, state: EditState, options: PlanOptions, source: string, edit: EditFn, manual: (r: string) => ManualPlan): ReportPlan {
  const d = report.details ?? {};
  if (d.restroom_gender === undefined) return manual('화장실 종류(details.restroom_gender)를 알려 주세요.');
  const warnings: string[] = [];
  let wheelchair = d.wheelchair ?? 'unknown';
  if (wheelchair === 'yes') {
    wheelchair = 'unknown';
    warnings.push('현장에서 확인하기 전에는 wheelchair: yes를 쓰지 않아 unknown으로 두었습니다.');
  }
  const props: Omit<NodeProperties, 'rev'> = {
    kind: 'node',
    node_type: 'restroom',
    building_id: report.location.building_id,
    level: report.location.level,
    restroom_gender: d.restroom_gender,
    wheelchair,
    ...(d.changing_table !== undefined ? { changing_table: d.changing_table } : {}),
    source,
    needs_check: true,
  };
  const id = freshId(state, options.ctx.ids, nodeIdPrefix(state, props));
  const add = addNode({ id, coord: report.location.coord, props });
  const reason = add.disabled(state);
  if (reason !== false) return manual(reason);
  const attach = attachDoorAction(id, { source }, options.ctx);
  if (attach.disabled(add.apply(state)) !== false) {
    warnings.push('아직 복도와 연결되지 않았어요. 복도를 그리면 자동으로 이어집니다(이어지기 전에는 검사 E10 오류가 납니다).');
    return edit([add], warnings);
  }
  return edit([add, attach], warnings);
}

/** Ids of the Features that differ between two states (Immer keeps unchanged records identical). Buildings by Feature id. */
export function changedFeatureIds(before: EditState, after: EditState): string[] {
  const out = new Set<string>();
  for (const c of COLLECTIONS) {
    const b = before[c] as Record<string, { id: string }>;
    const a = after[c] as Record<string, { id: string }>;
    for (const k of Object.keys(a)) if (a[k] !== b[k]) out.add(a[k]!.id);
    for (const k of Object.keys(b)) if (!(k in a)) out.add(b[k]!.id);
  }
  return [...out].sort();
}
