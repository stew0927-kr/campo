// One survey walk end to end: record, undo, save on the phone, continue, export, and apply in the editor's way.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyChangeset, createHistory, createIdGen, setProps, surveyDanglingIds, validateSurvey, type EditState, type LoadedCampus } from '@campo/core';
import { OUTDOOR } from '../src/model/scope.ts';
import { planDoor, planFloorChange, planJunction, planPortal, planStart, type Plan, type PlanOk } from '../src/survey/plans.ts';
import { SurveySession } from '../src/survey/session.ts';
import { AT, CAMPUS, SOURCE, campusErrors, fixture } from './helpers.ts';

let base: EditState;
let loaded: LoadedCampus;
beforeAll(async () => {
  ({ state: base, loaded } = await fixture());
});

const newSession = () => new SurveySession({ campus: CAMPUS, base, ids: createIdGen(3), startedAt: AT });

function ok(plan: Plan): PlanOk {
  if ('error' in plan) throw new Error(plan.error);
  return plan;
}
const at = (s: SurveySession, coord: [number, number]) => ({ state: s.state, ctx: s.ctx, scope: s.scope, coord, anchorId: s.anchorId, source: SOURCE });

/** Outside → into building B on floor 1 → a door → up new stairs to floor 2. Returns the ids the walk made. */
function walk(s: SurveySession) {
  s.run(ok(planStart(at(s, [127.00105, 37.00052]))));
  s.run(ok(planJunction(at(s, [127.00108, 37.00056]), { stepFree: true })));
  const portal = ok(planPortal(at(s, [127.0011, 37.00056]), { buildingId: 'bldg_B', level: 1, stepFree: true }));
  s.run(portal);
  s.run(ok(planJunction(at(s, [127.00118, 37.00054]))));
  const door = ok(planDoor(at(s, [127.0012, 37.00058]), { roomRef: '101', doorRole: 'front' }));
  s.run(door);
  const stairs = ok(planFloorChange(at(s, [127.00122, 37.00053]), { kind: 'stairs', toLevel: 2, incline: 'up' }));
  s.run(stairs);
  return { entranceId: portal.featureId, doorId: door.featureId, stairsEdgeId: stairs.edgeId! };
}

