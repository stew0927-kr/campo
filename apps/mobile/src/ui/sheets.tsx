// The bottom sheets of the record buttons. They only collect answers; SurveyScreen turns the answers into plans.
import { heightFromPressure, type DoorRole, type EditBuilding } from '@campo/core';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { defaultLevel, floorLabel, type Scope } from '../model/scope.ts';
import { usePressure } from '../sensors/device.ts';
import type { VerticalKind } from '../survey/plans.ts';
import { BottomSheet } from './BottomSheet.tsx';
import { BigButton, Choice, FieldLabel } from './controls.tsx';
import { STEP_FREE_CHOICES, type StepFree } from './stepFree.ts';
import { TOUCH_LARGE, color, font, radius, space } from './theme.ts';

// ---- shared ----

function PhotoRow({ count, onPhoto }: { count: number; onPhoto: () => void }) {
  return <BigButton tone="plain" label="사진 촬영" hint={count > 0 ? `${count}장 찍었습니다` : '기록과 함께 저장됩니다'} onPress={onPhoto} style={styles.gapTop} />;
}

const levelOptions = (levels: readonly number[]) => [...levels].sort((a, b) => a - b).map((l) => ({ value: l, label: floorLabel(l) }));

// ---- 문/강의실 번호 ----

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'B', '0', '-'] as const;

