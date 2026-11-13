// Screen-only state. Never saved; never mixed into CampusDoc.
// (What the editor offers - tools, operations, panel tabs - is in registry.ts.)
import type { IndoorNodeKind, OutdoorKind } from '../model/tools.ts';
import { OUTDOOR, type Scope } from '../model/scope.ts';
import { initialDoorRun, type DoorRun } from '../model/doors.ts';
import type { EscalatorMode } from '../model/escalator.ts';
import type { BasemapId } from '../map/basemaps.ts';
import type { PanelTab, Tool } from './registry.ts';

/** What "지점 추가" places: indoors a node or a staircase; outdoors a point or a poi (SPEC §8). Elevators have their own tool. */
export type AddKind = IndoorNodeKind | 'stairs' | 'outdoor' | 'poi';

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
  /** First node picked by 잇기 / 출입구 연결 / 연결통로 / 에스컬레이터. */
  pickFrom: string | null;
  /** What the small window of 연결통로 / 에스컬레이터 holds besides the floor (the floor is the one shown). Screen state. */
  crossPick: CrossPick;
  /** Selected Features in the order they were picked (the last picked stays when nodes are merged). The 상세 정보 tab shows a lone one. */
  selection: string[];
  routeFrom: string | null;
  routeTo: string | null;
  /** 가장 가까운 화장실 asked for in the 경로 테스트 tab: any, or wheelchair-usable only. */
  nearest: 'any' | 'wheelchair' | null;
  /** 호실 연속 입력: next room number, step, last room. */
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

/** The 지점 추가 kinds that can be placed in this scope. */
export const addKindsIn = (scope: Scope): AddKind[] => (scope.kind === 'outdoor' ? OUTDOOR_ADD_KINDS : INDOOR_ADD_KINDS);

/** The 지점 추가 kind to show as chosen in this scope; falls back to a sensible default when the last choice belongs to the other scope. */
export function effectiveAddKind(ui: Pick<UiState, 'addKind' | 'scope'>): AddKind {
  if (addKindsIn(ui.scope).includes(ui.addKind)) return ui.addKind;
  return ui.scope.kind === 'outdoor' ? 'poi' : 'corridor';
}

/** 강의실 자동 연결 (R): the corridor edges, the two clicked door places, and the numbers typed in. Screen state. */
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

/** Which step of 강의실 자동 연결 comes next. */
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
