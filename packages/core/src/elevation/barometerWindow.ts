/**
 * 10초 기압 창 수집기 — 순수 TS(React/Expo 의존 없음, 단위 테스트 가능)
 *
 * 하는 일
 *  - 실시간 현재 기압, 실시간 누적 평균(Welford)
 *  - 가속도 크기의 이동 표준편차로 정지 판별
 *  - 종료 시 MAD 기반 이상치 제거 → (meanPressureHpa, stdHpa, sampleCount, timestamp …)
 *
 * 시간 기준 주의 (expo-sensors 58 네이티브 소스 확인)
 *  - Android: timestamp = SensorEvent.timestamp(ns, 부팅 기준) / 1e9
 *  - iOS:     timestamp = CMLogItem.timestamp(s, 부팅 기준)
 *  → 둘 다 '부팅 후 초'이므로 에폭 시각이 아니다. 시간창 매칭에는 수신 시각 Date.now()를 쓰고,
 *    센서 timestamp는 중복 이벤트 제거·간격 계산에만 쓴다.
 */
import type { BarometerWarning, BarometerWindowResult, EpochMs, Platform } from './types.ts';

export interface PressureSample {
  /** 수신 시각(에폭 ms) */
  at: EpochMs;
  /** 센서 timestamp(부팅 후 초) — 중복 제거용 */
  sensorTs?: number;
  pHpa: number;
}

export interface AccelSample {
  at: EpochMs;
  /** g 단위(expo-sensors: Android도 GRAVITY_EARTH로 나눠 g로 맞춰 줌) */
  x: number;
  y: number;
  z: number;
}

export interface WindowConfig {
  durationMs: number;
  /** MAD 컷 배수(정규분포 환산 σ 기준). 3.5가 흔한 기본값 */
  madK: number;
  /** 이 값보다 표본이 적으면 경고 */
  minSamples: number;
  /** 가속도 크기 표준편차(g) 임계 — 이하면 '정지' */
  stillAccelStdG: number;
  /** 가속도 정지 판정 윈도(ms) */
  accelWindowMs: number;
  /** 정지 비율이 이 값 미만이면 DEVICE_MOVED */
  minStationaryRatio: number;
  /** 이상치 제거 후 표준편차가 이 값 초과면 UNSTABLE_PRESSURE (0.06 hPa ≈ 0.5 m) */
  unstableStdHpa: number;
  /** |추세| 초과 시 PRESSURE_TREND (0.01 hPa/s ≈ 10초에 0.8 m) */
  trendHpaPerS: number;
}

export const DEFAULT_WINDOW_CONFIG: WindowConfig = {
  durationMs: 10_000,
  madK: 3.5,
  minSamples: 8,
  stillAccelStdG: 0.03,
  accelWindowMs: 1_000,
  minStationaryRatio: 0.8,
  unstableStdHpa: 0.06,
  trendHpaPerS: 0.01,
};

/* ---------------- 통계 유틸 ---------------- */

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** 정규분포 일치 MAD(=1.4826·median|x−med|) */
export function madSigma(xs: readonly number[], med = median(xs)): number {
  return 1.4826 * median(xs.map((x) => Math.abs(x - med)));
}

/**
 * MAD 이상치 마스크. MAD=0(값이 거의 같음; 센서 해상도 0.01 hPa 양자화) 이면
 * 해상도 하한을 둬서 정상값이 전부 잘리는 일을 막는다.
 */
export function madInlierMask(xs: readonly number[], k: number, floor = 0.005): boolean[] {
  const med = median(xs);
  const s = Math.max(madSigma(xs, med), floor);
  return xs.map((x) => Math.abs(x - med) <= k * s);
}

/** 최소제곱 기울기(y per x) */
export function slope(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  if (n < 2) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]!; my += y[i]!; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i]! - mx) * (y[i]! - my); sxx += (x[i]! - mx) ** 2; }
  return sxx > 0 ? sxy / sxx : 0;
}

/** Welford 온라인 평균/분산 */
export class RunningStats {
  n = 0;
  mean = 0;
  private m2 = 0;
  push(x: number) {
    this.n += 1;
    const d = x - this.mean;
    this.mean += d / this.n;
    this.m2 += d * (x - this.mean);
  }
  get std(): number {
    return this.n > 1 ? Math.sqrt(this.m2 / (this.n - 1)) : 0;
  }
}

/* ---------------- 창 수집기 ---------------- */

export interface LiveSnapshot {
  currentHpa: number | null;
  runningMeanHpa: number | null;
  runningStdHpa: number;
  sampleCount: number;
  elapsedMs: number;
  remainingMs: number;
  /** 최근 accelWindowMs 동안 정지 상태인지(가속도 없으면 null) */
  stationaryNow: boolean | null;
  /** UI '바람 주의' 배지용: 실시간 표준편차가 임계 초과 */
  windWarning: boolean;
}

export class BarometerWindowSampler {
  private readonly cfg: WindowConfig;
  private readonly p: PressureSample[] = [];
  private readonly a: AccelSample[] = [];
  private readonly live = new RunningStats();
  private startedAt: EpochMs | null = null;
  private lastSensorTs: number | null = null;
  /** 정지 판정 결과 누적(가속도 이벤트마다 1표) */
  private stillVotes = 0;
  private totalVotes = 0;

