// Test-only stand-in for @maplibre/maplibre-react-native, used by campusMap.html only.
// It draws nothing real: it keeps the latest Map props so a scenario can fire region events, and counts how often
// the map and each Marker render, so marker re-render work can be measured in a real React runtime.
import { forwardRef, useImperativeHandle, type ReactNode } from 'react';
type Counters = { map: number; markers: number; byId: Record<string, number> };
const w = window as unknown as { __campoMap?: Record<string, any>; __campoRenders: Counters };
w.__campoRenders = { map: 0, markers: 0, byId: {} };
export function Map(p: Record<string, any> & { children?: ReactNode }) {
  w.__campoMap = p; w.__campoRenders.map++;
  return <div data-map="">{p.children}</div>;
}
export const Camera = forwardRef(function Camera(_p: Record<string, unknown>, ref) {
  useImperativeHandle(ref, () => ({ jumpTo() {}, fitBounds() {}, easeTo() {} }));
  return null;
});
export function GeoJSONSource({ children }: { children?: ReactNode }) { return <>{children}</>; }
export function Layer() { return null; }
export function Marker({ id, children }: { id: string; children?: ReactNode }) {
  w.__campoRenders.markers++; w.__campoRenders.byId[id] = (w.__campoRenders.byId[id] ?? 0) + 1;
  return <div data-marker={id}>{children}</div>;
}
export type CameraRef = { jumpTo(o: unknown): void; fitBounds(...a: unknown[]): void; easeTo(o: unknown): void };
