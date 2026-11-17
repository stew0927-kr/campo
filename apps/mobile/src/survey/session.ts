// One survey walk: the edit history, where the surveyor is, and what was photographed and measured.
// No React and no device API in here, so the whole walk can be tested in Node.
import {
  ACCESS_PROPS,
  accessPatch,
  applyChangeset,
  buildSurvey,
  changeIdOf,
  checkChangeset,
  compose,
  createHistory,
  featuresById,
  findFeature,
  historyToChangeset,
  sameFeature,
  setProps,
  surveyId,
  type AccessInfo,
  type Action,
  type Changeset,
  type EditContext,
  type EditState,
  type History,
  type IdGen,
  type PhotoMeta,
  type Survey,
  type SurveyAttachment,
  type SurveyTiming,
  type VerticalMeasurement,
} from '@campo/core';
import { OUTDOOR, type Scope } from '../model/scope.ts';
import { dayOf } from '../time.ts';
import { withSyncMirror } from './floors.ts';
import type { PlanOk } from './plans.ts';
import { recentPressure, withinPressureWindow, storedHeading, storedPhotoHeading, storedPressure, verticalMeasurement, type PressureReading } from './readings.ts';

export const SNAPSHOT_VERSION = 1;
/** A stopwatch time shorter than this is a slip of the finger, not a ride. */
export const MIN_TIMING_SEC = 1;

/** What is kept on the phone between app starts. The map changes are a changeset against the bundled campus. */
export interface SessionSnapshot {
  version: typeof SNAPSHOT_VERSION;
  campus: string;
  /** ISO 8601 with offset: when the walk began. */
  startedAt: string;
  changeset: Changeset | null;
  anchorId: string | null;
  scope: Scope;
  attachments: Record<string, SurveyAttachment>;
  vertical: VerticalMeasurement[];
  /** Stopwatch times (escalator rides). Older snapshots have none. */
  timings?: SurveyTiming[];
  /** Photos taken so far (their names are numbered, and a number is never used twice). */
  photoSeq: number;
}

interface Place {
  anchorId: string | null;
  scope: Scope;
  /** Whether the record that led here changed the map (and so has a history entry to undo). */
  edited: boolean;
  /** The pressure read where the surveyor stands, for the height of the next stretch. null when none was read. */
  pressure: PressureReading | null;
}

/** The walk as it was before a record: undo puts all of it back. Attachments and measurements are never changed in place. */
interface Step {
  place: Place;
  attachments: Record<string, SurveyAttachment>;
  measurements: VerticalMeasurement[];
  timings: SurveyTiming[];
}

/** What the sensors and the camera gave for one record. */
export interface Readings {
  /** ISO 8601 with offset. */
  at: string;
  /** Air pressure now; null without a barometer. */
  pressureHpa: number | null;
  /** Compass heading now; null without one. */
  headingDeg: number | null;
  /** 계단/EV: the pressures read on purpose when leaving and on arriving. */
  trip?: { startHpa: number | null; endHpa: number | null; /** When the start was read; a trip longer than the pressure window gives no height. */ startAt?: string };
  /** Pictures taken for the record. */
  photos?: number;
  /** The direction each picture looks (degrees, 0 up to 360), in the order of the pictures; null where none was set. */
  photoHeadings?: (number | null)[];
}

