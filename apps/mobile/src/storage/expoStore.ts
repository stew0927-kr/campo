// FileStore on the phone: the app's document folder (kept until the app is removed) and the cache folder for the shared zip.
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import type { FileStore } from './store.ts';

const at = (path: string): File => new File(Paths.document, path);

/** The file:// URI of a file in the document folder (`path` is relative to it, like every FileStore path), for an Image. */
export const photoUri = (path: string): string => at(path).uri;

function ensureParent(file: File): void {
  const dir = file.parentDirectory;
  if (!dir.exists) dir.create({ intermediates: true });
}

export const expoStore: FileStore = {
  async readText(path) {
    const file = at(path);
    return file.exists ? file.text() : null;
  },
  async writeText(path, text) {
    const file = at(path);
    ensureParent(file);
    if (!file.exists) file.create();
    await file.write(text);
  },
  async move(from, to) {
    const target = at(to);
    ensureParent(target);
    await at(from).move(target, { overwrite: true });
  },
  async remove(path) {
    const file = at(path);
    if (file.exists) file.delete();
  },
  async removeTree(path) {
    const dir = new Directory(Paths.document, path);
    if (dir.exists) dir.delete();
  },
  async importFile(sourceUri, path) {
    const target = at(path);
    ensureParent(target);
    await new File(sourceUri).copy(target, { overwrite: true });
  },
  async readBytes(path) {
    const file = at(path);
    return file.exists ? file.bytes() : null;
  },
  async writeShared(name, bytes) {
    const file = new File(Paths.cache, name);
    if (!file.exists) file.create();
    await file.write(bytes);
    return file.uri;
  },
  async openShared(name) {
    const file = new File(Paths.cache, name);
    if (!file.exists) file.create();
    // Truncate: an older zip of the same name must not leave its tail behind.
    const handle = file.open(FileMode.Truncate);
    let open = true;
    const shut = () => {
      if (open) handle.close();
      open = false;
    };
    return {
      // Awaited one after another: the handle's writes are only in order when each is awaited.
      write: (chunk) => handle.writeBytes(chunk),
      async close() {
        shut();
        return file.uri;
      },
      async abort() {
        shut();
        if (file.exists) file.delete();
      },
    };
  },
};
