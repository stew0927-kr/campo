// 지형 3D's height grid for the editor (GET /api/elevation/:id/terrain): the solver's corrected_dem when there is one
// (paths, flat_exact, stairs, barometer Δh and break lines already folded in), else the plain DEM, else none.
// A campo-grid file is <name>.json (meta) + <name>.bin (row-major from the north, little-endian float32 or uint16).
// It is thinned to at most MAX_CELLS cells a side: the view needs the shape of the ground, not every metre.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const MAX_CELLS = 160;

/** A grid file the view cannot draw (its CRS, a short .bin): the API answers 422 with this message, not 500. */
export class GridFormatError extends Error {}

interface GridMeta {
  crs?: string;
  origin_x: number;
  origin_y: number;
  res: number;
  width: number;
  height: number;
  dtype: 'float32' | 'uint16';
  nodata?: number;
  scale?: number;
  offset?: number;
  bin?: string;
}

/** The grid the editor draws (model/terrain3d.ts TerrainGrid). */
export interface TerrainGridJson {
  source: 'corrected' | 'dem';
  crs: 'EPSG:5186';
  originX: number;
  originY: number;
  res: number;
  width: number;
  height: number;
  z: (number | null)[];
}

/** Decode and thin a grid (every `stride`-th cell each way, the cell centres kept where they are). */
export function decodeGrid(meta: GridMeta, bytes: Uint8Array, source: TerrainGridJson['source'], maxCells = MAX_CELLS): TerrainGridJson {
  // The view converts grid metres with the EPSG:5186 formulas of model/terrain3d.ts; dem_prep.py makes EPSG:5186 by default and
  // warns when --dst-crs is something else (the solver itself works in any projected CRS).
  if (meta.crs !== undefined && meta.crs !== 'EPSG:5186') {
    throw new GridFormatError(`고도 그리드 좌표계 ${meta.crs}는 지형 3D에서 읽지 못합니다(EPSG:5186만). `
      + 'dem_prep.py를 --dst-crs EPSG:5186(기본값)으로 다시 실행해 DEM을 만든 뒤 고도를 다시 계산해 주세요.');
  }
  const n = meta.width * meta.height;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = meta.dtype === 'uint16' ? 2 : 4;
  if (bytes.byteLength < n * size) throw new GridFormatError('고도 그리드 .bin 파일이 메타데이터보다 짧습니다.');
  const value = (i: number): number | null => {
    if (meta.dtype === 'uint16') {
      const raw = view.getUint16(i * 2, true);
      return raw === (meta.nodata ?? 65535) ? null : raw * (meta.scale ?? 1) + (meta.offset ?? 0);
    }
    const v = view.getFloat32(i * 4, true);
    return !Number.isFinite(v) || v === (meta.nodata ?? -9999) ? null : v;
  };
  const stride = Math.max(1, Math.ceil(Math.max(meta.width, meta.height) / maxCells));
  const width = Math.ceil(meta.width / stride);
  const height = Math.ceil(meta.height / stride);
  const z: (number | null)[] = [];
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) z.push(value(r * stride * meta.width + c * stride));
  const shift = 0.5 * meta.res * (stride - 1);
  return { source, crs: 'EPSG:5186', originX: meta.origin_x - shift, originY: meta.origin_y + shift, res: meta.res * stride, width, height, z };
}

export async function readGridFile(jsonPath: string, source: TerrainGridJson['source'], maxCells = MAX_CELLS): Promise<TerrainGridJson> {
  const meta = JSON.parse(await readFile(jsonPath, 'utf8')) as GridMeta;
  const bin = join(dirname(jsonPath), meta.bin ?? jsonPath.replace(/^.*[\/]/, '').replace(/\.json$/, '.bin'));
  return decodeGrid(meta, new Uint8Array(await readFile(bin)), source, maxCells);
}
