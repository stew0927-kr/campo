# A조원 최종 점검 — 구현과 검증 범위

기준 커밋 `1a3df76` 이후 최종 보완입니다. A-5 PC 편집기, 길찾기 엔진, 실제 캠퍼스 데이터, Supabase 서버, 계약/Hook 및 공용 설정은 변경하지 않습니다. 모든 작업은 기존 `feat/app-map`에서 로컬 커밋으로만 저장합니다.

## ① 완료 — 데이터 없이 구현하고 자동 검증한 업무

| 역할/가이드 항목 | 구현·확인한 내용 | 자동 확인 |
|---|---|---|
| A-1 전체 화면·와이어프레임·버튼 흐름 | `SCREEN_FLOW.md`의 화면 목록, 모바일/태블릿 설계도, Mermaid 이동도, 버튼별 동작표 | 문서와 실제 화면/상태/클릭 검사 대조 |
| A-2 메인 지도 | 시작 탭은 지도. 입력보다 지도가 먼저 나오는 순서. 기존 OSM 출처 유지 | 실제 화면 컴포넌트 렌더링·클릭, 지도 모듈은 대체 |
| 건물·강의실 검색/선택 | 실제 지점 검색, 지도 점/지점 선택, 실내는 등록 지점만 허용 | fixture 검색/임의 점/없는 지점/캠퍼스 밖/실내 연결 |
| 길찾기 연결 | 기존 Hook·엔진 호출, 경로선·시간·거리·단계·층·경사·대체 안내 | 엔진/화면 연결 테스트, 실내·휠체어·엘리베이터 fixture |
| 입력 제어 보완 | 출발·도착 교환, 초기화, 지도 선택 취소, 오래된 결과 해제 | 버튼을 실제 클릭해 상태/경로 좌표 확인 |
| A-3 5탭·실내외·건물·층 | 탭/상세/검색 조건/체크 상태 유지. 뒤로가기는 모달/상세→목록→지도. 기본 보행 방식 반영 | 5탭 이동, 상세 유지·뒤로가기, 실내외 버튼·실내 경로 |
| A-4 4종 화면·큰 글씨 | 320/390/430/1024dp, 콘텐츠 최대 960dp, 패딩·지도 높이·세로 동작 버튼·짧은 탭 라벨·44dp 터치, 키보드 회피 코드 | 레이아웃 정책 단위 검사, DOM 대체 화면 4크기+1.6배 글씨에서 5탭 계측·PNG |
| 논술 | 2027학년도·11/28~29 시연 고지, 날짜/검색/상세/호실/입실 마감·준비물·주의사항/체크리스트·실제 ETA 있을 때만 출발 역산 | 날짜·여러 단어/호실 검색, 체크·즐겨찾기·지도 전달, 한국 시간 역산 |
| 축제 | 3일 공연/출연진/무대, 4분류 부스/검색/상세/운영·대기·즐겨찾기/세 동선 버튼 | 날짜·카테고리·검색, 공유 즐겨찾기, 입장/대기/퇴장 전달, 4테이블 계약 |
| 학교행사 | 7개 가상 콘텐츠, 다가오는/전체+5분류+검색, 고정 공지, 이번 주(앞으로 7일)/이번 달/이후/지난 묶음, 상세/길찾기/원문 처리/빈 결과 전체 복귀 | 기간·분류·텍스트 조합, 날짜 경계·정렬·원문 URL/실패 처리, 클릭 복귀 |
| 내정보 | 일반/계단 회피/휠체어, 장소/부스/행사/기타 즐겨찾기 공유, 동적 버전·OSM·라이선스·권한·설정 링크 | 기본 옵션 반영, 목록 추가/삭제/필터/길찾기, 외부/설정 링크 호출 |
| 핵심 탭 간 길찾기 | 논술·축제·행사·즐겨찾기에서 지도 이동. 실제 ID면 자동 선택, 없거나 오래된 ID면 이름 검색. 가상 fixture와 실제 콘텐츠 분리 | reducer→목적지 해석→fixture 경로 계산, 실제 버튼 클릭/검색 값 확인 |
| 데이터 없음·오류 | 가상 고지, 실제 노드 없음 안내, 빈 검색/필터, 콘텐츠 재시도·화면 오류 경계 | Node 화면·가상 HTTP·빈 목록·오류 검사 |
| 읽기 전용 서버 준비 | `remote.ts`: 6테이블 GET, 공개 필터·행 검증·5초 제한·명시적 시연 대체·관리자 키 거부 | 모의 HTTP 성공/잘못된 응답/403/timeout/공개 키 제한. 실제 호출 없음 |

앱은 요청대로 `DEMO_SOURCE`를 유지합니다. 읽기 어댑터는 D가 공개 연결 정보를 준 뒤 검증하여 교체할 준비 코드이며, 현재 실서버 연동이 완료됐다는 뜻이 아닙니다. 개인정보 처리방침·원문 URL이 없는 항목은 미제공/준비 중이라고 표시합니다. 실제로 작동하지 않는 가짜 링크를 만들지 않습니다.

## ② 미검증 — 구현했지만 Android 기기에서 확인해야 하는 것

