// Keeping the walk on the phone (docs/mobile/SPEC-mobile.md 5). The device's file API is behind FileStore, so the
// save and recovery rules are tested in Node with a store in memory.
import type { SessionSnapshot } from '../survey/session.ts';

/** Paths are relative to the app's document folder, with forward slashes. */
export interface FileStore {
  /** null when the file is not there. */
  readText(path: string): Promise<string | null>;
  /** Replaces the file. Parent folders are made. */
  writeText(path: string, text: string): Promise<void>;
  /** Moves `from` over `to` (replacing it). */
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Deletes a folder with everything in it. Nothing happens when it is not there. */
  removeTree(path: string): Promise<void>;
  /** Copies a file from anywhere on the device (a camera capture) into the store. */
  importFile(sourceUri: string, path: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array | null>;
  /** Writes into the cache folder and returns the file's URI (for the share sheet). */
  writeShared(name: string, bytes: Uint8Array): Promise<string>;
}

export const SURVEY_DIR = 'survey';
export const SNAPSHOT_PATH = `${SURVEY_DIR}/current.json`;
const SNAPSHOT_TMP = `${SNAPSHOT_PATH}.tmp`;

function parse(text: string | null): SessionSnapshot | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && 'version' in value && 'campus' in value ? (value as SessionSnapshot) : null;
  } catch {
    return null; // cut off in the middle of a write
  }
}

/**
 * Write the snapshot so that a crash at any moment leaves a readable one: the new text goes to a temporary file first
 * and is then moved over the old file.
 */
export async function saveSnapshot(store: FileStore, snapshot: SessionSnapshot): Promise<void> {
  await store.writeText(SNAPSHOT_TMP, JSON.stringify(snapshot));
  await store.move(SNAPSHOT_TMP, SNAPSHOT_PATH);
}

/**
 * The saved walk, or null when there is none. When the move of the last save did not finish, the temporary file is the
 * newer complete copy; a temporary file that is cut off is ignored and the older snapshot is used.
 */
export async function loadSnapshot(store: FileStore): Promise<SessionSnapshot | null> {
  return parse(await store.readText(SNAPSHOT_TMP)) ?? parse(await store.readText(SNAPSHOT_PATH));
}

/** Forget the walk: the snapshot and every photo taken on it. */
export async function clearSnapshot(store: FileStore): Promise<void> {
  await store.remove(SNAPSHOT_TMP);
  await store.remove(SNAPSHOT_PATH);
  await store.removeTree(`${SURVEY_DIR}/photos`);
}

export interface Saver {
  /** Ask for the current snapshot to be saved. Returns when a save that includes it has finished. */
  request(): Promise<void>;
}

/**
 * Saves one at a time. Requests that come in while a save is running are folded into one save that follows it, taking
 * the snapshot at that moment, so writes never overlap and the last state always reaches the disk.
 */
export function createSaver(store: FileStore, snapshot: () => SessionSnapshot, onError: (err: Error) => void): Saver {
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  const once = async (): Promise<void> => {
    try {
      await saveSnapshot(store, snapshot());
    } catch (err) {
      onError(err as Error);
    }
  };
  const request = (): Promise<void> => {
    if (!running) {
      running = once().finally(() => {
        running = null;
      });
      return running;
    }
    queued ??= running.then(() => {
      queued = null;
      return request();
    });
    return queued;
  };
  return { request };
}
