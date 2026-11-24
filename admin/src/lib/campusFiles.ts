// Campus map files (campus.json + *.geojson) between a folder on someone's PC, the browser and the
// campus_map_files table. Pure functions only (no React, no Supabase), so test/campusFiles.test.ts runs them in Node.

/** The one campus the team maps. Same default as the editor (packages/editor/src/App.tsx). */
export const CAMPUS_ID = 'hanyang-seoul';

/**
 * Paths the server keeps. Same rule as the editor's dev server (packages/editor/server/campus-api.ts CAMPUS_PATH)
 * and the check in supabase/migrations/0006_campus_maps.sql. Floors are L1, L2 … and L-1, L-2 … below ground.
 */
export const MAP_PATH = /^(campus\.json|outdoor\.geojson|connections\.geojson|buildings\/[A-Za-z0-9]+\/(building|L-?[1-9][0-9]*)\.geojson)$/;

/** A file the user picked, in a shape tests can fake. `relativePath` is File.webkitRelativePath. */
export interface PickedFile {
  relativePath: string;
  size: number;
  read(): Promise<string>;
}

export interface MapFile {
  path: string;
  text: string;
}

export interface ServerFile extends MapFile {
  updated_at: string;
}

export interface Skipped {
  path: string;
  reason: string;
}

export interface FolderScan {
  /** The picked folder path down to the campus folder, e.g. "hanyang-seoul" or "data/campuses/hanyang-seoul". */
  root: string;
  files: MapFile[];
  skipped: Skipped[];
  /** Files that were not inside the campus folder at all (only counted). */
  outside: number;
}

export interface Comparison {
  added: string[];
  changed: string[];
  same: string[];
  /** *.geojson the server has and the folder does not (removed only when the user ticks the box). */
  serverOnly: string[];
}

/** Byte order mark off, Windows line ends to \n: a checkout on Windows must not look like "every file changed". */
export function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

/**
 * The campus folder inside what the user picked: the folder that holds campus.json. If campus.json shows up in
 * several folders (they picked data/campuses with more than one campus), the one named `campusId` wins.
 */
export function findCampusRoot(relativePaths: string[], campusId: string = CAMPUS_ID): { root: string } | { error: string } {
  const roots = relativePaths
    .map((p) => p.split('\\').join('/'))
    .filter((p) => p === 'campus.json' || p.endsWith('/campus.json'))
    .map((p) => p.slice(0, -'campus.json'.length).replace(/\/$/, ''));
  if (roots.length === 0) {
    return { error: '고른 폴더에 campus.json이 없습니다. data/campuses 안의 캠퍼스 폴더(예: hanyang-seoul)를 골라 주세요.' };
  }
  if (roots.length === 1) return { root: roots[0]! };
  const named = roots.filter((r) => r === campusId || r.endsWith(`/${campusId}`));
  // The shortest one: a campus.json deeper inside the campus folder (a copy, a backup) must not win.
  if (named.length > 0) return { root: named.sort((a, b) => a.length - b.length)[0]! };
  return { error: `campus.json이 여러 폴더에 있습니다. ${campusId} 폴더 하나만 골라 주세요.` };
}

/** Reads the picked files: keeps campus.json and *.geojson under the campus folder, says why the rest are left out. */
export async function scanFolder(picked: PickedFile[], campusId: string = CAMPUS_ID): Promise<FolderScan | { error: string }> {
  const found = findCampusRoot(picked.map((f) => f.relativePath), campusId);
  if ('error' in found) return found;
  const prefix = found.root === '' ? '' : `${found.root}/`;
  const files: MapFile[] = [];
  const skipped: Skipped[] = [];
  let outside = 0;
  for (const f of picked) {
    const full = f.relativePath.split('\\').join('/');
    if (!full.startsWith(prefix)) {
      outside++;
      continue;
    }
    const path = full.slice(prefix.length);
    if (!MAP_PATH.test(path)) {
      skipped.push({ path, reason: '지도 파일이 아님(올리지 않음)' });
      continue;
    }
    const text = normalizeText(await f.read());
    try {
      JSON.parse(text);
    } catch {
      skipped.push({ path, reason: 'JSON 형식 오류(올리지 않음)' });
      continue;
    }
    files.push({ path, text });
  }
  const campus = files.find((f) => f.path === 'campus.json');
  if (!campus) return { error: 'campus.json의 JSON 형식이 올바르지 않습니다. 파일을 확인해 주세요.' };
  const id = (JSON.parse(campus.text) as { id?: unknown }).id;
  if (id !== campusId) {
    return { error: `이 폴더의 campus.json은 캠퍼스 "${String(id)}"입니다. ${campusId} 폴더를 골라 주세요.` };
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  skipped.sort((a, b) => a.path.localeCompare(b.path));
  return { root: found.root, files, skipped, outside };
}

/** Folder against server, by path and exact text. */
export function compareWithServer(folder: MapFile[], server: MapFile[]): Comparison {
  const onServer = new Map(server.map((f) => [f.path, f.text]));
  const inFolder = new Set(folder.map((f) => f.path));
  const result: Comparison = { added: [], changed: [], same: [], serverOnly: [] };
  for (const f of folder) {
    const there = onServer.get(f.path);
    if (there === undefined) result.added.push(f.path);
    else if (there === f.text) result.same.push(f.path);
    else result.changed.push(f.path);
  }
  for (const f of server) if (!inFolder.has(f.path) && f.path.endsWith('.geojson')) result.serverOnly.push(f.path);
  for (const list of Object.values(result)) list.sort();
  return result;
}

/** What save_campus_map() checks: the server state this screen was looking at, path -> updated_at. */
export function stateOf(server: ServerFile[]): Record<string, string> {
  return Object.fromEntries(server.map((f) => [f.path, f.updated_at]));
}

/** UTF-8 size in bytes. */
export function byteSize(files: MapFile[]): number {
  const enc = new TextEncoder();
  return files.reduce((n, f) => n + enc.encode(f.text).length, 0);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Korea time, "2026-11-24 19:30". */
export function kstLabel(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

/** Name of the backup download, in Korea time: hanyang-seoul-map-20261124-1930.zip */
export function zipName(now: Date, campusId: string = CAMPUS_ID): string {
  const s = kstLabel(now.toISOString()).replace(/[-:]/g, '').replace(' ', '-');
  return `${campusId}-map-${s}.zip`;
}

/** Zip entries: everything under one folder named after the campus, so unzipping gives data/campuses/<id>/ as is. */
export function zipEntries(files: MapFile[], campusId: string = CAMPUS_ID): Record<string, string> {
  return Object.fromEntries(files.map((f) => [`${campusId}/${f.path}`, f.text]));
}
