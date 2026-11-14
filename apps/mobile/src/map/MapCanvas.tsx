// The survey map: campus data (building outlines, points, edges) drawn by the app itself, over OpenStreetMap tiles
// (tiles.ts) laid out in the same projection. The tiles are plain images under the drawing: without a network they simply
// do not appear and the map works as before; Google, Naver and Kakao maps are never involved (SPEC §3). The crosshair in
// the middle is where a record goes: the surveyor drags the map under it instead of aiming a finger at a small point.
//
// Gestures: one finger drags the map (in 선택 mode it taps or drags a box instead, and while a photo's direction is set it
// turns the fan); two fingers zoom and turn the map around the crosshair. The scale bar and the compass sit at the lower
// left; the compass shows where north is and a tap turns the map back to north.
//
// The map keeps its own view. Dragging re-renders this component only (the screen around it reads the crosshair through
// the handle when a record is made), and the drawn Features are redrawn only when the data, the floor or the zoom step changes.
import { buildingById, edgeCoords, isEscalator, type EditState, type Position } from '@campo/core';
import { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';
import { Image, PanResponder, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { nodeInScope, type Scope } from '../model/scope.ts';
import { SNAP_M } from '../survey/plans.ts';
import { hitAt, inBox, type Box, type Hit, type Selection } from '../survey/selection.ts';
import { dialHeading, fanPath, polar, touchAngle, wholeDegrees } from '../ui/dial.ts';
import { color, font, radius, space } from '../ui/theme.ts';
import {
  coverSide, fitView, fromScreen, mapMatrix, panned, rotated, rotationOf, scaleBar, shortestTurn, toScreen, withRotation, zoomed,
  type Projection, type Size, type View as MapView, type XY,
} from './project.ts';
import type { TileCache } from './tileCache.ts';
import { MIN_TILE_ZOOM, visibleTiles, type Tile } from './tiles.ts';

export interface MapHandle {
  /** The position under the crosshair. */
  crosshair(): Position;
  /** Move the view so that all of `scope` is visible (its points, and the building's outline indoors). The turn is kept. */
  show(scope: Scope): void;
}

/** What one finger does on the map. */
export type MapMode = 'pan' | 'select' | 'heading';

/** The direction of a photo being set on the map: a small fan on the point, turned by a finger. */
export interface HeadingEdit {
  /** The point the photo was taken at. */
  at: Position;
  deg: number;
  /** Directions (degrees from north) of the edges that leave the point, drawn dotted to line the fan up with. */
  guides: readonly number[];
  onChange: (deg: number) => void;
}

interface Props {
  state: EditState;
  /** The campus as bundled: what is not in it was recorded on this walk and is drawn in the accent colour. */
  base: EditState;
  projection: Projection;
  /** Where the crosshair is before the map has been laid out. */
  center: Position;
  scope: Scope;
  anchorId: string | null;
  handle: RefObject<MapHandle | null>;
  /** Tiles kept on the phone: shown from there, downloaded once. */
  tileCache: TileCache;
  /** An outline being drawn (건물 추가 → 직접 그리기): its corners so far. */
  draft?: readonly Position[] | null;
  /** A point being moved: drawn with a ring until it is put down. */
  movingId?: string | null;
  /** The existing point the crosshair is on (within SNAP_M), or null: its information can be edited there. */
  onSnap?: (nodeId: string | null) => void;
  mode?: MapMode;
  selection?: Selection | null;
  /** 선택 mode: a tap (what is under the finger, or null) and a dragged box (the points and edges inside). */
  onTapHit?: (hit: Hit | null) => void;
  onBoxPick?: (picked: { nodes: string[]; edges: string[] }) => void;
  /** 선택 mode: the one point that is the whole selection. Held down for a moment, it can be dragged; it is put down where the finger lifts. */
  dragNodeId?: string | null;
  onNodeMove?: (nodeId: string, coord: Position) => void;
  heading?: HeadingEdit | null;
  /** Edges drawn highlighted (the corridor a row of rooms will line). */
  highlightEdges?: readonly string[] | undefined;
  /** Spots drawn as small squares (where the doors of a row of rooms will go, the corners marked so far). */
  marks?: readonly { at: Position; tone: 'door' | 'back' | 'pin' }[];
  /** Space kept free at the bottom of the screen (the tool panel): the scale bar and compass sit just above it. */
  bottomInset?: number;
}

interface Touch {
  count: number;
  x: number;
  y: number;
  /** Distance between two fingers; 0 with one finger. */
  spread: number;
  /** Direction from the first finger to the second, degrees on the screen (clockwise); 0 with one finger. */
  angle: number;
}

function touchOf(e: GestureResponderEvent): Touch {
  const t = e.nativeEvent.touches;
  const [a, b] = [t[0], t[1]];
  if (a && b) {
    return {
      count: 2, x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2,
      spread: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY),
      angle: (Math.atan2(b.pageY - a.pageY, b.pageX - a.pageX) * 180) / Math.PI,
    };
  }
  return { count: a ? 1 : 0, x: a?.pageX ?? 0, y: a?.pageY ?? 0, spread: 0, angle: 0 };
}

/** Strokes and dots are sized for the nearest of these zoom steps, so a pinch redraws the Features a few times, not every frame. */
const ZOOM_STEP = 1.25;
const steppedScale = (scale: number): number => ZOOM_STEP ** Math.round(Math.log(scale) / Math.log(ZOOM_STEP));
/** Two fingers must turn this far before the map starts to turn, so a pinch does not tilt it by accident. */
const ROTATE_START_DEG = 10;
/** A touch that moves less than this and lifts quickly is a tap. */
const TAP_PX = 10;
const TAP_MS = 450;
/** A single selected point held this long (without moving) is picked up to be dragged. */
const HOLD_MS = 400;
/** The turn back to north takes this long. */
const NORTH_MS = 320;
/** Radius of the photo fan on the map, in pixels: small, so the map around the point stays visible. */
const FAN_PX = 64;

/** Map metres of a turned map, as screen pixels on a north-up layout: the tiles under the map are laid out unturned. */
const unturned = (v: MapView): MapView => ({ x: v.x, y: v.y, scale: v.scale });

export function MapCanvas({
  state, base, projection, center, scope, anchorId, handle, tileCache, draft = null, movingId = null, onSnap,
  mode = 'pan', selection = null, onTapHit, onBoxPick, dragNodeId = null, onNodeMove, heading = null, highlightEdges, marks, bottomInset = 0,
}: Props) {
  const [size, setSize] = useState<Size | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  /** Where a held point is being carried, in map metres; null when none is. */
  const [carry, setCarry] = useState<{ id: string; xy: XY } | null>(null);
  // The responder and the handle are made once; they read the newest values through refs.
  const latest = useRef({ view, size, state, scope, mode, heading, onTapHit, onBoxPick, dragNodeId, onNodeMove });
  latest.current = { view, size, state, scope, mode, heading, onTapHit, onBoxPick, dragNodeId, onNodeMove };

  /** A view that shows the scope, at the map's current turn. */
  const fit = (target: Scope, on: Size): MapView => {
    const now = latest.current.state;
    const points: XY[] = Object.values(now.nodes).filter((n) => nodeInScope(n, target)).map((n) => projection.toXY(n.coord));
    const b = target.kind === 'building' ? buildingById(now, target.buildingId) : undefined;
    for (const p of b?.polygon[0] ?? []) points.push(projection.toXY(p));
    return fitView(points, on, 48, latest.current.view ? rotationOf(latest.current.view) : 0);
  };

  useImperativeHandle(handle, () => ({
    crosshair: () => {
      const v = latest.current.view;
      return v ? projection.toPosition([v.x, v.y]) : center;
    },
    show: (target) => {
      const on = latest.current.size;
      if (on) setView(fit(target, on));
    },
    // `fit` only reads refs and the projection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [projection, center]);

  const onLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout;
    const next = { width, height };
    setSize(next);
    setView((v) => v ?? fit(latest.current.scope, next));
  };

  // ---- the turn back to north ----
  const animation = useRef<number | null>(null);
  const stopAnimation = (): void => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  };
  useEffect(() => stopAnimation, []);
  const turnNorth = (): void => {
    const v = latest.current.view;
    if (!v) return;
    stopAnimation();
    const from = rotationOf(v);
    const turn = shortestTurn(from, 0);
    if (turn === 0) return;
    const t0 = Date.now();
    const frame = (): void => {
      const k = Math.min(1, (Date.now() - t0) / NORTH_MS);
      const ease = 1 - (1 - k) ** 3;
      setView((cur) => (cur ? withRotation(cur, k >= 1 ? 0 : from + turn * ease) : cur));
      animation.current = k >= 1 ? null : requestAnimationFrame(frame);
    };
    animation.current = requestAnimationFrame(frame);
  };

  // ---- gestures ----
  const gesture = useRef({
    last: null as Touch | null, start: { x: 0, y: 0, at: 0 }, maxCount: 0, moved: 0, turn: 0, turning: false,
    fanStart: null as { angle: number; deg: number } | null,
    /** The press timer of a single selected point, and the point while it is being carried. */
    hold: null as ReturnType<typeof setTimeout> | null, carrying: null as string | null,
  });
  // Moves of the view are gathered here and applied at most once per frame: a setView on every touch event
  // overflows the update depth of React on a fast drag.
  const pending = useRef({ dx: 0, dy: 0, spread: 1, dTurn: 0, keepCentre: false, carry: null as { id: string; xy: XY } | null });
  const frame = useRef<number | null>(null);
  const clearPending = (): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pending.current = { dx: 0, dy: 0, spread: 1, dTurn: 0, keepCentre: false, carry: null };
  };
  const clearHold = (): void => {
    if (gesture.current.hold !== null) clearTimeout(gesture.current.hold);
    gesture.current.hold = null;
  };
  const flush = (): void => {
    frame.current = null;
    const p = pending.current;
    pending.current = { dx: 0, dy: 0, spread: 1, dTurn: 0, keepCentre: false, carry: null };
    if (p.carry) setCarry(p.carry);
    if (p.dx !== 0 || p.dy !== 0 || p.spread !== 1 || p.dTurn !== 0) {
      setView((cur) => {
        if (!cur) return cur;
        let next = p.keepCentre ? cur : panned(cur, p.dx, p.dy);
        if (p.spread !== 1) next = zoomed(next, p.spread);
        if (p.dTurn !== 0) next = rotated(next, p.dTurn);
        return next;
      });
    }
  };
  const schedule = (): void => {
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  };
  useEffect(() => () => {
    clearPending();
    clearHold();
  }, []);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      stopAnimation();
      const now = touchOf(e);
      clearHold();
      clearPending();
      gesture.current = { last: now, start: { x: now.x, y: now.y, at: Date.now() }, maxCount: now.count, moved: 0, turn: 0, turning: false, fanStart: null, hold: null, carrying: null };
      // A single selected point held down for a moment is picked up.
      const { mode: m, view: v, size: s, dragNodeId: only } = latest.current;
      if (m === 'select' && only && now.count === 1 && v && s) {
        const g = gesture.current;
        g.hold = setTimeout(() => {
          g.hold = null;
          const cur = latest.current;
          if (g.maxCount !== 1 || g.moved > TAP_PX || !cur.view || !cur.size || cur.dragNodeId !== only) return;
          const hit = hitAt({ state: cur.state, scope: cur.scope, projection, view: cur.view, size: cur.size }, [g.start.x, g.start.y]);
          if (hit?.kind !== 'node' || hit.id !== only) return;
          g.carrying = only;
          setBox(null);
          setCarry({ id: only, xy: fromScreen(cur.view, cur.size, [g.last?.x ?? g.start.x, g.last?.y ?? g.start.y]) });
        }, HOLD_MS);
      }
    },
    onPanResponderMove: (e) => {
      const g = gesture.current;
      const now = touchOf(e);
      const before = g.last;
      g.last = now;
      g.maxCount = Math.max(g.maxCount, now.count);
      g.moved = Math.max(g.moved, Math.hypot(now.x - g.start.x, now.y - g.start.y));
      // A finger was added or lifted: start measuring from here, or the map would jump.
      if (g.hold !== null && g.moved > TAP_PX) clearHold();
      if (!before || before.count !== now.count || now.count === 0) {
        g.fanStart = null;
        if (now.count !== 1) setBox(null);
        return;
      }
      const { mode: m, view: v, size: s, heading: h } = latest.current;
      if (g.carrying !== null) {
        // The point follows the finger; no box and no map pan while it is carried.
        if (now.count === 1 && v && s) {
          pending.current.carry = { id: g.carrying, xy: fromScreen(v, s, [now.x, now.y]) };
          schedule();
        }
        return;
      }
      if (now.count === 1 && g.maxCount === 1) {
        if (m === 'select') {
          if (g.moved > TAP_PX) setBox({ x0: g.start.x, y0: g.start.y, x1: now.x, y1: now.y });
          return;
        }
        if (m === 'heading' && h && v && s) {
          // The finger turns the fan round the point: map degrees = screen degrees + the map's turn.
          const [px, py] = toScreen(v, s, projection.toXY(h.at));
          const angle = touchAngle(now.x - px, now.y - py) + rotationOf(v);
          if (!g.fanStart) g.fanStart = { angle, deg: h.deg };
          h.onChange(wholeDegrees(dialHeading(g.fanStart.deg, g.fanStart.angle, angle)));
          return;
        }
        pending.current.dx += now.x - before.x;
        pending.current.dy += now.y - before.y;
        schedule();
        return;
      }
      if (now.count !== 2) return;
      const spread = before.spread > 0 && now.spread > 0 ? now.spread / before.spread : 1;
      let dTurn = now.angle - before.angle;
      if (dTurn > 180) dTurn -= 360;
      if (dTurn < -180) dTurn += 360;
      g.turn += dTurn;
      if (!g.turning && Math.abs(g.turn) >= ROTATE_START_DEG) g.turning = true;
      const p = pending.current;
      p.keepCentre = m === 'heading'; // the photo's point stays put while its direction is set
      if (!p.keepCentre) {
        p.dx += now.x - before.x;
        p.dy += now.y - before.y;
      }
      p.spread *= spread;
      if (g.turning) p.dTurn += dTurn;
      schedule();
    },
    onPanResponderRelease: () => {
      const g = gesture.current;
      const { mode: m, view: v, size: s, state: st, scope: sc, onTapHit: tap, onBoxPick: pick, onNodeMove: put } = latest.current;
      const quick = Date.now() - g.start.at <= TAP_MS;
      clearHold();
      // A carried point is put down where it was last drawn (or where the finger last was).
      const dropped = g.carrying !== null && v && s && g.last ? { id: g.carrying, xy: pending.current.carry?.xy ?? fromScreen(v, s, [g.last.x, g.last.y]) } : null;
      clearPending();
      g.carrying = null;
      if (dropped) {
        setCarry(null);
        setBox(null);
        g.last = null;
        put?.(dropped.id, projection.toPosition(dropped.xy));
        return;
      }
      if (m === 'select' && v && s && g.maxCount === 1) {
        if (g.moved <= TAP_PX && quick) tap?.(hitAt({ state: st, scope: sc, projection, view: v, size: s }, [g.start.x, g.start.y]));
        else if (g.last && g.moved > TAP_PX) pick?.(inBox({ state: st, scope: sc, projection, view: v, size: s }, { x0: g.start.x, y0: g.start.y, x1: g.last.x, y1: g.last.y }));
      }
      setBox(null);
      g.last = null;
    },
    onPanResponderTerminate: () => {
      clearHold();
      clearPending();
      gesture.current.carrying = null;
      gesture.current.last = null;
      setCarry(null);
      setBox(null);
    },
    // The responder reads everything through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [projection]);

  // The points a record could take, in map metres: found once per floor, searched on every frame of a drag.
  const points = useMemo(
    () => Object.values(state.nodes).filter((n) => nodeInScope(n, scope)).map((n) => ({ id: n.id, xy: projection.toXY(n.coord) })),
    [state.nodes, scope, projection],
  );
  const snap = useMemo(() => {
    if (!view) return null;
    let best: { id: string; xy: XY } | null = null;
    let bestSq = SNAP_M * SNAP_M;
    for (const p of points) {
      const sq = (p.xy[0] - view.x) ** 2 + (p.xy[1] - view.y) ** 2;
      if (sq <= bestSq) {
        best = p;
        bestSq = sq;
      }
    }
    return best;
  }, [points, view]);
  const anchor = useMemo(() => points.find((p) => p.id === anchorId) ?? null, [points, anchorId]);
  const snapId = snap?.id ?? null;
  const onSnapRef = useRef(onSnap);
  onSnapRef.current = onSnap;
  useEffect(() => onSnapRef.current?.(snapId), [snapId]);

  // Tiles the server could not give (no network, no tile there) are left out: the plain background shows instead.
  // They are laid out north-up on a square that covers the screen at any turn, and the square is turned with the map.
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const cover = size ? coverSide(size) : 0;
  const coverSize = useMemo(() => ({ width: cover, height: cover }), [cover]);
  const flat = view ? unturned(view) : null;
  const tiles = useMemo(() => (size && flat ? visibleTiles(flat, coverSize, projection) : []), [size, flat?.x, flat?.y, flat?.scale, coverSize, projection]); // eslint-disable-line react-hooks/exhaustive-deps
  // No white flash when the zoom step changes: the tiles of the zoom that was last fully drawn stay underneath (stretched
  // or shrunk by the same projection) until the new ones have loaded; before any has, the next coarser zoom is the floor.
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
  const [settledZ, setSettledZ] = useState<number | null>(null);
  const z = tiles[0] ? Number(tiles[0].key.split('/')[0]) : null;
  useEffect(() => {
    if (z !== null && tiles.every((t) => loaded.has(t.key) || failed.has(t.key))) setSettledZ(z);
  }, [z, tiles, loaded, failed]);
  const baseZ = settledZ !== null && z !== null && settledZ !== z ? settledZ : z !== null && z > MIN_TILE_ZOOM ? z - 1 : null;
  const baseTiles = useMemo(() => (size && flat && baseZ !== null ? visibleTiles(flat, coverSize, projection, baseZ) : []), [size, flat?.x, flat?.y, flat?.scale, coverSize, projection, baseZ]); // eslint-disable-line react-hooks/exhaustive-deps
  const onLoad = useCallback((key: string) => setLoaded((old) => (old.has(key) ? old : new Set(old).add(key))), []);
  const onFail = useCallback((key: string) => setFailed((old) => (old.has(key) ? old : new Set(old).add(key))), []);

  const turn = view ? rotationOf(view) : 0;
  const hint = mode === 'select' ? '선택 지도. 눌러서 고르고, 끌어서 여러 개를 고릅니다. 두 손가락으로 옮기고 확대하고 돌립니다.'
    : mode === 'heading' ? '사진 방향 지도. 한 손가락으로 부채꼴을 돌립니다.'
    : '조사 지도. 끌어서 옮기고 두 손가락으로 확대하거나 돌립니다.';

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} {...responder.panHandlers} accessibilityLabel={hint}>
      {size && view && (
        <>
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: (size.width - cover) / 2, top: (size.height - cover) / 2, width: cover, height: cover, transform: [{ rotate: `${-turn}deg` }] }}
          >
            {baseTiles.map((t) => !failed.has(t.key) && <TileImage key={t.key} tile={t} cache={tileCache} onLoad={onLoad} onFail={onFail} />)}
            {tiles.map((t) => !failed.has(t.key) && <TileImage key={t.key} tile={t} cache={tileCache} onLoad={onLoad} onFail={onFail} />)}
          </View>
          <Svg width={size.width} height={size.height} pointerEvents="none">
            {/* Metres → pixels: x east, y north, turned around the crosshair (project.ts mapMatrix). */}
            <G transform={`matrix(${mapMatrix(view, size).join(' ')})`}>
              <Features state={state} base={base} projection={projection} scope={scope} px={1 / steppedScale(view.scale)} />
              <Highlights state={state} projection={projection} selection={selection} edges={highlightEdges} px={1 / view.scale} />
              {draft && draft.length > 0 && <Draft points={draft.map((p) => projection.toXY(p))} px={1 / view.scale} />}
              {marks?.map((m, i) => {
                const [x, y] = projection.toXY(m.at);
                const r = (m.tone === 'pin' ? 6 : 5) / view.scale;
                return <Rect key={i} x={x - r} y={y - r} width={2 * r} height={2 * r} fill={m.tone === 'back' ? color.surface : color.accent} stroke={color.accent} strokeWidth={2 / view.scale} />;
              })}
              {movingId && state.nodes[movingId] && (() => { const [x, y] = projection.toXY(state.nodes[movingId]!.coord); return <Circle cx={x} cy={y} r={17 / view.scale} fill="none" stroke={color.accent} strokeWidth={3 / view.scale} strokeDasharray={[4 / view.scale, 3 / view.scale]} />; })()}
              {carry && (
                <>
                  <Circle cx={carry.xy[0]} cy={carry.xy[1]} r={17 / view.scale} fill={color.accent} fillOpacity={0.25} stroke={color.accent} strokeWidth={3 / view.scale} />
                  <Circle cx={carry.xy[0]} cy={carry.xy[1]} r={5 / view.scale} fill={color.accent} stroke={color.surface} strokeWidth={1.5 / view.scale} />
                </>
              )}
              {anchor && <Circle cx={anchor.xy[0]} cy={anchor.xy[1]} r={15 / view.scale} fill="none" stroke={color.anchor} strokeWidth={3.5 / view.scale} />}
              {snap && snap.id !== anchorId && mode !== 'select' && <Circle cx={snap.xy[0]} cy={snap.xy[1]} r={13 / view.scale} fill="none" stroke={color.ok} strokeWidth={3 / view.scale} />}
            </G>
            {heading && <Fan at={toScreen(view, size, projection.toXY(heading.at))} deg={heading.deg} guides={heading.guides} turn={turn} />}
            {box && <Rect x={Math.min(box.x0, box.x1)} y={Math.min(box.y0, box.y1)} width={Math.abs(box.x1 - box.x0)} height={Math.abs(box.y1 - box.y0)} fill={color.primary} fillOpacity={0.12} stroke={color.primary} strokeWidth={1.5} strokeDasharray="6 4" />}
          </Svg>
          {mode !== 'select' && <Crosshair size={size} snapped={snap !== null} />}
          <ScaleAndCompass scale={view.scale} turn={turn} bottom={bottomInset + space.md} onNorth={turnNorth} />
        </>
      )}
    </View>
  );
}

