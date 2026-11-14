// Ported from the campo-elevation package (node:test → Vitest). Barometer window, volatile buffer, measure state machine,
// photo mapping. Run alone: npx vitest run packages/core/test/elevation/sensors.test.ts
import { assert, test } from 'vitest';

import {
  BarometerWindowSampler,
  PressureSessionBuffer,
  assignPhotosToRoute,
  classifyDirection,
  floorIdOfLevel,
  gradeWindow,
  madInlierMask,
  measureReducer,
  metersPerHpa,
  pressureToDh,
  scaleHeightM,
  type MeasureState,
  floorNodeKey,
  outdoorNodeKey,
  type BarometerWindowResult,
  type BuildingId,
  type FloorId,
  type PhotoId,
  type RouteId,
  type SessionId,
} from '../../src/elevation/index.ts';

/** 결정적 의사난수(정규) */
function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => ((s = (1664525 * s + 1013904223) >>> 0) / 2 ** 32);
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

/** 가상 10초 창: 기준 기압 p, 25 Hz, 노이즈 σ, 스파이크 몇 개 */
function simulateWindow(p: number, t0: number, opts: { hz?: number; noise?: number; spikes?: number; move?: boolean; seed?: number } = {}) {
  const { hz = 25, noise = 0.012, spikes = 2, move = false, seed = 1 } = opts;
  const g = rng(seed);
  const s = new BarometerWindowSampler(hz < 5 ? 'ios' : 'android', { minSamples: hz < 5 ? 7 : 20 });
  s.start(t0);
  const n = Math.round(10 * hz);
  for (let i = 0; i < n; i++) {
    const at = t0 + (i * 1000) / hz;
    let v = p + noise * g();
    if (i % Math.max(1, Math.floor(n / (spikes + 1))) === 0 && i > 0 && spikes > 0) v += 0.8; // 문 쾅 스파이크
    s.pushPressure({ at, sensorTs: at / 1000, pHpa: v });
    const shake = move ? 0.2 * g() : 0.004 * g();
    s.pushAccel({ at, x: 0.01 + shake, y: 0.02, z: 1 + shake });
  }
  const r = s.finalize(t0 + 10_000);
  if (!r) throw new Error('no window');
  return r;
}

test('hypsometric: 15°C·1013 hPa에서 약 8.3 m/hPa', () => {
  assert.ok(Math.abs(scaleHeightM(15) - 8435) < 5);
  const k = metersPerHpa(1013.25, 15);
  assert.ok(k > 8.2 && k < 8.4, `k=${k}`);
  // 높은 곳일수록 기압이 낮다 → pA > pB 이면 Δh > 0
  assert.ok(pressureToDh(1010, 1009.5, 15) > 4);
});

test('MAD: 스파이크 제거, 양자화(MAD=0)에서도 정상값 보존', () => {
  const xs = [1010.0, 1010.01, 1010.0, 1010.0, 1011.5, 1010.01, 1010.0];
  const m = madInlierMask(xs, 3.5);
  assert.deepEqual(m, [true, true, true, true, false, true, true]);
  const flat = [1010, 1010, 1010, 1010, 1010.01];
  assert.ok(madInlierMask(flat, 3.5).every(Boolean));
});

test('창 수집: 평균은 참값 근처, 스파이크는 제거, 정지 판정 통과', () => {
  const r = simulateWindow(1008.4, 1_000_000, { spikes: 3 });
  assert.ok(Math.abs(r.meanPressureHpa - 1008.4) < 0.01, `mean=${r.meanPressureHpa}`);
  assert.ok(r.rejectedCount >= 3);
  assert.ok(r.stationaryRatio > 0.9);
  assert.equal(gradeWindow(r), 'good');
});

test('창 수집: 흔들면 DEVICE_MOVED → retry', () => {
  const r = simulateWindow(1008.4, 0, { move: true });
  assert.ok(r.warnings.includes('DEVICE_MOVED'));
  assert.equal(gradeWindow(r), 'retry');
});

test('창 수집: iOS 1 Hz도 10개 내외로 결과 산출', () => {
  const r = simulateWindow(1008.4, 0, { hz: 1, spikes: 0 });
  assert.ok(r.sampleCount >= 9 && r.sampleCount <= 11);
  assert.equal(r.platform, 'ios');
});

