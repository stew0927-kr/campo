/**
 * useMeasureFlow — 상태 머신(measureReducer) + 센서 훅(useBarometerSample) + 휘발 버퍼 연결
 *
 * 화면(지도 FAB·십자선·팝업·카운트다운 시트)은 이 훅의 state/actions만 쓰면 된다.
 * 영속 저장은 ElevationRepo 인터페이스로 분리(현재는 로컬 JSON, 나중에 PostGIS API로 교체).
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';

import {
  PressureSessionBuffer,
  floorNodeKey,
  measureReducer,
  needsKeepAwake,
  outdoorNodeKey,
  type DhEdge,
  type EdgeId,
  type HeightNode,
  type HeightNodeKey,
  type MeasureState,
  type MeasureTarget,
  type SessionId,
} from '@campo/core/elevation';
import { BarometerSampleError, isBarometerUsable, useBarometerSample } from './useBarometerSample';

/** 영속 저장소 — 절대 기압을 받는 메서드가 아예 없다 */
export interface ElevationRepo {
  upsertNode(node: HeightNode): Promise<void>;
  addEdges(edges: DhEdge[]): Promise<void>;
  markSuperseded(ids: EdgeId[]): Promise<void>;
}

/* 앱 프로세스 단위 싱글턴: 앱이 죽으면 기압도 함께 사라진다(의도된 휘발) */
const buffer = new PressureSessionBuffer();
let processSessionId: SessionId | null = null;
export function currentSessionId(newId: () => string): SessionId {
  if (!processSessionId) processSessionId = newId() as SessionId;
  return processSessionId;
}
/** '측정된 기압' 메뉴에서 쓰는 읽기 전용 접근 */
export const measuredPressureBuffer = buffer;

export interface UseMeasureFlowOptions {
  enabled: boolean; // 설정의 '측정 모드' 토글(평상시 false → FAB 숨김)
  repo: ElevationRepo;
  newId: () => string; // expo-crypto randomUUID 주입 권장
  settleMs?: number;
}

export function useMeasureFlow({ enabled, repo, newId, settleMs = 2_000 }: UseMeasureFlowOptions) {
  const [state, dispatch] = useReducer(measureReducer, { tag: 'hidden' } as MeasureState);
  const sample = useBarometerSample({ settleMs });
  const stateRef = useRef(state);
  stateRef.current = state;

  // 측정 모드 + 기압계 존재할 때만 FAB 노출
  useEffect(() => {
    let alive = true;
    if (!enabled) {
      dispatch({ type: 'DISABLE' });
      return;
    }
    isBarometerUsable().then((ok) => {
      if (alive && ok) dispatch({ type: 'ENABLE' });
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  // 센서 훅 상태 → 머신 이벤트
  useEffect(() => {
    const s = stateRef.current;
    if (sample.status === 'settling' && s.tag === 'preparing') {
      dispatch({ type: 'PREP_OK', now: Date.now(), settleMs: sample.settleRemainingMs });
    } else if (sample.status === 'sampling' && s.tag === 'settling') {
      dispatch({ type: 'SETTLE_DONE' });
    }
    if (sample.status === 'sampling' && sample.live) dispatch({ type: 'TICK', live: sample.live });
  }, [sample.status, sample.live, sample.settleRemainingMs]);

  // 1분마다 TTL 만료 기압 폐기(버퍼 add 때도 자동 수행)
  useEffect(() => {
    const t = setInterval(() => buffer.purgeExpired(), 60_000);
    return () => clearInterval(t);
  }, []);

  const runSampling = useCallback(async () => {
    try {
      const result = await sample.start();
      dispatch({ type: 'SAMPLE_DONE', result });
    } catch (err) {
      const code = err instanceof BarometerSampleError ? err.code : 'no_samples';
      if (code === 'barometer_unavailable') dispatch({ type: 'PREP_FAIL', reason: 'barometer_unavailable' });
      else if (code === 'permission_denied') dispatch({ type: 'PREP_FAIL', reason: 'permission_denied' });
      else if (code === 'app_background') dispatch({ type: 'INTERRUPT', reason: 'app_background' });
      else if (code === 'cancelled') dispatch({ type: 'CANCEL' });
      else dispatch({ type: 'INTERRUPT', reason: 'sensor_error' });
    }
  }, [sample]);

  const actions = {
    pressFab: () => dispatch({ type: 'FAB_PRESS' }),
    /** 십자선 '여기서 측정' — 이 순간 좌표를 고정(이후 지도 이동 무시) */
    confirmCrosshair: (target: MeasureTarget) => dispatch({ type: 'CROSSHAIR_CONFIRM', target }),
    start: () => {
      dispatch({ type: 'START' });
      void runSampling();
    },
    retry: () => {
      dispatch({ type: 'RETRY', now: Date.now(), settleMs });
      // RETRY는 settling으로 가므로 preparing 단계를 건너뛰고 바로 센서 재시작
      void runSampling();
    },
    cancel: () => {
      sample.cancel();
      dispatch({ type: 'CANCEL' });
    },
    dismiss: () => dispatch({ type: 'DISMISS' }),
    save: async () => {
      const s = stateRef.current;
      if (s.tag !== 'reviewing' || s.grade === 'retry') return;
      dispatch({ type: 'SAVE' });
      try {
        const { node, nodeKey, intraOffsetM } = targetToNode(s.target, newId);
        await repo.upsertNode(node);
        const r = buffer.add({
          sessionId: currentSessionId(newId),
          nodeKey,
          intraOffsetM,
          window: s.result,
        });
        if (r.supersede.length) await repo.markSuperseded(r.supersede);
        if (r.newEdges.length) await repo.addEdges(r.newEdges);
        dispatch({ type: 'COMMIT_OK', edgesCreated: r.newEdges.length, diagnostics: r.diagnostics });
      } catch (e) {
        dispatch({ type: 'COMMIT_FAIL', message: String(e) });
      }
    },
  };

  return { state, sample, actions, keepAwake: needsKeepAwake(state) };
}

function targetToNode(t: MeasureTarget, newId: () => string): { node: HeightNode; nodeKey: HeightNodeKey; intraOffsetM: number } {
  const now = Date.now();
  if (t.kind === 'floor') {
    const key = floorNodeKey(t.buildingId, t.floorId);
    return {
      node: { kind: 'floor_plane', key, buildingId: t.buildingId, floorId: t.floorId, createdAt: now },
      nodeKey: key,
      intraOffsetM: t.intraOffsetM,
    };
  }
  const key = t.existingNodeKey ?? outdoorNodeKey(newId());
  return {
    node: {
      kind: 'outdoor_point',
      key,
      position: t.position,
      influenceRadiusM: t.influenceRadiusM,
      ...(t.horizontalAccuracyM === undefined ? {} : { horizontalAccuracyM: t.horizontalAccuracyM }),
      createdAt: now,
    },
    nodeKey: key,
    intraOffsetM: 0,
  };
}
