// 앱에 번들된 캠퍼스(assets/campus.generated.json)를 읽는 유일한 곳. 이 파일만 생성된 JSON을 import하므로,
// 테스트는 이 모듈을 거치지 않고 loadBundledCampus에 직접 번들을 넘긴다.
import bundle from '../../assets/campus.generated.json';
import type { BundledCampus } from './types.ts';

export const bundledCampus = bundle as unknown as BundledCampus;
