// 안내도 자동 매핑: a photo of the floor guide → the floorplan server → a draft of points and corridors for this floor.
// Photo (camera or gallery, shrunk to FLOORPLAN_MAX_PX) → turn it upright → 매핑 시작 → result → 지도에 반영.
// The sheet owns the photo and the request; putting the draft on the map is the screen's (onApply).
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { MSG_NOT_CONFIGURED, requestFloorplan, type FloorplanResult } from '../floorplan/client.ts';
import { FLOORPLAN_JPEG_QUALITY, shrinkTo } from '../floorplan/photo.ts';
import { floorLabel } from '../model/scope.ts';
import { BottomSheet } from './BottomSheet.tsx';
import { BigButton, Choice, FieldLabel } from './controls.tsx';
import { color, font, radius, space } from './theme.ts';

export type Rotation = 0 | 90 | 180 | 270;
const ROTATION_OPTIONS: readonly { value: Rotation; label: string }[] = [
  { value: 0, label: '0°' }, { value: 90, label: '90°' }, { value: 180, label: '180°' }, { value: 270, label: '270°' },
];

interface Photo {
  uri: string;
  width: number;
  height: number;
  base64: string;
}

interface Props {
  buildingName: string;
  buildingId: string;
  level: number;
  /** Outer ring of this floor (or of the building), [lng, lat]. */
  polygon: number[][];
  /** null: no server configured (the start button is off). */
  endpoint: string | null;
  anonKey?: string | undefined;
  /** Put the draft on the map. Returns whether it went in (the sheet then closes). */
  onApply: (result: FloorplanResult, rotationDeg: Rotation) => boolean;
  onError: (text: string) => void;
  onClose: () => void;
}

/** The photo shrunk to the long side FLOORPLAN_MAX_PX as a JPEG, read as base64. */
async function preparePhoto(asset: ImagePicker.ImagePickerAsset): Promise<Photo> {
  const context = ImageManipulator.manipulate(asset.uri);
  try {
    const size = shrinkTo(asset.width, asset.height);
    if (size) context.resize(size);
    const image = await context.renderAsync();
    try {
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: FLOORPLAN_JPEG_QUALITY });
      const base64 = await new File(saved.uri).base64();
      return { uri: saved.uri, width: saved.width, height: saved.height, base64 };
    } finally {
      image.release();
    }
  } finally {
    context.release();
  }
}

