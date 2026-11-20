# 공개 콘텐츠 연결

기존 Expo 환경변수 `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_ANON_KEY`를 사용합니다. 현대 publishable 키도
후자의 변수에 넣습니다. 실제 값은 Git에서 제외된 `apps/app/.env.local`에만
설정하며, 변경 후 Expo 개발 서버를 다시 시작합니다. 이 변수는 앱에 포함되는
공개 정보이므로 관리자·service_role·secret 키를 절대 넣지 않습니다.

`configured.ts` → `connection.ts` → `useAppContent.ts`가 기존 화면에 데이터를
전달합니다. `remote.ts`는 GET만 사용하고 공개 콘텐츠만 조회합니다.
`festival_days`는 공개 부모 축제와 서버 RLS로 제한합니다. `campus_photos`는
공개 여부 열이 없으므로 SQL 0002의 공개 SELECT RLS를 따르고
`campus_id=hanyang-seoul`로 제한합니다. 사진은 기존 PhotoCatalog 계약을
사용하며 실제 경로 노드에 연결된 것만 기존 사진 화면에 표시됩니다.

성공했으나 비어 있는 응답은 서버 빈 화면으로 유지합니다. 연결 실패·잘못된
계약은 명시적으로 시연용 데이터로 전환합니다. 사진 실패는 콘텐츠와 분리해
표시합니다. 서버 출처라는 사실만으로 실제 행사라고 단정하지 않으며 제공된
제목·설명·고지를 그대로 표시합니다. 지도 노드가 없으면 기존 장소 검색으로
연결하고 가상 노드를 생성하지 않습니다.

## 이번 확인의 범위

- 팀 main의 `a41b2a4`는 PR #20 병합 커밋이며, 확인 시점 팀 main과 기존
  로컬 `e67a76c` 양쪽의 조상입니다. SQL 0001·0002·0003과 최신 연동
  방침은 이미 로컬에 포함되어 있어 추가 병합하지 않았습니다.
- 실제 HTTPS 공개 조회는 실행 환경 프록시가 CONNECT 403으로 차단했습니다.
  키 인증·실제 행·실제 RLS 동작의 성공 여부는 확인하지 못했습니다.
- 자동 테스트의 서버 응답은 별도 합성 데이터입니다. 실제 DB 접속 성공의
  근거로 사용하지 않습니다. 화면 테스트는 웹 DOM 대체 환경이며 Android
  기기에서의 네트워크·이미지·지도 동작 검증을 대신하지 않습니다.
- DB·RLS·공용 설정·패키지·다른 담당 코드 변경 및 서버 쓰기는 없습니다.

검증 명령: 루트 `npm run typecheck`, `npm test`, 별도 지도 테스트
`./node_modules/.bin/vitest run --config apps/app/src/features/map/vitest.config.mts`,
화면 테스트 `node apps/app/test/uiHarness/check.mjs`.
