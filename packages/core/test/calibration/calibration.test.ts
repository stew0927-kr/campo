// Measured time calibration (SPEC-v0.2 3.9).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  blend,
  calibrate,
  dropOutliers,
  observationKey,
  observationProblem,
  parseObservations,
  splitObservationKey,
  weightedMedian,
} from '../../src/calibration/index.ts';
import { CALIBRATION_K, OUTLIER_RATIO } from '../../src/costs.ts';
import type { Observation } from '../../src/types.ts';

const TODAY = '2026-11-12';
const AT = '2026-11-12T09:10:00+09:00';

const obs = (duration_sec: number, extra: Partial<Observation> = {}): Observation => ({
  target: 'edge:e_esc',
  duration_sec,
  source: 'field',
  measured_at: AT,
  ...extra,
});
const priors = (table: Record<string, number>) => (key: string) => table[key];

describe('observationKey', () => {
  it('puts a backward edge measurement under #backward, forward and missing direction under the target', () => {
    expect(observationKey({ target: 'edge:e1', direction: 'backward' })).toBe('edge:e1#backward');
    expect(observationKey({ target: 'edge:e1', direction: 'forward' })).toBe('edge:e1');
    expect(observationKey({ target: 'edge:e1' })).toBe('edge:e1');
  });

  it('ignores direction for elevator targets', () => {
    expect(observationKey({ target: 'elevator:A_elevA', direction: 'backward' })).toBe('elevator:A_elevA');
    expect(observationKey({ target: 'elevator:A_elevA', direction: 'forward' })).toBe('elevator:A_elevA');
  });

  it('splitObservationKey undoes it', () => {
    expect(splitObservationKey('edge:e1#backward')).toEqual({ target: 'edge:e1', direction: 'backward' });
    expect(splitObservationKey('edge:e1')).toEqual({ target: 'edge:e1' });
    expect(splitObservationKey('elevator:A_elevA')).toEqual({ target: 'elevator:A_elevA' });
  });
});

describe('dropOutliers / weightedMedian / blend', () => {
  it('drops values under prior / OUTLIER_RATIO and over prior × OUTLIER_RATIO, keeps the bounds', () => {
    expect(OUTLIER_RATIO).toBe(3);
    // prior 20 → keep 6.67 … 60
    const kept = dropOutliers([obs(6.6), obs(6.7), obs(20), obs(60), obs(60.1)], 20);
    expect(kept.map((o) => o.duration_sec)).toEqual([6.7, 20, 60]);
  });

  it('counts field twice and app once', () => {
    // [18, 18, 24, 26] → (18 + 24) / 2 = 21; unweighted it would be 24.
    expect(weightedMedian([obs(18), obs(24, { source: 'app' }), obs(26, { source: 'app' })])).toBe(21);
    // [10, 30, 30] → 30
    expect(weightedMedian([obs(10, { source: 'app' }), obs(30)])).toBe(30);
  });

  it('averages the middle two of an even count', () => {
    expect(weightedMedian([obs(20, { source: 'app' }), obs(30, { source: 'app' })])).toBe(25);
    expect(weightedMedian([obs(40, { source: 'app' }), obs(10, { source: 'app' }), obs(30, { source: 'app' }), obs(20, { source: 'app' })])).toBe(25);
  });

  it('has no median for no measurements', () => {
    expect(weightedMedian([])).toBeUndefined();
  });

  it('blends with K = CALIBRATION_K by default', () => {
    expect(CALIBRATION_K).toBe(3);
    expect(blend(19, 22, 5)).toBeCloseTo(20.875, 10);
    expect(blend(19, 22, 5, 0)).toBe(22);
  });
});

