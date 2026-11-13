import { useEffect, useRef } from 'react';
import { Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type MapMouseEvent, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TerraDraw, TerraDrawLineStringMode, TerraDrawPolygonMode, type TerraDrawMouseEvent } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { FeatureCollection } from 'geojson';
import { edgeCoords, scopeOfNode, type EditBuilding, type EditEdge, type EditNode, type EditState, type Position } from '@campo/core';
import type { DragResult, DropTarget, HandleDrag, NodeDrag } from '../model/drag.ts';
import type { Preview } from '../model/doors.ts';
import { PAIR_OFFSET_PX, pairOffsets } from '../model/pairs.ts';
import { edgeMidpoint } from '../model/split.ts';
import type { OutdoorKind, PathVertex } from '../model/tools.ts';
import { buildingInScope, edgeStrong, nodeStrong, scopeAt, scopeLabel, snappable, type Scope } from '../model/scope.ts';
import { distanceToSegment, footOnSegment, nearestWithin, type ScreenPoint } from '../model/snap.ts';
import { toolDef, type Tool } from '../ui/registry.ts';
import { basemaps, type BasemapId } from './basemaps.ts';
import {
  DATA_LAYERS, DATA_SOURCE, DRAG_LAYERS, DRAG_SOURCE, PREVIEW_LAYERS, PREVIEW_SOURCE, ROUTE_LAYERS, ROUTE_SOURCE, WAY_COLORS,
  dragGeoJSON, dragMembers, hideInData, previewGeoJSON, routesGeoJSON, toDisplayGeoJSON, type RouteLine,
} from './layers.ts';
import { registerBeltIcons, registerRestroomIcons } from './icons.ts';

/** Clicking within this many pixels of a node picks it (잇기, 선택). Larger than the 5px snap: it is a pick, not a placement. */
const PICK_PX = 10;
/** Moving the pointer this far with the button down starts a drag (the same as MapLibre's click tolerance, so a press is a click or a drag, never both). */
const DRAG_PX = 3;
/** A dragged node snaps to a node or an edge of its own scope within this many pixels. */
const DROP_PX = 8;

export interface MapClick {
  position: Position;
  /** Nearest pickable node within PICK_PX, if any. */
  node: EditNode | undefined;
  /** Nearest edge drawn strongly in this scope within PICK_PX, when no node was hit. */
  edge: EditEdge | undefined;
  /** Outline of a building within PICK_PX, when neither was hit. */
  building: EditBuilding | undefined;
  /** Shift was held (add to / remove from the selection). */
  shift: boolean;
  /** The scope of the clicked place: the building floor under the pointer, the outdoors, or the outdoors forced by the O key. */
  scope: Scope;
}

/** A request to move the map; `seq` changes on every request so the same place can be asked for twice. */
export interface FocusRequest {
  position: Position;
  seq: number;
}

interface Props {
  state: EditState;
  center: Position;
  tool: Tool;
  outdoorKind: OutdoorKind;
  basemap: BasemapId;
  scope: Scope;
  highlight: ReadonlySet<string>;
  /** Which nodes a click may pick right now (e.g. outdoor points for the second click of 출입구 연결). */
  canPick: (node: EditNode) => boolean;
  routes: RouteLine[];
  focus: FocusRequest | null;
  /** What 길 그리기 drew, and the scope its first click fixed. */
  onPathDrawn: (vertices: PathVertex[], scope: Scope) => void;
  /** Preview under the pointer while a placing tool is active (null: none). */
  hover: ((position: Position, scope: Scope) => Preview) | null;
  /** Preview that stays (the doors of a 강의실 자동 연결). */
  previewShapes: FeatureCollection | null;
  onPolygonDrawn: (ring: Position[]) => void;
  onMapClick: (click: MapClick) => void;
  /** Right-click: the node or edge under the pointer (if any) and where the menu goes (page coordinates). */
  onContextMenu: (hit: { node: EditNode | undefined; edge: EditEdge | undefined; x: number; y: number }) => void;
  /** Shift + drag on the map: the nodes inside the box. */
  onBoxSelect: (ids: string[]) => void;
  /** A node drag begins: the history side of it (SPEC-v0.2 5.1). */
  beginDrag: (nodeId: string) => NodeDrag;
  /** A handle in the middle of a selected edge is pulled: the drag, or why the edge cannot be split. */
  beginHandleDrag: (edgeId: string) => HandleDrag | string;
  onHandleRefused: (reason: string) => void;
  /** The drag is over: the result, or null when it was cancelled (Esc). */
  onDragEnd: (result: DragResult | null) => void;
}

