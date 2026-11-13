import { fileURLToPath } from 'node:url';
import { createIdGen, fromCampus, toFeatures, validateCampus, type EditContext, type EditState, type LoadedCampus } from '@campo/core';
import { loadCampus } from '@campo/core/node';
import type { FileStore } from '../src/storage/store.ts';

const FIXTURE_DIR = fileURLToPath(new URL('../../../packages/core/test/fixtures/campus-basic', import.meta.url));

export const CAMPUS = 'fixture-basic';
/** A month the fixture's own Features do not carry, so the walk's Features can be told apart. */
export const SOURCE = 'field-survey-2031-01';
export const AT = '2026-11-14T10:00:00+09:00';

let cached: { loaded: LoadedCampus; state: EditState } | undefined;

/** core's campus-basic fixture: buildings A (floors 1 to 4), B (1, 2) and C (5), with an outdoor network. */
export async function fixture(): Promise<{ loaded: LoadedCampus; state: EditState }> {
  if (!cached) {
    const loaded = await loadCampus(FIXTURE_DIR);
    const { state, issues } = fromCampus(loaded);
    if (issues.length > 0) throw new Error(`fixture loads with issues: ${JSON.stringify(issues)}`);
    cached = { loaded, state };
  }
  return cached;
}

export const ctx = (seed = 1): EditContext => ({ ids: createIdGen(seed) });

/** Error messages of the full campus check (schema, references, levels, entrances, elevators) for an edit state. */
export function campusErrors(loaded: LoadedCampus, state: EditState): string[] {
  const features = toFeatures(state).map((feature) => ({ file: 'test.geojson', feature }));
  return validateCampus({ meta: loaded.meta, features, fileErrors: [] }).errors.map((e) => `${e.code} ${e.featureId ?? ''} ${e.message}`);
}

/** A FileStore in memory. `failMove` makes the next moves throw (a crash between writing and replacing). */
export function memoryStore() {
  const files = new Map<string, string>();
  const bytes = new Map<string, Uint8Array>();
  const log: string[] = [];
  const store: FileStore & { files: Map<string, string>; bytes: Map<string, Uint8Array>; log: string[]; failMove: boolean; gate: Promise<void> | null } = {
    files,
    bytes,
    log,
    failMove: false,
    gate: null,
    async readText(path) {
      return files.get(path) ?? null;
    },
    async writeText(path, text) {
      log.push(`write ${path}`);
      if (store.gate) await store.gate;
      files.set(path, text);
    },
    async move(from, to) {
      if (store.failMove) throw new Error('move failed');
      log.push(`move ${from} ${to}`);
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    async remove(path) {
      files.delete(path);
      bytes.delete(path);
    },
    async removeTree(path) {
      for (const key of [...bytes.keys()]) if (key.startsWith(`${path}/`)) bytes.delete(key);
    },
    async importFile(sourceUri, path) {
      bytes.set(path, new TextEncoder().encode(sourceUri));
    },
    async readBytes(path) {
      return bytes.get(path) ?? null;
    },
    async writeShared(name, data) {
      bytes.set(`cache/${name}`, data);
      return `file:///cache/${name}`;
    },
  };
  return store;
}