interface FeaturesProps {
  state: EditState;
  base: EditState;
  projection: Projection;
  scope: Scope;
  /** Metres per screen pixel (at the zoom step), so strokes and dots keep about their size on screen. */
  px: number;
}

const pointsOf = (projection: Projection, coords: readonly Position[]): string => coords.map((p) => projection.toXY(p).join(',')).join(' ');

/** Redrawn only when the data, the floor or the zoom step changes: dragging the map just moves the group around it. */
const Features = memo(function Features({ state, base, projection, scope, px }: FeaturesProps) {
  const here = scope.kind === 'building' ? scope.buildingId : null;
  const inScope = (id: string): boolean => {
    const n = state.nodes[id];
    return n !== undefined && nodeInScope(n, scope);
  };
  const outdoors = (id: string): boolean => state.nodes[id]?.props.building_id === null;

  const buildings = Object.values(state.buildings).map((b) => (
    <Polygon
      key={b.id}
      points={pointsOf(projection, b.polygon[0] ?? [])}
      fill={b.id === here ? color.buildingHere : color.building}
      fillOpacity={b.id === here ? 0.9 : 0.7}
      stroke={color.buildingLine}
      strokeWidth={(b.id === here ? 2.5 : 1.2) * px}
    />
  ));

  const edges = Object.values(state.edges).flatMap((e) => {
    const { from, to } = e.props;
    // This floor's (or the outdoors') edges are drawn strongly; outdoor paths stay faintly visible from inside for orientation.
    const strong = inScope(from) || inScope(to);
    if (!strong && !(outdoors(from) && outdoors(to))) return [];
    const made = !(e.id in base.edges);
    const belt = isEscalator(e.props);
    return [(
      <Polyline
        key={e.id}
        points={pointsOf(projection, edgeCoords(state, e))}
        fill="none"
        stroke={belt ? color.escalator : made ? color.made : strong ? color.edge : color.edgeFaint}
        strokeWidth={(strong ? 4 : 2) * px}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...(belt ? { strokeDasharray: [3 * px, 3 * px] } : e.props.highway === 'steps' ? { strokeDasharray: [6 * px, 5 * px] } : {})}
      />
    )];
  });

  const nodes = Object.values(state.nodes).flatMap((n) => {
    if (!nodeInScope(n, scope)) return [];
    const [x, y] = projection.toXY(n.coord);
    const walkPoint = n.props.node_type === 'corridor' || n.props.node_type === 'outdoor';
    return [(
      <Circle key={n.id} cx={x} cy={y} r={(walkPoint ? 5 : 7.5) * px} fill={n.id in base.nodes ? color.node : color.made} stroke={color.surface} strokeWidth={1.5 * px} />
    )];
  });

  return (
    <>
      {buildings}
      {edges}
      {nodes}
    </>
  );
});

