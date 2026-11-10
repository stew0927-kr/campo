# Claude Code 첫 작업 지시

아래 순서대로, **작업 하나마다 새 대화**(`/clear`)로 시작한다. 1~3은 리드, 4~6은 편집기 담당, 7은 데이터 담당이 쓴다.
각 작업은 plan 모드(Shift+Tab)로 계획을 먼저 보고, 계획이 SPEC과 맞으면 승인한다.

---

## 1. 저장소 뼈대 (리드)

```
docs/SPEC.md와 AGENTS.md를 읽어. SPEC 9장 구조대로 npm workspaces 모노레포 뼈대를 만들어 줘.

- packages/core, packages/editor, packages/tools 세 패키지. 모두 TypeScript.
- 루트 스크립트: test(Vitest), typecheck, validate(packages/tools의 CLI 실행), editor(packages/editor 개발 서버).
- 라이브러리는 설치 시점의 최신 안정 버전으로 고정(package-lock 커밋).
- .gitignore에 node_modules, derived/, data/ref/ 추가.
- .github/workflows/validate.yml: PR마다 npm ci, typecheck, test, validate.
- 아직 기능 코드는 쓰지 말고, 각 패키지에 통과하는 빈 테스트 하나씩만.

끝나면 npm install, npm test, npm run typecheck를 실행한 결과를 보여 줘.
```

## 2. 스키마와 검사 (리드)

```
docs/SPEC.md 4장과 7장을 읽어.

1. data/schema/campo.schema.json을 4장대로 만들어(JSON Schema, kind별로 필수 속성 분기).
2. packages/core에 같은 내용의 TypeScript 타입, 캠퍼스 폴더 전체를 읽어 하나로 합치는 loadCampus(), 7장 검사를 하는 validateCampus()를 만들어. 결과는 {errors, warnings} 배열이고 각 항목에 file, featureId, code, message가 있어.
3. packages/core/test/fixtures/에 가짜 캠퍼스를 만들어. 바깥 지점 6개, 건물 2개(A동: 1층과 4층이 지면에 닿음, B동: 1층만 지면), A동 엘리베이터 1~4층, A동 계단 1~4층, A동 4층 출입구 포탈, 바깥 계단 1개, A동 3층–B동 2층 연결통로, 강의실 문 2개.
4. 7장의 오류 8개와 경고 4개 각각에 대해, fixture를 일부러 망가뜨린 테스트를 하나씩 써.
5. packages/tools에 validate CLI를 만들어 data/campuses/ 아래 모든 캠퍼스를 검사하고, 오류가 있으면 종료 코드 1.

끝나면 npm test와 npm run validate 결과를 보여 줘. 실제 캠퍼스 데이터 폴더는 아직 비어 있어도 돼.
```

## 3. 길찾기 (리드)

```
docs/SPEC.md 6장을 읽어. packages/core에 길찾기를 만들어.

- buildGraph(campus): ngraph.graph로 그래프 생성. bidirectional이면 양방향.
- findRoute(graph, fromId, toId, profile): profile은 'shortest' | 'step_free'. ngraph.path A*, 휴리스틱은 측지 직선거리.
- 비용 상수는 costs.ts 한 파일에.
- 결과: 지점 목록, 총 거리(m), 예상 시간(분), 계단 구간 수, 층 이동 목록(사람이 읽는 한국어 문장 배열).

테스트(작업 2의 fixture 사용):
- 바깥 시작점 → A동 4층 강의실: shortest는 바깥 계단을 쓰고, step_free는 계단 없이 4층 포탈로 들어간다.
- 바깥 → B동 2층 강의실: step_free는 A동 엘리베이터 → 3층 연결통로를 쓴다.
- 계단만 있는 곳으로 가는 step_free 요청은 '경로 없음'을 반환한다.
- 길찾기 코드 어디에서도 level 값을 비교하지 않는지 확인하는 테스트(그래프에서 level을 지워도 같은 결과).

끝나면 npm test 결과를 보여 줘.
```

## 4. 편집기 뼈대와 바깥 길 (편집기 담당)

