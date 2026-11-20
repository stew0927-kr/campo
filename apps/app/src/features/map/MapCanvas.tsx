import Constants from 'expo-constants';
import { Platform, View } from 'react-native';
import type { ComponentType } from 'react';
import type { MapProps } from './mapTypes.ts';
import { Body, Notice } from '../../ui/kit.tsx';
export function MapCanvas(props: MapProps) {
  // Keep the native module out of Expo Go/web execution. No packages or shared config are changed.
  if (Platform.OS === 'web' || Constants.executionEnvironment === 'storeClient') {
    return <View style={{ height: 200, padding: 16, gap: 10 }}><Notice>실제 지도는 MapLibre가 포함된 Android 개발 앱에서 확인해 주세요.</Notice><Body>{props.label} · 검색·목록·경로 안내는 계속 확인할 수 있습니다.</Body></View>;
  }
  const NativeMap = (require('./CampusMap.tsx') as { CampusMap: ComponentType<MapProps> }).CampusMap;
  return <NativeMap {...props} />;
}
