/**
 * 10초 정지 기압 측정 UI 상태 머신 — 순수 리듀서(React useReducer에 그대로 사용)
 *
 *   hidden ──ENABLE──▶ idle ──FAB_PRESS──▶ targeting ──CROSSHAIR_CONFIRM──▶ confirming
 *     ▲                 ▲                      │CANCEL                         │START
 *     │DISABLE          │DISMISS               ▼                               ▼
 *     └──────────────── done ◀─COMMIT_OK─ committing ◀─SAVE─ reviewing ◀─SAMPLE_DONE─ sampling ◀─SETTLE_DONE─ settling ◀─PREP_OK─ preparing
 *                                                         RETRY ─────────────────────────────────────────────▶ settling
 *   어느 진행 상태에서든 INTERRUPT → interrupted(사유) → RETRY | CANCEL
 *   PREP_FAIL → error(unavailable | permission_denied) → DISMISS(hidden으로 강등 가능)
 *
 * '평상시 숨김': 측정 모드(설정 토글)가 꺼져 있으면 hidden. 측정 기록은 '측정된 기압' 메뉴에서만 조회.
 */
import type {
  BarometerWindowResult,
  BuildingId,
  FloorId,
  LatLng,
  OutdoorNodeKey,
} from './types.ts';
import { gradeWindow, type LiveSnapshot } from './barometerWindow.ts';

export type MeasureTarget =
  | {
      kind: 'outdoor';
      position: LatLng; // 확정 순간의 십자선 좌표(이후 지도를 움직여도 고정)
      /** 반경 내 기존 실외 노드에 붙일지(재측정) */
      existingNodeKey?: OutdoorNodeKey;
      influenceRadiusM: number;
      horizontalAccuracyM?: number;
    }
  | {
      kind: 'floor';
      buildingId: BuildingId;
      floorId: FloorId;
      /** 층 평면 대비 알려진 국소 단차(반층 로비 등) */
      intraOffsetM: number;
      /** 위치는 참고용(층 평면은 위치 무관) */
      position?: LatLng;
    };

export type InterruptReason = 'app_background' | 'device_moved' | 'sensor_error' | 'user_left_screen';
export type PrepFailReason = 'barometer_unavailable' | 'permission_denied' | 'sensor_error';

export type MeasureState =
  | { tag: 'hidden' }
  | { tag: 'idle' }
  | { tag: 'targeting' }
  | { tag: 'confirming'; target: MeasureTarget }
  | { tag: 'preparing'; target: MeasureTarget }
  | { tag: 'settling'; target: MeasureTarget; untilMs: number }
  | { tag: 'sampling'; target: MeasureTarget; live?: LiveSnapshot }
  | { tag: 'reviewing'; target: MeasureTarget; result: BarometerWindowResult; grade: 'good' | 'usable' | 'retry' }
  | { tag: 'committing'; target: MeasureTarget; result: BarometerWindowResult }
  | { tag: 'done'; edgesCreated: number; diagnostics: string[] }
  | { tag: 'interrupted'; target: MeasureTarget; reason: InterruptReason }
  | { tag: 'error'; reason: PrepFailReason | 'commit_failed'; message?: string };

export type MeasureEvent =
  | { type: 'ENABLE' }
  | { type: 'DISABLE' }
  | { type: 'FAB_PRESS' }
  | { type: 'CROSSHAIR_CONFIRM'; target: MeasureTarget }
  | { type: 'START' }
  | { type: 'PREP_OK'; now: number; settleMs: number }
  | { type: 'PREP_FAIL'; reason: PrepFailReason }
  | { type: 'SETTLE_DONE' }
  | { type: 'TICK'; live: LiveSnapshot }
  | { type: 'SAMPLE_DONE'; result: BarometerWindowResult | null }
  | { type: 'INTERRUPT'; reason: InterruptReason }
  | { type: 'SAVE' }
  | { type: 'RETRY'; now: number; settleMs: number }
  | { type: 'CANCEL' }
  | { type: 'COMMIT_OK'; edgesCreated: number; diagnostics: string[] }
  | { type: 'COMMIT_FAIL'; message: string }
  | { type: 'DISMISS' };

