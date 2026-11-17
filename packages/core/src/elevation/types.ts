/**
 * CAMPO 고도 보정 — 공용 데이터 타입 (packages/core/src/elevation/types.ts)
 *
 * 설계 원칙
 *  1. "영속(Persisted)" 타입에는 절대 기압(hPa) 필드가 존재하지 않는다.
 *     절대 기압은 Ephemeral<...> 타입에만 있고, 이 타입은 AsyncStorage/JSON 파일/서버로
 *     직렬화하지 않는다(직렬화 함수의 입력 타입에서 구조적으로 배제).
 *  2. 관측은 오직 하나: Δh 엣지(DhEdge). 10초 정지 측정이든 연속 보행 스트림이든
 *     결국 "노드 ↔ 노드 Δh + σ"로 끝나며 method 필드만 다르다.
 *  3. 높이 변수(HeightNode)는 두 종류: 실외 지점(outdoor_point), 건물 층 평면(floor_plane).
 *     층 평면의 키는 (buildingId, floorId)에서 결정적으로 만들어지므로, 다른 날 다른 위치에서
 *     측정해도 같은 변수에 자동으로 묶인다.
 *  4. 스키마 버전(schemaVersion)으로 로컬 JSON → PostGIS 이전과 향후 확장을 관리한다.
 *     v1에서 연속 보행·사진 필드는 optional로 미리 자리만 잡아 두어, v2 기능 추가 시
 *     기존 데이터를 깨지 않는다.
 */

/* ------------------------------------------------------------------ */
/* 0. 공통 유틸 타입                                                    */
/* ------------------------------------------------------------------ */

/** 명목(brand) 타입: 문자열 ID를 서로 섞어 쓰는 실수를 컴파일 타임에 막는다. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type SessionId = Brand<string, 'SessionId'>;
export type EdgeId = Brand<string, 'EdgeId'>;
export type WindowId = Brand<string, 'WindowId'>;
export type PhotoId = Brand<string, 'PhotoId'>;
export type RouteId = Brand<string, 'RouteId'>;
export type BuildingId = Brand<string, 'BuildingId'>;
export type FloorId = Brand<string, 'FloorId'>; // 'B1' | '1F' | '2F' | '3.5F' ...

/** 실외 지점 노드 키: `op:<uuid>` / 층 평면 노드 키: `fp:<buildingId>:<floorId>` */
export type OutdoorNodeKey = `op:${string}`;
export type FloorNodeKey = `fp:${string}:${string}`;
export type HeightNodeKey = OutdoorNodeKey | FloorNodeKey;

/** 에폭 밀리초(Date.now()). 센서 이벤트의 timestamp(부팅 후 초)와 혼동 금지. */
export type EpochMs = number;

/**
 * 휘발성 데이터 표식. 이 타입이 붙은 값은 메모리 버퍼에만 존재해야 한다.
 * 직렬화 함수(serializeStore 등)는 Persisted 타입만 받도록 시그니처를 제한한다.
 */
export type Ephemeral<T> = T & { readonly __ephemeral: true };

export type Platform = 'android' | 'ios';

export interface LatLng {
  lat: number;
  lng: number;
}

/* ------------------------------------------------------------------ */
/* 1. 높이 변수 노드                                                    */
/* ------------------------------------------------------------------ */

export interface OutdoorPointNode {
  kind: 'outdoor_point';
  key: OutdoorNodeKey;
  position: LatLng; // WGS84. 평면좌표(EPSG:5186) 변환은 서버/파이썬에서 수행
  /** 2단계 잔차 보간의 영향 반경(m). 기본 1.0, 평지 보도 1~3, 계단·경사로 접점은 작게 */
  influenceRadiusM: number;
  /** 사람이 붙이는 라벨(예: '애지문 앞', '1공학관 정문 계단 하단') */
  label?: string;
  /** 지도 십자선으로 지정했을 때의 GPS 수평 정확도(m) — 품질 참고용 */
  horizontalAccuracyM?: number;
  createdAt: EpochMs;
}

export interface FloorPlaneNode {
  kind: 'floor_plane';
  key: FloorNodeKey;
  buildingId: BuildingId;
  floorId: FloorId;
  label?: string; // '1공학관 3층'
  createdAt: EpochMs;
}

export type HeightNode = OutdoorPointNode | FloorPlaneNode;

export const floorNodeKey = (b: BuildingId | string, f: FloorId | string): FloorNodeKey =>
  `fp:${b}:${f}` as FloorNodeKey;

export const outdoorNodeKey = (uuid: string): OutdoorNodeKey => `op:${uuid}` as OutdoorNodeKey;

