// 외곽선 수정 in the editor: the draft starts from the floor's outline (or the building's), its own undo / redo, and 완료
// as one history entry that gives the floor its own outline.
import { describe, expect, it } from 'vitest';
import { createHistory, outlineOfLevel } from '@campo/core';
import {
  draftPolygon, insertDraftCorner, moveDraftCorner, planOutline, planResetOutline, redoDraft, removeDraftCorner, startOutline, undoDraft, type OutlineDraft,
} from '../src/model/outlineEdit.ts';
import { runPlan } from '../src/model/plan.ts';
import { fixtureSession } from './fixture.ts';

const fixture = async () => ({ state: fixtureSession().history.current() });

const draftOf = (r: OutlineDraft | { error: string }): OutlineDraft => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

describe('외곽선 수정 (outlineEdit.ts)', () => {
  it('a floor without its own outline starts from the building outline; 완료 gives it its own, one 되돌리기 takes it back', async () => {
    const s0 = (await fixture()).state;
    const a = Object.values(s0.buildings).find((b) => b.id === 'bldg_A')!;
    let d = draftOf(startOutline(s0, 'bldg_A', 2));
    expect(d.corners).toHaveLength(a.polygon[0]!.length - 1);
    d = moveDraftCorner(d, 0, [126.9999, 36.9999]);
    d = insertDraftCorner(d, 1, [127.0005, 37.0001]);
    expect(d.past).toHaveLength(2);
    expect(undoDraft(d).corners).toHaveLength(d.corners.length - 1);
    expect(redoDraft(undoDraft(d)).corners).toEqual(d.corners);

    const h = createHistory(s0);
    const plan = planOutline(d);
    if ('error' in plan) throw new Error(plan.error);
    expect(runPlan(h, plan).ok).toBe(true);
    const after = Object.values(h.current().buildings).find((b) => b.id === 'bldg_A')!;
    expect(outlineOfLevel(after, 2)).toEqual(draftPolygon(d));
    expect(after.polygon).toEqual(a.polygon);
    h.undo();
    expect(h.current()).toEqual(s0);
  });

  it('a corner cannot go below three; a floor with its own outline starts from it and can go back to the building outline', async () => {
    const s0 = (await fixture()).state;
    let d = draftOf(startOutline(s0, 'bldg_B', 2));
    expect(d.corners[1]).toEqual([127.0013, 37.0003]);
    d = draftOf(removeDraftCorner(d, 0) as OutlineDraft);
    expect(removeDraftCorner(d, 0)).toMatchObject({ error: expect.stringContaining('3개 이상') });
    const h = createHistory(s0);
    const reset = planResetOutline(s0, 'bldg_B', 2);
    if ('error' in reset) throw new Error(reset.error);
    expect(runPlan(h, reset).ok).toBe(true);
    expect(planResetOutline(h.current(), 'bldg_B', 2)).toMatchObject({ error: expect.stringContaining('이미') });
    expect(startOutline(s0, 'bldg_B', 9)).toMatchObject({ error: expect.any(String) });
  });
});
