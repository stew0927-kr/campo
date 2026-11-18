// [사진 촬영]: a full-screen camera with one large shutter. The picture's file URI goes back to whoever asked, with what
// its EXIF says about the lens and the size (survey/photoMeta.ts exifPhotoInfo). EXIF is only read, never written.
// iOS: a 0.5x / 1x button when the phone has an ultra-wide lens. Where there is none to use (Android, or an iPhone
// without one) a 갤러리에서 선택 button takes a picture the phone's own camera app made (at 0.5x, say) through the same path.
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exifPhotoInfo, type ExifPhotoInfo } from '../survey/photoMeta.ts';
import { BigButton } from './controls.tsx';
import { lensChoices, selectedLensFor, showGalleryButton, showLensToggle, type LensChoices } from './lenses.ts';
import { TOUCH, color, font, space } from './theme.ts';

interface Props {
  /** `info`: focal lengths, pixel size and field of view read from the picture's EXIF (fields left out when unknown). */
  onCapture: (uri: string, info: ExifPhotoInfo) => void;
  onClose: () => void;
  onError: (message: string) => void;
}

export function CameraCapture({ onCapture, onClose, onError }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [lenses, setLenses] = useState<LensChoices>({ ultraWide: null, wide: null });
  /** Whether the lens list has been read (or failed to read), so the gallery button does not flash up on an iPhone with 0.5x. */
  const [lensesKnown, setLensesKnown] = useState(Platform.OS !== 'ios');
  const [ultraOn, setUltraOn] = useState(false);
  const lens = selectedLensFor(lenses, ultraOn);

  /** An unreadable or empty list just means no 0.5x button; shooting is not affected. */
  const readLenses = (): void => {
    if (Platform.OS !== 'ios') return;
    void (camera.current?.getAvailableLensesAsync() ?? Promise.resolve([])).then(
      (list) => {
        setLenses(lensChoices(list));
        setLensesKnown(true);
      },
      () => setLensesKnown(true),
    );
  };

  const pickFromGallery = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const access = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!access.granted && access.accessPrivileges !== 'limited') {
        onError('사진을 불러오려면 사진 접근 권한이 필요합니다. 설정에서 허용하거나 바로 촬영해 주세요.');
        setBusy(false);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, exif: true, allowsMultipleSelection: false });
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset) {
        setBusy(false);
        return;
      }
      onCapture(asset.uri, exifPhotoInfo(asset.exif, asset));
    } catch (err) {
      onError(`사진을 불러오지 못했습니다. ${(err as Error).message}`);
      setBusy(false);
    }
  };

  const shoot = async (): Promise<void> => {
    if (busy || !camera.current) return;
    setBusy(true);
    try {
      // Moderate quality: the picture shows which door it is, and a walk takes dozens of them.
      const picture = await camera.current.takePictureAsync({ quality: 0.6, exif: true });
      onCapture(picture.uri, exifPhotoInfo(picture.exif, picture));
    } catch (err) {
      onError(`사진을 찍지 못했습니다. ${(err as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} accessibilityViewIsModal>
      {permission?.granted ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing="back"
          {...(lens !== null ? { selectedLens: lens } : {})}
          onCameraReady={readLenses}
          onAvailableLensesChanged={(e) => {
            setLenses(lensChoices(e.lenses));
            setLensesKnown(true);
          }}
        />
      ) : (
        <View style={styles.ask}>
          <Text style={styles.askText}>문·계단·출입구 사진을 찍으려면 카메라 권한이 필요합니다. 사진은 이 기기에만 저장되고, 내보낼 때 함께 묶입니다.</Text>
          {permission !== null && <BigButton label="카메라 권한 허용" onPress={() => void requestPermission()} />}
        </View>
      )}
      <View style={[styles.bar, { paddingBottom: insets.bottom + space.xl }]}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="촬영 취소" style={styles.cancel}>
          <Text style={styles.cancelLabel}>취소</Text>
        </Pressable>
        <Pressable
          onPress={() => void shoot()}
          disabled={busy || !permission?.granted}
          accessibilityRole="button"
          accessibilityLabel="사진 촬영"
          style={({ pressed }) => [styles.shutter, (pressed || busy) && { opacity: 0.6 }, !permission?.granted && { opacity: 0.3 }]}
        >
          <View style={styles.shutterCore} />
        </Pressable>
        <View style={styles.cancel}>
          {permission?.granted && showLensToggle(lenses.ultraWide) ? (
            <Pressable
              onPress={() => setUltraOn((on) => !on)}
              accessibilityRole="button"
              accessibilityLabel={ultraOn ? '1배 렌즈로 바꾸기' : '0.5배 초광각 렌즈로 바꾸기'}
              accessibilityState={{ selected: ultraOn }}
              style={[styles.lens, ultraOn && styles.lensOn]}
            >
              <Text style={[styles.lensLabel, ultraOn && styles.lensLabelOn]}>{ultraOn ? '0.5x' : '1x'}</Text>
            </Pressable>
          ) : showGalleryButton(Platform.OS, lenses.ultraWide, lensesKnown) ? (
            <Pressable
              onPress={() => void pickFromGallery()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="갤러리에서 사진 선택"
              accessibilityHint="휴대폰 카메라 앱으로 찍어 둔 사진을 불러옵니다"
              style={[styles.gallery, busy && { opacity: 0.6 }]}
            >
              <Text style={styles.cancelLabel}>갤러리에서 선택</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#000' },
  ask: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.xl },
  askText: { color: '#fff', fontSize: font.label, lineHeight: 26 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  cancel: { minWidth: TOUCH + space.xl, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' },
  cancelLabel: { color: '#fff', fontSize: font.label, fontWeight: '700' },
  lens: { width: TOUCH + 8, height: TOUCH + 8, borderRadius: (TOUCH + 8) / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1.5, borderColor: '#fff' },
  lensOn: { backgroundColor: '#FFD60A', borderColor: '#FFD60A' },
  lensLabel: { color: '#fff', fontSize: font.label, fontWeight: '800' },
  lensLabelOn: { color: '#000' },
  gallery: { minHeight: TOUCH, maxWidth: 92, alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 84, height: 84, borderRadius: 42, borderWidth: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterCore: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.surface },
});
