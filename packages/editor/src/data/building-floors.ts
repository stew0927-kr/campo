// 한양대학교 서울캠퍼스 건물 층수 기본값. "OSM 건물 가져오기"(model/osm.ts planOsmBuilding)가 건물의 osmId로 이 표를 찾아,
// 있으면 OSM의 building:levels 대신 이 층 목록을 처음 값으로 넣는다. 가져온 뒤의 층은 상세 정보에서 자유롭게 고칠 수 있다.
import type { Level } from '@campo/core';

export interface FloorSpec { levels: Level[]; basement: number; above: number; source: string }

export const FLOOR_OVERRIDES: Record<string, FloorSpec> = {
  w187185123: { levels: [1, 2, 3], basement: 0, above: 3, source: 'L,MAP' }, // 역사관(구본관)
  w187185124: { levels: [-1, 1, 2, 3, 4, 5, 6], basement: 1, above: 6, source: 'W,L' }, // 본관(신본관)
  w187436420: { levels: [1], basement: 0, above: 1, source: 'W,MAP' }, // 애지문(한양대역 2번출구)
  w187162486: { levels: [1, 2, 3, 4, 5, 6], basement: 0, above: 6, source: 'W,MAP' }, // 한양플라자(학생복지관)
  w187378628: { levels: [1], basement: 0, above: 1, source: 'MAP' }, // 우체국
  w187178762: { levels: [-1, 1, 2, 3, 4, 5], basement: 1, above: 5, source: 'W' }, // 학생회관
  w187162277: { levels: [-1, 1, 2, 3, 4, 5, 6, 7], basement: 1, above: 7, source: 'W,L' }, // 국제관
  w187162278: { levels: [-2, -1, 1, 2, 3, 4, 5, 6, 7], basement: 2, above: 7, source: 'L' }, // 토건관(국제관 부속)
  w187181233: { levels: [-2, -1, 1, 2, 3, 4, 5], basement: 2, above: 5, source: 'L' }, // 박물관
  w187181232: { levels: [-2, -1, 1, 2, 3, 4, 5, 6, 7], basement: 2, above: 7, source: 'W,NM' }, // 재성토목관
  w470423960: { levels: [-3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9], basement: 3, above: 9, source: 'W' }, // 건축관
  w187181263: { levels: [-3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9], basement: 3, above: 9, source: 'L,W' }, // 과학기술관
  w187181255: { levels: [-2, -1, 1, 2, 3, 4, 5, 6, 7], basement: 2, above: 7, source: 'W,MAP' }, // 신소재공학관
  w187181258: { levels: [-1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], basement: 1, above: 12, source: 'W,L' }, // 퓨전테크놀로지센터(FTC)
  w605156372: { levels: [-1, 1], basement: 1, above: 1, source: 'L' }, // 노천극장
  w608168026: { levels: [-1, 1, 2, 3, 4, 5], basement: 1, above: 5, source: 'W' }, // 정몽구 미래자동차연구센터
  w187181264: { levels: [-2, -1, 1, 2, 3, 4, 5, 6], basement: 2, above: 6, source: 'W,FAB' }, // 제2공학관
  w187181254: { levels: [-1, 1, 2, 3, 4, 5, 6, 7], basement: 1, above: 7, source: 'W,L' }, // 산학기술관
  w187181256: { levels: [-1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], basement: 1, above: 12, source: 'L,W' }, // IT/BT관(제2산학기술관)
  w187181248: { levels: [-2, -1, 1, 2, 3, 4, 5], basement: 2, above: 5, source: 'WP,L' }, // 올림픽체육관
  w187181247: { levels: [-1, 1, 2, 3, 4, 5, 6, 7], basement: 1, above: 7, source: 'W' }, // 생활과학관(생활과학대학)
  w227095946: { levels: [1, 2, 3, 4, 5], basement: 0, above: 5, source: 'W' }, // 제1음악관
  w227095949: { levels: [-1, 1, 2, 3, 4, 5, 6], basement: 1, above: 6, source: 'W' }, // 제2음악관
  w187181243: { levels: [-1, 1, 2, 3, 4, 5], basement: 1, above: 5, source: 'L,W' }, // 백남음악관
  w187181246: { levels: [1, 2, 3], basement: 0, above: 3, source: 'L' }, // 학군단
  w187181253: { levels: [-2, -1, 1, 2, 3, 4, 5, 6, 7], basement: 2, above: 7, source: 'W' }, // 제1법학관
  w187181244: { levels: [1, 2, 3, 4, 5, 6, 7], basement: 0, above: 7, source: 'W' }, // 제2법학관
  w187181234: { levels: [-1, 1, 2, 3, 4, 5, 6, 7], basement: 1, above: 7, source: 'W,L' }, // 제3법학관
  w187181249: { levels: [-2, -1, 1, 2, 3, 4, 5, 6, 7], basement: 2, above: 7, source: 'W' }, // 경제금융관/법학학술정보관
  w187181261: { levels: [-3, -2, -1, 1, 2, 3, 4, 5, 6], basement: 3, above: 6, source: 'LIB,W,L' }, // 백남학술정보관
  w187181257: { levels: [-1, 1, 2], basement: 1, above: 2, source: 'L' }, // 사자가 군것질할 때
  w187178757: { levels: [-1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], basement: 1, above: 10, source: 'L,W' }, // 사회과학관/공공정책대학원
  w187178760: { levels: [-1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], basement: 1, above: 10, source: 'L,W' }, // 사회과학관/공공정책대학원
  w187178761: { levels: [-1, 1, 2, 3, 4, 5, 6], basement: 1, above: 6, source: 'W,L' }, // 사범대학 본관
  w187178754: { levels: [-1, 1, 2, 3], basement: 1, above: 3, source: 'W' }, // 사범대학 별관
  w187178756: { levels: [-2, -1, 1, 2, 3, 4, 5, 6, 7], basement: 2, above: 7, source: 'W,L' }, // 자연과학관
  w1258630694: { levels: [-2, -1, 1, 2, 3, 4, 5], basement: 2, above: 5, source: 'W,L' }, // 인문관
  w187178765: { levels: [1, 2, 3, 4, 5], basement: 0, above: 5, source: 'W' }, // 제1의학관
  w187178766: { levels: [1, 2, 3, 4], basement: 0, above: 4, source: 'L' }, // 제2의학관
  w187178764: { levels: [-1, 1, 2, 3, 4, 5, 6], basement: 1, above: 6, source: 'L' }, // 의과대학 본관
  w187645692: { levels: [-1, 1, 2, 3, 4, 5, 6], basement: 1, above: 6, source: 'W' }, // 동문회관
  w187182896: { levels: [-1, 1, 2, 3, 4], basement: 1, above: 4, source: 'L' }, // 의대계단강의동
  w187178767: { levels: [-2, -1, 1, 2, 3, 4, 5, 6], basement: 2, above: 6, source: 'L,W' }, // 한양종합기술연구원(HIT)
  w187178758: { levels: [-1, 1, 2, 3, 4, 5, 6, 7], basement: 1, above: 7, source: 'L' }, // 사이버2관
  w187181236: { levels: [-2, -1, 1, 2, 3, 4, 5, 6, 7, 8], basement: 2, above: 8, source: 'W,L' }, // 경영관
  w187397391: { levels: [-1, 1, 2, 3, 4, 5], basement: 1, above: 5, source: 'DM' }, // 제1학생생활관
  w187397393: { levels: [-1, 1, 2, 3, 4, 5], basement: 1, above: 5, source: 'DM' }, // 제1학생생활관
  w187397390: { levels: [-1, 1, 2, 3, 4, 5], basement: 1, above: 5, source: 'DM,L' }, // 제3학생생활관
  w227095948: { levels: [-1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], basement: 1, above: 10, source: 'DM,L' }, // 제2학생생활관
  w227097301: { levels: [-1, 1, 2, 3, 4, 5, 6, 7], basement: 1, above: 7, source: 'DM,L' }, // 개나리관(제2학생생활관 A)
};
