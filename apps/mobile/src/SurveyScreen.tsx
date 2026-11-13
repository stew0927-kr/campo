// The one screen of the app: the map under a crosshair, the record menu at the thumb, and the sheets that ask the few
// questions a record needs. Records are plans of core edit actions (survey/plans.ts); the session runs them and keeps what
// the sensors read (survey/session.ts). This file only wires the pieces and holds what is on screen.
import { buildingById, metres, surveySource, type EditBuilding, type Position } from '@campo/core';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Campus } from './campus.ts';
import { buildArchive } from './export/archive.ts';
import { MapCanvas, type MapHandle } from './map/MapCanvas.tsx';
import { projection } from './map/project.ts';
import { scopeLabel, type Scope } from './model/scope.ts';
import { SURVEY_DIR, clearSnapshot, createSaver, type FileStore } from './storage/store.ts';
import { planDoor, planFloorChange, planJunction, planPortal, planStart, type Plan, type PlanInput } from './survey/plans.ts';
import { nextRoomRef } from './survey/readings.ts';
import type { Readings, SurveySession } from './survey/session.ts';
import { isoLocal } from './time.ts';
import { ActionDock, type DockAction } from './ui/ActionDock.tsx';
import { CameraCapture } from './ui/CameraCapture.tsx';
import { SensorReadout, type SensorValues } from './ui/SensorReadout.tsx';
import { DoorSheet, ExportSheet, FloorSheet, PortalSheet, ScopeSheet, type FloorTrip } from './ui/sheets.tsx';
import type { StepFree } from './ui/stepFree.ts';
import { TOUCH, color, font, radius, space } from './ui/theme.ts';

interface Props {
  campus: Campus;
  session: SurveySession;
  store: FileStore;
  /** Shown once when the screen opens (a restored walk, unreadable Features). */
  greeting: string | null;
  /** Throw the walk away and begin a new one. */
  onReset: () => void;
}

type Sheet = 'door' | 'floor' | 'portal' | 'scope' | 'export' | null;
interface Notice {
  text: string;
  tone: 'info' | 'error';
}
/** A floor change in progress, with where it began. */
type Trip = FloorTrip & { coord: Position };

const NOTICE_MS = { info: 4000, error: 7000 } as const;

function centreOf(b: EditBuilding): Position {
  const ring = b.polygon[0] ?? [];
  const n = Math.max(ring.length, 1);
  return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
}

