import { useCallback, useEffect, useState } from 'react';
import { EMPTY_PHOTO_CATALOG, type PhotoCatalog } from '../../contracts.ts';
import { loadWithDemoFallback } from './remote.ts';
import { APP_CONNECTION } from './configured.ts';
import type { AppConnection } from './connection.ts';
import type { ContentData } from './types.ts';
export interface AppContentState {
  status: 'loading' | 'ready'; data: ContentData | null; mode: 'demo' | 'live'; notice: string | null;
  catalog: PhotoCatalog; photoNotice: string;
}
export function useAppContent(connection: AppConnection = APP_CONNECTION) {
  const [state, setState] = useState<AppContentState>({ status: 'loading', data: null, mode: 'demo', notice: null, catalog: EMPTY_PHOTO_CATALOG, photoNotice: '사진 데이터를 확인하고 있습니다.' });
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  useEffect(() => {
    let alive = true;
    // Retrying cannot relabel old demo data as server data. Content and photos fail independently.
    void loadWithDemoFallback(connection.source).then((snapshot) => {
      if (alive) setState((old) => ({ ...old, status: 'ready', data: snapshot.data, mode: snapshot.mode, notice: connection.notice ?? snapshot.notice }));
    });
    if (!connection.readPhotos) {
      setState((old) => ({ ...old, catalog: EMPTY_PHOTO_CATALOG, photoNotice: '사진 공개 읽기 연결 정보가 없습니다.' }));
    } else {
      void connection.readPhotos().then((catalog) => {
        if (alive) setState((old) => ({ ...old, catalog, photoNotice: catalog.size ? `서버 공개 사진 ${catalog.size}장을 읽었습니다. 경로 지점에 연결된 사진을 표시합니다.` : '서버에 공개된 한양대 사진이 없습니다.' }));
      }, () => {
        if (alive) setState((old) => ({ ...old, catalog: EMPTY_PHOTO_CATALOG, photoNotice: '사진 서버에 연결하지 못했습니다. 사진 없이 지도와 문구로 안내합니다.' }));
      });
    }
    return () => { alive = false; };
  }, [connection, generation]);
  return { ...state, reload };
}
