// Sheets of the tool row: 건물 이름·층 (after an outline is drawn), 층 복사·연동, 사진 방향, 설정 (offline map).
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { floorLabel } from '../model/scope.ts';
import { parseLevelRange } from '../survey/buildings.ts';
import { BottomSheet } from './BottomSheet.tsx';
import { BigButton, FieldLabel } from './controls.tsx';
import { compassWord } from './dial.ts';
import { TOUCH, color, font, radius, space } from './theme.ts';

// ---- 직접 그린 건물의 이름과 층 ----

export function BuildingFormSheet({ corners, onSave, onClose }: { corners: number; onSave: (answer: { name: string; levels: number[] }) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [levelsText, setLevelsText] = useState('1~3');
  const levels = parseLevelRange(levelsText);
  return (
    <BottomSheet title="새 건물 이름과 층" onClose={onClose}>
      <Text style={styles.note}>외곽선 점 {corners}개로 건물을 만듭니다. 편집기에서 모양과 코드를 더 고칠 수 있습니다.</Text>
      <FieldLabel>건물 이름</FieldLabel>
      <TextInput value={name} onChangeText={setName} placeholder="예: 학생회관" placeholderTextColor={color.inkSoft} accessibilityLabel="건물 이름" style={styles.input} />
      <FieldLabel>층 (지하 1층은 -1)</FieldLabel>
      <TextInput
        value={levelsText}
        onChangeText={setLevelsText}
        placeholder="예: -1~4 또는 1,2,3"
        placeholderTextColor={color.inkSoft}
        accessibilityLabel="층"
        autoCorrect={false}
        style={styles.input}
      />
      <Text style={styles.note}>{levels ? `${levels.map(floorLabel).join(', ')} (${levels.length}개 층)` : '층을 숫자로 적어 주세요. 0층은 없습니다.'}</Text>
      <BigButton label="건물 추가" disabled={name.trim() === '' || levels === null} onPress={() => levels && onSave({ name, levels })} style={styles.gap} />
    </BottomSheet>
  );
}

// ---- 층 복사 · 연동 ----

interface FloorCopyProps {
  buildingName: string;
  level: number;
  /** The other floors of the building, top first. */
  targets: readonly number[];
  /** Synced points on this floor. */
  syncedCount: number;
  /** The point under the crosshair, when there is one: it can be moved and un-synced alone. */
  point: { title: string; synced: boolean } | null;
  onCopy: (levels: number[]) => void;
  onUnsyncFloor: () => void;
  onUnsyncPoint: () => void;
  onMovePoint: () => void;
  onClose: () => void;
}

export function FloorCopySheet({ buildingName, level, targets, syncedCount, point, onCopy, onUnsyncFloor, onUnsyncPoint, onMovePoint, onClose }: FloorCopyProps) {
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (l: number) => setPicked((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l]));
  return (
    <BottomSheet title={`${buildingName} ${floorLabel(level)} 복사·연동`} onClose={onClose}>
      <Text style={styles.note}>이 층의 지점(복도·계단참·엘리베이터 정차)과 복도를 다른 층의 같은 자리에 복사합니다. 복사한 지점은 서로 연동되어, 한 층에서 지점을 옮기거나 복도를 이으면 연동된 층에도 같이 반영됩니다.</Text>
      <FieldLabel>어느 층에 복사할까요?</FieldLabel>
      {targets.length === 0 ? <Text style={styles.note}>이 건물에는 다른 층이 없습니다.</Text> : (
        <View style={styles.chips}>
          {targets.map((l) => {
            const on = picked.includes(l);
            return (
              <Pressable key={l} onPress={() => toggle(l)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={floorLabel(l)} style={[styles.chip, on && styles.chipOn]}>
                <Text style={[styles.chipLabel, on && styles.onColor]}>{floorLabel(l)}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <BigButton label={picked.length === 0 ? '복사할 층을 골라 주세요' : `${picked.length}개 층에 복사`} disabled={picked.length === 0} onPress={() => onCopy(picked)} style={styles.gap} />

      <FieldLabel>연동</FieldLabel>
      <BigButton tone="plain" label={`이 층 연동 모두 해제 (${syncedCount}개 지점)`} disabled={syncedCount === 0} onPress={onUnsyncFloor} />
      {point ? (
        <>
          <FieldLabel>십자선 자리의 {point.title}</FieldLabel>
          <BigButton tone="plain" label={point.synced ? '이 지점 옮기기 (연동된 층도 같이)' : '이 지점 옮기기'} onPress={onMovePoint} />
          <BigButton tone="plain" label="이 지점 연동 해제" disabled={!point.synced} onPress={onUnsyncPoint} style={styles.gapSm} />
        </>
      ) : <Text style={styles.note}>지점을 옮기거나 하나만 연동 해제하려면 십자선을 지점에 맞춘 뒤 이 창을 다시 열어 주세요.</Text>}
    </BottomSheet>
  );
}

// ---- 사진과 방향 ----

export interface PhotoItem {
  path: string;
  heading: number | null;
}

interface PhotosProps {
  title: string;
  photos: readonly PhotoItem[];
  onAdd: () => void;
  onHeading: (path: string) => void;
  onClose: () => void;
}

export function PhotosSheet({ title, photos, onAdd, onHeading, onClose }: PhotosProps) {
  return (
    <BottomSheet title={title} onClose={onClose}>
      <Text style={styles.note}>한 지점에 여러 장을 각각 다른 방향으로 남길 수 있습니다(예: 복도 양쪽). 길 안내에서 걷는 방향과 가장 가까운 사진이 보입니다.</Text>
      {photos.length === 0 && <Text style={styles.note}>아직 사진이 없습니다.</Text>}
      {photos.map((p, i) => (
        <View key={p.path} style={styles.photoRow}>
          <Text style={styles.photoText}>사진 {i + 1} · {p.heading === null ? '방향 없음' : `${p.heading}° ${compassWord(p.heading)}쪽`}</Text>
          <Pressable onPress={() => onHeading(p.path)} accessibilityRole="button" accessibilityLabel={`사진 ${i + 1} 방향 설정`} style={styles.small}>
            <Text style={styles.smallLabel}>방향 설정</Text>
          </Pressable>
        </View>
      ))}
      <BigButton label="사진 추가" onPress={onAdd} style={styles.gap} />
    </BottomSheet>
  );
}

// ---- 설정: 오프라인 지도 ----

export interface PrefetchState {
  running: boolean;
  done: number;
  total: number;
  /** The last finished run. */
  result: { downloaded: number; already: number; failed: number } | null;
}

interface SettingsProps {
  usage: { files: number; bytes: number };
  /** Tiles a pre-save would fetch, and how far the campus reaches. */
  plan: { tiles: number; spanM: number } | null;
  prefetch: PrefetchState;
  onPrefetch: () => void;
  onCancel: () => void;
  onClear: () => void;
  onClose: () => void;
}

const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

export function SettingsSheet({ usage, plan, prefetch, onPrefetch, onCancel, onClear, onClose }: SettingsProps) {
  return (
    <BottomSheet title="설정" onClose={onClose}>
      <FieldLabel>지도 배경 (오프라인)</FieldLabel>
      <Text style={styles.lead}>한 번 받은 지도 타일은 이 기기에 저장되어 다시 받지 않습니다. 현재 {usage.files}장, {mb(usage.bytes)}.</Text>
      <Text style={styles.note}>
        {plan ? `현재 캠퍼스 범위(가로 세로 약 ${plan.spanM}m)의 타일 ${plan.tiles}장을 미리 저장하면 인터넷이 없는 건물 근처에서도 지도 배경이 보입니다. 지도 서버에 부담을 주지 않도록 필요한 범위만 저장하며, 와이파이에서 받는 것을 권합니다.` : '저장할 캠퍼스 범위를 찾지 못했습니다.'}
      </Text>
      {prefetch.running ? (
        <>
          <View style={styles.bar} accessibilityRole="progressbar" accessibilityLabel={`${prefetch.done}/${prefetch.total}장 저장`}>
            <View style={[styles.barFill, { width: `${prefetch.total === 0 ? 0 : Math.round((prefetch.done / prefetch.total) * 100)}%` }]} />
          </View>
          <Text style={styles.note}>{prefetch.done} / {prefetch.total}장 저장 중입니다.</Text>
          <BigButton tone="plain" label="중단" onPress={onCancel} style={styles.gapSm} />
        </>
      ) : (
        <BigButton label="캠퍼스 범위 지도 미리 저장" disabled={!plan} onPress={onPrefetch} style={styles.gap} />
      )}
      {prefetch.result && !prefetch.running && (
        <Text style={styles.note}>
          새로 {prefetch.result.downloaded}장, 이미 있던 {prefetch.result.already}장{prefetch.result.failed > 0 ? `, 받지 못한 ${prefetch.result.failed}장` : ''}.
        </Text>
      )}
      <BigButton tone="plain" label="저장된 지도 지우기" disabled={usage.files === 0 || prefetch.running} onPress={onClear} style={styles.gapSm} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: font.body, lineHeight: 20, color: color.ink, marginTop: space.xs },
  note: { fontSize: font.small, lineHeight: 18, color: color.inkSoft, marginTop: space.md },
  gap: { marginTop: space.lg },
  gapSm: { marginTop: space.sm },
  input: { minHeight: TOUCH, paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.line, fontSize: font.label, color: color.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: TOUCH, minWidth: TOUCH + 12, paddingHorizontal: space.lg, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.line },
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipLabel: { fontSize: font.body, fontWeight: '600', color: color.ink },
  onColor: { color: color.onPrimary },
  photoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, minHeight: TOUCH, marginTop: space.sm, paddingLeft: space.lg, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  photoText: { flexShrink: 1, fontSize: font.body, color: color.ink, fontWeight: '600' },
  small: { minHeight: TOUCH, minWidth: 84, paddingHorizontal: space.lg, alignItems: 'center', justifyContent: 'center' },
  smallLabel: { fontSize: font.body, fontWeight: '700', color: color.primary },
  bar: { height: 8, borderRadius: 4, backgroundColor: color.line, overflow: 'hidden', marginTop: space.lg },
  barFill: { height: 8, backgroundColor: color.primary },
});
