/* Presentational pieces of the full-screen map: floating controls over the map, the bottom sheet,
 * the start/end card and the place search sheet. No routing or GPS logic lives here. */
import type { ReactNode } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CampusPlace, TravelMode } from '../../contracts.ts';
import { floating, theme as t } from '../../ui/theme.ts';
import { Empty, Notice } from '../../ui/kit.tsx';
import { TRAVEL_MODES } from './model.ts';

export const SEARCH_PLACEHOLDER = '건물 이름, 동 번호, 강의실 검색';

/* ---------- Icons drawn with views, so no icon font or package is needed. ---------- */
export function SearchIcon({ color = t.color.text }: { color?: string }) {
  return <View style={{ width: 20, height: 20 }}>
    <View style={{ position: 'absolute', left: 1, top: 1, width: 13, height: 13, borderRadius: 7, borderWidth: 2.2, borderColor: color }} />
    <View style={{ position: 'absolute', left: 12, top: 14, width: 7, height: 2.4, borderRadius: 2, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
  </View>;
}
export function LocateIcon({ color = t.color.text }: { color?: string }) {
  return <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: color, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }} /></View>
    <View style={{ position: 'absolute', top: 0, width: 2, height: 4, backgroundColor: color }} />
    <View style={{ position: 'absolute', bottom: 0, width: 2, height: 4, backgroundColor: color }} />
    <View style={{ position: 'absolute', left: 0, width: 4, height: 2, backgroundColor: color }} />
    <View style={{ position: 'absolute', right: 0, width: 4, height: 2, backgroundColor: color }} />
  </View>;
}
export function CloseIcon({ color = t.color.text }: { color?: string }) {
  return <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ position: 'absolute', width: 18, height: 2.2, borderRadius: 2, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
    <View style={{ position: 'absolute', width: 18, height: 2.2, borderRadius: 2, backgroundColor: color, transform: [{ rotate: '-45deg' }] }} />
  </View>;
}
export function BackIcon({ color = t.color.text }: { color?: string }) {
  return <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ width: 12, height: 12, marginLeft: 5, borderLeftWidth: 2.4, borderBottomWidth: 2.4, borderColor: color, transform: [{ rotate: '45deg' }] }} />
  </View>;
}
function SwapIcon() {
  return <Text accessible={false} style={{ fontSize: 17, lineHeight: 20, fontWeight: '700', color: t.color.muted, letterSpacing: -3 }}>↑↓</Text>;
}
/** Start/end dot used in the endpoint card, the route pill and the sheets. */
export function EndpointDot({ kind }: { kind: 'from' | 'to' }) {
  return <View style={[c.dot, { borderColor: kind === 'from' ? t.color.start : t.color.end }]} />;
}

/* ---------- Floating controls ---------- */
export function RoundButton({ label, onPress, children, busy = false, disabled = false }: { label: string; onPress: () => void; children: ReactNode; busy?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [c.round, pressed && { backgroundColor: t.color.sunken }]}>{busy ? <ActivityIndicator color={t.color.primary} /> : children}</Pressable>;
}
export function SearchBar({ onSearch, onRoute }: { onSearch: () => void; onRoute: () => void }) {
  return <View style={c.searchRow}>
    <Pressable accessibilityRole="button" accessibilityLabel="장소 검색 열기" onPress={onSearch} style={({ pressed }) => [c.searchPill, pressed && { backgroundColor: t.color.sunken }]}>
      <SearchIcon color={t.color.primary} />
      <Text numberOfLines={1} style={c.searchText}>{SEARCH_PLACEHOLDER}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="길찾기" onPress={onRoute} style={({ pressed }) => [c.routeButton, pressed && { backgroundColor: t.color.primaryPressed }]}>
      <Text style={c.routeButtonText}>길찾기</Text>
    </Pressable>
  </View>;
}
/** Small floating chip, e.g. the developer data switch. */
export function FloatChip({ label, text, onPress }: { label: string; text: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [c.floatChip, pressed && { backgroundColor: t.color.sunken }]}><Text style={c.floatChipText}>{text}</Text></Pressable>;
}