/** The selection (and the corridor a row of rooms will line), drawn over the Features. */
function Highlights({ state, projection, selection, edges, px }: { state: EditState; projection: Projection; selection: Selection | null; edges?: readonly string[] | undefined; px: number }) {
  const lines = [...(selection?.edges ?? []), ...(edges ?? [])];
  const b = selection?.building ? Object.values(state.buildings).find((x) => x.id === selection.building) : undefined;
  return (
    <>
      {b && <Polygon points={pointsOf(projection, b.polygon[0] ?? [])} fill={color.primary} fillOpacity={0.12} stroke={color.primary} strokeWidth={3.5 * px} />}
      {lines.map((id, i) => {
        const e = state.edges[id];
        return e ? <Polyline key={`${id}-${i}`} points={pointsOf(projection, edgeCoords(state, e))} fill="none" stroke={color.primary} strokeOpacity={0.55} strokeWidth={10 * px} strokeLinecap="round" strokeLinejoin="round" /> : null;
      })}
      {(selection?.nodes ?? []).map((id) => {
        const n = state.nodes[id];
        if (!n) return null;
        const [x, y] = projection.toXY(n.coord);
        return <Circle key={id} cx={x} cy={y} r={12 * px} fill={color.primary} fillOpacity={0.2} stroke={color.primary} strokeWidth={3 * px} />;
      })}
    </>
  );
}

