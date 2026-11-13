# 캠포 지도 데이터 편집기 SPEC v0.1

캠포 길안내에 쓰는 캠퍼스 보행 데이터(바깥 길, 바깥 계단, 건물 문, 엘리베이터, 계단, 연결통로, 강의실)를 지도 위에서 그리고 저장하는 웹 도구와, 그 데이터를 검사하고 경로를 계산하는 공용 코드를 만든다.

## 1. 목표와 완료 기준

v0.1은 아래가 모두 되면 끝이다.

1. 편집기에서 한양대 서울캠퍼스 "애지문(한양대역 2번 출구) → 백남학술정보관" 구역의 바깥 길과 관련 건물 내부를 그려 저장할 수 있다.
2. `npm run validate`가 오류 없이 통과한다.
3. 편집기의 길찾기 미리보기에서 같은 출발·도착에 대해 **계단 포함 최단 경로**와 **계단 없는 경로(엘리베이터 경로)** 두 개가 나온다.
4. 두 경로 모두에 대한 자동 테스트가 있고 통과한다.

## 2. 범위

**v0.1에 넣는 것**

- 바깥 보행망 그리기: 지점(node)과 구간(edge)
- 건물 등록: 외곽선 폴리곤, 층 목록
- 건물 안 층별 입력: 출입구, 문, 엘리베이터, 계단, 연결통로, 강의실(목적지 지점)
- 포탈 연결: 건물 출입구 ↔ 바깥 지점
- 검사(validate)와 길찾기 미리보기
- 저장소 안의 GeoJSON 파일로 저장

**v0.1에 넣지 않는 것**

- 강의실·복도 모양(폴리곤) 그리기. 강의실은 문 지점 하나로만 표현한다.
- 고도(DEM)와 건물 높이 합치기. 결합 키만 남겨 둔다(5장).
- 사용자용 길안내 웹 화면
- 로그인, 서버 DB, 실시간 동시 편집
- 축제 기능

## 3. 정해진 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 데이터 형식 | 자체 GeoJSON 스키마. 속성 이름은 OSM Simple Indoor Tagging 어휘(level, door, entrance, highway, indoor)를 따른다 | IMDF·IndoorGML보다 배우기 쉽고, 나중에 변환이 쉽다 |
| 길찾기 데이터 | 사람이 지점·구간을 직접 그린다. 도형에서 자동 생성하지 않는다 | 디버깅이 쉽고 포탈·계단을 구간 속성으로 바로 표현한다 |
| 층과 포탈 | **길찾기는 층 번호를 비교하지 않고 구간 연결만 따른다.** 언덕 때문에 4층 문이 지면에 닿으면, 그 출입구를 바깥 지점에 포탈 구간으로 잇는다 | 언덕 캠퍼스 문제를 구조로 해결한다 |
| 층 번호 | 건물 내부 기준 정수. 1층=1, 지하1층=-1, 0은 쓰지 않는다. 바깥은 `null` | 한국식 표기와 같게 |
| 계단 | 층 사이 한 칸씩 구간으로 그린다(2→3층 계단 하나, 3→4층 계단 하나) | 층수에 비례한 비용 계산 |
| 엘리베이터 | 정차 층마다 지점을 두고, 이웃한 정차 층끼리 구간으로 잇는다 | 같은 이유 |
| 지도 | MapLibre GL JS + Terra Draw(MapLibre 어댑터) | 오픈 라이선스, 공식 어댑터 |
| 길찾기 | ngraph.graph + ngraph.path(A*), 브라우저와 Node 공용 | 서버 없이 동작 |
| 저장 | Git 저장소의 GeoJSON 파일. 편집기는 로컬 개발 서버로 실행하고, 저장 버튼이 저장소 파일에 직접 쓴다. 그 뒤 사람이 커밋한다 | 무료, 변경 이력과 되돌리기가 자동 |
| 좌표 | EPSG:4326(경도, 위도 순서). 길이는 Turf.js 측지 거리로 계산 | GeoJSON 표준 |
| 배경 지도 | 표시용 OSM 타일 + 따라 그리기용 국토지리정보원 영상지도(공공누리 1유형, 출처 표시). **구글·네이버·카카오 지도와 위성사진은 편집기에 넣지 않는다** | 약관상 따라 그린 데이터를 쓸 수 없음 |
| 기술 | npm workspaces, TypeScript, Vite + React, Vitest, ajv(JSON Schema) | |

## 4. 데이터 모델

### 4.1 공통 규칙

