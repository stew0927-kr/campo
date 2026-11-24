# 캠포 `apps/app` Google Play 감사 실행 안내

이 문서는 이 저장소에 들어온 `app-store-compliance` 스킬을 **캠포 앱(`apps/app`)** 에 쓰는 방법만 적는다.
스킬 자체의 사용법은 `SKILL.md`, 출처·라이선스는 `SOURCE.md`, 정책 원문은 `docs/`(특히 `docs/GOOGLE-PLAY.md`,
`docs/PLATFORM-MECHANICS-2026.md`, `docs/PRE-SUBMISSION-CHECKLIST.md`)를 본다.

- 대상: `apps/app` — Expo SDK 58(React Native 0.88), `targetSdkVersion 36`(SDK 58 기본값, `compileSdk 37`)
- 이 저장소에는 iOS 배포 계획이 없다. Apple(`docs/APPLE.md`)·EU/US 법률 문서는 필요할 때만 읽는다.

## 1. 코드·설정 스캔 (guard)

저장소 루트에서 실행한다.

```bash
# 최종 사용자 앱
bash .claude/skills/app-store-compliance/agent-os/hooks/app-store-compliance-guard.sh apps/app

# 저장소 전체(앱 2개: apps/app, apps/mobile)
bash .claude/skills/app-store-compliance/agent-os/hooks/app-store-compliance-guard.sh .
```

읽는 법.

- `Rule pack.` 줄은 규칙 스냅샷의 버전과 검증 날짜다. 보고할 때 이 줄을 그대로 인용한다.
- `Coverage.`/`NOT CHECKED` 줄은 **무엇을 못 봤는지**다. `apps/app`에는 `android/`가 없어서
  native 검사(매니페스트·권한·ABI·FGS)는 돌지 않는다. 그 상태로 "이상 없음"이라고 말하지 않는다.
- exit 2 = critical 있음, exit 1 = 스캔 불완전, exit 0 = 통과.

native 검사까지 돌리려면(빌드 도구가 있는 환경에서) 한 번 prebuild 한 뒤 그 폴더를 스캔한다.

```bash
cd apps/app && npx expo prebuild --platform android && cd ../..
bash .claude/skills/app-store-compliance/agent-os/hooks/app-store-compliance-guard.sh apps/app
```

`apps/app/.gitignore`가 `/android`를 무시하므로 prebuild 결과는 커밋되지 않는다.

## 2. 규제 마감일

```bash
python3 .claude/skills/app-store-compliance/scripts/deadline-checker.py --brief --platforms android
```

## 3. 스토어 목록 문구 감사 (목록을 만든 뒤)

저장소에는 아직 fastlane 메타데이터가 없다. Play Console에 쓴 문구를 fastlane 형식으로 두면 감사할 수 있다.

```bash
mkdir -p fastlane/metadata/android/ko-KR
# name.txt, short_description.txt, full_description.txt, privacy_policy_url.txt, contact_email.txt
python3 .claude/skills/app-store-compliance/scripts/metadata-audit.py fastlane/metadata --platform google
```

## 4. 스캔이 증명하지 못하는 것 — 손으로 확인

`.app-review-readiness.json`(템플릿: `templates/app-review-readiness.json`)을 `apps/app/`에 두고 항목별로 적는다.
guard가 이 파일을 읽고 `fail`이 있으면 막는다.

| 항목 | 캠포 기준 |
|---|---|
| demo account | 해당 없음 — 로그인·계정이 없다. `n/a`와 이유를 적는다 |
| live backend | Supabase 공개 읽기(있으면) + 지도 타일 서버가 심사 기간 내내 살아 있어야 한다 |
| review notes | 로그인 없음, 위치 거절해도 수동 길찾기 가능, 시연용 데이터 표시 — 이 세 줄을 적는다 |
| screenshots | 스플래시·로그인이 아니라 실제 지도·길찾기 화면 |
| account deletion | 해당 없음 — 계정을 만들지 않는다(`MeScreen` "로그인 없이") |
| privacy labels / Data Safety | 아래 5절 |
| IAP | 해당 없음 — 결제·광고 없음 |

## 5. Play Console에서 앱 콘텐츠로 선언할 것

| 선언 | 캠포 |
|---|---|
| 개인정보 처리방침 | `https://stew0927-kr.github.io/campo-legal/privacy.html` (앱 안 `내정보 → CAMPO 앱 정보`에도 링크) |
| 앱 액세스 | 모든 기능이 제한 없이 열림(로그인 없음) |
| 광고 | 없음 |
| 콘텐츠 등급 | IARC 설문 필수 — 등급 없는 앱은 게시 불가 |
| 타깃 연령 | 대학생 대상. 아동(Families) 대상으로 신고하면 Families 정책이 통째로 붙는다 |
| Data safety | 위치·기압은 기기 안에서만 처리 → 수집 아님. 지도 타일 요청이 보는 지역을 제3자에게 알리는 점은 방침 4항에 적혀 있다. 바꿀 때 방침과 함께 고친다 |
| 포그라운드 서비스 유형 | `expo-location`이 매니페스트에 `location`·`health` 타입 서비스를 넣는다. 앱은 백그라운드 위치를 쓰지 않지만 선언 화면이 요구하는지 확인한다 |
| 사진·동영상 권한 | 해당 없음(사진 선택기를 쓰지 않는다) |
| 뉴스 앱 | 해당 없음 |
| 개발자 확인(Android developer verification) | `kr.hanyang.campo` 패키지 이름 등록 |

## 6. 저장소에서 이미 눈에 띄는 것 (2026-11-24 기준)

- `apps/app/src/map/style.ts`가 `tile.openstreetmap.de`를 직접 부른다. FOSSGIS 이용약관은 **앱이 직접 타일을 받아 쓰는 것을 사전 동의 없이 금지**한다. 열려 있는 PR #32가 OpenFreeMap으로 바꾼다.
- `app.json`에 `icon`·`splash`·`android.adaptiveIcon`이 없어 기본 Expo 아이콘으로 빌드된다. Play 목록에는 512×512 아이콘도 따로 필요하다.
- `expo-sensors`가 `ACTIVITY_RECOGNITION` 권한을 매니페스트에 넣는다. 이 앱은 기압계만 쓰므로 `android.blockedPermissions`로 막는 것이 맞다.
- Expo prebuild 템플릿이 `SYSTEM_ALERT_WINDOW`와 저장소 권한(`maxSdkVersion 32`)을 넣는다. 쓰지 않으면 `android.blockedPermissions`로 막는다.
- `apps/app/src/features/me/AppInfoScreen.tsx`가 `expo-constants`를 import하지만 `package.json`에는 없다(Expo의 간접 의존성으로 해석됨). 직접 선언하는 편이 안전하다.
