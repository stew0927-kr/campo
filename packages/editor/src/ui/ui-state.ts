// Screen-only state. Never saved; never mixed into CampusDoc.
import type { IndoorNodeKind, OutdoorKind } from '../model/tools.ts';
import { OUTDOOR, type Scope } from '../model/scope.ts';
import { initialDoorRun, type DoorRun } from '../model/doors.ts';
import type { EscalatorMode } from '../model/escalator.ts';
import type { BasemapId } from '../map/basemaps.ts';

export type Tool =
  | 'select' | 'path' | 'building' | 'select-building' | 'add-node' | 'connect' | 'portal' | 'bridge'
  | 'door' | 'strip' | 'restroom' | 'elevator' | 'escalator';

/** Tools that place something where the pointer is: the cursor shows the scope there (SPEC-v0.2 5.2). */
export const PLACING_TOOLS: readonly Tool[] = ['path', 'add-node', 'door', 'strip', 'restroom', 'elevator'];

/** The tools whose second click is chosen in a small window first (연결통로, 에스컬레이터). */
export const CROSS_TOOLS: readonly Tool[] = ['bridge', 'escalator'];

/** One key per tool (SPEC-v0.2 5.3 and 6.5). */
export const TOOL_KEYS: Partial<Record<Tool, string>> = { door: 'D', strip: 'R', elevator: 'V', restroom: 'T', path: 'P', escalator: 'E' };

/** The tools in toolbar order with their Korean names. The toolbar and the shortcut list (?) are both made from this and TOOL_KEYS. */
export const TOOL_LIST: readonly { id: Tool; label: string }[] = [
  { id: 'select', label: '선택' },
  { id: 'path', label: '길 그리기' },
  { id: 'building', label: '건물' },
  { id: 'select-building', label: '건물 선택' },
  { id: 'add-node', label: '지점 추가' },
  { id: 'connect', label: '잇기' },
  { id: 'portal', label: '포탈' },
  { id: 'bridge', label: '연결통로' },
  { id: 'door', label: '문 연속 찍기' },
  { id: 'strip', label: '강의실 줄' },
  { id: 'restroom', label: '화장실' },
  { id: 'elevator', label: '엘리베이터' },
  { id: 'escalator', label: '에스컬레이터' },
];

/** Keys of the operations (SPEC-v0.2 5.3). The toolbar buttons, their tooltips and the shortcut list read them from here. */
export const OPERATION_KEYS = {
  delete: 'Delete',
  'delete-heal': 'Shift+Delete',
  merge: 'M',
  flip: 'F',
  split: 'X',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Shift+Z',
} as const;

export interface ShortcutRow {
  keys: string;
  label: string;
}

/** The 도구 단축키 list: tools from TOOL_LIST / TOOL_KEYS ("-" when a tool has no key), then the other keys of SPEC-v0.2 5.3. */
export function shortcutSections(): { title: string; rows: ShortcutRow[] }[] {
  return [
    { title: '도구', rows: TOOL_LIST.map((t) => ({ keys: TOOL_KEYS[t.id] ?? '-', label: t.label })) },
    {
      title: '작업',
      rows: [
        { keys: `${OPERATION_KEYS.delete} / Backspace`, label: '삭제' },
        { keys: OPERATION_KEYS['delete-heal'], label: '이어 붙이며 삭제' },
        { keys: OPERATION_KEYS.merge, label: '합치기' },
        { keys: OPERATION_KEYS.split, label: '나누기' },
        { keys: OPERATION_KEYS.flip, label: '뒤집기 (구간 방향, 문의 앞·뒤)' },
        { keys: 'O (누르고 있기)', label: '바깥 범위로 찍기' },
        { keys: `${OPERATION_KEYS.undo} / ${OPERATION_KEYS.redo}`, label: '되돌리기 / 다시 하기' },
        { keys: 'Esc', label: '모드 끝내기, 선택 풀기' },
        { keys: '[ / ]', label: '층 내리기 / 올리기' },
        { keys: '지도에서 우클릭', label: '선택한 것의 메뉴 (속성, 다른 층에 복사, 삭제)' },
        { keys: '?', label: '이 목록 열기' },
      ],
    },
  ];
}
/** What "지점 추가" places: indoors a node or a staircase; outdoors a point or a poi (SPEC §8). Elevators have their own tool. */
export type AddKind = IndoorNodeKind | 'stairs' | 'outdoor' | 'poi';
export type PanelTab = 'properties' | 'checks' | 'routes';

export const INDOOR_ADD_KINDS: AddKind[] = ['entrance', 'door', 'classroom', 'corridor', 'stairs'];
export const OUTDOOR_ADD_KINDS: AddKind[] = ['outdoor', 'poi'];

export interface UiState {
  tool: Tool;
  outdoorKind: OutdoorKind;
  addKind: AddKind;
  basemap: BasemapId;
  panelTab: PanelTab;
  /** Outdoors, or one floor of one building. */
  scope: Scope;
  /** Building whose floor picker is open. */
  selectedBuildingId: string | null;
  /** First node picked by 잇기 / 포탈 / 연결통로 / 에스컬레이터. */
  pickFrom: string | null;
  /** What the small window of 연결통로 / 에스컬레이터 holds besides the floor (the floor is the one shown). Screen state. */
  crossPick: CrossPick;
  /** Selected Features in the order they were picked (the last picked stays when nodes are merged). The 속성 tab shows a lone one. */
  selection: string[];
  routeFrom: string | null;
  routeTo: string | null;
  /** 가장 가까운 화장실 asked for in the 길찾기 tab: any, or wheelchair-usable only. */
  nearest: 'any' | 'wheelchair' | null;
  /** 문 연속 찍기: next room number, step, last room. */
  doorRun: DoorRun;
}

