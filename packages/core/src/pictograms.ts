// Map pictograms of the points people look for (stairs, elevators, escalators, restrooms, entrances, room doors), shared
// by the survey app (react-native-svg) and the editor (canvas Path2D), so both draw the same badge. Display only: nothing
// here is read by routing or validation.
//
// Every glyph is a white silhouette on a 24 × 24 grid, drawn inside a round colour badge with a white rim (badgeLayout),
// so it stays readable where it sits on a map line. A part with `stroke` is a stroked line (round caps and joins);
// a part without one is filled with the even-odd rule (holes such as the door knob show the badge colour).
import { isEscalator } from './costs.ts';
import type { EditNode, EditState } from './edit/state.ts';
import type { RestroomGender, Wheelchair } from './types.ts';

export const PICTOGRAM_GRID = 24;

export const PICTOGRAM_KINDS = [
  'stairs', 'elevator', 'escalator', 'restroom_male', 'restroom_female', 'restroom_all', 'entrance', 'door',
] as const;
export type PictogramKind = (typeof PICTOGRAM_KINDS)[number];

export interface GlyphPart {
  /** SVG path data on the 24 × 24 grid. */
  d: string;
  /** Line width on the grid when the part is a stroke; filled (even-odd) when left out. */
  stroke?: number;
}

export interface Pictogram {
  /** Korean name, for screen readers and tooltips. */
  label: string;
  /** Badge colour. */
  color: string;
  parts: readonly GlyphPart[];
}

/** One decimal place is enough on a 24 grid, and keeps the path strings short. */
const n = (v: number): string => String(Math.round(v * 100) / 100);

/**
 * A standing person, centred on x = `cx`, scaled by `s` about the middle of the grid. The man has a straight body and
 * legs; the woman a dress. Same head and stance, so a pair reads as two people side by side.
 */
function person(kind: 'man' | 'woman', cx: number, s: number): GlyphPart[] {
  const X = (x: number) => n(cx + (x - 12) * s);
  const Y = (y: number) => n(12 + (y - 12) * s);
  const r = n(2.4 * s);
  const head = `M${X(9.6)} ${Y(4.2)}A${r} ${r} 0 1 0 ${X(14.4)} ${Y(4.2)}A${r} ${r} 0 1 0 ${X(9.6)} ${Y(4.2)}Z`;
  const body = kind === 'man'
    ? `M${X(9)} ${Y(7.8)}H${X(15)}Q${X(16.6)} ${Y(7.8)} ${X(16.6)} ${Y(9.4)}V${Y(15)}H${X(14.8)}V${Y(21.6)}H${X(12.6)}V${Y(16)}H${X(11.4)}V${Y(21.6)}H${X(9.2)}V${Y(15)}H${X(7.4)}V${Y(9.4)}Q${X(7.4)} ${Y(7.8)} ${X(9)} ${Y(7.8)}Z`
    : `M${X(10.2)} ${Y(7.8)}H${X(13.8)}Q${X(15)} ${Y(7.8)} ${X(15.5)} ${Y(9)}L${X(18)} ${Y(16.2)}H${X(15)}V${Y(21.6)}H${X(12.9)}V${Y(16.2)}H${X(11.1)}V${Y(21.6)}H${X(9)}V${Y(16.2)}H${X(6)}L${X(8.5)} ${Y(9)}Q${X(9)} ${Y(7.8)} ${X(10.2)} ${Y(7.8)}Z`;
  return [{ d: head }, { d: body }];
}

/** Badge colours: the vertical ways keep the colours of their lines on the editor map (steps, elevator). */
export const PICTOGRAM_COLORS: Record<PictogramKind, string> = {
  stairs: '#d4461a',
  // The moving kind of stairs: same warm family, lighter, so the two tell apart but read as related.
  escalator: '#e08600',
  elevator: '#6a4fc4',
  restroom_male: '#1c6fc4',
  restroom_female: '#c2255c',
  restroom_all: '#862e9c',
  // A way in from outside stands out; a room door stays quiet.
  entrance: '#0b9a6d',
  door: '#3b4a66',
};

export const PICTOGRAMS: Record<PictogramKind, Pictogram> = {
  stairs: {
    label: '계단',
    color: PICTOGRAM_COLORS.stairs,
    // Four treads climbing to the right.
    parts: [{ d: 'M3 20.5V16H7.5V11.5H12V7H16.5V2.5H21V20.5Z' }],
  },
  elevator: {
    label: '엘리베이터',
    color: PICTOGRAM_COLORS.elevator,
    // The car (a rounded frame) with the up and down arrows inside it.
    parts: [
      { d: 'M6 2H18Q20 2 20 4V20Q20 22 18 22H6Q4 22 4 20V4Q4 2 6 2ZM6.5 4.5V19.5H17.5V4.5Z' },
      { d: 'M12 6.3L16 10.8H8Z' },
      { d: 'M12 17.7L8 13.2H16Z' },
    ],
  },
  escalator: {
    label: '에스컬레이터',
    color: PICTOGRAM_COLORS.escalator,
    // Steps on a slanted belt with flat landings, and the handrail above it.
    parts: [
      { d: 'M2 17H6V14.5H8.5V12H11V9.5H13.5V7H22V11H15L5 21H2Z' },
      { d: 'M2.2 13H4L13 4H21.8', stroke: 2 },
    ],
  },
  restroom_male: { label: '남자 화장실', color: PICTOGRAM_COLORS.restroom_male, parts: person('man', 12, 1) },
  restroom_female: { label: '여자 화장실', color: PICTOGRAM_COLORS.restroom_female, parts: person('woman', 12, 1) },
  restroom_all: {
    label: '남녀 화장실',
    color: PICTOGRAM_COLORS.restroom_all,
    parts: [...person('man', 6.6, 0.72), ...person('woman', 17, 0.72)],
  },
  entrance: {
    label: '건물 출입구',
    color: PICTOGRAM_COLORS.entrance,
    // A door frame open to the right, and the way in and out through it.
    parts: [
      { d: 'M3 2H14V8H11.5V4.5H5.5V19.5H11.5V16H14V22H3Z' },
      { d: 'M8.4 12H20.6', stroke: 2.2 },
      { d: 'M17.4 8.6L20.8 12L17.4 15.4', stroke: 2.2 },
      { d: 'M11.6 8.6L8.2 12L11.6 15.4', stroke: 2.2 },
    ],
  },
  door: {
    label: '강의실 문',
    color: PICTOGRAM_COLORS.door,
    // The frame, and the closed leaf with its knob (a hole that shows the badge colour). No arrow: not a way outside.
    parts: [
      { d: 'M5 2H19V22H16.8V4.2H7.2V22H5Z' },
      { d: 'M8.6 5.6H15.4V22H8.6ZM14.4 13A1.15 1.15 0 1 0 12.1 13A1.15 1.15 0 1 0 14.4 13Z' },
    ],
  },
};

