# 축제 탭 확장 데이터 (선택 항목)

축제 탭은 기존 Supabase 표(`festivals`, `festival_days`, `festival_stalls`, `festival_performances`)만으로 동작합니다.
아래 열은 **모두 선택(nullable)** 이며, 서버에 없으면 해당 화면 구역이 "아직 공지되지 않았습니다"로 표시될 뿐 오류가 나지 않습니다.
앱은 `select=*`로 읽으므로 열을 더하면 코드 변경 없이 반영됩니다. 이 PR은 `supabase/`를 고치지 않았습니다(데이터·서버 담당 확인 후 추가).

| 표 | 열 | 형식 | 화면 |
|---|---|---|---|
| `festivals` | `guide` | jsonb (`FestivalGuide`, camelCase 키) | 공지 배너, 관람 구역·게이트, 대기/입장/퇴장/비상 동선, 팔찌, 굿즈, 스폰서, 반입 금지 물품, 안전·분실물 |
| `festival_days` | `label` | text | 일차 이름(`DAY 1`) |
| `festival_stalls` | `kind`, `area_label`, `map_number`, `condition`, `perks` | text, text, int, text, text[] | 세부 종류·구역 필터·배치도 번호·참여 조건·경품 |
| `festival_performances` | `group` | text | 라인업 묶음(동아리·기획단·응원제·아티스트) |

- `guide`의 잘못된 부분은 `guide.ts`의 `festivalGuide()`가 버립니다(전체 탭은 계속 표시).
- 동선·게이트에 `nodeId`/`fromNodeId`가 있으면 지도 경로로, 없으면 `placeLabel`/`nearBy` 건물 이름 검색으로 이어집니다. 좌표를 지어내지 않습니다.
- 예시 데이터(`content/mock.ts`)는 2026 애국한양응원제 '오름' 공식 안내 이미지에 있는 내용만 옮겼습니다.
