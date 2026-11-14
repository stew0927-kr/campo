// The one screen of the app: the map under a crosshair, the compact tool panel at the thumb, and the sheets that ask the
// few questions a record needs. Records are plans of core edit actions (survey/plans.ts, buildings.ts, floors.ts, rooms.ts,
// selection.ts); the session runs them and keeps what the sensors read (survey/session.ts). This file only wires the
// pieces and holds what is on screen.
import { buildingById, metres, surveySource, type EditBuilding, type EditNode, type Position } from '@campo/core';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Campus } from './campus.ts';
import { buildArchive } from './export/archive.ts';
import { expoTileStore } from './map/expoTileStore.ts';
import { MapCanvas, type HeadingEdit, type MapHandle, type MapMode } from './map/MapCanvas.tsx';
import { projection } from './map/project.ts';
import { bboxSpanM, campusBbox, createTileCache, tilesInBbox } from './map/tileCache.ts';
import { TILE_ATTRIBUTION } from './map/tiles.ts';
import { OUTDOOR, defaultLevel, pointTitle, scopeLabel, type Scope } from './model/scope.ts';
import { SURVEY_DIR, clearSnapshot, createSaver, type FileStore } from './storage/store.ts';
import { lookupOsmBuilding, planDrawnBuilding, planOsmBuilding } from './survey/buildings.ts';
import { floorCopyTargets, planCopyFloor, planMoveNode, planUnsync, syncedOnFloor } from './survey/floors.ts';
import { planDoor, planEscalator, planFloorChange, planLink, planPortal, planRestroom, planStart, type PathKind, type Plan, type PlanInput } from './survey/plans.ts';
import { nextRoomRef } from './survey/readings.ts';
import { advanceRun, corridorAt, isRoomRef, planStrip, stripPreview, type DoorRun, type StripInput } from './survey/rooms.ts';
import {
  EMPTY_SELECTION, isEscalatorEdge, planBuildingEdit, planDeleteBuilding, planDeleteSelection, planEdgeEdits, rideDirections,
  selectionFloor, selectionSize, stillThere, timingStats, toggled, withBox, type Selection,
} from './survey/selection.ts';
import type { Readings, SurveySession } from './survey/session.ts';
import { isoLocal } from './time.ts';
import { ActionDock, type DockAction, type DockMode } from './ui/ActionDock.tsx';
import { CameraCapture } from './ui/CameraCapture.tsx';
import { bearingDeg, wholeDegrees } from './ui/dial.ts';
import { DoorRunPanel, HeadingPanel, LinkPanel, StopwatchPanel } from './ui/modePanels.tsx';
import { BuildingInfoSheet, CopySelectionSheet, EdgePropsSheet, EscalatorSheet, StripSheet, type EscalatorTrip, type StripAnswer } from './ui/selectSheets.tsx';
import { SensorReadout, type SensorValues } from './ui/SensorReadout.tsx';
import { DoorSheet, ExportSheet, FloorSheet, PointInfoSheet, PortalSheet, RestroomSheet, ScopeSheet, ShotsContext, type FloorTrip } from './ui/sheets.tsx';
import { HistoryButtons } from './ui/HistoryButtons.tsx';
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

type Sheet =
  | 'door' | 'floor' | 'portal' | 'scope' | 'export' | 'info' | 'building' | 'copy' | 'photos' | 'settings'
  | 'escalator' | 'restroom' | 'edgeProps' | 'copySelection' | 'buildingInfo' | 'strip' | null;
