# Flow input and commands

A UTF-8 JSON object has `title`, `goal`, `start` (screen ID), `stages` (ordered nonempty list of labels), and a `screens` array. Set `device` to `watch`, `mobile`, or `desktop`. Omission uses the default mobile 390 × 844 CSS px artboard; canvas thumbnails and narrow browsers scale that artboard without changing its design size. Optional `entries` contains other entry screen IDs, `source` describes input provenance, and `vars` holds initial boolean, number, or string values. Use stable lowercase IDs made of letters, digits, and hyphens for screens, actions and proposals.

```json
{
  "title": "공간 예약",
  "goal": "선택한 시간의 예약을 완료한다.",
  "device": "mobile",
  "start": "home",
  "stages": ["선택", "결과"],
  "vars": {"booked": 0},
  "screens": [
    {"id":"home","title":"시간 선택","stage":0,"origin":"source","body":"오늘 예약할 시간을 골라요.","actions":[{"id":"book","label":"14:30 예약","to":"done","inc":{"booked":1}}]},
    {"id":"done","title":"예약 완료","stage":1,"origin":"inferred","body":"예약 {{booked}}건이 확인됐어요.","tone":"success","end":true,"actions":[]}
  ],
  "scenarios": [{"id":"booking","title":"예약 성공","steps":[{"action":"book","screen":"done","vars":{"booked":1}}]}]
}
```

## Screens and transitions

- Screen `stage` is a zero-based group index. Within each group, order the main screen and its variants by `slot` or by their order in `screens`. `origin` is `source` or `inferred`. `tone` can be `normal`, `success`, `error`, or `pending`. `body` and optional `detail` are text. `{{key}}` interpolates a value from `vars` in the active preview. Set `end: true` only where the user's task may intentionally end.
- Optional screen `brief` is the planning intent shown in **기획 근거**. Keep it as a short excerpt or grounded summary of the user's source for that screen. `uxConditions` lists relevant conditions and branches. Keep suggestions and unresolved policies identifiable through `origin` and `decisions`. The panel displays an empty state when the screen has neither planning intent nor conditions.
- Optional `ui` describes the in-app layout. Set `ui.bar` for the app header and `ui.heading` when the screen title inside the mock differs from its artboard label. Add `ui.blocks` in reading order. A `visual` block has `label`, optional `symbol` and `theme` (`warm`, `green`, or `violet`); a `rows` block holds `rows` with `label` and `value`; a `search` block previews a search field with `placeholder` and optional `value` (supports `{{key}}`). For an option picker, group `kind: "choice"` actions and set `ui.choiceLabel`; use an action that targets the same screen and sets the option's values. Its selected state follows those values.
- Optional `preview` overrides variables for a non-start screen when shown by itself in the overview or opened directly for inspection. A button-driven transition preserves live values.
- A scenario starts with `vars`. Use its optional `initial` to override declared variables when the task begins in an existing state, such as an already booked class.
- Every screen declares `actions`, even when empty. Each action has `id`, `label`, and `to`, where `null` explicitly marks a missing link. `kind: "simulation"` moves an action under the simulation controls. `kind: "secondary"` displays a secondary button. The first ordinary action is visually primary unless marked otherwise. A `when` object matches exact variable values; `set` replaces values and `inc` adds numbers. A self-transition is valid when it changes state or intentionally repeats an action. Give the user a route out of a closed loop unless it is a terminal state.
- A scenario has `id`, `title`, optional `start` (defaults to the primary entry), and `steps`. Each step executes an `action` on the current screen and can assert `screen` and a subset of `vars`. The manual walkthrough uses each action label as the next instruction. Set optional `step.hint` when the user needs to enter a value or complete another prerequisite before the action. Prefer checking both screen and domain outcome on completion and recovery. An unconnected action is clickable and reports its problem, without making up a destination at runtime.
- `proposals` hold `id`, `title`, `reason`, optional `finding` (finding ID from `check`), and `changes`. Each change is `{"screen":"failure","action":{"id":"retry","label":"다시 시도","to":"review"}}`. An action with the same ID is replaced in full, otherwise it is added. Define any target screen in `screens` before suggesting a link. The review panel lists every available proposal, including ones without a finding ID. A matching finding ID also exposes the proposal at the issue. For a missing retry control, omit it from the baseline actions, add it in the proposal, and run the same recovery scenario against both versions. Two proposals that modify the same action are alternatives and cannot be applied together. `decisions` contain `screen` and `question` for unresolved business choices.

## Commands

```bash
node "$skill_path/scripts/wireflow.cjs" check workflow.json
node "$skill_path/scripts/wireflow.cjs" check workflow.json --with reconnect-retry
node "$skill_path/scripts/wireflow.cjs" build workflow.json wireflow.html
```

`check` exits 1 when findings remain and 2 for invalid input or conflicting proposals. `build` exits 0 for a valid model even if findings remain. Broken or unknown targets, unreachable screens, routes with no exit to an entry or intentional endpoint, and scenario failures are reported. Static reachability considers all potential transitions; scenario execution verifies chosen guards and state changes. Review unmodeled behaviors against the sources separately. Browser-only selection changes the mockup in memory. The review panel can download the current patched JSON for use in a later run.

## Shared canvas and review handoff

`review.locale` accepts `"ko"` or `"en"` and controls viewer tools and generated verification messages. For older flows, the viewer detects Korean or English from the project title, goal, and first screen title, then uses the browser language if those strings do not indicate either. Write screen content, requirements, and validation cases in the user's language because they are displayed as authored.

