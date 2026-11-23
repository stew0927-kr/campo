import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildingHeightM,
  classifyArea,
  classifyHighway,
  cleanRing,
  convertOverpass,
  DEFAULT_BUILDING_HEIGHT_M,
  stitchRings,
} from '../src/convert.ts';
import { buildOverpassQuery } from '../src/overpass.ts';
import { buildSketchStyle } from '../src/style.ts';
import type { Bbox, OverpassJson, SketchFeature } from '../src/types.ts';

const BBOX: Bbox = [127.0395, 37.553, 127.0505, 37.5615];
const sample = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/sample-overpass.json', import.meta.url)), 'utf8'),
) as OverpassJson;
const { collection, stats } = convertOverpass(sample, { bbox: BBOX });
const byId = (id: string): SketchFeature => {
  const f = collection.features.find((x) => x.properties.osm_id === id);
  if (!f) throw new Error(`missing ${id}`);
  return f;
};

describe('POI filtering', () => {
  it('drops POI nodes, non-sketch ways, degenerate shapes and features outside the bbox', () => {
    const ids = collection.features.map((f) => f.properties.osm_id);
    expect(ids.some((i) => i.startsWith('node/'))).toBe(false);
    for (const gone of ['way/4', 'way/14', 'way/15', 'way/31', 'way/32', 'way/40']) {
      expect(ids).not.toContain(gone);
    }
    expect(stats.dropped).toBeGreaterThanOrEqual(6);
  });

  it('only emits known kinds and never copies POI tags', () => {
    const kinds = new Set(['building', 'road', 'footway', 'steps', 'green', 'water']);
    for (const f of collection.features) {
      expect(kinds.has(f.properties.kind)).toBe(true);
      expect(Object.keys(f.properties).every((k) => ['kind', 'osm_id', 'name', 'height_m', 'levels'].includes(k))).toBe(true);
    }
  });
});

describe('building height', () => {
  it('uses levels x 3 m', () => {
    expect(buildingHeightM({ 'building:levels': '5' })).toBe(15);
    expect(byId('way/1').properties.height_m).toBe(15);
    expect(byId('relation/50').properties.height_m).toBe(9);
  });
  it('prefers an explicit height tag', () => {
    expect(buildingHeightM({ height: '12.5 m', 'building:levels': '2' })).toBe(12.5);
  });
  it('falls back to the default for missing or unusable values', () => {
    expect(buildingHeightM({})).toBe(DEFAULT_BUILDING_HEIGHT_M);
    expect(buildingHeightM({ 'building:levels': 'many' })).toBe(DEFAULT_BUILDING_HEIGHT_M);
    expect(buildingHeightM({ 'building:levels': '0' })).toBe(DEFAULT_BUILDING_HEIGHT_M);
  });
  it('caps absurd heights', () => {
    expect(buildingHeightM({ 'building:levels': '9999' })).toBe(300);
  });
  it('prefers name:ko over name', () => {
    expect(byId('way/1').properties.name).toBe('한양대 본관');
  });
});

describe('highway and area classification', () => {
  it('maps highways to road / footway / steps', () => {
    expect(classifyHighway({ highway: 'residential' })).toBe('road');
    expect(classifyHighway({ highway: 'service' })).toBe('road');
    expect(classifyHighway({ highway: 'footway' })).toBe('footway');
    expect(classifyHighway({ highway: 'pedestrian' })).toBe('footway');
    expect(classifyHighway({ highway: 'steps' })).toBe('steps');
    expect(classifyHighway({ highway: 'bus_stop' })).toBeUndefined();
    expect(classifyHighway({ highway: 'corridor' })).toBeUndefined();
    expect(classifyHighway({})).toBeUndefined();
  });
  it('classifies the sample ways', () => {
    expect(byId('way/10').properties.kind).toBe('road');
    expect(byId('way/11').properties.kind).toBe('footway');
    expect(byId('way/12').properties.kind).toBe('steps');
  });
  it('maps green and water areas', () => {
    for (const t of [{ landuse: 'grass' }, { landuse: 'forest' }, { leisure: 'park' }, { leisure: 'garden' }, { natural: 'wood' }]) {
      expect(classifyArea(t)).toBe('green');
    }
    expect(classifyArea({ natural: 'water' })).toBe('water');
    expect(classifyArea({ landuse: 'retail' })).toBeUndefined();
    expect(byId('way/20').properties.kind).toBe('green');
    expect(byId('way/21').properties.kind).toBe('water');
  });
});

