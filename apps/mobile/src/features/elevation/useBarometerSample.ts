/**
 * useBarometerSample — Expo SDK 58 / expo-sensors 58 기준 10초 정지 기압 측정 훅
 *
 * 반환: start() → Promise<BarometerWindowResult>
 *   (meanPressureHpa, stdHpa, sampleCount, timestamp + 품질 정보)
 *
 * expo-sensors 58 네이티브 구현에서 확인한 사실(공식 문서 + 소스):
 *  - 단위: 양 플랫폼 모두 hPa (iOS CMAltimeter의 kPa를 모듈이 ×10 변환)
 *  - relativeAltitude: iOS 전용(Android 이벤트에는 필드 없음)
 *  - iOS setUpdateInterval: no-op("Nothing we can do") → CMAltimeter 고정 주기(약 1 Hz)
 *  - Android setUpdateInterval: JS로 보내는 이벤트를 간격(기본 100 ms)으로 솎아낼 뿐,
 *    센서 등록은 SENSOR_DELAY_NORMAL(HIGH_SAMPLING_RATE_SENSORS 권한이 있으면 FASTEST).
 *    → 10초에 Android는 수십 개, iOS는 10개 안팎.
 *  - Android: 앱이 백그라운드로 가면 SensorProxy가 구독을 멈춘다(onHostPause).
 *  - timestamp: 부팅 기준 초(에폭 아님) → 시간창 매칭은 Date.now() 사용.
 *  - iOS 시뮬레이터에는 기압계 없음 → 실기기 테스트 필수.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { Accelerometer, Barometer } from 'expo-sensors';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import {
  BarometerWindowSampler,
  type BarometerWindowResult,
  type LiveSnapshot,
  type WindowConfig,
} from '@campo/core/elevation';

const KEEP_AWAKE_TAG = 'campo-barometer-window';

export type SampleStatus = 'idle' | 'checking' | 'settling' | 'sampling' | 'done' | 'error';

export class BarometerSampleError extends Error {
  constructor(
    public readonly code:
      | 'barometer_unavailable'
      | 'permission_denied'
      | 'app_background'
      | 'no_samples'
      | 'cancelled'
      | 'busy',
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface UseBarometerSampleOptions {
  /** 측정 길이(기본 10 s) */
  durationMs?: number;
  /** 측정 전 안정화(버림) 구간(기본 2 s). 기압계 응답 지연·손 떨림 흡수 */
  settleMs?: number;
  /** UI 갱신 주기(ms). 샘플마다 리렌더하지 않도록 */
  uiTickMs?: number;
  /** Android 이벤트 솎음 간격(ms). iOS는 무시됨 */
  barometerIntervalMs?: number;
  accelIntervalMs?: number;
  window?: Partial<WindowConfig>;
}

export interface BarometerSampleState {
  status: SampleStatus;
  /** 안정화 구간에도 현재 기압은 보여 준다(값은 결과에 포함 안 됨) */
  currentHpa: number | null;
  live: LiveSnapshot | null;
  settleRemainingMs: number;
  result: BarometerWindowResult | null;
  error: BarometerSampleError | null;
}

const INITIAL: BarometerSampleState = {
  status: 'idle',
  currentHpa: null,
  live: null,
  settleRemainingMs: 0,
  result: null,
  error: null,
};

/** 기압계 존재 여부(측정 FAB 노출 여부 결정용). 예외는 false로 취급 */
export async function isBarometerUsable(): Promise<boolean> {
  try {
    return await Barometer.isAvailableAsync();
  } catch {
    return false;
  }
}

