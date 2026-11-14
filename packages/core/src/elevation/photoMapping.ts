/**
 * (v2) 연속 촬영 사진 → 경로 구간 + 정/역방향 자동 매핑
 *
 *  1) 'kept' 사진만 대상(촬영 직후 지우기 한 사진은 제외)
 *  2) 경로상 위치(alongM): 사진에 기록돼 있으면 사용, 없으면 앵커 통과 이벤트(시각, alongM)를
 *     시간 선형보간 — 보행 속도가 앵커 사이에서 거의 일정하다는 가정
 *  3) 해당 구간 방위각과 촬영 heading 차이로 forward / backward / side 판정
 */
import type {
  CapturedPhoto,
  LatLng,
  PhotoAssignment,
  PhotoDirection,
  RouteAnchorPass,
  RouteId,
} from './types.ts';

const R_EARTH = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LatLng, b: LatLng): number {
  // 캠퍼스 스케일(수 km)에서는 등장방형 근사로 충분
  const x = rad(b.lng - a.lng) * Math.cos(rad((a.lat + b.lat) / 2));
  const y = rad(b.lat - a.lat);
  return Math.hypot(x, y) * R_EARTH;
}

export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export const angleDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

export function cumulativeLengths(poly: LatLng[]): number[] {
  const out = [0];
  for (let i = 1; i < poly.length; i++) out.push(out[i - 1]! + distanceM(poly[i - 1]!, poly[i]!));
  return out;
}

/** 시각 → 경로 누적거리(앵커 통과 이벤트 선형보간). 범위 밖이면 null */
export function alongFromPasses(at: number, passes: RouteAnchorPass[]): number | null {
  const ps = [...passes].sort((a, b) => a.at - b.at);
  for (let i = 1; i < ps.length; i++) {
    const a = ps[i - 1]!;
    const b = ps[i]!;
    if (at >= a.at && at <= b.at) {
      const f = (at - a.at) / Math.max(1, b.at - a.at);
      return a.alongM + f * (b.alongM - a.alongM);
    }
  }
  return null;
}

export interface DirectionThresholds {
  forwardMaxDeg: number; // |Δ| ≤ 이 값 → forward
  backwardMinDeg: number; // |Δ| ≥ 이 값 → backward
}

export function classifyDirection(
  headingDeg: number | undefined,
  segmentBearingDeg: number,
  headingAccuracyDeg = 20,
  th: DirectionThresholds = { forwardMaxDeg: 60, backwardMinDeg: 120 },
): { direction: PhotoDirection; confidence: number } {
  if (headingDeg === undefined || !Number.isFinite(headingDeg)) return { direction: 'unknown', confidence: 0 };
  const d = Math.abs(angleDiff(headingDeg, segmentBearingDeg));
  // 임계까지 남은 여유각 / 나침반 정확도 → 0~1
  const margin = d <= th.forwardMaxDeg ? th.forwardMaxDeg - d : d >= th.backwardMinDeg ? d - th.backwardMinDeg : Math.min(d - th.forwardMaxDeg, th.backwardMinDeg - d);
  const confidence = Math.max(0, Math.min(1, margin / Math.max(5, headingAccuracyDeg * 2)));
  if (d <= th.forwardMaxDeg) return { direction: 'forward', confidence };
  if (d >= th.backwardMinDeg) return { direction: 'backward', confidence };
  return { direction: 'side', confidence };
}

export function assignPhotosToRoute(
  routeId: RouteId,
  polyline: LatLng[],
  photos: CapturedPhoto[],
  passes: RouteAnchorPass[] = [],
): PhotoAssignment[] {
  if (polyline.length < 2) return [];
  const cum = cumulativeLengths(polyline);
  const total = cum[cum.length - 1]!;
  const out: PhotoAssignment[] = [];
  for (const p of photos) {
    if (p.decision !== 'kept') continue;
    const along = p.alongM ?? alongFromPasses(p.capturedAt, passes);
    if (along === null || along < 0 || along > total + 5) continue;
    const s = Math.min(Math.max(along, 0), total);
    let seg = cum.findIndex((c, i) => i > 0 && s <= c) - 1;
    if (seg < 0) seg = cum.length - 2;
    const b = bearingDeg(polyline[seg]!, polyline[seg + 1]!);
    const { direction, confidence } = classifyDirection(p.headingDeg, b, p.headingAccuracyDeg);
    out.push({ photoId: p.photoId, routeId, segmentIndex: seg, alongM: s, direction, confidence, method: 'auto_v1' });
  }
  return out.sort((a, b) => a.alongM - b.alongM);
}
