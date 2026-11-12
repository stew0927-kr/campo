// 측정 입력 (SPEC-v0.2 3.9): the target a selection stands for, counts and calibration state from core's own functions,
// and the line a measurement becomes in observations/editor.jsonl.
import { describe, expect, it } from 'vitest';
import { buildGraph, parseObservations, type EditState } from '@campo/core';
import { fixtureSession } from './fixture.ts';
import { kstIso, loadedObservations, makeObservation, measureSummary, measureTargetOf, type MeasureSummary, type MeasureTarget } from '../src/model/measure.ts';
import {
  OBSERVATION_FILE, commitObservations, extrasWithPending, pendingObservationsText, stateToCampus, type Session,
} from '../src/model/session.ts';

const UP = 'e_A_1_esc__A_2_esc_up';
const DOWN = 'e_A_1_esc__A_2_esc_down';
const NOW = new Date('2026-11-12T00:10:00Z'); // 09:10 in Korea

const target = (st: EditState, ...ids: string[]): MeasureTarget => {
  const t = measureTargetOf(st, ids);
  if (!('target' in t)) throw new Error(t.reason);
  return t;
};
const summaryOf = (s: Session, t: MeasureTarget): MeasureSummary => {
  const graph = buildGraph(stateToCampus(s.history.current(), s.meta, s.passthrough, s.extras), { calibration: {} });
  const r = measureSummary(t, graph, s.extras, s.pendingObservations);
  if (!('target' in r)) throw new Error(r.reason);
  return r;
};

describe('측정 대상', () => {
  it('an edge measures itself; an elevator edge or stop measures its elevator; anything else says why not', () => {
    const st = fixtureSession().history.current();
    expect(target(st, UP)).toMatchObject({ target: `edge:${UP}`, isEdge: true });
    expect(target(st, 'e_out_0001__out_0002').target).toBe('edge:e_out_0001__out_0002');
    // SPEC 3.9: an elevator edge is not a target; it stands for the elevator of its stop
    expect(target(st, 'e_A_elevA_L1__A_elevA_L2')).toMatchObject({ target: 'elevator:A_elevA', isEdge: false });
    expect(target(st, 'n_A_elevA_L3')).toMatchObject({ target: 'elevator:A_elevA', isEdge: false });
    expect(measureTargetOf(st, ['n_A_1_hall'])).toHaveProperty('reason');
    expect(measureTargetOf(st, [])).toHaveProperty('reason');
    expect(measureTargetOf(st, [UP, DOWN])).toHaveProperty('reason');
    expect(measureTargetOf(st, ['bldg_A'])).toHaveProperty('reason');
  });
});

describe('예측값, 측정 개수, 현재 추정값', () => {
  it('counts what observations/*.jsonl holds, per direction; a one-way belt only has the direction it runs', () => {
    const s = fixtureSession();
    const up = summaryOf(s, target(s.history.current(), UP));
    expect(up.directions.map((d) => d.direction)).toEqual(['forward']);
    expect(up.directions[0]).toMatchObject({ key: `edge:${UP}`, count: 2, pending: 0 });
    expect(up.directions[0]!.predictedSec).toBeGreaterThan(15); // core's prior for one floor of escalator, not computed here
    expect(up.directions[0]!.estimateSec).toBeUndefined(); // no calibration.json yet
    expect(up.directions[0]!.stale).toBe(true); // 2 measurements that no calibration has seen

    // the backward-running belt is measured against its drawn direction
    const down = summaryOf(s, target(s.history.current(), DOWN));
    expect(down.directions.map((d) => d.direction)).toEqual(['backward']);
    expect(down.directions[0]).toMatchObject({ key: `edge:${DOWN}#backward`, count: 1 });

    const elevator = summaryOf(s, target(s.history.current(), 'n_A_elevA_L1'));
    expect(elevator.directions).toHaveLength(1);
    expect(elevator.directions[0]).toMatchObject({ key: 'elevator:A_elevA', count: 0, stale: false });
  });

  it('an edge that runs both ways shows both directions with their own counts', () => {
    const s = fixtureSession();
    s.pendingObservations.push({ target: 'edge:e_A_1_hall__A_1_stair', duration_sec: 9, direction: 'backward', source: 'field', measured_at: kstIso(NOW) });
    const r = summaryOf(s, target(s.history.current(), 'e_A_1_hall__A_1_stair'));
    expect(r.directions.map((d) => [d.direction, d.key, d.count, d.pending])).toEqual([
      ['forward', 'edge:e_A_1_hall__A_1_stair', 0, 0],
      ['backward', 'edge:e_A_1_hall__A_1_stair#backward', 1, 1],
    ]);
  });

  it('is "stale" until calibration.json has the same number of kept measurements; an unsaved one is always stale', () => {
    const s = fixtureSession();
    const calibration = { [`edge:${UP}`]: { prior_sec: 19, median_sec: 21.5, n: 2, estimate_sec: 20.5, updated_at: '2026-11-12' } };
    s.extras = [...s.extras, { path: 'calibration.json', text: JSON.stringify(calibration) }];
    const synced = summaryOf(s, target(s.history.current(), UP)).directions[0]!;
    expect(synced).toMatchObject({ estimateSec: 20.5, count: 2, expectedN: 2, stale: false });
    s.pendingObservations.push({ target: `edge:${UP}`, duration_sec: 23, direction: 'forward', source: 'field', measured_at: kstIso(NOW) });
    expect(summaryOf(s, target(s.history.current(), UP)).directions[0]).toMatchObject({ count: 3, pending: 1, stale: true, estimateSec: 20.5 });
  });

  it('an outlier is not expected in the calibration (core dropOutliers), so it does not keep the notice on', () => {
    const s = fixtureSession();
    const prior = summaryOf(s, target(s.history.current(), UP)).directions[0]!.predictedSec;
    s.extras = [...s.extras, { path: 'calibration.json', text: JSON.stringify({ [`edge:${UP}`]: { prior_sec: prior, median_sec: 21.5, n: 2, estimate_sec: 20, updated_at: '2026-11-12' } }) }];
    s.pendingObservations.push({ target: `edge:${UP}`, duration_sec: prior * 10, direction: 'forward', source: 'field', measured_at: kstIso(NOW) });
    const d = summaryOf(s, target(s.history.current(), UP)).directions[0]!;
    expect(d).toMatchObject({ count: 3, expectedN: 2 });
    expect(d.stale).toBe(true); // it is still unsaved
    commitObservations(s);
    expect(summaryOf(s, target(s.history.current(), UP)).directions[0]!.stale).toBe(false);
  });

  it('says why when the target has no link in the graph', () => {
    const s = fixtureSession();
    const graph = buildGraph(stateToCampus(s.history.current(), s.meta, s.passthrough, s.extras), { calibration: {} });
    const gone: MeasureTarget = { target: 'edge:nope', label: '없는 구간', isEdge: true };
    expect(measureSummary(gone, graph, s.extras, [])).toHaveProperty('reason');
  });
});

