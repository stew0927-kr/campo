// MapLibre style preset (light, Naver-like sketch tone) for campus-sketch.geojson.
export const SKETCH_SOURCE_ID = 'campo-sketch';
export const OSM_ATTRIBUTION = '© OpenStreetMap 기여자';

export interface StyleOptions {
  /** URL (or relative path) MapLibre loads the GeoJSON from. Apps may replace it with the object itself. */
  dataUrl?: string;
  center?: [number, number];
}

const kindIs = (k: string) => ['==', ['get', 'kind'], k];
const widths = (z15: number, z17: number, z20: number) =>
  ['interpolate', ['exponential', 1.6], ['zoom'], 15, z15, 17, z17, 20, z20];

export function buildSketchStyle(opts: StyleOptions = {}) {
  const dataUrl = opts.dataUrl ?? './campus-sketch.geojson';
  const src = SKETCH_SOURCE_ID;
  return {
    version: 8 as const,
    name: '캠포 캠퍼스 약도',
    ...(opts.center ? { center: opts.center, zoom: 16.5 } : {}),
    sources: {
      [src]: { type: 'geojson' as const, data: dataUrl, attribution: OSM_ATTRIBUTION },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f4f1ea' } },
      {
        id: 'water', type: 'fill', source: src, filter: kindIs('water'),
        paint: { 'fill-color': '#c9dff0' },
      },
      {
        id: 'green', type: 'fill', source: src, filter: kindIs('green'),
        paint: { 'fill-color': '#dbe9cc' },
      },
      {
        id: 'road-casing', type: 'line', source: src, filter: kindIs('road'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#d8d2c4', 'line-width': widths(3, 8, 28) },
      },
      {
        id: 'road', type: 'line', source: src, filter: kindIs('road'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': widths(2, 6, 24) },
      },
      {
        id: 'footway', type: 'line', source: src, filter: kindIs('footway'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#e3c9a0',
          'line-width': widths(1, 2, 7),
          'line-dasharray': [2, 1.5],
        },
      },
      {
        id: 'steps', type: 'line', source: src, filter: kindIs('steps'),
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': '#c98f5a',
          'line-width': widths(1.5, 3, 8),
          'line-dasharray': [0.5, 0.7],
        },
      },
      {
        id: 'building-outline', type: 'line', source: src, filter: kindIs('building'),
        paint: { 'line-color': '#c9c1b2', 'line-width': widths(0.6, 1, 1.5) },
      },
      {
        id: 'building-flat', type: 'fill', source: src, filter: kindIs('building'),
        maxzoom: 16,
        paint: { 'fill-color': '#e6e0d4' },
      },
      {
        id: 'building-3d', type: 'fill-extrusion', source: src, filter: kindIs('building'),
        minzoom: 16,
        paint: {
          'fill-extrusion-color': '#e9e3d7',
          'fill-extrusion-height': ['coalesce', ['get', 'height_m'], 6],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.92,
        },
      },
    ],
  };
}
