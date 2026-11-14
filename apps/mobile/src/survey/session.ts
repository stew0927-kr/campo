// One survey walk: the edit history, where the surveyor is, and what was photographed and measured.
// No React and no device API in here, so the whole walk can be tested in Node.
import {
  ACCESS_PROPS,
  accessPatch,
  applyChangeset,
  buildSurvey,
  createHistory,
  findFeature,
  historyToChangeset,
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
  type VerticalMeasurement,
} from '@campo/core';
import { OUTDOOR, type Scope } from '../model/scope.ts';
import { dayOf } from '../time.ts';
import { withSyncMirror } from './floors.ts';
import type { PlanOk } from './plans.ts';
import { recentPressure, storedHeading, storedPhotoHeading, storedPressure, verticalMeasurement, type PressureReading } from './readings.ts';

export const SNAPSHOT_VERSION = 1;

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
  trip?: { startHpa: number | null; endHpa: number | null };
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

export class SurveySession {
  readonly campus: string;
  readonly base: EditState;
  readonly ctx: EditContext;
  readonly startedAt: string;
  private history: History;
  /** Where the surveyor was before each record of this run, oldest first. */
  private trail: Step[] = [];
  private place: Place = { anchorId: null, scope: OUTDOOR, edited: false, pressure: null };
  private attachmentsById: Record<string, SurveyAttachment> = {};
  private measurements: VerticalMeasurement[] = [];
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
   * Continue a saved walk on the bundled campus. Fails with the reason when the snapshot is for another campus or its
   * changes no longer fit the data (the app was rebuilt with a newer campus): the saved file is then left alone.
   */
  static restore(init: Omit<SessionInit, 'startedAt'>, snapshot: SessionSnapshot): { session: SurveySession } | { error: string } {
    if (snapshot.version !== SNAPSHOT_VERSION) return { error: '저장된 조사가 이 앱 버전과 맞지 않습니다.' };
    if (snapshot.campus !== init.campus) return { error: `저장된 조사는 다른 캠퍼스(${snapshot.campus})의 것입니다.` };
    const session = new SurveySession({ ...init, startedAt: snapshot.startedAt });
    if (snapshot.changeset) {
      const action = applyChangeset(snapshot.changeset);
      const reason = action.disabled(init.base);
      if (reason !== false) return { error: reason };
      // One history with one baseline, the bundled campus. Undo stops here because this run's trail is empty.
      session.history.perform(action);
    }
    const anchorId = snapshot.anchorId !== null && snapshot.anchorId in session.state.nodes ? snapshot.anchorId : null;
    session.place = { anchorId, scope: snapshot.scope, edited: false, pressure: null };
    session.attachmentsById = { ...snapshot.attachments };
    session.measurements = [...snapshot.vertical];
    session.photoSeq = snapshot.photoSeq;
    return { session };
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
  get canUndo(): boolean {
    return this.trail.length > 0;
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
    return { place: this.place, attachments: this.attachmentsById, measurements: this.measurements };
  }

  /** Carry out a record plan: one history entry when it changes the map, and the walk moves on. */
  run(plan: PlanOk, pressure: PressureReading | null = null): void {
    // Flat edges between synced points are repeated on the other floors, inside the same history entry.
    if (plan.action) this.history.perform(withSyncMirror(this.state, this.ctx, plan.action));
    this.trail.push(this.step());
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
    const startHpa = r.trip ? r.trip.startHpa : recentPressure(this.place.pressure, r.at);
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
    this.trail.push(this.step());
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
  annotate(nodeId: string, edit: { access: AccessInfo; note?: string; photos?: number; photoHeadings?: (number | null)[] }, at: string): { paths: string[] } | { error: string } {
    const node = this.state.nodes[nodeId];
    if (!node) return { error: '지점을 찾을 수 없습니다.' };
    const patch = accessPatch(node.props, edit.access);
    const old = this.attachmentsById[nodeId];
    const note = edit.note?.trim();
    const noteChanged = note !== undefined && note !== (old?.note ?? '');
    const photos = edit.photos ?? 0;
    if (!patch && !noteChanged && photos === 0) return { error: '바뀐 내용이 없습니다.' };
    const action = patch ? setProps([nodeId], patch) : null;
    const reason = action ? action.disabled(this.state) : false;
    if (reason !== false) return { error: reason };
    let paths: string[] = [];
    this.batch(() => {
      if (action) this.history.perform(action);
      this.trail.push(this.step());
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
    this.trail.push(this.step());
    this.place = { anchorId: null, scope, edited: false, pressure: null };
    this.changed();
  }

  /** Take the last record (or move) back, with the readings and photo entries it added, also on Features that were already there. */
  undo(): boolean {
    const before = this.trail.pop();
    if (!before) return false;
    if (this.place.edited) this.history.undo();
    this.place = before.place;
    this.attachmentsById = before.attachments;
    this.measurements = before.measurements;
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
    this.trail.push(this.step());
    this.place = { ...this.place, edited: false };
    const { photo_meta: _old, ...rest } = old;
    this.attachmentsById = { ...this.attachmentsById, [featureId]: { ...rest, recorded_at: old.recorded_at, ...(Object.keys(meta).length > 0 ? { photo_meta: meta } : {}) } };
    this.changed();
    return true;
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
      summary: `현장 조사 ${slug}`,
    });
  }

  /** How much the walk has recorded so far, for the export sheet. */
  counts(): { nodes: number; edges: number; photos: number; measurements: number } {
    const added = (now: Record<string, unknown>, was: Record<string, unknown>) => Object.keys(now).filter((id) => !(id in was)).length;
    // The same test buildSurvey uses for what is exported.
    const live = Object.entries(this.attachmentsById).filter(([id]) => findFeature(this.state, id) !== undefined);
    return {
      nodes: added(this.state.nodes, this.base.nodes),
      edges: added(this.state.edges, this.base.edges),
      photos: live.reduce((n, [, a]) => n + (a.photos?.length ?? 0), 0),
      measurements: this.measurements.length,
    };
  }
}
