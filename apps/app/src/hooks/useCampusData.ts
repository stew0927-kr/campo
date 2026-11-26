// useCampusData: 캠퍼스 지도를 읽어 화면이 쓸 값으로 돌려준다.
// 기본은 서버(Supabase campus_map_files)에서 받은 지도이고, 받기 전·실패·읽을 수 없는 지도면 앱에 들어 있는 지도다.
// 앱 번들은 첫 렌더에서 바로 읽으므로(네트워크 없음) status에 loading이 없다. 서버 지도가 오면 그것으로 바뀐다.
// 서버 지도는 통째로 쓴다(건물·층 L*.geojson을 앱 번들과 섞지 않는다). 읽을 수 없을 때만 통째로 앱 번들이다.
import { useCallback, useMemo, useState } from 'react';
import { bundledCampus } from '../campus/bundled.ts';
import { campusDataWithFallback } from '../campus/remote.ts';
import { resolveCampusData } from '../campus/resolve.ts';
import type { BundledCampus } from '../campus/types.ts';
import type { CampusDataApi } from '../contracts.ts';
import { bundleKeyOf } from './memoKeys.ts';
import { refreshCampusBundle, useCampusBundle } from './useCampusBundle.ts';

// resolveCampusData는 campus/resolve.ts로 옮겼다(React 없이 테스트하려고). 예전 import 경로도 그대로 쓸 수 있게 다시 내보낸다.
export { resolveCampusData } from '../campus/resolve.ts';

/**
 * 한양대 서울캠퍼스 지도: 서버 지도, 없으면 앱 번들.
 * @param bundle 넘기면 서버 지도 대신 이 번들만 읽는다(개발용 가상 경로·테스트·추후 캠퍼스 선택).
 */
export function useCampusData(bundle?: BundledCampus): CampusDataApi {
  // 훅은 늘 같은 순서로 부른다: 번들을 넘긴 화면도 서버 요청 훅을 부르지만 결과를 쓰지 않는다.
  const remote = useCampusBundle();
  const [generation, setGeneration] = useState(0);
  // 다시 읽기: 모듈 캐시를 비우고 서버 지도를 다시 받는다(앱 재시작 없이 관리자 웹에서 저장한 지도가 들어온다).
  // 번들을 넘긴 화면(개발용 가상 데이터)은 서버에 묻지 않고 그 번들만 다시 읽는다.
  const fromServer = bundle === undefined;
  const reload = useCallback(() => {
    if (fromServer) void refreshCampusBundle();
    setGeneration((value) => value + 1);
  }, [fromServer]);
  // 번들의 내용으로 메모한다: 화면이 매 렌더 새 번들 객체(인라인 bundleFrom(...))를 넘겨도 내용이 같으면 runtime·network가
  // 그대로라서 useGpsMatcher 세션이 새로 만들어지지 않는다. 서버 지도가 앱 번들과 내용이 같으면 키도 같아 다시 읽지 않는다.
  const shown = bundle ?? remote?.bundle ?? bundledCampus;
  const key = `${bundleKeyOf(shown)}|${bundle ? '' : remote?.message ?? ''}`;
  const data = useMemo(
    () => (bundle ? resolveCampusData(bundle) : campusDataWithFallback(remote, bundledCampus)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, generation],
  );
  return useMemo(() => ({ ...data, reload }), [data, reload]);
}
