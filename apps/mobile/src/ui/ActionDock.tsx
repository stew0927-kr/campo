// The thumb's corner of the survey screen. At rest it is one round menu button at the lower right, so the map keeps the
// screen; a press slides up a translucent vertical menu bar over the map with the records made while walking (지점, 잇기,
// 외부 길, 문, 호실 연속, 화장실, 계단/EV, 에스컬레이터, 출입구) and the tools (선택, 강의실 자동 연결, OSM 건물 가져오기, …).
// Picking one closes the bar. While a mode is on (잇기, 선택, a drawing, a move …) a compact panel across the bottom shows
// only what that mode needs. Everything pressed is TOUCH (38 dp) high or more.
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOUCH, color, font, radius, space } from './theme.ts';

export interface DockAction {
  id: string;
  label: string;
  /** What the press will do right now (read by screen readers, shown small in the menu bar). */
  hint?: string;
  onPress: () => void;
  /** The record made most often gets the primary colour. */
  primary?: boolean;
  disabled?: boolean;
  /** A mode that is on (the button turns dark). */
  active?: boolean;
  tone?: 'danger';
}

/** What replaces the menu while a mode is on. */
export interface DockMode {
  text: string;
  /** A small panel between the text and the buttons (a heading readout, a stopwatch, a room number). */
  extra?: ReactNode;
  actions: readonly DockAction[];
}

interface Props {
  records: readonly DockAction[];
  tools: readonly DockAction[];
  open: boolean;
  onToggle: () => void;
  /** Closes the menu for good (an item was picked): the open state itself goes to false, not just the picture of it. */
  onClose: () => void;
  mode: DockMode | null;
  /** The height the dock takes at the bottom of the screen, so what sits on the map above it (the scale bar) can keep clear. */
  onHeight?: (px: number) => void;
}

/** The round menu button. */
const FAB = 54;

function Btn({ a }: { a: DockAction }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a.label}
      accessibilityHint={a.hint}
      accessibilityState={{ disabled: a.disabled === true, selected: a.active === true }}
      disabled={a.disabled}
      onPress={a.onPress}
      style={({ pressed }) => [styles.btn, a.primary && styles.btnPrimary, a.active && styles.btnActive, a.tone === 'danger' && styles.btnDanger, pressed && styles.pressed, a.disabled && styles.disabled]}
    >
      <Text style={[styles.btnLabel, (a.primary || a.active || a.tone === 'danger') && styles.onColor]} numberOfLines={1}>{a.label}</Text>
    </Pressable>
  );
}

function Row({ actions }: { actions: readonly DockAction[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.rowContent}>
      {actions.map((a) => <Btn key={a.id} a={a} />)}
    </ScrollView>
  );
}

/** One line of the menu bar: the label, and the hint under it. */
function MenuItem({ a, onPicked }: { a: DockAction; onPicked: () => void }) {
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={a.label}
      accessibilityHint={a.hint}
      accessibilityState={{ disabled: a.disabled === true, selected: a.active === true }}
      disabled={a.disabled}
      onPress={() => {
        onPicked();
        a.onPress();
      }}
      style={({ pressed }) => [styles.item, a.primary && styles.itemPrimary, a.active && styles.itemActive, pressed && styles.itemPressed, a.disabled && styles.disabled]}
    >
      <Text style={styles.itemLabel} numberOfLines={1}>{a.label}</Text>
      {a.hint !== undefined && <Text style={styles.itemHint} numberOfLines={1}>{a.hint}</Text>}
    </Pressable>
  );
}

/** Three bars, or a cross while the bar is open. */
function Burger({ open }: { open: boolean }) {
  if (open) {
    return (
      <View style={styles.burger}>
        <View style={[styles.bar, styles.barAbs, { transform: [{ rotate: '45deg' }] }]} />
        <View style={[styles.bar, styles.barAbs, { transform: [{ rotate: '-45deg' }] }]} />
      </View>
    );
  }
  return (
    <View style={[styles.burger, styles.burgerBars]}>
      <View style={styles.bar} />
      <View style={styles.bar} />
      <View style={styles.bar} />
    </View>
  );
}

