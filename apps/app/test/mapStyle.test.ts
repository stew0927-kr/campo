import { describe, expect, it } from 'vitest';
import { CAMPUS_SKETCH_STYLE, OSM_ATTRIBUTION, OSM_RASTER_STYLE } from '../src/map/style.ts';

const layers = CAMPUS_SKETCH_STYLE.layers;
const ids = layers.map((l) => l.id);

describe('campus sketch map style', () => {
  it('is a v8 style with the OpenFreeMap vector source', () => {
    expect(CAMPUS_SKETCH_STYLE.version).toBe(8);
    const src = Object.values(CAMPUS_SKETCH_STYLE.sources);
    expect(src).toHaveLength(1);
    expect(src[0]).toMatchObject({ type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
    expect(CAMPUS_SKETCH_STYLE.glyphs).toBe('https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
  });

  it('keeps the legacy exports', () => {
    expect(OSM_RASTER_STYLE).toBe(CAMPUS_SKETCH_STYLE);
    expect(OSM_ATTRIBUTION).toContain('OpenStreetMap');
    expect(OSM_ATTRIBUTION).toContain('OpenFreeMap');
  });

  it('has the core sketch layers', () => {
    for (const id of ['background', 'park', 'water', 'waterway', 'road-major', 'walkway', 'building', 'building-3d']) {
      expect(ids).toContain(id);
    }
    expect(layers.find((l) => l.id === 'background')).toMatchObject({ paint: { 'background-color': '#F6F7F4' } });
    expect(layers.find((l) => l.id === 'building-3d')).toMatchObject({ type: 'fill-extrusion', minzoom: 16 });
  });

  it('has unique layer ids and only references existing sources', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of layers) {
      if ('source' in l && l.source) expect(CAMPUS_SKETCH_STYLE.sources).toHaveProperty(l.source);
    }
  });

  it('has no POI icons and only road/campus labels', () => {
    for (const l of layers) {
      if (l.type !== 'symbol') continue;
      expect(l.layout).not.toHaveProperty('icon-image');
      expect(['road-name', 'campus-name']).toContain(l.id);
    }
    const poi = layers.filter((l) => 'source-layer' in l && l['source-layer'] === 'poi');
    expect(poi.map((l) => l.id)).toEqual(['campus-name']);
    expect(JSON.stringify((poi[0] as { filter?: unknown }).filter)).not.toMatch(/shop|cafe|restaurant|bus|atm/);
  });
});
