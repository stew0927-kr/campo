// 건물 외곽선: delete while its floor is shown (then draw a new building, undo everything), the 상세 정보 panel,
// the compass beside the scale bar, and the map limits read from campus.json.
import { expect, test, type Page } from '@playwright/test';
import { Editor, checkSaved } from './support.ts';
import { CENTER } from './seed.ts';

/** Only used inside page.evaluate, where it is the browser's window (this folder is checked without DOM types). */
declare const window: object;

const A_EDGE: [number, number] = [127.0005, 37]; // on the bottom edge of A동's outline

async function selectBuildingA(ed: Editor, page: Page) {
  await ed.click(ed.tool('선택'));
  await ed.clickMap(A_EDGE);
  await expect(page.getByRole('region', { name: '건물 정보' })).toBeVisible();
}

test('3층을 보는 중에 건물을 지워도 바깥으로 돌아와 새 건물을 그릴 수 있고, 되돌리면 건물이 그대로 돌아옵니다', async ({ page }) => {
  const ed = new Editor(page);
  await ed.open('e2e-building');

  // Work on A동 3층, then select the outline (still on that floor) and delete it.
  await ed.click(ed.tool('건물 선택'));
  await ed.clickMap([127.0005, 37.0003]);
  await ed.click(page.getByRole('navigation', { name: 'A동 층 선택' }).getByRole('button', { name: '3층' }));
  await expect(page.locator('.status-mode')).toHaveText('A동 3층');
  await selectBuildingA(ed, page);
  await page.keyboard.press('Delete');
  await page.getByRole('dialog', { name: '건물 삭제' }).getByRole('button', { name: '삭제' }).click();

  // The screen is back outdoors at once and 건물 외곽선 그리기 works again.
  await expect(page.locator('.status-mode')).toHaveText('바깥 모드');
  await expect(ed.tool('건물 외곽선 그리기')).toBeEnabled();
  await expect(page.getByRole('navigation', { name: 'A동 층 선택' })).toHaveCount(0);

  await ed.click(ed.tool('건물 외곽선 그리기'));
  const ring: [number, number][] = [[127.0012, 37.0001], [127.0015, 37.0001], [127.0015, 37.0004], [127.0012, 37.0004]];
  for (const p of ring) await ed.clickMap(p);
  await page.keyboard.press('Enter'); // finish the outline
  const dialog = page.getByRole('dialog', { name: '건물 등록' });
  await expect(dialog).toBeVisible();
  // no example text is left in the fields
  await expect(dialog.getByLabel('이름')).not.toHaveAttribute('placeholder', /.+/);
  await expect(dialog.getByLabel('코드')).not.toHaveAttribute('placeholder', /.+/);
  await dialog.getByLabel('이름').fill('새 건물');
  await dialog.getByLabel('코드').fill('NEW1');
  await dialog.getByRole('button', { name: '건물 만들기' }).click();
  await expect(page.locator('.status-message')).toContainText('건물 "새 건물" 추가: 완료했습니다');

  // Ctrl+Z twice: the new building goes, then A동 comes back whole (its entrance and its portal edge).
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await ed.save();
  const { campus, result } = checkSaved('e2e-building');
  expect(result.errors).toEqual([]);
  const ids = campus.features.map((f) => (f.feature as { id: string }).id);
  expect(ids).toContain('bldg_A');
  expect(ids).toContain('n_A_1_entrance_seed01');
  expect(ids).not.toContain('bldg_NEW1');
});

