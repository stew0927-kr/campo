// The one screen of the app: the map under a crosshair, the compact tool panel at the thumb, and the sheets that ask the
// few questions a record needs. Records are plans of core edit actions (survey/plans.ts, buildings.ts, floors.ts); the
// session runs them and keeps what the sensors read (survey/session.ts). This file only wires the pieces and holds what is on screen.
import { buildingById, metres, surveySource, type EditBuilding, type EditNode, type Position } from '@campo/core';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Campus } from './campus.ts';
import { buildArchive } from './export/archive.ts';
import { expoTileStore } from './map/expoTileStore.ts';
import { MapCanvas, type MapHandle } from './map/MapCanvas.tsx';
import { projection } from './map/project.ts';
import { bboxSpanM, campusBbox, createTileCache, tilesInBbox } from './map/tileCache.ts';
import { TILE_ATTRIBUTION } from './map/tiles.ts';
import { pointTitle, scopeLabel, type Scope } from './model/scope.ts';
import { SURVEY_DIR, clearSnapshot, createSaver, type FileStore } from './storage/store.ts';
import { lookupOsmBuilding, planDrawnBuilding, planOsmBuilding } from './survey/buildings.ts';
import { floorCopyTargets, planCopyFloor, planMoveNode, planUnsync, syncedOnFloor } from './survey/floors.ts';
import { planDoor, planFloorChange, planJunction, planPortal, planStart, type Plan, type PlanInput } from './survey/plans.ts';
import { nextRoomRef } from './survey/readings.ts';
import type { Readings, SurveySession } from './survey/session.ts';
import { isoLocal } from './time.ts';
import { ActionDock, type DockAction, type DockMode } from './ui/ActionDock.tsx';
import { CameraCapture } from './ui/CameraCapture.tsx';
import { CompassDial } from './ui/CompassDial.tsx';
import { bearingDeg, wholeDegrees } from './ui/dial.ts';
import { SensorReadout, type SensorValues } from './ui/SensorReadout.tsx';
import { DoorSheet, ExportSheet, FloorSheet, PointInfoSheet, PortalSheet, ScopeSheet, ShotsContext, type FloorTrip } from './ui/sheets.tsx';
import type { StepFree } from './ui/stepFree.ts';
import { TOUCH, color, font, radius, space } from './ui/theme.ts';
import { BuildingFormSheet, FloorCopySheet, PhotosSheet, SettingsSheet, type PrefetchState } from './ui/toolSheets.tsx';

interface Props {
  campus: Campus;
  session: SurveySession;
  store: FileStore;
  /** Shown once when the screen opens (a restored walk, unreadable Features). */
  greeting: string | null;
  /** Throw the walk away and begin a new one. */
  onReset: () => void;
}

type Sheet = 'door' | 'floor' | 'portal' | 'scope' | 'export' | 'info' | 'building' | 'copy' | 'photos' | 'settings' | null;
interface Notice {
  text: string;
  tone: 'info' | 'error';
}
/** A floor change in progress, with where it began: the spot, the floor and the point walked from. */
type Trip = FloorTrip & { coord: Position; scope: Scope; anchorId: string | null };
/** The compass dial being used: for a picture of the record being made, or for a photo already saved on a point. */
interface DialTarget {
  title: string;
  initial: number | null;
  guides: number[];
  onConfirm: (headingDeg: number) => void;
}
/** Where the next picture goes: with the record being made, or onto the point the 사진 tool is open for. */
type CameraFor = { kind: 'record' } | { kind: 'point'; nodeId: string };