describe('측정 한 줄 만들기', () => {
  it('makes a field observation that core accepts, with the Korean time zone', () => {
    const st = fixtureSession().history.current();
    expect(kstIso(NOW)).toBe('2026-11-12T09:10:00+09:00');
    const made = makeObservation(target(st, UP), { seconds: '21.4', direction: 'forward', note: ' 서서 탐 ' }, NOW);
    expect(made).toEqual({ record: { target: `edge:${UP}`, duration_sec: 21.4, direction: 'forward', source: 'field', measured_at: '2026-11-12T09:10:00+09:00', note: '서서 탐' } });
    // an elevator has no direction and an empty note is left out
    const lift = makeObservation(target(st, 'n_A_elevA_L1'), { seconds: '35', direction: 'backward', note: '' }, NOW);
    expect(lift).toEqual({ record: { target: 'elevator:A_elevA', duration_sec: 35, source: 'field', measured_at: '2026-11-12T09:10:00+09:00' } });
  });

  it('refuses a time that is not a positive number', () => {
    const st = fixtureSession().history.current();
    for (const seconds of ['', ' ', 'abc', '0', '-3', 'Infinity']) {
      expect(makeObservation(target(st, UP), { seconds, direction: 'forward', note: '' }, NOW), seconds).toHaveProperty('error');
    }
  });
});

describe('저장 파일', () => {
  it('appends the new lines to observations/editor.jsonl, as valid observations, and moves them to the loaded ones after saving', () => {
    const s = fixtureSession();
    expect(pendingObservationsText(s)).toBeNull();
    expect(extrasWithPending(s)).toEqual(s.extras);
    const t = target(s.history.current(), UP);
    for (const seconds of ['45', '50']) {
      const made = makeObservation(t, { seconds, direction: 'forward', note: '' }, NOW);
      if ('error' in made) throw new Error(made.error);
      s.pendingObservations.push(made.record);
    }
    const text = pendingObservationsText(s)!;
    expect(text.endsWith('\n')).toBe(true);
    const parsed = parseObservations(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.observations.map((o) => o.record.duration_sec)).toEqual([45, 50]);
    // the other observation files are read but never rewritten
    expect(extrasWithPending(s).find((f) => f.path === OBSERVATION_FILE)!.text).toBe(text);
    expect(extrasWithPending(s).some((f) => f.path === 'observations/sample.jsonl')).toBe(true);

    const loaded = loadedObservations(s.extras).length;
    commitObservations(s);
    expect(s.pendingObservations).toEqual([]);
    expect(loadedObservations(s.extras)).toHaveLength(loaded + 2);
    expect(pendingObservationsText(s)).toBeNull();

    // a later measurement goes after the saved ones, even when the file lacked its last newline
    s.extras = s.extras.map((f) => (f.path === OBSERVATION_FILE ? { ...f, text: f.text.trimEnd() } : f));
    s.pendingObservations.push({ target: `edge:${UP}`, duration_sec: 48, direction: 'forward', source: 'field', measured_at: kstIso(NOW) });
    expect(parseObservations(pendingObservationsText(s)!).observations.map((o) => o.record.duration_sec)).toEqual([45, 50, 48]);
  });
});
