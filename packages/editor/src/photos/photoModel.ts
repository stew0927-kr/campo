// 편집기 '사진' 토글의 순수 로직(브라우저·Supabase 없이 테스트한다).
// - campus_photos 행을 지도 노드(node_id) 좌표로 옮기고, 같은 지점의 여러 장은 핀 하나로 묶는다.
// - 브라우저 webp 변환 파라미터(업로드 스크립트 supabase/photo-pipeline/src/images.ts와 같은 크기·품질).
// - 버킷 객체 경로·공개 URL·sha256, 교체·삭제 순서(데이터가 깨지지 않는 순서).
import type { EditNode } from '@campo/core';
import type { Scope } from '../model/scope.ts';

export const PHOTO_BUCKET = 'campus-photos';
export const PHOTO_TABLE = 'campus_photos';
/** 버킷 설정(0002): WebP만, 한 장 2 MB까지. */
export const MAX_BYTES = 2 * 1024 * 1024;
export const WEBP = 'image/webp';
/** 원본 크기·품질(0~1). 파이프라인 FULL = { size: 1280, quality: 80 }, THUMB = { size: 128, quality: 75 }와 같다. */
export const FULL = { size: 1280, quality: 0.8 } as const;
export const THUMB = { size: 128, quality: 0.75 } as const;
/** 2 MB를 넘으면 이 품질로 차례로 다시 만든다. */
export const RETRY_QUALITIES = [0.7, 0.6, 0.5] as const;

/** 편집기가 읽고 쓰는 campus_photos 칸. */
export interface PhotoRow {
  id: string;
  campus_id: string;
  node_id: string;
  building_id: string | null;
  level: number | null;
  heading_deg: number | null;
  thumb_url: string;
  full_url: string;
  sha256: string | null;
  updated_at: string;
}
export const PHOTO_COLUMNS = 'id,campus_id,node_id,building_id,level,heading_deg,thumb_url,full_url,sha256,updated_at';

/** 지도에 찍는 사진 핀: 지점 하나, 그 지점 사진 여러 장. */
export interface PhotoPin {
  nodeId: string;
  coord: [number, number];
  /** id 순서. */
  photos: PhotoRow[];
}

export interface PhotoPins {
  /** 지금 보는 범위(실외 / 건물·층)의 핀. */
  pins: PhotoPin[];
  /** 다른 범위(다른 층·실외)에 있는 사진 장수. */
  elsewhere: number;
  /** 지도에 없는 node_id의 사진 장수(지점이 지워졌거나 아직 저장되지 않음). */
  missing: number;
}

const inScope = (node: EditNode, scope: Scope): boolean => (scope.kind === 'outdoor'
  ? node.props.building_id === null
  : node.props.building_id === scope.buildingId && node.props.level === scope.level);

/** 행을 node_id별로 묶어 그 노드 좌표에 핀 하나씩. 지금 범위 밖의 지점과 지도에 없는 지점은 장수만 센다. */
export function photoPins(rows: readonly PhotoRow[], nodes: Readonly<Record<string, EditNode>>, scope: Scope): PhotoPins {
  const byNode = new Map<string, PhotoRow[]>();
  for (const row of rows) byNode.set(row.node_id, [...(byNode.get(row.node_id) ?? []), row]);
  const pins: PhotoPin[] = [];
  let elsewhere = 0, missing = 0;
  for (const [nodeId, photos] of [...byNode].sort(([a], [b]) => a.localeCompare(b))) {
    const node = nodes[nodeId];
    if (!node) { missing += photos.length; continue; }
    if (!inScope(node, scope)) { elsewhere += photos.length; continue; }
    pins.push({ nodeId, coord: [node.coord[0]!, node.coord[1]!], photos: [...photos].sort((a, b) => a.id.localeCompare(b.id)) });
  }
  return { pins, elsewhere, missing };
}

/** 긴 변이 `max`를 넘지 않게 줄인 크기(키우지 않는다, 최소 1px). */
export function fitInside(width: number, height: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** 한 변형(원본/썸네일)의 품질 시도 순서: 기본 품질, 그다음 2 MB를 넘을 때 쓸 더 낮은 품질. */
export const qualitySteps = (base: number): number[] => [base, ...RETRY_QUALITIES.filter((q) => q < base)];

/** 바이트 → 소문자 16진수. */
export function hex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 원본 파일 내용의 sha256(파이프라인과 같이 '고른 원본 파일'의 지문). Web Crypto: 브라우저와 Node 모두. */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  // A fresh copy is backed by a plain ArrayBuffer (digest refuses shared buffers, and the types say so).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return hex(await crypto.subtle.digest('SHA-256', copy.buffer));
}

/**
 * 교체 사진의 새 객체 경로. 파이프라인의 thumbs/<id>.webp · full/<id>.webp에 지문 앞 8자리를 붙인다: 공개 URL은 1년 캐시라
 * 같은 이름에 덮어쓰면 앱과 CDN이 옛 사진을 계속 보여 준다.
 */
