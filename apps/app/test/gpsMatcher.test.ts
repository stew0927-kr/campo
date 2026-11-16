import { describe, expect, it } from 'vitest';
import type { SensorFix } from '@campo/core';
import { createGpsMatcherSession, routeKeyOf } from '../src/matching/matcherSession.ts';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import { META, bundleFrom, fixtureRuntime } from './helpers.ts';

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

  it('경로를 바꿔도 추적 상태(위치·표본 수)는 이어진다', async () => {
    const runtime = await fixtureRuntime();
    const session = createGpsMatcherSession(runtime.network, { routeNodeIds: ['n_out_0001', 'n_out_0002'] });
    for (let second = 0; second < 6; second++) session.pushFix(walkFix(second));
    const before = session.snapshot();
    expect(before.fixCount).toBe(6);

    // 재탐색 뒤 새 경로를 넣는 상황: 세션을 새로 만들지 않고 setRoute만 부른다.
    session.setRoute(['n_out_0002', 'n_out_0001']);
    session.setRoute(null);
    session.setRoute([]);
    session.setRoute(['unknown_a', 'unknown_b']);

    expect(session.snapshot()).toBe(before);
    const next = session.pushFix(walkFix(6));
    expect(next.fixCount).toBe(7);
    expect(next.position).not.toBeNull();
    expect(next.mode).toBe(before.mode);
  });

  it('초기화하면 처음부터 다시 시작한다', async () => {
    const runtime = await fixtureRuntime();
    const session = createGpsMatcherSession(runtime.network, { routeNodeIds: ['n_out_0001', 'n_out_0002'] });
    expect(session.snapshot().position).toBeNull();

    for (let second = 0; second < 3; second++) session.pushFix(walkFix(second));
    expect(session.snapshot().fixCount).toBe(3);

    session.reset();
    expect(session.snapshot().position).toBeNull();
    expect(session.snapshot().fixCount).toBe(0);
    expect(session.pushFix(walkFix(3)).fixCount).toBe(1);
  });

  it('데이터가 비어 있는 망(현재 한양대 번들)에서도 던지지 않는다', () => {
    const empty = loadBundledCampus(bundleFrom(META, []));
    const session = createGpsMatcherSession(empty.network);
    const snapshot = session.pushFix({ tMs: 1000, lat: 37.0, lng: 127.0, accuracyM: 8 });
    expect(snapshot.mode).toBe('OUTDOOR');
    expect(snapshot.rerouteRequested).toBe(false);
  });
});

describe('routeKeyOf', () => {
  it('내용이 같으면 새 배열이어도 같은 키, null·빈 배열·undefined는 모두 빈 키', () => {
    expect(routeKeyOf(['a', 'b'])).toBe(routeKeyOf(['a', 'b']));
    expect(routeKeyOf(['a', 'b'])).not.toBe(routeKeyOf(['b', 'a']));
    expect(routeKeyOf(null)).toBe('');
    expect(routeKeyOf([])).toBe('');
    expect(routeKeyOf(undefined)).toBe('');
  });
});