describe('SurveySession', () => {
  it('a walk leaves a valid campus, and the surveyor ends up where the last record led', () => {
    const s = newSession();
    const { doorId } = walk(s);
    expect(campusErrors(loaded, s.state)).toEqual([]);
    expect(s.scope).toEqual({ kind: 'building', buildingId: 'bldg_B', level: 2 });
    expect(s.state.nodes[s.anchorId!]!.props).toMatchObject({ node_type: 'stair_landing', level: 2 });
    expect(s.state.nodes[doorId]!.props.room_ref).toBe('101');
    expect(s.counts()).toMatchObject({ photos: 0, measurements: 0 });
    expect(s.counts().nodes).toBeGreaterThanOrEqual(7);
  });

  it('undo takes records back one at a time, with the place the surveyor was, down to the start', () => {
    const s = newSession();
    walk(s);
    expect(s.undo()).toBe(true); // the stairs
    expect(s.scope).toEqual({ kind: 'building', buildingId: 'bldg_B', level: 1 });
    expect(Object.values(s.state.nodes).some((n) => n.props.node_type === 'stair_landing' && n.props.source === SOURCE)).toBe(false);
    while (s.undo());
    expect(s.state).toEqual(base);
    expect(s.scope).toEqual(OUTDOOR);
    expect(s.anchorId).toBeNull();
    expect(s.canUndo).toBe(false);
  });

  it('a record that only walks onto existing data is undone without touching the map', () => {
    const s = newSession();
    s.run(ok(planStart(at(s, [127.0002, 37.0004])))); // n_out_0002, nothing made
    s.run(ok(planJunction(at(s, [127.00025, 37.00045]))));
    const made = s.state;
    s.moveTo({ kind: 'building', buildingId: 'bldg_A', level: 1 });
    expect(s.anchorId).toBeNull();
    s.undo(); // the move
    expect(s.state).toBe(made);
    expect(s.scope).toEqual(OUTDOOR);
    s.undo(); // the junction
    s.undo(); // the start
    expect(s.state).toEqual(base);
  });

  it('photos get numbered paths that are never reused, and readings are merged into the attachment', () => {
    const s = newSession();
    const { doorId } = walk(s);
    expect(s.addPhoto(doorId, AT)).toBe(`photos/${doorId}-1.jpg`);
    expect(s.addPhoto(doorId, AT)).toBe(`photos/${doorId}-2.jpg`);
    s.attach(doorId, { heading_mag_deg: 90, pressure_hpa: 1012 }, '2026-11-14T10:05:00+09:00');
    expect(s.attachments[doorId]).toEqual({
      recorded_at: '2026-11-14T10:05:00+09:00', photos: [`photos/${doorId}-1.jpg`, `photos/${doorId}-2.jpg`], heading_mag_deg: 90, pressure_hpa: 1012,
    });
  });

  it('the export passes the schema, applies to the campus as one undoable action, and drops what was undone', () => {
    const s = newSession();
    const { doorId, stairsEdgeId } = walk(s);
    s.addPhoto(doorId, AT);
    s.addVertical({ edge_id: stairsEdgeId, pressure_start_hpa: 1012.3, pressure_end_hpa: 1011.8, height_m: 4.2, method: 'barometer', measured_at: AT });
    s.addVertical({ edge_id: stairsEdgeId, pressure_start_hpa: 1012.3, pressure_end_hpa: 1011.82, height_m: 4.0, method: 'barometer', measured_at: AT });
    expect(s.vertical.map((v) => v.height_m)).toEqual([4.0]); // measured again: the newer reading stays

    const survey = s.toSurvey('B동 1층', '2026-11-14T11:00:00+09:00');
    expect(survey.id).toBe('sv-20261114-b-1');
    expect(validateSurvey(survey)).toEqual({ ok: true, errors: [] });
    const editor = createHistory(base);
    const after = editor.perform(applyChangeset(survey.changeset!));
    expect(after).toEqual(s.state);
    expect(surveyDanglingIds(after, survey)).toEqual([]);
    expect(editor.undo()).toEqual(base);

    s.undo(); // the stairs: its measurement goes too
    expect(s.vertical).toEqual([]);
    s.undo(); // the door: its photo is left out of the export
    const smaller = s.toSurvey('B동 1층', '2026-11-14T11:00:00+09:00');
    expect(smaller.attachments).toEqual({});
    expect(validateSurvey(smaller).ok).toBe(true);
  });

  it('continues after a restart: same map, same place, same photo numbering', () => {
    const s = newSession();
    const { doorId } = walk(s);
    s.addPhoto(doorId, AT);
    const saved = JSON.parse(JSON.stringify(s.snapshot())) as ReturnType<SurveySession['snapshot']>;

    const restored = SurveySession.restore({ campus: CAMPUS, base, ids: createIdGen(99) }, saved);
    if ('error' in restored) throw new Error(restored.error);
    const r = restored.session;
    expect(r.state).toEqual(s.state);
    expect(r.scope).toEqual(s.scope);
    expect(r.anchorId).toBe(s.anchorId);
    expect(r.startedAt).toBe(AT);
    expect(r.addPhoto(doorId, AT)).toBe(`photos/${doorId}-2.jpg`);
    expect(r.canUndo).toBe(false);

    // more records after the restart still export against the bundled campus
    r.run(ok(planJunction(at(r, [127.00128, 37.00056]))));
    const survey = r.toSurvey('b', AT);
    expect(createHistory(base).perform(applyChangeset(survey.changeset!))).toEqual(r.state);
    r.undo();
    expect(r.state).toEqual(s.state);
  });

  it('an empty walk saves no changeset and restores to the campus as bundled', () => {
    const snapshot = newSession().snapshot();
    expect(snapshot.changeset).toBeNull();
    const restored = SurveySession.restore({ campus: CAMPUS, base, ids: createIdGen(1) }, snapshot);
    expect('session' in restored && restored.session.state).toBe(base);
  });

  it('refuses a snapshot of another campus, and one whose changes no longer fit the bundled data', () => {
    const s = newSession();
    s.run(ok(planStart(at(s, [127.0002, 37.0004]))));
    s.run(ok(planJunction(at(s, [127.00025, 37.00045]))));
    // The walk now also changes an existing Feature, so a newer bundled campus can disagree with it.
    const edited = createHistory(base).perform(setProps(['n_out_0002'], { name: '바뀐 이름' }));
    const init = { campus: CAMPUS, base, ids: createIdGen(1) };
    expect(SurveySession.restore({ ...init, campus: 'other' }, s.snapshot())).toEqual({ error: expect.stringContaining('다른 캠퍼스') });

    const onEdited = new SurveySession({ campus: CAMPUS, base, ids: createIdGen(3), startedAt: AT });
    onEdited.run({ action: setProps(['n_out_0002'], { name: '현장 이름' }), anchorId: 'n_out_0002', scope: OUTDOOR, featureId: 'n_out_0002', notices: [] });
    const stale = SurveySession.restore({ ...init, base: edited }, onEdited.snapshot());
    expect(stale).toEqual({ error: expect.stringContaining('rev_mismatch') });
  });
});
