import { createReadOnlySource, type ReadConfig } from './remote.ts';
import { createPhotoReader } from './photos.ts';
import type { ContentSource } from './types.ts';
import type { PhotoCatalog } from '../../contracts.ts';
export interface AppConnection { source: ContentSource | null; readPhotos: (() => Promise<PhotoCatalog>) | null; notice: string | null }
export function connectionFromValues(url?: string, publicKey?: string, fetcher: typeof fetch = fetch): AppConnection {
  if (!url || !publicKey) return { source: null, readPhotos: null, notice: '서버 연결 정보가 없어 시연용 데이터를 표시합니다.' };
  try {
    const config: ReadConfig = { url, publicKey };
    return { source: createReadOnlySource(config, fetcher), readPhotos: createPhotoReader(config, fetcher), notice: null };
  } catch {
    return { source: null, readPhotos: null, notice: '공개 읽기 연결 설정을 확인해 주세요. 현재는 시연용 데이터를 표시합니다.' };
  }
}