describe('geometry cleanup', () => {
  it('rounds to 6 decimals and removes duplicate points', () => {
    expect(byId('way/10').geometry).toEqual({
      type: 'LineString',
      coordinates: [[127.04, 37.555], [127.042, 37.5551]],
    });
  });
  it('closes open rings and winds outer rings counter-clockwise', () => {
    const ring = cleanRing([[0, 0], [0, 1], [1, 1], [1, 0]], true)!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  });
  it('rejects zero-area rings', () => {
    expect(cleanRing([[0, 0], [1, 1], [2, 2]], true)).toBeUndefined();
  });
  it('stitches multipolygon members and keeps holes', () => {
    const f = byId('relation/50');
    expect(f.geometry.type).toBe('Polygon');
    expect(f.geometry.coordinates).toHaveLength(2);
    expect(stitchRings([[[0, 0], [1, 0]], [[1, 0], [1, 1], [0, 0]]])).toHaveLength(1);
  });
  it('resolves way geometry from node ids when `geometry` is absent', () => {
    const json: OverpassJson = {
      elements: [
        { type: 'node', id: 1, lat: 37.556, lon: 127.044 },
        { type: 'node', id: 2, lat: 37.556, lon: 127.045 },
        { type: 'node', id: 3, lat: 37.557, lon: 127.045 },
        { type: 'way', id: 9, nodes: [1, 2, 3, 1], tags: { building: 'yes' } },
      ],
    };
    expect(convertOverpass(json).collection.features).toHaveLength(1);
  });
});

describe('outputs', () => {
  it('produces a valid FeatureCollection, deterministically', () => {
    expect(collection.type).toBe('FeatureCollection');
    expect(convertOverpass(sample, { bbox: BBOX }).collection).toEqual(collection);
    expect(stats.kept).toEqual({ building: 5, road: 2, footway: 1, steps: 1, green: 2, water: 1 });
  });
  it('builds a flat 2D base style whose layers all point at the sketch source', () => {
    const style = buildSketchStyle({ center: [127.045, 37.557] });
    expect(style.version).toBe(8);
    const ids = style.layers.map((l) => l.id);
    expect(ids).toEqual(['background', 'water', 'green', 'road-casing', 'road', 'building-flat', 'building-outline']);
    for (const l of style.layers) if (l.type !== 'background') expect(Object.keys(style.sources)).toContain(l.source);
    expect(style.sources['campo-sketch'].attribution).toContain('OpenStreetMap');
  });
  it('draws no 3D extrusion and no OSM footway/steps layers', () => {
    const style = buildSketchStyle();
    expect(style.layers.map((l) => l.type)).not.toContain('fill-extrusion');
    expect(style.layers.map((l) => l.id)).not.toEqual(expect.arrayContaining(['footway']));
    expect(style.layers.map((l) => l.id)).not.toEqual(expect.arrayContaining(['steps']));
    const json = JSON.stringify(style);
    expect(json).not.toContain('"footway"');
    expect(json).not.toContain('"steps"');
    expect(json).not.toContain('height_m');
  });
  it('shows flat buildings at every zoom level', () => {
    const style = buildSketchStyle();
    const flat = style.layers.find((l) => l.id === 'building-flat') as Record<string, unknown>;
    expect(flat.type).toBe('fill');
    expect(flat).not.toHaveProperty('minzoom');
    expect(flat).not.toHaveProperty('maxzoom');
    const outline = style.layers.find((l) => l.id === 'building-outline') as Record<string, unknown>;
    expect(outline).not.toHaveProperty('minzoom');
    expect(outline).not.toHaveProperty('maxzoom');
  });
  it('keeps the agreed flat-base palette', () => {
    const style = buildSketchStyle();
    const color = (id: string) => {
      const paint = (style.layers.find((l) => l.id === id) as { paint: Record<string, unknown> }).paint;
      return paint['background-color'] ?? paint['fill-color'] ?? paint['line-color'];
    };
    expect(color('background')).toBe('#f4f1ea');
    expect(color('water')).toBe('#cfe3f2');
    expect(color('green')).toBe('#e1edd4');
    expect(color('road-casing')).toBe('#e0dbd0');
    expect(color('road')).toBe('#ffffff');
    expect(color('building-flat')).toBe('#e7e2d8');
    expect(color('building-outline')).toBe('#d2ccc0');
  });
  it('still keeps footway/steps/height data in the GeoJSON for optional use', () => {
    const kinds = new Set(collection.features.map((f) => f.properties.kind));
    expect(kinds).toContain('footway');
    expect(kinds).toContain('steps');
    expect(collection.features.some((f) => f.properties.height_m != null)).toBe(true);
  });
  it('builds an Overpass query in south,west,north,east order', () => {
    expect(buildOverpassQuery(BBOX)).toContain('(37.553,127.0395,37.5615,127.0505)');
  });
});
