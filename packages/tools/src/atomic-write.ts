// All-or-nothing file replacement that also works on Windows (every step is a plain write, rename or remove inside
// one folder, so a half-written target never appears):
//   1. write every new content to a temp file next to its target,
//   2. move each original to .bak, then move the temp file into place (files to delete just go to .bak),
//   3. on any failure, put the .bak files back and remove what was placed; on success remove the .bak files.
import { mkdir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** File operations used by commitFiles; tests swap one to simulate a failure in the middle. */
export interface ApplyFs {
  writeFile(path: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  /** Remove an empty folder. */
  rmdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export const nodeFs: ApplyFs = {
  writeFile: (p, t) => writeFile(p, t),
  rename: (a, b) => rename(a, b),
  rm: (p) => rm(p, { force: true }),
  mkdir: async (p) => {
    await mkdir(p);
  },
  rmdir: (p) => rmdir(p),
  exists: async (p) => {
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  },
};

/** One file to replace (text) or delete (null). Absolute path. */
export interface FileOp {
  path: string;
  text: string | null;
}

export const TMP_SUFFIX = '.campo-apply.tmp';
export const BAK_SUFFIX = '.campo-apply.bak';

/** Replace / delete every file in `ops`, or none of them. Throws after rolling back. */
export async function commitFiles(ops: readonly FileOp[], fs: ApplyFs = nodeFs): Promise<void> {
  for (const op of ops) {
    for (const extra of [op.path + TMP_SUFFIX, op.path + BAK_SUFFIX]) {
      if (await fs.exists(extra)) throw new Error(`이전 실행에서 남은 파일이 있습니다. 확인한 뒤 지워 주세요: ${extra}`);
    }
  }

  const createdDirs: string[] = [];
  const tmps: string[] = [];
  const backedUp: string[] = [];
  const placed: string[] = [];
  try {
    for (const op of ops) {
      if (op.text === null) continue;
      for (const dir of await missingDirs(dirname(op.path), fs)) {
        await fs.mkdir(dir);
        createdDirs.push(dir);
      }
      tmps.push(op.path + TMP_SUFFIX);
      await fs.writeFile(op.path + TMP_SUFFIX, op.text);
    }
    for (const op of ops) {
      if (await fs.exists(op.path)) {
        await fs.rename(op.path, op.path + BAK_SUFFIX);
        backedUp.push(op.path);
      }
      if (op.text !== null) {
        await fs.rename(op.path + TMP_SUFFIX, op.path);
        placed.push(op.path);
      }
    }
  } catch (err) {
    const problems = await rollback(fs, { createdDirs, tmps, backedUp, placed });
    if (problems.length > 0) {
      throw new Error(`${(err as Error).message}\n되돌리는 중에도 문제가 있었습니다. 직접 확인해 주세요:\n${problems.join('\n')}`);
    }
    throw err;
  }
  for (const path of backedUp) {
    try {
      await fs.rm(path + BAK_SUFFIX);
    } catch {
      // The change is in place; a leftover .bak is only clutter and the next run reports it.
    }
  }
}

async function rollback(
  fs: ApplyFs,
  done: { createdDirs: string[]; tmps: string[]; backedUp: string[]; placed: string[] },
): Promise<string[]> {
  const problems: string[] = [];
  const attempt = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      problems.push(`${what}: ${(e as Error).message}`);
    }
  };
  for (const path of [...done.placed].reverse()) await attempt(`지우기 ${path}`, () => fs.rm(path));
  for (const path of [...done.backedUp].reverse()) await attempt(`되살리기 ${path}`, () => fs.rename(path + BAK_SUFFIX, path));
  for (const tmp of done.tmps) await attempt(`지우기 ${tmp}`, () => fs.rm(tmp));
  for (const dir of [...done.createdDirs].reverse()) await attempt(`폴더 지우기 ${dir}`, () => fs.rmdir(dir));
  return problems;
}

/** Folders from the first missing ancestor of `dir` down to `dir`. */
async function missingDirs(dir: string, fs: ApplyFs): Promise<string[]> {
  const out: string[] = [];
  let d = dir;
  while (!(await fs.exists(d))) {
    out.unshift(d);
    const up = dirname(d);
    if (up === d) break;
    d = up;
  }
  return out;
}
