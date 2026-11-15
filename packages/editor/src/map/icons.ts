// Point pictograms (core pictograms.ts, the same badges the survey app draws): a colour disc with a white rim and a white
// silhouette, and for a restroom the wheelchair badge at the lower right (SPEC-v0.2 2.3). Drawn on a canvas once, at
// twice the size for sharp edges, because the map style has no sprite sheet.
import {
  BADGE_HALO, BADGE_RIM, PICTOGRAMS, PICTOGRAM_KINDS, WHEELCHAIR_MARKS, WHEELCHAIR_VALUES, badgeLayout,
  type GlyphPart, type PictogramKind, type Wheelchair,
} from '@campo/core';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { ELEVATION_COLORS, ROUTE_PIN_COLORS, pictogramImage } from './layers.ts';

/** Badge size on the map, in CSS pixels (the canvas is twice that). */
export const PICTOGRAM_PX = 26;
const RATIO = 2;

function drawParts(c: CanvasRenderingContext2D, parts: readonly GlyphPart[], at: { x: number; y: number; scale: number }, ink: string): void {
  c.save();
  c.translate(at.x, at.y);
  c.scale(at.scale, at.scale);
  c.fillStyle = ink;
  c.strokeStyle = ink;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (const p of parts) {
    if (p.stroke !== undefined) {
      c.lineWidth = p.stroke;
      c.stroke(new Path2D(p.d));
    } else {
      c.fill(new Path2D(p.d), 'evenodd');
    }
  }
  c.restore();
}

function disc(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, rim: number, halo: boolean): void {
  c.save();
  if (halo) {
    c.shadowColor = BADGE_HALO;
    c.shadowBlur = 2;
    c.shadowOffsetY = 0.5;
  }
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  c.shadowColor = 'transparent';
  c.lineWidth = rim;
  c.strokeStyle = BADGE_RIM;
  c.stroke();
  c.restore();
}

function drawBadge(kind: PictogramKind, wheelchair: Wheelchair | null): ImageData {
  const size = PICTOGRAM_PX * RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d')!;
  const b = badgeLayout(size);
  const p = PICTOGRAMS[kind];
  disc(c, b.c, b.c, b.r, p.color, b.rim, true);
  drawParts(c, p.parts, wheelchair ? b.glyphBeside : b.glyph, '#ffffff');
  if (wheelchair) {
    const m = WHEELCHAIR_MARKS[wheelchair];
    disc(c, b.mini.cx, b.mini.cy, b.mini.r, m.color, b.mini.rim, true);
    drawParts(c, m.parts, b.mini.glyph, m.ink);
  }
  return c.getImageData(0, 0, size, size);
}

/** Every badge the map can show: one per kind, and each restroom kind once per wheelchair answer. */
export function registerPictograms(map: MapLibreMap): void {
  for (const kind of PICTOGRAM_KINDS) {
    const variants: (Wheelchair | null)[] = kind.startsWith('restroom_') ? [...WHEELCHAIR_VALUES] : [null];
    for (const wheelchair of variants) {
      const id = pictogramImage(kind, wheelchair);
      if (!map.hasImage(id)) map.addImage(id, drawBadge(kind, wheelchair), { pixelRatio: RATIO });
    }
  }
}

/**
 * 고도 단절선 (a retaining wall, a sudden step in the ground): the teeth that hang off the line on its lower side, as on a
 * topographic map. The symbol layer lays it along the line; x follows the line, the tooth points down the image.
 */
function drawBreakTooth(): ImageData {
  const w = 12;
  const h = 16;
  const canvas = document.createElement('canvas');
  canvas.width = w * RATIO;
  canvas.height = h * RATIO;
  const c = canvas.getContext('2d')!;
  c.scale(RATIO, RATIO);
  c.beginPath();
  c.moveTo(3, 8);
  c.lineTo(9, 8);
  c.lineTo(6, 14.5);
  c.closePath();
  c.fillStyle = ELEVATION_COLORS.breakline;
  c.strokeStyle = '#ffffff';
  c.lineWidth = 1.2;
  c.lineJoin = 'round';
  c.stroke();
  c.fill();
  return c.getImageData(0, 0, w * RATIO, h * RATIO);
}

export function registerBreaklineTooth(map: MapLibreMap): void {
  if (!map.hasImage('breakline-tooth')) map.addImage('breakline-tooth', drawBreakTooth(), { pixelRatio: RATIO });
}

/**
 * Arrow of an escalator or moving walkway (belt-arrow: heading right = the way the belt runs; belt-arrow-both: both ways).
 * The symbol layer turns it to follow the line. A white rim keeps it readable on the red belt.
 */
function drawArrow(both: boolean): ImageData {
  const w = 22;
  const h = 18;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  const head = (cx: number, dir: 1 | -1) => {
    c.beginPath();
    c.moveTo(cx - 5 * dir, 3);
    c.lineTo(cx + 4 * dir, 9);
    c.lineTo(cx - 5 * dir, 15);
    c.closePath();
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#1e2933';
    c.lineWidth = 1.5;
    c.lineJoin = 'round';
    c.stroke();
    c.fill();
  };
  if (both) {
    head(5, -1);
    head(17, 1);
  } else {
    head(11, 1);
  }
  return c.getImageData(0, 0, w, h);
}

export function registerBeltIcons(map: MapLibreMap): void {
  if (!map.hasImage('belt-arrow')) map.addImage('belt-arrow', drawArrow(false));
  if (!map.hasImage('belt-arrow-both')) map.addImage('belt-arrow-both', drawArrow(true));
}

/** 경로 테스트 ends: a small rounded label (출발 green, 도착 red) whose pointed tip sits on the place. Drawn at 2x for sharp text. */

function drawPin(label: string, fill: string): ImageData {
  const k = 2;
  const w = 40;
  const pill = 20;
  const tip = 7;
  const pad = 3; // room for the shadow
  const canvas = document.createElement('canvas');
  canvas.width = (w + pad * 2) * k;
  canvas.height = (pill + tip + pad * 2) * k;
  const c = canvas.getContext('2d')!;
  c.scale(k, k);
  c.translate(pad, pad);
  c.shadowColor = 'rgba(30, 41, 51, 0.35)';
  c.shadowBlur = 3;
  c.shadowOffsetY = 1;
  c.beginPath();
  const r = pill / 2;
  c.moveTo(r, 0);
  c.lineTo(w - r, 0);
  c.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2);
  c.lineTo(w / 2 + 5, pill);
  c.lineTo(w / 2, pill + tip);
  c.lineTo(w / 2 - 5, pill);
  c.lineTo(r, pill);
  c.arc(r, r, r, Math.PI / 2, (Math.PI * 3) / 2);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  c.shadowColor = 'transparent';
  c.lineWidth = 1.5;
  c.strokeStyle = '#ffffff';
  c.stroke();
  c.fillStyle = '#ffffff';
  c.font = '600 11px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(label, w / 2, r + 0.5);
  return c.getImageData(0, 0, canvas.width, canvas.height);
}

export function registerRoutePins(map: MapLibreMap): void {
  if (!map.hasImage('route-start')) map.addImage('route-start', drawPin('출발', ROUTE_PIN_COLORS.start), { pixelRatio: 2 });
  if (!map.hasImage('route-end')) map.addImage('route-end', drawPin('도착', ROUTE_PIN_COLORS.end), { pixelRatio: 2 });
}
