// MapLibre style preset for campus-sketch.geojson: flat 2D base map (B안).
// Only background, water, green, roads (casing + fill) and flat buildings are drawn, so the team's own
// surveyed paths and flat-ground layers can be stacked on top. No 3D extrusion, and OSM footway/steps
// are NOT drawn (they stay in the GeoJSON for optional use: add a layer filtered on kindIs('footway'|'steps')).
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
        paint: { 'fill-color': '#cfe3f2' },
      },
      {
        id: 'green', type: 'fill', source: src, filter: kindIs('green'),
        paint: { 'fill-color': '#e1edd4' },
      },
      {
        id: 'road-casing', type: 'line', source: src, filter: kindIs('road'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#e0dbd0', 'line-width': widths(3, 8, 28) },
      },
      {
        id: 'road', type: 'line', source: src, filter: kindIs('road'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': widths(2, 6, 24) },
      },
      {
        id: 'building-flat', type: 'fill', source: src, filter: kindIs('building'),
        paint: { 'fill-color': '#e7e2d8' },
      },
      {
        id: 'building-outline', type: 'line', source: src, filter: kindIs('building'),
        paint: { 'line-color': '#d2ccc0', 'line-width': widths(0.6, 1, 1.5) },
      },
    ],
  };
}
