/* Presentational pieces of the full-screen map: floating controls over the map, the bottom sheet,
 * the start/end card and the place search sheet. No routing or GPS logic lives here. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, FlatList, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CampusBuilding, CampusPlace, TravelMode } from '../../contracts.ts';
import { floating, theme as t } from '../../ui/theme.ts';
import { Empty, Notice } from '../../ui/kit.tsx';
import { TRAVEL_MODES } from './model.ts';
import { OUTDOOR_GROUP, TREE_ROOT, UNKNOWN_LEVEL, buildingGroups, facilityGroups, floorText, levelGroups, treeUp, type TreePath } from './placeTree.ts';
import { RESTROOM_WANTED, genderLabel, restroomCandidates, type RestroomWanted } from './restroomGender.ts';
import { SHEET_COLLAPSED_HEIGHT, SHEET_TAP_SLOP, dragHeight, releaseSnap, tapSnap, toggleLabel, type SheetHeights, type SheetSnap } from './sheetModel.ts';

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
/**
 * Draggable bottom sheet with three states: expanded / default / collapsed (only the handle and a mini bar stay, so the
 * map fills the screen). Drag the handle row up or down, tap it, or use the chevron button to switch.
 */
export function Sheet({ children, maxHeight, defaultHeight, footer, peek, initialSnap = 'default' }: {
  children: ReactNode; maxHeight: number; defaultHeight?: number; footer?: ReactNode;
  /** Mini bar shown while collapsed (e.g. "12분 · 340m"). */
  peek?: ReactNode; initialSnap?: SheetSnap;
}) {
  const heights: SheetHeights = useMemo(() => ({
    expanded: maxHeight,
    default: Math.min(maxHeight, defaultHeight ?? Math.round(maxHeight * 0.6)),
    collapsed: SHEET_COLLAPSED_HEIGHT,
  }), [maxHeight, defaultHeight]);
  const [snap, setSnap] = useState<SheetSnap>(initialSnap);
  const [showBody, setShowBody] = useState(initialSnap !== 'collapsed');
  const limit = useRef(new Animated.Value(heights[initialSnap])).current;
  const state = useRef({ snap, heights });
  state.current = { snap, heights };

  const go = (next: SheetSnap) => {
    if (next !== 'collapsed') setShowBody(true);
    setSnap(next);
    Animated.spring(limit, { toValue: state.current.heights[next], useNativeDriver: false, bounciness: 0, speed: 18 })
      .start(({ finished }) => { if (finished && next === 'collapsed') setShowBody(false); });
  };
  // Heights change with the window or the screen: keep the current state at its new height.
  useEffect(() => { limit.setValue(heights[state.current.snap]); }, [heights, limit]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
    onPanResponderGrant: () => setShowBody(true),
    onPanResponderMove: (_e, g) => limit.setValue(dragHeight(state.current.snap, g.dy, state.current.heights)),
    onPanResponderRelease: (_e, g) => {
      const tap = Math.abs(g.dy) < SHEET_TAP_SLOP && Math.abs(g.dx) < SHEET_TAP_SLOP;
      go(tap ? tapSnap(state.current.snap) : releaseSnap(state.current.snap, g.dy, g.vy, state.current.heights));
    },
    onPanResponderTerminate: () => go(state.current.snap),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const collapsed = snap === 'collapsed';
  return <Animated.View style={[c.sheet, { maxHeight: limit }]}>
    <View style={c.handleRow} {...pan.panHandlers}>
      <View accessible accessibilityRole="adjustable" accessibilityLabel={`하단 시트 ${collapsed ? '접힘' : snap === 'expanded' ? '펼침' : '기본'}`} style={c.handleHit}><View style={c.handle} /></View>
      <View style={c.sheetTools}>
        {!collapsed && snap !== 'expanded' && <Pressable accessibilityRole="button" accessibilityLabel="시트 크게 펼치기" hitSlop={6} onPress={() => go('expanded')} style={c.sheetTool}><Chevron up /></Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel={toggleLabel(snap)} hitSlop={6} onPress={() => go(tapSnap(snap))} style={c.sheetTool}><Chevron up={collapsed} /></Pressable>
      </View>
    </View>
    {collapsed && !showBody ? (peek ? <View style={c.peek}>{peek}</View> : null) : <>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={c.sheetContent} keyboardShouldPersistTaps="handled" nestedScrollEnabled>{children}</ScrollView>
      {footer && <View style={c.sheetFooter}>{footer}</View>}
    </>}
  </Animated.View>;
}
function Chevron({ up }: { up: boolean }) {
  return <View style={{ width: 12, height: 12, marginTop: up ? 5 : -5, borderLeftWidth: 2.4, borderTopWidth: 2.4, borderColor: t.color.muted, transform: [{ rotate: up ? '45deg' : '225deg' }] }} />;
}

/* ---------- Restroom quick button and the wheelchair switch ---------- */
export function RestroomChip({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="가장 가까운 화장실 찾기" onPress={onPress} style={({ pressed }) => [c.quickChip, pressed && { backgroundColor: t.color.sunken }]}>
    <View style={c.wcBadge}><Text style={c.wcText}>WC</Text></View>
    <Text style={c.quickChipText}>가장 가까운 화장실</Text>
  </Pressable>;
}
/** "휠체어 가능" switch: on → wheelchair travel mode (and wheelchair restrooms only), re-searched at once. */
export function WheelchairToggle(props: { value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <SwitchRow label="휠체어 가능" {...props} />;
}
export function SwitchRow({ label, value, onChange, disabled = false }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }} disabled={disabled} onPress={() => onChange(!value)}
    style={[c.toggleRow, disabled && { opacity: 0.5 }]}>
    <Text style={c.toggleText}>{label}</Text>
    <View style={[c.track, value && c.trackOn]}><View style={[c.knob, value && c.knobOn]} /></View>
  </Pressable>;
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
export type SearchTarget = 'from' | 'to' | 'place' | 'restroom';
const SEARCH_TITLE: Record<SearchTarget, string> = { place: '장소 검색', from: '출발지 검색', to: '목적지 검색', restroom: '화장실 찾기 · 출발 위치' };
/**
 * Search sheet. With a query: a flat filtered list. Without one: a drill-down list
 * (building → floor → facilities such as restrooms, classrooms and entrances).
 */
export function PlaceSearch({ target, query, onQuery, results: allResults, places: allPlaces, buildings, detail, emptyMessage, demoNotice, maxWidth, padding, onClose, onChoose, onCurrent, onMapPick, busy, restroomGender = 'any', onRestroomGender }: {
  target: SearchTarget | null; query: string; onQuery: (value: string) => void; results: readonly CampusPlace[]; detail: (place: CampusPlace) => string;
  places: readonly CampusPlace[]; buildings: readonly CampusBuilding[];
  emptyMessage: string; demoNotice: boolean; maxWidth: number; padding: number; busy: boolean;
  onClose: () => void; onChoose: (place: CampusPlace) => void; onCurrent: (() => void) | null; onMapPick: () => void;
  /** 화장실 찾기(target 'restroom')의 전체/남자/여자. 그 목록의 화장실만 거른다(출발·도착 검색은 줄이지 않는다). */
  restroomGender?: RestroomWanted; onRestroomGender?: (value: RestroomWanted) => void;
}) {
  const word = target === 'to' ? '도착' : '출발';
  const [path, setPath] = useState<TreePath>(TREE_ROOT);
  useEffect(() => setPath(TREE_ROOT), [target]);
  const browsing = query.trim() === '';
  const gendered = target === 'restroom' && restroomGender !== 'any';
  const places = useMemo(() => (gendered ? restroomCandidates(allPlaces, restroomGender) : allPlaces), [gendered, allPlaces, restroomGender]);
  const results = useMemo(() => (gendered ? restroomCandidates(allResults, restroomGender) : allResults), [gendered, allResults, restroomGender]);
  return <Modal visible={target !== null} animationType="slide" onRequestClose={onClose}><SafeAreaView style={{ flex: 1, backgroundColor: t.color.surface }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, width: '100%', maxWidth, alignSelf: 'center', paddingHorizontal: padding, paddingTop: 8, gap: 12 }}>
      <View style={c.searchHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={c.iconButton}><BackIcon /></Pressable>
        <Text accessibilityRole="header" style={c.searchTitle}>{target ? SEARCH_TITLE[target] : ''}</Text>
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
      {target === 'restroom' && <View style={{ gap: 6 }}>
        <Text style={c.genderCaption}>찾을 화장실</Text>
        <GenderChips value={restroomGender} onChange={(value) => onRestroomGender?.(value)} />
      </View>}
      {demoNotice && <Notice>가상 시험 데이터입니다. 실제 장소가 아닙니다.</Notice>}
      {!browsing && places.length > 0 && <TextButton title="건물·층으로 찾아보기" onPress={() => onQuery('')} />}
      {browsing && places.length > 0
        ? <PlaceTree places={places} buildings={buildings} path={path} onPath={setPath} onChoose={onChoose} detail={detail} />
        : <FlatList data={results} keyboardShouldPersistTaps="handled" keyExtractor={(item) => item.id} ListEmptyComponent={<Empty message={emptyMessage} />}
          renderItem={({ item }) => <PlaceRow place={item} detail={detail(item)} onPress={() => onChoose(item)} />} />}
    </KeyboardAvoidingView>
  </SafeAreaView></Modal>;
}
/** 전체 / 남자 / 여자 (화장실 찾기). */
export function GenderChips({ value, onChange }: { value: RestroomWanted; onChange: (value: RestroomWanted) => void }) {
  return <View accessibilityRole="radiogroup" accessibilityLabel="화장실 성별" style={c.segment}>{RESTROOM_WANTED.map((item) => {
    const on = item.value === value;
    return <Pressable key={item.value} accessibilityRole="radio" accessibilityLabel={`${item.label} 화장실`} accessibilityState={{ selected: on, checked: on }} onPress={() => onChange(item.value)} style={[c.segmentItem, { flex: 1 }, on && c.segmentOn]}>
      <Text style={[c.segmentText, on && c.segmentTextOn]}>{item.label}</Text>
    </Pressable>;
  })}</View>;
}
function PlaceRow({ place, detail, onPress }: { place: CampusPlace; detail: string; onPress: () => void }) {
  // 화장실은 성별 라벨을 함께 보인다(같은 건물의 남/여 화장실이 같은 이름일 수 있다).
  const line = place.nodeType === 'restroom' ? `${genderLabel(place)} · ${detail}` : detail;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${place.name}, ${line}`} onPress={onPress} style={({ pressed }) => [c.result, pressed && { backgroundColor: t.color.sunken }]}>
    <View style={c.resultPin}><View style={c.resultPinDot} /></View>
    <View style={{ flex: 1, gap: 2 }}><Text style={c.resultName}>{place.name}</Text><Text style={c.resultDetail}>{line}</Text></View>
  </Pressable>;
}
function TreeRow({ title, detail, onPress, label }: { title: string; detail: string; onPress: () => void; label?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label ?? `${title}, ${detail}`} onPress={onPress} style={({ pressed }) => [c.result, pressed && { backgroundColor: t.color.sunken }]}>
    <View style={{ flex: 1, gap: 2 }}><Text style={c.resultName}>{title}</Text><Text style={c.resultDetail}>{detail}</Text></View>
    <Text style={c.treeArrow}>›</Text>
  </Pressable>;
}
/** Building → floor → facilities drill-down. */
export function PlaceTree({ places, buildings, path, onPath, onChoose, detail }: {
  places: readonly CampusPlace[]; buildings: readonly CampusBuilding[]; path: TreePath; onPath: (path: TreePath) => void;
  onChoose: (place: CampusPlace) => void; detail: (place: CampusPlace) => string;
}) {
  const building = path.building === OUTDOOR_GROUP ? { name: '야외 장소' } : buildings.find((b) => b.id === path.building);
  const atFacilities = path.building !== null && (path.building === OUTDOOR_GROUP || path.level !== null);
  const levelText = (level: number) => (level === UNKNOWN_LEVEL ? '층 미확인' : floorText(level));
  const crumb = path.building === null ? '건물을 골라 주세요' : atFacilities && path.level !== null ? `${building?.name ?? ''} · ${levelText(path.level)}` : building?.name ?? '';
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
    <View style={c.treeHeader}>
      {path.building !== null && <Pressable accessibilityRole="button" accessibilityLabel="위 단계로" onPress={() => onPath(treeUp(path))} style={c.iconButton}><BackIcon color={t.color.muted} /></Pressable>}
      <Text accessibilityRole="header" style={c.treeTitle}>{crumb}</Text>
    </View>
    {path.building === null && buildingGroups(places, buildings).map((g) => <TreeRow key={g.id} title={g.name} detail={g.id === OUTDOOR_GROUP ? `장소 ${g.count}곳` : `${g.levelCount}개 층 · 장소 ${g.count}곳`}
      onPress={() => onPath({ building: g.id, level: null })} />)}
    {path.building !== null && !atFacilities && levelGroups(places, path.building).map((l) => <TreeRow key={l.level} title={l.label} detail={`시설 ${l.count}곳`}
      label={`${building?.name ?? ''} ${l.label}, 시설 ${l.count}곳`} onPress={() => onPath({ building: path.building, level: l.level })} />)}
    {atFacilities && facilityGroups(places, path.building!, path.level).map((group) => <View key={group.kind}>
      <Text style={c.treeSection}>{group.label} {group.places.length}</Text>
      {group.places.map((place) => <PlaceRow key={place.id} place={place} detail={detail(place)} onPress={() => onChoose(place)} />)}
    </View>)}
  </ScrollView>;
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
  sheet: { flexShrink: 0, marginTop: -18, overflow: 'hidden', borderTopLeftRadius: t.radii.sheet, borderTopRightRadius: t.radii.sheet, backgroundColor: t.color.surface, ...floating, shadowOffset: { width: 0, height: -3 } },
  handleRow: { minHeight: 28, justifyContent: 'center' },
  handleHit: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 40 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D5DCE5' },
  sheetTools: { position: 'absolute', right: 10, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 2 },
  sheetTool: { width: 36, height: 32, alignItems: 'center', justifyContent: 'center' },
  peek: { paddingHorizontal: 20, paddingBottom: 10, minHeight: 32, justifyContent: 'center' },
  quickChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingLeft: 6, paddingRight: 14, borderRadius: 20, backgroundColor: t.color.surface, ...floating },
  quickChipText: { fontSize: 14, fontWeight: '800', color: t.color.text },
  wcBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#2F6FD6', alignItems: 'center', justifyContent: 'center' },
  wcText: { color: 'white', fontSize: 10, fontWeight: '900', letterSpacing: -0.3 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 },
  toggleText: { fontSize: 15, fontWeight: '800', color: t.color.text },
  track: { width: 48, height: 28, borderRadius: 14, backgroundColor: '#C9D1DC', padding: 3, justifyContent: 'center' },
  trackOn: { backgroundColor: t.color.primary },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'white' },
  knobOn: { alignSelf: 'flex-end' },
  treeHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  treeTitle: { fontSize: 15, fontWeight: '800', color: t.color.muted, flexShrink: 1 },
  treeArrow: { fontSize: 22, color: t.color.faint, fontWeight: '600' },
  treeSection: { marginTop: 14, marginBottom: 2, fontSize: 13, fontWeight: '800', color: t.color.primary },
  sheetContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 14 },
  sheetFooter: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, borderTopWidth: 1, borderColor: t.color.divider, gap: 8 },
  mode: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 20, backgroundColor: t.color.sunken, borderWidth: 1, borderColor: t.color.border },
  modeOn: { backgroundColor: t.color.primary, borderColor: t.color.primary },
  modeText: { fontSize: 14, fontWeight: '600', color: t.color.text }, modeTextOn: { color: 'white', fontWeight: '800' },
  genderCaption: { fontSize: 13, fontWeight: '800', color: t.color.muted },
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
