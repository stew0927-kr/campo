// Floor outlines (BuildingProperties.floor_outlines): the fallback to the building geometry, validation E15, the actions
// that set and reset them (rev, undo/redo), and the corner edits the editor and the survey app share.
import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES as E,
  closeRing, createHistory, getBuildingOutlineForLevel, hasFloorOutline, insertCorner, moveCorner, outlineOfLevel, outlineProblem,
  outlineToEdit, removeCorner, resetFloorOutline, ringCorners, setBuildingLevels, setBuildingOutline, toFeatures, validateCampus,
  type BuildingFeature, type EditState, type Position,
} from '../../src/index.ts';
import { loadCampus } from '../../src/node/index.ts';
import { FIXTURE_DIR, fixtureState } from './helpers.ts';

const square = (x0: number, y0: number, d: number): Position[][] => [[[x0, y0], [x0 + d, y0], [x0 + d, y0 + d], [x0, y0 + d], [x0, y0]]];
const run = (state: EditState, action: ReturnType<typeof setBuildingOutline>) => {
  expect(action.disabled(state)).toBe(false);
  return action.apply(state);
};

describe('getBuildingOutlineForLevel', () => {
  const feature: BuildingFeature = {
    type: 'Feature', id: 'bldg_X',
    geometry: { type: 'Polygon', coordinates: square(127, 37, 0.001) },
    properties: { kind: 'building', name: 'X', code: 'X', levels: [-1, 1, 2], ground_levels: [1], source: 's', rev: 1, floor_outlines: { '-1': square(127, 37, 0.002) } },
  };
  it('a floor with its own outline gets it; every other floor, and no floor, get the building geometry', () => {
    expect(getBuildingOutlineForLevel(feature, -1)).toEqual(square(127, 37, 0.002));
    expect(getBuildingOutlineForLevel(feature, 1)).toBe(feature.geometry.coordinates);
    expect(getBuildingOutlineForLevel(feature)).toBe(feature.geometry.coordinates);
    expect(getBuildingOutlineForLevel(feature, null)).toBe(feature.geometry.coordinates);
  });
  it('old data without floor_outlines is unchanged', () => {
    const { floor_outlines: _, ...plain } = feature.properties;
    expect(getBuildingOutlineForLevel({ ...feature, properties: plain }, -1)).toBe(feature.geometry.coordinates);
  });
  it('the fixture building B has a narrower 2F', async () => {
    const s = await fixtureState();
    const b = s.buildings['B']!;
    expect(hasFloorOutline(b, 2)).toBe(true);
    expect(outlineOfLevel(b, 2)[0]![1]).toEqual([127.0013, 37.0003]);
    expect(outlineOfLevel(b, 1)).toBe(b.polygon);
  });
});

describe('E15: floor outlines are checked', () => {
  const withOutlines = async (outlines: unknown) => {
    const loaded = structuredClone(await loadCampus(FIXTURE_DIR));
    const b = loaded.features.find((f) => (f.feature as { id: string }).id === 'bldg_B')!.feature as { properties: Record<string, unknown> };
    b.properties['floor_outlines'] = outlines;
    return validateCampus(loaded).errors.map((e) => [e.code, e.featureId]);
  };
  it('the fixture passes', async () => {
    expect(await withOutlines({ 2: square(127.0011, 37.0003, 0.0002) })).toEqual([]);
  });
  it('a level the building does not have, an open ring and a ring of three positions are errors', async () => {
    expect(await withOutlines({ 3: square(127.0011, 37.0003, 0.0002) })).toEqual([[E.floorOutlineInvalid, 'bldg_B']]);
    const open = square(127.0011, 37.0003, 0.0002);
    open[0]![4] = [127.0012, 37.0003];
    expect(await withOutlines({ 2: open })).toEqual([[E.floorOutlineInvalid, 'bldg_B']]);
    // Fewer than four positions is caught by the schema already (the building is then left out of the other checks).
    expect((await withOutlines({ 2: [[[127.0011, 37.0003], [127.0012, 37.0003], [127.0011, 37.0003]]] })).map(([c]) => c)).toContain('schema');
  });
  it('the key must be a level number (never 0)', async () => {
    expect((await withOutlines({ 0: square(127.0011, 37.0003, 0.0002) })).map(([c]) => c)).toContain('schema');
  });
});

