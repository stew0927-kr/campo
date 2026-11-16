// Background maps (SPEC §3). Google, Naver and Kakao maps or satellite images must never be added here.
import type { RasterSourceSpecification } from 'maplibre-gl';

export type BasemapId = 'osm' | 'vworld';

export interface Basemap {
  id: BasemapId;
  label: string;
  /** null when the background cannot be shown yet (e.g. no API key). */
  source: RasterSourceSpecification | null;
  unavailableReason?: string;
}

/** 브이월드(국토교통부) 위성지도 WMTS. The key comes from VITE_VWORLD_API_KEY (packages/editor/.env). */
export const VWORLD_TILE_URL = 'https://api.vworld.kr/req/wmts/1.0.0/{key}/Satellite/{z}/{y}/{x}.jpeg';

export function basemaps(env: ImportMetaEnv = import.meta.env): Basemap[] {
  const key = env.VITE_VWORLD_API_KEY?.trim();
  return [
    {
      id: 'osm',
      label: 'OSM 표시용',
      source: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자',
      },
    },
    {
      id: 'vworld',
      label: '브이월드 위성지도',
      source: key
        ? {
          type: 'raster',
          tiles: [VWORLD_TILE_URL.replace('{key}', encodeURIComponent(key))],
          tileSize: 256,
          maxzoom: 19,
          attribution: '© 국토교통부 브이월드',
        }
        : null,
      ...(key ? {} : { unavailableReason: 'packages/editor/.env에 VITE_VWORLD_API_KEY를 넣으면 쓸 수 있습니다. 브이월드(vworld.kr)에서 인증키를 발급받아 주세요.' }),
    },
  ];
}
