# app-store-compliance 스킬 — 어디서 왔고 무엇을 바꿨나

## 출처

- 업스트림: <https://github.com/mjmirza/app-store-compliance> (공개 저장소, *App Store Compliance Playbook*)
- 가져온 커밋: `ad76746e6304a7f623ecd50dbf9da91117a7d6f7` — "fix(scripts): match metadata rule terms as whole words, not fragments (#2371)" (2026-11-23) · 배포판 `VERSION` **2.5.1**
- 업스트림 원본 위치: `agent-os/skill/SKILL.md` — 이 저장소에는 Claude Code가 자동으로 찾는 `.claude/skills/app-store-compliance/SKILL.md`를 진입점으로 두었다.
- 라이선스: **OpenRoots Agent License 2.3** (`LicenseRef-OpenRoots-ORA-2.3`). 전문은 `LICENSE`, 저작권 고지는 `NOTICE`.

## 바꾼 것 (SKILL.md 두 곳뿐)

1. frontmatter에 `attribution` 한 줄 추가 — 저작권자·원 저장소·버전·커밋·라이선스 식별자.
   ORA 2.3 §8.1은 "패키지 매니페스트 안에" 저작권 고지·라이선스 참조·원저자 식별을 기록하라고 한다.
   Claude Code 스킬에서 매니페스트는 `SKILL.md` frontmatter이므로 거기에 넣었다.
2. 끝에 `## In this repository (CAMPO)` 절 추가 — 이 저장소에서 guard를 부르는 명령, `android/` 폴더가 없어 native 검사가 NOT CHECKED로 남는다는 안내.

그 밖의 파일은 업스트림 그대로다. `data/`, `docs/`, `references/`, `scripts/`, `templates/`, `agent-os/`의 내용은 한 바이트도 고치지 않았다.
이 문서(`SOURCE.md`)와 `CAMPO-GOOGLE-PLAY.md`는 이 저장소에서 새로 쓴 파일이며, 업스트림 원저자가 검증한 것이 아니다.

## 뺀 것 (그리고 이유)

| 뺀 경로 | 크기 | 이유 |
|---|---|---|
| `assets/` | 616KB | 업스트림 README용 스크린샷 PNG. 감사에 쓰이지 않는다 |
| `CHANGELOG.md` | 93KB | 버전 이력. `SKILL.md`도 스크립트도 참조하지 않는다 |
| `.github/` | — | 업스트림 저장소의 CI 설정 |
| `agent-os/skill/SKILL.md` | — | 루트 `SKILL.md`와 같은 파일이다. 중첩된 `SKILL.md`를 하네스가 스킬로 잘못 잡지 않도록 중복본을 뺐다 |
| `.git` | — | 저장소 메타데이터 |

이 저장소에 들어온 양: 파일 120개, 약 2.9MB.

## 라이선스 요약과 이 저장소에서 지킬 것

- **무료 범위**: 개인·비영리·학교·정부 기관은 규모와 무관하게 무료, 연 매출 2,000만 달러 이하 법인도 무료(§2 Root). 초과하면 초과분의 0.5%, 연 25만 달러 상한(§5 Canopy). 이 저장소는 학교 과제·시제품이라 Root에 해당하며 로열티가 없다.
- **허용**: 사용·실행·복제·수정·병합·배포·재라이선스(§2.1). 앱 개발 도구로 넣어 쓰는 것은 §4.2가 명시적으로 허용한다.
- **금지**: 이 스킬 자체를 상품으로 재판매·재포장·재라이선스하는 것(§4 Competing Offering). 이 저장소는 스킬을 상품으로 파는 곳이 아니므로 해당하지 않는다.
- **AI 학습**: 학습·파인튜닝 등 AI Training Use는 별도 Compute 라이선스가 필요하다(§6). 감사할 때 파일을 읽고 스크립트를 실행하는 것은 §2의 통상 사용이라 해당하지 않는다. 이 폴더의 내용을 모델 학습 데이터로 넘기지 않는다.
- **갱신**: 앞으로 받을 버전의 라이선스가 달라질 수 있다. 업데이트할 때 `LICENSE`·`NOTICE`·`VERSION`을 함께 확인한다.

## 업데이트하는 법

```bash
rm -rf /tmp/asc && git clone --depth 1 https://github.com/mjmirza/app-store-compliance /tmp/asc
cd /tmp/asc && git log -1 --format=%H
# 1) 이 폴더에서 SKILL.md·SOURCE.md·CAMPO-GOOGLE-PLAY.md만 백업
# 2) tar 로 아래를 제외하고 덮어쓴다: .git assets .github CHANGELOG.md agent-os/skill
# 3) agent-os/skill/SKILL.md -> SKILL.md 로 복사한 뒤 위의 두 곳(attribution, CAMPO 절)을 다시 적용
```

## 확인한 것 (2026-11-24, 이 저장소)

| 확인 | 명령 | 결과 |
|---|---|---|
| guard가 이 위치에서 데이터를 찾는가 | `bash .claude/skills/app-store-compliance/agent-os/hooks/app-store-compliance-guard.sh apps/app` | exit 1, `Rule pack. v2.5.1. Its 112 dated sources were verified between 2026-07-13 and 2026-11-22` 출력 — `data/`·`VERSION` 경로 해석 정상 |
| 마감일 데이터 | `python3 scripts/deadline-checker.py --brief --platforms android` | 동작(2026-12-01 일본 결제 승인 등 출력) |
| 목록 감사기 | `python3 scripts/metadata-audit.py <fastlane metadata 폴더> --platform google` | 동작 |
| frontmatter | YAML 파싱 | `name`, `description`, `license`, `attribution` 정상 |

`apps/app`에는 `android/` 폴더가 없어 guard의 native 검사는 NOT CHECKED로 남는다. `npx expo prebuild --platform android` 뒤에 다시 돌린다.
