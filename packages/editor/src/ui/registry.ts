// What the editor offers, in one place: the tools, the operations and the panel tabs.
// The toolbar, the tooltips, the shortcut list (?) and the keyboard handler are all made from these lists,
// so a new tool or tab is one entry here plus its own handler (app/toolClicks.ts for a tool, the `panels` table of app/Workspace.tsx
// for a tab; the Record types make you fill them in).
import type { Scope } from '../model/scope.ts';

/** The three visual groups of the toolbar, in order. */
export const TOOLBAR_GROUPS = [
  { id: 'draw', label: '그리기 도구' },
  { id: 'edit', label: '편집 작업' },
  { id: 'macro', label: '자동화 매크로' },
] as const;
export type ToolbarGroupId = (typeof TOOLBAR_GROUPS)[number]['id'];

// ---- Tools (one is active at a time, SPEC-v0.2 5.1) ----

interface ToolSpec {
  id: string;
  /** Name on the button and in the shortcut list. */
  label: string;
  group: ToolbarGroupId;
  /** Single key that switches to the tool (SPEC-v0.2 5.3, 6.5). */
  key?: string;
  /** One sentence for the tooltip: what the tool is for. */
  description: string;
  /** How to use it, shown in the options row (or the status bar when the tool has its own options). */
  hint: string;
  /** Where the tool makes sense; everywhere when left out. */
  scope?: Scope['kind'];
  /** Places something where the pointer is: the cursor shows the scope there (SPEC-v0.2 5.2). */
  placing?: true;
  /** Its second click is chosen in a small window first (연결통로, 에스컬레이터). */
  cross?: true;
  /** Shows, under the pointer, where the new point would join the corridor. */
  attachPreview?: true;
}

const TOOL_SPECS = [
  {
    id: 'select', label: '선택', group: 'draw',
    description: '지점·구간·건물을 눌러 고르고, 지점을 끌어서 옮깁니다.',
    hint: '누르면 고르고, Shift+누르기로 더하거나 뺍니다. Shift를 누른 채 끌면 상자로 고릅니다. 지점은 끌어서 옮기며, Alt를 누르면 붙이지 않습니다.',
  },
  {
    id: 'select-building', label: '건물 선택', group: 'draw',
    description: '이미 있는 건물을 눌러 편집할 층을 고릅니다.',
    hint: '건물을 누르면 층을 고를 수 있습니다.',
  },
  {
    id: 'path', label: '길 그리기', group: 'draw', key: 'P', placing: true,
    description: '클릭하며 바깥 길이나 층 안의 복도를 그립니다.',
    hint: '클릭하며 이어 그리고, 마지막 점을 한 번 더 누르거나 Enter를 누르면 끝납니다. 처음 누른 자리가 바깥이면 바깥 길, 건물 안이면 그 층의 복도입니다.',
  },
  {
    id: 'building', label: '건물 외곽선 그리기', group: 'draw', scope: 'outdoor',
    description: '건물의 테두리를 따라 그려 새 건물을 등록합니다.',
    hint: '건물 외곽선을 클릭하며 그리고, 첫 점을 다시 누르면 끝납니다.',
  },
  {
    id: 'add-node', label: '지점 추가', group: 'draw', placing: true,
    description: '출입구·문·복도·계단 같은 지점을 하나씩 찍습니다.',
    hint: '지도를 누르면 고른 종류의 지점이 생깁니다.',
  },
  {
    id: 'connect', label: '잇기', group: 'draw',
    description: '같은 층(또는 바깥)의 두 지점을 구간으로 잇습니다.',
    hint: '이을 두 지점을 차례로 누릅니다. Esc는 취소입니다.',
  },
  {
    id: 'portal', label: '출입구 연결', group: 'draw', scope: 'building',
    description: '건물 출입구와 바깥 길을 이어, 건물 안팎을 오갈 수 있게 합니다.',
    hint: '이 층의 출입구를 누른 다음, 이어질 바깥 지점을 누릅니다.',
  },
  {
    id: 'bridge', label: '연결통로', group: 'draw', scope: 'building', cross: true,
    description: '서로 다른 두 건물의 층을 연결통로(구름다리)로 잇습니다.',
    hint: '이 층의 지점을 누르면 작은 창이 열립니다. 이어질 건물과 층을 고른 다음, 그 층의 지점이나 빈자리를 누릅니다. 빈자리를 누르면 새 지점을 만들어 이어 줍니다.',
  },
  {
    id: 'restroom', label: '화장실', group: 'draw', key: 'T', placing: true, attachPreview: true,
    description: '화장실을 찍고 가까운 복도에 이어 줍니다.',
    hint: '화장실 자리를 누르면 성별과 휠체어 여부를 묻습니다.',
  },
  {
    id: 'elevator', label: '엘리베이터', group: 'draw', key: 'V', placing: true, attachPreview: true,
    description: '엘리베이터를 만들고 서는 층을 정합니다.',
    hint: '엘리베이터 자리를 누르면 정차 층을 묻습니다. 이미 있는 엘리베이터를 누르면 정차 층을 고칩니다.',
  },
  {
    id: 'escalator', label: '에스컬레이터', group: 'draw', key: 'E', cross: true,
    description: '아래쪽 지점과 위쪽 지점을 에스컬레이터로 잇습니다.',
    hint: '아래쪽 지점을 누르면 작은 창이 열립니다. 방향과 위쪽 층을 고른 다음, 위쪽 지점이나 빈자리를 누릅니다. 바깥에서는 층 선택 없이 방향만 고릅니다.',
  },
  {
    id: 'door', label: '호실 연속 입력', group: 'macro', key: 'D', placing: true, attachPreview: true,
    description: '복도 옆을 누를 때마다 강의실 문이 생기고, 호실 번호가 자동으로 늘어납니다.',
    hint: '복도 가까이를 누를 때마다 문이 생기고 복도에 이어집니다. 호실 번호는 자동으로 늘어납니다. Shift+누르기는 뒷문, 2는 간격 2, F는 앞문·뒷문 뒤집기입니다.',
  },
  {
    id: 'strip', label: '강의실 자동 연결', group: 'macro', key: 'R', placing: true,
    description: '복도와 첫 문·마지막 문 자리만 정하면, 그 사이 강의실 문을 한꺼번에 만들어 복도에 잇습니다.',
    hint: '복도 구간을 누르고(여러 개 가능), 첫 문과 마지막 문 자리를 차례로 누른 다음 개수와 시작 번호를 넣고 Enter를 누릅니다.',
  },
] as const satisfies readonly ToolSpec[];