const ACTIVE: MeasureState['tag'][] = ['preparing', 'settling', 'sampling'];

export function measureReducer(s: MeasureState, e: MeasureEvent): MeasureState {
  // 전역 전이
  if (e.type === 'DISABLE') return { tag: 'hidden' };
  if (e.type === 'INTERRUPT' && ACTIVE.includes(s.tag) && 'target' in s) {
    return { tag: 'interrupted', target: s.target, reason: e.reason };
  }

  switch (s.tag) {
    case 'hidden':
      return e.type === 'ENABLE' ? { tag: 'idle' } : s;

    case 'idle':
      return e.type === 'FAB_PRESS' ? { tag: 'targeting' } : s;

    case 'targeting':
      if (e.type === 'CROSSHAIR_CONFIRM') return { tag: 'confirming', target: e.target };
      if (e.type === 'CANCEL') return { tag: 'idle' };
      return s;

    case 'confirming':
      if (e.type === 'START') return { tag: 'preparing', target: s.target };
      if (e.type === 'CANCEL') return { tag: 'targeting' };
      return s;

    case 'preparing':
      if (e.type === 'PREP_OK') return { tag: 'settling', target: s.target, untilMs: e.now + e.settleMs };
      if (e.type === 'PREP_FAIL') return { tag: 'error', reason: e.reason };
      if (e.type === 'CANCEL') return { tag: 'idle' };
      return s;

    case 'settling':
      if (e.type === 'SETTLE_DONE') return { tag: 'sampling', target: s.target };
      if (e.type === 'CANCEL') return { tag: 'idle' };
      return s;

    case 'sampling':
      if (e.type === 'TICK') return { ...s, live: e.live };
      if (e.type === 'SAMPLE_DONE') {
        if (!e.result) return { tag: 'interrupted', target: s.target, reason: 'sensor_error' };
        return { tag: 'reviewing', target: s.target, result: e.result, grade: gradeWindow(e.result) };
      }
      if (e.type === 'CANCEL') return { tag: 'idle' };
      return s;

    case 'reviewing':
      if (e.type === 'SAVE' && s.grade !== 'retry') return { tag: 'committing', target: s.target, result: s.result };
      if (e.type === 'RETRY') return { tag: 'settling', target: s.target, untilMs: e.now + e.settleMs };
      if (e.type === 'CANCEL') return { tag: 'idle' };
      return s;

    case 'committing':
      if (e.type === 'COMMIT_OK') return { tag: 'done', edgesCreated: e.edgesCreated, diagnostics: e.diagnostics };
      if (e.type === 'COMMIT_FAIL') return { tag: 'error', reason: 'commit_failed', message: e.message };
      return s;

    case 'interrupted':
      if (e.type === 'RETRY') return { tag: 'settling', target: s.target, untilMs: e.now + e.settleMs };
      if (e.type === 'CANCEL') return { tag: 'idle' };
      return s;

    case 'done':
      if (e.type === 'FAB_PRESS') return { tag: 'targeting' };
      return e.type === 'DISMISS' ? { tag: 'idle' } : s;

    case 'error':
      if (e.type === 'DISMISS') {
        // 기압계 없는 기기는 FAB 자체를 숨긴다
        return s.reason === 'barometer_unavailable' ? { tag: 'hidden' } : { tag: 'idle' };
      }
      return s;
  }
}

/** UI가 센서 구독을 켜야 하는 상태인지 */
export const needsSensors = (s: MeasureState) => s.tag === 'settling' || s.tag === 'sampling';
/** 화면 꺼짐 방지가 필요한 상태인지 */
export const needsKeepAwake = (s: MeasureState) => ACTIVE.includes(s.tag) || s.tag === 'reviewing';
