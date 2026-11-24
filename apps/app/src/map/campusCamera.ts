// 앱 지도 카메라 한계: 한양대학교(서울캠퍼스) 근방만 보이게 한다.
// bounds는 data/campuses/hanyang-seoul/campus.json의 map_limits.bounds와 같은 값이다
// (편집기도 같은 값을 쓴다. campus.json은 이 앱에서 고치지 않는다).
// 캠퍼스 중심은 (경도 127.045, 위도 37.5572)이고, 이 범위 안에 왕십리역·한양대역·살곶이공원이 모두 들어온다.
// 순서는 MapLibre `maxBounds` 형식인 [서, 남, 동, 북]이다.
export const CAMPUS_MAX_BOUNDS: [number, number, number, number] = [127.028, 37.5437, 127.062, 37.5707];

// 14.5 미만으로 줄이면 서울 전역이 보이므로 막는다. campus.json의 min_zoom(15)보다 한 단계 여유를 둔다.
export const CAMPUS_MIN_ZOOM = 14.5;

// 실내 층 이동·건물 앞 확대까지 쓰는 최대 줌.
export const CAMPUS_MAX_ZOOM = 20;