const NOTICE_MS = { info: 4000, error: 7000 } as const;
const tileCache = createTileCache(expoTileStore);

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
  const [camera, setCamera] = useState<CameraFor | null>(null);
  /** Pictures taken for the record being made (and the direction each looks); they are filed under its Feature when it is recorded. */
  const [shots, setShots] = useState<string[]>([]);
  const [shotHeadings, setShotHeadings] = useState<(number | null)[]>([]);
  const [dial, setDial] = useState<DialTarget | null>(null);
  const [stepFree, setStepFree] = useState<StepFree>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [lastRoom, setLastRoom] = useState('');
  /** The existing point under the crosshair, and the one the 정보 / 사진 sheets were opened for (the map cannot move while one is open). */
  const [snappedId, setSnappedId] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  /** An outline being drawn, and a point being moved. */
  const [draft, setDraft] = useState<Position[] | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(greeting ? { text: greeting, tone: 'info' } : null);
  const [prefetch, setPrefetch] = useState<PrefetchState>({ running: false, done: 0, total: 0, result: null });
  const cancelPrefetch = useRef({ cancelled: false });

  // Nothing below may touch the screen after it is gone (a photo copy or an export can finish late).
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
    cancelPrefetch.current.cancelled = true;
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

  const clearShots = (): void => {
    setShots([]);
    setShotHeadings([]);
  };
  const closeSheet = (): void => {
    setSheet(null);
    clearShots();
  };
  /** The pictures taken so far and the button that takes another, for the sheets that have one. */
  const photo = { photos: shots.length, onPhoto: () => setCamera({ kind: 'record' }) };

  /** Directions (from north) of the edges that leave a point: the dial draws them to line the fan up with. */
  const guidesOf = (nodeId: string | null): number[] => {
    const node = nodeId !== null ? state.nodes[nodeId] : undefined;
    if (!node) return [];
    const out = new Set<number>();
    for (const e of Object.values(state.edges)) {
      const other = e.props.from === node.id ? state.nodes[e.props.to] : e.props.to === node.id ? state.nodes[e.props.from] : undefined;
      if (other && metres(other.coord, node.coord) > 0.3) out.add(wholeDegrees(bearingDeg(node.coord, other.coord)));
    }
    return [...out].slice(0, 8);
  };

  /**
   * Run a plan with what the sensors read now (`trip`: the pressures read on leaving and arriving). `uris` are the pictures
   * taken in the record's own sheet; a record made from the menu has none, so pictures waiting for another record stay with it.
   */
  const record = (plan: Plan, uris: readonly string[] = [], trip?: Readings['trip']): boolean => {
    if ('error' in plan) {
      notify(plan.error, 'error');
      return false;
    }
    const paths = session.record(plan, { at: isoLocal(new Date()), ...sensors.current, ...(trip ? { trip } : {}), photos: uris.length, photoHeadings: shotHeadings.slice(0, uris.length) });
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
    if (next === null) clearShots();
  };

  // ---- 건물 추가 ----

  const finishBuilding = (done: { action: Parameters<SurveySession['edit']>[0]; scope: Scope; notices: string[] }): boolean => {
    const result = session.edit(done.action, done.scope, null);
    if ('error' in result) {
      notify(result.error, 'error');
      return false;
    }
    map.current?.show(done.scope);
    notify(done.notices[0] ?? '건물을 추가했습니다.');
    return true;
  };
  /** OSM 건물 가져오기: the building under the crosshair comes from the outlines bundled in the app. */
  const addOsmBuilding = (): void => {
    const found = lookupOsmBuilding(campus.osm, state, crosshair());
    if ('error' in found) return notify(found.error, 'error');
    const plan = planOsmBuilding(state, found.building);
    if ('error' in plan) return notify(plan.error, 'error');
    finishBuilding(plan);
  };
  const addDrawnBuilding = (form: { name: string; levels: number[] }): void => {
    const plan = planDrawnBuilding(state, session.ctx, draft ?? [], form);
    if ('error' in plan) return notify(plan.error, 'error');
    if (finishBuilding(plan)) {
      setDraft(null);
      setSheet(null);
    }
  };

  // ---- 층 복사 · 연동, 옮기기 ----

  const copyFloor = (levels: number[]): void => {
    if (scope.kind !== 'building') return;
    const plan = planCopyFloor(state, session.ctx, scope.buildingId, scope.level, levels);
    if ('error' in plan) return notify(plan.error, 'error');
    const done = session.edit(plan.action);
    if ('error' in done) return notify(done.error, 'error');
    setSheet(null);
    notify(plan.notices.join(' '));
  };
  const unsync = (ids: readonly string[]): void => {
    const plan = planUnsync(state, ids);
    if ('error' in plan) return notify(plan.error, 'error');
    const done = session.edit(plan.action);
    if ('error' in done) return notify(done.error, 'error');
    setSheet(null);
    notify(`지점 ${plan.count}개의 층 연동을 해제했습니다. 다른 층의 지점은 그대로 연동되어 있습니다.`);
  };
  const putDown = (): void => {
    if (moving === null) return;
    const plan = planMoveNode(state, moving, crosshair());
    if ('error' in plan) return notify(plan.error, 'error');
    const done = session.edit(plan.action);
    if ('error' in done) return notify(done.error, 'error');
    setMoving(null);
    notify(plan.moved > 1 ? `연동된 ${plan.moved}개 층의 지점을 같이 옮겼습니다.` : '지점을 옮겼습니다.');
  };

  // ---- 사진과 방향 ----

  /** A picture was taken: its direction starts at the compass reading and the dial opens to correct it. */
  const picked = (uri: string, target: CameraFor): void => {
    const sensor = sensors.current.headingDeg;
    const initial = sensor === null ? null : wholeDegrees(sensor);
    setCamera(null);
    if (target.kind === 'record') {
      const index = shots.length;
      setShots((s) => [...s, uri]);
      setShotHeadings((h) => [...h, initial]);
      setDial({
        title: `사진 ${index + 1} 방향`, initial, guides: guidesOf(snappedId),
        onConfirm: (deg) => {
          setShotHeadings((h) => h.map((x, i) => (i === index ? deg : x)));
          setDial(null);
        },
      });
      return;
    }
    const node = state.nodes[target.nodeId];
    if (!node) return;
    setDial({
      title: `${pointTitle(node)} 사진 방향`, initial, guides: guidesOf(node.id),
      onConfirm: (deg) => {
        setDial(null);
        const done = session.annotate(node.id, { access: node.props, photos: 1, photoHeadings: [deg] }, isoLocal(new Date()));
        if ('error' in done) return notify(done.error, 'error');
        void Promise.all(done.paths.map((path) => store.importFile(uri, `${SURVEY_DIR}/${path}`)))
          .catch((err: Error) => notify(`사진을 저장하지 못했습니다. ${err.message}`, 'error'));
        notify('사진을 저장했습니다.');
      },
    });
  };
  /** Change the direction of the picture `index` taken for the record being made. */
  const editShot = (index: number): void => {
    setDial({
      title: `사진 ${index + 1} 방향`, initial: shotHeadings[index] ?? null, guides: guidesOf(snappedId),
      onConfirm: (deg) => {
        setShotHeadings((h) => h.map((x, i) => (i === index ? deg : x)));
        setDial(null);
      },
    });
  };
  /** Change the direction of a photo already saved on a point. */
  const editSaved = (nodeId: string, path: string): void => {
    const node = state.nodes[nodeId];
    if (!node) return;
    setDial({
      title: `${pointTitle(node)} 사진 방향`, initial: session.attachments[nodeId]?.photo_meta?.[path]?.heading_deg ?? null, guides: guidesOf(nodeId),
      onConfirm: (deg) => {
        setDial(null);
        if (session.setPhotoHeading(nodeId, path, deg)) notify(`사진 방향을 ${deg}°로 저장했습니다.`);
      },
    });
  };

  // ---- 설정: 오프라인 지도 ----

  const prefetchPlan = useMemo(() => {
    const ob = campus.osm?.bbox;
    const box = ob && ob.length === 4 ? ([ob[0]!, ob[1]!, ob[2]!, ob[3]!] as [number, number, number, number]) : campusBbox(campus.base);
    return box ? { tiles: tilesInBbox(box), spanM: bboxSpanM(box) } : null;
  }, [campus]);
  const runPrefetch = (): void => {
    if (!prefetchPlan || prefetch.running) return;
    cancelPrefetch.current = { cancelled: false };
    setPrefetch({ running: true, done: 0, total: prefetchPlan.tiles.length, result: null });
    void tileCache.prefetch(prefetchPlan.tiles, (done, total) => {
      if (alive.current) setPrefetch((p) => ({ ...p, done, total }));
    }, cancelPrefetch.current).then((result) => {
      if (alive.current) setPrefetch((p) => ({ ...p, running: false, result }));
    });
  };

  const exportData = async (): Promise<void> => {
    setExporting(true);
    try {
      const at = isoLocal(new Date());
      const where = scope.kind === 'building' ? buildingById(state, scope.buildingId)?.props.code ?? 'indoor' : 'outdoor';
      // The time to the second keeps two exports (or two phones in one building) from sharing an id.
      const survey = session.toSurvey(`${where}-${at.slice(11, 19).replaceAll(':', '')}`, at);
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

  const here = scope.kind === 'building' ? buildingById(state, scope.buildingId) : undefined;
  const snapped = snappedId !== null ? state.nodes[snappedId] : undefined;
  const infoNode = infoId !== null ? state.nodes[infoId] : undefined;
  /** The point a tool works on: the one the crosshair is on, else a notice that asks for one. */
  const needPoint = (open: (node: EditNode) => void) => (): void => {
    if (snapped) open(snapped);
    else notify('십자선을 지점에 맞춘 뒤 눌러 주세요.', 'error');
  };

  /** 개방시간·폐쇄기간·개방조건, the note and the pictures of the point the crosshair is on. */
  const saveInfo = (node: EditNode, answer: { access: { hours: string; closed_period: string; access_condition: string }; note: string }): void => {
    const done = session.annotate(node.id, { ...answer, photos: shots.length, photoHeadings: shotHeadings }, isoLocal(new Date()));
    if ('error' in done) return notify(done.error, 'error');
    void Promise.all(done.paths.map((path, i) => store.importFile(shots[i]!, `${SURVEY_DIR}/${path}`)))
      .catch((err: Error) => notify(`사진을 저장하지 못했습니다. ${err.message}`, 'error'));
    notify(`${pointTitle(node)} 정보를 저장했습니다.`);
    closeSheet();
  };

  const records: DockAction[] = [
    { id: 'start', label: '출발점', hint: '십자선 자리에서 시작', onPress: () => record(planStart(input())) },
    { id: 'junction', label: '갈림길', primary: true, hint: anchorId === null ? '먼저 출발점을 정해 주세요' : '직전 지점과 잇기', onPress: () => record(planJunction(input(), { stepFree })) },
    { id: 'door', label: '문/호실', onPress: () => setSheet('door') },
    { id: 'floor', label: trip ? '도착 기록' : '계단/EV', ...(trip ? { hint: '층 이동 중입니다' } : {}), active: trip !== null, onPress: () => setSheet('floor') },
    { id: 'portal', label: '출입구', hint: scope.kind === 'building' ? '밖으로 나가기' : '건물로 들어가기', onPress: () => setSheet('portal') },
  ];
  const tools: DockAction[] = [
    { id: 'osm', label: '건물+OSM', hint: '십자선 자리의 OSM 건물 가져오기', onPress: addOsmBuilding },
    { id: 'draw', label: '건물 그리기', hint: '외곽선을 점으로 찍어 건물 만들기', onPress: () => setDraft([]) },
    {
      id: 'copy', label: '층 복사·연동', onPress: () => {
        if (scope.kind === 'building') setSheet('copy');
        else notify('건물 안의 층에서만 복사할 수 있습니다.', 'error');
      },
    },
    { id: 'photo', label: '사진·방향', onPress: needPoint((node) => { setInfoId(node.id); setSheet('photos'); }) },
    { id: 'info', label: '개방 정보', onPress: needPoint((node) => { setInfoId(node.id); setSheet('info'); }) },
    { id: 'move', label: '옮기기', onPress: needPoint((node) => { setMoving(node.id); notify(`${pointTitle(node)}을(를) 옮길 자리에 십자선을 맞춰 주세요.`); }) },
    { id: 'undo', label: '되돌리기', disabled: !session.canUndo, onPress: () => { if (session.undo()) notify('되돌렸습니다.'); } },
    { id: 'export', label: '내보내기', onPress: () => setSheet('export') },
    { id: 'settings', label: '설정', onPress: () => setSheet('settings') },
  ];

  const mode: DockMode | null = draft !== null
    ? {
      text: draft.length < 3 ? `건물 모서리마다 십자선을 맞추고 [점 추가]를 눌러 주세요. (${draft.length}개, 세 개 이상 필요)` : `모서리 ${draft.length}개. 더 찍거나 [완료]를 눌러 주세요.`,
      actions: [
        { id: 'add', label: '점 추가', primary: true, onPress: () => setDraft((d) => [...(d ?? []), crosshair()]) },
        { id: 'back', label: '마지막 점 취소', disabled: draft.length === 0, onPress: () => setDraft((d) => (d ?? []).slice(0, -1)) },
        { id: 'done', label: '완료', disabled: draft.length < 3, onPress: () => setSheet('building') },
        { id: 'cancel', label: '그리기 취소', tone: 'danger', onPress: () => setDraft(null) },
      ],
    }
    : moving !== null
      ? {
        text: `${state.nodes[moving] ? pointTitle(state.nodes[moving]!) : '지점'}을(를) 십자선 자리로 옮깁니다.${state.nodes[moving]?.props.sync_group !== undefined ? ' 연동된 다른 층의 지점도 같이 옮겨집니다.' : ''}`,
        actions: [
          { id: 'put', label: '여기로 이동', primary: true, onPress: putDown },
          { id: 'cancel', label: '취소', tone: 'danger', onPress: () => setMoving(null) },
        ],
      }
      : null;

  const copyPoint = snapped ? { title: pointTitle(snapped), synced: snapped.props.sync_group !== undefined } : null;

  return (
    <View style={styles.root}>
      <MapCanvas state={state} base={session.base} projection={proj} center={campus.center} scope={scope} anchorId={anchorId} handle={map} tileCache={tileCache} draft={draft} movingId={moving} onSnap={setSnappedId} />

      <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <View pointerEvents="box-none" style={styles.topRow}>
          <Pressable
            onPress={() => setSheet('scope')}
            accessibilityRole="button"
            accessibilityLabel={`지금 ${scopeLabel(scope, state)}. 눌러서 건물과 층 고르기`}
            style={({ pressed }) => [styles.scope, pressed && styles.pressed]}
          >
            <Text style={styles.scopeLabel} numberOfLines={1}>{scopeLabel(scope, state)}</Text>
            <Text style={styles.scopeHint}>건물·층 ▾</Text>
          </Pressable>
          <Text style={styles.attribution} accessibilityLabel={`지도 배경 ${TILE_ATTRIBUTION}`}>{TILE_ATTRIBUTION}</Text>
        </View>
        <SensorReadout into={sensors} />
        {notice && (
          <View style={[styles.notice, notice.tone === 'error' && styles.noticeError]} accessibilityLiveRegion="polite" accessibilityRole="alert">
            <Text style={styles.noticeText}>{notice.text}</Text>
          </View>
        )}
      </View>

      {snapped && sheet === null && !camera && !dial && draft === null && moving === null && (
        // Just under the crosshair: the point it is on can be filled in without making a record.
        <View pointerEvents="box-none" style={styles.snapWrap}>
          <Pressable
            onPress={() => {
              setInfoId(snapped.id);
              setSheet('info');
            }}
            accessibilityRole="button"
            accessibilityLabel={`${pointTitle(snapped)} 정보 입력`}
            accessibilityHint="개방시간, 폐쇄기간, 개방조건, 메모와 사진을 적습니다"
            style={({ pressed }) => [styles.snap, pressed && styles.pressed]}
          >
            <Text style={styles.snapTitle} numberOfLines={1}>{pointTitle(snapped)}</Text>
            <Text style={styles.snapHint}>정보</Text>
          </Pressable>
        </View>
      )}

      <ActionDock records={records} tools={tools} open={menuOpen} onToggle={() => setMenuOpen((o) => !o)} stepFree={stepFree} onStepFree={setStepFree} mode={mode} />

      <ShotsContext.Provider value={{ headings: shotHeadings, onEdit: editShot }}>
        {sheet === 'scope' && <ScopeSheet scope={scope} buildings={buildingsNear} onClose={closeSheet} onPick={(to) => pickScope(to)} />}
        {sheet === 'door' && (
          <DoorSheet
            suggestion={lastRoom === '' ? '' : nextRoomRef(lastRoom)} {...photo} onClose={closeSheet}
            onRecord={(answer) => {
              if (!record(planDoor(input(), answer), shots)) return;
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
              setTrip({ ...next, coord: crosshair(), scope, anchorId });
              setSheet(null);
              notify('도착하면 [도착 기록]을 눌러 주세요.');
            }}
            onCancelTrip={() => {
              setTrip(null);
              closeSheet();
            }}
            onArrive={({ incline, endHpa }) => {
              if (!trip) return;
              // From where the trip began, whatever floor the map was turned to on the way.
              const from = { ...input(trip.coord), scope: trip.scope, anchorId: trip.anchorId !== null && trip.anchorId in state.nodes ? trip.anchorId : null };
              const plan = planFloorChange(from, { kind: trip.kind, toLevel: trip.toLevel, ...(incline ? { incline } : {}) });
              if (!record(plan, shots, { startHpa: trip.startHpa, endHpa })) return;
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
              if (record(planPortal(input(), answer), shots)) closeSheet();
            }}
          />
        )}
        {sheet === 'info' && infoNode && (
          <PointInfoSheet
            title={pointTitle(infoNode)}
            access={infoNode.props}
            note={session.attachments[infoNode.id]?.note ?? ''}
            {...photo}
            onClose={closeSheet}
            onSave={(answer) => saveInfo(infoNode, answer)}
          />
        )}
      </ShotsContext.Provider>
      {sheet === 'photos' && infoNode && (
        <PhotosSheet
          title={`${pointTitle(infoNode)} 사진`}
          photos={(session.attachments[infoNode.id]?.photos ?? []).map((path) => ({ path, heading: session.attachments[infoNode.id]?.photo_meta?.[path]?.heading_deg ?? null }))}
          onAdd={() => setCamera({ kind: 'point', nodeId: infoNode.id })}
          onHeading={(path) => editSaved(infoNode.id, path)}
          onClose={closeSheet}
        />
      )}
      {sheet === 'building' && draft !== null && <BuildingFormSheet corners={draft.length} onSave={addDrawnBuilding} onClose={() => setSheet(null)} />}
      {sheet === 'copy' && scope.kind === 'building' && here && (
        <FloorCopySheet
          buildingName={here.props.name}
          level={scope.level}
          targets={floorCopyTargets(state, scope.buildingId, scope.level)}
          syncedCount={syncedOnFloor(state, scope.buildingId, scope.level).length}
          point={copyPoint}
          onCopy={copyFloor}
          onUnsyncFloor={() => unsync(syncedOnFloor(state, scope.buildingId, scope.level))}
          onUnsyncPoint={() => snapped && unsync([snapped.id])}
          onMovePoint={() => {
            if (!snapped) return;
            setMoving(snapped.id);
            setSheet(null);
            notify(`${pointTitle(snapped)}을(를) 옮길 자리에 십자선을 맞춰 주세요.`);
          }}
          onClose={closeSheet}
        />
      )}
      {sheet === 'settings' && (
        <SettingsSheet
          usage={tileCache.usage()}
          plan={prefetchPlan ? { tiles: prefetchPlan.tiles.length, spanM: prefetchPlan.spanM } : null}
          prefetch={prefetch}
          onPrefetch={runPrefetch}
          onCancel={() => { cancelPrefetch.current.cancelled = true; }}
          onClear={() => {
            tileCache.clear();
            setPrefetch({ running: false, done: 0, total: 0, result: null });
            notify('저장된 지도를 지웠습니다.');
          }}
          onClose={closeSheet}
        />
      )}
      {sheet === 'export' && (
        <ExportSheet counts={session.counts()} busy={exporting} onExport={() => void exportData()} onReset={confirmReset} onClose={closeSheet} />
      )}

      {camera && (
        <CameraCapture
          onClose={() => setCamera(null)}
          onError={(message) => {
            setCamera(null);
            notify(message, 'error');
          }}
          onCapture={(uri) => picked(uri, camera)}
        />
      )}
      {dial && (
        <CompassDial
          title={dial.title} initial={dial.initial} guides={dial.guides} sensor={() => (sensors.current.headingDeg === null ? null : wholeDegrees(sensors.current.headingDeg))}
          onConfirm={dial.onConfirm}
          onClose={() => {
            // Leaving the dial keeps the heading the compass gave: the picture is not lost.
            setDial(null);
          }}
        />
      )}
    </View>
  );
}

const shadow = { elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } } as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: space.md, gap: space.sm },
  topRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center', justifyContent: 'space-between' },
  scope: {
    flexShrink: 1, minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, ...shadow,
  },
  scopeLabel: { flexShrink: 1, fontSize: font.label, fontWeight: '800', color: color.ink },
  scopeHint: { fontSize: font.small, fontWeight: '600', color: color.primary },
  attribution: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.8)', fontSize: 10, color: color.inkSoft },
  snapWrap: { position: 'absolute', left: 0, right: 0, top: '50%', marginTop: 40, alignItems: 'center' },
  snap: {
    minHeight: TOUCH, maxWidth: 260, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg,
    borderRadius: radius.pill, backgroundColor: color.ok, ...shadow,
  },
  snapTitle: { flexShrink: 1, fontSize: font.body, fontWeight: '800', color: color.onPrimary },
  snapHint: { fontSize: font.small, fontWeight: '700', color: color.onPrimary, opacity: 0.9 },
  notice: { padding: space.md, borderRadius: radius.sm, backgroundColor: color.ink, ...shadow },
  noticeError: { backgroundColor: color.danger },
  noticeText: { fontSize: font.body, lineHeight: 19, fontWeight: '600', color: color.onPrimary },
  pressed: { opacity: 0.7 },
});
