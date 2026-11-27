import type { ComponentType, ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { depth, theme as t } from './theme.ts';

/**
 * Liquid Glass surfaces without a native dependency.
 *
 * The app does not ship `expo-blur` (a native module needs a new dev client). By default a glass surface is a translucent
 * white layer with a bright top rim and a hairline edge over the page aura, which reads as glass on Android, web, iOS and
 * in Node tests alike. If a real blur view is installed later, register it once at start-up and every glass surface puts
 * it underneath its fill:
 *
 *   import { BlurView } from 'expo-blur';
 *   registerGlassBackdrop(({ style }) => <BlurView intensity={40} tint="light" style={style} />);
 *
 * Nothing imports `expo-blur` here, so bundling and tests never depend on it.
 */
export type GlassBackdrop = ComponentType<{ style: StyleProp<ViewStyle> }>;
let backdrop: GlassBackdrop | null = null;
export function registerGlassBackdrop(component: GlassBackdrop | null): void { backdrop = component; }
export function glassBackdrop(): GlassBackdrop | null { return backdrop; }

const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;
type Strength = 'soft' | 'regular' | 'strong';
const FILLS: Record<Strength, string> = { soft: t.glass.fillSoft, regular: t.glass.fill, strong: t.glass.fillStrong };

/** One glass layer. `radius` follows hierarchy (hero 28 > glass card 22 > control 16). */
export function Glass({ children, style, radius = t.radii.glass, strength = 'regular', raised = true, tint }: {
  children?: ReactNode; style?: StyleProp<ViewStyle>; radius?: number; strength?: Strength; raised?: boolean; tint?: string;
}) {
  const Backdrop = backdrop;
  return <View style={[{ borderRadius: radius, borderWidth: 1, borderColor: t.glass.edge, backgroundColor: Backdrop ? t.glass.blurFill : FILLS[strength] }, raised && depth, style]}>
    {Backdrop && <View pointerEvents="none" style={[FILL, { borderRadius: radius, overflow: 'hidden' }]}><Backdrop style={FILL} /></View>}
    {tint && <View pointerEvents="none" style={[FILL, { borderRadius: radius, backgroundColor: tint }]} />}
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: radius * 0.6, right: radius * 0.6, height: 1, backgroundColor: t.glass.rim }} />
    {children}
  </View>;
}

/** Soft colour fields behind the page so translucent layers have something to show through. */
export function Aura() {
  return <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 420, overflow: 'hidden' }}>
    <View style={{ position: 'absolute', width: 300, height: 300, borderRadius: 150, top: -140, right: -90, backgroundColor: t.glass.auraBlue }} />
    <View style={{ position: 'absolute', width: 240, height: 240, borderRadius: 120, top: 40, left: -130, backgroundColor: t.glass.auraGreen }} />
    <View style={{ position: 'absolute', width: 180, height: 180, borderRadius: 90, top: 200, right: -60, backgroundColor: t.glass.auraNavy }} />
  </View>;
}
