// The point badges and the 출발 / 도착 pins as SVG data URLs, for deck.gl's IconLayer in the 3D views (map/deck3d.ts).
// The same drawings as the canvas ones of icons.ts, but plain strings: nothing here needs the browser's canvas.
import { BADGE_RIM, PICTOGRAMS, WHEELCHAIR_MARKS, badgeLayout, type GlyphPart, type PictogramKind, type Wheelchair } from '@campo/core';

/**
 * The 출발 / 도착 pin as an SVG data URL (deck.gl's IconLayer in the 3D views): the same pill and tip as drawPin, 96 × 64
 * (twice the size drawn on screen), the tip at the bottom centre.
 */
export function routePinDataUrl(label: string, fill: string): string {
  const [w, pill, tip, pad] = [80, 36, 12, 8];
  const r = pill / 2;
  const d = `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w - r} ${pill} H${w / 2 + 10} L${w / 2} ${pill + tip} L${w / 2 - 10} ${pill} H${r} A${r} ${r} 0 0 1 ${r} 0 Z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64" viewBox="0 0 96 64">`
    + `<g transform="translate(${pad} ${64 - pill - tip - 1})"><path d="${d}" fill="${fill}" stroke="#ffffff" stroke-width="3"/>`
    + `<text x="${w / 2}" y="${r + 1}" fill="#ffffff" font-family="Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" font-size="22" font-weight="600" text-anchor="middle" dominant-baseline="middle">${label}</text></g>`
    + '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** A badge as an SVG data URL (deck.gl's IconLayer in the 3D view): the same drawing as registerPictograms. */
export function pictogramDataUrl(kind: PictogramKind, wheelchair: Wheelchair | null, size = 64): string {
  const b = badgeLayout(size);
  const p = PICTOGRAMS[kind];
  const parts = (list: readonly GlyphPart[], ink: string) => list.map((g) => (g.stroke !== undefined
    ? `<path d="${g.d}" fill="none" stroke="${ink}" stroke-width="${g.stroke}" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="${g.d}" fill="${ink}" fill-rule="evenodd"/>`)).join('');
  const at = (g: { x: number; y: number; scale: number }) => `translate(${g.x} ${g.y}) scale(${g.scale})`;
  const m = wheelchair ? WHEELCHAIR_MARKS[wheelchair] : null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<circle cx="${b.c}" cy="${b.c + size * 0.02}" r="${b.r + b.rim / 2 + size * 0.02}" fill="#101820" fill-opacity="0.28"/>`
    + `<circle cx="${b.c}" cy="${b.c}" r="${b.r}" fill="${p.color}" stroke="${BADGE_RIM}" stroke-width="${b.rim}"/>`
    + `<g transform="${at(m ? b.glyphBeside : b.glyph)}">${parts(p.parts, '#ffffff')}</g>`
    + (m ? `<circle cx="${b.mini.cx}" cy="${b.mini.cy}" r="${b.mini.r}" fill="${m.color}" stroke="${BADGE_RIM}" stroke-width="${b.mini.rim}"/><g transform="${at(b.mini.glyph)}">${parts(m.parts, m.ink)}</g>` : '')
    + '</svg>';
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
