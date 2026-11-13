// FileStore on the phone: the app's document folder (kept until the app is removed) and the cache folder for the shared zip.
import { Directory, File, Paths } from 'expo-file-system';
import type { FileStore } from './store.ts';

const at = (path: string): File => new File(Paths.document, path);

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
};