Use a stable top-level `id` and a unique display `number` such as `02.01` for each screen in new flows. The viewer can derive numbers for older files. By default, `review.groupDirection` is `vertical`, with stages from top to bottom and screens from left to right. Set it to `horizontal` for groups from left to right and screens from top to bottom. Use `review.positions` for explicit screen-ID coordinates in grid units.

`review.artboard` can set the initial `width` and `height` in CSS pixels. The **크기 직접 입력…** picker option lets the user change both dimensions during review. Both accept integer dimensions from 1 to 8,192. The default mobile frame is 390 × 844, and the watch preset is 198 × 242. Changing frame size preserves screen IDs and layout order. `review.stateLabels` supplies labels for state values in results and copied requests.

The overview draws a region around each stage. The path picker uses existing scenarios, or individual actions when there are no scenarios. Missing destinations stay unconnected. Numbered labels refer to the original step order, including intermediate same-screen steps.

Use the same Paper components for arbitrary flows. The supported blocks include:

| Block type | Data |
|---|---|
| `visual` | `label`, optional `aspect` and `hotspots` |
| `text`, `notice` | `label` |
| `rows` | `rows` with `label` and `value` |
| `search` | `placeholder`, optional editable string `field` and `label`, or `value` for a read-only search preview |
| `input` | `label`, string `field`, optional `inputType` of `text`, `email`, `tel`, `url`, or `textarea`, and optional `required` |
| `select`, `radio` | `label`, string `field`, string `options` |
| `toggle`, `checkbox` | `label`, boolean `field`; `checkbox` can be required |
| `accordion` | `label` and `copy` |

Set `ui.overlay` to the ID of a screen behind a popup. Add an executable action with `kind: "close"` for close and Escape. `kind: "back"` places an action in the screen header and `kind: "tab"` puts it in the bottom navigation. Use `validate: true` on an action that should require valid form inputs. Fields are bound to declared `vars`. A search field captures the query, and the model defines the result transition and example content.

`review.audit.journeys` and `review.audit.recovery` accept cases with `title`, optional `start` and `initial`, and `steps`. A click step may assert `screen`, `vars`, or `keep` for unchanged fields. Optional `selector` identifies a specific control for repeated actions. `blocked: true` expects a form guard to stop the action. A local interaction uses `field`, `type` (`input`, `select`, or `click`), `value`, and optional `selector`. A DOM assertion uses `inspect: {title, selector, text}` with an array of text fragments. Set `exact: true` with `text` for a whole-text comparison. Use `inspect: {title, selector, absent: true}` to verify that a control or message stays hidden in a specified state, such as a confirmation button before required selection. Use distinct case titles and maintain the relevant expectations during revisions. Without explicit journeys, the browser also replays the model scenarios. `review.audit.fixtures` can supply extra screen states when conditional controls need coverage.

Define each observable planning requirement in `review.requirements` with an `id`, `group`, source `screen`, short `title`, and `expected` behavior. Add `action` to match the requirement to a specific control or detect a missing action. Set `requirement` on the actual steps in `review.audit.journeys` and `review.audit.recovery` that assert the result. Only observed linked steps count toward that requirement. If several steps assert the same requirement, verify each. A visible failure takes priority. When a preceding step stops the journey, its unexecuted assertions remain unchecked. Keep unresolved policies in `decisions`. Older flows without explicit requirements list defined screen actions by group.

Use `review.audit.explore: true` for a flow whose navigation states change through discrete screen actions. The browser traverses visible actions from the primary start and declared entries, using the initial variables at each entry. It deduplicates by screen ID and declared variable values, and flags reachable states with no completion or return and actions whose conditions are never met on a reached screen. Exploration is capped at 256 states. Local form input combinations require separate tests. If a run is incomplete, its scope is shown and it withholds findings that require exhaustive coverage.

The copy header identifies the actual flow file and flow ID. Each review finding carries a screen ID and, where applicable, an action ID or field. Keep the same flow ID and HTML output path as you rebuild. The browser stores requests for that output locally. A request advances to **해결됨** only when its linked checks have passed. Open **Flow 검증** after loading the rebuilt preview to update the request list.

For a spatial interaction, attach rectangles to the visual block, for example
`"hotspots":[{"action":"door","x":65,"y":25,"width":25,"height":55}]`.
Coordinates are percentages from the top left. Each rectangle binds an existing in-app action on that screen. The viewer renders its keyboard-accessible button in the rectangle. Measure and click the target on the scaled image when reviewing spatial requirements. Required text fields reject whitespace-only input while preserving the original text of nonempty submissions.

A `review.requirements` entry can carry `origin: "source"` for a behavior explicitly required by the brief or `origin: "inferred"` for an assumption. Put the behavior in `expected`. List optional design alternatives as stable IDs in `suggestedScreens`. Bind the originating `screen` and `action` so findings and change requests preserve the distinction. For example, resubmission can be required while opening a dedicated upload screen remains a proposal. A destination asserted by a test is a mockup expectation. Requirement entries without origin keep their verification meaning.

For a supplied diagram or image, place its PNG, JPEG or WebP data URI in top-level `images` under a stable ID. Reference that ID with `image` in a visual block, match its aspect to the artwork and give it a descriptive label. `ui.layout: "split"` places the first visual beside the remaining blocks at frame widths of 720 CSS pixels and up. Smaller frames stack the same content.