function fakeWindow(p: number, tMs: number, se = 0.004): BarometerWindowResult {
  return {
    meanPressureHpa: p, stdHpa: se * Math.sqrt(100), sampleCount: 100, timestamp: tMs,
    startedAt: tMs - 5000, endedAt: tMs + 5000, rejectedCount: 0, stdErrHpa: se,
    slopeHpaPerS: 0, stationaryRatio: 1, warnings: [], platform: 'android',
  };
}

test('버퍼: 연속 측정 → static_pair, A→B→A → roundtrip이 드리프트 제거 + 기존 엣지 대체', () => {
  let clock = 0;
  let id = 0;
  const buf = new PressureSessionBuffer({}, () => `id${++id}`, () => clock);
  const sid = 's1' as SessionId;
  const A = outdoorNodeKey('A');
  const B = floorNodeKey('eng1' as BuildingId, '3F' as FloorId);
  const k = metersPerHpa(1010, 15);
  const trueDh = 9.0; // B가 9 m 높음
  const dpTrue = trueDh / k;
  const drift = 0.6 / 3600_000; // 0.6 hPa/h 하강(날씨)

  const pAt = (base: number, t: number) => base - drift * t;
  clock = 0;
  const r1 = buf.add({ sessionId: sid, nodeKey: A, window: fakeWindow(pAt(1010, 0), 0) });
  assert.equal(r1.newEdges.length, 0);

  clock = 6 * 60_000;
  const r2 = buf.add({ sessionId: sid, nodeKey: B, window: fakeWindow(pAt(1010 - dpTrue, clock), clock) });
  assert.equal(r2.newEdges.length, 1);
  const pair = r2.newEdges[0]!;
  assert.equal(pair.method, 'static_pair');
  // 드리프트 0.06 hPa → 약 0.5 m 과대
  assert.ok(pair.dhM - trueDh > 0.4, `pair bias ${pair.dhM - trueDh}`);

  clock = 12 * 60_000;
  const r3 = buf.add({ sessionId: sid, nodeKey: A, window: fakeWindow(pAt(1010, clock), clock) });
  const rt = r3.newEdges.find((e) => e.method === 'roundtrip');
  if (!rt) throw new Error('roundtrip edge expected');
  assert.ok(Math.abs(rt.dhM - trueDh) < 0.02, `roundtrip err ${rt.dhM - trueDh}`);
  assert.ok(rt.sigmaM < pair.sigmaM);
  assert.deepEqual(r3.supersede, [pair.edgeId]); // 이전에 내보낸 pair만 대체 요청
  assert.equal(r3.newEdges.filter((e) => e.method === 'static_pair').length, 0);
  // 영속 엣지에는 기압 필드가 없다
  assert.ok(!Object.keys(rt).some((key) => /pressure|hpa/i.test(key)));
});

test('버퍼: 다른 세션끼리는 절대 짝짓지 않음, TTL 지나면 절대기압 폐기', () => {
  let clock = 0;
  const buf = new PressureSessionBuffer({}, undefined, () => clock);
  buf.add({ sessionId: 'phoneA' as SessionId, nodeKey: outdoorNodeKey('x'), window: fakeWindow(1010, 0) });
  const r = buf.add({ sessionId: 'phoneB' as SessionId, nodeKey: outdoorNodeKey('y'), window: fakeWindow(1009, 1000) });
  assert.equal(r.newEdges.length, 0);
  clock = 31 * 60_000;
  assert.equal(buf.purgeExpired(clock), 2);
  assert.equal(buf.list().length, 0);
});

test('버퍼: 30분 초과 간격은 엣지 없음', () => {
  let clock = 0;
  const buf = new PressureSessionBuffer({ bufferTtlMin: 60 }, undefined, () => clock);
  const sid = 's' as SessionId;
  buf.add({ sessionId: sid, nodeKey: outdoorNodeKey('a'), window: fakeWindow(1010, 0) });
  clock = 35 * 60_000;
  const r = buf.add({ sessionId: sid, nodeKey: outdoorNodeKey('b'), window: fakeWindow(1009, clock) });
  assert.equal(r.newEdges.length, 0);
});

