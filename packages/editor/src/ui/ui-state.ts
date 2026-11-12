// Screen-only state. Never saved; never mixed into CampusDoc.
import type { IndoorNodeKind, OutdoorKind } from '../model/tools.ts';
import { OUTDOOR, type Scope } from '../model/scope.ts';
import type { BasemapId } from '../map/basemaps.ts';

export type Tool = 'select' | 'outdoor-path' | 'building' | 'select-building' | 'add-node' | 'connect' | 'portal' | 'bridge';
/** What "지점 추가" places: indoors a node or a whole elevator / staircase; outdoors a point or a poi (SPEC §8). */
export type AddKind = IndoorNodeKind | 'elevator' | 'stairs' | 'outdoor' | 'poi';
export type PanelTab = 'properties' | 'checks' | 'routes';

export const INDOOR_ADD_KINDS: AddKind[] = ['entrance', 'door', 'classroom', 'corridor', 'elevator', 'stairs'];
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
  /** First node picked by 잇기 / 포탈 / 연결통로. */
  pickFrom: string | null;
  /** Selected Features in the order they were picked (the last picked stays when nodes are merged). The 속성 tab shows a lone one. */
  selection: string[];
  routeFrom: string | null;
  routeTo: string | null;
}

export const initialUi: UiState = {
  tool: 'select',
  outdoorKind: 'flat',
  addKind: 'corridor',
  basemap: 'osm',
  panelTab: 'properties',
  scope: OUTDOOR,
  selectedBuildingId: null,
  pickFrom: null,
  selection: [],
  routeFrom: null,
  routeTo: null,
};

/** Tools that make sense in each scope. */
export function toolAvailable(tool: Tool, scope: Scope): boolean {
  switch (tool) {
    case 'outdoor-path':
      return scope.kind === 'outdoor';
    case 'building':
      return scope.kind === 'outdoor';
    case 'portal':
    case 'bridge':
      return scope.kind === 'building';
    default:
      return true;
  }
}

/** The 지점 추가 kind to use in this scope; falls back to a sensible default when the last choice belongs to the other scope. */
export function effectiveAddKind(ui: Pick<UiState, 'addKind' | 'scope'>): AddKind {
  const allowed = ui.scope.kind === 'outdoor' ? OUTDOOR_ADD_KINDS : INDOOR_ADD_KINDS;
  return allowed.includes(ui.addKind) ? ui.addKind : ui.scope.kind === 'outdoor' ? 'poi' : 'corridor';
}

export const TOOL_HINTS: Record<Tool, string | null> = {
  select: '누르면 고르고, Shift+누르기로 더하거나 뺍니다. Shift를 누른 채 끌면 상자로 고릅니다. 지점은 끌어서 옮기며, Alt를 누르면 붙이지 않습니다.',
  'outdoor-path': '클릭하며 이어 그리고, 마지막 점을 한 번 더 누르거나 Enter를 누르면 끝납니다. Esc는 취소입니다.',
  building: '건물 외곽선을 클릭하며 그리고, 첫 점을 다시 누르면 끝납니다.',
  'select-building': '건물을 누르면 층을 고를 수 있습니다.',
  'add-node': '지도를 누르면 고른 종류의 지점이 생깁니다.',
  connect: '이을 두 지점을 차례로 누릅니다. Esc는 취소입니다.',
  portal: '이 층의 출입구를 누른 다음, 이어질 바깥 지점을 누릅니다.',
  bridge: '이 층의 지점을 누르고, 다른 건물을 눌러 층을 고른 다음 그 층의 지점을 누릅니다.',
};
