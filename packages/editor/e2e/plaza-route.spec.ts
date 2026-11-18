// 평지 위 지점 (fix/plaza-broken-and-routing): a point placed on a plaza is joined through it, so 끊긴 지점 찾기 shows no
// ring there, and 경로 테스트 finds a route from that very point (a { nodeId } end) across the plaza onto a road.
import { expect, test } from '@playwright/test';
import { buildGraph, findRouteBetween } from '@campo/core';
import { checkSaved, Editor } from './support.ts';

/** Only used inside page.evaluate, where it is the browser's window (this folder is checked without DOM types). */
declare const window: object;

type Lnglat = [number, number];
const SHOTS = process.env['CAMPO_SHOTS'] ?? 'test-results';
const PLAZA: Lnglat[] = [[127.0001, 36.9989], [127.0009, 36.9989], [127.0009, 36.9994], [127.0001, 36.9994]];
/** The seeded outdoor point north of the plaza (it hangs on A동's entrance) and the plaza's top edge below it. */
const SEED_POINT: Lnglat = [127.0005, 36.9996];
const TOP_EDGE: Lnglat = [127.0005, 36.9994];
const EAST_FAR: Lnglat = [127.0012, 36.99915];
const EAST_EDGE: Lnglat = [127.0009, 36.99915];
const ON_PLAZA: Lnglat = [127.0003, 36.99915];

async function brokenRings(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const map = (window as unknown as { __campoMap: { queryRenderedFeatures(o: object): unknown[] } }).__campoMap;
    return map.queryRenderedFeatures({ layers: ['campo-nodes-broken'] }).length;
  });
}

test('평지 위 지점: 끊긴 지점이 아니고, 그 지점에서 평지를 건너 길로 가는 경로가 그려진다', async ({ page }) => {
  const ed = new Editor(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ed.open('e2e-plaza-route');
  await ed.view([127.0006, 36.99925], 18.6);

  // ---- 평지, a road from the seeded point down to its top edge, a road from the east onto its right edge ----
  await ed.click(ed.tool('평지'));
  for (const p of PLAZA) await ed.clickMap(p);
  await page.keyboard.press('Enter');
  await expect(page.locator('.status-message')).toContainText('평지 추가: 완료했습니다');
  await page.keyboard.press('Escape');
  await ed.click(ed.tool('길 그리기'));
  await ed.clickMap(SEED_POINT);
  await ed.clickMap(TOP_EDGE);
  await page.keyboard.press('Enter');
  await expect(page.locator('.status-message')).toContainText('완료했습니다');
  await ed.clickMap(EAST_FAR);
  await ed.clickMap(EAST_EDGE);
  await page.keyboard.press('Enter');
  await expect(page.locator('.status-message')).toContainText('완료했습니다');
  await page.keyboard.press('Escape');

  // ---- 지점 추가: a 출발·도착 후보 in the middle of the plaza, joined to no edge ----
  await ed.click(ed.tool('지점 추가'));
  await page.locator('label.kind', { hasText: '출발·도착 후보' }).click();
  await ed.clickMap(ON_PLAZA);
  await page.getByRole('dialog').getByRole('textbox').first().fill('분수대');
  await page.getByRole('dialog').getByRole('button', { name: '후보 만들기' }).click();
  await expect(page.locator('.status-message')).toContainText('완료했습니다');
  await page.keyboard.press('Escape');
  await ed.click(ed.tool('선택'));

  // ---- 오류 검사: no broken point, no red ring on the map ----
  await ed.click(page.getByRole('tab', { name: /오류 검사/ }));
  await expect(page.locator('.panel-empty, .check-broken .check-empty').first()).toContainText('끊긴 지점');
  await expect(page.locator('.check-broken .check-item')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await brokenRings(page)).toBe(0);
  await page.screenshot({ path: `${SHOTS}/plaza-point-not-broken.png` });

  // ---- 경로 테스트: from the point itself (a place), to a point picked near the east road's far end ----
  await ed.click(page.getByRole('tab', { name: '경로 테스트' }));
  const options = await page.locator('.route-panel datalist').first().locator('option').evaluateAll(
    (os) => os.map((o) => (o as unknown as { value: string }).value),
  );
  const label = options.find((v) => v === '분수대') ?? '';
  expect(label, options.join(' | ')).toBe('분수대');
  await page.locator('.route-panel .route-end input').first().fill(label);
  await ed.click(page.locator('.route-panel .route-direct').nth(1));
  await ed.clickMap([127.00118, 36.99915]);
  await expect(page.locator('.route-panel')).toContainText('가로질러 지나갑니다');
  await page.waitForTimeout(400);
  const drawn = await page.evaluate(async () => {
    const map = (window as unknown as { __campoMap: { getSource(id: string): { getData(): Promise<{ features: { properties: { profile: string }; geometry: { type: string; coordinates: unknown[] } }[] }> } } }).__campoMap;
    const data = await map.getSource('campo-routes').getData();
    return data.features.filter((f) => f.geometry.type === 'LineString' && f.properties.profile !== 'snap').map((f) => f.geometry.coordinates.length);
  });
  expect(drawn.length).toBeGreaterThan(0);
  expect(Math.max(...drawn)).toBeGreaterThanOrEqual(3);
  await page.screenshot({ path: `${SHOTS}/plaza-point-route.png` });
  expect(errors).toEqual([]);

  // ---- the saved campus routes from the point too ----
  await ed.save();
  const { campus, result } = checkSaved('e2e-plaza-route');
  expect(result.errors).toEqual([]);
  const g = buildGraph(campus, { overrides: [], calibration: {} });
  const poi = [...g.nodes.values()].find((n) => n.properties.node_type === 'poi')!;
  const far = [...g.nodes.values()].find((n) => Math.abs(n.geometry.coordinates[0] - EAST_FAR[0]) < 2e-6)!;
  for (const profile of ['shortest', 'step_free', 'wheelchair'] as const) {
    expect(findRouteBetween(g, { nodeId: poi.id }, { nodeId: far.id }, profile).found).toBe(true);
    expect(findRouteBetween(g, { nodeId: poi.id }, { nodeId: 'n_A_1_entrance_seed01' }, profile).found).toBe(true);
  }
});
