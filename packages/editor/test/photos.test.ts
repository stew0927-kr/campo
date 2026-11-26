// 편집기 사진 토글(관리자 웹 /map/): 노드별 묶기, webp 변환 값, 경로·URL·sha256, 교체·삭제 순서, 한국어 오류, 0007 정책.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EditNode } from '@campo/core';
import {
  ADMIN_ONLY, FULL, MAX_BYTES, RETRY_QUALITIES, THUMB, deleteSteps, fitInside, hex, newObjectPaths, objectPathOf, photoErrorMessage, photoPins,
  publicUrlOf, qualitySteps, replaceSteps, sha256Hex, type PhotoRow,
} from '../src/photos/photoModel.ts';
import { deletePhoto, isAdmin, loadPhotos, PhotoError, replacePhoto, type PhotoClient } from '../src/photos/photoStore.ts';

const PROJECT = 'https://abcd.supabase.co';
const url = (path: string) => publicUrlOf(PROJECT, path);
const row = (id: string, node: string, extra: Partial<PhotoRow> = {}): PhotoRow => ({
  id, campus_id: 'hanyang-seoul', node_id: node, building_id: null, level: null, heading_deg: 90,
  thumb_url: url(`thumbs/${id}.webp`), full_url: url(`full/${id}.webp`), sha256: null, updated_at: '2026-11-20T00:00:00Z', ...extra,
});
const node = (id: string, coord: [number, number], building_id: string | null = null, level: number | null = null): EditNode =>
  ({ id, coord, props: { building_id, level } } as unknown as EditNode);

describe('노드별 묶기', () => {
  const nodes = { a: node('a', [127.04, 37.55]), b: node('b', [127.05, 37.56]), r: node('r', [127.046, 37.557], 'B1', 2) };
  const rows = [row('a-2', 'a'), row('a-1', 'a'), row('b-1', 'b'), row('r-1', 'r'), row('x-1', 'gone')];
  it('같은 지점의 여러 장은 핀 하나(장수), 핀은 그 노드 좌표에', () => {
    const { pins, elsewhere, missing } = photoPins(rows, nodes, { kind: 'outdoor' });
    expect(pins.map((p) => [p.nodeId, p.photos.length])).toEqual([['a', 2], ['b', 1]]);
    expect(pins[0]!.coord).toEqual([127.04, 37.55]);
    expect(pins[0]!.photos.map((p) => p.id)).toEqual(['a-1', 'a-2']);
    expect(elsewhere).toBe(1);
    expect(missing).toBe(1);
  });
  it('건물 층을 보고 있으면 그 층 지점만', () => {
    const { pins, elsewhere } = photoPins(rows, nodes, { kind: 'building', buildingId: 'B1', level: 2 });
    expect(pins.map((p) => p.nodeId)).toEqual(['r']);
    expect(elsewhere).toBe(3);
    expect(photoPins(rows, nodes, { kind: 'building', buildingId: 'B1', level: 3 }).pins).toEqual([]);
  });
  it('사진이 없으면 핀도 없다', () => {
    expect(photoPins([], nodes, { kind: 'outdoor' })).toEqual({ pins: [], elsewhere: 0, missing: 0 });
  });
});

describe('webp 변환 값(파이프라인과 같은 크기·품질, 2 MB)', () => {
  it('긴 변을 줄이고 키우지 않는다', () => {
    expect(fitInside(4032, 3024, FULL.size)).toEqual({ width: 1280, height: 960 });
    expect(fitInside(3024, 4032, THUMB.size)).toEqual({ width: 96, height: 128 });
    expect(fitInside(800, 600, FULL.size)).toEqual({ width: 800, height: 600 });
    expect(fitInside(5000, 2, THUMB.size)).toEqual({ width: 128, height: 1 });
  });
  it('기본 품질 다음에 더 낮은 품질로 다시 시도', () => {
    expect(FULL).toEqual({ size: 1280, quality: 0.8 });
    expect(THUMB).toEqual({ size: 128, quality: 0.75 });
    expect(qualitySteps(0.8)).toEqual([0.8, ...RETRY_QUALITIES]);
    expect(qualitySteps(0.6)).toEqual([0.6, 0.5]);
    expect(MAX_BYTES).toBe(2_097_152);
  });
});

describe('경로·URL·sha256', () => {
  it('sha256은 원본 바이트의 소문자 16진수 64자', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(new Uint8Array([0, 15, 255]))).toBe('000fff');
  });
  it('교체 파일은 지문 앞 8자를 붙인 새 이름(공개 URL 1년 캐시에 옛 사진이 남지 않게)', () => {
    expect(newObjectPaths('n1-abc', '0123456789abcdef')).toEqual({ thumb: 'thumbs/n1-abc-01234567.webp', full: 'full/n1-abc-01234567.webp' });
  });
  it('공개 URL ↔ 버킷 경로', () => {
    const u = url('full/n 1.webp');
    expect(u).toBe('https://abcd.supabase.co/storage/v1/object/public/campus-photos/full/n%201.webp');
    expect(objectPathOf(u)).toBe('full/n 1.webp');
    expect(objectPathOf(`${url('thumbs/a.webp')}?v=2`)).toBe('thumbs/a.webp');
    expect(objectPathOf('https://example.com/a.webp')).toBeNull();
    expect(publicUrlOf(`${PROJECT}/`, 'a.webp')).toBe(`${PROJECT}/storage/v1/object/public/campus-photos/a.webp`);
  });
});