/** The outline being drawn: the corners as dots, joined by a line, with the closing edge dashed. */
const Draft = memo(function Draft({ points, px }: { points: readonly XY[]; px: number }) {
  const line = points.map((p) => p.join(',')).join(' ');
  return (
    <>
      {points.length >= 3 && <Polygon points={line} fill={color.accent} fillOpacity={0.15} stroke={color.accent} strokeWidth={2.5 * px} strokeDasharray={[6 * px, 4 * px]} />}
      <Polyline points={line} fill="none" stroke={color.accent} strokeWidth={2.5 * px} strokeLinejoin="round" />
      {points.map((p, i) => <Circle key={i} cx={p[0]} cy={p[1]} r={5 * px} fill={color.accent} stroke={color.surface} strokeWidth={1.5 * px} />)}
    </>
  );
});

/** The photo's view as a small fan on its point, in screen pixels: map degrees minus the map's turn. */
function Fan({ at, deg, guides, turn }: { at: XY; deg: number; guides: readonly number[]; turn: number }) {
  const [cx, cy] = at;
  const [hx, hy] = polar(cx, cy, FAN_PX, deg - turn);
  const [nx, ny] = polar(cx, cy, FAN_PX + 12, -turn);
  return (
    <>
      <Circle cx={cx} cy={cy} r={FAN_PX} fill={color.surface} fillOpacity={0.35} stroke={color.surface} strokeWidth={1.5} />
      {guides.map((g) => {
        const [x, y] = polar(cx, cy, FAN_PX, g - turn);
        return <Line key={g} x1={cx} y1={cy} x2={x} y2={y} stroke={color.ink} strokeWidth={2} strokeDasharray="4 4" />;
      })}
      <Path d={fanPath(cx, cy, FAN_PX, deg - turn)} fill={color.accent} fillOpacity={0.35} stroke={color.accent} strokeWidth={2} />
      <Line x1={cx} y1={cy} x2={hx} y2={hy} stroke={color.accent} strokeWidth={3.5} strokeLinecap="round" />
      <SvgText x={nx} y={ny + 4} fontSize={12} fontWeight="800" fill={color.danger} textAnchor="middle">N</SvgText>
      <Circle cx={cx} cy={cy} r={5} fill={color.ink} stroke={color.surface} strokeWidth={2} />
    </>
  );
}