- MapLibre 지도 타일·제스처·카메라·핀/경로선·실내 외곽선·층별 선의 실제 표시.
- 실제 키보드로 작은 화면의 검색·모달, 노치/안전 영역, Android 뒤로가기·글씨 확대·TalkBack·회전/기종별 레이아웃.
- 위치 권한 최초 요청/영구 거절/설정 복귀, 30분 야외 GPS 추적·실외 경로 이탈 재탐색, 기압·층 전환·백그라운드 구독 종료.
- 사진 썸네일·다운로드·확대 뷰어·방향 표시. 연결 코드는 기존 사진 기능을 사용하지만 실제 공급 사진이 없습니다.
- Android JavaScript 번들 성공은 APK 설치/네이티브 실행 성공과 다릅니다. 이번에 APK를 만들거나 배포하지 않습니다.

DOM 검수 환경은 실제 A 화면의 React 상태·버튼 이벤트를 실행합니다. `react-native`, 지도·권한·센서·사진을 테스트용으로 대체하며 네이티브 화면이 아닙니다. 수평 넘침/탭 크기/하단 노출과 클릭 흐름은 이 대체 환경에서 검증했습니다. **이 PNG를 실제 Android 앱 스크린샷이라고 제시하면 안 됩니다.**

## ③ 외부 작업 대기 — 구체적으로 받아야 하는 것

| 담당 | 필요한 결과 | 받으면 A가 확인할 작업 |
|---|---|---|
| C | 실제 선정 구간/건물/층의 노드·엣지·무단차·경사, 강의실/출입구 ID | 번들 갱신 후 검색·표시·보행 방식·현장 경로 확인 |
| C/D | 고사장·부스·공연·행사/입장·퇴장 실제 node ID | 현재 검색 대체를 정확한 목적지/동선으로 연결해 확인 |
| C/D | 사진·방위·지점 메타데이터와 공개 공급 URL | 기존 사진 카탈로그/마커/뷰어 표시 확인 |
| D | Supabase 공개 URL·공개 읽기 키·공개 콘텐츠·RLS 확인 | 이미 준비한 읽기 전용 source로 교체, 실제 응답 검증. 서버 변경은 D 담당 |
| D | 개인정보 처리방침 URL·팀 문의처·실제 원문 링크 | 준비 중/미제공 표시를 실제 링크로 연결 |
| B/팀 | MapLibre 포함 Android 개발 앱, 배포 전 전체 네이티브/간접 라이선스 고지 | 위 실기기 체크리스트 실행. 서명·배포·공용 설정은 이번 범위 밖 |

설정·즐겨찾기 영속 저장, 로그인, 실내 자동 재탐색/대기열 혼잡 추정은 이번 가이드의 시연 필수 범위 밖입니다. 메모리 저장과 해당 기능 한계를 명시했습니다. 아이콘·스플래시·웹 런타임 설치·공용 설정 변경도 허용 범위 밖이어서 임의 변경하지 않았습니다.

## 검증 재현

```sh
npm run typecheck
npm test
npx vitest run --config apps/app/src/features/map/vitest.config.mts
CAMPO_CHROMIUM=/usr/bin/chromium node apps/app/test/uiHarness/check.mjs
```

마지막 명령은 설치된 Chromium이 필요합니다. 현재 검수 결과는 `/tmp/campo-a-final-ui/report.json`, 25개 탭별 PNG는 같은 폴더에 있습니다. 재현 방법·대체 범위는 `apps/app/test/uiHarness/README.md`를 보세요.

이번에 기존 테스트는 새 `useWindowDimensions` 호출을 지원하도록 Node 렌더링 mock 1곳만 보완했습니다. 코어/팀원 테스트를 변경하거나 단언을 약하게 만들지 않았습니다. 기존 계획보다 학교행사 세부 요구와 읽기 어댑터 준비를 추가했으며 서버 요청은 모의 응답으로만 검사했습니다.

## 이번 점검의 수정 파일

```text
apps/app/App.tsx
apps/app/src/features/IMPLEMENTATION.md
apps/app/src/features/content/mock.ts
apps/app/src/features/content/remote.ts
apps/app/src/features/content/selectors.ts
apps/app/src/features/essay/EssayScreen.tsx
apps/app/src/features/events/EventsScreen.tsx
apps/app/src/features/festival/FestivalScreen.tsx
apps/app/src/features/map/CampusMap.tsx
apps/app/src/features/map/MapScreen.tsx
apps/app/src/features/me/MeScreen.tsx
apps/app/src/features/review/FINAL_REVIEW.md
apps/app/src/features/review/SCREEN_FLOW.md
apps/app/src/state/AppState.tsx
apps/app/src/ui/TabBar.tsx
apps/app/src/ui/external.ts
apps/app/src/ui/kit.tsx
apps/app/src/ui/layout.ts
apps/app/src/ui/useScreenBack.ts
apps/app/test/appEventPeriods.test.ts
apps/app/test/appFinalReview.test.ts
apps/app/test/appRemoteRead.test.ts
apps/app/test/appScreens.test.ts
apps/app/test/uiHarness/README.md
apps/app/test/uiHarness/check.mjs
apps/app/test/uiHarness/constants.ts
apps/app/test/uiHarness/index.html
apps/app/test/uiHarness/location.ts
apps/app/test/uiHarness/main.tsx
apps/app/test/uiHarness/map.tsx
apps/app/test/uiHarness/native.tsx
apps/app/test/uiHarness/photos.tsx
apps/app/test/uiHarness/safeArea.tsx
apps/app/test/uiHarness/sensors.ts
apps/app/test/uiHarness/statusBar.tsx
apps/app/test/uiHarness/styles.css
apps/app/test/uiHarness/vite.config.ts
```