describe('교체·삭제 순서', () => {
  const sha = 'f'.repeat(64);
  it('교체: 새 원본 → 새 썸네일 → 행 갱신 → 옛 파일 삭제', () => {
    const steps = replaceSteps(row('p1', 'a'), sha, url, '2026-11-26T01:02:03.000Z');
    expect(steps.map((s) => s.kind)).toEqual(['upload', 'upload', 'update-row', 'remove-objects']);
    expect(steps[0]).toEqual({ kind: 'upload', path: 'full/p1-ffffffff.webp', variant: 'full' });
    expect(steps[1]).toEqual({ kind: 'upload', path: 'thumbs/p1-ffffffff.webp', variant: 'thumb' });
    expect(steps[2]).toEqual({ kind: 'update-row', id: 'p1', patch: { thumb_url: url('thumbs/p1-ffffffff.webp'), full_url: url('full/p1-ffffffff.webp'), sha256: sha, updated_at: '2026-11-26T01:02:03.000Z' } });
    expect(steps[3]).toEqual({ kind: 'remove-objects', paths: ['full/p1.webp', 'thumbs/p1.webp'] });
  });
  it('같은 사진으로 다시 교체하면(경로가 같으면) 지우지 않는다; 다른 곳 URL은 건드리지 않는다', () => {
    const same = row('p1', 'a', { full_url: url('full/p1-ffffffff.webp'), thumb_url: 'https://cdn.example/t.webp' });
    expect(replaceSteps(same, sha, url, 'now').map((s) => s.kind)).toEqual(['upload', 'upload', 'update-row']);
  });
  it('삭제: 행 먼저 → 파일', () => {
    expect(deleteSteps(row('p1', 'a'))).toEqual([{ kind: 'delete-row', id: 'p1' }, { kind: 'remove-objects', paths: ['full/p1.webp', 'thumbs/p1.webp'] }]);
  });
});

/** Fake client that records every call in order. */
function fake(opts: { admin?: boolean; session?: boolean; rows?: PhotoRow[]; updateRows?: number; uploadError?: string; removeError?: string } = {}) {
  const calls: string[] = [];
  const query = (table: string) => {
    let op = 'select';
    let patch: unknown = null;
    const q = {
      select: () => q, eq: (_c: string, v: string) => { calls.push(`${table}.${op}${op === 'update' ? `(${JSON.stringify(patch)})` : ''} id=${v}`); return q; },
      order: () => q,
      range: async (a: number, b: number) => ({ data: (opts.rows ?? []).slice(a, b + 1), error: null }),
      update: (p: unknown) => { op = 'update'; patch = p; return q; },
      delete: () => { op = 'delete'; return q; },
      then: (resolve: (v: unknown) => void) => resolve({ data: Array.from({ length: opts.updateRows ?? 1 }, () => ({ id: 'x' })), error: null }),
    };
    return q;
  };
  const client = {
    from: (table: string) => query(table),
    rpc: async (name: string) => { calls.push(`rpc.${name}`); return { data: opts.admin ?? true, error: null }; },
    auth: { getSession: async () => ({ data: { session: opts.session === false ? null : { user: { id: 'u' } } } }) },
    storage: {
      from: () => ({
        upload: async (path: string, body: Blob, o: { upsert: boolean; contentType: string }) => { calls.push(`upload ${path} ${o.contentType} ${body.size}`); return { error: opts.uploadError ? { message: opts.uploadError, statusCode: '403' } : null }; },
        remove: async (paths: string[]) => { calls.push(`remove ${paths.join(',')}`); return { error: opts.removeError ? { message: opts.removeError } : null }; },
        getPublicUrl: (path: string) => ({ data: { publicUrl: url(path) } }),
      }),
    },
  } as unknown as PhotoClient;
  return { client, calls };
}
const webp = (n: number) => new Blob([new Uint8Array(n)], { type: 'image/webp' });

