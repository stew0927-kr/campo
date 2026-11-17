// 캠포 사용자 앱의 안정 계약(Stable contracts). 프론트 담당은 이 타입들만 보고 화면을 붙인다
// (사용법: docs/FRONTEND_HANDOFF.md 3장).
//
// 규칙
// - @campo/core의 타입을 새로 정의하지 않고 그대로 감싼다. 코어 타입이 바뀌면 이 파일의 import만 고친다.
// - 앞으로 늘어날 수 있는 필드는 반드시 optional(`?`)로 연다. 필수 필드를 더하는 변경은 하위 호환이 깨지는 변경이라
//   프론트 화면을 같이 고쳐야 한다.
// - 화면에 보여 줄 문구는 여기 있는 message/label을 그대로 쓰면 한국어 존댓말이 된다. 화면에서 새로 만들지 않는다.
import type { CampusGraph, MatchNetwork, NavEvent, NavMode, Profile, RouteStep, SensorFix } from '@campo/core';
import type { CampusRuntime } from './campus/types.ts';

/** 지도 위의 한 점. 화면 좌표가 아니라 WGS84 위경도다. */
export interface RoutePoint {
  lat: number;
  lng: number;
}

/** 경로의 출발·도착. 캠퍼스 지점 id이거나, 지도에서 고른 임의의 점(가장 가까운 걷는 구간에 붙는다)이다. */
export type RouteEndpoint = { kind: 'node'; nodeId: string } | { kind: 'point'; lat: number; lng: number };

/** 이동 방식. 코어의 길찾기 프로필을 그대로 쓴다. */
export type TravelMode = Profile;

export interface CampusRouteRequest {
  from: RouteEndpoint | null;
  to: RouteEndpoint | null;
  /** 없으면 shortest(가장 빠른 길). */
  mode?: TravelMode;
  /** 아직 읽지 않는 예약 필드: 대안 경로를 함께 달라는 표시. 지금은 무시되며, 지원할 때 이 필드만 채우면 된다. */
  alternatives?: boolean;
}

export interface FloorChange {
  kind: 'elevator' | 'stairs' | 'escalator';
  fromLevel: number | null;
  toLevel: number | null;
  /** 예: "2층 → 3층 (계단)". 화면에 그대로 쓴다. */
  label: string;
}

export interface SlopeWarning {
  edgeId: string;
  /** 진행 방향 기준 퍼센트. 양수 = 오르막. */
  gradePct: number;
  gradeClass: 'caution' | 'steep';
  /** 예: "경사 12% 급경사 (오르막) · 경사가 급한 길입니다". 화면에 그대로 쓴다. */
  message: string;
}

/** 화면에 그릴 수 있는 완성된 경로. 코어 Route를 화면이 쓰기 좋은 모양으로 감싼 것이다. */
export interface CampusRouteView {
  /** 요청한 프로필. */
  profile: Profile;
  /** 실제로 쓰인 프로필. 계단을 피할 길이 없어 fewest_steps로 대체되면 그 값이 들어온다. */
  usedProfile: Profile;
  /** 예상 소요 시간(초). */
  timeSec: number;
  /** 걷는 거리(m). */
  distanceM: number;
  stairsCount: number;
  escalatorCount: number;
  /** 단계별 안내 문장(한국어 존댓말). */
  steps: RouteStep[];
  /** 경로 위의 층 이동. 계단·에스컬레이터·엘리베이터로 층이 바뀌는 곳마다 하나. */
  floorChanges: FloorChange[];
  /** 경사가 주의(5% 초과)이거나 급한(8% 초과) 구간. */
  slopeWarnings: SlopeWarning[];
  /** 계단·턱을 피할 수 없을 때 코어가 만든 안내. 없으면 null. */
  fallbackMessage: string | null;
  /** 지도 선으로 그릴 좌표(출발 → 도착). 점이 하나뿐인 경로(출발=도착)는 같은 점을 두 번 담아 항상 LineString으로 그릴 수 있다. */
  polyline: RoutePoint[];
  /** 경로가 지나는 캠퍼스 지점 id. useGpsMatcher의 routeNodeIds로 그대로 넘긴다. */
  nodeIds: string[];
  /** 출발·도착이 지도 위 임의의 점이었을 때, 가장 가까운 길까지 걸어 내려간 거리(m). */
  snappedStartM?: number;
  snappedEndM?: number;
}

export type CampusRouteStatus = 'idle' | 'ok' | 'not-found' | 'error';

export interface CampusRouteState {
  status: CampusRouteStatus;
  route: CampusRouteView | null;
  /** not-found / error일 때 화면에 보여 줄 한국어 설명. ok면 null. */
  message: string | null;
}

export interface CampusCounts {
  nodes: number;
  edges: number;
  buildings: number;
}

