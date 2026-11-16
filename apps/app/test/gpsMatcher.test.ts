import { describe, expect, it } from 'vitest';
import type { SensorFix } from '@campo/core';
import { createGpsMatcherSession } from '../src/matching/matcherSession.ts';
import { fixtureRuntime } from './helpers.ts';

// e_out_0001__out_0002: (127, 37) → (127.0002, 37.0004), 약 48 m 보도.
const START: [number, number] = [127, 37];
const END: [number, number] = [127.0002, 37.0004];

/** 걸어가는 표본: 1초에 한 개, t초 뒤 위치. */
function walkFix(seconds: number, totalSeconds = 24): SensorFix {
  const share = Math.min(1, seconds / totalSeconds);
  return {
    tMs: 1_000_000 + seconds * 1000,
    lat: START[1] + (END[1] - START[1]) * share,
    lng: START[0] + (END[0] - START[0]) * share,
    accuracyM: 6,
  };
}

describe('createGpsMatcherSession', () => {
  it('걸어가는 표본을 망 위의 위치와 모드로 돌려준다', async () => {
    const runtime = await fixtureRuntime();
    const session = createGpsMatcherSession(runtime.network);

    let snapshot = session.snapshot();
    expect(snapshot.position).toBeNull();

    for (let second = 0; second < 8; second++) snapshot = session.pushFix(walkFix(second));

    expect(snapshot.position).not.toBeNull();
    expect(snapshot.mode).toBe('OUTDOOR');
    expect(snapshot.fixCount).toBe(8);
    expect(snapshot.position!.confidence).toBeGreaterThan(0.5);
    expect(snapshot.position!.skipped).toBe(false);
    expect(snapshot.position!.lat).toBeCloseTo(START[1], 2);
    // 걸어가는 동안에는 안내 이벤트가 없어도 된다(있으면 한국어 문장이어야 한다).
    expect(snapshot.messages.every((message) => message.length > 0)).toBe(true);
  });

  it('정확도가 나쁜 표본은 건너뛰고 직전 위치를 유지한다', async () => {
    const runtime = await fixtureRuntime();
    const session = createGpsMatcherSession(runtime.network);
    for (let second = 0; second < 5; second++) session.pushFix(walkFix(second));
    const before = session.snapshot();

    const outlier = session.pushFix({ tMs: 1_000_000 + 5000, lat: 37.05, lng: 127.05, accuracyM: 200 });

    expect(outlier.position!.skipped).toBe(true);
    expect(outlier.position!.lat).toBeCloseTo(before.position!.lat, 5);
    expect(outlier.fixCount).toBe(before.fixCount);
  });

  it('망에서 멀리 벗어나 걷으면 REROUTE를 알린다', async () => {
    const runtime = await fixtureRuntime();
    const session = createGpsMatcherSession(runtime.network);
    for (let second = 0; second < 4; second++) session.pushFix(walkFix(second));

    let rerouted = false;
    for (let second = 4; second < 30 && !rerouted; second++) {
      // 캠퍼스 밖으로 3 m/s로 걸어간다 (fix 사이 3 m 이상 움직여야 이동으로 센다).
      const fix: SensorFix = { tMs: 1_000_000 + second * 1000, lat: 37.02 + second * 0.00003, lng: 127.02 + second * 0.00003, accuracyM: 6 };
      const snapshot = session.pushFix(fix);
      rerouted = snapshot.rerouteRequested;
      if (rerouted) expect(snapshot.messages.join(' ')).toContain('새 경로');
    }
    expect(rerouted).toBe(true);
  });

  it('경로를 넣고 바꾸고 초기화할 수 있다', async () => {
    const runtime = await fixtureRuntime();
    const session = createGpsMatcherSession(runtime.network, { routeNodeIds: ['n_out_0001', 'n_out_0002'] });
    expect(session.snapshot().position).toBeNull();

    session.pushFix(walkFix(0));
    session.setRoute(null);
    session.setRoute([]);
    session.setRoute([1, 2].map(() => 'n_out_0002'));

    session.reset();
    expect(session.snapshot().position).toBeNull();
    expect(session.snapshot().fixCount).toBe(0);
  });
});
