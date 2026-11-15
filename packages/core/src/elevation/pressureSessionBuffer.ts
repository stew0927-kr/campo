/**
 * 휘발성 세션 버퍼 (TTL 30분) — 절대 기압은 여기서만 살고, 밖으로는 Δh 엣지만 나간다.
 *
 *  - 메모리 전용. AsyncStorage/파일/서버에 절대 쓰지 않는다(앱이 죽으면 함께 사라지는 게 정상).
 *  - 같은 sessionId(=같은 기기·같은 앱 실행) 안에서만 짝을 짓는다 → 기기별 고정 오프셋 상쇄.
 *  - 새 창 W_k가 들어오면:
 *      1) 직전 창 W_{k-1}과 static_pair 엣지 생성(Δt ≤ maxPairDtMin)
 *      2) W_{k-2}.node == W_k.node 이면(A→B→A) 드리프트 선형 보간 roundtrip 엣지 생성,
 *         그리고 1)과 직전 단계의 pair 엣지 2개를 superseded 처리하도록 알림
 *  - TTL이 지난 창은 purgeExpired()로 폐기(절대 기압 휘발).
 */
import {
  DEFAULT_DH_MODEL,
  PHYS,
  type DhEdge,
  type DhModelParams,
  type EdgeId,
  type EpochMs,
  type HeightNodeKey,
  type PressureAnchorObservation,
  type SessionId,
  type WindowId,
  type BarometerWindowResult,
} from './types.ts';
import { gradeWindow } from './barometerWindow.ts';

/* ---------------- Hypsometric 변환 ---------------- */

/** 스케일 높이 계수 H = Rd·T/g (m). 15°C → 약 8,435 m */
export function scaleHeightM(tempC: number): number {
  return (PHYS.Rd * (tempC + PHYS.T0K)) / PHYS.g0;
}

/** Δh = z_B − z_A = (Rd·T̄/g)·ln(pA/pB) */
export function pressureToDh(pAHpa: number, pBHpa: number, tempC: number): number {
  return scaleHeightM(tempC) * Math.log(pAHpa / pBHpa);
}

/** |∂Δh/∂p| ≈ H / p̄  (m/hPa). 1013 hPa·15°C에서 약 8.3 m/hPa */
export function metersPerHpa(pMeanHpa: number, tempC: number): number {
  return scaleHeightM(tempC) / pMeanHpa;
}

/* ---------------- 버퍼 ---------------- */

export interface AddObservationInput {
  sessionId: SessionId;
  nodeKey: HeightNodeKey;
  intraOffsetM?: number;
  window: BarometerWindowResult;
  source?: PressureAnchorObservation['source'];
  tempC?: number;
}

export interface AddResult {
  observation: PressureAnchorObservation;
  newEdges: DhEdge[];
  /** 저장소에서 qc='superseded'로 바꿔야 할 기존 엣지 */
  supersede: EdgeId[];
  diagnostics: string[];
}

interface PairRecord {
  edgeId: EdgeId;
  fromWindow: WindowId;
  toWindow: WindowId;
}

export class PressureSessionBuffer {
  private readonly params: DhModelParams;
  private readonly bySession = new Map<string, PressureAnchorObservation[]>();
  private readonly pairs = new Map<string, PairRecord[]>(); // sessionId → pair edges(휘발)

  constructor(
    params: Partial<DhModelParams> = {},
    private readonly newId: () => string = defaultId,
    private readonly clock: () => EpochMs = Date.now,
  ) {
    this.params = { ...DEFAULT_DH_MODEL, ...params };
  }