describe('setBuildingOutline / resetFloorOutline', () => {
  it('a floor gets its own outline, copied from the building at the start; the building outline and other floors stay', async () => {
    const s0 = await fixtureState();
    const start = outlineToEdit(s0, 'A', 3)!;
    expect(start).toEqual(s0.buildings['A']!.polygon);
    const next = closeRing(moveCorner(ringCorners(start[0]!), 0, [126.9999, 36.9999]));
    const s1 = run(s0, setBuildingOutline('A', 3, [next]));
    const a = s1.buildings['A']!;
    expect(a.props.floor_outlines).toEqual({ 3: [next] });
    expect(a.polygon).toEqual(s0.buildings['A']!.polygon);
    expect(outlineOfLevel(a, 2)).toBe(a.polygon);
    expect(a.props.rev).toBe(s0.buildings['A']!.props.rev + 1);
    // The saved Feature carries it, and the campus still validates.
    const feature = toFeatures(s1).find((f) => f.id === 'bldg_A') as BuildingFeature;
    expect(getBuildingOutlineForLevel(feature, 3)).toEqual([next]);
  });

  it('without a level it is the building outline, which the floors without their own follow', async () => {
    const s0 = await fixtureState();
    const s1 = run(s0, setBuildingOutline('B', null, square(127.001, 37.0003, 0.0004)));
    expect(s1.buildings['B']!.polygon).toEqual(square(127.001, 37.0003, 0.0004));
    expect(outlineOfLevel(s1.buildings['B']!, 1)).toEqual(square(127.001, 37.0003, 0.0004));
    expect(outlineOfLevel(s1.buildings['B']!, 2)).toEqual(s0.buildings['B']!.props.floor_outlines!['2']);
  });

  it('reset takes the floor back to the building outline; the last one removes floor_outlines', async () => {
    const s0 = await fixtureState();
    const s1 = resetFloorOutline('B', 2).apply(s0);
    expect(s1.buildings['B']!.props.floor_outlines).toBeUndefined();
    expect(s1.buildings['B']!.props.rev).toBe(2);
    expect(resetFloorOutline('B', 2).disabled(s1)).toContain('이미 건물 외곽선');
  });

  it('refuses a missing building, a level it does not have, an open ring, too few corners and no change', async () => {
    const s0 = await fixtureState();
    expect(setBuildingOutline('Z', null, square(127, 37, 1)).disabled(s0)).toContain('없습니다');
    expect(setBuildingOutline('B', 7, square(127, 37, 1)).disabled(s0)).toContain('층이 아닙니다');
    expect(setBuildingOutline('B', 1, [[[127, 37], [128, 37], [128, 38], [127, 38]]]).disabled(s0)).toContain('닫혀 있지 않습니다');
    expect(setBuildingOutline('B', 1, [[[127, 37], [128, 37], [127, 37]]]).disabled(s0)).toContain('세 개 이상');
    expect(setBuildingOutline('B', 2, s0.buildings['B']!.props.floor_outlines!['2']!).disabled(s0)).toBe('바뀐 내용이 없습니다.');
    expect(setBuildingOutline('B', null, s0.buildings['B']!.polygon).disabled(s0)).toBe('바뀐 내용이 없습니다.');
  });

  it('one history entry each: undo and redo give the outline back', async () => {
    const s0 = await fixtureState();
    const h = createHistory(s0);
    h.perform(setBuildingOutline('A', 1, square(127.0004, 37.0004, 0.0001)));
    h.perform(resetFloorOutline('A', 1));
    expect(h.current().buildings['A']!.props.floor_outlines).toBeUndefined();
    h.undo();
    expect(h.current().buildings['A']!.props.floor_outlines?.['1']).toEqual(square(127.0004, 37.0004, 0.0001));
    h.undo();
    expect(h.current()).toEqual(s0);
    h.redo();
    expect(h.current().buildings['A']!.props.floor_outlines?.['1']).toEqual(square(127.0004, 37.0004, 0.0001));
  });

  it('taking a floor out of the building takes its outline with it', async () => {
    const s0 = await fixtureState();
    const s1 = run(s0, setBuildingOutline('C', 5, square(127, 37, 0.0001)));
    const s2 = setBuildingLevels('B', [1, 2, 3]).apply(s1);
    expect(s2.buildings['B']!.props.floor_outlines).toEqual(s0.buildings['B']!.props.floor_outlines);
    // B has nothing on 2F once its points are gone; here a fresh building shows the rule.
    const bare = { ...s0, nodes: Object.fromEntries(Object.entries(s0.nodes).filter(([, n]) => !(n.props.building_id === 'bldg_B' && n.props.level === 2))) };
    const edges = Object.fromEntries(Object.entries(s0.edges).filter(([, e]) => bare.nodes[e.props.from] && bare.nodes[e.props.to]));
    const s3 = setBuildingLevels('B', [1]).apply({ ...bare, edges });
    expect(s3.buildings['B']!.props.levels).toEqual([1]);
    expect(s3.buildings['B']!.props.floor_outlines).toBeUndefined();
  });
});

describe('corner edits', () => {
  const ring = square(0, 0, 1)[0]!;
  it('a ring opens to its corners and closes again', () => {
    expect(ringCorners(ring)).toHaveLength(4);
    expect(closeRing(ringCorners(ring))).toEqual(ring);
  });
  it('moves, adds on a side (the last side runs back to the first corner) and removes down to three corners', () => {
    const c = ringCorners(ring);
    expect(moveCorner(c, 2, [2, 2])[2]).toEqual([2, 2]);
    expect(insertCorner(c, 0, [0.5, 0])).toEqual([[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1]]);
    expect(insertCorner(c, 3, [0, 0.5]).at(-1)).toEqual([0, 0.5]);
    const three = removeCorner(c, 1)!;
    expect(three).toEqual([[0, 0], [1, 1], [0, 1]]);
    expect(removeCorner(three, 0)).toBeNull();
    expect(outlineProblem([closeRing(three)])).toBe(false);
  });
});