export type Tool = (typeof TOOL_SPECS)[number]['id'];
export type ToolDef = ToolSpec & { id: Tool };

/** The tools in toolbar order. */
export const TOOLS: readonly ToolDef[] = TOOL_SPECS;
const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<Tool, ToolDef>;
export const toolDef = (id: Tool): ToolDef => TOOL_BY_ID[id];
export const toolLabel = (id: Tool): string => TOOL_BY_ID[id].label;

/** Why the tool cannot be used in this scope (Korean, for the tooltip), or false when it can. */
export function toolBlocked(tool: Tool, scope: Scope): string | false {
  const need = TOOL_BY_ID[tool].scope;
  if (need === undefined || need === scope.kind) return false;
  return need === 'building' ? `${toolLabel('select-building')}으로 층을 먼저 골라 주세요.` : '바깥 모드에서 쓸 수 있습니다.';
}
export const toolAvailable = (tool: Tool, scope: Scope): boolean => toolBlocked(tool, scope) === false;

/** Tooltip of a toolbar button: name, key, then what it does (or why it cannot be used now). */
export function tooltip(def: { label: string; key?: string; description: string }, blocked: string | false = false): string {
  const head = def.key ? `${def.label} (${def.key})` : def.label;
  return blocked === false ? `${head}\n${def.description}` : `${head}\n${def.description}\n지금은 쓸 수 없습니다: ${blocked}`;
}

// ---- Operations on the selection or the history (SPEC-v0.2 5.1 작업, 5.3) ----

interface OperationSpec {
  id: string;
  label: string;
  group: ToolbarGroupId;
  /** "Shift+Delete", "Ctrl+Z", "M": shown in the tooltip and the shortcut list, and parsed by the keyboard handler. */
  key?: string;
  /** Another key that does the same (Backspace for Delete). */
  aliasKey?: string;
  description: string;
  /** Works on the selection: its key only acts while the 선택 tool is active. */
  onSelection?: true;
}

