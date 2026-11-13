// The line under the top bar that shows the barometer and the compass. It is the only part of the screen that re-renders at
// sensor rate; the screen itself reads the newest values through `into` when a record is made.
import { useEffect, type RefObject } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useHeading, usePressure } from '../sensors/device.ts';
import { color, font, radius, space } from './theme.ts';

/** The newest readings; null when the phone has no such sensor or nothing was read yet. */
export interface SensorValues {
  pressureHpa: number | null;
  headingDeg: number | null;
}

export function SensorReadout({ into }: { into: RefObject<SensorValues> }) {
  const pressure = usePressure();
  const heading = useHeading();

  useEffect(() => {
    into.current = { pressureHpa: pressure.value ?? null, headingDeg: heading.value ?? null };
  }, [into, pressure.value, heading.value]);
  // Nothing stale is left for a record made after this line is gone.
  useEffect(() => () => {
    into.current = { pressureHpa: null, headingDeg: null };
  }, [into]);

  const text = [
    pressure.available === false ? '기압계 없음' : pressure.value !== undefined ? `기압 ${pressure.value.toFixed(1)} hPa` : '기압 읽는 중',
    heading.available === false ? '나침반 없음' : heading.value !== undefined ? `방향 ${Math.round(heading.value)}°` : '방향 읽는 중',
  ].join(' · ');
  return <Text style={styles.readings} accessibilityLabel={text}>{text}</Text>;
}

const styles = StyleSheet.create({
  readings: {
    alignSelf: 'flex-start', fontSize: font.small, fontWeight: '600', color: color.inkSoft, fontVariant: ['tabular-nums'],
    backgroundColor: 'rgba(255,255,255,0.85)', paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, overflow: 'hidden',
  },
});
