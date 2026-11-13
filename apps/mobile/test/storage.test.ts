// Saving the walk on the phone: a crash at any moment leaves a readable snapshot, and saves never overlap.
import { describe, expect, it } from 'vitest';
import { OUTDOOR } from '../src/model/scope.ts';
import type { SessionSnapshot } from '../src/survey/session.ts';
import { SNAPSHOT_PATH, clearSnapshot, createSaver, loadSnapshot, saveSnapshot } from '../src/storage/store.ts';
import { AT, CAMPUS, memoryStore } from './helpers.ts';

const snapshot = (photoSeq: number): SessionSnapshot => ({
  version: 1, campus: CAMPUS, startedAt: AT, changeset: null, anchorId: null, scope: OUTDOOR, attachments: {}, vertical: [], photoSeq,
});
const TMP = `${SNAPSHOT_PATH}.tmp`;

describe('snapshot files', () => {
  it('round trip, and nothing saved reads as null', async () => {
    const store = memoryStore();
    expect(await loadSnapshot(store)).toBeNull();
    await saveSnapshot(store, snapshot(1));
    expect(await loadSnapshot(store)).toEqual(snapshot(1));
    expect([...store.files.keys()]).toEqual([SNAPSHOT_PATH]); // the temporary file is gone
    await store.importFile('file:///camera/1.jpg', 'survey/photos/n_1-1.jpg');
    await clearSnapshot(store);
    expect(await loadSnapshot(store)).toBeNull();
    expect(await store.readBytes('survey/photos/n_1-1.jpg')).toBeNull(); // the photos of the walk go with it
  });

  it('a crash after the write but before the replace: the newer, complete temporary file is used', async () => {
    const store = memoryStore();
    await saveSnapshot(store, snapshot(1));
    store.failMove = true;
    await expect(saveSnapshot(store, snapshot(2))).rejects.toThrow();
    expect(await loadSnapshot(store)).toEqual(snapshot(2));
  });

  it('a crash in the middle of the write: the cut-off temporary file is ignored and the last good snapshot is used', async () => {
    const store = memoryStore();
    await saveSnapshot(store, snapshot(1));
    store.files.set(TMP, JSON.stringify(snapshot(2)).slice(0, 40));
    expect(await loadSnapshot(store)).toEqual(snapshot(1));
  });

  it('a file that is not a snapshot reads as nothing saved', async () => {
    const store = memoryStore();
    store.files.set(SNAPSHOT_PATH, '[]');
    expect(await loadSnapshot(store)).toBeNull();
  });
});

describe('createSaver', () => {
  it('requests made during a save become one more save with the state at that moment', async () => {
    const store = memoryStore();
    let seq = 1;
    const saver = createSaver(store, () => snapshot(seq), () => {});
    let open!: () => void;
    store.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const first = saver.request(); // starts writing snapshot 1 and waits at the gate
    seq = 2;
    const second = saver.request();
    seq = 3;
    const third = saver.request();
    expect(third).toBe(second); // folded together
    store.gate = null;
    open();
    await Promise.all([first, second, third]);
    expect(store.log.filter((l) => l.startsWith('write'))).toHaveLength(2);
    expect(await loadSnapshot(store)).toEqual(snapshot(3));
  });

  it('a failed save is reported and does not stop later saves', async () => {
    const store = memoryStore();
    const errors: string[] = [];
    let seq = 1;
    const saver = createSaver(store, () => snapshot(seq), (err) => errors.push(err.message));
    store.failMove = true;
    await saver.request();
    expect(errors).toEqual(['move failed']);
    store.failMove = false;
    seq = 2;
    await saver.request();
    expect(await loadSnapshot(store)).toEqual(snapshot(2));
    expect(errors).toHaveLength(1);
  });
});
