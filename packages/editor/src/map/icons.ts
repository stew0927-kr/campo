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