/** Lower left: a scale bar in metres and a compass that shows where north is; a tap on it turns the map back to north. */
function ScaleAndCompass({ scale, turn, bottom, onNorth }: { scale: number; turn: number; bottom: number; onNorth: () => void }) {
  const bar = scaleBar(scale);
  const north = Math.round(turn) % 360 === 0;
  return (
    <View pointerEvents="box-none" style={[styles.corner, { bottom }]}>
      <Pressable
        onPress={onNorth}
        accessibilityRole="button"
        accessibilityLabel={north ? '나침반. 지도 위쪽이 북쪽입니다' : `나침반. 지도가 ${Math.round(turn)}도 돌아가 있습니다. 눌러서 북쪽을 위로`}
        style={({ pressed }) => [styles.compass, pressed && { opacity: 0.7 }]}
        hitSlop={6}
      >
        <Svg width={34} height={34}>
          <G transform={`rotate(${-turn} 17 17)`}>
            <Path d="M17 4 L22 17 L12 17 Z" fill={color.danger} />
            <Path d="M17 30 L22 17 L12 17 Z" fill={color.inkSoft} />
          </G>
          <Circle cx={17} cy={17} r={2.2} fill={color.surface} />
        </Svg>
      </Pressable>
      <View style={styles.scale} accessibilityLabel={`축척 ${bar.label}`}>
        <Text style={styles.scaleLabel}>{bar.label}</Text>
        <View style={[styles.scaleBar, { width: bar.px }]} />
      </View>
    </View>
  );
}

