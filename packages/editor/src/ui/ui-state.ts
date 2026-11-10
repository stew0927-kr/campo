// Screen-only state. Never saved; never mixed into CampusDoc.
import type { IndoorNodeKind } from '../model/indoor.ts';
import type { OutdoorKind } from '../model/outdoor-path.ts';
import { OUTDOOR, type Scope } from '../model/scope.ts';
import type { BasemapId } from '../map/basemaps.ts';

export type Tool = 'pan' | 'outdoor-path' | 'building' | 'select-building' | 'add-node' | 'connect';
/** What "지점 추가" places: a single node, or a whole elevator / staircase (SPEC §8). */
export type AddKind = IndoorNodeKind | 'elevator' | 'stairs';
export type PanelTab = 'properties' | 'checks' | 'routes';

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
  /** First node picked by "잇기". */
  connectFrom: string | null;
}

export const initialUi: UiState = {
  tool: 'pan',
  outdoorKind: 'flat',
  addKind: 'corridor',
  basemap: 'osm',
  panelTab: 'properties',
  scope: OUTDOOR,
  selectedBuildingId: null,
  connectFrom: null,
};

/** Tools that make sense in each scope. */
export function toolAvailable(tool: Tool, scope: Scope): boolean {
  switch (tool) {
    case 'outdoor-path':
    case 'building':
      return scope.kind === 'outdoor';
    case 'add-node':
      return scope.kind === 'building';
    default:
      return true;
  }
}

export const TOOL_HINTS: Record<Tool, string | null> = {
  pan: null,
  'outdoor-path': '클릭하며 이어 그리고, 마지막 점을 한 번 더 누르거나 Enter를 누르면 끝납니다. Esc는 취소입니다.',
  building: '건물 외곽선을 클릭하며 그리고, 첫 점을 다시 누르면 끝납니다.',
  'select-building': '건물을 누르면 층을 고를 수 있습니다.',
  'add-node': '지도를 누르면 고른 종류의 지점이 이 층에 생깁니다.',
  connect: '이을 두 지점을 차례로 누릅니다. Esc는 취소입니다.',
};
