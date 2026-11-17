// 앱에 번들된 캠퍼스 데이터의 모양. scripts/bundle-campus.mjs가 쓰는 것과 같은 형식이다.
import type { CampusGraph, LoadedFile, MatchNetwork } from '@campo/core';
import type { CampusBuilding, CampusCounts, CampusPlace, CampusSummary } from '../contracts.ts';

/** assets/campus.generated.json (커밋하지 않는다). 캠퍼스 폴더의 campus.json과 GeoJSON 파일들. */
export interface BundledCampus {
  campus: string;
  files: LoadedFile[];
}

/** 앱이 들고 있는 캠퍼스 한 벌: 지도 데이터, 길찾기 그래프, GPS 매칭 망, 화면용 목록. */
export interface CampusRuntime {
  info: CampusSummary;
  graph: CampusGraph;
  network: MatchNetwork;
  counts: CampusCounts;
  places: CampusPlace[];
  buildings: CampusBuilding[];
  issues: string[];
}