/**
 * FloorId of a campus level (types.ts Level: 1F = 1, B1 = -1, never 0): 1 → '1F', -1 → 'B1'.
 * With floorNodeKey(building Feature id, floorIdOfLevel(level)) a campus floor and a measured floor plane are one height
 * variable, e.g. fp:bldg_ENG1:3F. tools/elevation/campo_height_solver.py uses the same rule (floor_id_of_level).
 * Height bookkeeping only: routing never reads it.
 */
export function floorIdOfLevel(level: number): FloorId {
  if (!Number.isInteger(level) || level === 0) throw new Error(`not a campus level: ${level}`);
  return (level > 0 ? `${level}F` : `B${-level}`) as FloorId;
}

/* ------------------------------------------------------------------ */
/* 2. 측정 세션 (절대 기압 없음)                                         */
/* ------------------------------------------------------------------ */

export type SessionMode = 'static' | 'walk';

export interface MeasurementSession {
  sessionId: SessionId;
  mode: SessionMode;
  platform: Platform;
  /** 기종별 σ 학습용. 개인 식별 불가한 모델명만 (예: 'SM-S921N', 'iPhone16,2') */
  deviceModel?: string;
  /** 앱 설치별 무작위 ID(재설치 시 바뀜). 같은 기기 차분 원칙 검증용 */
  installId: string;
  startedAt: EpochMs;
  endedAt?: EpochMs;
  /** hypsometric 식의 평균 기온. 없으면 15°C 가정 */
  airTempC?: number;
  /** 연속 보행 세션이면 따라간 경로 */
  routeId?: RouteId;
  appVersion?: string;
}

/* ------------------------------------------------------------------ */
/* 3. 휘발성: 10초 기압 창 / 연속 스트림 청크                              */
/* ------------------------------------------------------------------ */

/** 10초 정지 측정의 결과(훅이 반환). 절대 기압을 포함하므로 Ephemeral. */
export interface BarometerWindowResult {
  meanPressureHpa: number;
  /** MAD 이상치 제거 후 표본 표준편차 */
  stdHpa: number;
  sampleCount: number;
  /** 창 중앙 시각(에폭 ms) — 드리프트 보정·시간창 매칭 기준 */
  timestamp: EpochMs;
  // ---- 이하 품질 정보(선택) ----
  startedAt: EpochMs;
  endedAt: EpochMs;
  rejectedCount: number;
  /** 평균의 표준오차(자기상관 보정 전). σ 모델 입력 */
  stdErrHpa: number;
  /** 창 내부 선형 추세(hPa/s). 엘리베이터·이동 감지 */
  slopeHpaPerS: number;
  /** 가속도 기반 정지 비율(0~1) */
  stationaryRatio: number;
  warnings: BarometerWarning[];
  platform: Platform;
}

export type BarometerWarning =
  | 'LOW_SAMPLE_COUNT' // iOS는 약 1 Hz라 10초에 10개 내외
  | 'UNSTABLE_PRESSURE' // 바람·문 개폐·공조 요동 의심
  | 'PRESSURE_TREND' // 창 내부 추세가 큼(이동/엘리베이터)
  | 'DEVICE_MOVED' // 가속도 정지 비율 부족
  | 'NO_ACCELEROMETER';

/** 버퍼에 들어가는 '앵커 관측' = 기압 창 + 어느 노드에서 쟀는지 */
export type PressureAnchorObservation = Ephemeral<{
  windowId: WindowId;
  sessionId: SessionId;
  nodeKey: HeightNodeKey;
  /** 층 평면 대비 알려진 국소 단차(m). 예: 반층 로비 +1.2 */
  intraOffsetM: number;
  window: BarometerWindowResult;
  /** 버퍼 만료 시각 = window.timestamp + TTL(기본 30분) */
  expiresAt: EpochMs;
  source: 'static10s' | 'walk_stop' | 'walk_pass';
}>;

/** (v2) 연속 보행 기압 스트림 청크. 기기 메모리에서만 존재. */
export type PressureStreamChunk = Ephemeral<{
  sessionId: SessionId;
  /** 에폭 ms 배열과 hPa 배열(같은 길이) */
  t: EpochMs[];
  pHpa: number[];
}>;

/* ------------------------------------------------------------------ */
/* 4. 영속: Δh 엣지 — 시스템의 유일한 관측                                 */
/* ------------------------------------------------------------------ */

export type EdgeMethod =
  | 'static_pair' // 같은 세션 연속 두 정지 측정
  | 'roundtrip' // A→B→A 드리프트 보정 엣지
  | 'walk_anchor' // (v2) 연속 보행 중 앵커 간
  | 'manual'; // 줄자·도면 등 사람이 입력한 기준값(검증용으로 별도 보관 권장)