export interface SessionInit {
  campus: string;
  /** The campus as bundled into the app. */
  base: EditState;
  ids: IdGen;
  startedAt: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether every field restore reads has the type it is written with (a hand-edited or damaged file may not). */
function snapshotShapeOk(s: SessionSnapshot): boolean {
  const v = s as unknown as Record<string, unknown>;
  const scope = v['scope'];
  const scopeOk = isRecord(scope) && (scope['kind'] === 'outdoor' ||
    (scope['kind'] === 'building' && typeof scope['buildingId'] === 'string' && Number.isFinite(scope['level'])));
  const seq = v['photoSeq'];
  return typeof v['startedAt'] === 'string' &&
    (v['changeset'] === null || isRecord(v['changeset'])) &&
    (v['anchorId'] === null || typeof v['anchorId'] === 'string') &&
    scopeOk &&
    isRecord(v['attachments']) &&
    Array.isArray(v['vertical']) &&
    (v['timings'] === undefined || Array.isArray(v['timings'])) &&
    typeof seq === 'number' && Number.isInteger(seq) && seq >= 0;
}

/** What restore did to a saved walk whose map changes no longer fit the bundled campus as a whole. */
export interface RestoreRebase {
  /** Changes the bundled campus already has (an earlier export of this walk was imported and the app re-bundled). */
  alreadyIn: number;
  /** Changes that conflict with the bundled campus (the same place was edited in the editor), left out. Their ids. */
  dropped: string[];
}

/**
 * The changes of `cs` that still fit `base`: those `base` already holds are left out, then the ones that conflict (and
 * the ones that only made sense with them, such as an edge to a dropped point) are dropped until the rest applies.
 * Returns null changes when nothing is left to apply.
 */
export function rebaseChangeset(base: EditState, cs: Changeset): { changeset: Changeset | null; alreadyIn: number; dropped: string[] } {
  const now = featuresById(base);
  const fresh = cs.changes.filter((c) => {
    if (c.op === 'delete') return now.has(c.id);
    const have = now.get(c.feature.id);
    return !(have && sameFeature(have, c.feature));
  });
  const alreadyIn = cs.changes.length - fresh.length;
  let changes = fresh;
  const dropped: string[] = [];
  // Each round drops at least one change, so this ends; a problem no change can be blamed for drops the rest.
  while (changes.length > 0) {
    const check = checkChangeset(base, { ...cs, changes });
    if (check.ok) break;
    const ids = changes.map(changeIdOf);
    const blamed = new Set<string>([
      ...check.conflicts.map((c) => c.id),
      ...check.problems.flatMap((p) => (p.id === null ? [] : [p.id])),
    ].filter((id) => ids.includes(id)));
    if (blamed.size === 0) {
      dropped.push(...ids);
      changes = [];
      break;
    }
    dropped.push(...ids.filter((id) => blamed.has(id)));
    changes = changes.filter((c) => !blamed.has(changeIdOf(c)));
  }
  return { changeset: changes.length > 0 ? { ...cs, changes } : null, alreadyIn, dropped };
}

export class SurveySession {
  readonly campus: string;
  readonly base: EditState;
  readonly ctx: EditContext;
  readonly startedAt: string;
  private history: History;
  /** Where the surveyor was before each record of this run, oldest first. */
  private trail: Step[] = [];
  /** What 되돌리기 took back, newest last, for 복원. */
  private future: Step[] = [];
  private place: Place = { anchorId: null, scope: OUTDOOR, edited: false, pressure: null };
  private attachmentsById: Record<string, SurveyAttachment> = {};
  private measurements: VerticalMeasurement[] = [];
  private timed: SurveyTiming[] = [];
  private photoSeq = 0;
  private listeners = new Set<() => void>();
  private revision = 0;
  /** Depth of batch() calls, and whether something changed inside the outermost one. */
  private batching = 0;
  private dirty = false;
  /** The changes of the state they were computed for. States are immutable, so the same state has the same changes. */
  private diffed: { state: EditState; changes: Changeset['changes'] } | null = null;

  constructor(init: SessionInit) {
    this.campus = init.campus;
    this.base = init.base;
    this.ctx = { ids: init.ids };
    this.startedAt = init.startedAt;
    this.history = createHistory(init.base);
  }

