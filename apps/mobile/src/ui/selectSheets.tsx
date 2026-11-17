// Sheets of 선택 mode and of the new records: 구간 속성, 다른 층에 복사, 건물 정보, 강의실 자동 연결, 에스컬레이터.
// They only collect answers; SurveyScreen turns the answers into plans.
import { gradeClass, heightFromPressure, type EditBuilding, type EditEdge } from '@campo/core';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { floorLabel, type Scope } from '../model/scope.ts';
import { usePressure } from '../sensors/device.ts';
import { parseLevelRange } from '../survey/buildings.ts';
import type { BeltKind } from '../survey/plans.ts';
import { canBreakline, canFlatExact, type BuildingForm, type EdgeAnswer } from '../survey/selection.ts';
import { BottomSheet } from './BottomSheet.tsx';
import { BigButton, Choice, FieldLabel } from './controls.tsx';
import { STEP_FREE_CHOICES, type StepFree } from './stepFree.ts';
import { TOUCH, color, font, radius, space } from './theme.ts';

const levelChoices = (levels: readonly number[]) => [...levels].sort((a, b) => a - b).map((l) => ({ value: l, label: floorLabel(l) }));

function Floors({ levels, picked, onToggle }: { levels: readonly number[]; picked: readonly number[]; onToggle: (l: number) => void }) {
  return (
    <View style={styles.chips}>
      {levels.map((l) => {
        const on = picked.includes(l);
        return (
          <Pressable key={l} onPress={() => onToggle(l)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={floorLabel(l)} style={[styles.chip, on && styles.chipOn]}>
            <Text style={[styles.chipLabel, on && styles.onColor]}>{floorLabel(l)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---- 구간 속성 ----

/** What the picked edges say now, when they all agree; undefined when they differ. */
function common<T>(edges: readonly EditEdge[], read: (e: EditEdge) => T): T | undefined {
  const values = edges.map(read);
  return values.every((v) => v === values[0]) ? values[0] : undefined;
}

export function EdgePropsSheet({ edges, onSave, onClose }: { edges: readonly EditEdge[]; onSave: (answer: EdgeAnswer) => void; onClose: () => void }) {
  const flat = edges.filter((e) => e.props.highway !== 'steps');
  const stairs = edges.filter((e) => e.props.highway === 'steps' && e.props.conveying === undefined);
  const belts = edges.filter((e) => e.props.conveying !== undefined);
  const [stepFree, setStepFree] = useState<StepFree | undefined>(flat.length > 0 ? common(flat, (e) => e.props.step_free) : undefined);
  const [incline, setIncline] = useState<'up' | 'down' | 'none' | undefined>(stairs.length > 0 ? common(stairs, (e) => e.props.incline ?? 'none') : undefined);
  const [conveying, setConveying] = useState(belts.length > 0 ? common(belts, (e) => e.props.conveying) : undefined);
  const levelable = edges.filter(canFlatExact);
  const breakable = edges.filter(canBreakline);
  const [flatExact, setFlatExact] = useState<boolean | undefined>(levelable.length > 0 ? common(levelable, (e) => e.props.flat_exact === true) : undefined);
  const [isBreakline, setIsBreakline] = useState<boolean | undefined>(breakable.length > 0 ? common(breakable, (e) => e.props.is_breakline === true) : undefined);
  const answer: EdgeAnswer = {
    ...(flat.length > 0 && stepFree !== undefined ? { stepFree } : {}),
    ...(stairs.length > 0 && incline !== undefined ? { incline: incline === 'none' ? null : incline } : {}),
    ...(belts.length > 0 && conveying !== undefined ? { conveying } : {}),
    ...(levelable.length > 0 && flatExact !== undefined ? { flatExact } : {}),
    ...(breakable.length > 0 && isBreakline !== undefined ? { isBreakline } : {}),
  };
  // The two never hold together: picking one on turns the other off (planEdgeEdits does the same on each edge).
  const pickFlat = (v: boolean) => {
    setFlatExact(v);
    if (v && isBreakline) setIsBreakline(false);
  };
  const pickBreak = (v: boolean) => {
    setIsBreakline(v);
    if (v && flatExact) setFlatExact(false);
  };
  return (
    <BottomSheet title={`구간 ${edges.length}개 속성`} onClose={onClose}>
      {flat.length > 0 && (
        <>
          <FieldLabel>문턱이나 계단이 있나요?{flat.length < edges.length ? ` (계단 아닌 구간 ${flat.length}개)` : ''}</FieldLabel>
          <Choice label="턱" value={stepFree} onChange={setStepFree} options={STEP_FREE_CHOICES} />
        </>
      )}
      {stairs.length > 0 && (
        <>
          <FieldLabel>계단 방향 (그린 방향 기준)</FieldLabel>
          <Choice label="계단 방향" value={incline} onChange={setIncline} options={[{ value: 'up', label: '오르막' }, { value: 'down', label: '내리막' }, { value: 'none', label: '모름' }]} />
        </>
      )}
      {belts.length > 0 && (
        <>
          <FieldLabel>에스컬레이터 방향 (아래층 → 위층으로 그린 기준)</FieldLabel>
          <Choice label="에스컬레이터 방향" value={conveying} onChange={setConveying} options={[{ value: 'forward', label: '상행' }, { value: 'backward', label: '하행' }, { value: 'reversible', label: '양방향 전환' }]} />
        </>
      )}
      {(levelable.length > 0 || breakable.length > 0) && <FieldLabel>고도</FieldLabel>}
      {levelable.length > 0 && (
        <ToggleRow
          label="완전 평지"
          hint={`현장에서 평지로 확인했습니다${levelable.length < edges.length ? ` (평지 길·복도 ${levelable.length}개)` : ''}`}
          value={flatExact}
          onChange={pickFlat}
        />
      )}
      {breakable.length > 0 && (
        <ToggleRow
          label="단절선"
          hint={`연석·옹벽처럼 높이가 끊깁니다${breakable.length < edges.length ? ` (길·계단·경사로 ${breakable.length}개)` : ''}`}
          value={isBreakline}
          onChange={pickBreak}
        />
      )}
      <ElevationBadges edges={edges} />
      <BigButton label="저장" disabled={Object.keys(answer).length === 0} onPress={() => onSave(answer)} style={styles.gap} />
    </BottomSheet>
  );
}

/** One on/off fact of the picked edges: a row with the label and a two-state switch (undefined: the edges differ). */
function ToggleRow({ label, hint, value, onChange }: { label: string; hint: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value === undefined ? 'mixed' : value }}
      onPress={() => onChange(value !== true)}
      style={({ pressed }) => [styles.toggle, value === true && styles.toggleOn, pressed && styles.pressed]}
    >
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleHint} numberOfLines={2}>{value === undefined ? '고른 구간마다 다릅니다. 누르면 모두 켭니다.' : hint}</Text>
      </View>
      <View style={[styles.track, value === true && styles.trackOn]}>
        <View style={[styles.knob, value === true && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

const GRADE_TONE = { gentle: color.ok, caution: color.warn, steep: color.danger } as const;
const GRADE_WORD = { gentle: '완만', caution: '주의', steep: '급경사' } as const;

/** What the last recompute wrote on the edge (read only; the editor's [고도 다시 계산] fills it). */
function ElevationBadges({ edges }: { edges: readonly EditEdge[] }) {
  const done = edges.filter((e) => e.props.elev_diff_m !== undefined);
  if (done.length === 0) return null;
  if (edges.length > 1) return <Text style={styles.note}>계산한 고도 값이 있는 구간 {done.length}개 (하나만 고르면 값을 보여 줍니다)</Text>;
  const p = edges[0]!.props;
  const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');
  const cls = p.grade_pct === undefined ? null : gradeClass(p.grade_pct);
  return (
    <View style={styles.badges} accessibilityLabel="계산한 고도 값, 읽기 전용">
      <Text style={styles.badge}><Text style={styles.badgeKey}>높이 차 </Text>{sign(p.elev_diff_m!)}{Math.abs(p.elev_diff_m!).toFixed(2)} m</Text>
      {p.elev_sigma_m !== undefined && <Text style={styles.badge}><Text style={styles.badgeKey}>오차 </Text>±{p.elev_sigma_m.toFixed(2)} m</Text>}
      {p.grade_pct !== undefined && cls && (
        <Text style={[styles.badge, { borderLeftColor: GRADE_TONE[cls], borderLeftWidth: 3 }]}>
          <Text style={styles.badgeKey}>경사 </Text>{sign(p.grade_pct)}{Math.abs(p.grade_pct).toFixed(1)}% <Text style={{ color: GRADE_TONE[cls] }}>{GRADE_WORD[cls]}</Text>
        </Text>
      )}
    </View>
  );
}

// ---- 다른 층에 복사 ----

export function CopySelectionSheet({ title, levels, onCopy, onClose }: { title: string; levels: readonly number[]; onCopy: (levels: number[]) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  return (
    <BottomSheet title={title} onClose={onClose}>
      <Text style={styles.note}>고른 지점과 그 사이의 복도를 다른 층의 같은 자리에 복사하고 서로 연동합니다. 출입구와 층 사이 구간은 복사하지 않습니다.</Text>
      <FieldLabel>어느 층에 복사할까요?</FieldLabel>
      {levels.length === 0 ? <Text style={styles.note}>이 건물에는 다른 층이 없습니다.</Text> : (
        <Floors levels={levels} picked={picked} onToggle={(l) => setPicked((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l]))} />
      )}
      <BigButton label={picked.length === 0 ? '복사할 층을 골라 주세요' : `${picked.length}개 층에 복사`} disabled={picked.length === 0} onPress={() => onCopy(picked)} style={styles.gap} />
    </BottomSheet>
  );
}

// ---- 건물 정보 ----

interface BuildingInfoProps {
  building: EditBuilding;
  onSave: (form: BuildingForm) => void;
  onEnter: (level: number) => void;
  /** 외곽선 수정 of the building outline (the floors without their own follow it). */
  onOutline: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function BuildingInfoSheet({ building, onSave, onEnter, onOutline, onDelete, onClose }: BuildingInfoProps) {
  const p = building.props;
  const [name, setName] = useState(p.name);
  const [code, setCode] = useState(p.code);
  const sorted = [...p.levels].sort((a, b) => a - b);
  const contiguous = sorted.every((l, i) => i === 0 || l === sorted[i - 1]! + 1 || (sorted[i - 1] === -1 && l === 1));
  const [levelsText, setLevelsText] = useState(contiguous && sorted.length > 1 ? `${sorted[0]}~${sorted[sorted.length - 1]}` : sorted.join(','));
  const levels = parseLevelRange(levelsText);
  return (
    <BottomSheet title={`${p.name} 정보`} onClose={onClose}>
      <Text style={styles.note}>{p.source === 'osm' ? 'OpenStreetMap에서 가져온 건물입니다. ' : ''}층을 빼려면 그 층이 비어 있어야 합니다.</Text>
      <FieldLabel>건물 이름</FieldLabel>
      <TextInput value={name} onChangeText={setName} accessibilityLabel="건물 이름" style={styles.input} />
      <FieldLabel>건물 코드 (영문·숫자)</FieldLabel>
      <TextInput value={code} onChangeText={(t) => setCode(t.replace(/[^A-Za-z0-9]/g, ''))} autoCapitalize="characters" autoCorrect={false} accessibilityLabel="건물 코드" style={styles.input} />
      <FieldLabel>층 (지하 1층은 -1)</FieldLabel>
      <TextInput value={levelsText} onChangeText={setLevelsText} autoCorrect={false} accessibilityLabel="층" placeholder="예: -1~4 또는 1,2,3" placeholderTextColor={color.inkSoft} style={styles.input} />
      <Text style={styles.note}>{levels ? `${levels.map(floorLabel).join(', ')} (${levels.length}개 층)` : '층을 숫자로 적어 주세요. 0층은 없습니다.'}</Text>
      <BigButton label="저장" disabled={levels === null || name.trim() === '' || code === ''} onPress={() => levels && onSave({ name, code, levels })} style={styles.gap} />
      <FieldLabel>이 건물 조사하기</FieldLabel>
      <Choice label="들어갈 층" value={undefined} onChange={onEnter} options={levelChoices(p.levels)} />
      <BigButton
        tone="plain"
        label="외곽선 수정"
        hint={Object.keys(p.floor_outlines ?? {}).length > 0
          ? `건물 외곽선을 고칩니다. ${Object.keys(p.floor_outlines ?? {}).map((k) => floorLabel(Number(k))).join(', ')}은(는) 층만의 외곽선이 있습니다`
          : '건물 외곽선을 고칩니다. 한 층만 다르면 그 층에 들어가 메뉴의 [외곽선 수정]을 눌러 주세요'}
        onPress={onOutline}
        style={styles.gap}
      />
      <BigButton tone="danger" label="건물 삭제" onPress={onDelete} style={styles.gapWide} />
    </BottomSheet>
  );
}

// ---- 강의실 자동 연결 ----

export interface StripAnswer {
  count: number;
  startRef: string;
  refStep: 1 | 2;
  doorsPerRoom: 1 | 2;
}

interface StripProps {
  initial: StripAnswer;
  /** Doors the answer would lay, or why it cannot: recomputed as the answer changes. */
  preview: (a: StripAnswer) => { doors: number } | { error: string };
  onPreview: (a: StripAnswer) => void;
  onLay: (a: StripAnswer) => void;
  onClose: () => void;
}

export function StripSheet({ initial, preview, onPreview, onLay, onClose }: StripProps) {
  const [a, setA] = useState(initial);
  const set = (next: Partial<StripAnswer>): void => {
    const merged = { ...a, ...next };
    setA(merged);
    onPreview(merged);
  };
  const pv = preview(a);
  return (
    <BottomSheet title="강의실 자동 연결" onClose={onClose}>
      <Text style={styles.note}>고른 복도를 따라 첫 문과 마지막 문 사이에 강의실 문을 같은 간격으로 놓고 복도에 잇습니다. 지도의 네모가 놓일 자리입니다.</Text>
      <FieldLabel>강의실 수</FieldLabel>
      <View style={styles.stepper}>
        <Pressable onPress={() => set({ count: Math.max(1, a.count - 1) })} accessibilityRole="button" accessibilityLabel="한 개 줄이기" style={styles.stepBtn}><Text style={styles.stepLabel}>−</Text></Pressable>
        <Text style={styles.count}>{a.count}개</Text>
        <Pressable onPress={() => set({ count: Math.min(60, a.count + 1) })} accessibilityRole="button" accessibilityLabel="한 개 늘리기" style={styles.stepBtn}><Text style={styles.stepLabel}>+</Text></Pressable>
      </View>
      <FieldLabel>첫 강의실 번호</FieldLabel>
      <TextInput value={a.startRef} onChangeText={(t) => set({ startRef: t.replace(/[^A-Za-z0-9-]/g, '').slice(0, 8) })} placeholder="301" placeholderTextColor={color.inkSoft} autoCapitalize="characters" autoCorrect={false} accessibilityLabel="첫 강의실 번호" style={styles.input} />
      <FieldLabel>번호 간격</FieldLabel>
      <Choice label="번호 간격" value={a.refStep} onChange={(refStep) => set({ refStep })} options={[{ value: 1, label: '1씩 (301, 302…)' }, { value: 2, label: '2씩 (301, 303…)' }]} />
      <FieldLabel>강의실마다 문</FieldLabel>
      <Choice label="강의실마다 문" value={a.doorsPerRoom} onChange={(doorsPerRoom) => set({ doorsPerRoom })} options={[{ value: 1, label: '1개' }, { value: 2, label: '앞문·뒷문 2개' }]} />
      <Text style={[styles.note, 'error' in pv && { color: color.danger }]}>{'error' in pv ? pv.error : `문 ${pv.doors}개를 놓습니다.`}</Text>
      <BigButton label="문 놓고 복도에 잇기" disabled={'error' in pv} onPress={() => onLay(a)} style={styles.gap} />
    </BottomSheet>
  );
}

// ---- 에스컬레이터 ----

/** A ride that has started: where it began is kept by the screen. */
export interface EscalatorTrip {
  rodeUp: boolean;
  belt: BeltKind;
  /** Indoors: the floor ridden to. */
  toLevel: number | null;
  startHpa: number | null;
}

interface EscalatorSheetProps {
  scope: Scope;
  /** The building's floors (indoors). */
  levels: readonly number[];
  trip: EscalatorTrip | null;
  onDepart: (trip: EscalatorTrip) => void;
  onArrive: (answer: { endHpa: number | null }) => void;
  onCancelTrip: () => void;
  onClose: () => void;
}

export function EscalatorSheet({ scope, levels, trip, onDepart, onArrive, onCancelTrip, onClose }: EscalatorSheetProps) {
  const { value: pressure, available: barometer } = usePressure();
  const indoor = scope.kind === 'building';
  const [rodeUp, setRodeUp] = useState(true);
  const [belt, setBelt] = useState<BeltKind>('one');
  const others = indoor ? levels.filter((l) => l !== scope.level) : [];
  // The floor next to this one in the direction ridden, as a first guess (the surveyor can pick another).
  const sorted = [...levels].sort((a, b) => a - b);
  const at = indoor ? sorted.indexOf(scope.level) : -1;
  const guess = indoor ? sorted[at + (rodeUp ? 1 : -1)] : undefined;
  const [picked, setPicked] = useState<number | undefined>(undefined);
  const toLevel = picked !== undefined && others.includes(picked) ? picked : guess;

  if (!trip) {
    return (
      <BottomSheet title="에스컬레이터 · 다른 층과 연결" onClose={onClose}>
        <Text style={styles.lead}>이 지점에서 타고 [여기서 출발]을 누른 뒤, 내린 곳에 십자선을 맞추고 메뉴의 [에스컬 도착]을 눌러 주세요.</Text>
        <FieldLabel>어느 쪽으로 타나요?</FieldLabel>
        <Choice label="탄 방향" value={rodeUp} onChange={setRodeUp} options={[{ value: true, label: '올라감' }, { value: false, label: '내려감' }]} />
        {indoor && (
          <>
            <FieldLabel>도착 층</FieldLabel>
            <Choice label="도착 층" value={toLevel} onChange={setPicked} options={levelChoices(others)} />
          </>
        )}
        <FieldLabel>이 자리의 에스컬레이터</FieldLabel>
        <Choice label="에스컬레이터 종류" value={belt} onChange={setBelt} options={[{ value: 'one', label: '이 방향만' }, { value: 'pair', label: '상행+하행 한 쌍' }, { value: 'reversible', label: '시간대별 방향 전환' }]} />
        <Text style={styles.note}>{barometer === false ? '기압계가 없어 높이는 기록하지 않습니다.' : '출발과 도착의 기압 차이로 높이를 잽니다. 시간은 이 지점을 다시 눌러 [시간 재기]로 잴 수 있습니다.'}</Text>
        <BigButton label="여기서 출발" disabled={indoor && toLevel === undefined} onPress={() => onDepart({ rodeUp, belt, toLevel: toLevel ?? null, startHpa: pressure ?? null })} style={styles.gap} />
      </BottomSheet>
    );
  }
  const height = trip.startHpa !== null && pressure !== undefined ? heightFromPressure(trip.startHpa, pressure) : undefined;
  return (
    <BottomSheet title={trip.toLevel !== null ? `${floorLabel(trip.toLevel)}으로 이동 중` : '에스컬레이터 이동 중'} onClose={onClose}>
      <Text style={styles.lead}>내린 자리에 십자선을 맞춘 뒤 도착을 눌러 주세요.</Text>
      <Text style={styles.note}>{height === undefined ? '높이 측정 없음' : `높이 ${height >= 0 ? '+' : '−'}${Math.abs(height).toFixed(1)} m`}</Text>
      <BigButton label="여기서 도착 기록" onPress={() => onArrive({ endHpa: trip.startHpa !== null && pressure !== undefined ? pressure : null })} style={styles.gap} />
      <BigButton tone="plain" label="이동 취소" onPress={onCancelTrip} style={styles.gapSm} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: font.body, lineHeight: 21, color: color.ink, marginTop: space.sm },
  note: { fontSize: font.small, lineHeight: 18, color: color.inkSoft, marginTop: space.md },
  gap: { marginTop: space.lg },
  gapSm: { marginTop: space.sm },
  gapWide: { marginTop: space.xl * 1.5 },
  input: { minHeight: TOUCH, paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.line, fontSize: font.label, color: color.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: TOUCH, minWidth: TOUCH + 12, paddingHorizontal: space.lg, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.line },
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipLabel: { fontSize: font.body, fontWeight: '600', color: color.ink },
  onColor: { color: color.onPrimary },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  stepBtn: { width: TOUCH + 6, height: TOUCH + 6, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.line, alignItems: 'center', justifyContent: 'center' },
  stepLabel: { fontSize: font.title, fontWeight: '800', color: color.ink },
  pressed: { opacity: 0.7 },
  toggle: {
    minHeight: TOUCH + 8, flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm, paddingHorizontal: space.lg,
    paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.line,
  },
  toggleOn: { borderColor: color.ink },
  toggleText: { flex: 1 },
  toggleLabel: { fontSize: font.label, fontWeight: '700', color: color.ink },
  toggleHint: { fontSize: font.small, color: color.inkSoft, marginTop: 1 },
  track: { width: 40, height: 24, borderRadius: 12, padding: 3, backgroundColor: color.line },
  trackOn: { backgroundColor: color.ink },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: color.surface },
  knobOn: { transform: [{ translateX: 16 }] },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  badge: {
    paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.sm, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line,
    fontSize: font.body, fontWeight: '700', color: color.ink, fontVariant: ['tabular-nums'],
  },
  badgeKey: { fontSize: font.small, fontWeight: '500', color: color.inkSoft },
  count: { minWidth: 60, textAlign: 'center', fontSize: font.title, fontWeight: '800', color: color.ink, fontVariant: ['tabular-nums'] },
});