/** The small badge at the lower right of a restroom: wheelchair access, on a 12 × 12 grid. */
export const WHEELCHAIR_GRID = 12;
export const WHEELCHAIR_MARKS: Record<Wheelchair, { label: string; color: string; ink: string; parts: readonly GlyphPart[] }> = {
  yes: { label: '휠체어 가능', color: '#1f8f68', ink: '#ffffff', parts: [{ d: 'M3.1 6.3L5.2 8.4L8.9 4.1', stroke: 1.8 }] },
  limited: { label: '휠체어 일부 가능', color: '#e08a00', ink: '#ffffff', parts: [{ d: 'M6 2.8L9.3 8.7H2.7Z' }] },
  no: { label: '휠체어 불가', color: '#6b7782', ink: '#ffffff', parts: [{ d: 'M3.9 3.9L8.1 8.1M8.1 3.9L3.9 8.1', stroke: 1.8 }] },
  unknown: {
    label: '휠체어 모름',
    color: '#ffffff',
    ink: '#1e2933',
    parts: [
      { d: 'M4.3 4.6Q4.3 2.7 6 2.7Q7.7 2.7 7.7 4.4Q7.7 5.5 6 6.3V7', stroke: 1.5 },
      { d: 'M5.15 9.1A0.85 0.85 0 1 0 6.85 9.1A0.85 0.85 0 1 0 5.15 9.1Z' },
    ],
  },
};

/** The white rim, and the faint dark halo under the badge that keeps the rim visible on a light map. */
export const BADGE_RIM = '#ffffff';
export const BADGE_HALO = 'rgba(16, 24, 32, 0.35)';

export interface BadgeLayout {
  /** Centre and radius of the badge disc (the rim is drawn on it, half inside). */
  c: number;
  r: number;
  rim: number;
  /** The glyph's 24 grid is drawn at (x, y) with this scale. */
  glyph: { x: number; y: number; scale: number };
  /** The same, moved up and to the left and a little smaller, when the wheelchair badge sits at the lower right. */
  glyphBeside: { x: number; y: number; scale: number };
  /** The wheelchair badge of a restroom, and its 12 grid. */
  mini: { cx: number; cy: number; r: number; rim: number; glyph: { x: number; y: number; scale: number } };
}

/** Where the parts of a badge go in a square of `size` (px or dp). Both apps lay a badge out with this. */
export function badgeLayout(size: number): BadgeLayout {
  const rim = Math.max(1.5, size * 0.075);
  const r = size / 2 - rim / 2 - size * 0.04;
  const g = size * 0.56;
  const mr = size * 0.2;
  const mc = size - mr - rim / 2;
  const mg = mr * 1.5;
  const gb = size * 0.5;
  const gbAt = (size - gb) / 2 - size * 0.06;
  return {
    c: size / 2,
    r,
    rim,
    glyph: { x: (size - g) / 2, y: (size - g) / 2, scale: g / PICTOGRAM_GRID },
    glyphBeside: { x: gbAt, y: gbAt, scale: gb / PICTOGRAM_GRID },
    mini: { cx: mc, cy: mc, r: mr, rim: rim * 0.8, glyph: { x: mc - mg / 2, y: mc - mg / 2, scale: mg / WHEELCHAIR_GRID } },
  };
}

export const restroomPictogram = (gender: RestroomGender | undefined): PictogramKind =>
  gender === 'male' ? 'restroom_male' : gender === 'female' ? 'restroom_female' : 'restroom_all';

/** Points at an end of an escalator or moving walkway: they get the escalator badge. */
export function beltEndIds(state: Pick<EditState, 'edges'>): Set<string> {
  const out = new Set<string>();
  for (const e of Object.values(state.edges)) if (isEscalator(e.props)) out.add(e.props.from).add(e.props.to);
  return out;
}

/**
 * The pictogram of a point, or null for a plain walk point (corridor, outdoor) or a POI. `beltEnds` (beltEndIds) gives
 * walk points at an escalator the escalator badge.
 */
export function pictogramOf(node: Pick<EditNode, 'id' | 'props'>, beltEnds: ReadonlySet<string> = new Set()): PictogramKind | null {
  switch (node.props.node_type) {
    case 'stair_landing': return 'stairs';
    case 'elevator_stop': return 'elevator';
    case 'restroom': return restroomPictogram(node.props.restroom_gender);
    case 'entrance': return 'entrance';
    case 'door': return 'door';
    case 'corridor':
    case 'outdoor': return beltEnds.has(node.id) ? 'escalator' : null;
    default: return null;
  }
}
