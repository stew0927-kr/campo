// npm run apply -- <changeset...> [--dry-run]  (docs/v0.2/SPEC-v0.2.md 7.2)
import { readFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import {
  CONNECTIONS_FILE,
  OUTDOOR_FILE,
  applyChangeset,
  checkChangeset,
  featureOf,
  fileOf,
  formatFeatureCollection,
  fromCampus,
  parseCampus,
  serialize,
  summarizeChangeset,
  validateCampus,
  validateChangeset,
  type Changeset,
  type ChangesetConflict,
  type ChangesetProblem,
  type EditState,
  type LoadedFile,
} from '@campo/core';
import { readCampusFiles } from '@campo/core/node';
import { commitFiles, nodeFs, type ApplyFs, type FileOp } from './atomic-write.ts';
import type { Output } from './cli.ts';
import { display as nativeDisplay, isDirectory, isFile } from './folders.ts';

export interface ApplyOptions {
  /** Check and print the summary, write nothing. */
  dryRun?: boolean;
  /** Folder holding the campus folders; a changeset goes to {campusesDir}/{changeset.campus}. */
  campusesDir: string;
  /** Clock for validateCampus (expired overrides). Default: now. */
  now?: Date;
  /** File operations (tests simulate a failed write). Default: node:fs. */
  fs?: ApplyFs;
}

/** Validation errors printed at most. */
const MAX_ERRORS_SHOWN = 20;

interface Loaded {
  file: string;
  cs: Changeset;
}

interface CampusRun {
  dir: string;
  files: LoadedFile[];
  base: EditState;
  state: EditState;
}

/**
 * Apply changeset files to the campus data. Files go in file-name order (date first, then name); each one is checked
 * against the state the earlier ones leave. Every conflict of every file is collected and printed; with any conflict,
 * problem, already-applied changeset or validation error nothing is written. Returns the exit code (0 ok, 1 failure).
 */
export async function runApply(files: string[], options: ApplyOptions, out: Output = console, cwd = process.cwd()): Promise<number> {
  const fs = options.fs ?? nodeFs;
  const paths = [...new Set(files.map((f) => resolve(cwd, f)))].sort((a, b) => cmp(basename(a), basename(b)) || cmp(a, b));
  if (paths.length === 0) {
    out.error('적용할 changeset 파일을 알려 주세요. 예: npm run apply -- changesets/20261111-ev1-fix.json --dry-run');
    return 1;
  }

  // 1. read and shape-check every file
  const loaded: Loaded[] = [];
  let unreadable = 0;
  for (const path of paths) {
    const shown = display(cwd, path);
    if (!(await isFile(path))) {
      out.error(`파일을 찾을 수 없습니다: ${shown}`);
      unreadable++;
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(await readFile(path, 'utf8'));
    } catch (err) {
      out.error(`JSON으로 읽을 수 없습니다: ${shown}: ${(err as Error).message}`);
      unreadable++;
      continue;
    }
    const check = validateChangeset(json);
    if (!check.ok) {
      out.error(`changeset 형식에 맞지 않습니다: ${shown}`);
      for (const e of check.errors) out.error(`  ${e}`);
      unreadable++;
      continue;
    }
    loaded.push({ file: path, cs: json as Changeset });
  }
  if (unreadable > 0) {
    out.error('');
    out.error('읽지 못한 파일이 있어 아무 파일도 쓰지 않았습니다.');
    return 1;
  }

  // 2. check and apply in order, in memory
  const campuses = new Map<string, CampusRun>();
  let failed = 0;
  let conflictCount = 0;
  for (const { file, cs } of loaded) {
    const shown = display(cwd, file);
    const head = `■ ${shown} — ${cs.id} (${cs.campus})`;
    const run = await campusRun(campuses, cs.campus, options.campusesDir, cwd, out);
    if (typeof run === 'string') {
      out.error(head);
      out.error(`  ${run}`);
      failed++;
      continue;
    }
    const check = checkChangeset(run.state, cs);
    if (check.alreadyApplied) {
      out.error(`${head}: 이미 적용된 changeset입니다. 같은 변경을 두 번 적용하지 않습니다.`);
      failed++;
      continue;
    }
    if (!check.ok) {
      out.error(`${head}: 적용할 수 없습니다 (충돌 ${check.conflicts.length}개, 문제 ${check.problems.length}개)`);
      for (const p of check.problems) out.error(`  ${problemLine(p)}`);
      for (const c of check.conflicts) out.error(`  ${conflictLine(c)}`);
      conflictCount += check.conflicts.length;
      failed++;
      continue;
    }
    const before = run.state;
    run.state = applyChangeset(cs).apply(before);
    out.log(`${head}${cs.summary !== '' ? ` "${cs.summary}"` : ''}`);
    if (cs.report_ids.length > 0) out.log(`  제보: ${cs.report_ids.join(', ')}`);
    const total = { added: 0, deleted: 0, changed: 0 };
    for (const g of summarizeChangeset(before, run.state, cs)) {
      out.log(`  ${g.label}: 추가 ${g.added}개, 삭제 ${g.deleted}개, 변경 ${g.changed}개`);
      total.added += g.added;
      total.deleted += g.deleted;
      total.changed += g.changed;
    }
    out.log(`  합계: 추가 ${total.added}개, 삭제 ${total.deleted}개, 변경 ${total.changed}개`);
  }
  if (failed > 0) {
    out.error('');
    const what = conflictCount > 0 ? `충돌 ${conflictCount}개를 포함해 ` : '';
    out.error(`${what}changeset ${failed}개에 문제가 있어 아무 파일도 쓰지 않았습니다.`);
    return 1;
  }

  // 3. the files to write, and validation of the result
  const ops: FileOp[] = [];
  let errorCount = 0;
  for (const [campus, run] of campuses) {
    const campusOps = fileOps(run);
    const result = parseCampus(withOps(run.files, campusOps));
    const { errors } = validateCampus(result, options.now ? { now: options.now } : {});
    if (errors.length > 0) {
      errorCount += errors.length;
      out.error(`■ ${campus}: 적용한 결과에 검사 오류 ${errors.length}개`);
      for (const e of errors.slice(0, MAX_ERRORS_SHOWN)) out.error(`  오류 [${e.code}] ${e.file}${e.featureId ? ` #${e.featureId}` : ''}: ${e.message}`);
      if (errors.length > MAX_ERRORS_SHOWN) out.error(`  … 외 ${errors.length - MAX_ERRORS_SHOWN}개`);
    }
    for (const op of campusOps) ops.push({ path: join(run.dir, op.path), text: op.text });
  }
  if (errorCount > 0) {
    out.error('');
    out.error('검사 오류가 있어 아무 파일도 쓰지 않았습니다. npm run validate로 확인해 주세요.');
    return 1;
  }

  out.log('');
  out.log(`바뀌는 파일 ${ops.length}개`);
  for (const op of ops) {
    const exists = await fs.exists(op.path);
    out.log(`  ${op.text === null ? '삭제' : exists ? '수정' : '추가'} ${display(cwd, op.path)}`);
  }
  if (options.dryRun) {
    out.log('');
    out.log('--dry-run: 파일을 쓰지 않았습니다.');
    return 0;
  }
  try {
    await commitFiles(ops, fs);
  } catch (err) {
    out.error('');
    out.error(`파일을 쓰다가 실패해서 원래 파일로 되돌렸습니다: ${(err as Error).message}`);
    return 1;
  }
  out.log('');
  out.log(`적용했습니다. changeset ${loaded.length}개, 파일 ${ops.length}개.`);
  return 0;
}

/** The campus's state (loaded once, then carried from changeset to changeset), or a Korean reason it cannot be used. */
async function campusRun(campuses: Map<string, CampusRun>, campus: string, campusesDir: string, cwd: string, out: Output): Promise<CampusRun | string> {
  const known = campuses.get(campus);
  if (known) return known;
  const dir = join(campusesDir, campus);
  if (!(await isDirectory(dir))) return `캠퍼스 폴더를 찾을 수 없습니다: ${display(cwd, dir)}`;
  const files = await readCampusFiles(dir);
  const loaded = parseCampus(files);
  const metaId = (loaded.meta as { id?: unknown } | undefined)?.id;
  if (metaId !== campus) return `campus.json의 id(${String(metaId)})가 changeset의 campus(${campus})와 다릅니다.`;
  const { state, issues } = fromCampus(loaded);
  const blocking = issues.filter((i) => i.code !== 'I2');
  if (blocking.length > 0 || loaded.fileErrors.length > 0) {
    for (const i of blocking) out.error(`  [${i.code}] ${i.file}${i.featureId ? ` #${i.featureId}` : ''}: ${i.message}`);
    for (const e of loaded.fileErrors) out.error(`  [schema] ${e.file}: ${e.message}`);
    return '캠퍼스 데이터를 편집 상태로 다 읽지 못했습니다. npm run validate로 먼저 고쳐 주세요.';
  }
  // Only the files whose content changes are rewritten, so every Feature must already sit in the file the save puts it in.
  const misplaced = loaded.features.flatMap(({ file, feature }) => {
    const id = (feature as { id: string }).id;
    const saved = featureOf(state, id);
    const want = saved ? fileOf(state, saved) : file;
    return want === file ? [] : [`${id}: ${file} → ${want}`];
  });
  if (misplaced.length > 0) {
    for (const m of misplaced.slice(0, MAX_ERRORS_SHOWN)) out.error(`  ${m}`);
    return `저장 형식과 다른 파일에 있는 Feature가 ${misplaced.length}개 있습니다. 편집기에서 한 번 저장해 파일 배치를 맞춘 뒤 다시 실행해 주세요.`;
  }
  const run = { dir, files, base: state, state };
  campuses.set(campus, run);
  return run;
}

/**
 * Files that differ between the serialized base and end states (paths relative to the campus folder).
 * Files nobody touched are left as they are on disk. outdoor.geojson / connections.geojson that end up empty are
 * written as empty collections; any other emptied file (a level or a deleted building) is deleted.
 */
function fileOps(run: CampusRun): FileOp[] {
  const before = new Map(serialize(run.base).map((f) => [f.path, f.text]));
  const after = new Map(serialize(run.state).map((f) => [f.path, f.text]));
  const onDisk = new Set(run.files.map((f) => f.path));
  const ops: FileOp[] = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort(cmp)) {
    const next = after.get(path);
    if (next !== undefined) {
      if (next !== before.get(path)) ops.push({ path, text: next });
    } else if (path === OUTDOOR_FILE || path === CONNECTIONS_FILE) {
      ops.push({ path, text: formatFeatureCollection([]) });
    } else if (onDisk.has(path)) {
      ops.push({ path, text: null });
    }
  }
  return ops;
}

function withOps(files: readonly LoadedFile[], ops: readonly FileOp[]): LoadedFile[] {
  const byPath = new Map(files.map((f) => [f.path, f.text]));
  for (const op of ops) {
    if (op.text === null) byPath.delete(op.path);
    else byPath.set(op.path, op.text);
  }
  return [...byPath].map(([path, text]) => ({ path, text }));
}

function conflictLine(c: ChangesetConflict): string {
  return `충돌 [${c.code}] #${c.id}: ${c.message}`;
}

function problemLine(p: ChangesetProblem): string {
  return `문제 [${p.code}]${p.id ? ` #${p.id}` : ''}: ${p.message}`;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** display() with forward slashes, so the output reads the same on Windows and elsewhere. */
function display(cwd: string, path: string): string {
  return nativeDisplay(cwd, path).split(sep).join('/');
}
