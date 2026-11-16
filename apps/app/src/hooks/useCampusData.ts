// useCampusData: 앱에 번들된 캠퍼스 데이터를 읽어 화면이 쓸 값으로 돌려준다.
// 데이터는 앱 안에 들어 있으므로 첫 렌더에서 바로 읽는다(네트워크 없음). 그래서 status에 loading이 없다.
import { useCallback, useMemo, useState } from 'react';
import { bundledCampus } from '../campus/bundled.ts';
import { CampusDataError, loadBundledCampus } from '../campus/loadBundledCampus.ts';
import type { BundledCampus } from '../campus/types.ts';
import type { CampusCounts, CampusData, CampusDataApi } from '../contracts.ts';

const NO_COUNTS: CampusCounts = { nodes: 0, edges: 0, buildings: 0 };

/** 번들을 읽어 CampusData로. 실패해도 던지지 않고 error 상태로 돌려준다(화면이 빈 화면으로 남지 않게). */
export function resolveCampusData(bundle: BundledCampus): CampusData {
  try {
    const runtime = loadBundledCampus(bundle);
    return {
      status: 'ready',
      runtime,
      campus: runtime.info,
      graph: runtime.graph,
      network: runtime.network,
      counts: runtime.counts,
      places: runtime.places,
      buildings: runtime.buildings,
      issues: runtime.issues,
      error: null,
    };
  } catch (error) {
    const message = error instanceof CampusDataError ? error.message : `캠퍼스 데이터를 읽는 중 문제가 생겼습니다: ${(error as Error).message}`;
    return {
      status: 'error',
      runtime: null,
      campus: null,
      graph: null,
      network: null,
      counts: NO_COUNTS,
      places: [],
      buildings: [],
      issues: [],
      error: message,
    };
  }
}

/**
 * 앱에 번들된 한양대 서울캠퍼스 데이터(기본값)를 읽는다.
 * @param bundle 다른 캠퍼스를 읽고 싶을 때만 넘긴다(테스트·추후 캠퍼스 선택).
 */
export function useCampusData(bundle: BundledCampus = bundledCampus): CampusDataApi {
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  const data = useMemo(() => resolveCampusData(bundle), [bundle, generation]);
  return useMemo(() => ({ ...data, reload }), [data, reload]);
}
