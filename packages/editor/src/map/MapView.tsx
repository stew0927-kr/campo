import { useEffect, useRef } from 'react';
import { Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TerraDraw, TerraDrawLineStringMode, type TerraDrawMouseEvent } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { NodeFeature, Position } from '@campo/core';
import type { CampusDoc } from '../model/document.ts';
import type { OutdoorKind, PathVertex } from '../model/outdoor-path.ts';
import { nearestWithin, type ScreenPoint } from '../model/snap.ts';
import type { Tool } from '../ui/ui-state.ts';
import { basemaps, type BasemapId } from './basemaps.ts';
import { DATA_LAYERS, DATA_SOURCE, WAY_COLORS, toDisplayGeoJSON } from './layers.ts';

interface Props {
  doc: CampusDoc;
  tool: Tool;
  outdoorKind: OutdoorKind;
  basemap: BasemapId;
  onPathDrawn: (vertices: PathVertex[]) => void;
}

// Vite pre-bundles maplibre-gl, which breaks the worker's relative URL; point MapLibre at the file directly.
setWorkerUrl(workerUrl);

const KIND_COLOR: Record<OutdoorKind, string> = { flat: WAY_COLORS.footway, steps: WAY_COLORS.steps, ramp: WAY_COLORS.ramp };

export function MapView({ doc, tool, outdoorKind, basemap, onPathDrawn }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  /** Work queued by the effects below until the map and Terra Draw are set up. */
  const pending = useRef<((map: MapLibreMap) => void)[] | null>([]);
  const whenReady = (fn: (map: MapLibreMap) => void) => {
    if (pending.current) pending.current.push(fn);
    else if (mapRef.current) fn(mapRef.current);
  };
  // Terra Draw callbacks are registered once; they read the latest props through refs.
  const docRef = useRef(doc);
  const onPathDrawnRef = useRef(onPathDrawn);
  docRef.current = doc;
  onPathDrawnRef.current = onPathDrawn;

  useEffect(() => {
    const map = new MapLibreMap({
      container: container.current!,
      style: baseStyle(),
      center: doc.meta.center,
      zoom: 17,
      attributionControl: { compact: false },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    mapRef.current = map;

    /** Outdoor nodes within SNAP_PX of a screen point (the 바깥 길 tool attaches only to outdoor points). */
    const snapNode = (point: ScreenPoint): NodeFeature | undefined => {
      const candidates = [...docRef.current.features.values()]
        .filter((f): f is NodeFeature => f.properties.kind === 'node' && f.properties.building_id === null)
        .map((node) => ({ node, screen: map.project(node.geometry.coordinates) }));
      return nearestWithin(candidates, point)?.node;
    };

    map.on('load', () => {
      map.addSource(DATA_SOURCE, { type: 'geojson', data: toDisplayGeoJSON(docRef.current) });
      for (const layer of DATA_LAYERS) map.addLayer(layer);

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawLineStringMode({
            snapping: {
              toCustom: (event: TerraDrawMouseEvent) =>
                snapNode({ x: event.containerX, y: event.containerY })?.geometry.coordinates,
            },
            styles: lineStyles(KIND_COLOR.flat),
          }),
        ],
      });
      draw.start();
      draw.on('finish', (id) => {
        const drawn = draw.getSnapshotFeature(id);
        draw.removeFeatures([id]); // the saved data is drawn by our own layers
        if (drawn?.geometry.type !== 'LineString') return;
        const vertices = (drawn.geometry.coordinates as Position[]).map((position): PathVertex => {
          const node = snapNode(map.project(position));
          return node ? { nodeId: node.id } : { position: [position[0], position[1]] };
        });
        onPathDrawnRef.current(vertices);
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
    // The map is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    whenReady((map) => (map.getSource(DATA_SOURCE) as GeoJSONSource).setData(toDisplayGeoJSON(doc)));
  }, [doc]);

  useEffect(() => {
    whenReady(() => drawRef.current?.setMode(tool === 'outdoor-path' ? 'linestring' : 'static'));
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
      aria-label="캠퍼스 지도. 바깥 길 도구를 고르면 클릭해서 길을 그릴 수 있습니다."
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