  /**
   * Continue a saved walk on the bundled campus. Fails with the reason when the snapshot is for another campus, another
   * snapshot version or damaged: the saved file is then left alone. When the app was rebuilt with a newer campus (the
   * editor took in an earlier export of this walk, or someone edited the same place) the walk is not thrown away: its
   * changes are rebased onto the bundled campus (rebaseChangeset) and `rebased` says what was left out. Photos, readings
   * and timings are kept as they were. The caller should keep a copy of the original snapshot before saving over it.
   */
  static restore(init: Omit<SessionInit, 'startedAt'>, snapshot: SessionSnapshot): { session: SurveySession; rebased?: RestoreRebase } | { error: string } {
    if (snapshot.version !== SNAPSHOT_VERSION) return { error: '저장된 조사가 이 앱 버전과 맞지 않습니다.' };
    if (snapshot.campus !== init.campus) return { error: `저장된 조사는 다른 캠퍼스(${snapshot.campus})의 것입니다.` };
    // The file parsed as JSON, but a damaged field would throw here or later on the map; the 'stale' screen can clear it.
    if (!snapshotShapeOk(snapshot)) return { error: '저장된 조사 파일이 손상되었습니다.' };
    const session = new SurveySession({ ...init, startedAt: snapshot.startedAt });
    let rebased: RestoreRebase | undefined;
    if (snapshot.changeset) {
      try {
        let cs: Changeset | null = snapshot.changeset;
        if (applyChangeset(cs).disabled(init.base) !== false) {
          const r = rebaseChangeset(init.base, cs);
          rebased = { alreadyIn: r.alreadyIn, dropped: r.dropped };
          cs = r.changeset;
        }
        // One history with one baseline, the bundled campus. Undo stops here because this run's trail is empty.
        if (cs) {
          const action = applyChangeset(cs);
          const reason = action.disabled(init.base);
          if (reason !== false) return { error: reason };
          session.history.perform(action);
        }
      } catch {
        return { error: '저장된 조사의 지도 변경 내용을 읽지 못했습니다.' };
      }
    }
    const anchorId = snapshot.anchorId !== null && snapshot.anchorId in session.state.nodes ? snapshot.anchorId : null;
    session.place = { anchorId, scope: snapshot.scope, edited: false, pressure: null };
    session.attachmentsById = { ...snapshot.attachments };
    session.measurements = [...snapshot.vertical];
    session.timed = [...(snapshot.timings ?? [])];
    session.photoSeq = snapshot.photoSeq;
    return rebased ? { session, rebased } : { session };
  }

  // ---- reading ----