export interface CampusSummary {
  id: string;
  name: string;
  center: RoutePoint;
  /** [west, south, east, north] */
  bbox: [number, number, number, number] | null;
}

/**
 * 지도에 표시하거나 출발·도착으로 고를 만한 지점: 이름이 있는 지점, 장소·출입구·화장실, 그리고 강의실 문(`nodeType: 'door'`).
 * `name`은 항상 화면에 그대로 쓸 수 있는 한국어다. 이름 없는 복도·계단 지점과 강의실이 아닌 문은 들어가지 않는다.
 */
export interface CampusPlace {
  id: string;
  name: string;
  nodeType: string;
  buildingId: string | null;
  level: number | null;
  lat: number;
  lng: number;
  /**
   * 강의실 문일 때 호수(예: "408"). 화면에서 호수로 찾을 때 쓴다. 강의실 문이 아니면 없다.
   * 데이터의 `room_ref` → `ref` → `space_name` 순서로 고른다(space_name만 있는 예전 문은 그 값이 들어온다).
   */
  roomRef?: string;
}

export interface CampusBuilding {
  id: string;
  name: string;
  levels: number[];
}

/** 앱에 번들된 캠퍼스 데이터를 읽은 결과. 화면은 이 값만 있으면 지도를 그리고 경로를 찾을 수 있다. */
export interface CampusData {
  status: 'ready' | 'error';
  /** useCampusRoute에 그대로 넘기는 값(실패했으면 null). */
  runtime: CampusRuntime | null;
  campus: CampusSummary | null;
  graph: CampusGraph | null;
  /** GPS 매칭용 망(useGpsMatcher에 그대로 넘긴다). */
  network: MatchNetwork | null;
  counts: CampusCounts;
  places: CampusPlace[];
  buildings: CampusBuilding[];
  /** 읽지 못한 파일, 그래프가 쓰지 못한 구간을 한국어 한 줄씩. 비어 있으면 문제가 없다. */
  issues: string[];
  error: string | null;
}

/** useCampusData가 돌려주는 값: CampusData + 다시 읽기. */
export interface CampusDataApi extends CampusData {
  /** 번들된 캠퍼스 데이터를 다시 파싱한다(지금은 앱에 들어 있는 데이터라 새로 내려받지는 않는다). */
  reload: () => void;
}

/** matchStep·navStep이 정한 현재 위치와 상태. */
export interface GpsPosition extends RoutePoint {
  /** 0–1. 이 fix가 믿을 만한 정도. */
  confidence: number;
  stationary: boolean;
  /** 길 밖(자유 상태)으로 판단됨. */
  free: boolean;
  /** 정확도가 나빠 이번 fix를 건너뜀(위치는 직전 값 유지). */
  skipped: boolean;
}

export interface GpsMatcherSnapshot {
  /** OUTDOOR | APPROACHING | PORTAL | INDOOR | OFF_NETWORK_SUSPECT */
  mode: NavMode;
  buildingId: string | null;
  /** 실내일 때 층(표시용). */
  level: number | null;
  position: GpsPosition | null;
  /** 이번 fix에서 나온 안내 이벤트(코드). */
  events: NavEvent[];
  /** 이번 fix에서 나온 안내 문구(한국어). 비어 있으면 말할 것이 없다. */
  messages: string[];
  /** REROUTE가 나왔는지. true면 새 경로를 찾아 setRoute로 다시 넣는다. */
  rerouteRequested: boolean;
  /** 지금까지 쓴 fix 수(건너뛴 fix는 세지 않는다). */
  fixCount: number;
}

export interface GpsMatcherOptions {
  /** 따라갈 경로의 캠퍼스 지점 id 목록(useCampusRoute의 결과에서 뽑아 넣는다). null이면 경로 이탈을 판정하지 않는다. */
  routeNodeIds?: readonly string[] | null;
}

export interface GpsMatcherApi extends GpsMatcherSnapshot {
  /** 센서 표본 하나를 넣는다(1초에 한 번). 결과 스냅숏을 돌려준다. */
  pushFix: (fix: SensorFix) => GpsMatcherSnapshot;
  /** 따라갈 경로를 바꾼다. null이면 경로 이탈 판정을 끈다. */
  setRoute: (nodeIds: readonly string[] | null) => void;
  /** 추적을 처음부터 다시 시작한다(같은 캠퍼스에서만). */
  reset: () => void;
}

/** 아직 네트워크가 없을 때(캠퍼스 데이터를 읽는 중) 돌려주는 값. */
export const EMPTY_GPS_SNAPSHOT: GpsMatcherSnapshot = Object.freeze({
  mode: 'OUTDOOR',
  buildingId: null,
  level: null,
  position: null,
  events: [],
  messages: [],
  rerouteRequested: false,
  fixCount: 0,
});
