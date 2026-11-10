import { useEffect, useRef } from 'react';
import { Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TerraDraw, TerraDrawLineStringMode, TerraDrawPolygonMode, type TerraDrawMouseEvent } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { EdgeFeature, NodeFeature, Position } from '@campo/core';
import type { CampusDoc } from '../model/document.ts';
import type { OutdoorKind, PathVertex } from '../model/outdoor-path.ts';
import { inScope, type Scope } from '../model/scope.ts';
import { distanceToSegment, nearestWithin, type ScreenPoint } from '../model/snap.ts';
import type { Tool } from '../ui/ui-state.ts';
import { basemaps, type BasemapId } from './basemaps.ts';
import { DATA_LAYERS, DATA_SOURCE, ROUTE_LAYERS, ROUTE_SOURCE, WAY_COLORS, routesGeoJSON, toDisplayGeoJSON, type RouteLine } from './layers.ts';

/** Clicking within this many pixels of a node picks it (잇기). Larger than the 5px snap: it is a pick, not a placement. */
const PICK_PX = 10;

export interface MapClick {
  position: Position;
  /** Nearest pickable node within PICK_PX, if any. */
  node: NodeFeature | undefined;
  /** Nearest edge drawn strongly in this scope within PICK_PX, when no node was hit. */
  edge: EdgeFeature | undefined;
}

/** A request to move the map; `seq` changes on every request so the same place can be asked for twice. */
export interface FocusRequest {
  position: Position;
  seq: number;
}

interface Props {
  doc: CampusDoc;
  tool: Tool;
  outdoorKind: OutdoorKind;
  basemap: BasemapId;
  scope: Scope;
  highlight: ReadonlySet<string>;
  /** Which nodes a click may pick right now (e.g. outdoor points for the second click of 포탈). */
  canPick: (node: NodeFeature) => boolean;
  routes: RouteLine[];
  focus: FocusRequest | null;
  onPathDrawn: (vertices: PathVertex[]) => void;
  onPolygonDrawn: (ring: Position[]) => void;
  onMapClick: (click: MapClick) => void;
}

// Vite pre-bundles maplibre-gl, which breaks the worker's relative URL; point MapLibre at the file directly.
setWorkerUrl(workerUrl);

const KIND_COLOR: Record<OutdoorKind, string> = { flat: WAY_COLORS.footway, steps: WAY_COLORS.steps, ramp: WAY_COLORS.ramp };
const DRAW_MODE: Partial<Record<Tool, string>> = { 'outdoor-path': 'linestring', building: 'polygon' };

export function MapView(props: Props) {
  const { doc, tool, outdoorKind, basemap, scope, highlight, routes, focus } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  /** Work queued by the effects below until the map and Terra Draw are set up. */
  const pending = useRef<((map: MapLibreMap) => void)[] | null>([]);
  const whenReady = (fn: (map: MapLibreMap) => void) => {
    if (pending.current) pending.current.push(fn);
    else if (mapRef.current) fn(mapRef.current);
  };
  // Map and Terra Draw callbacks are registered once; they read the latest props through this ref.
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const map = new MapLibreMap({
      container: container.current!,
      style: baseStyle(),
      center: latest.current.doc.meta.center,
      zoom: 17,
      attributionControl: { compact: false },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    mapRef.current = map;

    const nearestNode = (point: ScreenPoint, accept: (n: NodeFeature) => boolean, maxPx?: number) => {
      const candidates = [...latest.current.doc.features.values()]
        .filter((f): f is NodeFeature => f.properties.kind === 'node' && accept(f as NodeFeature))
        .map((node) => ({ node, screen: map.project(node.geometry.coordinates) }));
      return nearestWithin(candidates, point, maxPx)?.node;
    };
    /** The 바깥 길 tool attaches only to outdoor points, within SNAP_PX. */
    const snapOutdoor = (point: ScreenPoint) => nearestNode(point, (n) => n.properties.building_id === null);

    map.on('click', (e) => {
      if (DRAW_MODE[latest.current.tool]) return; // Terra Draw owns clicks while drawing
      const { doc: d, scope: sc, canPick } = latest.current;
      const node = nearestNode(e.point, canPick, PICK_PX);
      let edge: EdgeFeature | undefined;
      if (!node) {
        let best = PICK_PX;
        for (const f of d.features.values()) {
          if (f.properties.kind !== 'edge' || !inScope(f, sc, d)) continue;
          const pts = (f as EdgeFeature).geometry.coordinates.map((c) => map.project(c));
          for (let i = 0; i + 1 < pts.length; i++) {
            const dist = distanceToSegment(e.point, pts[i]!, pts[i + 1]!);
            if (dist <= best) {
              best = dist;
              edge = f as EdgeFeature;
            }
          }
        }
      }
      latest.current.onMapClick({ position: [e.lngLat.lng, e.lngLat.lat], node, edge });
    });

    map.on('load', () => {
      map.addSource(DATA_SOURCE, { type: 'geojson', data: toDisplayGeoJSON(latest.current.doc, latest.current.scope) });
      map.addSource(ROUTE_SOURCE, { type: 'geojson', data: routesGeoJSON(latest.current.routes) });
      // Routes sit above the faded data but below the points, so the points stay clickable and readable.
      for (const layer of DATA_LAYERS) {
        if (layer.id === 'campo-nodes-highlight') for (const r of ROUTE_LAYERS) map.addLayer(r);
        map.addLayer(layer);
      }

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawLineStringMode({
            snapping: { toCustom: (ev: TerraDrawMouseEvent) => snapOutdoor({ x: ev.containerX, y: ev.containerY })?.geometry.coordinates },
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
      draw.on('finish', (id) => {
        const drawn = draw.getSnapshotFeature(id);
        draw.removeFeatures([id]); // the saved data is drawn by our own layers
        if (drawn?.geometry.type === 'LineString') {
          const vertices = (drawn.geometry.coordinates as Position[]).map((position): PathVertex => {
            const node = snapOutdoor(map.project(position));
            return node ? { nodeId: node.id } : { position: [position[0], position[1]] };
          });
          latest.current.onPathDrawn(vertices);
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
      drawRef.current?.stop();
      drawRef.current = null;
      pending.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    whenReady((map) => (map.getSource(DATA_SOURCE) as GeoJSONSource).setData(toDisplayGeoJSON(doc, scope, highlight)));
  }, [doc, scope, highlight]);

  useEffect(() => {
    whenReady((map) => (map.getSource(ROUTE_SOURCE) as GeoJSONSource).setData(routesGeoJSON(routes)));
  }, [routes]);

  useEffect(() => {
    if (focus) whenReady((map) => map.flyTo({ center: focus.position, zoom: Math.max(map.getZoom(), 19), duration: 600 }));
  }, [focus]);

  useEffect(() => {
    whenReady(() => drawRef.current?.setMode(DRAW_MODE[tool] ?? 'static'));
  }, [tool]);

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
