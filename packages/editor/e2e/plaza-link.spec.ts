// 평지-평지 연결과 마그넷 (fix/plaza-link-and-snap): two plazas drawn touching, the snap ring on a plaza edge and on a path,
// a path point on an existing path splitting it, a dragged point landing on a plaza edge, and the saved campus routing
// from plaza A across plaza B onto the path.
import { expect, test, type Page } from '@playwright/test';
import { buildGraph, findRouteBetween, localFrame, plazaAt, validateCampus, type PointRoute } from '@campo/core';
import { checkSaved, Editor } from './support.ts';

type Lnglat = [number, number];
const SHOTS = process.env['CAMPO_SHOTS'] ?? 'test-results';
// At zoom 19 in the 1440×900 test window 1 px is about 1.3e-6° of longitude and 1.1e-6° of latitude; offsets below are a few pixels.
const A: Lnglat[] = [[127.0001, 36.9988], [127.0004, 36.9988], [127.0004, 36.9992], [127.0001, 36.9992]];
// B starts ~2 px off A's right corners: the magnet puts them exactly on A's corners (plazas that meet are linked).
const B: Lnglat[] = [[127.000405, 36.99880], [127.0007, 36.9988], [127.0007, 36.9992], [127.000405, 36.99920]];
const ROAD: Lnglat[] = [[127.00085, 36.99865], [127.00085, 36.99935]];

async function snapShown(page: Page): Promise<{ kind: string; coordinates: number[] } | null> {
  return page.evaluate(async () => {
    const map = (window as unknown as { __campoMap: { getSource(id: string): { getData(): Promise<{ features: { properties: { kind: string }; geometry: { coordinates: number[] } }[] }> } } }).__campoMap;
    const data = await map.getSource('campo-snap').getData();
    const f = data.features[0];
    return f ? { kind: f.properties.kind, coordinates: f.geometry.coordinates } : null;
  });
}

async function hover(ed: Editor, at: Lnglat) {
  const { x, y } = await ed.px(at);
  await ed.page.mouse.move(x - 3, y - 3);
  await ed.page.mouse.move(x, y, { steps: 3 });
  await ed.page.waitForTimeout(120);
}

test('평지 A·B 맞닿게 그리기, 마그넷 미리보기, 길 위에 찍어 나눠 잇기, A → B → 길 경로', async ({ page }) => {
  const ed = new Editor(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ed.open('e2e-plaza-link');
  await ed.view([127.0005, 36.999], 19);

  // ---- 평지 A, then B touching it (snapped onto A's corners) ----
  await ed.click(ed.tool('평지'));
  for (const p of A) await ed.clickMap(p);
  await page.keyboard.press('Enter');
  await expect(page.locator('.status-message')).toContainText('평지 추가: 완료했습니다');
  await page.keyboard.press('Escape');
  await hover(ed, B[0]!);
  expect(await snapShown(page)).toMatchObject({ kind: 'node' }); // A's corner
  for (const p of B) await ed.clickMap(p);
  await page.keyboard.press('Enter');
  await expect(page.locator('.status-message')).toContainText('평지 추가: 완료했습니다');
  await page.keyboard.press('Escape');

  // ---- 지점 추가 (바깥 지점): the ring on B's bottom edge before the click; Alt hides it ----
  await ed.click(ed.tool('지점 추가'));
  await page.locator('label.kind', { hasText: '바깥 지점' }).click();
  await hover(ed, [127.00055, 36.998808]);
  const ring = await snapShown(page);
  expect(ring?.kind).toBe('plaza');
  expect(ring!.coordinates[1]).toBeCloseTo(36.9988, 9);
  await page.screenshot({ path: `${SHOTS}/plaza-edge-snap.png` });
  await page.keyboard.down('Alt');
  await hover(ed, [127.00056, 36.998808]);
  expect(await snapShown(page)).toBeNull();
  await page.keyboard.up('Alt');

  // ---- 길 그리기: a road, then a path from B's right edge onto the road (split there and joined) ----
  await ed.click(ed.tool('길 그리기'));
  for (const p of ROAD) await ed.clickMap(p);
  await page.keyboard.press('Enter');
  expect(errors).toEqual([]);
  await expect(page.locator('.status-message')).toContainText('바깥 길 1구간 그리기: 완료했습니다');
  await ed.clickMap([127.000704, 36.999]); // on B's right edge (magnet)
  await hover(ed, [127.000846, 36.999]); // ~1.5 px left of the road
  const onRoad = await snapShown(page);
  expect(onRoad?.kind).toBe('edge');
  expect(onRoad!.coordinates[0]).toBeCloseTo(127.00085, 9);
  await page.screenshot({ path: `${SHOTS}/path-edge-snap.png` });
  await ed.clickMap([127.000846, 36.999]);
  await page.keyboard.press('Enter');
  await expect(page.locator('.status-message')).toContainText('기존 구간 1곳 나눠 잇기');

  // ---- 지점 끌기 (선택): an outdoor point let go 2 px from A's top edge lands on it ----
  await ed.click(ed.tool('지점 추가'));
  await ed.clickMap([127.00025, 36.9993]);
  await ed.click(ed.tool('선택'));
  const from = await ed.px([127.00025, 36.9993]);
  const to = await ed.px([127.00025, 36.999205]);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  await ed.save();
  const { campus, result } = checkSaved('e2e-plaza-link');
  expect(result.errors).toEqual([]);
  expect(result.warnings.filter((w) => w.code.startsWith('plaza'))).toEqual([]);
  const g = buildGraph(campus, { overrides: [], calibration: {} });
  const nodes = [...g.nodes.values()];
  // The dragged point sits on A's top edge.
  expect(nodes.some((n) => Math.abs(n.geometry.coordinates[1] - 36.9992) < 1e-9 && Math.abs(n.geometry.coordinates[0] - 127.00025) < 2e-6)).toBe(true);
  // The road was split where the path met it: three road nodes in a line at lng 127.00085.
  const onLine = nodes.filter((n) => Math.abs(n.geometry.coordinates[0] - 127.00085) < 1e-9);
  expect(onLine).toHaveLength(3);
  const top = onLine.sort((a, b) => b.geometry.coordinates[1] - a.geometry.coordinates[1])[0]!;
  // Route: a point on plaza A, across B, onto the path, to the road's top end.
  const start: Lnglat = [127.0002, 36.999];
  const on = plazaAt(g, start);
  expect(on?.plaza.id).toBeDefined();
  const r = findRouteBetween(g, { plaza: { plazaId: on!.plaza.id, point: start } }, { nodeId: top.id }, 'shortest');
  expect(r.found).toBe(true);
  const route = r as PointRoute;
  expect(route.startPlaza?.plazaIds?.length).toBe(2);
  const f = localFrame(start);
  const across = Math.hypot(...f.toXY([127.000704, 36.999]));
  expect(route.startPlaza!.lengthM).toBeGreaterThan(across - 1.5);
  expect(validateCampus(campus).errors).toEqual([]);

  // ---- 경로 테스트 화면: 직접 선택 on plaza A, then near the road's top end; the card names both plazas ----
  await ed.click(ed.tool('선택'));
  await ed.click(page.getByRole('tab', { name: '경로 테스트' }));
  const directs = page.locator('.route-panel .route-direct');
  await ed.click(directs.nth(0));
  await ed.clickMap([127.0002, 36.999]);
  await ed.click(directs.nth(1));
  await ed.clickMap([127.00085, 36.9993]);
  await expect(page.locator('.route-panel')).toContainText('평지');
  await expect(page.locator('.route-panel')).toContainText('·');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/plaza-link-route.png` });
});
