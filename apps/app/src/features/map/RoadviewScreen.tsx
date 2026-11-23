// Campus roadview: split screen (photo ≈55% on top, mini map below with the photo's field-of-view cone, info card at
// the bottom) and a full-screen mode. The photo pick, the other-direction list and the arrow come from the pure
// roadview model (core choosePhotoForStep / photosForPoint / arrowFor), so the screen only draws them.
import { Image } from 'expo-image';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RoutePhoto, RoutePoint } from '../../contracts.ts';
import { ArrowOverlay } from '../../photos/PhotoArrowOverlay.tsx';
import { headingLabel } from '../../photos/demoPhotoArt.ts';
import { PHOTO_LOAD_FAILED_TEXT, arrowSentence } from '../../photos/photoText.ts';
import { framePhoto, placeLine, viewingText, type RoadviewFrame } from '../../photos/roadviewModel.ts';
import { RoadviewMiniMap } from './RoadviewMiniMap.tsx';

export interface RoadviewScreenProps {
  visible: boolean;
  frames: readonly RoadviewFrame[];
  initialIndex?: number;
  /** Route line for the mini map. */
  route?: readonly RoutePoint[] | null;
  onClose: (lastIndex: number) => void;
}

export function RoadviewScreen({ visible, frames, initialIndex = 0, route = null, onClose }: RoadviewScreenProps) {
  const insets = useSafeAreaInsets();
  const start = Math.min(Math.max(0, initialIndex), Math.max(0, frames.length - 1));
  const [index, setIndex] = useState(start);
  const [chosen, setChosen] = useState<Record<string, RoutePhoto>>({});
  const [othersOpen, setOthersOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (visible) { setIndex(start); setChosen({}); setOthersOpen(false); setFull(false); } }, [visible, start]);

  const frame = frames[index];
  const shown = useMemo(() => (frame ? (chosen[frame.key] ? framePhoto(frame, chosen[frame.key]!) : frame.step) : null), [frame, chosen]);
  const photo = shown?.photo ?? null;
  useEffect(() => setFailed(false), [photo?.fullUrl]);
  const stops = useMemo(() => frames.map((f) => f.lngLat).filter((p): p is [number, number] => p !== null), [frames]);
  const go = (to: number) => { if (to >= 0 && to < frames.length) { setIndex(to); setOthersOpen(false); } };
  const pick = (p: RoutePhoto) => { if (frame) setChosen((c) => ({ ...c, [frame.key]: p })); };

  return <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" onRequestClose={() => (full ? setFull(false) : onClose(index))} supportedOrientations={['portrait', 'landscape']}>
    <View style={s.root}>
      {!frame || !shown ? <View style={[s.empty, { paddingTop: insets.top + 24 }]}>
        <Text style={s.emptyText}>이 지점은 아직 로드뷰 사진이 없습니다.</Text>
        <RvButton label="닫기" onPress={() => onClose(0)}><Text style={s.btnText}>닫기</Text></RvButton>
      </View> : <>
        <View style={[s.photoArea, full ? { flex: 1 } : { height: '55%' }]}>
          {photo && !failed
            ? <Image source={{ uri: photo.fullUrl }} placeholder={{ uri: photo.thumbUrl }} contentFit={full ? 'contain' : 'cover'} cachePolicy="memory-disk" style={s.fill}
              onError={() => setFailed(true)} accessibilityLabel={`${frame.place.name}, ${headingLabel(photo.heading_deg)} 방향 사진`} />
            : <View style={[s.fill, s.noPhoto]}><Text style={s.emptyText}>{photo ? PHOTO_LOAD_FAILED_TEXT : '이 지점은 아직 사진이 없습니다.'}</Text></View>}
          {shown.arrow && <ArrowOverlay arrow={shown.arrow} />}

          <View style={[s.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
            <RvButton label="로드뷰 닫기" onPress={() => onClose(index)}><Text style={s.btnText}>✕</Text></RvButton>
            <View style={s.titlePill} pointerEvents="none">
              <Text numberOfLines={1} style={s.titleText}>{frame.place.name}</Text>
              {frame.counter && <Text numberOfLines={1} style={s.counterText}>{frame.counter}</Text>}
            </View>
          </View>

          {frames.length > 1 && <>
            <View style={[s.side, { left: 8 }]} pointerEvents="box-none"><RvButton label="이전 단계" disabled={index === 0} onPress={() => go(index - 1)}><Text style={s.sideGlyph}>‹</Text></RvButton></View>
            <View style={[s.side, { right: 8 }]} pointerEvents="box-none"><RvButton label="다음 단계" disabled={index >= frames.length - 1} onPress={() => go(index + 1)}><Text style={s.sideGlyph}>›</Text></RvButton></View>
          </>}

          <View style={s.bottomBar} pointerEvents="box-none">
            <View style={{ flex: 1, gap: 8 }} pointerEvents="box-none">
              {othersOpen && <ScrollView horizontal contentContainerStyle={s.dirRow} accessibilityLabel="이 지점 다른 방향 사진 목록">
                {frame.photos.map((p) => {
                  const on = p.photoId === photo?.photoId;
                  return <Pressable key={p.photoId} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${headingLabel(p.heading_deg)} 방향 사진`} onPress={() => pick(p)} style={[s.dirChip, on && s.dirChipOn]}>
                    <Image source={{ uri: p.thumbUrl }} contentFit="cover" style={s.dirThumb} />
                    <Text style={[s.dirText, on && s.dirTextOn]}>{headingLabel(p.heading_deg)}</Text>
                  </Pressable>;
                })}
              </ScrollView>}
              {frame.photos.length > 1 && <Pressable accessibilityRole="button" accessibilityState={{ expanded: othersOpen }} accessibilityLabel={`이 지점 다른 방향 사진 ${frame.photos.length - 1}장`} onPress={() => setOthersOpen((o) => !o)} style={s.otherBtn}>
                <Text style={s.otherText}>이 지점 다른 방향 사진({frame.photos.length - 1})</Text>
              </Pressable>}
            </View>
            <RvButton label={full ? '분할 화면으로 돌아가기' : '전체화면으로 보기'} onPress={() => setFull((f) => !f)}><ExpandGlyph inward={full} /></RvButton>
          </View>
        </View>

        {!full && <View style={s.lower}>
          <RoadviewMiniMap lngLat={frame.lngLat} headingDeg={photo?.heading_deg ?? null} {...(photo?.hfov_deg ? { hfovDeg: photo.hfov_deg } : {})} route={route} stops={stops} label={`${frame.place.name} 미니 지도`} />
          <View style={[s.card, { marginBottom: insets.bottom + 12 }]} accessible accessibilityLiveRegion="polite">
            <View style={s.cardHead}>
              <Text style={s.cardTitle} numberOfLines={1}>{frame.place.name}</Text>
              <View style={[s.tag, frame.place.indoor ? s.tagIndoor : s.tagOutdoor]}><Text style={s.tagText}>{frame.place.indoor ? '실내' : '실외'}</Text></View>
            </View>
            <Text style={s.cardLine}>{placeLine(frame.place)} · {viewingText(photo)}</Text>
            <Text style={s.cardStep}>{frame.stepText}</Text>
            {shown.arrow && <Text style={s.cardLine}>{arrowSentence(shown.arrow)}</Text>}
            {shown.badge && <Text style={s.badge}>! {shown.badge}</Text>}
          </View>
        </View>}
      </>}
    </View>
  </Modal>;
}

function RvButton({ label, onPress, disabled = false, children }: { label: string; onPress: () => void; disabled?: boolean; children: ReactNode }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} hitSlop={6} onPress={onPress}
    style={({ pressed }) => [s.btn, pressed && { backgroundColor: 'rgba(255,255,255,0.3)' }, disabled && { opacity: 0.3 }]}>{children}</Pressable>;
}
/** ↗↙ (expand) or ↙↗ pointing inward (back to the split view). */
function ExpandGlyph({ inward }: { inward: boolean }) {
  return <View style={{ width: 26, height: 26 }}>
    <Text style={[s.expand, { right: 0, top: -4 }]}>{inward ? '↙' : '↗'}</Text>
    <Text style={[s.expand, { left: 0, bottom: -4 }]}>{inward ? '↗' : '↙'}</Text>
  </View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E1520' },
  fill: { width: '100%', height: '100%' },
  empty: { flex: 1, padding: 24, gap: 24, justifyContent: 'center' },
  emptyText: { color: '#FFFFFF', fontSize: 17, lineHeight: 25, textAlign: 'center' },
  noPhoto: { alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#1D2733' },
  photoArea: { width: '100%', backgroundColor: '#000000', overflow: 'hidden' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
  titlePill: { flexShrink: 1, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 22, backgroundColor: 'rgba(20,30,45,0.78)' },
  titleText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  counterText: { color: '#D5DCE5', fontSize: 12, fontWeight: '600' },
  side: { position: 'absolute', top: '42%' },
  sideGlyph: { color: '#FFFFFF', fontSize: 30, lineHeight: 32, fontWeight: '700' },
  bottomBar: { position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  otherBtn: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 20, backgroundColor: 'rgba(20,30,45,0.8)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
  otherText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  dirRow: { gap: 8 },
  dirChip: { width: 92, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'rgba(255,255,255,0.4)', backgroundColor: 'rgba(20,30,45,0.85)' },
  dirChipOn: { borderColor: '#1FBF7A', borderWidth: 3 },
  dirThumb: { width: '100%', height: 56 },
  dirText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 4 },
  dirTextOn: { color: '#7CF0B8' },
  btn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(20,30,45,0.72)' },
  btnText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  expand: { position: 'absolute', color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  lower: { flex: 1, backgroundColor: '#E8EEE9' },
  card: { position: 'absolute', left: 12, right: 12, bottom: 0, backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 14, gap: 4, shadowColor: '#0B1F3A', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flexShrink: 1, fontSize: 19, fontWeight: '900', color: '#142A44', letterSpacing: -0.3 },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  tagIndoor: { backgroundColor: '#7A4FD6' }, tagOutdoor: { backgroundColor: '#18744D' },
  tagText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  cardLine: { fontSize: 14, color: '#4A5A6E', lineHeight: 20 },
  cardStep: { fontSize: 15, color: '#142A44', fontWeight: '700', lineHeight: 21 },
  badge: { alignSelf: 'flex-start', fontSize: 13, fontWeight: '800', color: '#000000', backgroundColor: '#FFD400', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
});
