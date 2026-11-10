// Screen-only state. Never saved; never mixed into CampusDoc.
import type { OutdoorKind } from '../model/outdoor-path.ts';
import type { BasemapId } from '../map/basemaps.ts';

export type Tool = 'pan' | 'outdoor-path';
export type PanelTab = 'properties' | 'checks' | 'routes';

export interface UiState {
  tool: Tool;
  outdoorKind: OutdoorKind;
  basemap: BasemapId;
  panelTab: PanelTab;
}

export const initialUi: UiState = { tool: 'pan', outdoorKind: 'flat', basemap: 'osm', panelTab: 'properties' };
