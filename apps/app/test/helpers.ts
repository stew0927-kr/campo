// 테스트 도우미: 코어의 campus-basic fixture를 앱이 쓰는 번들 모양 그대로 읽는다.
// 앱은 assets/campus.generated.json을 쓰지만, 테스트는 생성된 파일에 기대지 않도록 같은 형식을 직접 만든다.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoadedFile } from '@campo/core';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import type { BundledCampus, CampusRuntime } from '../src/campus/types.ts';

/** packages/core/test/fixtures/campus-basic — 지점·구간·건물·층이 모두 있는 작은 캠퍼스. */
export const CORE_FIXTURE_DIR = fileURLToPath(new URL('../../../packages/core/test/fixtures/campus-basic', import.meta.url));

/** campus.json과 GeoJSON만 (scripts/bundle-campus.mjs와 같은 규칙). */
export async function bundleOf(dir: string, campus = 'campus-basic'): Promise<BundledCampus> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files: LoadedFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/');
    if (path !== 'campus.json' && !path.endsWith('.geojson')) continue;
    files.push({ path, text: await readFile(join(entry.parentPath, entry.name), 'utf8') });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { campus, files };
}

export async function fixtureRuntime(): Promise<CampusRuntime> {
  return loadBundledCampus(await bundleOf(CORE_FIXTURE_DIR));
}

/** 인라인 번들. 한 파일짜리 작은 캠퍼스를 만들 때 쓴다. */
export function bundleFrom(meta: Record<string, unknown>, features: unknown[]): BundledCampus {
  return {
    campus: typeof meta['id'] === 'string' ? meta['id'] : 'inline',
    files: [
      { path: 'campus.json', text: JSON.stringify(meta) },
      { path: 'outdoor.geojson', text: JSON.stringify({ type: 'FeatureCollection', features }) },
    ],
  };
}

export const nodeFeature = (id: string, lng: number, lat: number, props: Record<string, unknown> = {}) => ({
  type: 'Feature',
  id,
  geometry: { type: 'Point', coordinates: [lng, lat] },
  properties: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'estimate', rev: 1, ...props },
});

export const edgeFeature = (id: string, from: string, to: string, lngLat: [number, number][], props: Record<string, unknown> = {}) => ({
  type: 'Feature',
  id,
  geometry: { type: 'LineString', coordinates: lngLat },
  properties: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from, to, bidirectional: true, step_free: true, source: 'estimate', rev: 1, ...props },
});

export const META = { id: 'inline', schema_version: '0.2', name: '테스트 캠퍼스', center: [127.0, 37.0], bbox: [126.9, 36.9, 127.1, 37.1] };
