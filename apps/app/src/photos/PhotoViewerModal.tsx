// 확대 뷰어: 경로 순서대로 단계마다 한 페이지(가로로 넘김). 사진 위에 가야 할 방향 화살표를 그리고, 아래에 단계 문구·
// 방향 문구·direction_hint·배지·이전/다음 버튼을 둔다. 사진이 없는 단계는 문구 페이지로 안내한다.
// 화살표는 흰 채움 + 검은 테두리 모양과 글로 함께 전달한다(색만 쓰지 않는다). "동작 줄이기"면 애니메이션을 끈다.
//
// 사용 예:
//   const pages = useMemo(() => photoViewerPages(route, stepPhotos, catalog, placeName), [route, stepPhotos, catalog]);
//   <PhotoViewerModal visible={viewerIndex !== null} pages={pages} initialIndex={viewerIndex ?? 0} onClose={(last) => …} />
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RoutePhoto, RouteStepPhoto } from '../contracts.ts';
import { NO_PHOTO_TEXT, PHOTO_LOAD_FAILED_TEXT, arrowSentence, otherPhotosButtonText } from './photoText.ts';
import { withPhoto, type PhotoViewerPage } from './viewerModel.ts';
import { ArrowOverlay } from './PhotoArrowOverlay.tsx';

export interface PhotoViewerModalProps {
  visible: boolean;
  /** photoViewerPages(...)의 결과. */
  pages: readonly PhotoViewerPage[];
  /** 처음 보여 줄 페이지(지도에서 누른 썸네일의 위치). */
  initialIndex?: number;
  /** 닫을 때 마지막으로 본 페이지 위치를 준다(지도 Camera를 그 지점으로 옮길 때 쓴다). */
  onClose: (lastIndex: number) => void;
}

/** 시스템 "동작 줄이기" 설정. */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v), () => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

