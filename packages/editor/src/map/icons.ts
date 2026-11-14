// Restroom icons (SPEC-v0.2 2.3): the disc colour and letter tell the gender, the badge at the lower right tells wheelchair access.
// Drawn on a canvas once, because the map style has no glyphs or sprite sheet.
import type { Map as MapLibreMap } from 'maplibre-gl';
import { ROUTE_PIN_COLORS } from './layers.ts';

const GENDER: Record<string, { color: string; letter: string }> = {
  male: { color: '#1c6fc4', letter: '남' },
  female: { color: '#c2255c', letter: '여' },
  unisex: { color: '#6a4fc4', letter: '공' },
  family: { color: '#1f8f68', letter: '가' },
};
const WHEELCHAIR: Record<string, { color: string; mark: string }> = {
  yes: { color: '#1f8f68', mark: '✓' },
  limited: { color: '#e08a00', mark: '△' },
  no: { color: '#6b7782', mark: '✕' },
  unknown: { color: '#ffffff', mark: '?' },
};

const SIZE = 36;

function draw(gender: string, wheelchair: string): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const c = canvas.getContext('2d')!;
  const g = GENDER[gender]!;
  const w = WHEELCHAIR[wheelchair]!;
  c.beginPath();
  c.arc(17, 17, 14, 0, Math.PI * 2);
  c.fillStyle = g.color;
  c.fill();
  c.lineWidth = 2.5;
  c.strokeStyle = '#1e2933';
  c.stroke();
  c.fillStyle = '#ffffff';
  c.font = 'bold 16px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(g.letter, 17, 18);
  c.beginPath();
  c.arc(28, 28, 8, 0, Math.PI * 2);
  c.fillStyle = w.color;
  c.fill();
  c.lineWidth = 2;
  c.strokeStyle = '#1e2933';
  c.stroke();
  c.fillStyle = wheelchair === 'unknown' ? '#1e2933' : '#ffffff';
  c.font = 'bold 11px sans-serif';
  c.fillText(w.mark, 28, 28.5);
  return c.getImageData(0, 0, SIZE, SIZE);
}

export function registerRestroomIcons(map: MapLibreMap): void {
  for (const gender of Object.keys(GENDER)) {
    for (const wheelchair of Object.keys(WHEELCHAIR)) {
      const id = `restroom-${gender}-${wheelchair}`;
      if (!map.hasImage(id)) map.addImage(id, draw(gender, wheelchair));
    }
  }
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
