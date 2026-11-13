// The survey map: only campus data (building outlines, points, edges), drawn by the app itself. No background tiles, so it
// works without a network and no third-party map is involved. The crosshair in the middle is where a record goes:
// the surveyor drags the map under it instead of aiming a finger at a small point.
import { edgeCoords, type EditState } from '@campo/core';
import { memo, useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, G, Line, Polygon, Polyline } from 'react-native-svg';
import { nodeInScope, type Scope } from '../model/scope.ts';
import { color } from '../ui/theme.ts';
import { panned, zoomed, type Projection, type Size, type View as MapView } from './project.ts';

interface Props {
  state: EditState;
  /** The campus as bundled: what is not in it was recorded on this walk and is drawn in the accent colour. */
  base: EditState;
  projection: Projection;
  scope: Scope;
  view: MapView;
  size: Size;
  anchorId: string | null;
  /** The existing point a record at the crosshair would take, if any. */
  snapId: string | null;
  onViewChange: (view: MapView) => void;
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

export function MapCanvas({ state, base, projection, scope, view, size, anchorId, snapId, onViewChange }: Props) {
  // The responder is made once; it reads the newest view and callback through refs.
  const viewRef = useRef(view);
  viewRef.current = view;
  const changeRef = useRef(onViewChange);
  changeRef.current = onViewChange;
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
      let next = panned(viewRef.current, now.x - before.x, now.y - before.y);
      if (now.count === 2 && before.spread > 0 && now.spread > 0) next = zoomed(next, now.spread / before.spread);
      changeRef.current(next);
    },
    onPanResponderRelease: () => {
      last.current = null;
    },
    onPanResponderTerminate: () => {
      last.current = null;
    },
  }), []);

  // Metres → pixels: x east to the right, y north upwards.
  const matrix = `matrix(${view.scale} 0 0 ${-view.scale} ${size.width / 2 - view.x * view.scale} ${size.height / 2 + view.y * view.scale})`;

  return (
    <View style={StyleSheet.absoluteFill} {...responder.panHandlers} accessibilityLabel="조사 지도. 끌어서 옮기고 두 손가락으로 확대합니다.">
      <Svg width={size.width} height={size.height}>
        <G transform={matrix}>
          <Features state={state} base={base} projection={projection} scope={scope} anchorId={anchorId} snapId={snapId} px={1 / view.scale} />
        </G>
      </Svg>
      <Crosshair size={size} snapped={snapId !== null} />
    </View>
  );
}

interface FeaturesProps {
  state: EditState;
  base: EditState;
  projection: Projection;
  scope: Scope;
  anchorId: string | null;
  snapId: string | null;
  /** Metres per screen pixel, so strokes and dots keep their size on screen. */
  px: number;
}

/** Redrawn only when the data, the scope or the zoom changes: dragging the map just moves the group around it. */
const Features = memo(function Features({ state, base, projection, scope, anchorId, snapId, px }: FeaturesProps) {
  const here = scope.kind === 'building' ? scope.buildingId : null;
  const inScope = (id: string): boolean => {
    const n = state.nodes[id];
    return n !== undefined && nodeInScope(n, scope);
  };
  const outdoors = (id: string): boolean => state.nodes[id]?.props.building_id === null;

  const buildings = Object.values(state.buildings).map((b) => (
    <Polygon
      key={b.id}
      points={(b.polygon[0] ?? []).map((p) => projection.toXY(p).join(',')).join(' ')}
      fill={b.id === here ? color.buildingHere : color.building}
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
        points={edgeCoords(state, e).map((p) => projection.toXY(p).join(',')).join(' ')}
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
    const made = !(n.id in base.nodes);
    const walkPoint = n.props.node_type === 'corridor' || n.props.node_type === 'outdoor';
    return [(
      <G key={n.id}>
        {n.id === anchorId && <Circle cx={x} cy={y} r={15 * px} fill="none" stroke={color.anchor} strokeWidth={3.5 * px} />}
        {n.id === snapId && n.id !== anchorId && <Circle cx={x} cy={y} r={13 * px} fill="none" stroke={color.ok} strokeWidth={3 * px} />}
        <Circle cx={x} cy={y} r={(walkPoint ? 5 : 7.5) * px} fill={made ? color.made : color.node} stroke={color.surface} strokeWidth={1.5 * px} />
      </G>
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

function Crosshair({ size, snapped }: { size: Size; snapped: boolean }) {
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
}
