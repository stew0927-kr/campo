import { describe, expect, it } from 'vitest';
import {
  PICTOGRAMS, PICTOGRAM_GRID, PICTOGRAM_KINDS, WHEELCHAIR_GRID, WHEELCHAIR_MARKS, badgeLayout, beltEndIds, pictogramOf, restroomPictogram,
  type EditNode, type EditState, type GlyphPart,
} from '../src/index.ts';

/** Every point an absolute path (M H V L Q A Z, the commands the glyphs use) passes through. */
function pathPoints(d: string): [number, number][] {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  let cmd = '';
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i]!)) cmd = tokens[i++]!;
    switch (cmd) {
      case 'M': case 'L': x = num(); y = num(); break;
      case 'H': x = num(); break;
      case 'V': y = num(); break;
      case 'Q': out.push([num(), num()]); x = num(); y = num(); break;
      case 'A': num(); num(); num(); num(); num(); x = num(); y = num(); break;
      case 'Z': continue;
      default: throw new Error(`unexpected command ${cmd} in ${d}`);
    }
    out.push([x, y]);
  }
  return out;
}

const inGrid = (parts: readonly GlyphPart[], grid: number) =>
  parts.every((p) => pathPoints(p.d).every(([x, y]) => x >= 0 && x <= grid && y >= 0 && y <= grid));

describe('pictograms', () => {
  it('draws every glyph inside its grid with the commands both renderers read', () => {
    for (const kind of PICTOGRAM_KINDS) {
      const p = PICTOGRAMS[kind];
      expect(p.parts.length, kind).toBeGreaterThan(0);
      expect(inGrid(p.parts, PICTOGRAM_GRID), kind).toBe(true);
      expect(p.color).toMatch(/^#[0-9a-f]{6}$/);
    }
    for (const mark of Object.values(WHEELCHAIR_MARKS)) expect(inGrid(mark.parts, WHEELCHAIR_GRID)).toBe(true);
  });

  it('gives every kind its own colour, the entrance and the room door clearly apart', () => {
    const colors = PICTOGRAM_KINDS.map((k) => PICTOGRAMS[k].color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(PICTOGRAMS.entrance.color).not.toBe(PICTOGRAMS.door.color);
  });

  it('draws one person for a men’s or women’s restroom and two for one shared by both', () => {
    const heads = (k: 'restroom_male' | 'restroom_female' | 'restroom_all') => PICTOGRAMS[k].parts.filter((p) => p.d.includes('A')).length;
    expect(heads('restroom_male')).toBe(1);
    expect(heads('restroom_female')).toBe(1);
    expect(heads('restroom_all')).toBe(2);
    expect(restroomPictogram('male')).toBe('restroom_male');
    expect(restroomPictogram('female')).toBe('restroom_female');
    expect(restroomPictogram('unisex')).toBe('restroom_all');
    expect(restroomPictogram('family')).toBe('restroom_all');
  });

  it('picks the pictogram from the point type; walk points only at an escalator', () => {
    const node = (id: string, props: Partial<EditNode['props']>): EditNode =>
      ({ id, coord: [0, 0], props: { kind: 'node', node_type: 'corridor', building_id: 'b', level: 1, rev: 1, ...props } }) as EditNode;
    const state = {
      edges: {
        belt: { id: 'belt', props: { kind: 'edge', highway: 'steps', edge_type: 'indoor', from: 'c1', to: 'c2', bidirectional: false, conveying: 'forward', rev: 1 } },
        flight: { id: 'flight', props: { kind: 'edge', highway: 'steps', edge_type: 'indoor', from: 'c3', to: 'c4', bidirectional: true, rev: 1 } },
      },
    } as unknown as EditState;
    const ends = beltEndIds(state);
    expect([...ends].sort()).toEqual(['c1', 'c2']);
    expect(pictogramOf(node('s', { node_type: 'stair_landing' }), ends)).toBe('stairs');
    expect(pictogramOf(node('e', { node_type: 'elevator_stop' }), ends)).toBe('elevator');
    expect(pictogramOf(node('r', { node_type: 'restroom', restroom_gender: 'female' }), ends)).toBe('restroom_female');
    expect(pictogramOf(node('en', { node_type: 'entrance' }), ends)).toBe('entrance');
    expect(pictogramOf(node('d', { node_type: 'door' }), ends)).toBe('door');
    expect(pictogramOf(node('c1', {}), ends)).toBe('escalator');
    expect(pictogramOf(node('c3', {}), ends)).toBeNull();
    expect(pictogramOf(node('p', { node_type: 'poi' }), ends)).toBeNull();
  });

  it('lays a badge out inside its square, the wheelchair badge at the lower right', () => {
    for (const size of [24, 28, 30, 60]) {
      const b = badgeLayout(size);
      expect(b.c + b.r + b.rim / 2).toBeLessThanOrEqual(size);
      expect(b.glyph.x).toBeGreaterThan(b.c - b.r);
      expect(b.glyph.x + PICTOGRAM_GRID * b.glyph.scale).toBeLessThan(b.c + b.r);
      expect(b.mini.cx + b.mini.r + b.mini.rim / 2).toBeLessThanOrEqual(size + 1e-9);
      expect(b.mini.cx).toBeGreaterThan(b.c);
    }
  });
});
