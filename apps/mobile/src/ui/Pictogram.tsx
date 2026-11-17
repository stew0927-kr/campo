// The point badges of core pictograms.ts in react-native-svg: the same disc, rim and silhouette the editor draws on its
// canvas. `PictoBadge` is a group to put inside an <Svg> (the map), `PictoIcon` a small standalone icon (the menu).
import {
  BADGE_RIM, PICTOGRAMS, WHEELCHAIR_MARKS, badgeLayout, type GlyphPart, type PictogramKind, type Wheelchair,
} from '@campo/core';
import Svg, { Circle, G, Path } from 'react-native-svg';

function Parts({ parts, at, ink }: { parts: readonly GlyphPart[]; at: { x: number; y: number; scale: number }; ink: string }) {
  return (
    <G transform={`translate(${at.x} ${at.y}) scale(${at.scale})`}>
      {parts.map((p, i) => (p.stroke !== undefined
        ? <Path key={i} d={p.d} fill="none" stroke={ink} strokeWidth={p.stroke} strokeLinecap="round" strokeLinejoin="round" />
        : <Path key={i} d={p.d} fill={ink} fillRule="evenodd" />))}
    </G>
  );
}

interface BadgeProps {
  kind: PictogramKind;
  /** The square the badge fills, in the units of the surrounding drawing. */
  size: number;
  /** A restroom's wheelchair answer: the small badge at the lower right. */
  wheelchair?: Wheelchair | null;
  /** The rim colour: white, or the accent for a point recorded on this walk. */
  rim?: string;
  /** Top-left corner of the square. */
  x?: number;
  y?: number;
}

/** A badge as a group in the current drawing, its square at (x, y). A thin dark ring under the rim stands for the halo. */
export function PictoBadge({ kind, size, wheelchair = null, rim = BADGE_RIM, x = 0, y = 0 }: BadgeProps) {
  const b = badgeLayout(size);
  const p = PICTOGRAMS[kind];
  const m = wheelchair ? WHEELCHAIR_MARKS[wheelchair] : null;
  return (
    <G transform={`translate(${x} ${y})`}>
      <Circle cx={b.c} cy={b.c + size * 0.02} r={b.r + b.rim / 2 + size * 0.02} fill="#101820" fillOpacity={0.28} />
      <Circle cx={b.c} cy={b.c} r={b.r} fill={p.color} stroke={rim} strokeWidth={b.rim} />
      <Parts parts={p.parts} at={m ? b.glyphBeside : b.glyph} ink="#ffffff" />
      {m && (
        <>
          <Circle cx={b.mini.cx} cy={b.mini.cy} r={b.mini.r} fill={m.color} stroke={BADGE_RIM} strokeWidth={b.mini.rim} />
          <Parts parts={m.parts} at={b.mini.glyph} ink={m.ink} />
        </>
      )}
    </G>
  );
}

/** A badge on its own (menu items, sheet headers). */
export function PictoIcon({ kind, size = 24 }: { kind: PictogramKind; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <PictoBadge kind={kind} size={size} />
    </Svg>
  );
}
