import type { CampusPlace, TravelMode } from '../contracts.ts';
import type { CampusRuntime } from '../campus/types.ts';

export const TABS = ['논술', '축제', '지도·길찾기', '학교행사', '내정보'] as const;
export type Tab = (typeof TABS)[number];
export type DefaultMode = Extract<TravelMode, 'shortest' | 'step_free' | 'wheelchair'>;
export interface Destination {
  key: string;
  name: string;
  searchTerm: string;
  nodeId: string | null;
  kind: 'place' | 'essay' | 'stall' | 'event' | 'stage';
  demo: boolean;
  fromNodeId?: string | null;
  flow?: 'enter' | 'queue' | 'exit';
}
export interface RouteIntent { sequence: number; destination: Destination }
export interface AppState {
  tab: Tab;
  defaultMode: DefaultMode;
  favorites: Destination[];
  intent: RouteIntent | null;
  sequence: number;
  lastEstimate: { nodeId: string; timeSec: number } | null;
}
// 가운데 탭(지도·길찾기)에서 시작한다. TABS의 순서(화면 배치용)와는 독립적으로 고정한다.
export const INITIAL_STATE: AppState = { tab: '지도·길찾기', defaultMode: 'shortest', favorites: [], intent: null, sequence: 0, lastEstimate: null };
export type Action =
  | { type: 'tab'; tab: Tab }
  | { type: 'navigate'; destination: Destination }
  | { type: 'consumed'; sequence: number }
  | { type: 'mode'; mode: DefaultMode }
  | { type: 'favorite'; destination: Destination }
  | { type: 'clearEstimate' }
  | { type: 'estimate'; nodeId: string; timeSec: number };
export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'tab': return { ...state, tab: action.tab };
    case 'navigate': return { ...state, tab: '지도·길찾기', sequence: state.sequence + 1, intent: { sequence: state.sequence + 1, destination: action.destination } };
    case 'consumed': return state.intent?.sequence === action.sequence ? { ...state, intent: null } : state;
    case 'mode': return { ...state, defaultMode: action.mode, lastEstimate: null };
    case 'clearEstimate': return state.lastEstimate === null ? state : { ...state, lastEstimate: null };
    case 'favorite': return { ...state, favorites: state.favorites.some((item) => item.key === action.destination.key)
      ? state.favorites.filter((item) => item.key !== action.destination.key) : [...state.favorites, action.destination] };
    case 'estimate': return Number.isFinite(action.timeSec) && action.timeSec >= 0 ? { ...state, lastEstimate: { nodeId: action.nodeId, timeSec: action.timeSec } } : state;
  }
}
export type DestinationResolution = { kind: 'selected'; place: CampusPlace } | { kind: 'search'; query: string; message: string };
export function resolveDestination(runtime: CampusRuntime | null, target: Destination): DestinationResolution {
  const node = target.nodeId ? runtime?.graph.nodes.get(target.nodeId) : null;
  if (node) {
    const place = runtime!.places.find((item) => item.id === node.id);
    return { kind: 'selected', place: place ?? { id: node.id, name: target.name, nodeType: node.properties.node_type,
      buildingId: node.properties.building_id, level: node.properties.level,
      lng: node.geometry.coordinates[0], lat: node.geometry.coordinates[1] } };
  }
  // A supplied stale id must never silently select an unrelated place with the same name.
  const exact = target.nodeId ? [] : runtime?.places.filter((p) => p.name.trim() === target.searchTerm.trim()) ?? [];
  if (exact.length === 1) return { kind: 'selected', place: exact[0]! };
  return { kind: 'search', query: target.searchTerm, message: `${target.name}: 연결된 지도 지점이 아직 없습니다. 실제 목적지를 검색하거나 지도에서 직접 선택해 주세요.` };
}
export function placeDestination(place: CampusPlace): Destination {
  return { key: `place:${place.id}`, name: place.name, searchTerm: place.name, nodeId: place.id, kind: 'place', demo: false };
}

export interface IntentPlan {
  destination: DestinationResolution;
  start: CampusPlace | null;
  missingFlow: boolean;
}
export function planIntent(runtime: CampusRuntime | null, target: Destination): IntentPlan {
  const destination = resolveDestination(runtime, target);
  const start = target.fromNodeId ? resolveDestination(runtime, { ...target, nodeId: target.fromNodeId }) : null;
  return { destination, start: start?.kind === 'selected' ? start.place : null,
    missingFlow: Boolean(target.flow && target.flow !== 'queue' && (!target.fromNodeId || start?.kind !== 'selected')) };
}
