// Mini map of the split roadview. The native MapLibre map is loaded only in the development app (like MapCanvas);
// Expo Go and the web show a compass drawing with the same field-of-view cone.
import Constants from 'expo-constants';
import type { ComponentType } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { headingLabel } from '../../photos/demoPhotoArt.ts';
import type { RoadviewMiniMapProps } from './roadviewTypes.ts';

export function RoadviewMiniMap(props: RoadviewMiniMapProps) {
  if (Platform.OS === 'web' || Constants.executionEnvironment === 'storeClient') return <CompassMiniMap {...props} />;
  const Native = (require('./RoadviewMiniMapNative.tsx') as { RoadviewMiniMapNative: ComponentType<RoadviewMiniMapProps> }).RoadviewMiniMapNative;
  return <Native {...props} />;
}

/** Map-less fallback: north-up compass with the viewing cone rotated to the photo's heading. */
export function CompassMiniMap({ headingDeg, hfovDeg = 65, label }: RoadviewMiniMapProps) {
  const half = Math.min(80, Math.max(10, hfovDeg / 2));
  const R = 70;
  const w = Math.round(Math.tan((half * Math.PI) / 180) * R);
  return <View style={s.root} accessible accessibilityLabel={`${label}. ${headingLabel(headingDeg)} 방향을 보고 있습니다`}>
    <View style={s.ring}>
      <Text style={[s.dir, { top: 4 }]}>북</Text><Text style={[s.dir, { bottom: 4 }]}>남</Text>
      <Text style={[s.dir, { left: 8, top: '45%' }]}>서</Text><Text style={[s.dir, { right: 8, top: '45%' }]}>동</Text>
      {headingDeg !== null && <View style={[s.coneWrap, { transform: [{ rotate: `${headingDeg}deg` }] }]}>
        <View style={{ width: 0, height: 0, borderLeftWidth: w, borderRightWidth: w, borderTopWidth: R, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: 'rgba(31,94,255,0.35)', marginTop: -R }} />
      </View>}
      <View style={s.dot} />
    </View>
    <Text style={s.caption}>지도 대신 방향만 표시합니다 · {headingLabel(headingDeg)}</Text>
  </View>;
}
const s = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8EEE9', gap: 8 },
  ring: { width: 170, height: 170, borderRadius: 85, borderWidth: 2, borderColor: '#9AA8B8', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F7F5' },
  dir: { position: 'absolute', fontSize: 12, fontWeight: '800', color: '#596579' },
  coneWrap: { position: 'absolute', width: 140, height: 140, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#1F5EFF', borderWidth: 3, borderColor: 'white' },
  caption: { fontSize: 12, color: '#596579' },
});