/** One background tile, from the phone's cache (downloaded into it the first time). It takes no touches and reports a failure once. */
const TileImage = memo(function TileImage({ tile, cache, onLoad, onFail }: { tile: Tile; cache: TileCache; onLoad: (key: string) => void; onFail: (key: string) => void }) {
  const id = useMemo(() => {
    const [z, x, y] = tile.key.split('/').map(Number) as [number, number, number];
    return { z, x, y };
  }, [tile.key]);
  const [uri, setUri] = useState<string | null>(() => cache.cached(id));
  useEffect(() => {
    if (uri !== null) return undefined;
    let live = true;
    cache.get(id).then((u) => live && setUri(u), () => live && onFail(tile.key));
    return () => {
      live = false;
    };
  }, [cache, id, tile.key, uri, onFail]);
  if (uri === null) return null;
  return (
    <Image
      source={{ uri }}
      fadeDuration={0}
      onLoad={() => onLoad(tile.key)}
      onError={() => onFail(tile.key)}
      style={{ position: 'absolute', left: tile.left, top: tile.top, width: tile.width, height: tile.height }}
    />
  );
}, (a, b) => a.tile.key === b.tile.key && a.tile.left === b.tile.left && a.tile.top === b.tile.top && a.tile.width === b.tile.width && a.cache === b.cache);

