// 앱이 포그라운드로 돌아오면, 서버 지도를 받은 지 CAMPUS_REFRESH_MS(10분)가 지났을 때만 다시 받는다.
// 실기기에서 앱을 켜 둔 채 관리자 웹에서 지도를 저장해도, 앱을 다시 켜지 않고 들어온다.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { campusFetchedAt, isCampusStale, refreshCampusBundle } from '../../hooks/useCampusBundle.ts';

export function useCampusAutoRefresh(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && isCampusStale(campusFetchedAt(), Date.now())) void refreshCampusBundle();
    });
    return () => sub.remove();
  }, [enabled]);
}
