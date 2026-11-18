// The line under the top bar that shows the barometer and the compass. It is the only part of the screen that re-renders at
// sensor rate; the screen itself reads the newest values through `into` when a record is made.
import { useEffect, type RefObject } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useHeading, usePressure } from '../sensors/device.ts';
import { relativeHeight, type PressureReading } from '../survey/readings.ts';
import { isoLocal } from '../time.ts';
import { color, font, radius, space } from './theme.ts';

/** The newest readings; null when the phone has no such sensor or nothing was read yet. */
export interface SensorValues {
  pressureHpa: number | null;
  headingDeg: number | null;
  /** The compass accuracy class with headingDeg (3 best, 0 unreliable); left out when the sensor does not say. */
  headingAccuracy?: 0 | 1 | 2 | 3 | null;
  /** Which north headingDeg is against; left out without a heading. */
  headingRef?: 'true' | 'magnetic' | null;
}

/**
 * `reference`: the pressure read where the last point was recorded in this walk. Within half an hour of it the line also
 * shows how much higher or lower the phone is now (the same window the records use for a height).
 */
export function SensorReadout({ into, reference }: { into: RefObject<SensorValues>; reference: PressureReading | null }) {
  const pressure = usePressure();
  const heading = useHeading();

  useEffect(() => {
    into.current = {
      pressureHpa: pressure.value ?? null,
      headingDeg: heading.value ?? null,
      headingAccuracy: heading.value === undefined ? null : heading.accuracy ?? null,
      headingRef: heading.value === undefined ? null : heading.ref,
    };
  }, [into, pressure.value, heading.value, heading.accuracy, heading.ref]);
  // Nothing stale is left for a record made after this line is gone.
  useEffect(() => () => {
    into.current = { pressureHpa: null, headingDeg: null };
  }, [into]);

  const parts = [
    pressure.available === false ? '기압계 없음' : pressure.value !== undefined ? `기압 ${pressure.value.toFixed(1)} hPa` : '기압 읽는 중',
    heading.available === false ? '나침반 없음' : heading.value !== undefined ? `방향 ${Math.round(heading.value)}°` : '방향 읽는 중',
  ];
  const rise = relativeHeight(reference, pressure.value ?? null, isoLocal(new Date()));
  if (rise !== null) parts.push(`직전 지점 대비 ${rise >= 0 ? '+' : '−'}${Math.abs(rise).toFixed(1)} m`);
  const text = parts.join(' · ');
  return <Text style={styles.readings} accessibilityLabel={text}>{text}</Text>;
}

const styles = StyleSheet.create({
  readings: {
    alignSelf: 'flex-start', fontSize: font.small, fontWeight: '600', color: color.inkSoft, fontVariant: ['tabular-nums'],
    backgroundColor: 'rgba(255,255,255,0.85)', paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, overflow: 'hidden',
  },
});