/* ---------- Start / end card (route input) ---------- */
export function EndpointCard({ from, to, onField, onSwap, onClose }: { from: CampusPlace | null; to: CampusPlace | null; onField: (field: 'from' | 'to') => void; onSwap: () => void; onClose: () => void }) {
  return <View style={c.endpointCard}>
    <Pressable accessibilityRole="button" accessibilityLabel="출발·도착 바꾸기" disabled={!from && !to} onPress={onSwap} style={[c.iconButton, !from && !to && { opacity: 0.35 }]}><SwapIcon /></Pressable>
    <View style={{ flex: 1, minWidth: 0 }}>
      {(['from', 'to'] as const).map((key, index) => {
        const place = key === 'from' ? from : to;
        return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${key === 'from' ? '출발' : '도착'}: ${place?.name ?? '검색해서 선택해 주세요'}`} onPress={() => onField(key)}
          style={({ pressed }) => [c.endpointRow, index === 0 && c.endpointDivider, pressed && { opacity: 0.6 }]}>
          <EndpointDot kind={key} />
          <Text numberOfLines={1} style={[c.endpointText, !place && c.endpointPlaceholder]}>{place?.name ?? (key === 'from' ? '출발지 입력' : '도착지 입력')}</Text>
        </Pressable>;
      })}
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="길찾기 닫기" onPress={onClose} style={c.iconButton}><CloseIcon color={t.color.muted} /></Pressable>
  </View>;
}
/** Compact start → end summary shown above a computed route. */
export function RoutePill({ from, to, onBack }: { from: CampusPlace | null; to: CampusPlace | null; onBack: () => void }) {
  return <View style={c.searchRow}>
    <RoundButton label="출발·도착 수정" onPress={onBack}><BackIcon /></RoundButton>
    <Pressable accessibilityRole="button" accessibilityLabel="출발·도착 다시 고치기" onPress={onBack} style={[c.searchPill, { gap: 8 }]}>
      <EndpointDot kind="from" /><Text numberOfLines={1} style={[c.pillText, { flexShrink: 1 }]}>{from?.name ?? '출발지'}</Text>
      <Text style={{ color: t.color.faint }}>→</Text>
      <EndpointDot kind="to" /><Text numberOfLines={1} style={[c.pillText, { flexShrink: 1 }]}>{to?.name ?? '도착지'}</Text>
    </Pressable>
  </View>;
}

/* ---------- Bottom sheet ---------- */
export function Sheet({ children, maxHeight, footer }: { children: ReactNode; maxHeight: number; footer?: ReactNode }) {
  return <View style={[c.sheet, { maxHeight }]}>
    <View style={c.handle} />
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={c.sheetContent} keyboardShouldPersistTaps="handled" nestedScrollEnabled>{children}</ScrollView>
    {footer && <View style={c.sheetFooter}>{footer}</View>}
  </View>;
}
export function ModeChips({ value, onChange }: { value: TravelMode; onChange: (mode: TravelMode) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
    {TRAVEL_MODES.map((item) => {
      const on = value === item.value;
      return <Pressable key={item.value} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(item.value)} style={[c.mode, on && c.modeOn]}>
        <Text style={[c.modeText, on && c.modeTextOn]}>{item.label}</Text>
      </Pressable>;
    })}
  </ScrollView>;
}
export function Segmented<T extends string>({ values, value, onChange }: { values: readonly T[]; value: T; onChange: (value: T) => void }) {
  return <View style={c.segment}>{values.map((item) => <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: item === value }} onPress={() => onChange(item)} style={[c.segmentItem, item === value && c.segmentOn]}>
    <Text style={[c.segmentText, item === value && c.segmentTextOn]}>{item}</Text>
  </Pressable>)}</View>;
}
/** Quiet one-line status used inside sheets instead of large warning boxes. */
export function StatusLine({ children }: { children: ReactNode }) {
  return <View style={c.status}><View style={c.statusDot} /><Text style={c.statusText}>{children}</Text></View>;
}
export function TextButton({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ disabled }} onPress={onPress} style={({ pressed }) => [c.textButton, (pressed || disabled) && { opacity: 0.5 }]}><Text style={c.textButtonText}>{title}</Text></Pressable>;
}
export function Stat({ value, label }: { value: string; label: string }) {
  return <View style={c.stat}><Text style={c.statValue}>{value}</Text><Text style={c.statLabel}>{label}</Text></View>;
}

/* ---------- Place search ---------- */
export type SearchTarget = 'from' | 'to' | 'place';
export function PlaceSearch({ target, query, onQuery, results, detail, emptyMessage, demoNotice, maxWidth, padding, onClose, onChoose, onCurrent, onMapPick, busy }: {
  target: SearchTarget | null; query: string; onQuery: (value: string) => void; results: readonly CampusPlace[]; detail: (place: CampusPlace) => string;
  emptyMessage: string; demoNotice: boolean; maxWidth: number; padding: number; busy: boolean;
  onClose: () => void; onChoose: (place: CampusPlace) => void; onCurrent: (() => void) | null; onMapPick: () => void;
}) {
  const word = target === 'from' ? '출발' : '도착';
  return <Modal visible={target !== null} animationType="slide" onRequestClose={onClose}><SafeAreaView style={{ flex: 1, backgroundColor: t.color.surface }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, width: '100%', maxWidth, alignSelf: 'center', paddingHorizontal: padding, paddingTop: 8, gap: 12 }}>
      <View style={c.searchHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={c.iconButton}><BackIcon /></Pressable>
        <Text accessibilityRole="header" style={c.searchTitle}>{target === 'place' ? '장소 검색' : target === 'from' ? '출발지 검색' : '목적지 검색'}</Text>
      </View>
      <View style={c.searchField}>
        <SearchIcon color={t.color.faint} />
        <TextInput autoFocus value={query} onChangeText={onQuery} placeholder={SEARCH_PLACEHOLDER} placeholderTextColor={t.color.faint} accessibilityLabel="장소 검색어" style={c.searchInput} autoCorrect={false} returnKeyType="search" />
        {query.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="검색어 지우기" onPress={() => onQuery('')} style={c.clear}><CloseIcon color="white" /></Pressable>}
      </View>
      {target !== 'place' && target !== null && <View style={c.quickRow}>
        {onCurrent && <Pressable accessibilityRole="button" accessibilityLabel={`현재 위치를 ${word}지로`} disabled={busy} onPress={onCurrent} style={({ pressed }) => [c.quick, pressed && { backgroundColor: t.color.soft }]}>
          {busy ? <ActivityIndicator color={t.color.primary} /> : <LocateIcon color={t.color.primary} />}<Text style={c.quickText}>{busy ? '확인 중…' : '현재 위치'}</Text>
        </Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel={`지도에서 ${word} 선택`} onPress={onMapPick} style={({ pressed }) => [c.quick, pressed && { backgroundColor: t.color.soft }]}>
          <View style={c.pinGlyph}><View style={c.pinGlyphDot} /></View><Text style={c.quickText}>지도에서 선택</Text>
        </Pressable>
      </View>}
      {demoNotice && <Notice>가상 시험 데이터입니다. 실제 장소가 아닙니다.</Notice>}
      <FlatList data={results} keyboardShouldPersistTaps="handled" keyExtractor={(item) => item.id} ListEmptyComponent={<Empty message={emptyMessage} />}
        renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => onChoose(item)} style={({ pressed }) => [c.result, pressed && { backgroundColor: t.color.sunken }]}>
          <View style={c.resultPin}><View style={c.resultPinDot} /></View>
          <View style={{ flex: 1, gap: 2 }}><Text style={c.resultName}>{item.name}</Text><Text style={c.resultDetail}>{detail(item)}</Text></View>
        </Pressable>} />
    </KeyboardAvoidingView>
  </SafeAreaView></Modal>;
}

const c = StyleSheet.create({
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 3.5, backgroundColor: 'white' },
  round: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.color.surface, alignItems: 'center', justifyContent: 'center', ...floating },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchPill: { flex: 1, minWidth: 0, minHeight: 52, borderRadius: 26, backgroundColor: t.color.surface, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, ...floating },
  searchText: { flex: 1, fontSize: t.type.body, color: t.color.faint, fontWeight: '500' },
  pillText: { fontSize: 14, color: t.color.text, fontWeight: '700' },
  routeButton: { minHeight: 52, minWidth: 64, borderRadius: 26, paddingHorizontal: 16, backgroundColor: t.color.primary, alignItems: 'center', justifyContent: 'center', ...floating },
  routeButtonText: { color: 'white', fontSize: 14, fontWeight: '800' },
  floatChip: { alignSelf: 'flex-end', minHeight: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: t.color.surface, justifyContent: 'center', ...floating },
  floatChipText: { fontSize: 12, fontWeight: '700', color: t.color.muted },
  endpointCard: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.color.surface, borderRadius: 20, paddingHorizontal: 6, paddingVertical: 6, borderWidth: 1, borderColor: t.color.border, ...floating },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  endpointRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8 },
  endpointDivider: { borderBottomWidth: 1, borderColor: t.color.divider },
  endpointText: { flex: 1, fontSize: 16, fontWeight: '700', color: t.color.text },
  endpointPlaceholder: { color: t.color.faint, fontWeight: '500' },
  sheet: { flexShrink: 0, marginTop: -18, borderTopLeftRadius: t.radii.sheet, borderTopRightRadius: t.radii.sheet, backgroundColor: t.color.surface, ...floating, shadowOffset: { width: 0, height: -3 } },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D5DCE5', marginTop: 8, marginBottom: 4 },
  sheetContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 14 },
  sheetFooter: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderColor: t.color.divider, gap: 8 },
  mode: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 20, backgroundColor: t.color.sunken, borderWidth: 1, borderColor: t.color.border },
  modeOn: { backgroundColor: t.color.primary, borderColor: t.color.primary },
  modeText: { fontSize: 14, fontWeight: '600', color: t.color.text }, modeTextOn: { color: 'white', fontWeight: '800' },
  segment: { flexDirection: 'row', backgroundColor: '#EDF0F5', borderRadius: 12, padding: 3 },
  segmentItem: { minHeight: 38, minWidth: 54, paddingHorizontal: 12, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: t.color.surface, shadowColor: '#0B1F3A', shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segmentText: { fontSize: 13, fontWeight: '600', color: t.color.muted }, segmentTextOn: { color: t.color.text, fontWeight: '800' },
  status: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#E0A33A', marginTop: 7 },
  statusText: { flex: 1, fontSize: t.type.small, lineHeight: 19, color: t.color.muted },
  textButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 2 },
  textButtonText: { fontSize: 14, fontWeight: '700', color: t.color.primary },
  stat: { gap: 2 }, statValue: { fontSize: 15, fontWeight: '800', color: t.color.text }, statLabel: { fontSize: t.type.micro, color: t.color.muted },
  searchHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  searchTitle: { fontSize: 18, fontWeight: '800', color: t.color.text },
  searchField: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, borderRadius: 14, backgroundColor: '#EDF0F5', paddingHorizontal: 14 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 48, fontSize: 16, color: t.color.text },
  clear: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#B5C0CE', alignItems: 'center', justifyContent: 'center', transform: [{ scale: 0.8 }] },
  quickRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  quick: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: t.color.border },
  quickText: { fontSize: 14, fontWeight: '700', color: t.color.text },
  pinGlyph: { width: 16, height: 16, borderRadius: 8, borderBottomRightRadius: 2, backgroundColor: t.color.end, transform: [{ rotate: '45deg' }], alignItems: 'center', justifyContent: 'center' },
  pinGlyphDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'white' },
  result: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1, borderColor: t.color.divider },
  resultPin: { width: 34, height: 34, borderRadius: 17, backgroundColor: t.color.sunken, alignItems: 'center', justifyContent: 'center' },
  resultPinDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5, borderColor: t.color.faint },
  resultName: { fontSize: 16, fontWeight: '700', color: t.color.text },
  resultDetail: { fontSize: 13, color: t.color.muted },
});
