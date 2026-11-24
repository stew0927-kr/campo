import { createReadOnlySource, type ReadConfig } from './remote.ts';
import { createPhotoReader } from './photos.ts';
import type { ContentSource } from './types.ts';
import type { PhotoCatalog } from '../../contracts.ts';
export interface AppConnection { source: ContentSource | null; readPhotos: (() => Promise<PhotoCatalog>) | null; notice: string | null }
export function connectionFromValues(url?: string, publicKey?: string, fetcher: typeof fetch = fetch): AppConnection {
  if (!url || !publicKey) return { source: null, readPhotos: null, notice: '서버에 연결할 수 없어 예시 정보를 표시합니다.' };
  try {
    const config: ReadConfig = { url, publicKey };
    return { source: createReadOnlySource(config, fetcher), readPhotos: createPhotoReader(config, fetcher), notice: null };
  } catch {
    return { source: null, readPhotos: null, notice: '서버에 연결할 수 없어 예시 정보를 표시합니다.' };
  }
}