export function ActionDock({ records, tools, open, onToggle, onClose, mode, onHeight }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const rise = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    const anim = Animated.spring(rise, { toValue: open ? 1 : 0, useNativeDriver: true, bounciness: 3, speed: 22 });
    anim.start();
    return () => anim.stop();
  }, [open, rise]);
  // A mode replaces the menu: the menu goes to rest at once, so no half-risen menu is left when the mode ends.
  useEffect(() => {
    if (mode) rise.setValue(0);
  }, [mode, rise]);
  const bottom = insets.bottom + space.md;

  if (mode) {
    return (
      <View pointerEvents="box-none" style={[styles.dock, { paddingBottom: insets.bottom + space.sm }]} onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}>
        <View style={styles.panel}>
          <Text style={styles.modeText}>{mode.text}</Text>
          {mode.extra}
          <Row actions={mode.actions} />
        </View>
      </View>
    );
  }

  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });
  return (
    <>
      {open && <Pressable style={StyleSheet.absoluteFill} onPress={onToggle} accessibilityLabel="메뉴 닫기" />}
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[styles.menu, { bottom: bottom + FAB + space.md, maxHeight: height * 0.66, opacity: open ? rise : 0, transform: [{ translateY }] }]}
        accessibilityViewIsModal={open}
      >
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.menuBody} showsVerticalScrollIndicator={false}>
          <Text style={styles.section}>기록</Text>
          {records.map((a) => <MenuItem key={a.id} a={a} onPicked={onClose} />)}
          <Text style={[styles.section, styles.sectionGap]}>도구</Text>
          {tools.map((a) => <MenuItem key={a.id} a={a} onPicked={onClose} />)}
        </ScrollView>
      </Animated.View>
      <View pointerEvents="box-none" style={[styles.fabWrap, { bottom }]} onLayout={(e) => onHeight?.(e.nativeEvent.layout.height + space.md)}>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={open ? '메뉴 닫기' : '기록·도구 메뉴 열기'}
          accessibilityState={{ expanded: open }}
          style={({ pressed }) => [styles.fab, open && styles.fabOpen, pressed && styles.pressed]}
        >
          <Burger open={open} />
        </Pressable>
      </View>
    </>
  );
}

const shadow = { elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } } as const;

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md },
  panel: {
    gap: space.sm, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1, borderColor: color.line, ...shadow,
  },
  rowContent: { paddingHorizontal: space.md, gap: space.sm },
  btn: {
    minHeight: TOUCH, minWidth: TOUCH + 12, paddingHorizontal: space.lg, borderRadius: radius.sm, backgroundColor: color.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.line,
  },
  btnPrimary: { backgroundColor: color.primary, borderColor: color.primary },
  btnActive: { backgroundColor: color.ink, borderColor: color.ink },
  btnDanger: { backgroundColor: color.danger, borderColor: color.danger },
  btnLabel: { fontSize: font.body, fontWeight: '700', color: color.ink },
  modeText: { fontSize: font.small, lineHeight: 17, color: color.ink, fontWeight: '600', paddingHorizontal: space.md },
  onColor: { color: color.onPrimary },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.35 },
  // the menu bar
  menu: { position: 'absolute', right: space.md, width: 216, borderRadius: radius.md * 1.4, backgroundColor: 'rgba(22, 30, 42, 0.82)', overflow: 'hidden', ...shadow },
  menuBody: { padding: space.sm, gap: 3 },
  section: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: 'rgba(255,255,255,0.55)', paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: 2 },
  sectionGap: { marginTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.2)' },
  item: { minHeight: TOUCH + 2, justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.sm },
  itemPrimary: { backgroundColor: 'rgba(11, 95, 255, 0.55)' },
  itemActive: { backgroundColor: 'rgba(232, 89, 12, 0.6)' },
  itemPressed: { backgroundColor: 'rgba(255,255,255,0.16)' },
  itemLabel: { fontSize: font.label, fontWeight: '700', color: color.onPrimary },
  itemHint: { fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 1 },
  // the round button
  fabWrap: { position: 'absolute', right: space.md, alignItems: 'flex-end' },
  fab: { width: FAB, height: FAB, borderRadius: FAB / 2, backgroundColor: 'rgba(22, 30, 42, 0.86)', alignItems: 'center', justifyContent: 'center', ...shadow },
  fabOpen: { backgroundColor: color.primary },
  burger: { width: 22, height: 18, alignItems: 'center', justifyContent: 'center' },
  burgerBars: { justifyContent: 'space-between', paddingVertical: 2 },
  bar: { width: 22, height: 2.5, borderRadius: 2, backgroundColor: color.onPrimary },
  barAbs: { position: 'absolute' },
});
