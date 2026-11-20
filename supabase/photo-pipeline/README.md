# 사진 파이프라인 (`supabase/photo-pipeline`)

현장 조사 사진(`data/surveys/{id}/photos/`)을 WebP 두 벌로 줄여 Supabase Storage `campus-photos`에 올리고,
그 주소를 `campus_photos` 표에 넣는다. 표 칸은 `apps/app/src/contracts.ts`의 `PhotoRow`와 같다. 담당: D.

| 파일 | 크기 | 쓰는 곳 |
|---|---|---|
| `full/{id}.webp` | 긴 변 1280px, 품질 80 | 사진 크게 보기·길안내 |
| `thumbs/{id}.webp` | 긴 변 128px, 품질 75 | 지도 핀·목록 |

EXIF 회전을 반영하고, 위치(GPS)·기기 정보는 지운다. 원본보다 크게 늘리지 않는다.

## 처음 한 번

1. 저장소 맨 위(`campo/`)에 `.env` 파일을 만든다(이미 `.gitignore`에 있음, 커밋 금지).
   ```
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
   ```
2. `cd supabase/photo-pipeline && npm install`

## 실행

```
npm run upload:photos -- --dry-run      # 변환만 해 보고 용량을 알려 줌(서버에 아무것도 안 함)
npm run upload:photos -- --limit=3      # 앞의 3장만 실제로 올림
npm run upload:photos                   # 전부. 다시 돌려도 이미 올린 사진은 건너뜀
```

옵션: `--dry-run`, `--limit=N`(또는 `--limit N`), `--survey=<폴더 이름>`, `--surveys-dir=<경로>`, `--verbose`

## 조사 데이터 없이 시험하기

```
npm run make-sample                     # 시험용 그림 3장으로 sample/ 만들기
npm run make-sample -- ~/Desktop/사진    # 또는 내 사진 폴더에서 3장
npm run upload:photos -- --surveys-dir=sample
npm run clean-sample                    # 시험이 끝나면 샘플 사진·표 줄 삭제
```

`sample/`은 `.gitignore`에 있어 커밋되지 않는다. 샘플의 지점 id는 `sample-node-1~3`이다.

## 규칙(바꾸면 중복이 생긴다)

- id = 지점 id + `-` + 파일 이름(확장자 제외), 소문자, `[a-z0-9_-]`, 80자 이하. 한글·공백이 있거나 잘리면 끝에 8자리 해시를 붙인다.
- 같은 id·같은 내용(sha256)이면 건너뛴다. 같은 내용이 다른 지점에 있으면 건너뛰고 경고만 한다.
- HEIC는 Mac이면 `sips`로 JPG로 바꿔 처리하고, 다른 OS에서는 실패로 센다.

## 자주 나는 오류

| 메시지 | 해결 |
|---|---|
| `.env 파일에 ... 값이 없습니다` | 저장소 맨 위 `.env`에 두 값을 적었는지, 파일 이름이 정확히 `.env`인지 |
| `공개 키(sb_publishable_...)가 들어 있습니다` | Secret key(`sb_secret_...`)로 바꾸기 |
| `아직 조사 기록이 없습니다` | 편집기 '현장 기록 불러오기'로 zip을 먼저 넣거나, 시험이면 `--surveys-dir=sample` |
| `Bucket not found` | Supabase에 `0002_campus_photos.sql`이 실행됐는지 |

`npm test`(단위 테스트), `npm run typecheck`(타입 검사).