// Vite pre-bundles maplibre-gl, which breaks the worker's relative URL; point MapLibre at the file directly.
setWorkerUrl(workerUrl);

const KIND_COLOR: Record<OutdoorKind, string> = { flat: WAY_COLORS.footway, steps: WAY_COLORS.steps, ramp: WAY_COLORS.ramp };
const DRAW_MODE: Partial<Record<Tool, string>> = { path: 'linestring', building: 'polygon' };

interface ActiveDrag {
  ctl: NodeDrag | HandleDrag;
  nodeId: string;
  last: MapMouseEvent;
  raf: number | null;
}

export function MapView(props: Props) {
  const { state, scope, tool, outdoorKind, basemap, highlight, routes, focus } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  /** The scope the first click of the path being drawn fixed (null between paths). */
  const pathScope = useRef<Scope | null>(null);
  const hoverShapes = useRef<FeatureCollection | null>(null);
  const badgeEl = useRef<HTMLDivElement | null>(null);
  /** The drag visuals (temporary source, hidden originals) are cleared once the main source has the new data. */
  const clearDragAfterData = useRef(false);
  /** Work queued by the effects below until the map and Terra Draw are set up. */
  const pending = useRef<((map: MapLibreMap) => void)[] | null>([]);
  const whenReady = (fn: (map: MapLibreMap) => void) => {
    if (pending.current) pending.current.push(fn);
    else if (mapRef.current) fn(mapRef.current);
  };
  // Map and Terra Draw callbacks are registered once; they read the latest props through this ref.
  const latest = useRef(props);
  latest.current = props;
  const pushPreview = () => whenReady((map) => (map.getSource(PREVIEW_SOURCE) as GeoJSONSource).setData(previewGeoJSON(latest.current.previewShapes, hoverShapes.current)));

  useEffect(() => {
    const map = new MapLibreMap({
      container: container.current!,
      style: baseStyle(),
      center: latest.current.center,
      zoom: 17,
      attributionControl: { compact: false },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.boxZoom.disable(); // Shift + drag is the box select
    mapRef.current = map;
    // The e2e tests turn coordinates into pixels with this (dev server only).
    if (import.meta.env.DEV) (window as unknown as { __campoMap?: MapLibreMap }).__campoMap = map;

    const nearestNode = (point: ScreenPoint, accept: (n: EditNode) => boolean, maxPx?: number) => {
      const candidates = Object.values(latest.current.state.nodes)
        .filter(accept)
        .map((node) => ({ node, screen: map.project(node.coord) }));
      return nearestWithin(candidates, point, maxPx)?.node;
    };
    let oHeld = false;
    const autoScope = (at: Position) => scopeAt(latest.current.state, at, latest.current.scope, oHeld);
    /** 길 그리기 attaches to nodes of the path's own scope, and to entrances from the outdoors (SPEC-v0.2 5.2), within SNAP_PX. */
    const snapPath = (point: ScreenPoint, scope: Scope) => nearestNode(point, (n) => snappable(n, scope));
    const clearDragVisuals = () => {
      for (const [id, filter] of hideInData([])) map.setFilter(id, filter ?? null);
      (map.getSource(DRAG_SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
      map.getContainer().removeAttribute('data-dragging');
    };

    // ---- click: pick a node, an edge or a building outline ----
    /** The node (within PICK_PX), else the nearest strongly drawn edge, else a building outline, under a screen point. */
    const pickAt = (point: ScreenPoint, canPick: (n: EditNode) => boolean, withBuildings: boolean) => {
      const { state: st, scope: sc } = latest.current;
      const node = nearestNode(point, canPick, PICK_PX);
      let edge: EditEdge | undefined;
      let building: EditBuilding | undefined;
      if (!node) {
        let best = PICK_PX;
        const pairs = pairOffsets(st);
        for (const f of Object.values(st.edges)) {
          if (!st.nodes[f.props.from] || !st.nodes[f.props.to] || !edgeStrong(st, f, sc)) continue;
          const pts: ScreenPoint[] = edgeCoords(st, f).map((c) => map.project(c));
          const shift = (pairs.get(f.id) ?? 0) * PAIR_OFFSET_PX; // the line is drawn this far to the right of its direction: pick where it is drawn
          for (let i = 0; i + 1 < pts.length; i++) {
            let [p0, p1] = [pts[i]!, pts[i + 1]!];
            if (shift !== 0) {
              const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
              const [ox, oy] = [(-(p1.y - p0.y) / len) * shift, ((p1.x - p0.x) / len) * shift];
              [p0, p1] = [{ x: p0.x + ox, y: p0.y + oy }, { x: p1.x + ox, y: p1.y + oy }];
            }
            const dist = distanceToSegment(point, p0, p1);
            if (dist <= best) {
              best = dist;
              edge = f;
            }
          }
        }
        if (!edge && withBuildings) {
          for (const b of Object.values(st.buildings)) {
            if (!buildingInScope(b, sc)) continue;
            const pts = (b.polygon[0] ?? []).map((c) => map.project(c));
            for (let i = 0; i + 1 < pts.length; i++) {
              const dist = distanceToSegment(point, pts[i]!, pts[i + 1]!);
              if (dist <= best) {
                best = dist;
                building = b;
              }
            }
          }
        }
      }
      return { node, edge, building };
    };
    map.on('click', (e) => {
      const at: Position = [e.lngLat.lng, e.lngLat.lat];
      if (latest.current.tool === 'path' && !pathScope.current) pathScope.current = autoScope(at);
      if (DRAW_MODE[latest.current.tool]) return; // Terra Draw owns clicks while drawing
      const { node, edge, building } = pickAt(e.point, latest.current.canPick, true);
      latest.current.onMapClick({ position: at, node, edge, building, shift: e.originalEvent.shiftKey, scope: autoScope(at) });
    });
    // Right-click: the browser's own menu is blocked on the map only (this listener sits on MapLibre's container), and the editor's menu opens.
    map.on('contextmenu', (e) => {
      e.originalEvent.preventDefault();
      if (DRAW_MODE[latest.current.tool]) return;
      const { node, edge } = pickAt(e.point, (n) => nodeStrong(n, latest.current.scope), false);
      latest.current.onContextMenu({ node, edge, x: e.originalEvent.clientX, y: e.originalEvent.clientY });
    });

    // ---- node drag and box select (선택 tool) ----
    let press: { nodeId?: string; edgeId?: string; x: number; y: number } | null = null;
    let box: { x: number; y: number; el: HTMLDivElement } | null = null;
    let drag: ActiveDrag | null = null;

    /** Where the dragged node lands for a pointer at `point`: on a node, on an edge, or free. Alt never snaps. */
    const dropAt = (nodeId: string, point: ScreenPoint, lngLat: Position, alt: boolean): { coord: Position; target: DropTarget | null; ring: Position | null } => {
      const free = { coord: lngLat, target: null, ring: null };
      if (alt) return free;
      const st = latest.current.state;
      const { nodes: members, edgeIds } = dragMembers(st, nodeId);
      const dragged = members[0];
      if (!dragged) return free;
      const scopeId = scopeOfNode(dragged);
      const skip = new Set(members.map((n) => n.id));
      const candidates = Object.values(st.nodes)
        .filter((n) => !skip.has(n.id) && scopeOfNode(n) === scopeId)
        .map((node) => ({ node, screen: map.project(node.coord) }));
      const hit = nearestWithin(candidates, point, DROP_PX);
      if (hit) return { coord: hit.node.coord, target: { kind: 'node', id: hit.node.id }, ring: hit.node.coord };
      if (members.some((n) => n.props.node_type === 'elevator_stop')) return free; // a shaft cannot leave its place
      const skipEdges = new Set(edgeIds);
      let best: { id: string; foot: ScreenPoint } | undefined;
      let bestD = DROP_PX;
      for (const e of Object.values(st.edges)) {
        const a = st.nodes[e.props.from];
        const b = st.nodes[e.props.to];
        if (skipEdges.has(e.id) || !a || !b || scopeOfNode(a) !== scopeId || scopeOfNode(b) !== scopeId) continue;
        const pts = edgeCoords(st, e).map((c) => map.project(c));
        for (let i = 0; i + 1 < pts.length; i++) {
          const f = footOnSegment(point, pts[i]!, pts[i + 1]!);
          if (f.dist <= bestD) {
            bestD = f.dist;
            best = { id: e.id, foot: f.point };
          }
        }
      }
      if (best) {
        const ll = map.unproject([best.foot.x, best.foot.y]);
        const foot: Position = [ll.lng, ll.lat];
        return { coord: foot, target: { kind: 'edge', id: best.id }, ring: foot };
      }
      return free;
    };

    const dropFor = (d: ActiveDrag, e: MapMouseEvent) =>
      dropAt(d.nodeId, e.point, [e.lngLat.lng, e.lngLat.lat], e.originalEvent.altKey);

    const frame = () => {
      if (!drag) return;
      drag.raf = null;
      const drop = dropFor(drag, drag.last);
      const st = drag.ctl.move(drop.coord);
      (map.getSource(DRAG_SOURCE) as GeoJSONSource).setData(dragGeoJSON(st, drag.nodeId, drop.ring));
    };

    const startDrag = (ctl: NodeDrag | HandleDrag, hide: readonly string[], e: MapMouseEvent) => {
      ctl.start();
      drag = { ctl, nodeId: ctl.nodeId, last: e, raf: null };
      for (const [id, filter] of hideInData(hide)) map.setFilter(id, filter ?? null);
      map.getContainer().setAttribute('data-dragging', 'true');
      drag.raf = requestAnimationFrame(frame);
    };

    const cancelDrag = () => {
      if (!drag) return;
      if (drag.raf !== null) cancelAnimationFrame(drag.raf);
      drag.ctl.cancel();
      drag = null;
      clearDragVisuals();
      latest.current.onDragEnd(null);
    };

    const endBox = (e: MapMouseEvent) => {
      if (!box) return;
      const { x, y, el } = box;
      el.remove();
      box = null;
      const [x0, x1] = [Math.min(x, e.point.x), Math.max(x, e.point.x)];
      const [y0, y1] = [Math.min(y, e.point.y), Math.max(y, e.point.y)];
      if (x1 - x0 < DRAG_PX && y1 - y0 < DRAG_PX) return;
      const inBox = (c: Position) => {
        const p = map.project(c);
        return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
      };
      const ids = Object.values(latest.current.state.nodes).filter((n) => latest.current.canPick(n) && inBox(n.coord)).map((n) => n.id);
      // An edge is in the box when both its ends are (so a box around a corridor takes its edges along).
      const picked = new Set(ids);
      for (const e of Object.values(latest.current.state.edges)) if (picked.has(e.props.from) && picked.has(e.props.to)) ids.push(e.id);
      // A building is in the box when its whole outline is (a box drawn inside a building picks only what is in it).
      for (const b of Object.values(latest.current.state.buildings)) {
        const ring = b.polygon[0] ?? [];
        if (ring.length > 0 && ring.every(inBox)) ids.push(b.id);
      }
      latest.current.onBoxSelect(ids);
    };

    map.on('mousedown', (e) => {
      if (latest.current.tool !== 'select' || e.originalEvent.button !== 0) return;
      if (e.originalEvent.shiftKey) {
        // Shift at the start: a box, not a drag (SPEC-v0.2 5.1).
        e.preventDefault();
        const el = document.createElement('div');
        el.className = 'box-select';
        el.style.cssText = `left:${e.point.x}px;top:${e.point.y}px;width:0;height:0`;
        map.getContainer().appendChild(el);
        box = { x: e.point.x, y: e.point.y, el };
        return;
      }
      const node = nearestNode(e.point, latest.current.canPick, PICK_PX);
      if (node) {
        e.preventDefault(); // the map must not pan while the node is pulled
        press = { nodeId: node.id, x: e.point.x, y: e.point.y };
        return;
      }
      // The handle in the middle of a selected edge: pulling it makes a new node there.
      const { state: st, highlight: sel } = latest.current;
      for (const id of sel) {
        const mid = st.edges[id] ? edgeMidpoint(st, id) : undefined;
        if (!mid) continue;
        const p = map.project(mid);
        if (Math.hypot(p.x - e.point.x, p.y - e.point.y) <= PICK_PX) {
          e.preventDefault();
          press = { edgeId: id, x: e.point.x, y: e.point.y };
          return;
        }
      }
    });
    map.on('mousemove', (e) => {
      if (box) {
        const x = Math.min(box.x, e.point.x);
        const y = Math.min(box.y, e.point.y);
        box.el.style.cssText = `left:${x}px;top:${y}px;width:${Math.abs(e.point.x - box.x)}px;height:${Math.abs(e.point.y - box.y)}px`;
      } else if (press && !drag && Math.hypot(e.point.x - press.x, e.point.y - press.y) >= DRAG_PX) {
        const { state: st, beginDrag, beginHandleDrag, onHandleRefused } = latest.current;
        if (press.nodeId !== undefined) {
          const { nodes, edgeIds } = dragMembers(st, press.nodeId);
          startDrag(beginDrag(press.nodeId), [...nodes.map((n) => n.id), ...edgeIds], e);
        } else {
          const made = beginHandleDrag(press.edgeId!);
          if (typeof made === 'string') onHandleRefused(made);
          else startDrag(made, [press.edgeId!], e);
        }
        press = null;
      } else if (drag) {
        drag.last = e;
        drag.raf ??= requestAnimationFrame(frame);
      }
    });
    map.on('mouseup', (e) => {
      press = null;
      endBox(e);
      if (!drag) return;
      const d = drag;
      if (d.raf !== null) cancelAnimationFrame(d.raf);
      drag = null;
      const drop = dropFor(d, e);
      const result = d.ctl.finish(drop.coord, drop.target);
      clearDragAfterData.current = true;
      latest.current.onDragEnd(result);
      window.setTimeout(() => {
        if (clearDragAfterData.current) {
          clearDragAfterData.current = false;
          clearDragVisuals();
        }
      }, 400);
    });
    // Released outside the map: the map never saw it, so put the node back.
    const onWindowUp = () => {
      press = null;
      if (box) {
        box.el.remove();
        box = null;
      }
      if (drag) cancelDrag();
    };
    // ---- the scope next to the cursor, and the preview of what a click would do (SPEC-v0.2 5.2, 6.5) ----
    const badge = document.createElement('div');
    badge.className = 'scope-badge';
    badge.hidden = true;
    map.getContainer().appendChild(badge);
    badgeEl.current = badge;
    let lastMove: MapMouseEvent | null = null;
    let moveRaf: number | null = null;
    const refreshHover = () => {
      moveRaf = null;
      const { tool, state: st, hover } = latest.current;
      if (!lastMove || !toolDef(tool).placing) {
        badge.hidden = true;
        return;
      }
      const at: Position = [lastMove.lngLat.lng, lastMove.lngLat.lat];
      const sc = pathScope.current ?? autoScope(at);
      let text = scopeLabel(sc, st);
      if (oHeld && !pathScope.current) text += ' (O)';
      const pv = hover ? hover(at, sc) : null;
      hoverShapes.current = pv?.shapes ?? null;
      pushPreview();
      if (pv?.text) text += ` · ${pv.text}`;
      badge.textContent = text;
      badge.style.left = `${lastMove.point.x + 16}px`;
      badge.style.top = `${lastMove.point.y + 16}px`;
      badge.hidden = false;
    };
    const scheduleHover = () => {
      moveRaf ??= requestAnimationFrame(refreshHover);
    };
    map.on('mousemove', (e) => {
      lastMove = e;
      scheduleHover();
    });
    map.getContainer().addEventListener('mouseleave', () => {
      lastMove = null;
      badge.hidden = true;
    });
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelDrag();
        pathScope.current = null;
      }
      if ((e.key === 'o' || e.key === 'O') && !typing(e) && !e.ctrlKey && !e.metaKey && !e.altKey && !oHeld) {
        oHeld = true;
        scheduleHover();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'o' || e.key === 'O') {
        oHeld = false;
        scheduleHover();
      }
    };
    const onBlur = () => {
      oHeld = false;
    };
    window.addEventListener('mouseup', onWindowUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    map.on('load', () => {
      map.addSource(DATA_SOURCE, { type: 'geojson', data: toDisplayGeoJSON(latest.current.state, latest.current.scope, latest.current.highlight) });
      map.addSource(ROUTE_SOURCE, { type: 'geojson', data: routesGeoJSON(latest.current.routes) });
      map.addSource(DRAG_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource(PREVIEW_SOURCE, { type: 'geojson', data: previewGeoJSON(latest.current.previewShapes) });
      registerRestroomIcons(map);
      registerBeltIcons(map);
      // Routes sit above the faded data but below the points, so the points stay clickable and readable.
      for (const layer of DATA_LAYERS) {
        if (layer.id === 'campo-nodes-highlight') for (const r of ROUTE_LAYERS) map.addLayer(r);
        map.addLayer(layer);
      }
      for (const layer of PREVIEW_LAYERS) map.addLayer(layer);
      for (const layer of DRAG_LAYERS) map.addLayer(layer);

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawLineStringMode({
            snapping: {
              toCustom: (ev: TerraDrawMouseEvent) => {
                const sc = pathScope.current ?? autoScope([ev.lng, ev.lat]);
                return snapPath({ x: ev.containerX, y: ev.containerY }, sc)?.coord;
              },
            },
            styles: lineStyles(KIND_COLOR.flat),
          }),
          new TerraDrawPolygonMode({
            styles: {
              fillColor: '#1e2933',
              fillOpacity: 0.08,
              outlineColor: '#1e2933',
              outlineWidth: 2,
              closingPointColor: '#ffffff',
              closingPointOutlineColor: '#1e2933',
              closingPointWidth: 6,
              closingPointOutlineWidth: 2,
            },
          }),
        ],
      });
      draw.start();
      // Terra Draw is only the pen: when a shape is finished it goes to the edit engine and leaves Terra Draw's store.
      draw.on('finish', (id) => {
        const drawn = draw.getSnapshotFeature(id);
        draw.removeFeatures([id]);
        if (drawn?.geometry.type === 'LineString') {
          const coords = drawn.geometry.coordinates as Position[];
          const sc = pathScope.current ?? autoScope(coords[0]!);
          pathScope.current = null;
          const vertices = coords.map((position): PathVertex => {
            const node = snapPath(map.project(position), sc);
            return node ? { nodeId: node.id } : { position: [position[0], position[1]] };
          });
          latest.current.onPathDrawn(vertices, sc);
        } else if (drawn?.geometry.type === 'Polygon') {
          latest.current.onPolygonDrawn((drawn.geometry.coordinates[0] as Position[]).map(([x, y]) => [x, y]));
        }
      });
      drawRef.current = draw;
      const queued = pending.current ?? [];
      pending.current = null;
      for (const fn of queued) fn(map);
    });

    return () => {
      window.removeEventListener('mouseup', onWindowUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (moveRaf !== null) cancelAnimationFrame(moveRaf);
      drawRef.current?.stop();
      drawRef.current = null;
      pending.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    whenReady((map) => {
      (map.getSource(DATA_SOURCE) as GeoJSONSource).setData(toDisplayGeoJSON(state, scope, highlight));
      if (clearDragAfterData.current) {
        // The new state is on its way to the main source: drop the temporary one once it has been drawn.
        map.once('idle', () => {
          if (!clearDragAfterData.current) return;
          clearDragAfterData.current = false;
          for (const [id, filter] of hideInData([])) map.setFilter(id, filter ?? null);
          (map.getSource(DRAG_SOURCE) as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
          map.getContainer().removeAttribute('data-dragging');
        });
      }
    });
  }, [state, scope, highlight]);

  useEffect(() => {
    whenReady((map) => (map.getSource(ROUTE_SOURCE) as GeoJSONSource).setData(routesGeoJSON(routes)));
  }, [routes]);

  useEffect(() => {
    if (focus) whenReady((map) => map.flyTo({ center: focus.position, zoom: Math.max(map.getZoom(), 19), duration: 600 }));
  }, [focus]);

  useEffect(() => {
    whenReady(() => drawRef.current?.setMode(DRAW_MODE[tool] ?? 'static'));
    pathScope.current = null;
    hoverShapes.current = null;
    if (badgeEl.current) badgeEl.current.hidden = true;
    pushPreview();
  }, [tool]);

  useEffect(() => {
    pushPreview();
  }, [props.previewShapes]);

  useEffect(() => {
    whenReady(() => drawRef.current?.setModeStyles('linestring', lineStyles(KIND_COLOR[outdoorKind])));
  }, [outdoorKind]);

  useEffect(() => {
    whenReady((map) => {
      for (const b of basemaps()) {
        if (b.source) map.setLayoutProperty(`basemap-${b.id}`, 'visibility', b.id === basemap ? 'visible' : 'none');
      }
    });
  }, [basemap]);

  return (
    <div
      ref={container}
      className="map"
      data-tool={tool}
      role="application"
      aria-label="캠퍼스 지도. 도구를 고른 뒤 지도를 눌러 그립니다."
    />
  );
}

function baseStyle(): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [{ id: 'paper', type: 'background', paint: { 'background-color': '#e9edf0' } }],
  };
  for (const b of basemaps()) {
    if (!b.source) continue;
    style.sources[`basemap-${b.id}`] = b.source;
    style.layers.push({
      id: `basemap-${b.id}`,
      type: 'raster',
      source: `basemap-${b.id}`,
      layout: { visibility: b.id === 'osm' ? 'visible' : 'none' },
      // The background is for orientation; desaturate it so the drawn data reads first.
      paint: b.id === 'osm' ? { 'raster-saturation': -0.6, 'raster-opacity': 0.85 } : {},
    });
  }
  return style;
}

function lineStyles(color: string) {
  const hex = color as `#${string}`;
  return {
    lineStringColor: hex,
    lineStringWidth: 4,
    closingPointColor: '#ffffff' as const,
    closingPointOutlineColor: hex,
    closingPointWidth: 6,
    closingPointOutlineWidth: 2,
    snappingPointColor: '#ffffff' as const,
    snappingPointOutlineColor: '#1e2933' as const,
    snappingPointWidth: 7,
    snappingPointOutlineWidth: 3,
  };
}