const Crosshair = memo(function Crosshair({ size, snapped }: { size: Size; snapped: boolean }) {
  const [cx, cy] = [size.width / 2, size.height / 2];
  const stroke = snapped ? color.ok : color.accent;
  return (
    <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Circle cx={cx} cy={cy} r={18} fill="none" stroke={color.surface} strokeWidth={5} />
      <Circle cx={cx} cy={cy} r={18} fill="none" stroke={stroke} strokeWidth={2.5} />
      <Line x1={cx - 30} y1={cy} x2={cx - 8} y2={cy} stroke={stroke} strokeWidth={2.5} />
      <Line x1={cx + 8} y1={cy} x2={cx + 30} y2={cy} stroke={stroke} strokeWidth={2.5} />
      <Line x1={cx} y1={cy - 30} x2={cx} y2={cy - 8} stroke={stroke} strokeWidth={2.5} />
      <Line x1={cx} y1={cy + 8} x2={cx} y2={cy + 30} stroke={stroke} strokeWidth={2.5} />
      <Circle cx={cx} cy={cy} r={2.5} fill={stroke} />
    </Svg>
  );
});

const styles = StyleSheet.create({
  corner: { position: 'absolute', left: space.md, flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  compass: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1, borderColor: color.line, elevation: 3, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
  },
  scale: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.85)' },
  scaleLabel: { fontSize: font.small - 1, fontWeight: '700', color: color.ink, fontVariant: ['tabular-nums'] },
  scaleBar: { height: 5, marginTop: 2, borderWidth: 1.5, borderTopWidth: 0, borderColor: color.ink },
});