- 모든 Feature에 최상위 `id`(문자열)를 둔다. **ID는 캠퍼스 전체에서 유일해야 한다.**
- 모든 Feature의 `properties`에 `kind`와 `source`가 있다.
- `source` 값 예: `field-survey-2026-11`(현장 확인), `ngii-imagery`(영상지도 보고 그림), `school-floorplan`(학교 안내도), `estimate`(추정, 현장 확인 필요).
- `step_free`(계단·문턱 없이 지날 수 있는지)는 현장에서 확인한 경우에만 `true`로 둔다. 기본값은 `false`다.
- `needs_check: true`가 붙은 Feature는 검사 패널의 "현장 확인 필요" 목록에 나온다.

### 4.2 Feature 종류

| kind | geometry | 필수 속성 | 선택 속성 |
|---|---|---|---|
| `building` | Polygon | `name`, `code`, `levels`(정수 배열), `ground_levels`(지면과 닿는 층 배열) | `ext.moct_bldg_id`, `ext.floor_height_m` |
| `node` | Point | `node_type`, `building_id`(바깥은 null), `level`(바깥은 null) | `name`, `ref`, `shaft_id`, `space_name`, `needs_check` |
| `edge` | LineString | `highway`, `from`, `to`, `bidirectional`, `step_free` | `edge_type`, `level_from`, `level_to`, `step_count`, `covered`, `hours`, `building_from`, `building_to`, `needs_check` |

`node_type` 값

| 값 | 뜻 |
|---|---|
| `outdoor` | 바깥 길 위 지점(갈림길, 계단 끝 등) |
| `entrance` | 건물 출입구(바깥과 이어지는 문) |
| `door` | 건물 안 문. 강의실 문은 `space_name`(예: "408호 강의실")과 `ref`("408")를 붙인다 |
| `corridor` | 건물 안 복도 위 지점 |
| `elevator_stop` | 엘리베이터 정차 지점. 같은 엘리베이터는 같은 `shaft_id` |
| `stair_landing` | 계단의 층별 끝 지점 |
| `poi` | 출발·도착 후보(역 출구, 정문, 애지문 등) |

`highway`와 `edge_type` 값

| highway | edge_type | 뜻 |
|---|---|---|
| `footway` | `outdoor` | 바깥 평지 길 |
| `steps` | `outdoor` | 바깥 계단 |
| `footway` | `portal` | 출입구 ↔ 바깥 지점 |
| `corridor` | `indoor` | 건물 안 복도 |
| `steps` | `indoor` | 건물 안 계단(층 사이 한 칸) |
| `elevator` | `indoor` | 엘리베이터(이웃 정차 층 사이) |
| `corridor` | `bridge` | 건물 간 연결통로. `building_from`, `building_to`, `level_from`, `level_to` 필수 |
| `ramp` | `outdoor` 또는 `indoor` | 경사로 |

### 4.3 파일 배치

```
data/campuses/hanyang-seoul/
├─ campus.json                 # id, name, center([경도, 위도]), bbox([서, 남, 동, 북]), map_limits(선택: 편집기 지도 이동 범위)
├─ outdoor.geojson             # 바깥 node·edge, poi
├─ connections.geojson         # 포탈 edge, 연결통로(bridge) edge
└─ buildings/
   └─ {code}/
      ├─ building.geojson      # building Feature 1개
      └─ L{level}.geojson      # 그 층의 node·edge (지하는 L-1)
                               # 층을 넘는 계단·엘리베이터 edge는 아래층 파일에 둔다
```

- `campus.json`의 `map_limits`(선택): `bounds`([서, 남, 동, 북], 캠퍼스 중심을 포함해야 함), `min_zoom`, `max_zoom`. 편집기는 지도를 이 범위 밖으로 옮기지 못하게 한다. 범위는 코드에 두지 않고 캠퍼스마다 이 파일에 적는다(한양대는 중심에서 약 1.5km). 없으면 제한이 없다. 검사 E14가 순서·중심·줌 범위를 확인한다(v0.2 8장).
- 한 건물은 한 사람이 맡아 편집한다. 그러면 Git 충돌이 거의 없다.
- 저장할 때 Feature는 `id` 순서로 정렬하고, Feature 하나를 한 줄에 쓴다. 그래야 Git에서 바뀐 부분이 잘 보인다.

### 4.4 ID 규칙

| 대상 | 형식 | 예 |
|---|---|---|
| 건물 | `bldg_{code}` | `bldg_ENG1` |
| 바깥 지점 | `n_out_{4자리}` | `n_out_0042` |
| 건물 안 지점 | `n_{code}_{level}_{이름}` | `n_ENG1_3_backdoor`, `n_ENG1_4_408door` |
| 엘리베이터 정차 | `n_{code}_elev{기호}_L{level}` | `n_ENG1_elevA_L1` |
| 구간 | `e_{from 지점 id 꼬리}__{to 지점 id 꼬리}` 또는 편집기가 붙인 고유 번호 | `e_out_0042__out_0043` |