interface Notice {
  text: string;
  tone: 'info' | 'error';
}
/** A floor change in progress, with where it began: the spot, the floor and the point walked from. */
type Trip = FloorTrip & { coord: Position; scope: Scope; anchorId: string | null; startAt: string };
/** An escalator ride in progress, with where it began. */
type EscTrip = EscalatorTrip & { coord: Position; scope: Scope; anchorId: string | null; startAt: string };
/** The direction of a photo being set on the map: for a picture of the record being made, or for one already saved on a point. */
interface HeadingTarget {
  at: Position;
  deg: number;
  fromSensor: boolean;
  guides: number[];
  onConfirm: (headingDeg: number) => void;
}
/** Where the next picture goes: with the record being made, or onto the point the 사진 tool is open for. */
type CameraFor = { kind: 'record' } | { kind: 'point'; nodeId: string };
/** The tool that owns the panel and the map's finger, when one is on. */
type Tool =
  | { kind: 'link'; pathKind: PathKind; outdoorOnly: boolean }
  | { kind: 'select' }
  | { kind: 'timer'; edgeId: string; direction: 'forward' | 'backward' }
  | { kind: 'doorRun'; run: DoorRun }
  | { kind: 'strip'; stage: 'corridor' | 'first' | 'last'; edges: string[]; first: Position | null };

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
  const [dockHeight, setDockHeight] = useState(0);
  const [camera, setCamera] = useState<CameraFor | null>(null);
  /** Pictures taken for the record being made (and the direction each looks); they are filed under its Feature when it is recorded. */
  const [shots, setShots] = useState<string[]>([]);
  const [shotHeadings, setShotHeadings] = useState<(number | null)[]>([]);
  const [heading, setHeading] = useState<HeadingTarget | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [escTrip, setEscTrip] = useState<EscTrip | null>(null);
  const [lastRoom, setLastRoom] = useState('');
  /** The existing point under the crosshair, and the one the 정보 / 사진 sheets were opened for (the map cannot move while one is open). */
  const [snappedId, setSnappedId] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  /** An outline being drawn, and a point being moved. */
  const [draft, setDraft] = useState<Position[] | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  /** 강의실 자동 연결: the last door spot and the answers of the sheet (for the preview on the map). */
  const [stripLast, setStripLast] = useState<Position | null>(null);
  const [stripAnswer, setStripAnswer] = useState<StripAnswer>({ count: 5, startRef: '', refStep: 1, doorsPerRoom: 1 });
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
  // What was picked and is gone (undone, deleted) leaves the selection.
  useEffect(() => setSelection((s) => {
    const kept = stillThere(state, s);
    return kept.nodes.length === s.nodes.length && kept.edges.length === s.edges.length && kept.building === s.building ? s : kept;
  }), [state]);

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

  /** Directions (from north) of the edges that leave a point: drawn on the map to line the fan up with. */
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
  /** One action that is not a walk record; tells why when it cannot run. */
  const apply = (action: Parameters<SurveySession['edit']>[0] | { error: string }, done: string, to?: Scope, anchor?: string | null): boolean => {
    if ('error' in action) {
      notify(action.error, 'error');
      return false;
    }
    const result = session.edit(action, to, anchor);
    if ('error' in result) {
      notify(result.error, 'error');
      return false;
    }
    notify([done, ...result.warnings].join(' '));
    return true;
  };

  /** Look at another floor (or the outdoors), then show `next` (the sheet that needed a floor). */
  const pickScope = (to: Scope, next: Sheet = null): void => {
    session.moveTo(to);
    // The map's own re-fit is a second heavy redraw: it waits a frame so the sheet that follows can take touches at once.
    requestAnimationFrame(() => map.current?.show(to));
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
    if (apply(plan.action, plan.notices.join(' '))) setSheet(null);
  };
  const unsync = (ids: readonly string[]): void => {
    const plan = planUnsync(state, ids);
    if ('error' in plan) return notify(plan.error, 'error');
    if (apply(plan.action, `지점 ${plan.count}개의 층 연동을 해제했습니다. 다른 층의 지점은 그대로 연동되어 있습니다.`)) setSheet(null);
  };
  const putDown = (): void => {
    if (moving === null) return;
    const plan = planMoveNode(state, moving, crosshair());
    if ('error' in plan) return notify(plan.error, 'error');
    if (apply(plan.action, plan.moved > 1 ? `연동된 ${plan.moved}개 층의 지점을 같이 옮겼습니다.` : '지점을 옮겼습니다.')) setMoving(null);
  };

  // ---- 사진과 방향: a small fan on the map, the sheet underneath is put aside until it is saved ----

  const sensorHeading = (): number | null => (sensors.current.headingDeg === null ? null : wholeDegrees(sensors.current.headingDeg));
  /** Where the record being made is: the point the crosshair is on, else the crosshair. */
  const recordSpot = (): Position => (snappedId !== null && state.nodes[snappedId] ? state.nodes[snappedId]!.coord : crosshair());
  const openHeading = (at: Position, initial: number | null, guides: number[], onConfirm: (deg: number) => void): void => {
    setHeading({ at, deg: initial ?? 0, fromSensor: initial !== null, guides, onConfirm });
  };

  /** A picture was taken: its direction starts at the compass reading and the fan opens on the map to correct it. */
  const picked = (uri: string, target: CameraFor): void => {
    const initial = sensorHeading();
    setCamera(null);
    if (target.kind === 'record') {
      const index = shots.length;
      setShots((s) => [...s, uri]);
      setShotHeadings((h) => [...h, initial]);
      openHeading(recordSpot(), initial, guidesOf(snappedId), (deg) => {
        setShotHeadings((h) => h.map((x, i) => (i === index ? deg : x)));
        notify(`사진 ${index + 1} 방향을 ${deg}°로 정했습니다.`);
      });
      return;
    }
    const node = state.nodes[target.nodeId];
    if (!node) return;
    openHeading(node.coord, initial, guidesOf(node.id), (deg) => {
      const done = session.annotate(node.id, { access: node.props, photos: 1, photoHeadings: [deg] }, isoLocal(new Date()));
      if ('error' in done) return notify(done.error, 'error');
      void Promise.all(done.paths.map((path) => store.importFile(uri, `${SURVEY_DIR}/${path}`)))
        .catch((err: Error) => notify(`사진을 저장하지 못했습니다. ${err.message}`, 'error'));
      notify('사진을 저장했습니다.');
    });
  };
  /** Change the direction of the picture `index` taken for the record being made. */
  const editShot = (index: number): void => {
    openHeading(recordSpot(), shotHeadings[index] ?? null, guidesOf(snappedId), (deg) => setShotHeadings((h) => h.map((x, i) => (i === index ? deg : x))));
  };
  /** Change the direction of a photo already saved on a point. */
  const editSaved = (nodeId: string, path: string): void => {
    const node = state.nodes[nodeId];
    if (!node) return;
    openHeading(node.coord, session.attachments[nodeId]?.photo_meta?.[path]?.heading_deg ?? null, guidesOf(nodeId), (deg) => {
      if (session.setPhotoHeading(nodeId, path, deg)) notify(`사진 방향을 ${deg}°로 저장했습니다.`);
    });
  };
  const headingEdit: HeadingEdit | null = heading
    ? { at: heading.at, deg: heading.deg, guides: heading.guides, onChange: (deg) => setHeading((h) => (h ? { ...h, deg, fromSensor: false } : h)) }
    : null;

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
  /** Start a tool; the tools that need a floor say so. */
  const needFloor = (start: () => void) => (): void => {
    if (scope.kind === 'building') start();
    else notify('건물 안의 층에서 쓰는 도구입니다. 위쪽에서 건물과 층을 먼저 골라 주세요.', 'error');
  };
  const endTool = (): void => {
    setTool(null);
    setSelection(EMPTY_SELECTION);
    setStripLast(null);
  };

  /** 개방시간·폐쇄기간·개방조건, the note and the pictures of the point the crosshair is on. */
  const saveInfo = (node: EditNode, answer: { access: { hours: string; closed_period: string; access_condition: string }; note: string; stepFree?: boolean | null }): void => {
    // The sill is a property of the edges at the point: written with them, in the same 되돌리기.
    let extra: Parameters<SurveySession['edit']>[0] | undefined;
    if (answer.stepFree !== undefined) {
      const sill = planEdgeEdits(state, sillEdges(node.id), { stepFree: answer.stepFree });
      if (!('error' in sill)) extra = sill;
    }
    const done = session.annotate(node.id, { access: answer.access, note: answer.note, photos: shots.length, photoHeadings: shotHeadings, ...(extra ? { extra } : {}) }, isoLocal(new Date()));
    if ('error' in done) return notify(done.error, 'error');
    void Promise.all(done.paths.map((path, i) => store.importFile(shots[i]!, `${SURVEY_DIR}/${path}`)))
      .catch((err: Error) => notify(`사진을 저장하지 못했습니다. ${err.message}`, 'error'));
    notify(`${pointTitle(node)} 정보를 저장했습니다.`);
    closeSheet();
  };

  /** The edges at a point that can have a sill (not steps), and what they say when they all agree. */
  const sillEdges = (nodeId: string): string[] => Object.values(state.edges)
    .filter((e) => (e.props.from === nodeId || e.props.to === nodeId) && e.props.highway !== 'steps').map((e) => e.id);
  const sillOf = (nodeId: string): boolean | null | undefined => {
    const values = sillEdges(nodeId).map((id) => state.edges[id]!.props.step_free);
    return values.length > 0 && values.every((v) => v === values[0]) ? values[0] : undefined;
  };

  // ---- 선택 ----

  const selectedBuilding = selection.building !== null ? Object.values(state.buildings).find((b) => b.id === selection.building) : undefined;
  const selectedEdges = selection.edges.flatMap((id) => state.edges[id] ?? []);
  const onlyEscalator = selection.nodes.length === 0 && selection.edges.length === 1 && isEscalatorEdge(state, selection.edges[0]!) ? selection.edges[0]! : null;
  const editSelection = (): void => {
    if (selection.nodes.length === 1 && selection.edges.length === 0) {
      setInfoId(selection.nodes[0]!);
      setSheet('info');
    } else if (selection.nodes.length === 0 && selection.edges.length > 0) {
      setSheet('edgeProps');
    } else {
      notify('속성 편집은 지점 하나, 또는 구간만 골랐을 때 쓸 수 있습니다.', 'error');
    }
  };
  const deleteSelection = (): void => {
    const plan = planDeleteSelection(state, session.ctx, selection);
    if (apply(plan, `지점 ${selection.nodes.length}개, 구간 ${selection.edges.length}개를 지웠습니다. [되돌리기]로 되살릴 수 있습니다.`)) setSelection(EMPTY_SELECTION);
  };
  const selFloor = selectionSize(selection) > 0 && !selection.building ? selectionFloor(state, selection) : null;
  const copySelection = (levels: number[]): void => {
    if (!selFloor || 'error' in selFloor) return;
    const plan = planCopyFloor(state, session.ctx, selFloor.buildingId, selFloor.level, levels, new Set(selFloor.nodeIds));
    if ('error' in plan) return notify(plan.error, 'error');
    if (apply(plan.action, plan.notices.join(' '))) {
      setSheet(null);
      setSelection(EMPTY_SELECTION);
    }
  };
  const saveBuilding = (b: EditBuilding, form: { name: string; code: string; levels: number[] }): void => {
    const plan = planBuildingEdit(state, session.ctx, b.id, form);
    if ('error' in plan) return notify(plan.error, 'error');
    // Standing in that building: follow its new code, and leave a floor that is no longer there.
    let to: Scope = scope;
    if (scope.kind === 'building' && scope.buildingId === b.id) {
      to = form.levels.includes(scope.level) ? { ...scope, buildingId: plan.newId } : { kind: 'building', buildingId: plan.newId, level: form.levels[0]! };
    }
    if (apply(plan.action, '건물 정보를 저장했습니다.', to)) {
      setSelection({ nodes: [], edges: [], building: plan.newId });
      setSheet(null);
    }
  };
  const removeBuilding = (b: EditBuilding): void => {
    Alert.alert(`${b.props.name}을(를) 지울까요?`, '건물 안의 지점과 구간도 함께 지워집니다. [되돌리기]로 되살릴 수 있습니다.', [
      { text: '취소', style: 'cancel' },
      {
        text: '건물 삭제',
        style: 'destructive',
        onPress: () => {
          const inside = scope.kind === 'building' && scope.buildingId === b.id;
          if (apply(planDeleteBuilding(state, session.ctx, b.id), `${b.props.name}을(를) 지웠습니다.`, inside ? OUTDOOR : scope, inside ? null : anchorId)) {
            setSelection(EMPTY_SELECTION);
            setSheet(null);
          }
        },
      },
    ]);
  };

  // ---- 잇기 · 외부 길 ----

  const startLink = (outdoorOnly: boolean): void => {
    if (outdoorOnly && scope.kind !== 'outdoor') {
      session.moveTo(OUTDOOR);
      notify('바깥으로 바꿨습니다. 길이 시작하는 곳에 십자선을 맞춰 주세요.');
    }
    setTool({ kind: 'link', pathKind: 'flat', outdoorOnly });
  };
  const link = (): void => {
    if (tool?.kind !== 'link') return;
    record(planLink(input(), { stepFree: null, kind: scope.kind === 'outdoor' ? tool.pathKind : tool.pathKind === 'steps' ? 'flat' : tool.pathKind }));
  };

  // ---- 호실 연속 입력 ----

  const placeRunDoor = (back: boolean): void => {
    if (tool?.kind !== 'doorRun') return;
    const ref = back ? tool.run.lastRef : tool.run.nextRef.trim();
    if (ref === null || !isRoomRef(ref)) return notify('호실 번호를 먼저 입력해 주세요. 영문, 숫자, - 만 쓸 수 있습니다. 예: 301', 'error');
    if (!record(planDoor(input(), { roomRef: ref, doorRole: back ? 'back' : 'front' }))) return;
    if (!back) {
      setTool({ kind: 'doorRun', run: advanceRun(tool.run, ref) });
      setLastRoom(ref);
    }
  };

  // ---- 강의실 자동 연결 ----

  const stripInput = (a: StripAnswer): StripInput | null => (tool?.kind === 'strip' && tool.first && stripLast
    ? { corridorEdgeIds: tool.edges, first: tool.first, last: stripLast, count: a.count, startRef: a.startRef, refStep: a.refStep, doorsPerRoom: a.doorsPerRoom, source: surveySource(session.startedAt) }
    : null);
  const stripDoorsPreview = useMemo(() => {
    const s = sheet === 'strip' ? stripInput(stripAnswer) : null;
    if (!s) return [];
    const pv = stripPreview(state, s);
    return 'error' in pv ? [] : pv;
  }, [sheet, stripAnswer, tool, stripLast, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const layStrip = (a: StripAnswer): void => {
    const s = stripInput(a);
    if (!s) return;
    const plan = planStrip(state, session.ctx, s);
    if ('error' in plan) return notify(plan.error, 'error');
    if (apply(plan.action, `강의실 ${a.count}개의 문 ${plan.doors}개를 놓고 복도에 이었습니다.`)) {
      setSheet(null);
      endTool();
    }
  };

  // ---- the panel ----

  const indoor = scope.kind === 'building';
  const records: DockAction[] = [
    { id: 'start', label: '지점', hint: '십자선 자리에 지점 찍기(이미 있으면 그 지점에서 시작)', onPress: () => record(planStart(input())) },
    { id: 'link', label: '잇기', primary: true, hint: '지점과 지점을 구간으로 잇기', onPress: () => startLink(false) },
    { id: 'outdoor', label: '외부 길', disabled: indoor, hint: '바깥 길·계단·경사로 찍기', onPress: () => startLink(true) },
    { id: 'door', label: '문/호실', disabled: !indoor, onPress: () => setSheet('door') },
    { id: 'restroom', label: '화장실', disabled: !indoor, hint: '화장실 입구 찍기', onPress: needFloor(() => setSheet('restroom')) },
    { id: 'doorRun', label: '호실 연속', disabled: !indoor, hint: '번호가 저절로 올라가는 문 찍기', onPress: needFloor(() => setTool({ kind: 'doorRun', run: { nextRef: lastRoom === '' ? '' : nextRoomRef(lastRoom), step: 1, lastRef: null } })) },
    { id: 'floor', label: trip ? '도착 기록' : '계단/EV', ...(trip ? { hint: '층 이동 중입니다' } : {}), active: trip !== null, onPress: () => setSheet('floor') },
    { id: 'escalator', label: escTrip ? '에스컬 도착' : '에스컬레이터', ...(escTrip ? { hint: '에스컬레이터 이동 중입니다' } : {}), active: escTrip !== null, onPress: () => setSheet('escalator') },
    { id: 'portal', label: '출입구', hint: scope.kind === 'building' ? '밖으로 나가기' : '건물로 들어가기', onPress: () => setSheet('portal') },
  ];
  const tools: DockAction[] = [
    { id: 'select', label: '다중선택', hint: '여러 지점·구간을 연속으로 누르거나 끌어서 골라 복사·삭제', onPress: () => setTool({ kind: 'select' }) },
    { id: 'strip', label: '강의실 자동 연결', disabled: !indoor, hint: '복도를 따라 강의실 문을 한 번에 놓기', onPress: needFloor(() => setTool({ kind: 'strip', stage: 'corridor', edges: [], first: null })) },
    { id: 'osm', label: 'OSM 건물 가져오기', hint: '십자선 자리의 OSM 건물 가져오기', onPress: addOsmBuilding },
    { id: 'draw', label: '건물 그리기', hint: '외곽선을 점으로 찍어 건물 만들기', onPress: () => setDraft([]) },
    { id: 'copy', label: '층 복사·연동', disabled: !indoor, onPress: needFloor(() => setSheet('copy')) },
    { id: 'export', label: '내보내기', onPress: () => setSheet('export') },
    { id: 'settings', label: '설정', onPress: () => setSheet('settings') },
  ];
  const undoNow = (): void => { if (session.undo()) notify('되돌렸습니다. [복원]으로 다시 살릴 수 있습니다.'); };
  const redoNow = (): void => { if (session.redo()) notify('복원했습니다.'); };
  const undo: DockAction = { id: 'undo', label: '되돌리기', disabled: !session.canUndo, onPress: undoNow };
  const finish: DockAction = { id: 'end', label: '끝내기', tone: 'danger', onPress: endTool };

  const toolMode = (): DockMode | null => {
    if (!tool) return null;
    switch (tool.kind) {
      case 'link': {
        const from = anchorId !== null ? state.nodes[anchorId] : undefined;
        return {
          text: from ? `${pointTitle(from)}에서 잇습니다. 다음 지점에 십자선을 맞추고 [여기까지 잇기]를 눌러 주세요.` : '이을 첫 지점에 십자선을 맞추고 [여기서 시작]을 눌러 주세요.',
          extra: <LinkPanel outdoor={scope.kind === 'outdoor'} kind={tool.pathKind} onKind={(pathKind) => setTool({ ...tool, pathKind })} />,
          actions: [
            { id: 'link', label: from ? '여기까지 잇기' : '여기서 시작', primary: true, onPress: link },
            { id: 'cut', label: '끊고 새로 시작', disabled: !from, onPress: () => { session.moveTo(scope); notify('이어 가던 지점을 놓았습니다. 새로 시작할 지점을 찍어 주세요.'); } },
            undo,
            finish,
          ],
        };
      }
      case 'select': {
        const n = selectionSize(selection);
        const copyReady = selFloor !== null && !('error' in selFloor);
        return {
          text: n === 0 ? '지점·구간·건물 외곽선을 눌러 고르세요. 한 손가락으로 끌면 네모 안을 모두 고릅니다. 두 손가락으로 지도를 옮깁니다.'
            : selection.building ? `${selectedBuilding?.props.name ?? '건물'}을(를) 골랐습니다.`
            : `지점 ${selection.nodes.length}개, 구간 ${selection.edges.length}개를 골랐습니다. 다시 누르면 빠집니다.`,
          actions: selection.building ? [
            { id: 'bInfo', label: '건물 정보 편집', primary: true, onPress: () => setSheet('buildingInfo') },
            { id: 'clear', label: '선택 해제', onPress: () => setSelection(EMPTY_SELECTION) },
            finish,
          ] : [
            ...(onlyEscalator ? [{ id: 'timer', label: '시간 재기', primary: true, onPress: () => setTool({ kind: 'timer', edgeId: onlyEscalator, direction: rideDirections(state, onlyEscalator)[0]! }) } satisfies DockAction] : []),
            { id: 'props', label: '속성 편집', primary: !onlyEscalator, disabled: n === 0, onPress: editSelection },
            { id: 'copyTo', label: '다른 층에 복사', disabled: !copyReady, onPress: () => setSheet('copySelection') },
            { id: 'delete', label: '삭제', tone: 'danger', disabled: n === 0, onPress: deleteSelection },
            { id: 'clear', label: '선택 해제', disabled: n === 0, onPress: () => setSelection(EMPTY_SELECTION) },
            undo,
            { id: 'end', label: '끝내기', onPress: endTool },
          ],
        };
      }
      case 'timer': {
        const dirs = rideDirections(state, tool.edgeId);
        return {
          text: '에스컬레이터에 발을 올린 순간 [시작], 내린 순간 [정지]를 눌러 주세요. 잴 때마다 측정이 쌓여 예상 시간이 보정됩니다.',
          extra: (
            <StopwatchPanel
              directions={dirs.length > 1 ? [{ value: 'forward', label: '올라감' }, { value: 'backward', label: '내려감' }] : []}
              direction={tool.direction}
              onDirection={(direction) => setTool({ ...tool, direction })}
              stats={timingStats(state, tool.edgeId, tool.direction, session.timings)}
              onLap={(sec) => {
                const done = session.addTiming(tool.edgeId, sec, tool.direction, isoLocal(new Date()));
                if ('error' in done) notify(done.error, 'error');
                else notify(`${done.timing.duration_sec}초를 기록했습니다.`);
              }}
            />
          ),
          actions: [
            { id: 'back', label: '선택으로', onPress: () => setTool({ kind: 'select' }) },
            undo,
            finish,
          ],
        };
      }
      case 'doorRun': {
        const { run } = tool;
        return {
          text: '문 앞에 십자선을 맞추고 [문 찍기]를 누르면 번호가 저절로 올라갑니다. 문은 가까운 복도에 이어집니다.',
          extra: <DoorRunPanel nextRef={run.nextRef} step={run.step} onRef={(nextRef) => setTool({ kind: 'doorRun', run: { ...run, nextRef } })} onStep={(step) => setTool({ kind: 'doorRun', run: { ...run, step } })} />,
          actions: [
            { id: 'front', label: run.nextRef === '' ? '문 찍기' : `문 찍기 · ${run.nextRef}호`, primary: true, onPress: () => placeRunDoor(false) },
            { id: 'back', label: run.lastRef ? `뒷문 · ${run.lastRef}호` : '뒷문', disabled: run.lastRef === null, onPress: () => placeRunDoor(true) },
            undo,
            finish,
          ],
        };
      }
      case 'strip': {
        if (tool.stage === 'corridor') {
          return {
            text: `강의실이 붙은 복도에 십자선을 맞추고 [복도 고르기]를 눌러 주세요. 복도가 여러 구간이면 이어진 순서대로 고릅니다. (${tool.edges.length}개 고름)`,
            actions: [
              {
                id: 'pick', label: '복도 고르기', primary: true, onPress: () => {
                  const e = corridorAt(state, scope, crosshair());
                  if (!e) return notify('십자선 가까이에 복도가 없습니다. 복도 선 위에 맞춰 주세요.', 'error');
                  setTool({ ...tool, edges: tool.edges.includes(e.id) ? tool.edges.filter((x) => x !== e.id) : [...tool.edges, e.id] });
                },
              },
              { id: 'next', label: '다음: 첫 문', disabled: tool.edges.length === 0, onPress: () => setTool({ ...tool, stage: 'first' }) },
              { id: 'cancel', label: '취소', tone: 'danger', onPress: endTool },
            ],
          };
        }
        return {
          text: tool.stage === 'first' ? '첫 강의실의 문 자리에 십자선을 맞추고 [첫 문 여기]를 눌러 주세요.' : '마지막 강의실의 문 자리에 십자선을 맞추고 [마지막 문 여기]를 눌러 주세요.',
          actions: [
            tool.stage === 'first'
              ? { id: 'first', label: '첫 문 여기', primary: true, onPress: () => setTool({ ...tool, stage: 'last', first: crosshair() }) }
              : {
                  id: 'last', label: '마지막 문 여기', primary: true, onPress: () => {
                    setStripLast(crosshair());
                    setStripAnswer((a) => ({ ...a, startRef: a.startRef !== '' ? a.startRef : lastRoom !== '' ? nextRoomRef(lastRoom) : '' }));
                    setSheet('strip');
                  },
                },
            { id: 'back', label: '복도 다시 고르기', onPress: () => setTool({ ...tool, stage: 'corridor', first: null }) },
            { id: 'cancel', label: '취소', tone: 'danger', onPress: endTool },
          ],
        };
      }
    }
  };

  const mode: DockMode | null = heading
    ? {
      text: '손가락으로 지도 위 부채꼴을 돌려 사진이 바라보는 방향에 맞춰 주세요. 점선은 이 지점에서 뻗은 길입니다.',
      extra: <HeadingPanel deg={heading.deg} fromSensor={heading.fromSensor} onSet={(deg) => setHeading((h) => (h ? { ...h, deg: wholeDegrees(deg), fromSensor: false } : h))} onSensor={sensorHeading() === null ? null : () => setHeading((h) => (h ? { ...h, deg: sensorHeading() ?? h.deg, fromSensor: true } : h))} />,
      actions: [
        { id: 'save', label: `${heading.deg}°로 저장`, primary: true, onPress: () => { const h = heading; setHeading(null); h.onConfirm(h.deg); } },
        // Leaving keeps the heading the compass gave: the picture is not lost.
        { id: 'cancel', label: '그대로 두기', onPress: () => setHeading(null) },
      ],
    }
    : draft !== null
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
        : toolMode();

  /** The plain crosshair state: no tool, drawing, move, photo direction or sheet is in the way of a tap on a point. */
  const plain = tool === null && draft === null && moving === null && !heading && sheet === null;
  const mapMode: MapMode = heading ? 'heading' : tool?.kind === 'select' ? 'select' : 'pan';
  const marks = [
    ...(tool?.kind === 'strip' && tool.first ? [{ at: tool.first, tone: 'pin' as const }] : []),
    ...(tool?.kind === 'strip' && stripLast && tool.stage === 'last' ? [{ at: stripLast, tone: 'pin' as const }] : []),
    ...stripDoorsPreview.map((d) => ({ at: d.coord, tone: d.door_role === 'back' ? 'back' as const : 'door' as const })),
  ];
  const copyPoint = snapped ? { title: pointTitle(snapped), synced: snapped.props.sync_group !== undefined } : null;
  /** The sheet under a photo direction stays open but out of the way, so what was typed in it is kept. */
  const sheetHidden = heading !== null;

  return (
    <View style={styles.root}>
      <MapCanvas
        state={state} base={session.base} projection={proj} center={campus.center} scope={scope} anchorId={anchorId} handle={map} tileCache={tileCache}
        draft={draft} movingId={moving} onSnap={setSnappedId}
        mode={mapMode}
        selection={tool?.kind === 'select' || tool?.kind === 'timer' ? (tool.kind === 'timer' ? { nodes: [], edges: [tool.edgeId], building: null } : selection) : null}
        onTapHit={(hit) => {
          const next = toggled(selection, hit);
          setSelection(next);
          if (hit?.kind === 'building' && next.building) setSheet('buildingInfo');
        }}
        onBoxPick={(picked) => setSelection((s) => withBox(s, picked))}
        dragNodeId={tool?.kind === 'select' && selection && selection.nodes.length === 1 && selection.edges.length === 0 && !selection.building ? selection.nodes[0]! : null}
        onNodeMove={(id, coord) => {
          const plan = planMoveNode(state, id, coord);
          if ('error' in plan) notify(plan.error);
          else if (apply(plan.action, plan.moved > 1 ? `연동된 ${plan.moved}개 층의 지점을 같이 옮겼습니다.` : '지점을 옮겼습니다.')) setSelection(EMPTY_SELECTION);
        }}
        liftNodes={plain}
        onNodeTap={plain ? (id) => { setInfoId(id); setSheet('info'); } : undefined}
        heading={headingEdit}
        highlightEdges={tool?.kind === 'strip' ? tool.edges : undefined}
        marks={marks}
        bottomInset={dockHeight}
      />

      <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <View pointerEvents="box-none" style={styles.topRow}>
          <HistoryButtons canUndo={session.canUndo} canRedo={session.canRedo} onUndo={undoNow} onRedo={redoNow} />
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
        <SensorReadout into={sensors} reference={session.pressureReference} />
        {notice && (
          <View style={[styles.notice, notice.tone === 'error' && styles.noticeError]} accessibilityLiveRegion="polite" accessibilityRole="alert">
            <Text style={styles.noticeText}>{notice.text}</Text>
          </View>
        )}
      </View>

      {snapped && sheet === null && !camera && !heading && draft === null && moving === null && tool === null && (
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

      <ActionDock records={records} tools={tools} open={menuOpen} onToggle={() => setMenuOpen((o) => !o)} onClose={() => setMenuOpen(false)} mode={mode} onHeight={setDockHeight} />

      <View pointerEvents="box-none" style={sheetHidden ? styles.hidden : StyleSheet.absoluteFill}>
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
                setTrip({ ...next, coord: crosshair(), scope, anchorId, startAt: isoLocal(new Date()) });
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
                if (!record(plan, shots, { startHpa: trip.startHpa, endHpa, startAt: trip.startAt })) return;
                setTrip(null);
                closeSheet();
              }}
            />
          ) : (
            // Stairs and elevators are inside a building: pick the floor first, then the sheet comes back.
            <ScopeSheet scope={scope} buildings={buildingsNear} onClose={closeSheet} onPick={(to) => pickScope(to, to.kind === 'building' ? 'floor' : null)} />
          ))}
          {sheet === 'escalator' && (
            <EscalatorSheet
              scope={escTrip?.scope ?? scope}
              levels={here?.props.levels ?? []}
              trip={escTrip}
              onClose={() => setSheet(null)}
              onDepart={(next) => {
                setEscTrip({ ...next, coord: crosshair(), scope, anchorId, startAt: isoLocal(new Date()) });
                // Indoors the map turns to the floor ridden to, so the arrival snaps onto that floor's points; the view stays where it is.
                if (scope.kind === 'building' && next.toLevel !== null) session.moveTo({ ...scope, level: next.toLevel });
                setSheet(null);
                notify('내린 자리에 십자선을 맞추고 [에스컬 도착]을 눌러 주세요.');
              }}
              onCancelTrip={() => {
                if (escTrip) session.moveTo(escTrip.scope);
                setEscTrip(null);
                closeSheet();
              }}
              onArrive={({ endHpa }) => {
                if (!escTrip) return;
                const arriveScope: Scope = escTrip.scope.kind === 'building' && escTrip.toLevel !== null ? { ...escTrip.scope, level: escTrip.toLevel } : escTrip.scope;
                const from = { ...input(escTrip.coord), scope: escTrip.scope, anchorId: escTrip.anchorId !== null && escTrip.anchorId in state.nodes ? escTrip.anchorId : null };
                const plan = planEscalator(from, { arrive: { coord: crosshair(), scope: arriveScope }, rodeUp: escTrip.rodeUp, belt: escTrip.belt });
                if (!record(plan, [], { startHpa: escTrip.startHpa, endHpa, startAt: escTrip.startAt })) return;
                setEscTrip(null);
                closeSheet();
              }}
            />
          )}
          {sheet === 'restroom' && (
            <RestroomSheet
              {...photo} onClose={closeSheet}
              onRecord={(answer) => {
                if (record(planRestroom(input(), answer), shots)) closeSheet();
              }}
            />
          )}
          {sheet === 'portal' && (
            <PortalSheet
              scope={scope} buildings={buildingsNear} stepFree={null} {...photo} onClose={closeSheet}
              onRecord={(answer) => {
                if (record(planPortal(input(), answer), shots)) closeSheet();
              }}
            />
          )}
          {sheet === 'info' && infoNode && (
            <PointInfoSheet
              title={pointTitle(infoNode)}
              {...(sillEdges(infoNode.id).length > 0 ? { sill: { count: sillEdges(infoNode.id).length, value: sillOf(infoNode.id) } } : {})}
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
        {sheet === 'edgeProps' && selectedEdges.length > 0 && (
          <EdgePropsSheet
            edges={selectedEdges}
            onSave={(answer) => {
              if (apply(planEdgeEdits(state, selection.edges, answer), `구간 ${selectedEdges.length}개의 속성을 저장했습니다.`)) setSheet(null);
            }}
            onClose={() => setSheet(null)}
          />
        )}
        {sheet === 'copySelection' && selFloor && !('error' in selFloor) && (
          <CopySelectionSheet
            title={`선택한 지점 ${selFloor.nodeIds.length}개 복사`}
            levels={floorCopyTargets(state, selFloor.buildingId, selFloor.level)}
            onCopy={copySelection}
            onClose={() => setSheet(null)}
          />
        )}
        {sheet === 'buildingInfo' && selectedBuilding && (
          <BuildingInfoSheet
            key={selectedBuilding.id}
            building={selectedBuilding}
            onSave={(form) => saveBuilding(selectedBuilding, form)}
            onEnter={(level) => {
              endTool();
              pickScope({ kind: 'building', buildingId: selectedBuilding.id, level: selectedBuilding.props.levels.includes(level) ? level : defaultLevel(selectedBuilding) });
            }}
            onDelete={() => removeBuilding(selectedBuilding)}
            onClose={() => setSheet(null)}
          />
        )}
        {sheet === 'strip' && tool?.kind === 'strip' && (
          <StripSheet
            initial={stripAnswer}
            preview={(a) => {
              const s = stripInput(a);
              if (!s) return { error: '첫 문과 마지막 문을 먼저 찍어 주세요.' };
              const pv = stripPreview(state, s);
              return 'error' in pv ? pv : { doors: pv.length };
            }}
            onPreview={setStripAnswer}
            onLay={layStrip}
            onClose={() => setSheet(null)}
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
      </View>

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
  hidden: { display: 'none' },
  pressed: { opacity: 0.7 },
});
