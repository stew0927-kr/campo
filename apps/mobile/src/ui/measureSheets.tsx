// 기압 측정 on the survey screen (docs/ELEVATION_INTEGRATION.md 12장): the round FAB just above the menu button (one
// thumb), the card that walks through 준비 → 안정화 → 10초 측정 → 결과 at the bottom edge, and the 측정된 기압 sheet that
// lists the pressures still held in memory (and how long until each is forgotten). The card only reads the state of
// useMeasureFlow (core measureMachine) and calls its actions; nothing here saves anything.
import type { MeasureState, PressureAnchorObservation } from '@campo/core/elevation';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import type { DhRow } from '../survey/dhRows.ts';
import { pinText, type PressurePin } from '../survey/pressurePins.ts';
import { BottomSheet } from './BottomSheet.tsx';
import { BigButton, FieldLabel } from './controls.tsx';
import { TOUCH, TOUCH_LARGE, color, font, radius, space } from './theme.ts';

/** Same size as the menu button under it. */
const FAB = 54;
const RING = 64;
const RING_STROKE = 5;

/** Δh: two levels and the arrow between them. */
function HeightGlyph({ tint }: { tint: string }) {
  return (
    <Svg width={26} height={26} viewBox="0 0 26 26">
      <Line x1={3} y1={22} x2={11} y2={22} stroke={tint} strokeWidth={2.4} strokeLinecap="round" />
      <Line x1={15} y1={5} x2={23} y2={5} stroke={tint} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M13 20 L13 8 M9.5 11 L13 7.5 L16.5 11" stroke={tint} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** The measure button: above the menu button (`above` px from the bottom edge, the dock's own height). */
export function MeasureFab({ above, active, onPress }: { above: number; active: boolean; onPress: () => void }) {
  return (
    <View pointerEvents="box-none" style={[styles.fabWrap, { bottom: above }]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="기압으로 높이 재기"
        accessibilityHint="십자선 자리에서 10초 동안 기압을 잽니다"
        accessibilityState={{ selected: active }}
        style={({ pressed }) => [styles.fab, active && styles.fabActive, pressed && styles.pressed]}
      >
        <HeightGlyph tint={active ? color.onPrimary : color.ink} />
      </Pressable>
    </View>
  );
}

/** A progress ring with something in the middle. `progress` 0…1. */
function Ring({ progress, tint, children }: { progress: number; tint: string; children: ReactNode }) {
  const r = (RING - RING_STROKE) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, progress));
  return (
    <View style={styles.ring} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(p * 100) }}>
      <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
        <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={color.line} strokeWidth={RING_STROKE} fill="none" />
        <Circle
          cx={RING / 2} cy={RING / 2} r={r} stroke={tint} strokeWidth={RING_STROKE} fill="none" strokeLinecap="round"
          strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - p)} transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

const INTERRUPT_TEXT: Record<string, string> = {
  app_background: '앱이 화면에서 벗어나 측정이 멈췄습니다.',
  device_moved: '휴대폰이 움직여 측정을 멈췄습니다.',
  sensor_error: '기압 센서 값을 받지 못했습니다.',
  user_left_screen: '측정 화면을 벗어났습니다.',
};
const ERROR_TEXT: Record<string, string> = {
  barometer_unavailable: '이 휴대폰에는 기압 센서가 없어 높이를 잴 수 없습니다.',
  permission_denied: '동작 및 피트니스 권한이 없어 기압을 읽을 수 없습니다. 설정에서 권한을 허용해 주세요.',
  sensor_error: '기압 센서를 켜지 못했습니다.',
  commit_failed: '측정을 기기에 저장하지 못했습니다.',
};
const WARNING_TEXT: Record<string, string> = {
  LOW_SAMPLE_COUNT: '측정값이 적습니다',
  UNSTABLE_PRESSURE: '기압이 흔들렸습니다(바람·문)',
  PRESSURE_TREND: '재는 동안 기압이 계속 바뀌었습니다',
  DEVICE_MOVED: '휴대폰이 움직였습니다',
  NO_ACCELEROMETER: '흔들림을 확인할 수 없습니다',
};

export interface MeasureCardProps {
  state: MeasureState;
  /** Where the target is, in words ("바깥 · 새 지점", "공학관 3층"). */
  where: string;
  settleMs: number;
  durationMs: number;
  /** Bottom inset of the dock (the card sits above it). */
  bottom: number;
  onStart: () => void;
  onSave: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}

