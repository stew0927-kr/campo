// 앱 지도 카메라 한계: 한양대학교(서울캠퍼스) 부지와 바로 붙은 도로·한양대역 출입구까지만 보이게 한다.
// data/campuses/hanyang-seoul/campus.json의 bbox(캠퍼스 부지, [127.0395, 37.553, 127.0505, 37.5615])에
// 동서 약 150 m·남북 약 130 m만 더한 범위다. campus.json의 map_limits.bounds(편집기용, 왕십리역·살곶이공원까지 넓게)
// 안쪽에 있다(campus.json은 이 앱에서 고치지 않는다).
// MapLibre Native의 maxBounds는 카메라 중심을 가두므로, 가장자리에서도 화면 절반 정도의 주변은 보인다.
// 순서는 MapLibre `maxBounds` 형식인 [서, 남, 동, 북]이다.
export const CAMPUS_MAX_BOUNDS: [number, number, number, number] = [127.0378, 37.5518, 127.0522, 37.5628];

// 15 미만으로 줄이면 캠퍼스 밖 동네가 크게 보이므로 막는다. campus.json의 min_zoom(15)과 같다.
export const CAMPUS_MIN_ZOOM = 15;

// 실내 층 이동·건물 앞 확대까지 쓰는 최대 줌.
export const CAMPUS_MAX_ZOOM = 20;
