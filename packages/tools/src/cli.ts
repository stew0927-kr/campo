import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { validateCampus, type ValidationIssue } from '@campo/core';
import { loadCampus } from '@campo/core/node';

export interface Output {
  log: (line: string) => void;
  error: (line: string) => void;
}

/**
 * Validate every campus folder directly under `campusesDir` (SPEC §7).
 * Returns the process exit code: 1 if any campus has errors, otherwise 0.
 */
export async function runValidate(campusesDir: string, out: Output = console, cwd = process.cwd()): Promise<number> {
  const shown = display(cwd, campusesDir);
  if (!(await isDirectory(campusesDir))) {
    out.error(`캠퍼스 폴더를 찾을 수 없습니다: ${shown}`);
    return 1;
  }

  const entries = await readdir(campusesDir, { withFileTypes: true });
  const campuses = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
  if (campuses.length === 0) {
    out.log(`검사할 캠퍼스가 없습니다: ${shown}`);
    return 0;
  }

  let totalErrors = 0;
  let totalWarnings = 0;
  for (const name of campuses) {
    const dir = join(campusesDir, name);
    const { errors, warnings } = validateCampus(await loadCampus(dir));
    totalErrors += errors.length;
    totalWarnings += warnings.length;

    const prefix = display(cwd, dir);
    out.log(`■ ${name} — 오류 ${errors.length}개, 경고 ${warnings.length}개`);
    for (const issue of errors) out.error(`  오류 ${format(prefix, issue)}`);
    for (const issue of warnings) out.log(`  경고 ${format(prefix, issue)}`);
  }

  out.log('');
  out.log(`캠퍼스 ${campuses.length}곳 검사 완료: 오류 ${totalErrors}개, 경고 ${totalWarnings}개`);
  return totalErrors > 0 ? 1 : 0;
}

function format(prefix: string, issue: ValidationIssue): string {
  const where = `${prefix}/${issue.file}${issue.featureId ? ` #${issue.featureId}` : ''}`;
  return `[${issue.code}] ${where}: ${issue.message}`;
}

/** Path relative to cwd when it is inside cwd, absolute otherwise. */
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