  get state(): EditState {
    return this.history.current();
  }
  get anchorId(): string | null {
    return this.place.anchorId;
  }
  get scope(): Scope {
    return this.place.scope;
  }
  get attachments(): Readonly<Record<string, SurveyAttachment>> {
    return this.attachmentsById;
  }
  get vertical(): readonly VerticalMeasurement[] {
    return this.measurements;
  }
  get timings(): readonly SurveyTiming[] {
    return this.timed;
  }
  get canUndo(): boolean {
    return this.trail.length > 0;
  }
  /** The pressure read where the surveyor last recorded a point (this walk only), the base of the relative height shown. */
  get pressureReference(): PressureReading | null {
    return this.place.pressure;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** For useSyncExternalStore: changes on every change of the session. */
  getRevision = (): number => this.revision;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private changed(): void {
    if (this.batching > 0) {
      this.dirty = true;
      return;
    }
    this.revision++;
    for (const l of [...this.listeners]) l();
  }

  /** Make several changes and tell the listeners once (one re-render and one save for a record with its readings). */
  batch(change: () => void): void {
    this.batching++;
    try {
      change();
    } finally {
      this.batching--;
      if (this.batching === 0 && this.dirty) {
        this.dirty = false;
        this.changed();
      }
    }
  }

  // ---- recording ----

  private step(): Step {
    return { place: this.place, attachments: this.attachmentsById, measurements: this.measurements, timings: this.timed };
  }

  /** Carry out a record plan: one history entry when it changes the map, and the walk moves on. */
  run(plan: PlanOk, pressure: PressureReading | null = null): void {
    // Flat edges between synced points are repeated on the other floors, inside the same history entry.
    if (plan.action) this.history.perform(withSyncMirror(this.state, this.ctx, plan.action));
    this.remember();
    this.place = { anchorId: plan.anchorId, scope: plan.scope, edited: plan.action !== null, pressure };
    this.changed();
  }

  /**
   * Carry out a record plan with what the sensors read (docs/mobile/SPEC-mobile.md 3), as one change:
   * - the record's Feature gets the heading and the pressure read at it (where a floor change began: the one read on leaving),
   * - the walked edge gets a height when both of its ends have a pressure: the trip's two readings, or the one read at
   *   the point before (if recent) and the one read now,
   * - the point the walk continues from remembers the pressure read now, for the next stretch; it is written into that
   *   point's attachment only after a floor change, where the surveyor stands on it (a door or a portal can leave the
   *   walk at a point some metres away, and a reading is never attributed to a place it was not taken at).
   * Returns the paths reserved for the record's photos.
   */
  record(plan: PlanOk, r: Readings): string[] {
    const tripFresh = !r.trip?.startAt || withinPressureWindow(r.trip.startAt, r.at);
    const startHpa = r.trip ? (tripFresh ? r.trip.startHpa : null) : recentPressure(this.place.pressure, r.at);
    const endHpa = r.trip ? r.trip.endHpa : r.pressureHpa;
    const atFeature = r.trip ? r.trip.startHpa : r.pressureHpa;
    let paths: string[] = [];
    this.batch(() => {
      this.run(plan, endHpa !== null ? { hpa: endHpa, at: r.at } : null);
      const patch = {
        ...(r.headingDeg !== null ? { heading_mag_deg: storedHeading(r.headingDeg) } : {}),
        ...(atFeature !== null ? { pressure_hpa: storedPressure(atFeature) } : {}),
      };
      if (Object.keys(patch).length > 0) this.attach(plan.featureId, patch, r.at);
      if (r.trip && plan.anchorId !== plan.featureId && endHpa !== null) this.attach(plan.anchorId, { pressure_hpa: storedPressure(endHpa) }, r.at);
      if (plan.edgeId !== undefined && startHpa !== null && endHpa !== null) {
        this.addVertical(verticalMeasurement({ state: this.state, edgeId: plan.edgeId, reversed: plan.edgeReversed === true, startHpa, endHpa, at: r.at }));
      }
      paths = this.addPhotos(plan.featureId, r.photos ?? 0, r.at, r.photoHeadings);
    });
    return paths;
  }

  /**
   * Carry out one action that is not a record of the walk (a new building, a floor copy, a move, 연동 해제): one history
   * entry and one 되돌리기. The surveyor ends up in `scope`; the walk's last point is kept unless the action says otherwise.
   */
  edit(action: Action, scope: Scope = this.place.scope, anchorId: string | null = this.place.anchorId): { warnings: string[] } | { error: string } {
    const reason = action.disabled(this.state);
    if (reason !== false) return { error: reason };
    const warnings = action.warnings?.(this.state) ?? [];
    this.history.perform(action);
    this.remember();
    this.place = { anchorId: anchorId !== null && anchorId in this.state.nodes ? anchorId : null, scope, edited: true, pressure: null };
    this.changed();
    return { warnings };
  }

  /**
   * Write what the surveyor read at an existing point or door: 개방시간 / 폐쇄기간 / 개방조건 go onto the point itself
   * (setProps, so they travel in the survey's changeset and the editor gets them like any other change), and are kept
   * with the note and the photos in the point's attachment as the record of where they came from. The walk stays where
   * it is; one 되돌리기 takes all of it back. Returns the paths reserved for the photos, or why nothing was written.
   */
  annotate(nodeId: string, edit: { access: AccessInfo; note?: string; photos?: number; photoHeadings?: (number | null)[]; extra?: Action }, at: string): { paths: string[] } | { error: string } {
    const node = this.state.nodes[nodeId];
    if (!node) return { error: '지점을 찾을 수 없습니다.' };
    const patch = accessPatch(node.props, edit.access);
    const old = this.attachmentsById[nodeId];
    const note = edit.note?.trim();
    const noteChanged = note !== undefined && note !== (old?.note ?? '');
    const photos = edit.photos ?? 0;
    if (!patch && !noteChanged && photos === 0 && !edit.extra) return { error: '바뀐 내용이 없습니다.' };
    // extra (the sill of the edges at the point) goes in the same history entry: one 되돌리기.
    const own = patch ? setProps([nodeId], patch) : null;
    const action = own && edit.extra ? compose([own, edit.extra], '지점 정보 저장') : own ?? edit.extra ?? null;
    const reason = action ? action.disabled(this.state) : false;
    if (reason !== false) return { error: reason };
    let paths: string[] = [];
    this.batch(() => {
      if (action) this.history.perform(action);
      this.remember();
      this.place = { ...this.place, edited: action !== null };
      const props = this.state.nodes[nodeId]!.props;
      const { hours: _h, closed_period: _c, access_condition: _a, sync_group: _s, note: _n, ...rest } = old ?? { recorded_at: at };
      const next: SurveyAttachment = { ...rest, recorded_at: at };
      for (const key of ACCESS_PROPS) if (props[key] !== undefined) next[key] = props[key];
      if (props.sync_group !== undefined) next.sync_group = props.sync_group;
      const kept = note ?? old?.note;
      if (kept !== undefined && kept !== '') next.note = kept;
      this.attachmentsById = { ...this.attachmentsById, [nodeId]: next };
      this.changed();
      paths = this.addPhotos(nodeId, photos, at, edit.photoHeadings);
    });
    return { paths };
  }

  /** Look at another floor (or the outdoors) by hand. The walk no longer continues from the last point. */
  moveTo(scope: Scope): void {
    this.remember();
    this.place = { anchorId: null, scope, edited: false, pressure: null };
    this.changed();
  }

  /** Keep where the walk is before a change (for 되돌리기); a new change drops what was undone (복원 has nothing left to bring back). */
  private remember(): void {
    this.trail.push(this.step());
    this.future = [];
  }

  /** Take the last record (or move) back, with the readings and photo entries it added, also on Features that were already there. */
  undo(): boolean {
    const before = this.trail.pop();
    if (!before) return false;
    this.future.push(this.step());
    if (this.place.edited) this.history.undo();
    this.place = before.place;
    this.attachmentsById = before.attachments;
    this.measurements = before.measurements;
    this.timed = before.timings;
    this.changed();
    return true;
  }

  /** 복원: bring back what the last 되돌리기 took, with its readings and photos. Nothing once a new change was made. */
  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.trail.push(this.step());
    if (next.place.edited) this.history.redo();
    this.place = next.place;
    this.attachmentsById = next.attachments;
    this.measurements = next.measurements;
    this.timed = next.timings;
    this.changed();
    return true;
  }