/** The card for every state after the crosshair was confirmed; null for the states the dock handles (idle, targeting). */
export function MeasureCard(p: MeasureCardProps) {
  const { state: s } = p;
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (s.tag !== 'settling') return undefined;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [s.tag]);

  let ring: ReactNode = null;
  let title = '';
  let body = '';
  let actions: { label: string; onPress: () => void; tone?: 'primary' | 'plain' | 'danger'; disabled?: boolean }[] = [];

  switch (s.tag) {
    case 'confirming':
      title = '이 자리에서 10초 동안 잽니다';
      body = '휴대폰을 가슴 높이에 가만히 들거나 평평한 곳에 내려 두세요. 문 옆과 바람 부는 곳은 피해 주세요.';
      ring = <Ring progress={0} tint={color.primary}><Text style={styles.ringNum}>10</Text></Ring>;
      actions = [{ label: '측정 시작', onPress: p.onStart }, { label: '취소', onPress: p.onCancel, tone: 'plain' }];
      break;
    case 'preparing':
      title = '센서를 켜는 중입니다';
      body = '권한을 묻는 창이 뜨면 허용해 주세요.';
      ring = <Ring progress={0} tint={color.primary}><Text style={styles.ringSmall}>준비</Text></Ring>;
      actions = [{ label: '취소', onPress: p.onCancel, tone: 'plain' }];
      break;
    case 'settling': {
      const left = Math.max(0, s.untilMs - now);
      title = '흔들림이 가라앉기를 기다립니다';
      body = '움직이지 말고 그대로 들고 있어 주세요.';
      ring = <Ring progress={1 - left / p.settleMs} tint={color.warn}><Text style={styles.ringSmall}>안정화</Text></Ring>;
      actions = [{ label: '취소', onPress: p.onCancel, tone: 'plain' }];
      break;
    }
    case 'sampling': {
      const remaining = s.live?.remainingMs ?? p.durationMs;
      const moving = s.live?.stationaryNow === false;
      title = moving ? '휴대폰이 움직이고 있습니다' : '기압을 재는 중입니다';
      body = s.live?.windWarning ? '기압이 흔들립니다. 바람을 피해 주세요.' : `측정값 ${s.live?.sampleCount ?? 0}개`;
      ring = (
        <Ring progress={1 - remaining / p.durationMs} tint={moving ? color.danger : color.primary}>
          <Text style={styles.ringNum} accessibilityLiveRegion="polite">{Math.ceil(remaining / 1000)}</Text>
        </Ring>
      );
      actions = [{ label: '취소', onPress: p.onCancel, tone: 'plain' }];
      break;
    }
    case 'reviewing': {
      const ok = s.grade !== 'retry';
      title = s.grade === 'good' ? '잘 쟀습니다' : s.grade === 'usable' ? '쓸 수 있지만 조금 흔들렸습니다' : '다시 재 주세요';
      body = s.result.warnings.length > 0 ? s.result.warnings.map((w) => WARNING_TEXT[w] ?? w).join(', ') : '흔들림 없이 쟀습니다.';
      ring = <Ring progress={1} tint={s.grade === 'good' ? color.ok : s.grade === 'usable' ? color.warn : color.danger}><Text style={styles.ringSmall}>{s.grade === 'good' ? '좋음' : s.grade === 'usable' ? '보통' : '다시'}</Text></Ring>;
      actions = ok
        ? [{ label: '저장', onPress: p.onSave }, { label: '다시 재기', onPress: p.onRetry, tone: 'plain' }, { label: '취소', onPress: p.onCancel, tone: 'plain' }]
        : [{ label: '다시 재기', onPress: p.onRetry }, { label: '취소', onPress: p.onCancel, tone: 'plain' }];
      break;
    }
    case 'committing':
      title = '저장하는 중입니다';
      ring = <Ring progress={1} tint={color.ok}><Text style={styles.ringSmall}>저장</Text></Ring>;
      break;
    case 'done':
      title = s.edgesCreated > 0 ? `높이 차 ${s.edgesCreated}개를 만들었습니다` : '첫 지점을 기억했습니다';
      body = s.edgesCreated > 0
        ? '기압 값은 저장하지 않고 두 지점 사이의 높이 차만 저장했습니다.'
        : '30분 안에 다음 지점을 재면 두 지점의 높이 차가 생깁니다.';
      ring = <Ring progress={1} tint={color.ok}><Text style={[styles.ringSmall, { color: color.ok }]}>완료</Text></Ring>;
      actions = [{ label: '확인', onPress: p.onDismiss }];
      break;
    case 'interrupted':
      title = '측정이 멈췄습니다';
      body = INTERRUPT_TEXT[s.reason] ?? s.reason;
      ring = <Ring progress={0} tint={color.danger}><Text style={styles.ringSmall}>멈춤</Text></Ring>;
      actions = [{ label: '다시 재기', onPress: p.onRetry }, { label: '취소', onPress: p.onCancel, tone: 'plain' }];
      break;
    case 'error':
      title = '잴 수 없습니다';
      body = ERROR_TEXT[s.reason] ?? s.message ?? s.reason;
      actions = [{ label: '닫기', onPress: p.onDismiss, tone: 'plain' }];
      break;
    default:
      return null;
  }

  return (
    <View pointerEvents="box-none" style={[styles.cardWrap, { bottom: p.bottom + space.sm, paddingBottom: insets.bottom > 0 ? 0 : space.xs }]}>
      <View style={styles.card} accessibilityViewIsModal accessibilityLabel="기압 측정">
        <View style={styles.cardHead}>
          {ring}
          <View style={styles.cardText}>
            <Text style={styles.where} numberOfLines={1}>{p.where}</Text>
            <Text style={styles.title} accessibilityRole="header">{title}</Text>
            {body !== '' && <Text style={styles.body}>{body}</Text>}
          </View>
        </View>
        {actions.length > 0 && (
          <View style={styles.actions}>
            {actions.map((a) => (
              <BigButton key={a.label} label={a.label} tone={a.tone ?? 'primary'} onPress={a.onPress} {...(a.disabled ? { disabled: true } : {})} style={styles.action} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

// ---- 측정된 기압 ----

export interface PressureRow {
  observation: PressureAnchorObservation;
  /** "바깥 지점 2", "공학관 3층". */
  label: string;
}

interface PressureSheetProps {
  rows: readonly PressureRow[];
  ttlMin: number;
  /** Δh edges kept on the phone (not superseded), newest first, and measured heights waiting for the editor's recompute. */
  dh: readonly DhRow[];
  pending: number;
  onDeleteDh: (row: DhRow) => void;
  onClear: () => void;
  onClose: () => void;
}

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

/** The pressures in memory (newest first), each with how long it is kept. Nothing on this sheet is saved. */
export function PressureSheet({ rows, ttlMin, dh, pending, onDeleteDh, onClear, onClose }: PressureSheetProps) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const live = rows.filter((r) => r.observation.expiresAt > now).sort((a, b) => b.observation.window.timestamp - a.observation.window.timestamp);
  return (
    <BottomSheet title="측정된 기압" onClose={onClose}>
      <Text style={styles.lead}>
        기압은 이 휴대폰의 메모리에만 {ttlMin}분 동안 두었다가 지웁니다. 저장하고 내보내는 것은 두 지점 사이의 높이 차뿐입니다.
      </Text>
      <View style={styles.summary}>
        <View style={styles.summaryCell}><Text style={styles.summaryNum}>{dh.length}</Text><Text style={styles.summaryKey}>저장된 높이 차</Text></View>
        <View style={styles.summaryCell}><Text style={styles.summaryNum}>{pending}</Text><Text style={styles.summaryKey}>다시 계산 대기</Text></View>
      </View>
      <FieldLabel>메모리에 있는 기압 {live.length}개</FieldLabel>
      {live.length === 0 ? (
        <Text style={styles.note}>지금 기억하고 있는 기압이 없습니다. 지도의 높이 재기 버튼으로 첫 지점을 재 주세요.</Text>
      ) : live.map(({ observation: o, label }) => {
        const leftMin = Math.max(0, Math.ceil((o.expiresAt - now) / 60_000));
        return (
          <View key={o.windowId} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
              <Text style={styles.rowSub}>{clock(o.window.timestamp)} 측정</Text>
            </View>
            <View style={styles.rowEnd}>
              <Text style={styles.rowValue}>{o.window.meanPressureHpa.toFixed(2)} hPa</Text>
              <Text style={[styles.rowSub, leftMin <= 5 && { color: color.warn }]}>{leftMin}분 뒤 지움</Text>
            </View>
          </View>
        );
      })}
      <BigButton tone="plain" label="기압 기록 지우기" disabled={live.length === 0} hint="저장된 높이 차는 그대로 둡니다" onPress={onClear} style={styles.gap} />

      <FieldLabel>저장된 높이 차 {dh.length}개</FieldLabel>
      <Text style={styles.note}>지우면 이 휴대폰에 저장된 것만 사라집니다. 이미 내보낸 압축 파일과 편집기로 넘어간 사본은 그대로입니다.</Text>
      {dh.length === 0 ? (
        <Text style={styles.note}>저장된 높이 차가 없습니다.</Text>
      ) : dh.map((r) => (
        <View key={r.edgeId} style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={styles.rowLabel} numberOfLines={1}>{r.from} → {r.to}</Text>
            <Text style={styles.rowSub}>{r.at} 측정</Text>
          </View>
          <Text style={styles.rowValue}>{r.dh}</Text>
          <Pressable
            onPress={() => onDeleteDh(r)}
            accessibilityRole="button"
            accessibilityLabel={`${r.from}에서 ${r.to}까지 높이 차 ${r.dh} 삭제`}
            accessibilityHint="확인을 한 번 받고 이 휴대폰에서 지웁니다"
            style={({ pressed }) => [styles.delete, pressed && styles.pressed]}
          >
            <Text style={styles.deleteLabel}>삭제</Text>
          </Pressable>
        </View>
      ))}
    </BottomSheet>
  );
}

// ---- 측정된 기압 → 지도에서 누른 지점 ----

interface PressurePointSheetProps {
  pin: PressurePin;
  /** Whether this phone can measure now (a barometer, the measure mode on). */
  canMeasure: boolean;
  onRemeasure: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/** One measured spot tapped on the map: how much of it is still in memory, and 다시 재기 or 삭제. */
export function PressurePointSheet({ pin, canMeasure, onRemeasure, onDelete, onClose }: PressurePointSheetProps) {
  const live = pin.leftMs !== null;
  return (
    <BottomSheet title={pin.label} onClose={onClose}>
      <View style={[styles.state, live ? styles.stateLive : styles.stateSaved]}>
        <Text style={[styles.stateTitle, { color: live ? color.primary : color.ok }]}>
          {live ? `기압이 메모리에 ${pinText({ ...pin, short: '' })} 더 남아 있습니다` : '기압은 지웠고 높이 차만 남아 있습니다'}
        </Text>
        <Text style={styles.stateBody}>
          {live ? '이 시간 안에 다른 지점을 재면 두 지점 사이의 높이 차가 생깁니다.' : '30분이 지나 기압 값은 휴대폰 메모리에서 지웠습니다.'} 저장된 높이 차는 {pin.edges}개입니다.
        </Text>
      </View>
      <BigButton
        label="이 지점 다시 재기"
        hint={canMeasure ? '이 자리에 서서 누르면 10초 동안 잽니다' : '기압계가 없거나 설정에서 측정을 껐습니다'}
        disabled={!canMeasure}
        onPress={onRemeasure}
        style={styles.gap}
      />
      <BigButton tone="danger" label="이 지점 측정 삭제" hint={`이 지점의 기압과 높이 차 ${pin.edges}개를 지웁니다`} onPress={onDelete} style={styles.gap} />
    </BottomSheet>
  );
}

const shadow = { elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } } as const;

const styles = StyleSheet.create({
  fabWrap: { position: 'absolute', right: space.md },
  fab: {
    width: FAB, height: FAB, borderRadius: FAB / 2, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, ...shadow,
  },
  fabActive: { backgroundColor: color.primary, borderColor: color.primary },
  pressed: { opacity: 0.7 },
  ring: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringNum: { fontSize: font.display, fontWeight: '800', color: color.ink, fontVariant: ['tabular-nums'] },
  ringSmall: { fontSize: font.small, fontWeight: '800', color: color.ink },
  cardWrap: { position: 'absolute', left: space.md, right: space.md },
  card: { gap: space.md, padding: space.lg, borderRadius: radius.md * 1.4, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, ...shadow },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  cardText: { flex: 1, gap: 2 },
  where: { fontSize: font.small, fontWeight: '700', color: color.primary },
  title: { fontSize: font.title, fontWeight: '800', color: color.ink },
  body: { fontSize: font.body, lineHeight: 19, color: color.inkSoft },
  actions: { flexDirection: 'row', gap: space.sm },
  action: { flex: 1, minHeight: TOUCH_LARGE },
  lead: { fontSize: font.body, lineHeight: 20, color: color.ink, marginTop: space.xs },
  note: { fontSize: font.small, lineHeight: 18, color: color.inkSoft, marginTop: space.xs },
  gap: { marginTop: space.lg },
  summary: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  summaryCell: { flex: 1, padding: space.md, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  summaryNum: { fontSize: font.display, fontWeight: '800', color: color.ink, fontVariant: ['tabular-nums'] },
  summaryKey: { fontSize: font.small, color: color.inkSoft },
  row: {
    minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line,
  },
  rowMain: { flex: 1 },
  rowEnd: { alignItems: 'flex-end' },
  rowLabel: { fontSize: font.label, fontWeight: '700', color: color.ink },
  rowValue: { fontSize: font.label, fontWeight: '700', color: color.ink, fontVariant: ['tabular-nums'] },
  rowSub: { fontSize: font.small, color: color.inkSoft, fontVariant: ['tabular-nums'] },
  delete: { minHeight: TOUCH, minWidth: 56, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center' },
  deleteLabel: { fontSize: font.body, fontWeight: '700', color: color.danger },
  state: { gap: 4, padding: space.md, marginTop: space.xs, borderRadius: radius.md, borderWidth: 1.5 },
  stateLive: { borderColor: color.primary, backgroundColor: '#EEF4FF' },
  stateSaved: { borderColor: color.ok, backgroundColor: '#EDF7F0' },
  stateTitle: { fontSize: font.label, fontWeight: '800' },
  stateBody: { fontSize: font.small, lineHeight: 18, color: color.ink },
});