export interface CrossPick {
  /** 연결통로: the bridge has no roof (covered: false). */
  noRoof: boolean;
  /** 에스컬레이터: 상행 / 하행 / 양방향 전환 / 한 쌍. */
  mode: EscalatorMode;
}

export const initialCrossPick: CrossPick = { noRoof: false, mode: 'pair' };

export const initialUi: UiState = {
  tool: 'select',
  outdoorKind: 'flat',
  addKind: 'corridor',
  basemap: 'osm',
  panelTab: 'properties',
  scope: OUTDOOR,
  selectedBuildingId: null,
  pickFrom: null,
  crossPick: initialCrossPick,
  selection: [],
  routeFrom: null,
  routeTo: null,
  nearest: null,
  doorRun: initialDoorRun,
};

/** Tools that make sense in each scope. */
export function toolAvailable(tool: Tool, scope: Scope): boolean {
  switch (tool) {
    case 'building':
      return scope.kind === 'outdoor';
    case 'portal':
    case 'bridge':
      return scope.kind === 'building';
    default:
      return true;
  }
}

/** The 지점 추가 kind to show as chosen in this scope; falls back to a sensible default when the last choice belongs to the other scope. */
export function effectiveAddKind(ui: Pick<UiState, 'addKind' | 'scope'>): AddKind {
  const allowed = ui.scope.kind === 'outdoor' ? OUTDOOR_ADD_KINDS : INDOOR_ADD_KINDS;
  return allowed.includes(ui.addKind) ? ui.addKind : ui.scope.kind === 'outdoor' ? 'poi' : 'corridor';
}

export const TOOL_HINTS: Record<Tool, string | null> = {
  select: '누르면 고르고, Shift+누르기로 더하거나 뺍니다. Shift를 누른 채 끌면 상자로 고릅니다. 지점은 끌어서 옮기며, Alt를 누르면 붙이지 않습니다.',
  path: '클릭하며 이어 그리고, 마지막 점을 한 번 더 누르거나 Enter를 누르면 끝납니다. 처음 누른 자리가 바깥이면 바깥 길, 건물 안이면 그 층의 복도입니다.',
  building: '건물 외곽선을 클릭하며 그리고, 첫 점을 다시 누르면 끝납니다.',
  'select-building': '건물을 누르면 층을 고를 수 있습니다.',
  'add-node': '지도를 누르면 고른 종류의 지점이 생깁니다.',
  connect: '이을 두 지점을 차례로 누릅니다. Esc는 취소입니다.',
  portal: '이 층의 출입구를 누른 다음, 이어질 바깥 지점을 누릅니다.',
  bridge: '이 층의 지점을 누르면 작은 창이 열립니다. 이어질 건물과 층을 고른 다음, 그 층의 지점이나 빈자리를 누릅니다. 빈자리를 누르면 새 지점을 만들어 이어 줍니다.',
  door: '복도 가까이를 누를 때마다 문이 생기고 복도에 이어집니다. 호실 번호는 자동으로 늘어납니다. Shift+누르기는 뒷문, 2는 간격 2, F는 앞문·뒷문 뒤집기입니다.',
  strip: '복도 구간을 누르고(여러 개 가능), 첫 문과 마지막 문 자리를 차례로 누른 다음 개수와 시작 번호를 넣고 Enter를 누릅니다.',
  restroom: '화장실 자리를 누르면 성별과 휠체어 여부를 묻습니다.',
  escalator: '아래쪽 지점을 누르면 작은 창이 열립니다. 방향과 위쪽 층을 고른 다음, 위쪽 지점이나 빈자리를 누릅니다. 바깥에서는 층 선택 없이 방향만 고릅니다.',
  elevator: '엘리베이터 자리를 누르면 정차 층을 묻습니다. 이미 있는 엘리베이터를 누르면 정차 층을 고칩니다.',
};

/** 강의실 줄 (R): the corridor edges, the two clicked door places, and the numbers typed in. Screen state. */
export interface StripState {
  edgeIds: string[];
  first: [number, number] | null;
  last: [number, number] | null;
  count: string;
  startRef: string;
  refStep: 1 | 2;
  doorsPerRoom: 1 | 2;
}

export const initialStrip: StripState = { edgeIds: [], first: null, last: null, count: '10', startRef: '', refStep: 1, doorsPerRoom: 1 };

/** Which step of 강의실 줄 comes next. */
export function stripStage(s: StripState): 'corridor' | 'first' | 'last' | 'numbers' {
  if (s.edgeIds.length === 0) return 'corridor';
  if (!s.first) return 'first';
  if (!s.last) return 'last';
  return 'numbers';
}

export const STRIP_STAGE_TEXT = {
  corridor: '1. 강의실이 늘어선 복도 구간을 누르세요. 여러 구간을 이어서 고를 수 있습니다.',
  first: '2. 첫 번째 문 자리를 누르세요(복도 옆).',
  last: '3. 마지막 문 자리를 누르세요.',
  numbers: '4. 개수와 시작 번호를 넣고 Enter를 누르세요. 지도에 미리 보입니다. F는 첫 문과 마지막 문을 바꿉니다.',
} as const;
