# 기획 기준과 브라우저를 대조하는 검증

화면 더미의 흐름 JSON과 별도로 기획의 기대 동작을 `*.plan.json`에 기록한다. 기획 근거에서 확인한 조건, 전환, 저장값과 표시 결과를 작성한다. 구현에 맞춰 기대 동작을 자동 생성하면 구현과 기획의 차이를 찾기 어렵다. 정책이 정해지지 않은 내용은 검토 질문으로 남긴다.

## 실행

워크스페이스 루트에서 실행한다. 독립 검증은 Node.js 20 이상과 Chromium을 사용한다. 설치는 처음 한 번 필요하다.

```bash
npm ci --prefix .claude/skills/wireflow-review/verification
npm exec --prefix .claude/skills/wireflow-review/verification -- playwright install chromium

node .claude/skills/wireflow-review/scripts/wireflow.cjs verify \
  PROJECT.flow.json PROJECT.plan.json --output PROJECT.html
```

- `--viewport 360x780`으로 다른 브라우저 창 크기에서 실행한다. 기본 검증 창은 1440×1000이다.
- `--report PATH.json`은 결과 JSON을 저장한다. 표준 출력에도 같은 결과가 나온다.
- `--trace-dir DIR`을 지정하면 실패가 발생한 브라우저 조작 기록을 ZIP으로 저장한다. Playwright Trace Viewer에서 로컬로 열 수 있다.
- 종료 코드 0은 통과, 1은 검증에서 발견한 문제, 2는 잘못된 입력이나 실행 환경 오류다. 문제가 발견되어도 결과 JSON과 HTML을 만든다.
- `--output`으로 만든 HTML의 **흐름 검증 → 검증 범위와 전체 경로**에서 마지막 XState·Playwright 결과, 시각과 검증 창 크기를 확인한다. 문제 항목을 누르면 캔버스와 재현 순서가 함께 열린다. **빠른 검사 다시 실행**은 열려 있는 더미에서 즉시 실행할 수 있는 검사이며, XState·Playwright 결과를 갱신하려면 에이전트가 `verify`를 다시 실행한다.

## 기획 입력과 검증 범위

`title`, 시작 화면 ID `start`, 초기 상태 `initial`, 화면 ID로 색인한 `screens`가 필요하다. 각 화면은 `actions`를 갖고, 완료가 예상되는 화면은 `end: true`로 표시한다. 조작의 `id`는 렌더러의 `data-action` ID, `to`는 기대 목적지, `when`은 조작이 보일 조건, `set`은 실행 후 바뀔 기대 값이다. 같은 화면 내 날짜 선택도 상태 전환으로 표현할 수 있다. 조작과 화면 검사에 `requirement`를 추가하면 발견한 문제를 동일한 기획 항목에 표시한다. 조작이 숨겨져야 할 때의 기대는 `hiddenRequirement`에 연결한다. 화면 `assertions`는 `selector`로 실제 화면의 텍스트가 공백 정리 후 `text`와 같은지 또는 `attribute` 값이 `value`와 같은지 확인한다. `when`으로 상태를 한정하고 `{{변수}}`를 값에 포함할 수 있다.

XState는 기획에 정의한 유한 상태를 탐색하고 해당 상태에서 실행 가능한 각 조작을 검사할 경로를 만든다. 한 상태에 이르는 최단 경로에 검증할 조작을 붙여, 복귀와 같은 화면 안의 상태 변경도 검사한다. 완료·복귀 경로가 없는 상태와 어느 도달 상태에서도 열리지 않는 조작을 확인한다. 기획 검증은 최대 256개 상태와 4,096개 전환을 처리하며, 초과하면 입력 범위 오류를 반환한다.

Playwright는 검사마다 새 Chromium 컨텍스트에서 단일 HTML을 열어 사용자 조작을 클릭하고 기대한 화면·표시값을 확인한다. 팝업의 닫기 아이콘과 하단 닫기 버튼처럼 하나의 조작 ID에 연결된 버튼이 여러 개면 각각을 확인한다. 이 명세의 상태·화면·브라우저 창을 검증한다. 화면에 없는 기획 조건과 조작에 모델링되지 않은 자유 입력 조합은 별도로 정의할 수 있다.

## 개발 작업 폴더의 회귀 시험

```bash
npm run test:model --prefix .claude/skills/wireflow-review/verification
npm run test:browser --prefix .claude/skills/wireflow-review/verification
npm run test:integration --prefix .claude/skills/wireflow-review/verification
```

모델 시험은 조건·막다른 상태·반복 경로를 검사한다. 브라우저 시험은 유효한 조작과 가려진 조작, 잘못된 화면 전환과 표시 상태를 검사한다. 통합 시험은 같은 기획 기준으로 정상 HTML과 오류를 주입한 복사본을 검증하고, 실패 경로와 캔버스 강조가 연결되는지 확인한다.

독립 검증은 활성 화면과 모의 입력 영역에서 보이는 조작을 기획 목록과 양방향으로 대조한다. 팝업 뒤의 비활성 화면은 비교에서 제외한다. 자유 입력처럼 별도의 브라우저 과업으로 시험하는 조작은 해당 화면의 `unverifiedActions`에 ID를 명시할 수 있다. 이 목록은 독립 경로 통과 수에 포함되는 조작이 아니므로 별도 시험 결과를 함께 기록한다. 모의 입력 조작도 명세나 이 목록에 명시한다.

배포 ZIP은 풀린 `wireflow-review` 폴더 자체가 스킬 경로다. 그 폴더에서 `npm ci --prefix verification`, `npm exec --prefix verification -- playwright install chromium`, `npm test --prefix verification`을 실행할 수 있다.

예를 들어 교정쇄 매수를 표시하는 단일 `rows` 블록이 있다면, `{"selector":".info-rows dd","text":"100매"}`로 그 값이 실제로 표시됐는지 검사할 수 있다. 행이 여러 개라면 대상 행을 지정한다. 첫 행의 값은 `.info-rows > :nth-child(1) dd`다. 화면의 제목과 안내 문장은 각각 `.app-intro h2`와 `.app-intro .lead`에 표시된다.
