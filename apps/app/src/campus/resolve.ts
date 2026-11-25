// 번들 한 벌을 화면이 쓰는 CampusData로 바꾼다. React·생성된 JSON을 import하지 않는 순수 함수라 Node 테스트에서 그대로 쓴다.
import { CampusDataError, loadBundledCampus } from './loadBundledCampus.ts';
import type { BundledCampus } from './types.ts';
import type { CampusCounts, CampusData } from '../contracts.ts';

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
