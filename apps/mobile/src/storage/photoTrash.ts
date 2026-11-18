// A deleted photo's file is not thrown away at once: 되돌리기 must be able to bring the photo back. It is moved to
// photos/deleted/<name> and, as the walk changes (the delete, an undo, a redo), moved back or out again so that the files
// follow the session's list of photos. The folder is emptied when the app starts (App.tsx), which is when the space is
// really given back. The exported zip only reads the paths the survey lists, so none of this reaches it.
import { SURVEY_DIR, type FileStore } from './store.ts';

export const PHOTO_TRASH_DIR = `${SURVEY_DIR}/photos/deleted`;

export interface PhotoTrash {
  /** Remember that this photo was deleted at least once, so later `sync`s keep its file in step with the list. */
  track(path: string): void;
  /** Move the files of tracked photos: listed in `live` → back in place, not listed → in the trash. Returns when the moves are done. */
  sync(live: ReadonlySet<string>): Promise<void>;
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export function createPhotoTrash(fs: FileStore, onError: (err: Error) => void = () => {}): PhotoTrash {
  const tracked = new Set<string>();
  /** Where each tracked file is now, as far as this run knows. */
  const inTrash = new Set<string>();
  let queue: Promise<void> = Promise.resolve();
  return {
    track: (path) => void tracked.add(path),
    sync(live) {
      const wanted = [...tracked].map((path) => ({ path, out: !live.has(path) }));
      queue = queue.then(async () => {
        for (const { path, out } of wanted) {
          if (out === inTrash.has(path)) continue;
          const place = `${SURVEY_DIR}/${path}`;
          const trash = `${PHOTO_TRASH_DIR}/${nameOf(path)}`;
          try {
            await (out ? fs.move(place, trash) : fs.move(trash, place));
            if (out) inTrash.add(path);
            else inTrash.delete(path);
          } catch (err) {
            // A file that is not there (never saved, or already gone) has nothing to move; the list is what matters.
            onError(err as Error);
          }
        }
      });
      return queue;
    },
  };
}

/** Empty the trash: what was deleted in an earlier run can no longer be undone. */
export async function emptyPhotoTrash(fs: FileStore): Promise<void> {
  await fs.removeTree(PHOTO_TRASH_DIR);
}
