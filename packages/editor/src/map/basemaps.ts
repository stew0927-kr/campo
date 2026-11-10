// Background maps (SPEC §3). Google, Naver and Kakao maps or satellite images must never be added here.
import type { RasterSourceSpecification } from 'maplibre-gl';

export type BasemapId = 'osm' | 'ngii';

export interface Basemap {
  id: BasemapId;
  label: string;
  /** null when the background cannot be shown yet (e.g. no API key). */
  source: RasterSourceSpecification | null;
  unavailableReason?: string;
}

export function basemaps(env: ImportMetaEnv = import.meta.env): Basemap[] {
  const key = env.VITE_NGII_API_KEY?.trim();
  const template = env.VITE_NGII_TILE_URL?.trim();
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
      id: 'ngii',
      label: '국토지리정보원 영상지도',
      source: key && template
        ? {
          type: 'raster',
          tiles: [template.replace('{key}', encodeURIComponent(key))],
          tileSize: 256,
          attribution: '국토지리정보원 영상지도 (공공누리 제1유형)',
        }
        : null,
      ...(key && template ? {} : { unavailableReason: 'packages/editor/.env에 VITE_NGII_API_KEY와 VITE_NGII_TILE_URL을 넣으면 쓸 수 있습니다.' }),
    },
  ];
}