```
docs/SPEC.md 8장과 AGENTS.md를 읽어. packages/editor에 편집기 첫 화면을 만들어.

- Vite + React + MapLibre GL JS + Terra Draw(MapLibre 어댑터).
- 화면 배치: 왼쪽 지도, 오른쪽 패널(속성/검사/길찾기 탭은 빈 자리만), 위 도구 막대, 아래 상태 표시줄.
- 배경은 OSM 표시용 타일 하나만(출처 표시 포함). 국토지리정보원 영상지도는 자리만 만들고 API 키를 .env에서 읽게.
- 중심은 data/campuses/hanyang-seoul/campus.json의 중심 좌표. 없으면 만들어(한양대 서울캠퍼스 대략 중심).
- '바깥 길' 도구: 클릭하며 이어 그리면 node·edge Feature가 SPEC 4장 형식으로 생기고, 기존 지점 5px 안을 클릭하면 그 지점에 붙는다. 평지/계단/경사로 선택.
- 상태는 packages/core 타입을 그대로 쓰고, 화면용 상태와 저장용 GeoJSON을 섞지 마.
- 저장: Vite 개발 서버에 작은 로컬 API를 붙여 SPEC 4.3 배치대로 data/에 파일을 써. Feature는 id 순 정렬, 한 줄에 하나.

끝나면 npm run editor로 실행해서 바깥 길 3구간을 그리고 저장한 뒤, 생긴 outdoor.geojson 내용과 npm run validate 결과를 보여 줘. 가능하면 Playwright로 화면 스크린샷도 찍어 줘.
```

## 5. 건물·층·수직 이동 (편집기 담당)

```
docs/SPEC.md 8장의 건물, 건물 선택, 지점 추가, 엘리베이터, 계단, 잇기 도구를 만들어. 층마다 화면에 고른 층만 진하게 보이게 하고, 저장은 buildings/{code}/ 아래 파일로.
엘리베이터 도구는 정차 층 체크로 모든 층의 지점과 구간을 한 번에 만들고, 계단 도구는 층 사이 한 칸씩 만들어.

끝나면 fixture와 같은 모양(A동 1~4층, 엘리베이터, 계단)을 편집기로 직접 만들어 저장하고, npm run validate 결과를 보여 줘.
```

## 6. 포탈·연결통로·검사·길찾기 탭 (편집기 담당 + 리드)

```
docs/SPEC.md 8장의 포탈, 연결통로 도구와 검사 탭, 길찾기 탭을 만들어. 검사와 길찾기는 packages/core의 validateCampus, findRoute를 그대로 불러 써(편집기 안에서 다시 구현하지 마).
길찾기 탭은 두 프로필 경로를 다른 색으로 그리고 거리·시간·계단 수·층 이동 목록을 보여 줘. 검사 항목을 클릭하면 지도가 그 위치로 이동해.

끝나면 직접 만든 A동 데이터로 두 경로를 띄운 스크린샷을 보여 줘.
```

## 7. 실제 데이터 입력 (데이터 담당)

코드 작업이 아니라 편집기를 쓰는 작업이다. 애지문 → 백남학술정보관 구역부터 시작한다.

1. 바깥 길과 바깥 계단을 그린다. 확실하지 않은 곳은 `needs_check`를 켠다.
2. 경로에 걸리는 건물(제1공학관, 한양플라자, 사회과학관 등)을 등록하고, 출입구 층과 엘리베이터·계단 위치를 넣는다.
3. 검사 탭의 "현장 확인 필요" 목록을 들고 현장에서 사진을 찍으며 확인하고, 확인한 것만 `step_free: true`, `source: field-survey-…`로 바꾼다.
4. 길찾기 탭에서 애지문 → 백남학술정보관 두 경로를 확인한다. 이것이 SPEC 1장 완료 기준이다.

Claude Code에는 이렇게 시킨다: "data/campuses/hanyang-seoul을 npm run validate로 검사하고, 오류와 현장 확인 필요 목록을 건물별 표로 정리해 줘."
