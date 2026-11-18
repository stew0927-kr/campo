// 경로 위 사진 썸네일. <Map> 안에 넣는다. 썸네일은 GL로 그리고(GeoJSONSource 점 + symbol Layer + Images),
// 지금 단계 하나만 RN View(Marker)로 크게 강조한다. 썸네일은 공급자가 준 thumbUrl에서 받는다(앱에 번들하지 않는다).
// MapLibre RN 11.5.1 이름: Map / GeoJSONSource(data, onPress, hitbox) / Layer(type, layout, paint) / Images / Marker(lngLat).
//
// 사용 예:
//   const stepPhotos = useRoutePhotos(route.route, catalog);
//   <Map mapStyle={OSM_RASTER_STYLE}>
//     <Camera center={…} zoom={17} bearing={0} />
//     <RoutePhotoMarkers stepPhotos={stepPhotos} currentIndex={current} onOpen={(i) => setViewerIndex(i)} />
//   </Map>
import { GeoJSONSource, Images, Layer, Marker } from '@maplibre/maplibre-react-native';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { RouteStepPhoto } from '../contracts.ts';
import { markerIndexOf, photoMarkerFeatures, thumbImages } from './viewerModel.ts';

export interface RoutePhotoMarkersProps {
  /** useRoutePhotos의 결과. 사진이 없는 단계는 그리지 않는다. */
  stepPhotos: readonly RouteStepPhoto[];
  /** 지금 안내 중인 단계(stepPhotos 안의 위치). 이 단계만 크게 강조한다. 없으면 강조하지 않는다. */
  currentIndex?: number | null;
  /** 썸네일을 누르면 그 단계 위치로 뷰어를 연다. */
  onOpen: (index: number) => void;
}

/** 탭 영역: 아이콘 둘레로 22px씩, 합쳐서 44pt 이상. */
const HITBOX = { top: 22, right: 22, bottom: 22, left: 22 };
/** 썸네일 원본(공급자 기준 96~128px)을 지도에 그릴 배율. */
const ICON_SIZE = 0.5;

export function RoutePhotoMarkers({ stepPhotos, currentIndex = null, onOpen }: RoutePhotoMarkersProps) {
  const data = useMemo(() => photoMarkerFeatures(stepPhotos), [stepPhotos]);
  const images = useMemo(() => thumbImages(stepPhotos), [stepPhotos]);
  const current = currentIndex !== null ? stepPhotos[currentIndex] : undefined;
  const others: ['!=', ['get', string], number] = ['!=', ['get', 'index'], currentIndex ?? -1];

  if (data.features.length === 0) return null;
  return (
    <>
      <Images images={images} />
      <GeoJSONSource
        id="route-photos"
        data={data}
        hitbox={HITBOX}
        onPress={(event) => {
          const index = markerIndexOf(event.nativeEvent.features[0]);
          if (index === null) return;
          event.stopPropagation();
          onOpen(index);
        }}
      >
        <Layer
          type="symbol"
          id="route-photo-thumbs"
          filter={others}
          layout={{
            'icon-image': ['get', 'icon'],
            'icon-size': ICON_SIZE,
            'icon-allow-overlap': false,
            'symbol-sort-key': ['get', 'index'],
            'icon-rotation-alignment': 'viewport',
            'icon-pitch-alignment': 'viewport',
          }}
        />
        {/* "정면이 아닐 수 있음" 사진: 썸네일 오른쪽 위에 검은 테두리의 노란 원(글꼴이 없는 래스터 스타일이라 원으로 그린다). */}
        <Layer
          type="circle"
          id="route-photo-warn"
          filter={['all', ['==', ['get', 'warn'], true], others]}
          paint={{
            'circle-radius': 7,
            'circle-color': '#FFD400',
            'circle-stroke-color': '#000000',
            'circle-stroke-width': 2,
            'circle-translate': [18, -18],
            'circle-pitch-alignment': 'viewport',
          }}
        />
      </GeoJSONSource>
      {current?.photo && current.lngLat && (
        <Marker id="route-photo-current" lngLat={current.lngLat} anchor="bottom" onPress={() => onOpen(currentIndex!)}>
          <View
            style={styles.current}
            accessible
            accessibilityRole="imagebutton"
            accessibilityLabel={`지금 단계 사진${current.badge ? `, ${current.badge}` : ''}. 눌러서 크게 보기`}
          >
            <Image source={{ uri: current.photo.thumbUrl }} cachePolicy="memory-disk" contentFit="cover" style={styles.thumb} />
            {current.badge !== null && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>!</Text>
              </View>
            )}
          </View>
        </Marker>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  current: { width: 72, height: 72, borderRadius: 10, borderWidth: 3, borderColor: '#FFFFFF', backgroundColor: '#000000', overflow: 'visible' },
  thumb: { width: '100%', height: '100%', borderRadius: 8 },
  badge: {
    position: 'absolute', top: -8, right: -8, minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: '#FFD400', borderWidth: 2, borderColor: '#000000', alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#000000', fontSize: 14, fontWeight: '800' },
});
