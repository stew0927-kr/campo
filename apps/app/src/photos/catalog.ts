// 사진 공급자 어댑터: 조원 D가 주는 DB 행(PhotoRow[])을 PhotoCatalog로 바꾼다. React를 import하지 않는 순수 모듈이다.
// 행이 없거나(null·undefined·[]) 쓸 수 있는 행이 하나도 없으면 EMPTY_PHOTO_CATALOG를 돌려준다.
import { normalizeDeg } from '@campo/core';
import type { PhotoCatalog, PhotoRow, RoutePhoto } from '../contracts.ts';

const NONE: readonly RoutePhoto[] = Object.freeze([]);

/** 사진이 하나도 없는 카탈로그. 사진 데이터가 오기 전이나 로컬 테스트에서 그대로 넘기면 된다. */
export const EMPTY_PHOTO_CATALOG: PhotoCatalog = Object.freeze({
  byNodeId: () => [],
  size: 0,
});

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const SOURCES = new Set(['sensor', 'dial', 'manual']);

/** 한 행을 RoutePhoto로. 필수 값(id·node_id·thumb_url·full_url)이 비면 null. 이상한 선택 값은 빠진다. */
export function routePhotoOf(row: PhotoRow): RoutePhoto | null {
  const r = row as unknown as Record<string, unknown>;
  const photoId = text(r['id']);
  const nodeId = text(r['node_id']);
  const thumbUrl = text(r['thumb_url']);
  const fullUrl = text(r['full_url']);
  if (photoId === null || nodeId === null || thumbUrl === null || fullUrl === null) return null;
  const heading = r['heading_deg'];
  const photo: RoutePhoto = {
    photoId,
    nodeId,
    heading_deg: typeof heading === 'number' && Number.isFinite(heading) ? normalizeDeg(heading) : null,
    thumbUrl,
    fullUrl,
  };
  const source = r['heading_source'];
  if (typeof source === 'string' && SOURCES.has(source)) photo.heading_source = source as NonNullable<RoutePhoto['heading_source']>;
  const hint = text(r['direction_hint']);
  if (hint !== null) photo.direction_hint = hint;
  const hfov = r['hfov_deg'];
  if (typeof hfov === 'number' && Number.isFinite(hfov) && hfov > 0 && hfov < 180) photo.hfov_deg = hfov;
  return photo;
}

/**
 * DB 행 목록 → 지점별 카탈로그. 같은 지점의 사진은 행의 순서를 지킨다(동률일 때 먼저 온 사진이 이긴다).
 * 같은 id가 두 번 오면 처음 것만 쓴다.
 */
export function photoCatalogFromRows(rows: readonly PhotoRow[] | null | undefined): PhotoCatalog {
  if (!Array.isArray(rows) || rows.length === 0) return EMPTY_PHOTO_CATALOG;
  const byNode = new Map<string, RoutePhoto[]>();
  const seen = new Set<string>();
  let size = 0;
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const photo = routePhotoOf(row);
    if (photo === null || seen.has(photo.photoId)) continue;
    seen.add(photo.photoId);
    const list = byNode.get(photo.nodeId);
    if (list) list.push(photo);
    else byNode.set(photo.nodeId, [photo]);
    size++;
  }
  if (size === 0) return EMPTY_PHOTO_CATALOG;
  return Object.freeze({
    byNodeId: (nodeId: string) => [...(byNode.get(nodeId) ?? NONE)],
    size,
  });
}

/** 카탈로그에 사진이 하나도 없다고 볼 수 있는지(null, size 0). size를 주지 않는 공급자는 있다고 본다. */
export const isEmptyCatalog = (catalog: PhotoCatalog | null | undefined): boolean =>
  catalog === null || catalog === undefined || catalog === EMPTY_PHOTO_CATALOG || catalog.size === 0;