  /** Add readings to a Feature's attachment (later values replace earlier ones; photos are kept). */
  attach(featureId: string, patch: Omit<SurveyAttachment, 'recorded_at' | 'photos'>, at: string): void {
    const old = this.attachmentsById[featureId];
    this.attachmentsById = { ...this.attachmentsById, [featureId]: { ...old, ...patch, recorded_at: at } };
    this.changed();
  }

  /** Reserve the paths of `count` new photos of `featureId` ("photos/<id>-<n>.jpg") and list them in the attachment. */
  addPhotos(featureId: string, count: number, at: string, headings: readonly (number | null)[] = []): string[] {
    const paths = Array.from({ length: count }, () => `photos/${featureId}-${++this.photoSeq}.jpg`);
    if (paths.length === 0) return paths;
    const old = this.attachmentsById[featureId];
    const meta: Record<string, PhotoMeta> = { ...old?.photo_meta };
    paths.forEach((path, i) => {
      const h = headings[i];
      if (h !== null && h !== undefined) meta[path] = { heading_deg: storedPhotoHeading(h) };
    });
    this.attachmentsById = {
      ...this.attachmentsById,
      [featureId]: { ...old, recorded_at: old?.recorded_at ?? at, photos: [...(old?.photos ?? []), ...paths], ...(Object.keys(meta).length > 0 ? { photo_meta: meta } : {}) },
    };
    this.changed();
    return paths;
  }

  /** Set (or clear, with null) the direction a saved photo looks. One 되돌리기 takes it back; the map is not touched. */
  setPhotoHeading(featureId: string, path: string, headingDeg: number | null): boolean {
    const old = this.attachmentsById[featureId];
    if (!old?.photos?.includes(path)) return false;
    const meta: Record<string, PhotoMeta> = { ...old.photo_meta };
    if (headingDeg === null) delete meta[path];
    else meta[path] = { heading_deg: storedPhotoHeading(headingDeg) };
    if (meta[path]?.heading_deg === old.photo_meta?.[path]?.heading_deg) return true;
    this.remember();
    this.place = { ...this.place, edited: false };
    const { photo_meta: _old, ...rest } = old;
    this.attachmentsById = { ...this.attachmentsById, [featureId]: { ...rest, recorded_at: old.recorded_at, ...(Object.keys(meta).length > 0 ? { photo_meta: meta } : {}) } };
    this.changed();
    return true;
  }