  add(input: AddObservationInput): AddResult {
    const now = this.clock();
    this.purgeExpired(now);
    const diagnostics: string[] = [];

    const grade = gradeWindow(input.window);
    if (grade === 'retry') {
      throw new Error(`window rejected (grade=retry, warnings=${input.window.warnings.join(',')})`);
    }

    const obs = {
      windowId: this.newId() as WindowId,
      sessionId: input.sessionId,
      nodeKey: input.nodeKey,
      intraOffsetM: input.intraOffsetM ?? 0,
      window: input.window,
      expiresAt: input.window.timestamp + this.params.bufferTtlMin * 60_000,
      source: input.source ?? 'static10s',
      __ephemeral: true,
    } as PressureAnchorObservation;

    const list = this.bySession.get(input.sessionId) ?? [];
    const tempC = input.tempC ?? this.params.defaultTempC;
    const newEdges: DhEdge[] = [];
    const supersede: EdgeId[] = [];

    const prev = list[list.length - 1];
    if (prev) {
      const dtS = (obs.window.timestamp - prev.window.timestamp) / 1000;
      if (prev.nodeKey === obs.nodeKey) {
        const dh = pressureToDh(prev.window.meanPressureHpa, obs.window.meanPressureHpa, tempC);
        diagnostics.push(`same node re-measured: apparent dh=${dh.toFixed(2)} m over ${dtS.toFixed(0)} s (drift/flatness check)`);
      } else if (dtS <= this.params.maxPairDtMin * 60 && dtS > 0) {
        const e = this.makePairEdge(prev, obs, tempC, now);
        newEdges.push(e);
        this.pushPair(input.sessionId, { edgeId: e.edgeId, fromWindow: prev.windowId, toWindow: obs.windowId });
      } else {
        diagnostics.push(`dt=${dtS.toFixed(0)} s exceeds ${this.params.maxPairDtMin} min — no edge (new anchor)`);
      }
    } else {
      diagnostics.push('first window of session — stored as anchor, next measurement will create an edge');
    }

    // A → B → A roundtrip
    const a1 = list[list.length - 2];
    if (a1 && prev && a1.nodeKey === obs.nodeKey && prev.nodeKey !== obs.nodeKey) {
      const spanS = (obs.window.timestamp - a1.window.timestamp) / 1000;
      if (spanS <= this.params.maxPairDtMin * 60) {
        const rt = this.makeRoundtripEdge(a1, prev, obs, tempC, now, diagnostics);
        const ps = this.pairs.get(input.sessionId) ?? [];
        const old = ps.filter(
          (p) =>
            (p.fromWindow === a1.windowId && p.toWindow === prev.windowId) ||
            (p.fromWindow === prev.windowId && p.toWindow === obs.windowId),
        );
        rt.supersedes = old.map((p) => p.edgeId);
        const createdNow = new Set(newEdges.map((e) => e.edgeId));
        // 이전 호출에서 이미 내보낸 엣지만 저장소에 superseded 처리를 요청
        supersede.push(...rt.supersedes.filter((id) => !createdNow.has(id)));
        // 이번 호출에서 만든 pair 엣지는 아직 저장 전이므로 내보내지 않는다
        for (let i = newEdges.length - 1; i >= 0; i--) {
          if (rt.supersedes.includes(newEdges[i]!.edgeId)) newEdges.splice(i, 1);
        }
        rt.supersedes = rt.supersedes.filter((id) => !createdNow.has(id));
        newEdges.push(rt);
      }
    }

    list.push(obs);
    this.bySession.set(input.sessionId, list);
    return { observation: obs, newEdges, supersede, diagnostics };
  }

  /** TTL 만료 창 폐기 → 폐기 개수 반환 */
  purgeExpired(now: EpochMs = this.clock()): number {
    let n = 0;
    for (const [sid, list] of this.bySession) {
      const keep = list.filter((o) => o.expiresAt > now);
      n += list.length - keep.length;
      if (keep.length) this.bySession.set(sid, keep);
      else {
        this.bySession.delete(sid);
        this.pairs.delete(sid);
      }
    }
    return n;
  }

  /** '측정된 기압' 메뉴 전용 조회(화면 표시만, 저장 금지) */
  list(sessionId?: SessionId): readonly PressureAnchorObservation[] {
    if (sessionId) return this.bySession.get(sessionId) ?? [];
    return [...this.bySession.values()].flat();
  }

  remainingTtlMs(windowId: WindowId, now: EpochMs = this.clock()): number {
    const o = this.list().find((x) => x.windowId === windowId);
    return o ? Math.max(0, o.expiresAt - now) : 0;
  }

  /**
   * 지도에서 측정 지점 하나를 지울 때: 그 지점의 기압 창을 모두 버리고, 그 창이 낀 pair 기록도 버린다.
   * 다음 측정은 남은 창 중 가장 최근 것과 짝을 짓는다. 지운 창 개수를 돌려준다.
   */
  forgetNode(nodeKey: HeightNodeKey | string): number {
    let n = 0;
    for (const [sid, list] of this.bySession) {
      const dropped = new Set(list.filter((o) => o.nodeKey === nodeKey).map((o) => o.windowId as string));
      if (dropped.size === 0) continue;
      n += dropped.size;
      const keep = list.filter((o) => !dropped.has(o.windowId));
      const pairs = (this.pairs.get(sid) ?? []).filter((p) => !dropped.has(p.fromWindow) && !dropped.has(p.toWindow));
      if (keep.length) {
        this.bySession.set(sid, keep);
        this.pairs.set(sid, pairs);
      } else {
        this.bySession.delete(sid);
        this.pairs.delete(sid);
      }
    }
    return n;
  }

