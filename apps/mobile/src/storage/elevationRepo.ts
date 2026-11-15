// The phone's elevation store (docs/ELEVATION_INTEGRATION.md 7장, 12장): a local JSON file of what a measurement leaves
// behind — the measured points and the Δh edges between them (Δh, σ, Δt). Absolute pressures never get here: they live in
// the PressureSessionBuffer (memory, 30 min) and the repo has no method that takes one. The file is written with
// serializeElevationStore (a whitelist), through a temporary file, so a crash leaves the last good copy.
// The height variables a measurement touched are kept in a second file (markMeasurements), so the editor knows what to
// recompute; both go into the exported zip.
import {
  addMeasurement,
  distanceM,
  emptyDirty,
  emptyElevationStore,
  markMeasurements,
  removeHeightNode,
  serializeElevationStore,
  type AddResult,
  type ElevationDirty,
  type ElevationStore,
  type HeightNode,
  type HeightNodeKey,
  type LatLng,
  type MeasurementSession,
  type OutdoorPointNode,
} from '@campo/core/elevation';
import type { FileStore } from './store.ts';

export const ELEVATION_DIR = 'elevation';
export const ELEVATION_STORE_PATH = `${ELEVATION_DIR}/store.json`;
export const ELEVATION_DIRTY_PATH = `${ELEVATION_DIR}/dirty.json`;
/** A random id made once per install (MeasurementSession.installId): tells phones apart without naming them. */
export const INSTALL_ID_PATH = `${ELEVATION_DIR}/install-id.txt`;
/** Names inside the exported zip (next to survey.json). */
export const ARCHIVE_ELEVATION_STORE = 'elevation_store.json';
export const ARCHIVE_ELEVATION_DIRTY = 'elevation_dirty.json';

/** Where a measurement is saved. Takes the node and the edges the buffer made — never a pressure. */
export interface ElevationRepo {
  commit(node: HeightNode, result: Pick<AddResult, 'newEdges' | 'supersede'>, session?: MeasurementSession): Promise<void>;
}

export interface LocalElevationRepo extends ElevationRepo {
  readonly installId: string;
  current(): ElevationStore;
  /** Measured height variables that got or lost an edge since the store was last handed to a recompute. */
  pending(): ReadonlySet<HeightNodeKey>;
  /** The measured outdoor point within `withinM` of `at` (a re-measurement of the same spot keeps its key: A → B → A). */
  nearestOutdoor(at: LatLng, withinM: number): OutdoorPointNode | null;
  /** The files the exported zip carries (name → text). */
  archiveFiles(): Record<string, string>;
  /**
   * Delete one measured spot: its node and every Δh edge at it. The variables at the other ends of those edges are marked
   * for the recompute; the spot itself leaves the list. (Its pressures in memory are forgotten by the buffer's owner.)
   */
  remove(key: HeightNodeKey): Promise<void>;
  /** Forget every measurement (the buffer in memory is cleared by its own owner). */
  clear(): Promise<void>;
  subscribe(fn: () => void): () => void;
  getRevision(): number;
}

function parseStore(text: string | null): ElevationStore | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as Partial<ElevationStore>;
    return v.schemaVersion === 1 && Array.isArray(v.nodes) && Array.isArray(v.edges) ? (v as ElevationStore) : null;
  } catch {
    return null; // cut off in the middle of a write
  }
}

function parseDirty(text: string | null): HeightNodeKey[] | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as { heightNodes?: unknown };
    return Array.isArray(v.heightNodes) ? (v.heightNodes.filter((k) => typeof k === 'string') as HeightNodeKey[]) : null;
  } catch {
    return null;
  }
}

const dirtyText = (d: ElevationDirty) => `${JSON.stringify({ format: 'campo-elevation-dirty/1', heightNodes: [...d.heightNodes].sort(), campusNodes: [], campusEdges: [], buildings: [] }, null, 2)}\n`;

async function writeAtomic(fs: FileStore, path: string, text: string): Promise<void> {
  await fs.writeText(`${path}.tmp`, text);
  await fs.move(`${path}.tmp`, path);
}

/** Read the store (an unfinished write falls back to the last complete copy) and keep it in memory. */
export function randomId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export async function openElevationRepo(fs: FileStore, newId: () => string = randomId): Promise<LocalElevationRepo> {
  let installId = (await fs.readText(INSTALL_ID_PATH))?.trim() ?? '';
  if (installId === '') {
    installId = newId();
    await fs.writeText(INSTALL_ID_PATH, installId);
  }
  let store = parseStore(await fs.readText(`${ELEVATION_STORE_PATH}.tmp`)) ?? parseStore(await fs.readText(ELEVATION_STORE_PATH)) ?? emptyElevationStore();
  const keys = parseDirty(await fs.readText(`${ELEVATION_DIRTY_PATH}.tmp`)) ?? parseDirty(await fs.readText(ELEVATION_DIRTY_PATH)) ?? [];
  let dirty: ElevationDirty = { ...emptyDirty(), heightNodes: new Set(keys) };
  let revision = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    revision++;
    for (const fn of listeners) fn();
  };
  // One write at a time, in order.
  let queue: Promise<void> = Promise.resolve();
  const persist = () => {
    const s = serializeElevationStore(store);
    const d = dirtyText(dirty);
    queue = queue.then(async () => {
      await writeAtomic(fs, ELEVATION_STORE_PATH, s);
      await writeAtomic(fs, ELEVATION_DIRTY_PATH, d);
    });
    return queue;
  };

  return {
    installId,
    async commit(node, result, session) {
      dirty = markMeasurements(dirty, result, store);
      store = addMeasurement(store, node, result);
      if (session && !store.sessions.some((x) => x.sessionId === session.sessionId)) store = { ...store, sessions: [...store.sessions, session] };
      changed();
      await persist();
    },
    current: () => store,
    pending: () => dirty.heightNodes,
    nearestOutdoor(at, withinM) {
      let best: { n: OutdoorPointNode; d: number } | null = null;
      for (const n of store.nodes) {
        if (n.kind !== 'outdoor_point') continue;
        const d = distanceM(at, n.position);
        if (d <= withinM && (!best || d < best.d)) best = { n, d };
      }
      return best?.n ?? null;
    },
    archiveFiles: () => (store.nodes.length === 0 && store.edges.length === 0 ? {} : {
      [ARCHIVE_ELEVATION_STORE]: serializeElevationStore(store),
      [ARCHIVE_ELEVATION_DIRTY]: dirtyText(dirty),
    }),
    async remove(key) {
      const { store: next, removed } = removeHeightNode(store, key);
      if (next === store) return;
      const heightNodes = new Set(dirty.heightNodes);
      for (const e of removed) heightNodes.add(e.from).add(e.to);
      heightNodes.delete(key);
      dirty = { ...dirty, heightNodes };
      store = next;
      changed();
      await persist();
    },
    async clear() {
      store = emptyElevationStore();
      dirty = emptyDirty();
      changed();
      await persist();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getRevision: () => revision,
  };
}
