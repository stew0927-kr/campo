import { View } from 'react-native';
import type { MapProps } from './mapTypes.ts';
import { Body, Notice } from '../../ui/kit.tsx';
export function MapCanvas(props: MapProps) {
  return <View style={{ flex: 1, padding: 16, paddingTop: 160, gap: 10, backgroundColor: '#E8EEE9' }}><Notice>웹에서는 지도 대신 화면 구성을 확인합니다. 지도는 Android 개발 앱에서 확인해 주세요.</Notice><Body>{props.label} · 검색과 경로 요약을 이용해 주세요.</Body></View>;
}