  /**
   * Add a stopwatch time for an edge (an escalator ride). Every ride is kept: the times add up to the median the
   * calibration blends with the prediction. One 되돌리기 takes the last one back; the map is not touched.
   */
  addTiming(edgeId: string, seconds: number, direction: 'forward' | 'backward', at: string): { timing: SurveyTiming } | { error: string } {
    if (!(edgeId in this.state.edges)) return { error: '구간을 찾을 수 없습니다.' };
    if (!Number.isFinite(seconds) || seconds < MIN_TIMING_SEC) return { error: `${MIN_TIMING_SEC}초보다 짧은 기록은 저장하지 않습니다. 다시 재어 주세요.` };
    const timing: SurveyTiming = {
      target: `edge:${edgeId}`,
      duration_sec: Math.round(seconds * 10) / 10,
      ...(direction === 'backward' ? { direction } : {}),
      measured_at: at,
    };
    this.remember();
    this.place = { ...this.place, edited: false };
    this.timed = [...this.timed, timing];
    this.changed();
    return { timing };
  }

  /** The stopwatch times of one edge (both directions), oldest first. */
  timingsOf(edgeId: string): SurveyTiming[] {
    return this.timed.filter((t) => t.target === `edge:${edgeId}`);
  }

  /** Keep one barometer measurement per edge: walking the same stairs again replaces the earlier reading. */
  addVertical(m: VerticalMeasurement): void {
    this.measurements = [...this.measurements.filter((x) => x.edge_id !== m.edge_id), m];
    this.changed();
  }

  // ---- saving and exporting ----

  /** The map changes against the bundled campus. Comparing every Feature is the costly part of a save, so it is done once per state. */
  private changeset(id: string, summary: string): Changeset | null {
    const state = this.state;
    const meta = { id, campus: this.campus, source: 'editor' as const, summary };
    if (this.diffed?.state !== state) this.diffed = { state, changes: historyToChangeset(this.base, state, meta).changes };
    return this.diffed.changes.length > 0 ? { ...meta, report_ids: [], changes: this.diffed.changes } : null;
  }

  snapshot(): SessionSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      campus: this.campus,
      startedAt: this.startedAt,
      changeset: this.changeset(`cs-${dayOf(this.startedAt)}-autosave`, '현장 조사 자동 저장'),
      anchorId: this.place.anchorId,
      scope: this.place.scope,
      attachments: this.attachmentsById,
      vertical: this.measurements,
      ...(this.timed.length > 0 ? { timings: this.timed } : {}),
      photoSeq: this.photoSeq,
    };
  }

  /** The file for the editor. `slug` names the walk ("eng1-3f"); it is cleaned the way changeset ids are. */
  toSurvey(slug: string, surveyedAt: string): Survey {
    return buildSurvey({
      base: this.base,
      current: this.state,
      campus: this.campus,
      id: surveyId(dayOf(this.startedAt), slug),
      surveyedAt,
      attachments: this.attachmentsById,
      vertical: this.measurements,
      timings: this.timed,
      summary: `현장 조사 ${slug}`,
    });
  }

  /** How much the walk has recorded so far, for the export sheet. */
  counts(): { nodes: number; edges: number; photos: number; measurements: number; timings: number } {
    const added = (now: Record<string, unknown>, was: Record<string, unknown>) => Object.keys(now).filter((id) => !(id in was)).length;
    // The same test buildSurvey uses for what is exported.
    const live = Object.entries(this.attachmentsById).filter(([id]) => findFeature(this.state, id) !== undefined);
    return {
      nodes: added(this.state.nodes, this.base.nodes),
      edges: added(this.state.edges, this.base.edges),
      photos: live.reduce((n, [, a]) => n + (a.photos?.length ?? 0), 0),
      measurements: this.measurements.length,
      timings: this.timed.filter((t) => t.target.slice(5) in this.state.edges).length,
    };
  }
}
