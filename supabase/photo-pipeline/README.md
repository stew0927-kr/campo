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
- HEIC 여부는 **파일 이름이 아니라 앞부분 바이트**(`ftyp` 상자의 브랜드)로 판단한다. 바이트로 알 수 있으면 그것을 믿고, 알 수 없을 때(빈 파일 등)만 확장자 `.heic`/`.heif`를 본다.
  그래서 이름만 `.jpg`인 HEIC도 변환되고, 이름만 `.heic`인 실제 JPG는 그대로 처리된다.
- HEIC는 **모든 OS에서** JPG로 바꿔 처리한다. Mac은 내장 `sips`를 먼저 쓰고, 안 되거나 Mac이 아니면 순수 JS `heic-convert`를 쓴다. 둘 다 안 되면 그 사진은 실패로 센다.

## 자주 나는 오류

| 메시지 | 해결 |
|---|---|
| `.env 파일에 ... 값이 없습니다` | 저장소 맨 위 `.env`에 두 값을 적었는지, 파일 이름이 정확히 `.env`인지 |
| `공개 키(sb_publishable_...)가 들어 있습니다` | Secret key(`sb_secret_...`)로 바꾸기 |
| `아직 조사 기록이 없습니다` | 편집기 '현장 기록 불러오기'로 zip을 먼저 넣거나, 시험이면 `--surveys-dir=sample` |
| `Bucket not found` | Supabase에 `0002_campus_photos.sql`이 실행됐는지 |
| `<파일 경로>: HEIC 사진을 JPG로 변환하지 못했습니다 (…)` | 괄호 안이 원인. 파일이 깨졌거나(잘린 다운로드 등) 지원하지 않는 HEIC 변형일 수 있다. 원본을 휴대폰에서 JPG로 다시 내보내 넣는다. 한 번 실행에서 첫 실패만 이 메시지를 보여 주고 나머지는 `실패 N장`에만 센다 |

`npm test`(단위 테스트), `npm run typecheck`(타입 검사).