export function FloorplanSheet({ buildingName, buildingId, level, polygon, endpoint, anonKey, onApply, onError, onClose }: Props) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [picking, setPicking] = useState(false);
  const [mapping, setMapping] = useState(false);
  const [result, setResult] = useState<FloorplanResult | null>(null);
  /** The last problem, shown in the sheet (the screen's notice sits under it) and passed on. */
  const [problem, setProblem] = useState<string | null>(null);
  const report = (text: string): void => {
    setProblem(text);
    onError(text);
  };
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const pick = async (from: 'camera' | 'library'): Promise<void> => {
    if (picking || mapping) return;
    setPicking(true);
    setProblem(null);
    try {
      const access = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!access.granted && !('accessPrivileges' in access && access.accessPrivileges === 'limited')) {
        report(from === 'camera' ? '안내도를 찍으려면 카메라 권한이 필요합니다. 설정에서 허용해 주세요.' : '사진을 불러오려면 사진 접근 권한이 필요합니다. 설정에서 허용해 주세요.');
        return;
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: FLOORPLAN_JPEG_QUALITY, exif: false, allowsMultipleSelection: false };
      const picked = from === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      const asset = picked.canceled ? undefined : picked.assets[0];
      if (!asset) return;
      const ready = await preparePhoto(asset);
      if (!alive.current) return;
      setPhoto(ready);
      setRotation(0);
      setResult(null);
    } catch {
      if (alive.current) report('사진을 준비하지 못했습니다. 다시 골라 주세요.');
    } finally {
      if (alive.current) setPicking(false);
    }
  };

  const start = async (): Promise<void> => {
    if (!photo || !endpoint || mapping) return;
    setMapping(true);
    setResult(null);
    setProblem(null);
    const r = await requestFloorplan({
      imageBase64: photo.base64, mimeType: 'image/jpeg', buildingId, level, buildingPolygon: polygon, rotationDeg: rotation,
      imageWidth: photo.width, imageHeight: photo.height,
    }, { endpoint, anonKey });
    if (!alive.current) return;
    setMapping(false);
    if ('error' in r) report(r.error);
    else setResult(r);
  };

  const warnings = result?.summary.warnings ?? [];
  return (
    <BottomSheet title={`${buildingName} ${floorLabel(level)} 안내도 자동 매핑`} onClose={onClose}>
      <Text style={styles.note}>층별안내도 사진에서 복도·문·계단·엘리베이터·화장실을 읽어 이 층에 한 번에 놓습니다. 놓은 지점은 모두 확인 필요로 표시되니 현장에서 확인해 주세요.</Text>

      <FieldLabel>1. 안내도 사진</FieldLabel>
      <View style={styles.row}>
        <BigButton label="촬영" onPress={() => void pick('camera')} disabled={picking || mapping} style={styles.half} />
        <BigButton label="갤러리" tone="plain" onPress={() => void pick('library')} disabled={picking || mapping} style={styles.half} />
      </View>
      {picking && <Text style={styles.note}>사진을 준비하는 중입니다…</Text>}

      {photo && (
        <>
          <FieldLabel>2. 방향</FieldLabel>
          <Text style={styles.note}>평면도가 바로 서도록 돌려 주세요.</Text>
          <View style={styles.preview}>
            <Image
              source={{ uri: photo.uri }}
              resizeMode="contain"
              accessibilityLabel={`안내도 미리보기, ${rotation}도 회전`}
              style={[styles.previewImage, { transform: [{ rotate: `${rotation}deg` }] }]}
            />
          </View>
          <Choice label="회전" options={ROTATION_OPTIONS} value={rotation} onChange={(r) => {
            setRotation(r);
            setResult(null);
          }} />

          <FieldLabel>3. 매핑</FieldLabel>
          {endpoint === null && <Text style={[styles.note, styles.warn]}>{MSG_NOT_CONFIGURED}</Text>}
          <BigButton label="매핑 시작" onPress={() => void start()} disabled={endpoint === null || mapping} />
          {mapping && (
            <View style={styles.busy}>
              <ActivityIndicator color={color.primary} />
              <Text style={styles.note}>안내도를 읽는 중입니다… (30초쯤 걸립니다)</Text>
            </View>
          )}
        </>
      )}

      {problem !== null && <Text style={[styles.note, styles.problem]} accessibilityLiveRegion="polite">{problem}</Text>}

      {result && (
        <>
          <FieldLabel>4. 결과</FieldLabel>
          <Text style={styles.result}>지점 {result.summary.nodeCount}개 · 복도 {result.summary.edgeCount}개를 찾았습니다.</Text>
          {warnings.slice(0, 3).map((w, i) => <Text key={i} style={[styles.note, styles.warn]}>· {w}</Text>)}
          {warnings.length > 3 && <Text style={styles.note}>그 밖의 알림 {warnings.length - 3}개</Text>}
          <Text style={styles.note}>다른 층에 이미 매핑된 계단·엘리베이터가 있으면 자동으로 수직 연결합니다(확인 필요로 표시).</Text>
          <View style={styles.row}>
            <BigButton label="지도에 반영" onPress={() => {
              if (onApply(result, rotation)) onClose();
            }} style={styles.half} />
            <BigButton label="취소" tone="plain" onPress={onClose} style={styles.half} />
          </View>
        </>
      )}
    </BottomSheet>
  );
}

const PREVIEW = 220;
const styles = StyleSheet.create({
  note: { fontSize: font.body, color: color.inkSoft, marginBottom: space.sm },
  warn: { color: color.warn },
  problem: { color: color.danger, fontWeight: '600', marginTop: space.md },
  row: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  half: { flex: 1 },
  preview: {
    height: PREVIEW, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: space.md,
  },
  previewImage: { width: PREVIEW - space.lg * 2, height: PREVIEW - space.lg * 2 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  result: { fontSize: font.label, fontWeight: '700', color: color.ink, marginBottom: space.sm },
});