export function newObjectPaths(id: string, sha256: string): { thumb: string; full: string } {
  const tag = sha256.slice(0, 8);
  return { thumb: `thumbs/${id}-${tag}.webp`, full: `full/${id}-${tag}.webp` };
}

/** 공개 URL → 버킷 안 경로(…/storage/v1/object/public/campus-photos/<경로>). 이 버킷의 URL이 아니면 null. */
export function objectPathOf(url: string, bucket = PHOTO_BUCKET): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const path = url.slice(at + marker.length).split(/[?#]/)[0]!;
  try { return decodeURIComponent(path) || null; } catch { return null; }
}

/** 프로젝트 URL과 경로로 공개 URL(supabase-js getPublicUrl과 같은 모양). */
export const publicUrlOf = (projectUrl: string, path: string, bucket = PHOTO_BUCKET): string =>
  `${projectUrl.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;

export type PhotoStep =
  | { kind: 'upload'; path: string; variant: 'full' | 'thumb' }
  | { kind: 'update-row'; id: string; patch: { thumb_url: string; full_url: string; sha256: string; updated_at: string } }
  | { kind: 'delete-row'; id: string }
  | { kind: 'remove-objects'; paths: string[] };

/**
 * 교체 순서: 새 파일 둘을 올리고 → 행을 새 주소로 바꾸고 → 옛 파일을 지운다. 행을 바꾸기 전에 옛 파일을 지우면, 행 갱신이 실패했을 때
 * 행이 없는 파일을 가리킨다(앱에서 사진이 깨진다). 이 순서면 어디서 멈춰도 행은 늘 있는 파일을 가리키고, 남는 것은 지울 파일뿐이다.
 */
export function replaceSteps(row: Pick<PhotoRow, 'id' | 'thumb_url' | 'full_url'>, sha256: string, publicUrl: (path: string) => string, nowIso: string): PhotoStep[] {
  const next = newObjectPaths(row.id, sha256);
  const old = [objectPathOf(row.full_url), objectPathOf(row.thumb_url)].filter((p): p is string => p !== null && p !== next.full && p !== next.thumb);
  return [
    { kind: 'upload', path: next.full, variant: 'full' },
    { kind: 'upload', path: next.thumb, variant: 'thumb' },
    { kind: 'update-row', id: row.id, patch: { thumb_url: publicUrl(next.thumb), full_url: publicUrl(next.full), sha256, updated_at: nowIso } },
    ...(old.length ? [{ kind: 'remove-objects' as const, paths: old }] : []),
  ];
}

/** 삭제 순서: 행을 먼저 지우고(앱에서 바로 사라진다) → 파일을 지운다. 파일 삭제가 실패해도 깨진 행은 남지 않는다. */
export function deleteSteps(row: Pick<PhotoRow, 'id' | 'thumb_url' | 'full_url'>): PhotoStep[] {
  const paths = [objectPathOf(row.full_url), objectPathOf(row.thumb_url)].filter((p): p is string => p !== null);
  return [{ kind: 'delete-row', id: row.id }, ...(paths.length ? [{ kind: 'remove-objects' as const, paths }] : [])];
}

export const ADMIN_ONLY = '관리자 계정만 사진을 바꿀 수 있습니다. 관리자 웹에서 관리자 계정으로 로그인했는지 확인해 주세요.';
export const SERVER_ONLY = '사진 관리는 관리자 웹(/map/)의 편집기에서만 됩니다. PC 편집기에는 사진 서버가 연결되어 있지 않습니다.';

/** Supabase·브라우저 오류 → 한국어 안내(원문 401·RLS 문구를 그대로 보이지 않는다). */
export function photoErrorMessage(e: { code?: string; message?: string; statusCode?: string | number } | null | undefined): string {
  const msg = e?.message ?? '';
  const status = String(e?.statusCode ?? '');
  if (e?.code === '42501' || status === '403' || /permission denied|row-level security|violates row-level|Unauthorized/i.test(msg)) return ADMIN_ONLY;
  if (e?.code === '23505' || /duplicate key|campus_photos_sha256_key/i.test(msg)) return '같은 사진이 이미 올라가 있습니다. 다른 사진 파일을 골라 주세요.';
  if (status === '413' || /exceeded the maximum allowed size|Payload too large/i.test(msg)) return '사진이 2 MB를 넘습니다. 더 작은 사진을 골라 주세요.';
  if (/mime type|invalid_mime_type/i.test(msg)) return '서버는 WebP 사진만 받습니다. 이 브라우저에서 WebP로 바꾸지 못했습니다.';
  if (/JWT|token is expired|invalid claim/i.test(msg)) return '로그인이 만료됐습니다. 관리자 웹에서 다시 로그인해 주세요.';
  if (/Failed to fetch|NetworkError|fetch failed|Load failed/i.test(msg)) return '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.';
  return msg || '알 수 없는 오류가 났습니다.';
}
