// Restroom icons (SPEC-v0.2 2.3): the disc colour and letter tell the gender, the badge at the lower right tells wheelchair access.
// Drawn on a canvas once, because the map style has no glyphs or sprite sheet.
import type { Map as MapLibreMap } from 'maplibre-gl';

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