  constructor(private readonly platform: Platform, cfg: Partial<WindowConfig> = {}) {
    this.cfg = { ...DEFAULT_WINDOW_CONFIG, ...cfg };
  }

  start(now: EpochMs) {
    this.startedAt = now;
  }

  get isStarted() {
    return this.startedAt !== null;
  }

  isDone(now: EpochMs) {
    return this.startedAt !== null && now - this.startedAt >= this.cfg.durationMs;
  }

  pushPressure(s: PressureSample) {
    if (this.startedAt === null || !Number.isFinite(s.pHpa)) return;
    // 물리적으로 불가능한 값(센서 초기화 0, 단위 오류 kPa 등) 차단
    if (s.pHpa < 300 || s.pHpa > 1100) return;
    if (s.sensorTs !== undefined && this.lastSensorTs !== null && s.sensorTs <= this.lastSensorTs) return;
    if (s.sensorTs !== undefined) this.lastSensorTs = s.sensorTs;
    this.p.push(s);
    this.live.push(s.pHpa);
  }

  pushAccel(s: AccelSample) {
    if (this.startedAt === null) return;
    this.a.push(s);
    const still = this.stillNow();
    if (still !== null) {
      this.totalVotes += 1;
      if (still) this.stillVotes += 1;
    }
  }

  /** 마지막 가속도 표본까지 accelWindowMs 동안 |a| 표준편차가 임계 이하인지. 표본 3개 미만이면 null */
  private stillNow(): boolean | null {
    const lastAt = this.a[this.a.length - 1]?.at;
    if (lastAt === undefined) return null;
    const from = lastAt - this.cfg.accelWindowMs;
    const st = new RunningStats();
    for (let i = this.a.length - 1; i >= 0; i--) {
      const q = this.a[i]!;
      if (q.at < from) break;
      st.push(Math.hypot(q.x, q.y, q.z));
    }
    return st.n >= 3 ? st.std <= this.cfg.stillAccelStdG : null;
  }

  snapshot(now: EpochMs): LiveSnapshot {
    const elapsed = this.startedAt === null ? 0 : now - this.startedAt;
    const last = this.p.length ? this.p[this.p.length - 1]!.pHpa : null;
    const stationaryNow = this.stillNow();
    return {
      currentHpa: last,
      runningMeanHpa: this.live.n ? this.live.mean : null,
      runningStdHpa: this.live.std,
      sampleCount: this.live.n,
      elapsedMs: elapsed,
      remainingMs: Math.max(0, this.cfg.durationMs - elapsed),
      stationaryNow,
      windWarning: this.live.n >= 5 && this.live.std > this.cfg.unstableStdHpa,
    };
  }

  /** 창 종료 → 이상치 제거 + 요약. 표본이 하나도 없으면 null */
  finalize(now: EpochMs): BarometerWindowResult | null {
    if (this.startedAt === null || this.p.length === 0) return null;
    const ps = this.p.map((s) => s.pHpa);
    const mask = madInlierMask(ps, this.cfg.madK);
    const kept = this.p.filter((_, i) => mask[i]);
    const firstKept = kept[0];
    const lastKept = kept[kept.length - 1];
    // MAD 하한 > 0이라 중앙값 근처 절반은 항상 남지만, 타입상 빈 경우도 막아 둔다.
    if (!firstKept || !lastKept) return null;
    const st = new RunningStats();
    kept.forEach((s) => st.push(s.pHpa));

    const t0 = firstKept.at;
    const tr = slope(kept.map((s) => (s.at - t0) / 1000), kept.map((s) => s.pHpa));
    const stationaryRatio = this.totalVotes ? this.stillVotes / this.totalVotes : NaN;

    const warnings: BarometerWarning[] = [];
    if (kept.length < this.cfg.minSamples) warnings.push('LOW_SAMPLE_COUNT');
    if (st.std > this.cfg.unstableStdHpa) warnings.push('UNSTABLE_PRESSURE');
    if (Math.abs(tr) > this.cfg.trendHpaPerS) warnings.push('PRESSURE_TREND');
    if (Number.isNaN(stationaryRatio)) warnings.push('NO_ACCELEROMETER');
    else if (stationaryRatio < this.cfg.minStationaryRatio) warnings.push('DEVICE_MOVED');

    return {
      meanPressureHpa: st.mean,
      stdHpa: st.std,
      sampleCount: kept.length,
      timestamp: Math.round((firstKept.at + lastKept.at) / 2),
      startedAt: this.startedAt,
      endedAt: now,
      rejectedCount: this.p.length - kept.length,
      stdErrHpa: kept.length > 1 ? st.std / Math.sqrt(kept.length) : st.std,
      slopeHpaPerS: tr,
      stationaryRatio: Number.isNaN(stationaryRatio) ? 0 : stationaryRatio,
      warnings,
      platform: this.platform,
    };
  }
}

/** 결과를 '저장 가능/재측정 권장/불가'로 등급화 — UI 결과 화면용 */
export function gradeWindow(r: BarometerWindowResult): 'good' | 'usable' | 'retry' {
  const hard: BarometerWarning[] = ['DEVICE_MOVED', 'PRESSURE_TREND'];
  if (r.sampleCount < 4 || r.warnings.some((w) => hard.includes(w))) return 'retry';
  if (r.warnings.length > 0) return 'usable';
  return 'good';
}
