// 평지(plaza) edit actions: addPlaza, addPlazaHole, removePlazaHole, deletePlazas and setProps on a plaza.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addPlaza,
  addPlazaHole,
  checkInvariants,
  createHistory,
  deletePlazas,
  emptyState,
  fromCampus,
  parseCampus,
  removePlazaHole,
  serialize,
  setProps,
  signedAreaM2,
  type EditState,
} from '../../src/index.ts';
import { loadCampus, readCampusFiles } from '../../src/node/index.ts';
import { rect } from '../plaza/helpers.ts';
import { ctx, deepFreeze, expectInputUntouched, expectUndoRedo } from './helpers.ts';

const PLAZA_DIR = fileURLToPath(new URL('../fixtures/campus-plaza', import.meta.url));
const props = { kind: 'plaza' as const, source: 'editor', name: '광장' };

function withPlaza(): EditState {
  return deepFreeze(addPlaza({ id: 'plaza_a', polygon: [rect(0, 0, 20, 20, false)], props }).apply(emptyState()));
}

describe('addPlaza', () => {
  it('adds a normalized plaza at rev 1 and leaves the input untouched', () => {
    const s = expectInputUntouched(emptyState(), addPlaza({ polygon: [rect(0, 0, 20, 20, false).slice(0, -1)], props }, ctx()));
    const [p] = Object.values(s.plazas);
    expect(p!.id).toMatch(/^plaza_[0-9a-z]{6}$/);
    expect(p!.props).toEqual({ kind: 'plaza', source: 'editor', name: '광장', rev: 1 });
    expect(p!.polygon[0]![0]).toEqual(p!.polygon[0]![p!.polygon[0]!.length - 1]);
    expect(signedAreaM2(p!.polygon[0]!)).toBeGreaterThan(0);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('undo / redo', () => {
    expectUndoRedo(emptyState(), addPlaza({ id: 'plaza_a', polygon: [rect(0, 0, 5, 5)], props }));
  });

  it('is disabled for a taken id and a broken ring; touching or overlapping another plaza is allowed (linked plazas)', () => {
    const s = withPlaza();
    expect(addPlaza({ id: 'plaza_a', polygon: [rect(30, 0, 40, 5)], props }).disabled(s)).toMatch(/이미 있는 id/);
    expect(addPlaza({ id: 'plaza_b', polygon: [rect(30, 0, 40, 5).slice(0, 2)], props }).disabled(s)).toMatch(/닫힌 고리/);
    expect(addPlaza({ id: 'plaza_b', polygon: [rect(10, 10, 30, 30)], props }).disabled(s)).toBe(false);
    expect(addPlaza({ id: 'plaza_b', polygon: [rect(30, 0, 40, 5)], props }).disabled(s)).toBe(false);
  });

  it('needs an id generator when no id is given', () => {
    expect(() => addPlaza({ polygon: [rect(0, 0, 5, 5)], props })).toThrow(/EditContext/);
  });
});

describe('addPlazaHole / removePlazaHole', () => {
  it('adds a clockwise hole with rev + 1, then removes it with rev + 1', () => {
    const s0 = withPlaza();
    const s1 = expectInputUntouched(s0, addPlazaHole('plaza_a', rect(5, 5, 10, 10)));
    const p1 = s1.plazas['plaza_a']!;
    expect(p1.polygon).toHaveLength(2);
    expect(signedAreaM2(p1.polygon[1]!)).toBeLessThan(0);
    expect(p1.props.rev).toBe(2);
    const s2 = expectInputUntouched(deepFreeze(s1), removePlazaHole('plaza_a', 0));
    expect(s2.plazas['plaza_a']!.polygon).toEqual(s0.plazas['plaza_a']!.polygon);
    expect(s2.plazas['plaza_a']!.props.rev).toBe(3);
  });

  it('one history step each, undone in one go', () => {
    const s0 = withPlaza();
    const h = createHistory(s0);
    h.perform(addPlazaHole('plaza_a', rect(5, 5, 10, 10)));
    expect(h.undo()).toEqual(s0);
    expectUndoRedo(s0, addPlazaHole('plaza_a', rect(5, 5, 10, 10)));
  });

  it('disabled reasons', () => {
    const s = withPlaza();
    expect(addPlazaHole('nope', rect(5, 5, 10, 10)).disabled(s)).toMatch(/없습니다/);
    expect(addPlazaHole('plaza_a', rect(15, 15, 25, 25)).disabled(s)).toBe('구멍이 평지 바깥으로 나갑니다.');
    expect(addPlazaHole('plaza_a', rect(0.05, 5, 5, 10)).disabled(s)).toMatch(/너무 가깝습니다/);
    expect(removePlazaHole('plaza_a', 0).disabled(s)).toMatch(/구멍이 없습니다/);
    expect(removePlazaHole('nope', 0).disabled(s)).toMatch(/없습니다/);
  });
});

describe('deletePlazas', () => {
  it('deletes, undoes, and names missing ids', () => {
    const s = withPlaza();
    const after = expectInputUntouched(s, deletePlazas(['plaza_a']));
    expect(after.plazas).toEqual({});
    expectUndoRedo(s, deletePlazas(['plaza_a']));
    expect(deletePlazas(['plaza_x']).disabled(s)).toMatch(/없는 평지/);
    expect(deletePlazas([]).disabled(s)).toMatch(/하나 이상/);
    expect(deletePlazas(['plaza_a']).annotation).toBe('평지 1개 삭제');
  });

  it('warns about an override on the plaza', () => {
    const s = withPlaza();
    expect(deletePlazas(['plaza_a'], ctx(1, { overrideIds: new Set(['plaza_a']) })).warnings!(s)).toEqual([expect.stringContaining('plaza_a')]);
  });
});

describe('setProps on a plaza', () => {
  it('sets and clears name, surface and fixed_height_m (rev + 1 each time)', () => {
    const s = withPlaza();
    const a = expectInputUntouched(s, setProps(['plaza_a'], { surface: 'grass', fixed_height_m: 42.5 }));
    expect(a.plazas['plaza_a']!.props).toMatchObject({ surface: 'grass', fixed_height_m: 42.5, rev: 2 });
    const b = setProps(['plaza_a'], { fixed_height_m: null, name: undefined }).apply(deepFreeze(a));
    expect(b.plazas['plaza_a']!.props).toEqual({ kind: 'plaza', source: 'editor', surface: 'grass', rev: 3 });
  });

  it('refuses other keys and bad values', () => {
    const s = withPlaza();
    expect(setProps(['plaza_a'], { needs_check: true }).disabled(s)).toMatch(/이름·표면·고정 높이만/);
    expect(setProps(['plaza_a'], { building_id: 'x' }).disabled(s)).toMatch(/바꿀 수 없습니다/);
    expect(setProps(['plaza_a'], { surface: 'lava' }).disabled(s)).toMatch(/표면은/);
    expect(setProps(['plaza_a'], { fixed_height_m: 3001 }).disabled(s)).toMatch(/고정 높이/);
    expect(setProps(['plaza_a'], { fixed_height_m: Number.NaN }).disabled(s)).toMatch(/고정 높이/);
    expect(setProps(['plaza_a'], { fixed_height_m: '12' }).disabled(s)).toMatch(/고정 높이/);
    expect(setProps(['plaza_a'], { name: '' }).disabled(s)).toMatch(/이름/);
    expect(setProps(['plaza_a'], { fixed_height_m: -100 }).disabled(s)).toBe(false);
  });
});

describe('campus-plaza fixture', () => {
  it('loads without issues and saves byte for byte; plazas go to outdoor.geojson', async () => {
    const loaded = await loadCampus(PLAZA_DIR);
    const { state, issues } = fromCampus(loaded);
    expect(issues).toEqual([]);
    expect(Object.keys(state.plazas)).toEqual(['plaza_lawn', 'plaza_ring']);
    const disk = (await readCampusFiles(PLAZA_DIR)).filter((f) => f.path.endsWith('.geojson') || f.path === 'campus.json');
    const out = serialize(state, loaded.meta);
    expect(out.map((f) => f.path)).toEqual(disk.map((f) => f.path).sort());
    for (const f of out) expect(f.text, f.path).toBe(disk.find((d) => d.path === f.path)!.text);
  });

  it('round trip after edits: fromCampus(serialize(state)) gives the same state', async () => {
    const { state } = fromCampus(await loadCampus(PLAZA_DIR));
    const edited = addPlazaHole('plaza_lawn', rect(65, 5, 70, 10)).apply(setProps(['plaza_ring'], { name: '새 이름' }).apply(state));
    const again = fromCampus(parseCampus(serialize(edited)));
    expect(again.issues).toEqual([]);
    expect(again.state).toEqual(edited);
  });
});