describe('저장소 실행(가짜 클라이언트)', () => {
  it('교체는 올리기 둘 → 행 갱신 → 옛 파일 삭제 순서로 부르고 새 행을 돌려준다', async () => {
    const { client, calls } = fake();
    const result = await replacePhoto(client, row('p1', 'a'), { full: webp(10), thumb: webp(3) }, 'a'.repeat(64), new Date('2026-11-26T00:00:00Z'));
    expect(calls[0]).toBe('upload full/p1-aaaaaaaa.webp image/webp 10');
    expect(calls[1]).toBe('upload thumbs/p1-aaaaaaaa.webp image/webp 3');
    expect(calls[2]).toMatch(/^campus_photos\.update\(.*"sha256":"a{64}".*\) id=p1$/);
    expect(calls[3]).toBe('remove full/p1.webp,thumbs/p1.webp');
    expect(result.row?.full_url).toBe(url('full/p1-aaaaaaaa.webp'));
    expect(result.warning).toBeNull();
  });
  it('2 MB가 넘으면 아무것도 올리지 않고 멈춘다', async () => {
    const { client, calls } = fake();
    await expect(replacePhoto(client, row('p1', 'a'), { full: webp(MAX_BYTES + 1), thumb: webp(1) }, 'a'.repeat(64))).rejects.toThrow('2 MB');
    expect(calls).toEqual([]);
  });
  it('관리자가 아니면(업로드 403) 행을 건드리지 않고 한국어로 알린다', async () => {
    const { client, calls } = fake({ uploadError: 'new row violates row-level security policy' });
    await expect(replacePhoto(client, row('p1', 'a'), { full: webp(1), thumb: webp(1) }, 'a'.repeat(64))).rejects.toThrow(ADMIN_ONLY);
    expect(calls.some((c) => c.includes('update'))).toBe(false);
  });
  it('RLS로 0줄이 바뀌면 관리자 안내, 옛 파일은 지우지 않는다', async () => {
    const { client, calls } = fake({ updateRows: 0 });
    await expect(replacePhoto(client, row('p1', 'a'), { full: webp(1), thumb: webp(1) }, 'a'.repeat(64))).rejects.toBeInstanceOf(PhotoError);
    expect(calls.some((c) => c.startsWith('remove'))).toBe(false);
  });
  it('옛 파일 지우기만 실패하면 경고(사진은 이미 바뀜)', async () => {
    const { client } = fake({ removeError: 'boom' });
    const result = await replacePhoto(client, row('p1', 'a'), { full: webp(1), thumb: webp(1) }, 'a'.repeat(64));
    expect(result.row?.sha256).toBe('a'.repeat(64));
    expect(result.warning).toContain('옛 파일을 지우지 못했습니다');
  });
  it('삭제는 행 → 파일', async () => {
    const { client, calls } = fake();
    expect(await deletePhoto(client, row('p1', 'a'))).toEqual({ row: null, warning: null });
    expect(calls).toEqual(['campus_photos.delete id=p1', 'remove full/p1.webp,thumbs/p1.webp']);
  });
  it('읽기·관리자 확인', async () => {
    const rows = [row('a', 'n')];
    expect(await loadPhotos(fake({ rows }).client, 'hanyang-seoul')).toEqual(rows);
    expect(await isAdmin(fake({ admin: true }).client)).toBe(true);
    expect(await isAdmin(fake({ admin: false }).client)).toBe(false);
    const noSession = fake({ session: false });
    expect(await isAdmin(noSession.client)).toBe(false);
    expect(noSession.calls).toEqual([]);
  });
});

describe('오류 문구', () => {
  it('RLS·403은 관리자 안내, 중복 사진·용량·네트워크는 각자', () => {
    expect(photoErrorMessage({ code: '42501', message: 'permission denied' })).toBe(ADMIN_ONLY);
    expect(photoErrorMessage({ statusCode: 403, message: 'x' })).toBe(ADMIN_ONLY);
    expect(photoErrorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "campus_photos_sha256_key"' })).toContain('같은 사진');
    expect(photoErrorMessage({ statusCode: '413', message: 'Payload too large' })).toContain('2 MB');
    expect(photoErrorMessage({ message: 'Failed to fetch' })).toContain('연결');
  });
});

describe('0007 마이그레이션: is_admin() 쓰기 정책, 비밀 키 없음', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/0007_campus_photos_admin.sql', import.meta.url), 'utf8');
  it('표 insert/update/delete와 버킷 select/insert/update/delete를 관리자에게만', () => {
    for (const op of ['insert', 'update', 'delete']) expect(sql).toMatch(new RegExp(`create policy campus_photos_admin_${op} on public\\.campus_photos\\s+for ${op} to authenticated`));
    for (const op of ['select', 'insert', 'update', 'delete']) expect(sql).toMatch(new RegExp(`create policy campus_photos_bucket_admin_${op} on storage\\.objects\\s+for ${op} to authenticated`));
    expect(sql.match(/public\.is_admin\(\)/g)!.length).toBeGreaterThanOrEqual(8);
    expect(sql).not.toMatch(/to anon/);
  });
  it('편집기 코드에 비밀 키·service_role이 없다', () => {
    for (const f of ['photoModel.ts', 'photoStore.ts', 'usePhotos.ts', 'webp.ts']) {
      const src = readFileSync(new URL(`../src/photos/${f}`, import.meta.url), 'utf8');
      expect(src).not.toMatch(/sb_secret_|service_role|SERVICE_ROLE/);
    }
  });
});