  /** 사용자가 '기압 기록 지우기'를 누르거나 로그아웃할 때 */
  clear(sessionId?: SessionId) {
    if (sessionId) {
      this.bySession.delete(sessionId);
      this.pairs.delete(sessionId);
    } else {
      this.bySession.clear();
      this.pairs.clear();
    }
  }

  /* ---------- 내부 ---------- */

  private pushPair(sid: string, p: PairRecord) {
    const ps = this.pairs.get(sid) ?? [];
    ps.push(p);
    this.pairs.set(sid, ps);
  }

  private windowVar(w: BarometerWindowResult) {
    return w.stdErrHpa ** 2 + this.params.sigmaInstFloorHpa ** 2;
  }

  private makePairEdge(a: PressureAnchorObservation, b: PressureAnchorObservation, tempC: number, now: EpochMs): DhEdge {
    const pa = a.window.meanPressureHpa, pb = b.window.meanPressureHpa;
    const dtS = (b.window.timestamp - a.window.timestamp) / 1000;
    const varP = this.windowVar(a.window) + this.windowVar(b.window) + (this.params.driftHpaPerHour * (dtS / 3600)) ** 2;
    const k = metersPerHpa((pa + pb) / 2, tempC);
    return {
      edgeId: this.newId() as EdgeId,
      from: a.nodeKey,
      to: b.nodeKey,
      dhM: pressureToDh(pa, pb, tempC),
      sigmaM: k * Math.sqrt(varP),
      dtS,
      offsetFromM: a.intraOffsetM,
      offsetToM: b.intraOffsetM,
      sessionId: a.sessionId,
      method: 'static_pair',
      qc: 'pending',
      model: this.modelInfo(tempC),
      createdAt: now,
    };
  }

  private makeRoundtripEdge(
    a1: PressureAnchorObservation,
    b: PressureAnchorObservation,
    a3: PressureAnchorObservation,
    tempC: number,
    now: EpochMs,
    diagnostics: string[],
  ): DhEdge {
    const t1 = a1.window.timestamp, t2 = b.window.timestamp, t3 = a3.window.timestamp;
    const alpha = (t2 - t1) / (t3 - t1);
    const pAinterp = a1.window.meanPressureHpa + alpha * (a3.window.meanPressureHpa - a1.window.meanPressureHpa);
    const spanH = (t3 - t1) / 3_600_000;
    const observedDrift = Math.abs(a3.window.meanPressureHpa - a1.window.meanPressureHpa) / Math.max(spanH, 1e-6);
    if (observedDrift > 3 * this.params.driftHpaPerHour) {
      diagnostics.push(`roundtrip: A drift ${observedDrift.toFixed(2)} hPa/h is unusually large (door/HVAC/weather front?)`);
    }
    const varP =
      this.windowVar(b.window) +
      (1 - alpha) ** 2 * this.windowVar(a1.window) +
      alpha ** 2 * this.windowVar(a3.window) +
      (this.params.roundtripResidualDriftRatio * this.params.driftHpaPerHour * spanH * 0.5) ** 2;
    const k = metersPerHpa((pAinterp + b.window.meanPressureHpa) / 2, tempC);
    return {
      edgeId: this.newId() as EdgeId,
      from: a1.nodeKey,
      to: b.nodeKey,
      dhM: pressureToDh(pAinterp, b.window.meanPressureHpa, tempC),
      sigmaM: k * Math.sqrt(varP),
      dtS: (t3 - t1) / 1000,
      offsetFromM: a1.intraOffsetM,
      offsetToM: b.intraOffsetM,
      sessionId: a1.sessionId,
      method: 'roundtrip',
      qc: 'pending',
      model: this.modelInfo(tempC),
      createdAt: now,
    };
  }

  private modelInfo(tempC: number) {
    return {
      tempC,
      sigmaInstFloorHpa: this.params.sigmaInstFloorHpa,
      driftHpaPerHour: this.params.driftHpaPerHour,
    };
  }
}

function defaultId(): string {
  // 앱에서는 expo-crypto의 randomUUID()를 생성자에 주입하는 것을 권장.
  // crypto.randomUUID가 없는 런타임을 위한 의존성 없는 대체 구현
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