test('상태 머신: 정상 흐름 + 백그라운드 중단 + 기압계 없음 → 숨김', () => {
  let s: MeasureState = { tag: 'hidden' };
  const target = { kind: 'outdoor' as const, position: { lat: 37.557, lng: 127.045 }, influenceRadiusM: 1 };
  s = measureReducer(s, { type: 'ENABLE' });
  s = measureReducer(s, { type: 'FAB_PRESS' });
  s = measureReducer(s, { type: 'CROSSHAIR_CONFIRM', target });
  s = measureReducer(s, { type: 'START' });
  s = measureReducer(s, { type: 'PREP_OK', now: 0, settleMs: 2000 });
  assert.equal(s.tag, 'settling');
  s = measureReducer(s, { type: 'SETTLE_DONE' });
  const interrupted = measureReducer(s, { type: 'INTERRUPT', reason: 'app_background' });
  assert.equal(interrupted.tag, 'interrupted');
  s = measureReducer(s, { type: 'SAMPLE_DONE', result: fakeWindow(1010, 0) });
  assert.equal(s.tag, 'reviewing');
  s = measureReducer(s, { type: 'SAVE' });
  s = measureReducer(s, { type: 'COMMIT_OK', edgesCreated: 1, diagnostics: [] });
  assert.equal(s.tag, 'done');

  let e: MeasureState = { tag: 'preparing', target };
  e = measureReducer(e, { type: 'PREP_FAIL', reason: 'barometer_unavailable' });
  e = measureReducer(e, { type: 'DISMISS' });
  assert.equal(e.tag, 'hidden');
});

test('상태 머신: retry 등급 결과는 저장 불가', () => {
  const target = { kind: 'outdoor' as const, position: { lat: 0, lng: 0 }, influenceRadiusM: 1 };
  const bad = { ...fakeWindow(1010, 0), warnings: ['DEVICE_MOVED' as const] };
  let s: MeasureState = { tag: 'sampling', target };
  s = measureReducer(s, { type: 'SAMPLE_DONE', result: bad });
  assert.equal(s.tag, 'reviewing');
  assert.equal(measureReducer(s, { type: 'SAVE' }).tag, 'reviewing');
});

test('사진 매핑: 지운 사진 제외, 정/역방향 판정, 앵커 시간보간', () => {
  const poly = [{ lat: 37.5570, lng: 127.0440 }, { lat: 37.5579, lng: 127.0440 }]; // 정북 100 m
  const passes = [
    { sessionId: 's' as SessionId, nodeKey: outdoorNodeKey('a'), at: 0, alongM: 0, how: 'user_tap' as const },
    { sessionId: 's' as SessionId, nodeKey: outdoorNodeKey('b'), at: 100_000, alongM: 100, how: 'user_tap' as const },
  ];
  const base = { sessionId: 's' as SessionId, localUri: 'file://x', headingAccuracyDeg: 10 };
  const photos = [
    { ...base, photoId: 'p1' as PhotoId, capturedAt: 20_000, headingDeg: 5, decision: 'kept' as const },
    { ...base, photoId: 'p2' as PhotoId, capturedAt: 50_000, headingDeg: 182, decision: 'kept' as const },
    { ...base, photoId: 'p3' as PhotoId, capturedAt: 60_000, headingDeg: 0, decision: 'discarded' as const },
    { ...base, photoId: 'p4' as PhotoId, capturedAt: 70_000, headingDeg: 90, decision: 'kept' as const },
  ];
  const as = assignPhotosToRoute('r' as RouteId, poly, photos, passes);
  assert.deepEqual(as.map((a) => [a.photoId, a.direction]), [['p1', 'forward'], ['p2', 'backward'], ['p4', 'side']]);
  assert.ok(Math.abs(as[0]!.alongM - 20) < 0.5);
  assert.equal(classifyDirection(undefined, 0).direction, 'unknown');
});

test('floorIdOfLevel: campus levels (no 0) map to floor ids that share one height variable', () => {
  assert.equal(floorIdOfLevel(3), '3F');
  assert.equal(floorIdOfLevel(-1), 'B1');
  assert.equal(floorNodeKey('bldg_ENG1', floorIdOfLevel(1)), 'fp:bldg_ENG1:1F');
  assert.throws(() => floorIdOfLevel(0));
  assert.throws(() => floorIdOfLevel(1.5));
});