export type EdgeQc =
  | 'pending' // 아직 솔버 미반영
  | 'ok'
  | 'downweighted' // Huber IRLS에서 감가
  | 'rejected' // Baarda w-test 탈락
  | 'superseded'; // roundtrip 엣지로 대체된 원 엣지(중복 사용 금지)

export interface DhEdge {
  edgeId: EdgeId;
  from: HeightNodeKey;
  to: HeightNodeKey;
  /** h(to) − h(from) (m). 층 평면이면 intraOffset 적용 전 '측정점' 기준 값 */
  dhM: number;
  sigmaM: number;
  /** 두 측정 간 시간차(s) */
  dtS: number;
  offsetFromM: number; // 측정점 = 노드 높이 + offset
  offsetToM: number;
  sessionId: SessionId;
  method: EdgeMethod;
  qc: EdgeQc;
  robustWeight?: number; // 솔버가 기록
  supersedes?: EdgeId[]; // roundtrip이 대체한 엣지
  /** 생성 시 사용한 모델 파라미터(재현성) */
  model: {
    tempC: number;
    sigmaInstFloorHpa: number;
    driftHpaPerHour: number;
  };
  createdAt: EpochMs;
  /** (v2) 연속 보행이면 상대 고도 프로파일 참조 */
  profileId?: string;
}

/** (v2) 앵커 간 연속 상대 고도 프로파일 — 절대 기압 없음, 시작 앵커 기준 상대값만 */
export interface DhProfile {
  profileId: string;
  edgeId: EdgeId;
  /** 경로 시작점 기준 누적 거리(m) */
  sM: number[];
  /** 시작 앵커 기준 상대 높이(m) */
  relHM: number[];
  sigmaM?: number[];
}

/* ------------------------------------------------------------------ */
/* 5. (v2) 연속 보행 + 사진                                             */
/* ------------------------------------------------------------------ */

/** 경로 진행 중 노드를 통과한 시점(앵커 이벤트). 지도 매칭/수동 탭으로 결정 */
export interface RouteAnchorPass {
  sessionId: SessionId;
  nodeKey: HeightNodeKey;
  at: EpochMs;
  /** 경로 시작점 기준 누적 거리(m) */
  alongM: number;
  how: 'stop_detected' | 'user_tap' | 'map_match';
}

export type PhotoDecision = 'pending' | 'kept' | 'discarded';

export interface CapturedPhoto {
  photoId: PhotoId;
  sessionId: SessionId;
  capturedAt: EpochMs;
  /** 기기 로컬 URI(삭제 결정 전까지 앱 캐시) */
  localUri: string;
  /** 촬영 순간 나침반/진행방향(도, 진북 기준) */
  headingDeg?: number;
  headingAccuracyDeg?: number;
  /** 촬영 순간 경로상 누적 거리(보행 진행도 추정치) */
  alongM?: number;
  /** 촬영 직후 '살리기/지우기' 결정 */
  decision: PhotoDecision;
  decidedAt?: EpochMs;
}

export type PhotoDirection = 'forward' | 'backward' | 'side' | 'unknown';

/** 세션 종료 후 자동 매핑 결과(경로 구간 + 정/역방향) */
export interface PhotoAssignment {
  photoId: PhotoId;
  routeId: RouteId;
  /** 경로 폴리라인 구간 인덱스 */
  segmentIndex: number;
  alongM: number;
  direction: PhotoDirection;
  /** 0~1, 방향 판정 신뢰도 */
  confidence: number;
  /** 가장 가까운 높이 노드(있으면) */
  nearestNodeKey?: HeightNodeKey;
  method: 'auto_v1' | 'manual';
}

/* ------------------------------------------------------------------ */
/* 6. 솔버 결과 캐시(앱 표시용)                                          */
/* ------------------------------------------------------------------ */

export interface NodeEstimate {
  key: HeightNodeKey;
  hM: number; // 정표고(인천만 평균해면 기준, DEM과 같은 기준)
  sigmaM: number;
  /** 공통 datum 오차를 뺀 상대 σ(2단계 잔차장 가중에 쓰는 값) */
  sigmaRelM?: number;
  /** DEM Prior가 닿지 않는 고립 성분이면 true(상대 높이만 유효) */
  floating: boolean;
}

export interface SolveRunSummary {
  runId: string;
  solvedAt: EpochMs;
  nNodes: number;
  nEdges: number;
  chi2: number;
  dof: number;
  globalTestPassed: boolean;
  rejectedEdgeIds: EdgeId[];
}

/* ------------------------------------------------------------------ */
/* 7. 로컬 JSON 저장소 (packages/core ↔ apps/mobile ↔ tools/elevation)  */
/* ------------------------------------------------------------------ */

