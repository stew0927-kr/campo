/* Test-only DOM equivalents for checking real screen event handlers and approximate layout.
 * MapLibre, native text measurement, keyboard and sensors are intentionally not simulated as real hardware.
 */
import { forwardRef, useImperativeHandle, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
type Props = Record<string, any>;
const flatten = (style: any): CSSProperties => {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  if (!style) return {};
  let out: Record<string, any> = { ...style };
  if (out.paddingHorizontal !== undefined) { out.paddingLeft = out.paddingRight = out.paddingHorizontal; delete out.paddingHorizontal; }
  if (out.paddingVertical !== undefined) { out.paddingTop = out.paddingBottom = out.paddingVertical; delete out.paddingVertical; }
  if (out.marginTop !== undefined) out.marginTop = style.marginTop;
  delete out.textBreakStrategy;
  // React Native defaults the DOM lacks: solid borders and object transforms.
  if (out.borderWidth === undefined && (out.borderTopWidth || out.borderBottomWidth || out.borderLeftWidth || out.borderRightWidth)) out = { borderWidth: 0, ...out };
  if ((out.borderWidth || out.borderTopWidth || out.borderBottomWidth || out.borderLeftWidth || out.borderRightWidth) && !out.borderStyle) out.borderStyle = 'solid';
  if (Array.isArray(out.transform)) out.transform = out.transform.map((item: Record<string, unknown>) => Object.entries(item).map(([key, value]) => `${key}(${typeof value === 'number' && key !== 'scale' ? `${value}px` : value})`).join(' ')).join(' ');
  for (const key of ['shadowColor', 'shadowOpacity', 'shadowRadius', 'shadowOffset', 'elevation']) delete out[key];
  return out;
};
const css = (style: any): CSSProperties => ({ minWidth: 0, ...flatten(typeof style === 'function' ? style({ pressed: false }) : style) });
const aria = (p: Props) => ({ role: p.accessibilityRole === 'header' ? 'heading' : p.accessibilityRole, 'aria-label': p.accessibilityLabel,
  'aria-selected': p.accessibilityState?.selected, 'aria-checked': p.accessibilityState?.checked, 'aria-disabled': p.disabled || p.accessibilityState?.disabled });
export function View(p: Props) { return <div {...aria(p)} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0, position: 'relative', pointerEvents: p.pointerEvents === 'box-none' ? 'none' : undefined, ...css(p.style) }}>{p.children}</div>; }
export function Text(p: Props) {
  const scale = useWindowDimensions().fontScale;
  const style = css(p.style);
  return <span {...aria(p)} style={{ display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...style, fontSize: Number(style.fontSize ?? 14) * scale, lineHeight: typeof style.lineHeight === 'number' ? `${style.lineHeight * scale}px` : 'normal' }}>{p.children}</span>;
}
export function Pressable(p: Props) { return <button type="button" {...aria(p)} disabled={p.disabled} onClick={p.onPress} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'relative', border: 0, color: 'inherit', background: 'transparent', textAlign: 'inherit', pointerEvents: 'auto', ...css(p.style) }}>{p.children}</button>; }
export function TextInput(p: Props) { return <input {...aria(p)} placeholder={p.placeholder} value={p.value ?? ''} onChange={(event) => p.onChangeText?.(event.target.value)} autoFocus={p.autoFocus} style={{ ...css(p.style), flexShrink: 0, maxWidth: '100%' }} />; }
export const ScrollView = forwardRef<any, Props>(function ScrollView(p, ref) {
  const scroll = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ scrollTo: ({ y = 0, x = 0 }: { y?: number; x?: number }) => scroll.current?.scrollTo(x, y) }));
  return <div ref={scroll} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowX: p.horizontal ? 'auto' : 'hidden', overflowY: p.horizontal ? 'hidden' : 'auto', flexShrink: p.horizontal ? 0 : 1, ...css(p.style) }}><div style={{ display: 'flex', flexDirection: p.horizontal ? 'row' : 'column', flexShrink: 0, ...css(p.contentContainerStyle) }}>{p.children}</div></div>;
});
export function FlatList(p: Props) { return <ScrollView style={{ flex: 1 }}>{p.data.length ? p.data.map((item: any, index: number) => <div key={p.keyExtractor?.(item) ?? index}>{p.renderItem({ item, index })}</div>) : p.ListEmptyComponent}</ScrollView>; }
export function Modal(p: Props) { return p.visible ? <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'white', zIndex: 100, display: 'flex', flexDirection: 'column' }}>{p.children}</div> : null; }
export const KeyboardAvoidingView = View;
export function ActivityIndicator() { return <div role="progressbar">처리 중</div>; }
export const StyleSheet = { create: <T,>(style: T) => style, absoluteFill: { position: 'absolute', inset: 0 } };
export const Platform = { OS: 'android' };
export const AppState = { addEventListener: () => ({ remove() {} }) };
const backCallbacks = new Set<() => boolean>();
export const BackHandler = { addEventListener: (_event: string, callback: () => boolean) => { backCallbacks.add(callback); return { remove: () => backCallbacks.delete(callback) }; } };
(window as any).__campoBack = () => { for (const callback of [...backCallbacks].reverse()) if (callback()) return true; return false; };
(window as any).__campoFontScale = 1;
(window as any).__campoLinks = [];
export const Linking = { openURL: async (url: string) => { (window as any).__campoLinks.push(url); }, openSettings: async () => { (window as any).__campoLinks.push('app-settings'); } };
function subscribe(listener: () => void) { window.addEventListener('resize', listener); return () => window.removeEventListener('resize', listener); }
function snapshot() { return `${window.innerWidth}:${window.innerHeight}:${(window as any).__campoFontScale ?? 1}`; }
export function useWindowDimensions() {
  const value = useSyncExternalStore(subscribe, snapshot).split(':').map(Number);
  return { width: value[0]!, height: value[1]!, fontScale: value[2]!, scale: 1 };
}
export type Node = ReactNode;
