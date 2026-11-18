// 2D edge width (map/layers.ts): metres → pixels for MapLibre's 512 px tiles, the effective width on each edge feature,
// and the width band drawn under the selected edges.
import { describe, expect, it } from 'vitest';
import { DATA_LAYERS, edgeWidthLineWidth, pxPerMeter, toDisplayGeoJSON } from '../src/map/layers.ts';
import { fixtureSession } from './fixture.ts';

const HANYANG_LAT = 37.5557;

describe('pxPerMeter', () => {
  it('is 1 / 0.2367043… at zoom 18 on the Hanyang latitude', () => {
    const mpp = (40075016.686 * Math.cos((HANYANG_LAT * Math.PI) / 180)) / (512 * 2 ** 18);
    expect(mpp).toBeCloseTo(0.2367043, 7);
    const px = pxPerMeter(18, HANYANG_LAT);
    expect(Math.abs(px - 1 / mpp) / (1 / mpp)).toBeLessThan(1e-9);
  });

  it('doubles with each zoom level', () => {
    expect(Math.abs(pxPerMeter(19, HANYANG_LAT) - 2 * pxPerMeter(18, HANYANG_LAT))).toBeLessThan(1e-12);
  });
});

describe('edge width on the map', () => {
  it('every edge feature carries its effective width (2.0 m when width_m is missing)', () => {
    const state = fixtureSession().history.current();
    const fc = toDisplayGeoJSON(state, { kind: 'outdoor' });
    const width = (id: string) => fc.features.find((f) => f.id === id)!.properties!['width_m'];
    expect(width('e_out_0001__out_0006')).toBe(3);
    expect(width('e_out_0001__out_0002')).toBe(2);
  });

  it('the line-width expression is width_m × px per metre at zoom 14 and 22, exponential base 2', () => {
    expect(edgeWidthLineWidth(HANYANG_LAT)).toEqual([
      'interpolate', ['exponential', 2], ['zoom'],
      14, ['*', ['get', 'width_m'], pxPerMeter(14, HANYANG_LAT)],
      22, ['*', ['get', 'width_m'], pxPerMeter(22, HANYANG_LAT)],
    ]);
  });

  it('a width band layer sits under the edge lines, shows selected edges only, at opacity 0.25', () => {
    const ids = DATA_LAYERS.map((l) => l.id);
    const band = DATA_LAYERS.find((l) => l.id === 'campo-edges-width') as { filter: unknown; paint: Record<string, unknown> } | undefined;
    expect(band).toBeDefined();
    expect(ids.indexOf('campo-edges-width')).toBeLessThan(ids.indexOf('campo-edges-casing'));
    expect(JSON.stringify(band!.filter)).toContain('"highlight"');
    expect(band!.paint['line-opacity']).toBe(0.25);
    expect(band!.paint['line-width']).toEqual(edgeWidthLineWidth(HANYANG_LAT));
  });
});
