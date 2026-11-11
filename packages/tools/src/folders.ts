// Folder helpers shared by the CLIs.
import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

/** The folder itself when it holds campus.json, otherwise its subfolders that do (sorted). */
export async function campusFolders(dir: string): Promise<string[]> {
  if (await isFile(join(dir, 'campus.json'))) return [dir];
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const e of entries.filter((x) => x.isDirectory() && !x.name.startsWith('.')).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (await isFile(join(dir, e.name, 'campus.json'))) found.push(join(dir, e.name));
  }
  return found;
}

/** Path relative to cwd when it is inside cwd, absolute otherwise. */
export function display(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  if (rel === '') return '.';
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