test('건물 외곽선을 누르면 이름·코드·층을 고칠 수 있고, 코드를 바꿔도 되돌리기 한 번으로 돌아옵니다', async ({ page }) => {
  const ed = new Editor(page);
  await ed.open('e2e-building');
  await selectBuildingA(ed, page);
  const panel = page.getByRole('region', { name: '건물 정보' });
  await expect(panel.getByLabel('이름')).toHaveValue('A동');
  await expect(panel.getByLabel('코드')).toHaveValue('A');
  for (const floor of ['1층', '2층', '3층', '4층']) await expect(panel.locator('.level-chip').filter({ hasText: floor })).toHaveCount(1);

  // name
  await panel.getByLabel('이름').fill('공학관');
  await panel.getByLabel('이름').press('Enter');
  await expect(page.locator('.status-message')).toContainText('건물 이름을 "공학관"(으)로 바꾸기: 완료했습니다');

  // a floor that has points cannot be removed (1층 has the entrance); an empty one can
  const one = panel.getByRole('button', { name: '1층 지우기' });
  await expect(one).toHaveAttribute('aria-disabled', 'true');
  await one.click({ force: true }); // aria-disabled: still clickable, and then it says why
  await expect(panel.getByRole('alert')).toContainText('1층(지점 1개');
  await panel.getByRole('button', { name: '4층 지우기' }).click();
  await expect(panel.locator('.level-chip').filter({ hasText: '4층' })).toHaveCount(0);
  await panel.getByLabel('추가할 층').fill('5');
  await panel.getByRole('button', { name: '층 추가' }).click();
  await expect(panel.locator('.level-chip').filter({ hasText: '5층' })).toHaveCount(1);

  // code: a taken or invalid one says why and cannot be applied
  await panel.getByLabel('코드').fill('A B');
  await expect(panel.getByRole('alert')).toContainText('영문자와 숫자');
  await expect(panel.getByRole('button', { name: '코드 바꾸기' })).toHaveAttribute('aria-disabled', 'true');
  await panel.getByLabel('코드').fill('ENG1');
  await panel.getByRole('button', { name: '코드 바꾸기' }).click();
  await expect(page.locator('.status-message')).toContainText('건물 코드 A → ENG1: 완료했습니다');
  // the panel keeps showing the same building under its new code
  await expect(panel.getByLabel('코드')).toHaveValue('ENG1');

  await page.keyboard.press('Control+z'); // the code only: the data is back under A (the selection of the old id is gone, so pick it again)
  await ed.clickMap(A_EDGE);
  await expect(panel.getByLabel('코드')).toHaveValue('A');

  await page.keyboard.press('Control+Shift+z');
  await ed.save();
  const { campus, result } = checkSaved('e2e-building');
  expect(result.errors).toEqual([]);
  const features = campus.features.map((f) => f.feature as { id: string; properties: Record<string, unknown> });
  expect(features.find((f) => f.id === 'bldg_ENG1')?.properties).toMatchObject({ code: 'ENG1', name: '공학관', levels: [1, 2, 3, 5] });
  expect(features.find((f) => f.id === 'n_A_1_entrance_seed01')?.properties['building_id']).toBe('bldg_ENG1');
  expect(campus.features.some((f) => f.file.startsWith('buildings/ENG1/'))).toBe(true);
  expect(campus.features.some((f) => f.file.startsWith('buildings/A/'))).toBe(false);
});

test('나침반이 축척 옆에 있고, 지도를 돌리면 바늘이 돌고, 누르면 정북으로 돌아옵니다', async ({ page }) => {
  const ed = new Editor(page);
  await ed.open('e2e-building');
  const compass = page.locator('.maplibregl-ctrl-compass');
  const scale = page.locator('.maplibregl-ctrl-scale');
  await expect(compass).toBeVisible();
  await expect(scale).toBeVisible();
  const [c, s] = [await compass.boundingBox(), await scale.boundingBox()];
  expect(Math.abs((c!.y + c!.height / 2) - (s!.y + s!.height / 2))).toBeLessThan(40); // same row
  expect(c!.x).toBeLessThan(s!.x); // beside it, on its left

  const bearing = () => page.evaluate(() => (window as unknown as { __campoMap: { getBearing(): number } }).__campoMap.getBearing());
  await page.evaluate(() => (window as unknown as { __campoMap: { setBearing(b: number): void } }).__campoMap.setBearing(60));
  await expect.poll(bearing).toBeCloseTo(60, 0);
  await expect(page.locator('.maplibregl-ctrl-compass .maplibregl-ctrl-icon')).toHaveCSS('transform', /matrix/); // the needle turned with the map
  await compass.click();
  await expect.poll(async () => Math.abs(await bearing()), { timeout: 5000 }).toBeLessThan(0.5);
});

test('campus.json의 map_limits만큼만 지도를 옮기고 확대·축소할 수 있습니다', async ({ page }) => {
  const ed = new Editor(page);
  await ed.open('e2e-building');
  const state = () => page.evaluate(() => {
    const m = (window as unknown as { __campoMap: { getCenter(): { lng: number; lat: number }; getMaxBounds(): { getWest(): number; getEast(): number; getSouth(): number; getNorth(): number } | null; getMinZoom(): number; getMaxZoom(): number } }).__campoMap;
    const b = m.getMaxBounds();
    return { center: m.getCenter(), bounds: b && [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], minZoom: m.getMinZoom(), maxZoom: m.getMaxZoom() };
  });
  const s = await state();
  expect(s.bounds).toEqual([126.995, 36.995, 127.006, 37.005]); // from campus.json, not from the code
  expect(s.minZoom).toBe(15);
  expect(s.maxZoom).toBe(22);

  // Fly far away (a km east): the map stays inside the declared area.
  await ed.view([127.02, 37.0003], 18.4);
  const after = await state();
  expect(after.center.lng).toBeLessThanOrEqual(127.006);
  expect(after.center.lng).toBeGreaterThan(CENTER[0]);
});
