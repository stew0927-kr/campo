// 사진 방향 설정: a round compass dial fixed on the point, with a fan for the view of the picture. It starts at the
// compass sensor's reading, and a finger dragging round the dial turns it by the angle it goes round, so a heading the
// building's steel has thrown off can be put right by eye against the corridors drawn on the dial (north is up, as on the map).
import { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { BottomSheet } from './BottomSheet.tsx';
import { BigButton } from './controls.tsx';
import { FOV_HALF_DEG, compassWord, dialHeading, fanPath, polar, touchAngle, wholeDegrees } from './dial.ts';
import { TOUCH, color, font, radius, space } from './theme.ts';

interface Props {
  title: string;
  /** The heading to start from (the sensor's reading, or the photo's saved direction); null when the compass gave none. */
  initial: number | null;
  /** The compass now, for [센서 값으로]; null without a compass. */
  sensor: () => number | null;
  /** Directions (degrees from north) of the corridors that leave the point: drawn on the dial to line the fan up with. */
  guides: readonly number[];
  onConfirm: (headingDeg: number) => void;
  onClose: () => void;
}

const SIZE = 240;
const C = SIZE / 2;
const R = 104;

export function CompassDial({ title, initial, sensor, guides, onConfirm, onClose }: Props) {
  const [heading, setHeading] = useState(initial ?? 0);
  const [fromSensor, setFromSensor] = useState(initial !== null);
  const drag = useRef({ startAngle: 0, startHeading: 0 });
  const headingRef = useRef(heading);
  headingRef.current = heading;

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      // The Svg takes no touches (pointerEvents none), so the dial's own view is the target and locationX/Y are its own coordinates.
      const { locationX, locationY } = e.nativeEvent;
      drag.current = { startAngle: touchAngle(locationX - C, locationY - C), startHeading: headingRef.current };
    },
    onPanResponderMove: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      setHeading(dialHeading(drag.current.startHeading, drag.current.startAngle, touchAngle(locationX - C, locationY - C)));
      setFromSensor(false);
    },
  }), []);

  const whole = wholeDegrees(heading);
  const ticks = Array.from({ length: 36 }, (_, i) => i * 10);
  const set = (deg: number): void => {
    setHeading(deg);
    setFromSensor(false);
  };

  return (
    <BottomSheet title={title} onClose={onClose}>
      <Text style={styles.lead}>손가락으로 원을 돌려 사진이 바라보는 방향에 부채꼴을 맞춰 주세요. 점선은 이 지점에서 뻗은 복도입니다.</Text>
      <View style={styles.dialBox} {...responder.panHandlers} accessibilityLabel={`방향 다이얼. 지금 ${whole}도`} accessibilityRole="adjustable">
        <Svg width={SIZE} height={SIZE} pointerEvents="none">
          <Circle cx={C} cy={C} r={R + 12} fill={color.surface} stroke={color.line} strokeWidth={1.5} />
          {ticks.map((deg) => {
            const [x1, y1] = polar(C, C, R + (deg % 90 === 0 ? 2 : 6), deg);
            const [x2, y2] = polar(C, C, R + 11, deg);
            return <Line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color.inkSoft} strokeWidth={deg % 90 === 0 ? 2 : 1} />;
          })}
          {guides.map((g) => {
            const [x, y] = polar(C, C, R, g);
            return <Line key={g} x1={C} y1={C} x2={x} y2={y} stroke={color.edge} strokeWidth={2} strokeDasharray="4 4" />;
          })}
          <Path d={fanPath(C, C, R, heading)} fill={color.accent} fillOpacity={0.28} stroke={color.accent} strokeWidth={2} />
          <G>
            {(['북', '동', '남', '서'] as const).map((w, i) => {
              const [x, y] = polar(C, C, R - 14, i * 90);
              return <SvgText key={w} x={x} y={y + 5} fontSize={14} fontWeight="700" fill={w === '북' ? color.danger : color.inkSoft} textAnchor="middle">{w}</SvgText>;
            })}
          </G>
          {(() => {
            const [x, y] = polar(C, C, R, heading);
            return <Line x1={C} y1={C} x2={x} y2={y} stroke={color.accent} strokeWidth={3.5} strokeLinecap="round" />;
          })()}
          <Circle cx={C} cy={C} r={6} fill={color.ink} stroke={color.surface} strokeWidth={2} />
        </Svg>
      </View>
      <View style={styles.readRow}>
        <Text style={styles.degrees}>{whole}°</Text>
        <Text style={styles.word}>{compassWord(whole)}쪽 · 시야 ±{FOV_HALF_DEG}°{fromSensor ? ' · 센서 값' : ''}</Text>
      </View>
      <View style={styles.row}>
        <Step label="−5°" onPress={() => set(heading - 5)} />
        <Step label="−1°" onPress={() => set(heading - 1)} />
        <Step label="+1°" onPress={() => set(heading + 1)} />
        <Step label="+5°" onPress={() => set(heading + 5)} />
        <Step label="반대쪽" onPress={() => set(heading + 180)} />
      </View>
      <View style={styles.row}>
        <Step label="센서 값으로" onPress={() => { const s = sensor(); if (s !== null) { setHeading(s); setFromSensor(true); } }} />
      </View>
      <BigButton label={`${whole}°로 저장`} onPress={() => onConfirm(whole)} style={styles.save} />
    </BottomSheet>
  );
}

function Step({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.step, pressed && { opacity: 0.6 }]}>
      <Text style={styles.stepLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: font.small, lineHeight: 18, color: color.inkSoft, marginTop: space.sm },
  dialBox: { alignSelf: 'center', width: SIZE, height: SIZE, marginTop: space.md },
  readRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: space.md, marginTop: space.sm },
  degrees: { fontSize: font.display, fontWeight: '800', color: color.ink, fontVariant: ['tabular-nums'] },
  word: { fontSize: font.small, color: color.inkSoft },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm, marginTop: space.sm },
  step: { minHeight: TOUCH, minWidth: TOUCH + 10, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.line, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { fontSize: font.body, fontWeight: '700', color: color.ink },
  save: { marginTop: space.lg },
});
