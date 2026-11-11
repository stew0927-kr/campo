import { readdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { migrateCampusFiles, type MigrateSummary } from '@campo/core';
import { readCampusFiles } from '@campo/core/node';
import type { Output } from './cli.ts';

export interface MigrateOptions {
  /** Print what would change and write nothing. */
  dryRun?: boolean;
}

const SUMMARY_LINES: [keyof MigrateSummary, string][] = [
  ['stepFreeToNull', 'step_free: 계단·턱 있음(false) → 모름(null) (현장 확인 없음, 경사로 포함)'],
  ['elevatorEdgeStepFreeTrue', 'step_free: 엘리베이터 구간 → 있음(true)'],
  ['stepFreeFilled', 'step_free: 값이 없던 구간에 기본값 채움'],
  ['elevatorIdFromShaft', 'elevator_id: 기존 shaft_id 값을 옮김'],
  ['elevatorIdGenerated', 'elevator_id: 새로 채움'],
  ['shaftIdRemoved', 'shaft_id 지움'],
  ['revAdded', 'rev: 1 추가'],
  ['schemaVersionSet', 'campus.json에 schema_version 추가'],
];

/**
 * Migrate v0.1 campus folders to v0.2 (docs/v0.2/SPEC-v0.2.md §2). `targets` are campus folders
 * (they hold campus.json) or folders of campus folders. Nothing is written unless every campus
 * migrates cleanly. Returns the process exit code: 1 on problems, otherwise 0.
 */
export async function runMigrate(
  targets: string[],
  options: MigrateOptions = {},
  out: Output = console,
  cwd = process.cwd(),
): Promise<number> {
  const campuses: string[] = [];
  for (const target of targets) {
    if (!(await isDirectory(target))) {
      out.error(`폴더를 찾을 수 없습니다: ${display(cwd, target)}`);
      return 1;
    }
    campuses.push(...(await campusFolders(target)));
  }
  if (campuses.length === 0) {
    out.log('바꿀 캠퍼스가 없습니다.');
    return 0;
  }

  const pending: { dir: string; files: { path: string; text: string }[] }[] = [];
  let problemCount = 0;
  for (const dir of campuses) {
    const result = migrateCampusFiles(await readCampusFiles(dir));
    const shown = display(cwd, dir);
    out.log(`■ ${shown} — 바뀌는 파일 ${result.files.length}개`);

    for (const problem of result.problems) {
      problemCount++;
      out.error(`  멈춤 [${problem.code}] ${problem.message}`);
      for (const n of problem.nodes ?? []) {
        out.error(`    - ${n.id}  shaft_id=${n.shaft_id ?? '(없음)'}  elevator_id=${n.elevator_id ?? '(없음)'}`);
      }
    }
    if (result.problems.length > 0) continue;

    const changes = SUMMARY_LINES.filter(([key]) => result.summary[key] > 0);
    for (const [key, label] of changes) out.log(`  ${label}: ${result.summary[key]}`);
    if (changes.length === 0) out.log('  바꿀 것이 없습니다(이미 v0.2입니다).');
    for (const warning of result.warnings) out.log(`  주의: ${warning}`);
    pending.push({ dir, files: result.files });
  }

  if (problemCount > 0) {
    out.error('');
    out.error('문제가 있어 아무 파일도 쓰지 않았습니다. 위 지점을 고친 뒤 다시 실행해 주세요.');
    return 1;
  }
  if (options.dryRun) {
    out.log('');
    out.log('--dry-run: 파일을 쓰지 않았습니다.');
    return 0;
  }
  for (const { dir, files } of pending) {
    for (const file of files) await writeFile(join(dir, file.path), file.text);
  }
  return 0;
}

/** The folder itself when it holds campus.json, otherwise its subfolders that do. */
async function campusFolders(dir: string): Promise<string[]> {
  if (await isFile(join(dir, 'campus.json'))) return [dir];
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const e of entries.filter((x) => x.isDirectory() && !x.name.startsWith('.')).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (await isFile(join(dir, e.name, 'campus.json'))) found.push(join(dir, e.name));
  }
  return found;
}

function display(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  if (rel === '') return '.';
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
