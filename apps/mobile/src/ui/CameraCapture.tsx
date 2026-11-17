// [사진 촬영]: a full-screen camera with one large shutter. The picture's file URI goes back to whoever asked.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BigButton } from './controls.tsx';
import { TOUCH, color, font, space } from './theme.ts';

interface Props {
  onCapture: (uri: string) => void;
  onClose: () => void;
  onError: (message: string) => void;
}

export function CameraCapture({ onCapture, onClose, onError }: Props) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);

  const shoot = async (): Promise<void> => {
    if (busy || !camera.current) return;
    setBusy(true);
    try {
      // Moderate quality: the picture shows which door it is, and a walk takes dozens of them.
      const picture = await camera.current.takePictureAsync({ quality: 0.6 });
      onCapture(picture.uri);
    } catch (err) {
      onError(`사진을 찍지 못했습니다. ${(err as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} accessibilityViewIsModal>
      {permission?.granted ? (
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
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
        <View style={styles.cancel} />
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
  shutter: { width: 84, height: 84, borderRadius: 42, borderWidth: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterCore: { width: 64, height: 64, borderRadius: 32, backgroundColor: color.surface },
});
