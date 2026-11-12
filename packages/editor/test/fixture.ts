import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoadedFile } from '@campo/core';
import { createSession, type Session } from '../src/model/session.ts';

export const FIXTURE = fileURLToPath(new URL('../../core/test/fixtures/campus-basic', import.meta.url));

/** Every file of a campus folder, the way the dev server's GET sends them. */
export function readFolder(dir: string): LoadedFile[] {
  const files: LoadedFile[] = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    files.push({ path: relative(dir, abs).split(sep).join('/'), text: readFileSync(abs, 'utf8') });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

export function fixtureSession(seed = 1): Session {
  return createSession('fixture', readFolder(FIXTURE), seed);
}
