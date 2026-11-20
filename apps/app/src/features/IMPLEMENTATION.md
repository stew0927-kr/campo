# A조원 구현·인계 기록

이번 작업은 `feat/app-map`의 로컬 커밋만 사용합니다. Push·PR·병합·APK 빌드·배포는 실행하지 않습니다. 별도 지시가 없다면 기존 체크아웃에서 계속 작업합니다.

## 구현 범위

- 공통: 지도 첫 화면, 다섯 탭, 공통 디자인·큰 터치 영역·스크롤, 로딩·빈 목록·오류 재시도·화면 오류 경계.
- 지도: 다섯 이동 방식, 장소/건물/호실 검색, 노드/좌표 선택, 경로선·시간·거리·층 이동·경사·대체 안내, 건물·층 보기, 장소 즐겨찾기, 선택적 GPS 추적·실외 재탐색, 데이터 없음 안내.
- 논술: 2027학년도 2026년 11월 28~29일을 소재로 한 시연용 정보. 공식 일정·고사장·준비물과 다를 수 있다는 고지를 항상 표시합니다. 날짜/검색/상세/준비물/입실 역산 체크리스트/즐겨찾기/지도 전달을 제공합니다. 실제 경로 시간이 없으면 출발 시각을 만들지 않습니다.
- 축제: 날짜별 공연·무대/부스/카테고리/검색/상세/운영 시간·대기 안내/즐겨찾기/입장·대기·퇴장 전달. 실제 노드가 없으면 위치 연결 대기이며, 임의 핀·선·혼잡도는 만들지 않습니다.
- 학교행사: 입학/설명회/강연/행사/공지, 검색·정렬·상세·즐겨찾기·지도 전달. 표시 시각은 Asia/Seoul입니다.
- 내정보: 일반/계단 회피/휠체어 기본 설정, 모든 탭이 공유하는 즐겨찾기, 앱 버전·위치 권한·설정 링크·출처·주요 오픈소스 링크/라이선스 전문. 로그인과 계정 데이터는 없습니다.

## 데이터 약속과 문서 차이

사용자 요청에 따라 콘텐츠는 시연용으로 구현했습니다. 저장소 문서의 Supabase 운영 연결 요구는 다음 단계로 남기며 D의 서버는 변경하지 않았습니다. `content/types.ts`는 `supabase/migrations/0001_content.sql`의 필드와 범주를 따릅니다. `rows.ts`가 snake_case 응답을 camelCase 화면 DTO로 변환하며 `ContentSource`를 교체하면 같은 화면을 사용할 수 있습니다. `published.ts`는 공개 콘텐츠와 공개 축제의 자식만 남깁니다. 이 클라이언트 필터는 D의 RLS를 대신하지 않습니다.

A 가이드의 `venue_label`은 현재 SQL에 없으므로 새 DB 열을 가정하거나 추가하지 않고 한양대 캠퍼스 이름을 화면에서 표시합니다. 축제 네 표는 festivals / festival_days / festival_stalls / festival_performances이며 category는 주점·부스·공연·편의만 사용합니다. 실제 지점 ID가 없으면 null입니다.

## 대기 중인 항목

- C: 실제 선정 건물/층/노드/엣지·무단차 확인·경사·고사장/부스/행사의 지점 ID·입장/퇴장 ID. 실제 실내 길찾기 정확성은 현장 확인 전입니다.
- C/D: 사진·방위 메타데이터와 `PhotoCatalog` 공급. 연결 코드와 기존 뷰어는 준비했지만 실제 사진은 없습니다.
- D: 공개 콘텐츠 응답/접속 설정·RLS 확인, 개인정보 처리방침 URL·팀 공용 문의처. 채팅에 비밀키를 적지 않습니다.
- 사용자/팀: Android 실기기 지도·터치·키보드·권한·30분 야외 추적·층 전환·사진 확인. 웹 런타임 패키지가 없어 웹 실행은 미검증입니다.
- B: 네이티브·간접 의존성을 포함한 전체 오픈소스 배포 고지, 서명·APK/AAB·스토어·실기기 빌드. 이번에는 JavaScript 번들 생성 검사만 합니다.
- 영속 저장: 앱에 기존 사용자 저장 계층이 없고 새 패키지를 추가하지 않아 메모리만 사용합니다. 앱 종료 후 설정·즐겨찾기는 초기화됩니다.
- 아이콘·스플래시·권한 설명·EAS/앱 설정 변경은 이번 수정 허용 범위 밖이므로 하지 않았습니다. 완전한 실내 자동 재탐색·실제 대기열 모델·타 대학·로그인도 구현하지 않았습니다.

## 테스트

`npm run typecheck` → `npm test` → 별도 지도 연결 테스트를 실행합니다. 신규 테스트는 화면 렌더링(네이티브 모듈 대체), 탭 전달→실제 fixture 경로 계산, 오래된/없는 ID 검색 대체, 공유 즐겨찾기·보행 설정, SQL 행 변환·공개 부모 필터, 한국 시간 입실 역산, 실내 휠체어/엘리베이터 경로·층 필터, 센서 단위와 기압 부호를 검사합니다. 실기기 통과를 의미하지 않습니다.

나중에 업로드할 때는 `git status`와 현재 브랜치를 확인하고 원격 feat/app-map을 명시적으로 fetch해 비교한 뒤, 로컬 커밋을 `git push origin HEAD:refs/heads/feat/app-map`으로 올립니다. 강제 Push는 하지 않으며 원격이 앞서 있으면 먼저 차이를 검토합니다.

## 변경 파일 목록

```text
apps/app/App.tsx
apps/app/src/features/IMPLEMENTATION.md
apps/app/src/features/content/ContentGate.tsx
apps/app/src/features/content/DestinationActions.tsx
apps/app/src/features/content/destinations.ts
apps/app/src/features/content/mock.ts
apps/app/src/features/content/published.ts
apps/app/src/features/content/repository.ts
apps/app/src/features/content/rows.ts
apps/app/src/features/content/types.ts
apps/app/src/features/essay/EssayScreen.tsx
apps/app/src/features/essay/time.ts
apps/app/src/features/events/EventsScreen.tsx
apps/app/src/features/festival/BoothMap.tsx
apps/app/src/features/festival/FestivalScreen.tsx
apps/app/src/features/festival/flow.ts
apps/app/src/features/map/CampusMap.tsx
apps/app/src/features/map/MapCanvas.tsx
apps/app/src/features/map/MapCanvas.web.tsx
apps/app/src/features/map/MapScreen.tsx
apps/app/src/features/map/README.md
apps/app/src/features/map/demoCampus.ts
apps/app/src/features/map/indoor.ts
apps/app/src/features/map/indoorFixture.json
apps/app/src/features/map/mapTypes.ts
apps/app/src/features/map/model.test.ts
apps/app/src/features/map/model.ts
apps/app/src/features/map/sensorFix.ts
apps/app/src/features/map/useSensorFixes.ts
apps/app/src/features/map/vitest.config.mts
apps/app/src/features/me/AppInfoScreen.tsx
apps/app/src/features/me/MeScreen.tsx
apps/app/src/features/me/licenses.json
apps/app/src/state/AppState.tsx
apps/app/src/state/model.ts
apps/app/src/ui/ScreenBoundary.tsx
apps/app/src/ui/TabBar.tsx
apps/app/src/ui/kit.tsx
apps/app/src/ui/theme.ts
apps/app/test/appContent.test.ts
apps/app/test/appMapScreen.test.ts
apps/app/test/appNavigation.test.ts
apps/app/test/appScreens.test.ts
apps/app/test/appSensor.test.ts
```
