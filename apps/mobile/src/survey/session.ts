// One survey walk: the edit history, where the surveyor is, and what was photographed and measured.
// No React and no device API in here, so the whole walk can be tested in Node.
import {
  applyChangeset,
  buildSurvey,
  createHistory,
  historyToChangeset,
  surveyId,
  type Changeset,
  type EditContext,
  type EditState,
  type History,
  type IdGen,
  type Survey,
  type SurveyAttachment,
  type VerticalMeasurement,
} from '@campo/core';
import { OUTDOOR, type Scope } from '../model/scope.ts';
import { dayOf } from '../time.ts';
import type { PlanOk } from './plans.ts';

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
  private trail: Place[] = [];
  private place: Place = { anchorId: null, scope: OUTDOOR, edited: false };
  private attachmentsById: Record<string, SurveyAttachment> = {};
  private measurements: VerticalMeasurement[] = [];
  private photoSeq = 0;
  private listeners = new Set<() => void>();
  private revision = 0;

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
      // The restored state is where undo stops: records of an earlier run are not taken back one by one.
      session.history = createHistory(action.apply(init.base));
    }
    const anchorId = snapshot.anchorId !== null && snapshot.anchorId in session.state.nodes ? snapshot.anchorId : null;
    session.place = { anchorId, scope: snapshot.scope, edited: false };
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
    this.revision++;
    for (const l of [...this.listeners]) l();
  }

  // ---- recording ----

  /** Carry out a record plan: one history entry when it changes the map, and the walk moves on. */
  run(plan: PlanOk): void {
    if (plan.action) this.history.perform(plan.action);
    this.trail.push(this.place);
    this.place = { anchorId: plan.anchorId, scope: plan.scope, edited: plan.action !== null };
    this.changed();
  }

  /** Look at another floor (or the outdoors) by hand. The walk no longer continues from the last point. */
  moveTo(scope: Scope): void {
    this.trail.push(this.place);
    this.place = { anchorId: null, scope, edited: false };
    this.changed();
  }

  /** Take the last record (or move) back. Its photos and readings are left out of the export by buildSurvey. */
  undo(): boolean {
    const before = this.trail.pop();
    if (!before) return false;
    if (this.place.edited) this.history.undo();
    this.place = before;
    this.measurements = this.measurements.filter((m) => m.edge_id in this.state.edges);
    this.changed();
    return true;
  }

  /** Add readings to a Feature's attachment (later values replace earlier ones; photos are kept). */
  attach(featureId: string, patch: Omit<SurveyAttachment, 'recorded_at' | 'photos'>, at: string): void {
    const old = this.attachmentsById[featureId];
    this.attachmentsById = { ...this.attachmentsById, [featureId]: { ...old, ...patch, recorded_at: at } };
    this.changed();
  }

  /** Reserve the path of a new photo of `featureId` ("photos/<id>-<n>.jpg") and list it in the attachment. */
  addPhoto(featureId: string, at: string): string {
    this.photoSeq++;
    const path = `photos/${featureId}-${this.photoSeq}.jpg`;
    const old = this.attachmentsById[featureId];
    this.attachmentsById = { ...this.attachmentsById, [featureId]: { ...old, recorded_at: old?.recorded_at ?? at, photos: [...(old?.photos ?? []), path] } };
    this.changed();
    return path;
  }

  /** Keep one barometer measurement per edge: walking the same stairs again replaces the earlier reading. */
  addVertical(m: VerticalMeasurement): void {
    this.measurements = [...this.measurements.filter((x) => x.edge_id !== m.edge_id), m];
    this.changed();
  }

  // ---- saving and exporting ----

  private changeset(id: string, summary: string): Changeset | null {
    const cs = historyToChangeset(this.base, this.state, { id, campus: this.campus, source: 'editor', summary });
    return cs.changes.length > 0 ? cs : null;
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
    const live = Object.entries(this.attachmentsById).filter(([id]) => id in this.state.nodes || id in this.state.edges);
    return {
      nodes: added(this.state.nodes, this.base.nodes),
      edges: added(this.state.edges, this.base.edges),
      photos: live.reduce((n, [, a]) => n + (a.photos?.length ?? 0), 0),
      measurements: this.measurements.length,
    };
  }
}
