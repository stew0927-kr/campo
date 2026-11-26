// useCampusBundle: 서버 캠퍼스 지도를 받아 모든 화면이 나눠 쓴다(지도 탭·축제 부스 지도).
// 결과가 오기 전에는 null — 그동안 useCampusData는 앱에 들어 있는 지도를 쓰고, 서버 지도가 오면 그것으로 바꾼다.
// 처음 부를 때 한 번 받고(모듈 캐시), 그 뒤에는 다음 때만 다시 받는다:
// - refreshCampusBundle(): "지도 새로고침"·useCampusData().reload()
// - 앱이 포그라운드로 돌아왔을 때 받은 지 CAMPUS_REFRESH_MS(10분)가 지났으면(isCampusStale, 지도 화면의 useCampusAutoRefresh)
// 다시 받는 동안에도 지금 지도를 그대로 보이고, 새 답이 오면 바꾼다. 다시 받기에 실패하면(오프라인 등) 이미 받은 서버 지도를 지킨다.
import { useEffect, useSyncExternalStore } from 'react';
import { loadRemoteCampus, type CampusMapReader, type RemoteCampus } from '../campus/remote.ts';
import { APP_CONNECTION } from '../features/content/configured.ts';

/** 포그라운드 복귀 때 이보다 오래된 서버 지도만 다시 받는다(ms). */
export const CAMPUS_REFRESH_MS = 10 * 60 * 1000;

let request: Promise<RemoteCampus> | null = null;
let result: RemoteCampus | null = null;
/** 마지막으로 답을 받은 시각(ms). 아직이면 0. */
let fetchedAt = 0;
/** 요청 번호: 겹친 요청 중 마지막 것만 결과를 바꾼다. */
let generation = 0;
let refreshing = false;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

/** 처음 부를 때(또는 resetCampusBundle 뒤)만 요청한다. 테스트는 reader를 넘길 수 있다. */
export function startCampusBundle(read: CampusMapReader | null = APP_CONNECTION.readCampus): Promise<RemoteCampus> {
  if (!request) {
    const mine = ++generation;
    refreshing = true;
    notify();
    request = loadRemoteCampus(read).then((value) => {
      if (mine !== generation) return value;
      // 다시 받기에 실패했어도 이미 받은 서버 지도가 있으면 그것을 지킨다(앱 번들로 되돌아가 화면이 바뀌지 않게).
      if (!(value.source === 'bundled' && result?.source === 'server')) result = value;
      fetchedAt = Date.now();
      refreshing = false;
      notify();
      return value;
    });
  }
  return request;
}

/**
 * 모듈 캐시를 비운다: 다음 startCampusBundle이 서버에 다시 묻는다. 지금 보이는 지도(result)는 새 답이 올 때까지 둔다.
 * `{ clear: true }`면 보이는 지도도 비운다(테스트·캠퍼스 바꾸기).
 */
export function resetCampusBundle({ clear = false }: { clear?: boolean } = {}): void {
  request = null;
  fetchedAt = 0;
  generation++;
  refreshing = false;
  if (clear) result = null;
  notify();
}

/** 캐시를 비우고 바로 다시 받는다(지도 새로고침). */
export function refreshCampusBundle(read?: CampusMapReader | null): Promise<RemoteCampus> {
  resetCampusBundle();
  return read === undefined ? startCampusBundle() : startCampusBundle(read);
}

/** 받은 지 `maxAgeMs`가 지났는가(아직 한 번도 못 받았으면 true). 포그라운드 복귀 때 다시 받을지 정한다. */
export function isCampusStale(lastFetchedAt: number, now: number, maxAgeMs: number = CAMPUS_REFRESH_MS): boolean {
  return lastFetchedAt <= 0 || now - lastFetchedAt >= maxAgeMs;
}

/** 지금 화면이 보는 서버 지도 결과(아직이면 null). 훅 밖(테스트·진단)에서 읽는다. */
export const currentCampusBundle = (): RemoteCampus | null => result;
/** 마지막으로 서버 답을 받은 시각(ms, 아직이면 0). */
export const campusFetchedAt = (): number => fetchedAt;

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

/** 서버 지도를 받는 중인가("지도 새로고침" 버튼의 진행 표시). */
export function useCampusRefreshing(): boolean {
  return useSyncExternalStore(subscribe, () => refreshing, () => refreshing);
}