const OPERATION_SPECS = [
  { id: 'delete', label: '삭제', group: 'edit', key: 'Delete', aliasKey: 'Backspace', onSelection: true, description: '고른 지점·구간·건물을 지웁니다.' },
  {
    id: 'delete-heal', label: '지점 삭제 후 연결', group: 'edit', key: 'Shift+Delete', aliasKey: 'Shift+Backspace', onSelection: true,
    description: '고른 지점을 지우고, 끊어진 양쪽 구간을 하나로 이어 줍니다.',
  },
  { id: 'merge', label: '합치기', group: 'edit', key: 'M', onSelection: true, description: '고른 지점들을 한 지점으로 합칩니다.' },
  { id: 'flip', label: '뒤집기', group: 'edit', key: 'F', onSelection: true, description: '구간의 방향, 또는 문의 앞문·뒷문을 뒤집습니다.' },
  { id: 'split', label: '나누기', group: 'edit', key: 'X', onSelection: true, description: '고른 구간을 가운데에서 둘로 나눕니다.' },
  { id: 'undo', label: '되돌리기', group: 'edit', key: 'Ctrl+Z', description: '방금 한 편집을 취소합니다.' },
  { id: 'redo', label: '다시 하기', group: 'edit', key: 'Ctrl+Shift+Z', description: '되돌린 편집을 다시 적용합니다.' },
  {
    id: 'import-survey', label: '현장 기록 불러오기', group: 'edit',
    description: '현장 조사 앱에서 내보낸 zip 파일을 열어, 현장에서 기록한 지점·구간을 한 번에 반영합니다. 되돌리기 한 번으로 취소됩니다.',
  },
  {
    id: 'attach-unattached', label: '연결 안 된 지점 잇기', group: 'macro',
    description: '이 층에서 복도와 떨어져 있는 문·화장실·엘리베이터를 가까운 복도에 한꺼번에 잇습니다.',
  },
] as const satisfies readonly OperationSpec[];

export type OperationId = (typeof OPERATION_SPECS)[number]['id'];
export type OperationDef = OperationSpec & { id: OperationId };
export const OPERATIONS: readonly OperationDef[] = OPERATION_SPECS;

/** "Ctrl+Shift+Z", "Shift+Delete", "M" (the way keys are written above) as what the keyboard handler matches. */
export function parseKey(text: string): { key: string; mod: boolean; shift: boolean } {
  const parts = text.split('+');
  return { key: parts[parts.length - 1]!.toLowerCase(), mod: parts.includes('Ctrl'), shift: parts.includes('Shift') };
}

// ---- Panel tabs ----

interface PanelTabSpec {
  id: string;
  label: string;
  /** Screen-reader text of the count badge on the tab. */
  badgeLabel?: (count: number) => string;
}

const PANEL_TAB_SPECS = [
  { id: 'properties', label: '상세 정보' },
  { id: 'checks', label: '오류 검사', badgeLabel: (n: number) => `오류 ${n}개` },
  { id: 'routes', label: '경로 테스트' },
  { id: 'reports', label: '제보 관리', badgeLabel: (n: number) => `대기 중인 제보 ${n}건` },
] as const satisfies readonly PanelTabSpec[];

export type PanelTab = (typeof PANEL_TAB_SPECS)[number]['id'];
export const PANEL_TABS: readonly (PanelTabSpec & { id: PanelTab })[] = PANEL_TAB_SPECS;
export const tabLabel = (id: PanelTab): string => PANEL_TABS.find((t) => t.id === id)!.label;

// ---- Shortcut list (?) ----

export interface ShortcutRow {
  keys: string;
  label: string;
}

/** Keys that belong to no button (SPEC-v0.2 5.3). */
const OTHER_KEYS: ShortcutRow[] = [
  { keys: 'O (누르고 있기)', label: '건물 위라도 바깥 범위로 찍기' },
  { keys: 'Esc', label: '도구 끝내기, 선택 풀기' },
  { keys: '[ / ]', label: '층 내리기 / 올리기' },
  { keys: 'Ctrl+S', label: '저장' },
  { keys: '지도에서 우클릭', label: '선택한 것의 메뉴 (속성, 다른 층에 복사, 삭제)' },
  { keys: '?', label: '이 목록 열기' },
];

/** The 도구 단축키 list: one section per toolbar group (same names and keys as the buttons, "-" without a key), then the other keys. */
export function shortcutSections(): { title: string; rows: ShortcutRow[] }[] {
  const row = (d: { label: string; key?: string; aliasKey?: string }): ShortcutRow => ({
    keys: d.key ? (d.aliasKey ? `${d.key} / ${d.aliasKey}` : d.key) : '-',
    label: d.label,
  });
  return [
    ...TOOLBAR_GROUPS.map((g) => ({
      title: g.label,
      rows: [...TOOLS, ...OPERATIONS].filter((d) => d.group === g.id).map(row),
    })),
    { title: '그 밖의 키', rows: OTHER_KEYS },
  ];
}