export function PhotoViewerModal({ visible, pages, initialIndex = 0, onClose }: PhotoViewerModalProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const list = useRef<FlatList<PhotoViewerPage>>(null);
  const start = Math.min(Math.max(0, initialIndex), Math.max(0, pages.length - 1));
  const [index, setIndex] = useState(start);
  /** 페이지별로 "이 지점 다른 사진"에서 고른 사진(없으면 자동으로 고른 사진). */
  const [chosen, setChosen] = useState<Record<string, RoutePhoto>>({});
  const [othersOpen, setOthersOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setIndex(start);
    setChosen({});
    setOthersOpen(false);
  }, [visible, start]);

  // 화면이 돌아가 폭이 바뀌면 보던 페이지에 다시 맞춘다(페이지 폭 = 화면 폭).
  useEffect(() => {
    if (visible && pages.length > 0) list.current?.scrollToIndex({ index, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const go = useCallback((to: number) => {
    if (to < 0 || to >= pages.length) return;
    list.current?.scrollToIndex({ index: to, animated: !reduceMotion });
    setIndex(to);
    setOthersOpen(false);
  }, [pages.length, reduceMotion]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const to = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (to !== index && to >= 0 && to < pages.length) {
      setIndex(to);
      setOthersOpen(false);
    }
  };

  const page = pages[index];
  const shown = useMemo(() => (page ? (chosen[page.key] ? withPhoto(page.step, chosen[page.key]!) : page.step) : null), [page, chosen]);

  return (
    <Modal
      visible={visible}
      presentationStyle="fullScreen"
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={() => onClose(index)}
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={styles.root}>
        {pages.length === 0 ? (
          <View style={[styles.empty, { paddingTop: insets.top + 24 }]}>
            <Text style={styles.emptyText} accessibilityRole="text">{NO_PHOTO_TEXT}</Text>
            <ViewerButton label="닫기" onPress={() => onClose(0)} />
          </View>
        ) : (
          <>
            <FlatList
              ref={list}
              data={pages as PhotoViewerPage[]}
              keyExtractor={(p) => p.key}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={start}
              getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
              windowSize={3}
              initialNumToRender={1}
              maxToRenderPerBatch={2}
              onMomentumScrollEnd={onScrollEnd}
              extraData={chosen}
              renderItem={({ item }) => (
                <PhotoPage width={width} page={item} step={chosen[item.key] ? withPhoto(item.step, chosen[item.key]!) : item.step} />
              )}
            />

            {/* 위: 번호와 장소, 닫기 */}
            <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
              <Text style={styles.counter} accessibilityRole="header" numberOfLines={2}>{page?.counter}</Text>
              <ViewerButton label="닫기" onPress={() => onClose(index)} />
            </View>

            {/* 아래: 단계 문구, 방향, 힌트, 배지, 다른 사진, 이전/다음 */}
            {page && shown && (
              <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
                <Text style={styles.stepText}>{page.stepText}</Text>
                {shown.arrow && <Text style={styles.direction}>{arrowSentence(shown.arrow)}</Text>}
                {shown.photo?.direction_hint && <Text style={styles.hint}>{shown.photo.direction_hint}</Text>}
                {shown.badge && (
                  <View style={styles.badge} accessibilityRole="alert">
                    <Text style={styles.badgeMark}>!</Text>
                    <Text style={styles.badgeText}>{shown.badge}</Text>
                  </View>
                )}
                {page.others.length > 0 && (
                  <ViewerButton
                    label={otherPhotosButtonText(page.others.length)}
                    onPress={() => setOthersOpen((o) => !o)}
                    expanded={othersOpen}
                  />
                )}
                {othersOpen && (
                  <ScrollView horizontal contentContainerStyle={styles.others} accessibilityLabel="이 지점 다른 사진 목록">
                    {[...(page.step.photo ? [page.step.photo] : []), ...page.others].map((p, i) => (
                      <Pressable
                        key={p.photoId}
                        onPress={() => {
                          setChosen((c) => ({ ...c, [page.key]: p }));
                          setOthersOpen(false);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${i + 1}번째 사진으로 보기${p.heading_deg === null ? ', 방향 정보 없음' : ''}`}
                        accessibilityState={{ selected: (shown.photo?.photoId ?? null) === p.photoId }}
                        style={[styles.otherThumb, (shown.photo?.photoId ?? null) === p.photoId && styles.otherThumbOn]}
                      >
                        <Image source={{ uri: p.thumbUrl }} cachePolicy="memory-disk" contentFit="cover" style={styles.fill} />
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
                <View style={styles.nav}>
                  <ViewerButton label="이전" onPress={() => go(index - 1)} disabled={index === 0} />
                  <ViewerButton label="다음" onPress={() => go(index + 1)} disabled={index >= pages.length - 1} />
                </View>
              </View>
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

/** 한 페이지: 사진과 그 위의 화살표, 또는 사진 없는 안내. */
function PhotoPage({ width, page, step }: { width: number; page: PhotoViewerPage; step: RouteStepPhoto }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [step.photo?.fullUrl]);
  const photo = step.photo;
  return (
    <View style={[styles.page, { width }]} accessible accessibilityRole={photo && !failed ? 'image' : 'text'} accessibilityLabel={page.accessibilityLabel}>
      {photo && !failed ? (
        <View style={styles.fill}>
          <Image
            source={{ uri: photo.fullUrl }}
            placeholder={{ uri: photo.thumbUrl }}
            cachePolicy="memory-disk"
            contentFit="contain"
            recyclingKey={page.key}
            style={styles.fill}
            onError={() => setFailed(true)}
            accessibilityIgnoresInvertColors
          />
          {step.arrow && <ArrowOverlay arrow={step.arrow} />}
        </View>
      ) : (
        <View style={styles.noPhoto}>
          <Text style={styles.noPhotoText}>{photo ? PHOTO_LOAD_FAILED_TEXT : NO_PHOTO_TEXT}</Text>
        </View>
      )}
    </View>
  );
}

function ViewerButton({ label, onPress, disabled = false, expanded }: { label: string; onPress: () => void; disabled?: boolean; expanded?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, ...(expanded !== undefined ? { expanded } : {}) }}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, disabled && styles.buttonDisabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  fill: { width: '100%', height: '100%' },
  page: { flex: 1, justifyContent: 'center' },
  empty: { flex: 1, padding: 24, gap: 24, justifyContent: 'center' },
  emptyText: { color: '#FFFFFF', fontSize: 18, lineHeight: 26 },
  noPhoto: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  noPhotoText: { color: '#FFFFFF', fontSize: 18, lineHeight: 26, textAlign: 'center' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8, backgroundColor: 'rgba(0,0,0,0.55)' },
  counter: { flex: 1, color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, gap: 8, backgroundColor: 'rgba(0,0,0,0.7)' },
  stepText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', lineHeight: 25 },
  direction: { color: '#FFFFFF', fontSize: 16, lineHeight: 22 },
  hint: { color: '#FFFFFF', fontSize: 15, lineHeight: 21, fontStyle: 'italic' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, backgroundColor: '#FFD400', borderWidth: 2, borderColor: '#000000' },
  badgeMark: { color: '#000000', fontWeight: '900', fontSize: 15 },
  badgeText: { color: '#000000', fontWeight: '700', fontSize: 15 },
  others: { gap: 8, paddingVertical: 4 },
  otherThumb: { width: 64, height: 64, borderRadius: 8, borderWidth: 2, borderColor: '#666666', overflow: 'hidden' },
  otherThumbOn: { borderColor: '#FFFFFF', borderWidth: 3 },
  nav: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  button: { minHeight: 48, minWidth: 72, paddingHorizontal: 16, borderRadius: 24, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' },
  buttonPressed: { backgroundColor: 'rgba(255,255,255,0.25)' },
  buttonDisabled: { opacity: 0.35 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