export function SurveyScreen({ campus, session, store, greeting, onReset }: Props) {
  const insets = useSafeAreaInsets();
  // Re-render on every change of the session (a record, an undo). Dragging the map and sensor readings do not come through here.
  useSyncExternalStore(session.subscribe, session.getRevision);
  const { state, scope, anchorId } = session;
  const proj = useMemo(() => projection(campus.center), [campus.center]);

  const map = useRef<MapHandle>(null);
  const sensors = useRef<SensorValues>({ pressureHpa: null, headingDeg: null });
  const [sheet, setSheet] = useState<Sheet>(null);
  const [menuOpen, setMenuOpen] = useState(true);
  const [camera, setCamera] = useState(false);
  /** Pictures taken for the record being made; they are filed under its Feature when it is recorded. */
  const [shots, setShots] = useState<string[]>([]);
  const [stepFree, setStepFree] = useState<StepFree>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [lastRoom, setLastRoom] = useState('');
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(greeting ? { text: greeting, tone: 'info' } : null);

  // Nothing below may touch the screen after it is gone (a photo copy or an export can finish late).
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const notify = useCallback((text: string, tone: Notice['tone'] = 'info') => {
    if (alive.current) setNotice({ text, tone });
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS[notice.tone]);
    return () => clearTimeout(timer);
  }, [notice]);

  // Every change of the walk is written to the phone; the saver keeps writes from overlapping.
  const saver = useMemo(
    () => createSaver(store, () => session.snapshot(), (err) => notify(`기기에 저장하지 못했습니다. ${err.message}`, 'error')),
    [store, session, notify],
  );
  useEffect(() => session.subscribe(() => void saver.request()), [session, saver]);

  const crosshair = (): Position => map.current?.crosshair() ?? campus.center;
  const input = (coord: Position = crosshair()): PlanInput => ({
    state, ctx: session.ctx, scope, coord, anchorId, source: surveySource(session.startedAt),
  });
  /** Buildings, nearest to the crosshair first. Sorted when a sheet opens; the crosshair does not move while one is open. */
  const buildingsNear = useMemo(() => {
    const here = map.current?.crosshair() ?? campus.center;
    return Object.values(state.buildings).map((b) => ({ b, d: metres(centreOf(b), here) })).sort((a, z) => a.d - z.d).map((x) => x.b);
  }, [state.buildings, sheet, campus.center]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeSheet = (): void => {
    setSheet(null);
    setShots([]);
  };
  /** The pictures taken so far and the button that takes another, for the sheets that have one. */
  const photo = { photos: shots.length, onPhoto: () => setCamera(true) };

  /** Run a plan with what the sensors read now (`trip`: the pressures read on leaving and arriving), and file its pictures. */
  const record = (plan: Plan, trip?: Readings['trip']): boolean => {
    if ('error' in plan) {
      notify(plan.error, 'error');
      return false;
    }
    const uris = shots;
    const paths = session.record(plan, { at: isoLocal(new Date()), ...sensors.current, ...(trip ? { trip } : {}), photos: uris.length });
    // Copy the pictures into the walk's folder under the names the session reserved for them.
    void Promise.all(paths.map((path, i) => store.importFile(uris[i]!, `${SURVEY_DIR}/${path}`)))
      .catch((err: Error) => notify(`사진을 저장하지 못했습니다. ${err.message}`, 'error'));
    notify(plan.notices[0] ?? (plan.action ? '기록했습니다.' : '이미 있는 지점으로 옮겼습니다.'));
    return true;
  };

  /** Look at another floor (or the outdoors), then show `next` (the sheet that needed a floor). */
  const pickScope = (to: Scope, next: Sheet = null): void => {
    session.moveTo(to);
    map.current?.show(to);
    setSheet(next);
    if (next === null) setShots([]);
  };

  const exportData = async (): Promise<void> => {
    setExporting(true);
    try {
      const at = isoLocal(new Date());
      const where = scope.kind === 'building' ? buildingById(state, scope.buildingId)?.props.code ?? 'indoor' : 'outdoor';
      const survey = session.toSurvey(`${where}-${at.slice(11, 16).replace(':', '')}`, at);
      const archive = await buildArchive(survey, (path) => store.readBytes(`${SURVEY_DIR}/${path}`));
      const uri = await store.writeShared(archive.name, archive.bytes);
      if (archive.missing.length > 0) notify(`사진 ${archive.missing.length}장을 찾지 못해 빼고 묶었습니다.`, 'error');
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/zip', dialogTitle: '현장 기록 내보내기' });
      else notify('이 기기에서는 공유 창을 열 수 없습니다.', 'error');
    } catch (err) {
      notify(`내보내지 못했습니다. ${(err as Error).message}`, 'error');
    } finally {
      if (alive.current) setExporting(false);
    }
  };

  const confirmReset = (): void => {
    Alert.alert('기록을 모두 지울까요?', '이 기기에 저장된 조사 기록과 사진이 지워집니다. 내보내지 않은 기록은 되살릴 수 없습니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '지우고 새로 시작',
        style: 'destructive',
        onPress: () => void clearSnapshot(store).then(onReset, (err: Error) => notify(`지우지 못했습니다. ${err.message}`, 'error')),
      },
    ]);
  };

  const actions: DockAction[] = [
    { id: 'start', label: '출발점 지정', hint: '십자선 자리에서 시작', onPress: () => record(planStart(input())) },
    {
      id: 'junction', label: '갈림길 기록', primary: true,
      hint: anchorId === null ? '먼저 출발점을 정해 주세요' : '직전 지점과 잇기',
      onPress: () => record(planJunction(input(), { stepFree })),
    },
    { id: 'door', label: '문/강의실 번호', onPress: () => setSheet('door') },
    { id: 'floor', label: trip ? '도착 기록' : '계단/EV 층 변경', ...(trip ? { hint: '층 이동 중입니다' } : {}), onPress: () => setSheet('floor') },
    { id: 'portal', label: '포탈', hint: scope.kind === 'building' ? '밖으로 나가기' : '건물로 들어가기', onPress: () => setSheet('portal') },
  ];

  const here = scope.kind === 'building' ? buildingById(state, scope.buildingId) : undefined;

  return (
    <View style={styles.root}>
      <MapCanvas state={state} base={session.base} projection={proj} center={campus.center} scope={scope} anchorId={anchorId} handle={map} />

      <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <View pointerEvents="box-none" style={styles.topRow}>
          <Pressable
            onPress={() => setSheet('scope')}
            accessibilityRole="button"
            accessibilityLabel={`지금 ${scopeLabel(scope, state)}. 눌러서 건물과 층 고르기`}
            style={({ pressed }) => [styles.scope, pressed && styles.pressed]}
          >
            <Text style={styles.scopeLabel} numberOfLines={1}>{scopeLabel(scope, state)}</Text>
            <Text style={styles.scopeHint}>바꾸기</Text>
          </Pressable>
          <Pressable onPress={() => setSheet('export')} accessibilityRole="button" accessibilityLabel="데이터 내보내기" style={({ pressed }) => [styles.export, pressed && styles.pressed]}>
            <Text style={styles.exportLabel}>내보내기</Text>
          </Pressable>
        </View>
        <SensorReadout into={sensors} />
        {notice && (
          <View style={[styles.notice, notice.tone === 'error' && styles.noticeError]} accessibilityLiveRegion="polite" accessibilityRole="alert">
            <Text style={styles.noticeText}>{notice.text}</Text>
          </View>
        )}
      </View>

      <ActionDock
        actions={actions} open={menuOpen} onToggle={() => setMenuOpen((o) => !o)}
        canUndo={session.canUndo} onUndo={() => { if (session.undo()) notify('되돌렸습니다.'); }}
        stepFree={stepFree} onStepFree={setStepFree}
      />

      {sheet === 'scope' && <ScopeSheet scope={scope} buildings={buildingsNear} onClose={closeSheet} onPick={(to) => pickScope(to)} />}
      {sheet === 'door' && (
        <DoorSheet
          suggestion={lastRoom === '' ? '' : nextRoomRef(lastRoom)} {...photo} onClose={closeSheet}
          onRecord={(answer) => {
            if (!record(planDoor(input(), answer))) return;
            if (answer.roomRef !== '' && answer.doorRole === 'front') setLastRoom(answer.roomRef);
            closeSheet();
          }}
        />
      )}
      {sheet === 'floor' && (scope.kind === 'building' && here ? (
        <FloorSheet
          scope={scope} building={here} trip={trip} {...photo}
          onClose={() => setSheet(null) /* pictures taken for the trip are kept until it ends */}
          onDepart={(next) => {
            setTrip({ ...next, coord: crosshair() });
            setSheet(null);
            notify('도착하면 [도착 기록]을 눌러 주세요.');
          }}
          onCancelTrip={() => {
            setTrip(null);
            closeSheet();
          }}
          onArrive={({ incline, endHpa }) => {
            if (!trip) return;
            const plan = planFloorChange(input(trip.coord), { kind: trip.kind, toLevel: trip.toLevel, ...(incline ? { incline } : {}) });
            if (!record(plan, { startHpa: trip.startHpa, endHpa })) return;
            setTrip(null);
            closeSheet();
          }}
        />
      ) : (
        // Stairs and elevators are inside a building: pick the floor first, then the sheet comes back.
        <ScopeSheet scope={scope} buildings={buildingsNear} onClose={closeSheet} onPick={(to) => pickScope(to, to.kind === 'building' ? 'floor' : null)} />
      ))}
      {sheet === 'portal' && (
        <PortalSheet
          scope={scope} buildings={buildingsNear} stepFree={stepFree} {...photo} onClose={closeSheet}
          onRecord={(answer) => {
            if (record(planPortal(input(), answer))) closeSheet();
          }}
        />
      )}
      {sheet === 'export' && (
        <ExportSheet counts={session.counts()} busy={exporting} onExport={() => void exportData()} onReset={confirmReset} onClose={closeSheet} />
      )}

      {camera && (
        <CameraCapture
          onClose={() => setCamera(false)}
          onError={(message) => {
            setCamera(false);
            notify(message, 'error');
          }}
          onCapture={(uri) => {
            setShots((s) => [...s, uri]);
            setCamera(false);
          }}
        />
      )}
    </View>
  );
}

const shadow = { elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } } as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: space.lg, gap: space.sm },
  topRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  scope: {
    flex: 1, minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm,
    paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.line, ...shadow,
  },
  scopeLabel: { flexShrink: 1, fontSize: font.label, fontWeight: '800', color: color.ink },
  scopeHint: { fontSize: font.small, fontWeight: '600', color: color.primary },
  export: { minHeight: TOUCH, paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center', ...shadow },
  exportLabel: { fontSize: font.body, fontWeight: '800', color: color.onPrimary },
  notice: { padding: space.md, borderRadius: radius.sm, backgroundColor: color.ink, ...shadow },
  noticeError: { backgroundColor: color.danger },
  noticeText: { fontSize: font.body, lineHeight: 22, fontWeight: '600', color: color.onPrimary },
  pressed: { opacity: 0.7 },
});