/**
 * 지형 불연속선(Break-line): 바깥 계단, 연석, 옹벽처럼 높이가 끊기는 선.
 * 2단계 잔차장 보간은 이 선을 가로질러 보정을 퍼뜨리지 않는다(campo_height_solver.py residual_field).
 * 캠퍼스 구간에서 나오는 선(edge_type 'outdoor' + highway 'steps', 또는 is_breakline: true)은 솔버가 구간 가운데에
 * 수직인 짧은 선으로 직접 만든다. 여기에는 그 밖에 사람이 따로 그린 선만 둔다.
 */
export interface BreakLine {
  id: string;
  /** WGS84 꺾은선(2점 이상) */
  coordinates: LatLng[];
  source: 'manual' | 'survey';
  note?: string;
  createdAt: EpochMs;
  /**
   * 낮은 쪽 면(선택): coordinates 진행 방향 기준 왼쪽('left') 또는 오른쪽('right') 법선 방향.
   * 없으면 어느 쪽이 낮은지 모름(솔버는 측면 분리만 한다).
   */
  lowSide?: BreakLineSide;
  /** 단차 높이(선택, m, 0 이상): 높은 쪽 − 낮은 쪽. lowSide와 함께 있을 때만 솔버가 높이 제약으로 쓴다. */
  dropM?: number;
}

export type BreakLineSide = 'left' | 'right';

export interface ElevationStoreV1 {
  schemaVersion: 1;
  /** 이 파일을 만든 앱 데이터의 지도 좌표계 기록(실외 노드는 항상 WGS84 저장) */
  positionCrs: 'EPSG:4326';
  /** 높이 기준 — DEM과 동일해야 함 */
  verticalDatum: 'KVD_INCHEON_MSL'; // 대한민국 수직기준(인천만 평균해면) 정표고
  nodes: HeightNode[];
  sessions: MeasurementSession[];
  edges: DhEdge[];
  /** 사람이 따로 그린 지형 불연속선(선택, 없는 예전 파일도 그대로 읽힘) */
  breaklines?: BreakLine[];
  // ---- v2 예약(지금은 빈 배열로 둬도 스키마 동일) ----
  profiles?: DhProfile[];
  anchorPasses?: RouteAnchorPass[];
  photos?: CapturedPhoto[];
  photoAssignments?: PhotoAssignment[];
  // ---- 솔버 결과 캐시 ----
  estimates?: NodeEstimate[];
  lastSolve?: SolveRunSummary;
}

/**
 * 영속 고도 저장소(현재 버전). 절대 기압 필드는 구조적으로 없다: 관측은 DhEdge의 Δh(dhM)·σ(sigmaM)·Δt(dtS)뿐이고,
 * 원본 DEM은 이 파일에 들어오지 않는다(tools/elevation이 읽기 전용 Prior로만 읽음).
 */
export type ElevationStore = ElevationStoreV1;

/**
 * 직렬화 가능한 타입 검사: Ephemeral 표식이 섞이면 never가 된다.
 * serializeStore(store: Persisted<ElevationStoreV1>) 같은 식으로 사용.
 */
export type Persisted<T> = T extends { readonly __ephemeral: true } ? never : T;

/* ------------------------------------------------------------------ */
/* 8. 물리 상수 / 기본 파라미터                                          */
/* ------------------------------------------------------------------ */

export const PHYS = {
  /** 건조공기 기체상수 J/(kg·K) */
  Rd: 287.05,
  /** 표준 중력 m/s² */
  g0: 9.80665,
  T0K: 273.15,
} as const;

export interface DhModelParams {
  /** 시간창 상한(분). 이 이상 떨어진 두 측정은 엣지를 만들지 않음 */
  maxPairDtMin: number;
  /** 버퍼 TTL(분) */
  bufferTtlMin: number;
  /** 창 하나당 표준오차 하한(hPa): 자기상관·공조 요동 등 10초 평균으로 안 줄어드는 성분 */
  sigmaInstFloorHpa: number;
  /** 기상성 기압 변화 불확실성(hPa/h). Δt 비례로 σ에 가산 */
  driftHpaPerHour: number;
  /** roundtrip 보정 후 남는 드리프트 비선형 성분 비율(0~1) */
  roundtripResidualDriftRatio: number;
  defaultTempC: number;
}

/** 초기값 — 팀이 정지폰 로그/왕복 폐합차로 반드시 재추정할 것 */
export const DEFAULT_DH_MODEL: DhModelParams = {
  maxPairDtMin: 30,
  bufferTtlMin: 30,
  sigmaInstFloorHpa: 0.03,
  driftHpaPerHour: 0.3,
  roundtripResidualDriftRatio: 0.25,
  defaultTempC: 15,
};