/** A number pad for room numbers: larger than the system keyboard's keys, and it does not cover the sheet. */
function RoomPad({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <View>
      <View style={styles.readout} accessibilityLabel={value === '' ? '호실 번호 없음' : `호실 번호 ${value}`}>
        <Text style={[styles.readoutText, value === '' && styles.readoutEmpty]}>{value === '' ? '번호 없는 문' : `${value}호`}</Text>
        <Pressable onPress={() => onChange(value.slice(0, -1))} accessibilityRole="button" accessibilityLabel="한 글자 지우기" style={styles.erase}>
          <Text style={styles.eraseLabel}>지우기</Text>
        </Pressable>
      </View>
      <View style={styles.pad}>
        {KEYS.map((k) => (
          <Pressable
            key={k}
            onPress={() => onChange(value.length < 8 ? value + k : value)}
            accessibilityRole="button"
            accessibilityLabel={k}
            style={({ pressed }) => [styles.key, pressed && { backgroundColor: color.line }]}
          >
            <Text style={styles.keyLabel}>{k}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

interface DoorSheetProps {
  /** The next room number after the last one recorded, or empty. */
  suggestion: string;
  photos: number;
  onPhoto: () => void;
  onRecord: (answer: { roomRef: string; doorRole: DoorRole }) => void;
  onClose: () => void;
}

export function DoorSheet({ suggestion, photos, onPhoto, onRecord, onClose }: DoorSheetProps) {
  const [roomRef, setRoomRef] = useState(suggestion);
  const [doorRole, setDoorRole] = useState<DoorRole>('front');
  return (
    <BottomSheet title="문/강의실 번호" onClose={onClose}>
      <RoomPad value={roomRef} onChange={setRoomRef} />
      <FieldLabel>어느 문인가요?</FieldLabel>
      <Choice label="문 종류" value={doorRole} onChange={setDoorRole} options={[{ value: 'front', label: '앞문' }, { value: 'back', label: '뒷문' }, { value: 'other', label: '그 밖' }]} />
      <PhotoRow count={photos} onPhoto={onPhoto} />
      <BigButton label="십자선 자리에 문 기록" onPress={() => onRecord({ roomRef, doorRole })} style={styles.gapTop} />
    </BottomSheet>
  );
}

// ---- 계단/EV 층 변경 ----

/** A floor change that has started: the surveyor is on the stairs or in the elevator. */
export interface FloorTrip {
  kind: VerticalKind;
  toLevel: number;
  /** Pressure when leaving, when the phone has a barometer. */
  startHpa: number | null;
}

interface FloorSheetProps {
  scope: Extract<Scope, { kind: 'building' }>;
  building: EditBuilding;
  trip: FloorTrip | null;
  photos: number;
  onPhoto: () => void;
  onDepart: (trip: FloorTrip) => void;
  onArrive: (answer: { incline: 'up' | 'down' | undefined; endHpa: number | null }) => void;
  onCancelTrip: () => void;
  onClose: () => void;
}

/** Below this the barometer cannot tell up from down reliably, so the surveyor says which. */
const MIN_CLEAR_HEIGHT_M = 1;

export function FloorSheet({ scope, building, trip, photos, onPhoto, onDepart, onArrive, onCancelTrip, onClose }: FloorSheetProps) {
  // Live pressure while the sheet is open (the reading is shared with the rest of the screen).
  const { value: pressure, available: barometer } = usePressure();
  const others = building.props.levels.filter((l) => l !== scope.level);
  const [kind, setKind] = useState<VerticalKind>('stairs');
  const [toLevel, setToLevel] = useState<number | undefined>(others.length === 1 ? others[0] : undefined);
  const [said, setSaid] = useState<'up' | 'down' | undefined>(undefined);

  if (!trip) {
    return (
      <BottomSheet title="계단/EV 층 변경" onClose={onClose}>
        <Text style={styles.lead}>지금 {floorLabel(scope.level)}입니다. 계단참이나 엘리베이터 앞에 십자선을 맞추고 출발을 눌러 주세요.</Text>
        <FieldLabel>무엇으로 이동하나요?</FieldLabel>
        <Choice label="이동 수단" value={kind} onChange={setKind} options={[{ value: 'stairs', label: '계단' }, { value: 'elevator', label: '엘리베이터' }]} />
        <FieldLabel>어느 층으로 가나요?</FieldLabel>
        <Choice label="도착 층" value={toLevel} onChange={setToLevel} options={levelOptions(others)} />
        <Text style={styles.note}>
          {barometer === false ? '이 기기에는 기압계가 없어 높이는 기록하지 않습니다.'
            : pressure === undefined ? '기압계를 읽는 중입니다.'
            : `지금 기압 ${pressure.toFixed(1)} hPa. 출발과 도착의 차이로 높이를 잽니다.`}
        </Text>
        <BigButton label="여기서 출발" disabled={toLevel === undefined} onPress={() => onDepart({ kind, toLevel: toLevel!, startHpa: pressure ?? null })} style={styles.gapTop} />
      </BottomSheet>
    );
  }

  const height = trip.startHpa !== null && pressure !== undefined ? heightFromPressure(trip.startHpa, pressure) : undefined;
  const measured = height !== undefined && Math.abs(height) >= MIN_CLEAR_HEIGHT_M ? (height > 0 ? 'up' : 'down') : undefined;
  return (
    <BottomSheet title={`${floorLabel(trip.toLevel)}으로 이동 중`} onClose={onClose}>
      <Text style={styles.lead}>{trip.kind === 'stairs' ? '계단을 다 올라가거나 내려간 뒤' : '엘리베이터에서 내린 뒤'} 도착을 눌러 주세요.</Text>
      <View style={styles.readout}>
        <Text style={styles.readoutText}>{height === undefined ? '높이 측정 없음' : `${height >= 0 ? '+' : '−'}${Math.abs(height).toFixed(1)} m`}</Text>
      </View>
      {trip.kind === 'stairs' && measured === undefined && (
        <>
          <FieldLabel>올라갔나요, 내려갔나요?</FieldLabel>
          <Choice label="방향" value={said} onChange={setSaid} options={[{ value: 'up', label: '올라감' }, { value: 'down', label: '내려감' }]} />
        </>
      )}
      <PhotoRow count={photos} onPhoto={onPhoto} />
      <BigButton
        label={`${floorLabel(trip.toLevel)} 도착 기록`}
        onPress={() => onArrive({ incline: trip.kind === 'stairs' ? measured ?? said : undefined, endHpa: trip.startHpa !== null && pressure !== undefined ? pressure : null })}
        style={styles.gapTop}
      />
      <BigButton tone="plain" label="이동 취소" onPress={onCancelTrip} style={styles.gapTop} />
    </BottomSheet>
  );
}

// ---- 포탈 ----

interface PortalSheetProps {
  scope: Scope;
  /** Buildings, nearest to the crosshair first. */
  buildings: readonly EditBuilding[];
  stepFree: StepFree;
  photos: number;
  onPhoto: () => void;
  onRecord: (answer: { buildingId: string; level: number; stepFree: StepFree }) => void;
  onClose: () => void;
}

export function PortalSheet({ scope, buildings, stepFree, photos, onPhoto, onRecord, onClose }: PortalSheetProps) {
  const goingOut = scope.kind === 'building';
  const [buildingId, setBuildingId] = useState<string | undefined>(buildings[0]?.id);
  const building = buildings.find((b) => b.id === buildingId);
  const [level, setLevel] = useState<number | undefined>(building ? defaultLevel(building) : undefined);
  const [sill, setSill] = useState<StepFree>(stepFree);
  const ready = goingOut || (building !== undefined && level !== undefined);

  return (
    <BottomSheet title={goingOut ? '포탈: 밖으로 나가기' : '포탈: 건물로 들어가기'} onClose={onClose}>
      <Text style={styles.lead}>
        {goingOut ? '출입문에 십자선을 맞춰 주세요. 이 층의 출입구로 기록하고 바깥 길에 잇습니다.' : '출입문에 십자선을 맞추고, 문 안쪽이 어느 건물 몇 층인지 골라 주세요.'}
      </Text>
      {!goingOut && (
        <>
          <FieldLabel>어느 건물인가요?</FieldLabel>
          <Choice
            label="건물"
            value={buildingId}
            onChange={(id) => {
              setBuildingId(id);
              const b = buildings.find((x) => x.id === id);
              setLevel(b ? defaultLevel(b) : undefined);
            }}
            options={buildings.slice(0, 6).map((b) => ({ value: b.id, label: b.props.name }))}
          />
          {building && (
            <>
              <FieldLabel>문 안쪽은 몇 층인가요?</FieldLabel>
              <Choice label="층" value={level} onChange={setLevel} options={levelOptions(building.props.levels)} />
            </>
          )}
        </>
      )}
      <FieldLabel>문턱이나 계단이 있나요?</FieldLabel>
      <Choice label="문턱" value={sill} onChange={setSill} options={STEP_FREE_CHOICES} />
      <PhotoRow count={photos} onPhoto={onPhoto} />
      <BigButton
        label="출입구 기록"
        disabled={!ready}
        onPress={() => onRecord({ buildingId: building?.id ?? '', level: level ?? 0, stepFree: sill })}
        style={styles.gapTop}
      />
    </BottomSheet>
  );
}

// ---- 건물·층 고르기 ----

interface ScopeSheetProps {
  scope: Scope;
  buildings: readonly EditBuilding[];
  onPick: (scope: Scope) => void;
  onClose: () => void;
}

export function ScopeSheet({ scope, buildings, onPick, onClose }: ScopeSheetProps) {
  return (
    <BottomSheet title="어디를 조사하나요?" onClose={onClose}>
      <BigButton tone={scope.kind === 'outdoor' ? 'primary' : 'plain'} label="바깥" onPress={() => onPick({ kind: 'outdoor' })} />
      {buildings.length === 0 && <Text style={styles.note}>등록된 건물이 없습니다. 건물 외곽선은 PC 편집기에서 먼저 그려 주세요.</Text>}
      {buildings.map((b) => (
        <View key={b.id}>
          <FieldLabel>{b.props.name}</FieldLabel>
          <Choice
            label={`${b.props.name} 층`}
            value={scope.kind === 'building' && scope.buildingId === b.id ? scope.level : undefined}
            onChange={(level) => onPick({ kind: 'building', buildingId: b.id, level })}
            options={levelOptions(b.props.levels)}
          />
        </View>
      ))}
    </BottomSheet>
  );
}

// ---- 데이터 내보내기 ----

interface ExportSheetProps {
  counts: { nodes: number; edges: number; photos: number; measurements: number };
  busy: boolean;
  onExport: () => void;
  onReset: () => void;
  onClose: () => void;
}

export function ExportSheet({ counts, busy, onExport, onReset, onClose }: ExportSheetProps) {
  const empty = counts.nodes + counts.edges + counts.photos + counts.measurements === 0;
  return (
    <BottomSheet title="데이터 내보내기" onClose={onClose}>
      <Text style={styles.lead}>
        지점 {counts.nodes}개, 구간 {counts.edges}개, 사진 {counts.photos}장, 높이 측정 {counts.measurements}건을 기록했습니다.
      </Text>
      <Text style={styles.note}>
        기록은 이 기기에 저장되어 있습니다. 내보낸 zip 파일을 PC로 옮긴 뒤 편집기의 “현장 기록 불러오기”에서 열어 주세요. 사진에 사람 얼굴이 찍혔는지 확인해 주세요.
      </Text>
      <BigButton label={busy ? '묶는 중입니다' : '데이터 내보내기'} disabled={busy || empty} onPress={onExport} style={styles.gapTop} />
      <BigButton tone="danger" label="기록 지우고 새 조사 시작" disabled={busy} onPress={onReset} style={styles.gapTopWide} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: font.body, lineHeight: 24, color: color.ink, marginTop: space.sm },
  note: { fontSize: font.small, lineHeight: 21, color: color.inkSoft, marginTop: space.md },
  gapTop: { marginTop: space.lg },
  gapTopWide: { marginTop: space.xl * 1.5 },
  readout: {
    minHeight: TOUCH_LARGE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.md,
    paddingLeft: space.lg, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.line,
  },
  readoutText: { fontSize: font.display, fontWeight: '800', color: color.ink, fontVariant: ['tabular-nums'] },
  readoutEmpty: { fontSize: font.label, fontWeight: '600', color: color.inkSoft },
  erase: { minHeight: TOUCH_LARGE, minWidth: TOUCH_LARGE + space.xl, alignItems: 'center', justifyContent: 'center' },
  eraseLabel: { fontSize: font.body, fontWeight: '700', color: color.inkSoft },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  key: {
    flexBasis: '30%', flexGrow: 1, minHeight: TOUCH_LARGE, borderRadius: radius.sm, backgroundColor: color.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: color.line,
  },
  keyLabel: { fontSize: font.title, fontWeight: '700', color: color.ink },
});
