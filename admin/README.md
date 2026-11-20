# 캠포 관리자 웹 (`admin/`)

관리자가 로그인해서 논술·축제(날짜·부스·공연)·학교행사를 추가·수정·삭제하고, **"앱에 공개"**를 켜고 끄는 웹 화면.
Supabase 대시보드에 들어가지 않고 내용을 관리하기 위한 것이다. 담당: D.

- Vite + React + TypeScript, `@supabase/supabase-js`. 서버 코드 없음.
- 브라우저에는 **공개 키(publishable)만** 넣는다. 누가 무엇을 쓸 수 있는지는 DB의 RLS(`supabase/migrations/0001_content.sql`)가 정한다:
  `profiles.role = 'admin'`인 계정만 쓰기 가능, 앱은 `is_published = true`인 행만 읽음.
- 루트 워크스페이스(`apps/*`, `packages/*`) 밖의 독립 패키지라, 루트 `npm install`·`npm test`·`npm run typecheck`와 앱(Expo)의 의존성에 영향을 주지 않는다.

## 처음 한 번

```
cd admin
cp .env.example .env.local      # 그리고 .env.local에 URL과 공개 키를 적는다(커밋되지 않음)
npm install
```

## 실행

```
npm run dev        # http://localhost:5174 이 자동으로 열림. 끄려면 터미널에서 control + C
```

관리자 계정(Supabase Authentication에서 만든 계정, `profiles.role = 'admin'`)으로 로그인한다.
관리자가 아닌 계정은 "관리자 권한이 없습니다"만 보인다.

## 화면

| 탭 | 표 | 비고 |
|---|---|---|
| 논술 | `essay_sessions`, `essay_tracks` | 계열은 드롭다운에서 고르거나 "직접 입력"(저장하면 계열 목록에 자동 추가). 아래 "논술 계열 목록"에서 선택지를 추가·이름 변경·삭제(이름을 바꾸면 그 계열을 쓰던 일정도 함께 바뀜, 쓰는 중인 계열은 삭제 불가). 준비물·유의사항은 한 줄에 하나 |
| 축제 | `festivals` → `festival_days` → `festival_stalls`, `festival_performances` | "선택"으로 아래 단계 열기. 부스·공연은 축제가 공개 중일 때만 앱에 보임 |
| 학교행사 | `school_events` | 시각은 한국 시간으로 입력(저장 시 +09:00) |

**숨김 / 공개 중**은 두 버튼이 항상 함께 보이고, 지금 상태가 초록색, 다른 쪽이 회색이다. 회색 쪽을 누르면 바로 바뀐다(목록과 입력 창 모두).
위쪽 탭을 누르면(지금 보고 있는 탭이어도) 그 탭의 처음 화면으로 돌아간다. 입력 중인 창이 있으면 먼저 묻는다.
지점 id 칸은 지도 데이터가 들어오기 전까지 비워 둔다.

계열 목록 표(`essay_tracks`)는 `supabase/migrations/0005_essay_tracks.sql`로 만든다.

## 그 밖의 명령

`npm test`(값 변환 테스트), `npm run typecheck`, `npm run build`(배포용 `dist/` 생성).

## 지금 범위에 없는 것

배포(다른 사람이 주소로 접속), 지점 id 검색 선택, 사진 관리. 지금은 이 노트북에서만 열린다.
