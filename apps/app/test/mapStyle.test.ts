import { describe, expect, it } from 'vitest';
import { CAMPUS_SKETCH_STYLE, OSM_ATTRIBUTION, OSM_RASTER_STYLE } from '../src/map/style.ts';

const layers = CAMPUS_SKETCH_STYLE.layers;
const ids = layers.map((l) => l.id);
const byId = (id: string) => layers.find((l) => l.id === id) as Record<string, unknown> | undefined;

describe('campus 2D flat map style', () => {
  it('is a v8 style with a single OpenFreeMap vector source and glyphs', () => {
    expect(CAMPUS_SKETCH_STYLE.version).toBe(8);
    const sources = Object.values(CAMPUS_SKETCH_STYLE.sources);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
    expect(CAMPUS_SKETCH_STYLE.glyphs).toBe('https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
  });

  it('keeps the legacy alias and the attribution', () => {
    expect(OSM_RASTER_STYLE).toBe(CAMPUS_SKETCH_STYLE);
    expect(OSM_ATTRIBUTION).toBe('© OpenStreetMap 기여자 · OpenFreeMap');
  });

  it('has the flat layers and none of the 3D or walkway layers', () => {
    for (const id of ['background', 'landcover', 'landuse', 'park', 'water', 'waterway', 'road-minor', 'road-major', 'building', 'building-outline', 'road-name', 'campus-name']) {
      expect(ids).toContain(id);
    }
    for (const id of ['building-3d', 'walkway', 'walkway-steps']) expect(ids).not.toContain(id);
    expect(layers.some((l) => l.type === 'fill-extrusion')).toBe(false);
    expect(byId('background')).toMatchObject({ paint: { 'background-color': '#F6F7F4' } });
  });

  it('keeps flat buildings at every zoom from 14 up', () => {
    expect(byId('building')).toMatchObject({ type: 'fill', minzoom: 14 });
    expect(byId('building-outline')).toMatchObject({ type: 'line', minzoom: 14 });
    expect(byId('building')).not.toHaveProperty('maxzoom');
    expect(byId('building-outline')).not.toHaveProperty('maxzoom');
  });

  it('has no raster source and no direct OSM raster tile call', () => {
    const json = JSON.stringify(CAMPUS_SKETCH_STYLE);
    expect(json).not.toMatch(/tile\.openstreetmap/);
    expect(json).not.toContain('{z}/{x}/{y}');
    expect(json).not.toContain('"raster"');
    expect(layers.some((l) => l.type === 'raster')).toBe(false);
  });

  it('has unique layer ids and only references existing sources', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of layers) {
      if ('source' in l && l.source) expect(CAMPUS_SKETCH_STYLE.sources).toHaveProperty(l.source);
    }
  });

  it('has only the road-name and campus-name labels and no icons', () => {
    const symbols = layers.filter((l) => l.type === 'symbol');
    expect(symbols.map((l) => l.id).sort()).toEqual(['campus-name', 'road-name']);
    for (const l of symbols) expect(l.layout).not.toHaveProperty('icon-image');
  });
});
