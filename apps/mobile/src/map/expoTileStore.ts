// TileStore on the phone: tiles live in the cache folder (the system may clear it when space is short; the map then
// simply downloads them again).
import { Directory, File, Paths } from 'expo-file-system';
import type { TileStore } from './tileCache.ts';

const root = (): Directory => new Directory(Paths.cache, 'tiles');

function sizeOf(dir: Directory, into: { files: number; bytes: number }): void {
  for (const item of dir.list()) {
    if (item instanceof Directory) sizeOf(item, into);
    else {
      into.files++;
      into.bytes += item.size ?? 0;
    }
  }
}

export const expoTileStore: TileStore = {
  has: (path) => new File(Paths.cache, path).exists,
  uri: (path) => new File(Paths.cache, path).uri,
  async download(url, path, headers) {
    const file = new File(Paths.cache, path);
    const dir = file.parentDirectory;
    if (!dir.exists) dir.create({ intermediates: true });
    try {
      await File.downloadFileAsync(url, file, { headers, idempotent: true });
    } catch (err) {
      if (file.exists) file.delete(); // no half tile is left to be shown later
      throw err;
    }
  },
  usage() {
    const total = { files: 0, bytes: 0 };
    if (root().exists) sizeOf(root(), total);
    return total;
  },
  clear() {
    if (root().exists) root().delete();
  },
};
