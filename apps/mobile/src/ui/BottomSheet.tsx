// A sheet that slides up from the bottom edge, where the thumb already is. Closed by the backdrop, the 닫기 button,
// or by dragging the handle down.
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOUCH, color, font, radius, space } from './theme.ts';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

const CLOSE_DRAG_PX = 90;

export function BottomSheet({ title, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const offset = useRef(new Animated.Value(height)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const slide = Animated.spring(offset, { toValue: 0, useNativeDriver: true, bounciness: 2, speed: 18 });
    slide.start();
    return () => slide.stop();
  }, [offset]);

  const drag = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
    onPanResponderMove: (_e, g) => offset.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_e, g) => {
      if (g.dy > CLOSE_DRAG_PX || g.vy > 1.2) onCloseRef.current();
      else Animated.spring(offset, { toValue: 0, useNativeDriver: true, bounciness: 2 }).start();
    },
    onPanResponderTerminate: () => Animated.spring(offset, { toValue: 0, useNativeDriver: true }).start(),
  }), [offset]);

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="닫기" accessibilityRole="button" />
      <Animated.View style={[styles.sheet, { maxHeight: height * 0.86, paddingBottom: insets.bottom + space.lg, transform: [{ translateY: offset }] }]}>
        <View {...drag.panHandlers} style={styles.grab} accessibilityLabel="아래로 끌어 닫기">
          <View style={styles.handle} />
        </View>
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">{title}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="닫기" style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}>
            <Text style={styles.closeLabel}>닫기</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: color.backdrop },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: color.bg,
    borderTopLeftRadius: radius.md * 1.5, borderTopRightRadius: radius.md * 1.5, elevation: 24,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: -4 },
  },
  grab: { height: 28, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 48, height: 5, borderRadius: 3, backgroundColor: color.line },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space.xl, paddingRight: space.sm },
  title: { fontSize: font.title, fontWeight: '800', color: color.ink, flexShrink: 1 },
  close: { minHeight: TOUCH, minWidth: TOUCH + space.lg, alignItems: 'center', justifyContent: 'center' },
  closeLabel: { fontSize: font.body, fontWeight: '600', color: color.inkSoft },
  body: { paddingHorizontal: space.xl, paddingBottom: space.sm },
});