export function useBarometerSample(opts: UseBarometerSampleOptions = {}) {
  const {
    durationMs = 10_000,
    settleMs = 2_000,
    uiTickMs = 250,
    barometerIntervalMs = 50,
    accelIntervalMs = 50,
  } = opts;

  const [state, setState] = useState<BarometerSampleState>(INITIAL);

  // 렌더와 무관한 가변 상태는 ref로
  const runRef = useRef<{
    sampler: BarometerWindowSampler;
    subs: { remove(): void }[];
    timer: ReturnType<typeof setInterval> | null;
    appStateSub: { remove(): void } | null;
    settleUntil: number;
    lastP: number | null;
    resolve: (r: BarometerWindowResult) => void;
    reject: (e: BarometerSampleError) => void;
  } | null>(null);
  const windowCfgRef = useRef(opts.window);
  windowCfgRef.current = opts.window;

  const cleanup = useCallback(() => {
    const run = runRef.current;
    if (!run) return;
    run.subs.forEach((s) => {
      try { s.remove(); } catch { /* noop */ }
    });
    if (run.timer) clearInterval(run.timer);
    run.appStateSub?.remove();
    runRef.current = null;
    // 실패해도 측정 결과에는 영향 없음
    deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
  }, []);

  const fail = useCallback(
    (err: BarometerSampleError) => {
      const run = runRef.current;
      cleanup();
      setState((s) => ({ ...s, status: 'error', error: err }));
      run?.reject(err);
    },
    [cleanup],
  );

  const cancel = useCallback(() => {
    if (runRef.current) fail(new BarometerSampleError('cancelled'));
    else setState(INITIAL);
  }, [fail]);

  const start = useCallback(async (): Promise<BarometerWindowResult> => {
    if (runRef.current) throw new BarometerSampleError('busy');
    setState({ ...INITIAL, status: 'checking' });

    // 1) 가용성 — isAvailableAsync는 네이티브 모듈 부재 시 false, 드물게 throw
    if (!(await isBarometerUsable())) {
      const e = new BarometerSampleError('barometer_unavailable');
      setState({ ...INITIAL, status: 'error', error: e });
      throw e;
    }

    // 2) 권한 — iOS는 '동작 및 피트니스'(NSMotionUsageDescription) 필요. Android는 기본 granted
    try {
      let perm = await Barometer.getPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) perm = await Barometer.requestPermissionsAsync();
      if (!perm.granted) throw new BarometerSampleError('permission_denied');
    } catch (err) {
      const e = err instanceof BarometerSampleError ? err : new BarometerSampleError('permission_denied', String(err));
      setState({ ...INITIAL, status: 'error', error: e });
      throw e;
    }

    let accelOk = false;
    try { accelOk = await Accelerometer.isAvailableAsync(); } catch { accelOk = false; }

    // 3) 화면 꺼짐 방지 — 실패해도 진행(사용자에게는 '화면을 켜 두세요' 안내)
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);

    return new Promise<BarometerWindowResult>((resolve, reject) => {
      const platform = Platform.OS === 'ios' ? 'ios' : 'android';
      const sampler = new BarometerWindowSampler(platform, {
        durationMs,
        // iOS는 약 1 Hz → 최소 표본 기준을 낮춘다
        minSamples: platform === 'ios' ? 7 : 20,
        ...windowCfgRef.current,
      });
      const settleUntil = Date.now() + settleMs;
      const run = {
        sampler,
        subs: [] as { remove(): void }[],
        timer: null as ReturnType<typeof setInterval> | null,
        appStateSub: null as { remove(): void } | null,
        settleUntil,
        lastP: null as number | null,
        resolve,
        reject,
      };
      runRef.current = run;

      Barometer.setUpdateInterval(barometerIntervalMs);
      run.subs.push(
        Barometer.addListener(({ pressure, timestamp }) => {
          const at = Date.now();
          run.lastP = pressure;
          if (at >= run.settleUntil) {
            if (!sampler.isStarted) sampler.start(at);
            sampler.pushPressure({ at, sensorTs: timestamp, pHpa: pressure });
          }
        }),
      );

      if (accelOk) {
        Accelerometer.setUpdateInterval(accelIntervalMs);
        run.subs.push(
          Accelerometer.addListener(({ x, y, z }) => {
            const at = Date.now();
            if (sampler.isStarted) sampler.pushAccel({ at, x, y, z });
          }),
        );
      }

      // 백그라운드 전환 = 측정 무효(Android는 센서가 멈추고, iOS도 큐가 중단될 수 있음)
      run.appStateSub = AppState.addEventListener('change', (st: AppStateStatus) => {
        if (st !== 'active') fail(new BarometerSampleError('app_background'));
      });

      setState({ ...INITIAL, status: 'settling', settleRemainingMs: settleMs });

      run.timer = setInterval(() => {
        const now = Date.now();
        if (now < run.settleUntil) {
          setState((s) => ({ ...s, status: 'settling', currentHpa: run.lastP, settleRemainingMs: run.settleUntil - now }));
          return;
        }
        // 첫 기압 이벤트가 아직 안 왔으면(iOS 첫 이벤트 지연) 창 시작을 기다린다
        if (!sampler.isStarted) {
          if (now - run.settleUntil > 3_000) fail(new BarometerSampleError('no_samples'));
          return;
        }
        const live = sampler.snapshot(now);
        if (sampler.isDone(now)) {
          const result = sampler.finalize(now);
          cleanup();
          if (!result) {
            const e = new BarometerSampleError('no_samples');
            setState((s) => ({ ...s, status: 'error', error: e }));
            reject(e);
            return;
          }
          setState((s) => ({ ...s, status: 'done', live, currentHpa: live.currentHpa, result }));
          resolve(result);
          return;
        }
        setState((s) => ({ ...s, status: 'sampling', live, currentHpa: live.currentHpa, settleRemainingMs: 0 }));
      }, uiTickMs);
    });
  }, [accelIntervalMs, barometerIntervalMs, cleanup, durationMs, fail, settleMs, uiTickMs]);

  // 언마운트 시 구독/keep-awake 정리 — 대기 중 Promise는 cancelled로 reject
  useEffect(() => () => {
    if (runRef.current) {
      const r = runRef.current;
      cleanup();
      r.reject(new BarometerSampleError('cancelled'));
    }
  }, [cleanup]);

  const reset = useCallback(() => {
    if (!runRef.current) setState(INITIAL);
  }, []);

  return { ...state, start, cancel, reset };
}