### 4.5 예시

```json
{"type":"Feature","id":"n_ENG1_1_main","geometry":{"type":"Point","coordinates":[127.0451,37.5559]},"properties":{"kind":"node","node_type":"entrance","building_id":"bldg_ENG1","level":1,"name":"제1공학관 정문","source":"estimate","needs_check":true}}
{"type":"Feature","id":"e_portal_ENG1_1_main","geometry":{"type":"LineString","coordinates":[[127.0451,37.5559],[127.04512,37.55593]]},"properties":{"kind":"edge","highway":"footway","edge_type":"portal","from":"n_ENG1_1_main","to":"n_out_0042","bidirectional":true,"step_free":false,"source":"estimate"}}
{"type":"Feature","id":"e_ENG1_elevA_L1__L3","geometry":{"type":"LineString","coordinates":[[127.0455,37.5557],[127.0455,37.5557]]},"properties":{"kind":"edge","highway":"elevator","edge_type":"indoor","from":"n_ENG1_elevA_L1","to":"n_ENG1_elevA_L3","level_from":1,"level_to":3,"bidirectional":true,"step_free":true,"source":"field-survey-2026-11"}}
```

좌표는 예시용이다. 실제 위치가 아니다.

## 5. 고도·건물 높이 결합 (v0.1에서는 키만)

- 원본 데이터는 고치지 않는다. 나중에 빌드 스크립트가 `derived/elevation.json`(`{ node_id: { z_ground_m, z_floor_m } }`)을 만든다.
- 결합 키: 건물은 `ext.moct_bldg_id`(국토교통부 GIS건물통합정보 고유번호), 지점은 좌표. 건물 높이는 층수 × 층고로 계산한다.
- 외부 원본은 `data/ref/`에 두고 Git에 올리지 않는다(.gitignore).

## 6. 길찾기 규칙

`packages/core`가 모든 GeoJSON을 읽어 그래프를 만들고 두 프로필로 경로를 찾는다. 구간 길이는 LineString의 측지 길이(m)다.

| 구간 | `shortest`(계단 포함) | `step_free`(계단 없음) |
|---|---|---|
| footway, corridor | 길이 | 길이. 단 `step_free: false`면 통행 불가 |
| steps | 길이 × 1.5 + 층(또는 계단 한 칸)당 15 | 통행 불가 |
| elevator | 30 + 층 차이 × 5 | 같음 |
| ramp | 길이 × 1.2 | 길이 × 1.2 |
| portal | 길이 + 2 | 길이 + 2. 단 `step_free: false`면 통행 불가 |

- 숫자는 "미터와 같은 단위의 비용"이고, 현장에서 걸어 보며 조정한다. 상수는 한 파일(`costs.ts`)에 모은다.
- 결과에는 지나는 지점 목록, 총 거리(m), 예상 시간(분, 보행 속도 1.2m/s와 엘리베이터 대기 포함), 계단 구간 수, 층 이동 목록("제1공학관 1층 → 엘리베이터 → 3층")을 담는다.
- `step_free` 프로필에서 바깥 길의 `step_free: false`는 계단이 아닌 단차·문턱을 뜻한다. v0.1에서는 바깥 footway를 그릴 때 기본값을 `true`로 두고, 단차가 있으면 사람이 `false`로 바꾼다. 건물 안과 포탈은 기본값 `false`다.

## 7. 검사(validate) 항목

`npm run validate`는 아래를 검사하고, 오류는 파일 이름과 Feature id를 함께 출력한다.

**오류(실패)**

1. JSON Schema 위반(필수 속성 누락, 잘못된 값)
2. ID 중복(캠퍼스 전체)
3. 구간의 `from`·`to`가 없는 지점을 가리킴
4. 구간 선의 양 끝 좌표가 `from`·`to` 지점 좌표와 1m 넘게 다름(엘리베이터 제외)
5. 건물 안 지점의 `level`이 그 건물 `levels`에 없음
6. 엘리베이터·계단 구간의 `level_from`·`level_to`가 양 끝 지점의 level과 다름
7. `ground_levels`에 있는 층에 `entrance` 지점이 하나도 없음
8. `entrance` 지점이 포탈 구간에 연결되지 않음

**경고(통과는 함)**

1. 어떤 구간에도 연결되지 않은 지점
2. 다른 부분과 끊긴 그래프 조각
3. `needs_check: true` 목록
4. `poi` 지점에서 모든 강의실 문까지 `step_free` 경로가 없는 경우

## 8. 편집기 기능 (v0.1)

화면: 왼쪽 지도, 오른쪽 패널(속성 / 검사 / 길찾기 탭), 위쪽 도구 막대, 아래쪽 상태 표시줄(현재 건물·층, 저장 여부).

