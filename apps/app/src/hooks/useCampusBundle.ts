// useCampusBundle: 앱이 켜질 때 서버 캠퍼스 지도를 한 번만 요청하고, 결과를 모든 화면이 나눠 쓴다(지도 탭·축제 부스 지도).
// 결과가 오기 전에는 null — 그동안 useCampusData는 앱에 들어 있는 지도를 쓰고, 서버 지도가 오면 한 번 바꾼다.
// 앱을 다시 켜면 다시 받는다(실행 중에 저장된 지도는 다음 실행에 들어온다).
import { useEffect, useSyncExternalStore } from 'react';
import { loadRemoteCampus, type CampusMapReader, type RemoteCampus } from '../campus/remote.ts';
import { APP_CONNECTION } from '../features/content/configured.ts';

let request: Promise<RemoteCampus> | null = null;
let result: RemoteCampus | null = null;
const listeners = new Set<() => void>();

/** 처음 부를 때만 요청한다. 테스트는 reader를 넘길 수 있다. */
export function startCampusBundle(read: CampusMapReader | null = APP_CONNECTION.readCampus): Promise<RemoteCampus> {
  if (!request) {
    request = loadRemoteCampus(read).then((value) => {
      result = value;
      for (const listener of listeners) listener();
      return value;
    });
  }
  return request;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 서버 지도 요청의 결과(아직이면 null). */
export function useCampusBundle(): RemoteCampus | null {
  const value = useSyncExternalStore(subscribe, () => result, () => result);
  useEffect(() => {
    void startCampusBundle();
  }, []);
  return value;
}
