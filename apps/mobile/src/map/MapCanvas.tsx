// The survey map: campus data (building outlines, points, edges) drawn by the app itself, over OpenStreetMap tiles
// (tiles.ts) laid out in the same projection. The tiles are plain images under the drawing: without a network they simply
// do not appear and the map works as before; Google, Naver and Kakao maps are never involved (SPEC §3). The crosshair in
// the middle is where a record goes: the surveyor drags the map under it instead of aiming a finger at a small point.
//
// The map keeps its own view. Dragging re-renders this component only (the screen around it reads the crosshair through
// the handle when a record is made), and the drawn Features are redrawn only when the data, the floor or the zoom step changes.
import { buildingById, edgeCoords, type EditState, type Position } from '@campo/core';
import { memo, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';
import { Image, PanResponder, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Polygon, Polyline } from 'react-native-svg';
import { nodeInScope, type Scope } from '../model/scope.ts';
import { SNAP_M } from '../survey/plans.ts';
import { color } from '../ui/theme.ts';
import { fitView, panned, zoomed, type Projection, type Size, type View as MapView, type XY } from './project.ts';
import { TILE_HEADERS, visibleTiles, type Tile } from './tiles.ts';

export interface MapHandle {
  /** The position under the crosshair. */
  crosshair(): Position;
  /** Move the view so that all of `scope` is visible (its points, and the building's outline indoors). */
  show(scope: Scope): void;
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
  /** The existing point the crosshair is on (within SNAP_M), or null: its information can be edited there. */
  onSnap?: (nodeId: string | null) => void;
}

interface Touch {
  count: number;
  x: number;
  y: number;
  /** Distance between two fingers; 0 with one finger. */
  spread: number;
}

function touchOf(e: GestureResponderEvent): Touch {
  const t = e.nativeEvent.touches;
  const [a, b] = [t[0], t[1]];
  if (a && b) return { count: 2, x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2, spread: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) };
  return { count: a ? 1 : 0, x: a?.pageX ?? 0, y: a?.pageY ?? 0, spread: 0 };
}

/** Strokes and dots are sized for the nearest of these zoom steps, so a pinch redraws the Features a few times, not every frame. */
const ZOOM_STEP = 1.25;
const steppedScale = (scale: number): number => ZOOM_STEP ** Math.round(Math.log(scale) / Math.log(ZOOM_STEP));

export function MapCanvas({ state, base, projection, center, scope, anchorId, handle, onSnap }: Props) {
  const [size, setSize] = useState<Size | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  // The responder and the handle are made once; they read the newest values through refs.
  const latest = useRef({ view, size, state, scope });
  latest.current = { view, size, state, scope };

  /** A view that shows the scope. */
  const fit = (target: Scope, on: Size): MapView => {
    const now = latest.current.state;
    const points: XY[] = Object.values(now.nodes).filter((n) => nodeInScope(n, target)).map((n) => projection.toXY(n.coord));
    const b = target.kind === 'building' ? buildingById(now, target.buildingId) : undefined;
    for (const p of b?.polygon[0] ?? []) points.push(projection.toXY(p));
    return fitView(points, on);
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

  const last = useRef<Touch | null>(null);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      last.current = touchOf(e);
    },
    onPanResponderMove: (e) => {
      const now = touchOf(e);
      const before = last.current;
      last.current = now;
      // A finger was added or lifted: start measuring from here, or the map would jump.
      if (!before || before.count !== now.count || now.count === 0) return;
      const spread = now.count === 2 && before.spread > 0 && now.spread > 0 ? now.spread / before.spread : 1;
      setView((v) => (v ? zoomed(panned(v, now.x - before.x, now.y - before.y), spread) : v));
    },
    onPanResponderRelease: () => {
      last.current = null;
    },
    onPanResponderTerminate: () => {
      last.current = null;
    },
  }), []);

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
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const tiles = useMemo(() => (size && view ? visibleTiles(view, size, projection) : []), [size, view, projection]);

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} {...responder.panHandlers} accessibilityLabel="조사 지도. 끌어서 옮기고 두 손가락으로 확대합니다.">
      {size && view && (
        <>
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {tiles.map((t) => !failed.has(t.key) && (
              <TileImage key={t.key} tile={t} onFail={(key) => setFailed((old) => (old.has(key) ? old : new Set(old).add(key)))} />
            ))}
          </View>
          <Svg width={size.width} height={size.height}>
            {/* Metres → pixels: x east to the right, y north upwards. */}
            <G transform={`matrix(${view.scale} 0 0 ${-view.scale} ${size.width / 2 - view.x * view.scale} ${size.height / 2 + view.y * view.scale})`}>
              <Features state={state} base={base} projection={projection} scope={scope} px={1 / steppedScale(view.scale)} />
              {anchor && <Circle cx={anchor.xy[0]} cy={anchor.xy[1]} r={15 / view.scale} fill="none" stroke={color.anchor} strokeWidth={3.5 / view.scale} />}
              {snap && snap.id !== anchorId && <Circle cx={snap.xy[0]} cy={snap.xy[1]} r={13 / view.scale} fill="none" stroke={color.ok} strokeWidth={3 / view.scale} />}
            </G>
          </Svg>
          <Crosshair size={size} snapped={snap !== null} />
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
    return [(
      <Polyline
        key={e.id}
        points={pointsOf(projection, edgeCoords(state, e))}
        fill="none"
        stroke={made ? color.made : strong ? color.edge : color.edgeFaint}
        strokeWidth={(strong ? 4 : 2) * px}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...(e.props.highway === 'steps' ? { strokeDasharray: [6 * px, 5 * px] } : {})}
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

/** One background tile. It takes no touches, fades in nothing, and reports a failed download once. */
const TileImage = memo(function TileImage({ tile, onFail }: { tile: Tile; onFail: (key: string) => void }) {
  return (
    <Image
      source={{ uri: tile.url, headers: TILE_HEADERS }}
      fadeDuration={0}
      onError={() => onFail(tile.key)}
      style={{ position: 'absolute', left: tile.left, top: tile.top, width: tile.width, height: tile.height }}
    />
  );
}, (a, b) => a.tile.key === b.tile.key && a.tile.left === b.tile.left && a.tile.top === b.tile.top && a.tile.width === b.tile.width);

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
