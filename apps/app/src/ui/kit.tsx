import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Aura, Glass } from './glass.tsx';
import { screenLayout } from './layout.ts';
import { theme as t, type Tone } from './theme.ts';
export { Glass, registerGlassBackdrop } from './glass.tsx';

/**
 * Content-tab kit (논술·축제·학교행사·내정보 and shared notices). Liquid Glass is used for the functional layer — segmented
 * controls, filter chips, banners, the search field — and for floating cards over a soft aura; text stays navy on
 * high-opacity glass for contrast. Every pressable is at least 44pt tall.
 */
export function Page({ title, subtitle, eyebrow, trailing, children, resetKey }: { title: string; subtitle?: string; eyebrow?: string; trailing?: ReactNode; children: ReactNode; resetKey?: string | number | null }) {
  const window = useWindowDimensions();
  const layout = screenLayout(window.width, window.height, window.fontScale);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [resetKey]);
  return <View style={s.page}>
    <Aura />
    <ScrollView ref={scroll} style={s.scroll} contentContainerStyle={[s.pageContent, { padding: layout.padding, maxWidth: layout.maxContentWidth, width: '100%', alignSelf: 'center' }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets nestedScrollEnabled>
      <View style={s.pageHeader}>
        <View style={{ flex: 1, gap: 2 }}>
          {eyebrow && <Text style={s.eyebrow}>{eyebrow}</Text>}
          <Text accessibilityRole="header" style={s.title}>{title}</Text>
          {subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
        </View>
        {trailing}
      </View>
      {children}
    </ScrollView>
  </View>;
}
export function ActionRow({ children }: { children: ReactNode }) {
  const window = useWindowDimensions();
  const layout = screenLayout(window.width, window.height, window.fontScale);
  return <View style={{ flexDirection: layout.stackActions ? 'column' : 'row', gap: 8, alignItems: 'stretch' }}>{children}</View>;
}
/**
 * One button's cell in an ActionRow: an equal share of the row, or the full width when the row stacks (narrow screens, large
 * text). A plain `flex: 1` wrapper collapses to no height in the stacked column (flex-basis 0 in a column), so the buttons
 * overlapped and spilled under the tab bar on 360dp phones.
 */
export function ActionCell({ children }: { children: ReactNode }) {
  const window = useWindowDimensions();
  const layout = screenLayout(window.width, window.height, window.fontScale);
  return <View style={layout.stackActions ? s.cellStacked : s.cellRow}>{children}</View>;
}
/** A glass content card. */
export function Card({ children, style, tint, strength }: { children: ReactNode; style?: StyleProp<ViewStyle>; tint?: string; strength?: 'soft' | 'regular' | 'strong' }) {
  return <Glass style={[s.card, style]} {...(tint ? { tint } : {})} {...(strength ? { strength } : {})}>{children}</Glass>;
}
export function Heading({ children }: { children: ReactNode }) { return <Text accessibilityRole="header" style={s.heading}>{children}</Text>; }
export function Body({ children, strong = false }: { children: ReactNode; strong?: boolean }) { return <Text style={[s.body, strong && s.bodyStrong]}>{children}</Text>; }
export function Caption({ children }: { children: ReactNode }) { return <Text style={s.caption}>{children}</Text>; }
export function Notice({ children }: { children: ReactNode }) { return <View style={s.notice}><Text style={s.warning}>{children}</Text></View>; }
type ButtonTone = 'primary' | 'secondary' | 'ghost';
export function Button({ title, onPress, disabled = false, secondary = false, tone, compact = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; tone?: ButtonTone; compact?: boolean }) {
  const kind: ButtonTone = tone ?? (secondary ? 'secondary' : 'primary');
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, compact && s.buttonCompact, kind === 'secondary' && s.secondary, kind === 'ghost' && s.ghost, pressed && !disabled && (kind === 'primary' ? s.buttonPressed : s.secondaryPressed), disabled && s.disabled]}><Text style={kind === 'primary' ? s.buttonText : s.link}>{title}</Text></Pressable>;
}
/** Scrollable filter pills on a glass track. */
export function Chips<T extends string>({ values, value, onChange }: { values: readonly T[]; value: T; onChange: (value: T) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>{values.map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: value === item }} onPress={() => onChange(item)} style={[s.chip, value === item && s.selected]}><Text style={[s.chipText, value === item && s.chipTextSelected]}>{item}</Text></Pressable>)}</ScrollView>;
}
/** Equal-width segmented control (2–4 options) on a glass track; the selected segment is a raised white pill. */
export function Segmented<T extends string>({ values, value, onChange, labels, label }: { values: readonly T[]; value: T; onChange: (value: T) => void; labels?: Partial<Record<T, string>>; label?: string }) {
  return <Glass radius={16} strength="soft" raised={false} style={s.segTrack}>
    <View accessibilityRole="tablist" accessibilityLabel={label} style={s.segRow}>{values.map((item) => {
      const on = item === value;
      return <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(item)} style={[s.seg, on && s.segOn]}><Text numberOfLines={1} style={[s.segText, on && s.segTextOn]}>{labels?.[item] ?? item}</Text></Pressable>;
    })}</View>
  </Glass>;
}
export function Badge({ label, tone = 'neutral', solid = false }: { label: string; tone?: Tone; solid?: boolean }) {
  const c = t.tone[tone];
  return <View style={[s.badge, { backgroundColor: solid ? c.fg : c.bg }]}><Text numberOfLines={1} style={[s.badgeText, { color: solid ? '#FFFFFF' : c.fg }]}>{label}</Text></View>;
}
/** Section title with an optional caption and a trailing element (count badge, small action). */
export function SectionHeader({ title, caption, trailing }: { title: string; caption?: string | null; trailing?: ReactNode }) {
  return <View style={s.section}>
    <View style={{ flex: 1, gap: 2 }}><Text accessibilityRole="header" style={s.sectionTitle}>{title}</Text>{caption ? <Text style={s.caption}>{caption}</Text> : null}</View>
    {trailing}
  </View>;
}
/** Hero summary card: deep navy glass with blue/green glow, for the one thing each tab is about. */
export function Hero({ eyebrow, title, subtitle, children }: { eyebrow?: string | null; title: string; subtitle?: string | null; children?: ReactNode }) {
  return <View style={s.hero}>
    <View pointerEvents="none" style={[s.heroGlow, { top: -90, right: -70, backgroundColor: t.glass.heroGlow }]} />
    <View pointerEvents="none" style={[s.heroGlow, { width: 200, height: 200, borderRadius: 100, bottom: -110, left: -60, backgroundColor: t.glass.heroGlow2 }]} />
    <View pointerEvents="none" style={s.heroRim} />
    {eyebrow ? <Text style={s.heroEyebrow}>{eyebrow}</Text> : null}
    <Text accessibilityRole="header" style={s.heroTitle}>{title}</Text>
    {subtitle ? <Text style={s.heroSubtitle}>{subtitle}</Text> : null}
    {children}
  </View>;
}
/** Small glass stat inside a hero: big value, small label. */
export function HeroStat({ value, label }: { value: string; label: string }) {
  return <View style={s.heroStat}><Text numberOfLines={1} style={s.heroStatValue}>{value}</Text><Text numberOfLines={2} style={s.heroStatLabel}>{label}</Text></View>;
}
export function HeroStats({ children }: { children: ReactNode }) { return <View style={s.heroStats}>{children}</View>; }
/** Tinted notice banner: traffic changes, pinned notices, safety. */
export function Banner({ title, body, tone = 'amber', icon }: { title: string; body?: string | null; tone?: Tone; icon?: string }) {
  const c = t.tone[tone];
  return <View accessibilityRole="alert" style={[s.banner, { backgroundColor: c.bg, borderColor: `${c.fg}33` }]}>
    {icon ? <Text style={s.bannerIcon}>{icon}</Text> : null}
    <View style={{ flex: 1, gap: 2 }}><Text style={[s.bannerTitle, { color: c.fg }]}>{title}</Text>{body ? <Text style={[s.bannerBody, { color: t.color.text }]}>{body}</Text> : null}</View>
  </View>;
}
/** Round glyph used as a leading icon. */
export function IconBubble({ glyph, tone = 'blue', size = 40 }: { glyph: string; tone?: Tone; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.tone[tone].bg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: size * 0.45, color: t.tone[tone].fg, fontWeight: '800' }}>{glyph}</Text></View>;
}
/** Label/value line, e.g. 운영 10:00 ~ 20:00. */
export function Meta({ label, value }: { label: string; value: string }) {
  return <View style={s.meta}><Text style={s.metaLabel}>{label}</Text><Text style={s.metaValue}>{value}</Text></View>;
}
/** A glass search field with a leading glyph. */
export function SearchField({ value, onChangeText, placeholder, label }: { value: string; onChangeText: (value: string) => void; placeholder: string; label: string }) {
  return <Glass radius={t.radii.field + 4} strength="strong" raised={false} style={s.searchWrap}>
    <Text style={s.searchGlyph}>⌕</Text>
    <TextInput accessibilityLabel={label} placeholder={placeholder} placeholderTextColor={t.color.faint} value={value} onChangeText={onChangeText} style={s.searchInput} />
  </Glass>;
}
/** A timeline slot: time rail on the left, cards on the right. */
export function TimelineSlot({ time, caption, last = false, children }: { time: string; caption?: string | null; last?: boolean; children: ReactNode }) {
  return <View style={s.tlRow}>
    <View style={s.tlRail}>
      <Text style={s.tlTime}>{time}</Text>
      {caption ? <Text style={s.tlCaption}>{caption}</Text> : null}
      <View style={s.tlDot} />
      {!last && <View style={s.tlLine} />}
    </View>
    <View style={s.tlBody}>{children}</View>
  </View>;
}
/** Collapsible section so long rules (safety, items) do not stretch the page. Closed by default. */
export function Disclosure({ title, caption, glyph, tone = 'navy', defaultOpen = false, children }: { title: string; caption?: string | null; glyph?: string; tone?: Tone; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return <Glass style={s.disclosure}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title} ${open ? '접기' : '펼치기'}`} accessibilityState={{ expanded: open }} onPress={() => setOpen((old) => !old)} style={s.disclosureHead}>
      {glyph ? <IconBubble glyph={glyph} tone={tone} size={36} /> : null}
      <View style={{ flex: 1, gap: 1 }}><Text style={s.rowTitle}>{title}</Text>{caption ? <Text numberOfLines={2} style={s.caption}>{caption}</Text> : null}</View>
      <Text style={s.chevron}>{open ? '⌃' : '⌄'}</Text>
    </Pressable>
    {open && <View style={s.disclosureBody}>{children}</View>}
  </Glass>;
}
/** Bullet list for rules and notices. */
export function Bullets({ items }: { items: readonly string[] }) {
  return <View style={{ gap: 6 }}>{items.map((item, index) => <View key={`${index}:${item}`} style={{ flexDirection: 'row', gap: 8 }}><Text style={s.bullet}>•</Text><Text style={[s.body, { flex: 1 }]}>{item}</Text></View>)}</View>;
}
export function Divider() { return <View style={s.divider} />; }
export function Empty({ message }: { message: string }) { return <View style={s.empty}><Text style={s.emptyText}>{message}</Text></View>; }
export function Loading() { return <View accessibilityRole="progressbar" style={[s.cardFlat, { alignItems: 'center', paddingVertical: 28 }]}><ActivityIndicator color={t.color.primary} /><Body>안내를 불러오고 있습니다.</Body></View>; }
/** Interactive checklist with progress; `onProgress` lets a parent show the count. */
export function Checklist({ items, onProgress }: { items: readonly string[]; onProgress?: (done: number, total: number) => void }) {
  const [checked, setChecked] = useState<string[]>([]);
  useEffect(() => { onProgress?.(checked.length, items.length); }, [checked.length, items.length, onProgress]);
  return <View style={{ gap: 2 }}>{items.map((item, index) => {
    const key = `${index}:${item}`;
    const on = checked.includes(key);
    return <Pressable key={key} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setChecked((old) => old.includes(key) ? old.filter((x) => x !== key) : [...old, key])} style={s.check}>
      <View style={[s.box, on && s.boxOn]}><Text style={s.boxMark}>{on ? '✓' : ''}</Text></View>
      <Text style={[s.body, { flex: 1, color: t.color.text }, on && { color: t.color.faint, textDecorationLine: 'line-through' }]}>{item}</Text>
    </Pressable>;
  })}</View>;
}
/** Thin progress bar (0–1). */
export function Progress({ value, tone = 'blue' }: { value: number; tone?: Tone }) {
  const ratio = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return <View style={s.progressTrack}><View style={[s.progressFill, { width: `${Math.round(ratio * 100)}%` as `${number}%`, backgroundColor: t.tone[tone].fg }]} /></View>;
}
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: t.color.bg, overflow: 'hidden' }, scroll: { flex: 1, backgroundColor: 'transparent' },
  pageContent: { padding: t.space.md, gap: 14, paddingBottom: 48 },
  pageHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingTop: 8, paddingBottom: 4 },
  eyebrow: { fontSize: t.type.micro, fontWeight: '800', color: t.color.primary, letterSpacing: 0.4 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800', color: t.color.text, letterSpacing: -0.6 },
  subtitle: { fontSize: t.type.small, lineHeight: 19, color: t.color.muted, flexShrink: 1 },
  heading: { fontSize: t.type.heading, lineHeight: 24, fontWeight: '700', color: t.color.text, letterSpacing: -0.2 },
  body: { fontSize: 14, lineHeight: 21, color: t.color.muted, flexShrink: 1 },
  bodyStrong: { color: t.color.text, fontWeight: '600' },
  caption: { fontSize: t.type.micro, lineHeight: 17, color: t.color.muted, flexShrink: 1 },
  card: { padding: 18, gap: 10 },
  cardFlat: { borderRadius: t.radii.card, backgroundColor: t.color.surface, padding: 18, gap: 10, borderWidth: 1, borderColor: t.color.border },
  notice: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: t.color.warningBg, borderWidth: 1, borderColor: 'rgba(138, 82, 0, 0.14)' },
  warning: { fontSize: t.type.small, lineHeight: 19, color: t.color.warning },
  button: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, backgroundColor: t.color.primary, alignItems: 'center', justifyContent: 'center', minWidth: 0 },
  buttonCompact: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 14 },
  buttonPressed: { backgroundColor: t.color.primaryPressed }, disabled: { opacity: 0.4 },
  secondary: { backgroundColor: t.color.soft }, ghost: { backgroundColor: 'rgba(255, 255, 255, 0.7)', borderWidth: 1, borderColor: t.glass.edge }, secondaryPressed: { backgroundColor: '#DCE6FF' },
  buttonText: { color: 'white', fontSize: t.type.body, fontWeight: '700', textAlign: 'center', flexShrink: 1, lineHeight: 21 },
  link: { color: t.color.primary, fontSize: 14, fontWeight: '700', textAlign: 'center', flexShrink: 1, lineHeight: 20 },
  cellRow: { flex: 1, minWidth: 0 }, cellStacked: { alignSelf: 'stretch' },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: t.radii.pill, borderWidth: 1, borderColor: t.glass.edge, backgroundColor: t.glass.fill },
  selected: { backgroundColor: t.color.text, borderColor: t.color.text },
  chipText: { color: t.color.text, fontSize: 14, fontWeight: '600' }, chipTextSelected: { color: 'white', fontWeight: '700' },
  segTrack: { padding: 4 }, segRow: { flexDirection: 'row', gap: 4 },
  seg: { flex: 1, minHeight: 44, minWidth: 0, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  segOn: { backgroundColor: t.color.surface, shadowColor: '#0B1F3A', shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  segText: { fontSize: 14, fontWeight: '600', color: t.color.muted }, segTextOn: { color: t.color.text, fontWeight: '800' },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: t.radii.pill, maxWidth: '100%' },
  badgeText: { fontSize: 11, lineHeight: 15, fontWeight: '800' },
  section: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 10 },
  sectionTitle: { fontSize: 19, lineHeight: 26, fontWeight: '800', color: t.color.text, letterSpacing: -0.3 },
  hero: { borderRadius: t.radii.hero, backgroundColor: t.color.text, padding: 20, gap: 8, overflow: 'hidden', shadowColor: '#0B1F3A', shadowOpacity: 0.22, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  heroGlow: { position: 'absolute', width: 260, height: 260, borderRadius: 130, opacity: 0.55 },
  heroRim: { position: 'absolute', top: 0, left: 24, right: 24, height: 1, backgroundColor: t.glass.heroRim },
  heroEyebrow: { fontSize: t.type.micro, fontWeight: '800', color: t.glass.onHero, letterSpacing: 0.4 },
  heroTitle: { fontSize: 24, lineHeight: 31, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  heroSubtitle: { fontSize: 14, lineHeight: 21, color: t.glass.onHero },
  heroStats: { flexDirection: 'row', gap: 8, marginTop: 6 },
  heroStat: { flex: 1, minWidth: 0, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: 'rgba(255, 255, 255, 0.1)', borderWidth: 1, borderColor: t.glass.heroRim, gap: 2 },
  heroStatValue: { fontSize: 17, lineHeight: 23, fontWeight: '800', color: '#FFFFFF' },
  heroStatLabel: { fontSize: 11, lineHeight: 15, color: t.glass.onHero },
  banner: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 14, borderRadius: 18, borderWidth: 1 },
  bannerIcon: { fontSize: 20, lineHeight: 24 }, bannerTitle: { fontSize: 14, lineHeight: 20, fontWeight: '800' }, bannerBody: { fontSize: 13, lineHeight: 19 },
  meta: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  metaLabel: { width: 64, fontSize: 13, lineHeight: 20, color: t.color.faint, fontWeight: '600' },
  metaValue: { flex: 1, fontSize: 14, lineHeight: 20, color: t.color.text, fontWeight: '600' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, minHeight: 50 },
  searchGlyph: { fontSize: 18, color: t.color.faint, marginRight: 6 },
  searchInput: { flex: 1, minHeight: 48, paddingRight: 14, paddingVertical: 10, fontSize: t.type.body, color: t.color.text, minWidth: 0 },
  tlRow: { flexDirection: 'row', gap: 12 },
  tlRail: { width: 58, alignItems: 'flex-start' },
  tlTime: { fontSize: 15, lineHeight: 20, fontWeight: '800', color: t.color.text },
  tlCaption: { fontSize: 11, lineHeight: 15, color: t.color.faint },
  tlDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.color.primary, borderWidth: 2, borderColor: '#FFFFFF', marginTop: 6, marginLeft: 2 },
  tlLine: { flex: 1, width: 2, marginLeft: 6, marginTop: 4, borderRadius: 1, backgroundColor: 'rgba(31, 94, 255, 0.18)', minHeight: 16 },
  tlBody: { flex: 1, minWidth: 0, gap: 8, paddingBottom: 14 },
  disclosure: { overflow: 'hidden' },
  disclosureHead: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  disclosureBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  rowTitle: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: t.color.text },
  chevron: { fontSize: 18, color: t.color.faint, width: 20, textAlign: 'center' },
  bullet: { fontSize: 14, lineHeight: 21, color: t.color.primary, fontWeight: '800' },
  divider: { height: 1, backgroundColor: t.color.divider },
  empty: { paddingVertical: 24, paddingHorizontal: 20, borderRadius: t.radii.card, borderWidth: 1, borderStyle: 'dashed', borderColor: '#CBD4E0', backgroundColor: 'rgba(255, 255, 255, 0.5)', alignItems: 'center' },
  emptyText: { fontSize: 14, lineHeight: 21, color: t.color.muted, textAlign: 'center' },
  input: { minHeight: 50, paddingHorizontal: 16, paddingVertical: 12, borderRadius: t.radii.field, borderWidth: 0, backgroundColor: '#EDF0F5', fontSize: t.type.body, color: t.color.text, minWidth: 0 },
  check: { paddingVertical: 10, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: '#C3CDDA', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.8)' },
  boxOn: { backgroundColor: t.color.start, borderColor: t.color.start }, boxMark: { color: 'white', fontSize: 13, fontWeight: '800', lineHeight: 16 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: t.glass.track, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
});
