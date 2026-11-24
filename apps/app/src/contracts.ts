// 캠포 사용자 앱의 안정 계약(Stable contracts). 프론트 담당은 이 타입들만 보고 화면을 붙인다
// (사용법: docs/FRONTEND_HANDOFF.md 3장).
//
// 규칙
// - @campo/core의 타입을 새로 정의하지 않고 그대로 감싼다. 코어 타입이 바뀌면 이 파일의 import만 고친다.
// - 앞으로 늘어날 수 있는 필드는 반드시 optional(`?`)로 연다. 필수 필드를 더하는 변경은 하위 호환이 깨지는 변경이라
//   프론트 화면을 같이 고쳐야 한다.
// - 화면에 보여 줄 문구는 여기 있는 message/label을 그대로 쓰면 한국어 존댓말이 된다. 화면에서 새로 만들지 않는다.
import type { ArrowModel, CampusGraph, MatchNetwork, NavEvent, NavMode, PhotoMeta, Profile, RestroomGender, RouteStep, SensorFix } from '@campo/core';
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
  /**
   * 이 구간이 `CampusRouteView.polyline`에서 차지하는 자리 [시작 index, 끝 index](양 끝 포함).
   * 경로선에서 이 구간을 찾지 못하면 없다. 이어지는 구간은 앞 구간의 끝 index가 다음 구간의 시작 index와 같다.
   */
  polylineRange?: [number, number];
  /** 경로선에서 잘라 낸 이 구간의 좌표([경도, 위도], 진행 방향). 지도에서 구간을 강조하거나 카메라를 옮길 때 쓴다. */
  coordinates?: [number, number][];
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
  /**
   * 단계별 안내 문장(한국어 존댓말). 각 단계에는 코어가 경로 모양으로 계산한 진행 방위가 선택 필드로 붙는다
   * (RouteStepBearing: bearing_deg·bearing_in_deg·bearing_turn_deg·bearing_floor_change·bearing_arrive_deg, 없을 수 있다).
   */
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
  /**
   * 화장실일 때 데이터의 `restroom_gender` 그대로('male'·'female'·'unisex'·'family'). 기록이 없거나 화장실이 아니면 없다.
   * 남자/여자 화장실 찾기는 'male'을 여자 목록에서만, 'female'을 남자 목록에서만 뺀다(features/map/restroomGender.ts).
   */
  restroomGender?: RestroomGender;
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

// ---- 사진 길안내 (docs: campo-photo-guidance-design.md) ----
// 사진 데이터는 조원 D가 만드는 사진 공급자(DB 행 → PhotoCatalog)가 준다. 이 앱은 URL을 받아 보여 주기만 하고,
// 사진을 줄이거나 올리지 않는다. 사진이 하나도 없어도 아래 계약은 빈 값으로 동작한다(EMPTY_PHOTO_CATALOG).

/** RouteStep에 코어가 얹는 진행 방위(도, 북쪽 기준 시계 방향). 전부 선택 필드이며 계산할 수 없으면 빠진다. */
export type RouteStepBearing = Pick<RouteStep, 'bearing_deg' | 'bearing_in_deg' | 'bearing_turn_deg' | 'bearing_floor_change' | 'bearing_arrive_deg'>;

/** 사진 위 방향 화살표. 코어의 ArrowModel을 그대로 쓴다(mode: inFrame / edge / behind, label: 한국어 방향 문구). */
export type PhotoArrow = ArrowModel;

/** 경로 안내에 쓰는 사진 한 장. URL은 공급자가 준 그대로다. */
export interface RoutePhoto {
  photoId: string;
  /** 사진을 찍은 캠퍼스 지점 id(경로의 RouteStep.fromNodeId / toNodeId와 같은 id 공간). */
  nodeId: string;
  /** 사진이 바라보는 방향(도, 0 이상 360 미만). null이면 자동으로 고르지 않고 "이 지점 다른 사진" 목록에만 나온다. */
  heading_deg: number | null;
  heading_source?: PhotoMeta['heading_source'];
  /** 예: "사진 오른쪽 두 번째 문". 화면에 그대로 쓴다. */
  direction_hint?: string;
  /** 수평 화각(도). 없으면 기본 65°로 화살표 위치를 잡는다. */
  hfov_deg?: number;
  /** 지도 썸네일용 작은 사진 URL. */
  thumbUrl: string;
  /** 확대 뷰어용 사진 URL. */
  fullUrl: string;
}

/** 경로의 한 단계(또는 도착 지점)에 고른 사진. */
export interface RouteStepPhoto {
  /** CampusRouteView.steps의 인덱스. steps.length이면 도착 지점(마지막 단계의 toNodeId)이다. */
  stepIndex: number;
  /** 사진을 고른 지점. */
  nodeId: string;
  /** 지점의 좌표 [경도, 위도]. 경로 선에서 찾지 못하면 null(지도 마커를 그리지 않는다). */
  lngLat: [number, number] | null;
  /**
   * ahead: 나가는 방향 ±45° 사진 / approach: 들어오는 방향 ±45° 사진(화살표는 나가는 방향 기준)
   * approximate: ±90° 안의 가장 가까운 사진(badge를 함께 보여 준다) / none: 사진 없이 문구와 지도로 안내
   */
  pick: 'ahead' | 'approach' | 'approximate' | 'none';
  photo: RoutePhoto | null;
  /** 가야 할 방향 − 사진 방향(-180..180, 양수 = 오른쪽). 사진이 없으면 null. */
  deltaDeg: number | null;
  arrow: PhotoArrow | null;
  /** 가야 할 방향(도). 다른 각도 사진을 고를 때 화살표를 다시 계산하는 기준. 모르면 null. */
  targetDeg: number | null;
  /** approximate일 때 "정면이 아닐 수 있습니다". 그 밖에는 null. 화면에 그대로 쓴다. */
  badge: string | null;
}

/**
 * 사진 공급자(조원 D 연동 지점). 지점 id로 그 지점의 사진을 원래 순서대로 준다. 없는 지점은 빈 배열.
 * `size`(전체 사진 수)는 선택이며, 0이면 사진 안내를 통째로 끈다.
 */
export interface PhotoCatalog {
  byNodeId(nodeId: string): RoutePhoto[];
  readonly size?: number;
}

/**
 * 사진 DB의 한 행(조원 D의 테이블 모양). URL 필드 이름은 `thumb_url` / `full_url`로 고정한다.
 * 빈 칸은 null로 와도 된다. id·node_id·thumb_url·full_url이 비어 있는 행은 버린다.
 */
export interface PhotoRow {
  id: string;
  node_id: string;
  heading_deg: number | null;
  heading_source?: PhotoMeta['heading_source'] | null;
  direction_hint?: string | null;
  hfov_deg?: number | null;
  thumb_url: string;
  full_url: string;
}

export { EMPTY_PHOTO_CATALOG, photoCatalogFromRows } from './photos/catalog.ts';