describe('calibrate', () => {
  it('one measurement stays near the prior (weights 3:1)', () => {
    const { calibration } = calibrate([obs(30)], priors({ 'edge:e_esc': 20 }), TODAY);
    expect(calibration['edge:e_esc']).toEqual({ prior_sec: 20, median_sec: 30, n: 1, estimate_sec: 22.5, updated_at: TODAY });
  });

  it('ten measurements land near the measured value', () => {
    const ten = Array.from({ length: 10 }, () => obs(30));
    const entry = calibrate(ten, priors({ 'edge:e_esc': 20 }), TODAY).calibration['edge:e_esc']!;
    expect(entry.n).toBe(10);
    expect(entry.estimate_sec).toBe(27.7); // (3×20 + 10×30) / 13 = 27.69
    expect(Math.abs(entry.estimate_sec - 30)).toBeLessThan(Math.abs(entry.estimate_sec - 20));
  });

  it('a wild measurement over prior × 3 is thrown away and changes nothing', () => {
    const base = [obs(22), obs(24), obs(26)];
    const without = calibrate(base, priors({ 'edge:e_esc': 20 }), TODAY);
    const withWild = calibrate([...base, obs(61)], priors({ 'edge:e_esc': 20 }), TODAY);
    expect(withWild).toEqual(without);
    expect(withWild.calibration['edge:e_esc']!.n).toBe(3);
  });

  it('weights field twice as much as app, but n counts measurements', () => {
    const entry = calibrate(
      [obs(18), obs(24, { source: 'app' }), obs(26, { source: 'app' })],
      priors({ 'edge:e_esc': 20 }),
      TODAY,
    ).calibration['edge:e_esc']!;
    expect(entry.median_sec).toBe(21);
    expect(entry.n).toBe(3);
    expect(entry.estimate_sec).toBe(20.5); // (60 + 63) / 6
  });

  it('uses the mean of the middle two for an even count', () => {
    const entry = calibrate([obs(20, { source: 'app' }), obs(30, { source: 'app' })], priors({ 'edge:e_esc': 20 }), TODAY)
      .calibration['edge:e_esc']!;
    expect(entry.median_sec).toBe(25);
    expect(entry.estimate_sec).toBe(22); // (60 + 50) / 5
  });

  it('groups backward edge measurements under #backward with their own prior', () => {
    const seen: string[] = [];
    const prior = (key: string) => {
      seen.push(key);
      return key.endsWith('#backward') ? 10 : 20;
    };
    const { calibration } = calibrate([obs(20), obs(12, { direction: 'backward' }), obs(20, { direction: 'forward' })], prior, TODAY);
    expect(seen.sort()).toEqual(['edge:e_esc', 'edge:e_esc#backward']);
    expect(calibration['edge:e_esc']).toMatchObject({ prior_sec: 20, median_sec: 20, n: 2 });
    expect(calibration['edge:e_esc#backward']).toMatchObject({ prior_sec: 10, median_sec: 12, n: 1, estimate_sec: 10.5 });
  });

  it('ignores direction on elevator targets', () => {
    const { calibration } = calibrate(
      [obs(30, { target: 'elevator:A_elevA', direction: 'backward' }), obs(40, { target: 'elevator:A_elevA' })],
      priors({ 'elevator:A_elevA': 35 }),
      TODAY,
    );
    expect(Object.keys(calibration)).toEqual(['elevator:A_elevA']);
    expect(calibration['elevator:A_elevA']).toMatchObject({ n: 2, median_sec: 35 });
  });

  it('leaves out a target whose measurements were all thrown away', () => {
    const result = calibrate([obs(100), obs(2)], priors({ 'edge:e_esc': 20 }), TODAY);
    expect(result.calibration).toEqual({});
    expect(result.allOutliers).toEqual(['edge:e_esc']);
    expect(result.skipped).toEqual([]);
  });

  it('skips targets without a prior and lists their keys', () => {
    const result = calibrate(
      [obs(20, { target: 'edge:gone' }), obs(20, { target: 'edge:gone', direction: 'backward' }), obs(20)],
      priors({ 'edge:e_esc': 20 }),
      TODAY,
    );
    expect(Object.keys(result.calibration)).toEqual(['edge:e_esc']);
    expect(result.skipped).toEqual(['edge:gone', 'edge:gone#backward']);
  });

  it('matches the SPEC example: prior 19, median 22, n 5 → 20.9', () => {
    const target = 'edge:e-ENG1-esc-up';
    const five = [20, 21, 22, 23, 24].map((d) => obs(d, { target }));
    expect(calibrate(five, priors({ [target]: 19 }), '2026-11-12').calibration).toEqual({
      [target]: { prior_sec: 19, median_sec: 22, n: 5, estimate_sec: 20.9, updated_at: '2026-11-12' },
    });
  });

  it('rounds prior, median and estimate to one decimal', () => {
    const entry = calibrate([obs(21.234)], priors({ 'edge:e_esc': 18.96 }), TODAY).calibration['edge:e_esc']!;
    expect(entry).toEqual({ prior_sec: 19, median_sec: 21.2, n: 1, estimate_sec: 19.5, updated_at: TODAY });
  });

  it('gives the same result for the same input twice and for any order of it', () => {
    const arbObs = fc.record({
      target: fc.constantFrom('edge:a', 'edge:b', 'elevator:L', 'edge:missing'),
      duration_sec: fc.integer({ min: 1, max: 1200 }).map((d) => d / 10),
      direction: fc.constantFrom('forward', 'backward'),
      source: fc.constantFrom('field', 'app'),
      measured_at: fc.constant(AT),
    }) as fc.Arbitrary<Observation>;
    const prior = priors({ 'edge:a': 20, 'edge:b': 8, 'edge:b#backward': 12, 'edge:a#backward': 15, 'elevator:L': 30 });

    fc.assert(
      fc.property(
        fc.array(arbObs, { maxLength: 30 }).chain((list) => fc.tuple(fc.constant(list), fc.shuffledSubarray(list, { minLength: list.length }))),
        ([list, shuffled]) => {
          const once = calibrate(list, prior, TODAY);
          expect(calibrate(list, prior, TODAY)).toEqual(once);
          expect(calibrate(shuffled, prior, TODAY)).toEqual(once);
          expect(Object.keys(once.calibration)).toEqual(Object.keys(once.calibration).sort());
          for (const e of Object.values(once.calibration)) {
            expect(e.n).toBeGreaterThan(0);
            // The estimate lies between the prior and the median (give or take rounding).
            expect(e.estimate_sec).toBeGreaterThanOrEqual(Math.min(e.prior_sec, e.median_sec) - 0.11);
            expect(e.estimate_sec).toBeLessThanOrEqual(Math.max(e.prior_sec, e.median_sec) + 0.11);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('parseObservations', () => {
  const good = JSON.stringify(obs(21.4, { direction: 'forward', note: '서서 탐' }));

  it('reads good lines with their line numbers and reports bad lines by line number', () => {
    const text = [
      good, // 1
      '', // 2: blank, skipped
      '{"target":"edge:e_esc",', // 3: not JSON
      JSON.stringify({ ...obs(20), user_id: 'u-123' }), // 4: unknown key
      JSON.stringify({ ...obs(20), duration_sec: -1 }), // 5
      '   ', // 6: blank
      JSON.stringify(obs(19, { source: 'app' })), // 7
      '', // trailing newline
    ].join('\r\n');
    const { observations, errors } = parseObservations(text);
    expect(observations.map((o) => o.line)).toEqual([1, 7]);
    expect(observations[0]!.record).toEqual(JSON.parse(good));
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(errors[0]!.message).toContain('JSON으로 읽을 수 없습니다');
    expect(errors[1]!.message).toContain('user_id');
    expect(errors[2]!.message).toContain('duration_sec');
  });

  it('accepts the SPEC example line', () => {
    const line = '{"target":"edge:e-ENG1-esc-up","duration_sec":21.4,"direction":"forward","source":"field","measured_at":"2026-11-12T09:10:00+09:00","note":"서서 탐"}';
    expect(parseObservations(line).errors).toEqual([]);
  });

  it('observationProblem follows the schema rules', () => {
    expect(observationProblem(obs(20))).toBeUndefined();
    expect(observationProblem([])).toBeDefined();
    expect(observationProblem({ ...obs(20), target: 'node:x' })).toContain('target');
    expect(observationProblem({ ...obs(20), source: 'phone' })).toContain('source');
    expect(observationProblem({ ...obs(20), direction: 'up' })).toContain('direction');
    expect(observationProblem({ ...obs(20), measured_at: '2026-11-12 09:10' })).toContain('measured_at');
    expect(observationProblem({ ...obs(20), lat: 37, lon: 127 })).toContain('lat, lon');
  });
});