**지도 보기**

- 배경 전환: OSM 표시용 / 국토지리정보원 영상지도. 화면 구석에 출처 표시.
- 바깥 모드에서는 바깥 데이터와 건물 외곽선만 진하게, 건물 모드에서는 고른 건물의 고른 층만 진하게 보인다.

**도구**

| 도구 | 동작 |
|---|---|
| 바깥 길 | 지도를 클릭하며 이어 그리면 지점과 구간이 자동으로 생긴다. 기존 지점 근처(5px)를 클릭하면 그 지점에 붙는다. 종류(평지 / 계단 / 경사로)는 도구 막대에서 고른다 |
| 건물 | 외곽선을 그리고 이름·코드·층 목록·지면 층을 입력한다 |
| 건물 선택 | 건물을 클릭하면 층 선택기가 나온다. 층을 고르면 건물 모드가 된다 |
| 지점 추가 | 건물 모드에서 종류(출입구 / 문 / 강의실 문 / 복도 / 엘리베이터 / 계단)를 고르고 클릭한다 |
| 엘리베이터 | 한 번 클릭하고 정차 층을 체크하면, 모든 정차 층에 지점과 구간이 같은 위치에 생긴다 |
| 계단 | 한 번 클릭하고 시작·끝 층을 고르면 층 사이 한 칸씩 지점과 구간이 생긴다 |
| 잇기 | 두 지점을 차례로 클릭해 구간을 만든다 |
| 포탈 | 건물 모드의 출입구를 고르고, 바깥 지점을 클릭하면 포탈 구간이 생긴다 |
| 연결통로 | 두 건물의 지점을 차례로 고르면 bridge 구간이 생긴다 |
| 선택·이동·삭제 | 지점을 끌면 이어진 구간 끝도 따라간다. 지점을 지우면 이어진 구간도 지워진다(확인창) |

**속성 패널**: 고른 Feature의 속성을 폼으로 편집한다. `step_free`, `needs_check`, `source`는 항상 보인다.

**검사 탭**: 7장 검사를 편집기 안에서 돌리고, 항목을 클릭하면 그 위치로 지도가 이동한다.

**길찾기 탭**: 출발·도착을 `poi`나 강의실 이름으로 검색해 고르면, 두 프로필 경로를 다른 색으로 그리고 거리·시간·계단 수·층 이동 목록을 보여 준다.

**저장**: 저장 버튼(또는 Ctrl+S)이 4.3장 배치대로 파일을 쓴다. 저장 전에 오류 검사를 돌려, 오류가 있으면 경고하고 그래도 저장할지 묻는다. 실행 취소/다시 실행(Ctrl+Z / Ctrl+Shift+Z)을 지원한다.

## 9. 저장소 구조

```
campo/
├─ AGENTS.md  CLAUDE.md  package.json
├─ docs/      SPEC.md, decisions.md, editing-guide.md
├─ data/      campuses/…, schema/campo.schema.json, ref/(git 제외)
├─ packages/
│  ├─ core/   스키마 타입, 불러오기, 검사, 그래프, 길찾기 (브라우저·Node 공용)
│  ├─ editor/ 편집기 (Vite + React + MapLibre + Terra Draw, 저장용 로컬 API 포함)
│  └─ tools/  validate CLI, 이후 고도 결합 스크립트
├─ derived/   빌드 결과(git 제외)
└─ .github/workflows/validate.yml   PR마다 npm test와 npm run validate
```

## 10. 담당과 순서

| 순서 | 작업 | 담당 |
|---|---|---|
| M1 | 저장소 뼈대, JSON Schema, `core`의 불러오기·검사, 테스트용 가짜 데이터(fixture), validate CLI, CI | 리드 |
| M2 | `core` 길찾기 두 프로필 + fixture 테스트 / 편집기 지도·바깥 길·건물 도구 | 리드 / 편집기 담당 |
| M3 | 편집기 층 화면·엘리베이터·계단·포탈·연결통로·저장 / 검사·길찾기 탭 | 편집기 담당 / 리드 |
| M4 | 애지문 → 백남학술정보관 구역 실제 데이터 입력, 현장 확인, 완료 기준 테스트 | 데이터 담당(+전원) |

사용자 웹 담당은 M2부터 `packages/core`의 길찾기 결과를 받아 화면을 만드는 별도 SPEC으로 시작한다.

## 11. 열린 질문

- 국토지리정보원 영상지도 API 키 발급과 해상도가 캠퍼스 따라 그리기에 충분한지 M2에서 확인한다.
- 학교 층별 안내도를 배경으로 써도 되는지 학교에 문의한다.
- 엘리베이터 운영 시간(`hours`)을 길찾기에 반영할지는 v0.2에서 정한다.
