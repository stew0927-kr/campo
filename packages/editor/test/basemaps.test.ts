import { describe, expect, it } from 'vitest';
import { basemaps } from '../src/map/basemaps.ts';

const env = (vars: Record<string, string>) => vars as unknown as ImportMetaEnv;

describe('배경 지도', () => {
  it('OSM and 브이월드 only: the 국토지리정보원 option is gone', () => {
    expect(basemaps(env({})).map((b) => b.id)).toEqual(['osm', 'vworld']);
  });

  it('without VITE_VWORLD_API_KEY the 브이월드 option is off and says where the key goes', () => {
    const v = basemaps(env({})).find((b) => b.id === 'vworld')!;
    expect(v.label).toBe('브이월드 위성지도');
    expect(v.source).toBeNull();
    expect(v.unavailableReason).toContain('VITE_VWORLD_API_KEY');
  });

  it('with a key the WMTS satellite tiles are used (max zoom 19, 출처 표시)', () => {
    const v = basemaps(env({ VITE_VWORLD_API_KEY: ' ABC-123 ' })).find((b) => b.id === 'vworld')!;
    expect(v.source).toMatchObject({
      type: 'raster',
      tiles: ['https://api.vworld.kr/req/wmts/1.0.0/ABC-123/Satellite/{z}/{y}/{x}.jpeg'],
      maxzoom: 19,
      attribution: '© 국토교통부 브이월드',
    });
    expect(v.unavailableReason).toBeUndefined();
  });
});
