// 사진 관리(관리자 웹 /map/ 서버 빌드 전용): campus_photos 읽기, 관리자 확인, 교체·삭제를 photoModel의 순서대로 실행한다.
// 공개 키(sb_publishable_…)와 관리자 로그인 세션만 쓴다. 쓰기 권한은 0007 마이그레이션의 is_admin() 정책이 준다.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ADMIN_ONLY, MAX_BYTES, PHOTO_BUCKET, PHOTO_COLUMNS, PHOTO_TABLE, WEBP, deleteSteps, photoErrorMessage, replaceSteps, type PhotoRow, type PhotoStep,
} from './photoModel.ts';

/** The parts of a Supabase client the photo store uses, so tests can pass a fake. */
export type PhotoClient = Pick<SupabaseClient, 'from' | 'rpc' | 'auth' | 'storage'>;

export class PhotoError extends Error {}
const fail = (e: { code?: string; message?: string; statusCode?: string | number } | null | undefined): never => { throw new PhotoError(photoErrorMessage(e)); };

const PAGE = 1000;

/** 이 캠퍼스의 사진 행 전부(1,000줄씩). */
export async function loadPhotos(c: PhotoClient, campusId: string): Promise<PhotoRow[]> {
  const rows: PhotoRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await c.from(PHOTO_TABLE).select(PHOTO_COLUMNS).eq('campus_id', campusId).order('id').range(from, from + PAGE - 1);
    if (error) fail(error);
    const page = (data ?? []) as unknown as PhotoRow[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

/** 로그인한 관리자인가(0001 is_admin()). 로그인하지 않았거나 확인하지 못하면 false. */
export async function isAdmin(c: PhotoClient): Promise<boolean> {
  const { data: auth } = await c.auth.getSession();
  if (!auth.session) return false;
  const { data, error } = await c.rpc('is_admin');
  return !error && data === true;
}

export interface Variants { full: Blob; thumb: Blob }

/** 단계 하나를 실행한다. 실패하면 한국어 PhotoError. */
async function run(c: PhotoClient, step: PhotoStep, variants: Variants | null): Promise<void> {
  if (step.kind === 'upload') {
    const body = variants![step.variant];
    if (body.size > MAX_BYTES) throw new PhotoError('사진이 2 MB를 넘습니다. 더 작은 사진을 골라 주세요.');
    const { error } = await c.storage.from(PHOTO_BUCKET).upload(step.path, body, { upsert: false, contentType: WEBP, cacheControl: '31536000' });
    if (error) fail(error as { message?: string; statusCode?: string });
  } else if (step.kind === 'update-row') {
    const { data, error } = await c.from(PHOTO_TABLE).update(step.patch).eq('id', step.id).select('id');
    if (error) fail(error);
    // RLS가 막으면 오류 없이 0줄이 바뀐다: 관리자가 아니다.
    if (!data || (data as unknown[]).length === 0) throw new PhotoError(ADMIN_ONLY);
  } else if (step.kind === 'delete-row') {
    const { data, error } = await c.from(PHOTO_TABLE).delete().eq('id', step.id).select('id');
    if (error) fail(error);
    if (!data || (data as unknown[]).length === 0) throw new PhotoError(ADMIN_ONLY);
  } else {
    const { error } = await c.storage.from(PHOTO_BUCKET).remove(step.paths);
    if (error) fail(error as { message?: string; statusCode?: string });
  }
}

export interface PhotoResult {
  /** 새 행(교체) 또는 null(삭제). */
  row: PhotoRow | null;
  /** 끝까지 됐지만 옛 파일을 지우지 못했을 때의 안내(사진은 이미 바뀌었다). */
  warning: string | null;
}

/** 옛 파일 지우기만 실패하면 경고로 바꾼다: 사진·행은 이미 바뀌었고, 남은 파일은 앱이 가리키지 않는다. */
async function runAll(c: PhotoClient, steps: PhotoStep[], variants: Variants | null): Promise<string | null> {
  for (const step of steps) {
    try { await run(c, step, variants); } catch (e) {
      if (step.kind === 'remove-objects') return `사진은 바뀌었지만 옛 파일을 지우지 못했습니다(${step.paths.join(', ')}). ${e instanceof Error ? e.message : ''}`.trim();
      throw e;
    }
  }
  return null;
}

/** 사진 교체: 새 webp 둘 올리기 → 행 갱신 → 옛 파일 지우기(photoModel.replaceSteps). */
export async function replacePhoto(c: PhotoClient, row: PhotoRow, variants: Variants, sha256: string, now: Date = new Date()): Promise<PhotoResult> {
  const steps = replaceSteps(row, sha256, (path) => c.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl, now.toISOString());
  const warning = await runAll(c, steps, variants);
  const update = steps.find((s) => s.kind === 'update-row');
  return { row: update?.kind === 'update-row' ? { ...row, ...update.patch } : row, warning };
}

/** 사진 삭제: 행 지우기 → 파일 지우기(photoModel.deleteSteps). */
export async function deletePhoto(c: PhotoClient, row: PhotoRow): Promise<PhotoResult> {
  return { row: null, warning: await runAll(c, deleteSteps(row), null) };
}
