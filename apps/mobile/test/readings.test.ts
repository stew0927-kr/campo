// Sensor readings as the survey file stores them.
import { beforeAll, describe, expect, it } from 'vitest';
import type { EditState } from '@campo/core';
import { MAX_PRESSURE_AGE_MS, nextRoomRef, recentPressure, storedHeading, verticalMeasurement } from '../src/survey/readings.ts';
import { AT, fixture } from './helpers.ts';

let state: EditState;
beforeAll(async () => {
  ({ state } = await fixture());
});

describe('verticalMeasurement', () => {
  // e_out_0004__out_0005 is an outdoor ramp from n_out_0004 to n_out_0005.
  const walked = { edgeId: 'e_out_0004__out_0005', startHpa: 1012.5, endHpa: 1012.02, at: AT };

  it('height is the rise from the edge\'s from to its to, with a grade for a long outdoor edge', () => {
    const m = verticalMeasurement({ state, reversed: false, ...walked });
    expect(m).toMatchObject({ edge_id: walked.edgeId, pressure_start_hpa: 1012.5, pressure_end_hpa: 1012.02, method: 'barometer', measured_at: AT });
    expect(m.height_m).toBeCloseTo(4, 0);
    expect(m.grade_pct).toBeGreaterThan(0);
  });

  it('an edge walked against its direction keeps the same height: the readings are swapped, not the sign of the hill', () => {
    const along = verticalMeasurement({ state, reversed: false, ...walked });
    // The same hill walked downwards from the far end: start and end pressures are the other way round.
    const against = verticalMeasurement({ state, reversed: true, edgeId: walked.edgeId, startHpa: walked.endHpa, endHpa: walked.startHpa, at: AT });
    expect(against).toEqual(along);
  });

  it('indoor stairs and elevators get a height but no grade (their ends are drawn at one spot)', () => {
    const m = verticalMeasurement({ state, edgeId: 'e_B_1_stair__B_2_stair', reversed: false, startHpa: 1012.5, endHpa: 1012.0, at: AT });
    expect(m.height_m).toBeGreaterThan(3);
    expect(m.grade_pct).toBeUndefined();
    expect(verticalMeasurement({ state, edgeId: 'e_A_elevA_L1__A_elevA_L2', reversed: false, startHpa: 1012.5, endHpa: 1012.0, at: AT }).grade_pct).toBeUndefined();
  });

  it('values are rounded the way the file stores them', () => {
    const m = verticalMeasurement({ state, reversed: false, edgeId: walked.edgeId, startHpa: 1012.123456, endHpa: 1011.987654, at: AT });
    expect(m.pressure_start_hpa).toBe(1012.12);
    expect(m.pressure_end_hpa).toBe(1011.99);
    expect(String(m.height_m).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
});

describe('recentPressure', () => {
  const later = (ms: number) => new Date(Date.parse(AT) + ms).toISOString();

  it('is the reading at the point before while it is fresh, and nothing once the weather may have moved', () => {
    const attachment = { recorded_at: AT, pressure_hpa: 1012.3 };
    expect(recentPressure(attachment, later(60_000))).toBe(1012.3);
    expect(recentPressure(attachment, later(MAX_PRESSURE_AGE_MS + 1))).toBeNull();
    expect(recentPressure(attachment, later(-1000))).toBeNull(); // a clock that went backwards
    expect(recentPressure({ recorded_at: AT }, later(1000))).toBeNull();
    expect(recentPressure(undefined, AT)).toBeNull();
  });
});

describe('small conversions', () => {
  it('a heading that rounds up to 360 is stored as 0 (the schema refuses 360)', () => {
    expect(storedHeading(359.96)).toBe(0);
    expect(storedHeading(87.449)).toBe(87.4);
  });

  it('the next room number keeps letters, dashes and leading zeros', () => {
    expect(nextRoomRef('408')).toBe('409');
    expect(nextRoomRef('B101')).toBe('B102');
    expect(nextRoomRef('12-3')).toBe('12-4');
    expect(nextRoomRef('009')).toBe('010');
    expect(nextRoomRef('B')).toBe('B');
    expect(nextRoomRef('')).toBe('');
  });
});
