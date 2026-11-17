// 평지: draw a plaza, cut a hole in it, see 상세 정보, undo and redo, delete it, save (SPEC-v0.2 2.8).
import { expect, test } from '@playwright/test';
import { checkSaved, Editor } from './support.ts';

type Lnglat = [number, number];
const OUTER: Lnglat[] = [[127.0001, 36.9989], [127.0009, 36.9989], [127.0009, 36.9994], [127.0001, 36.9994]];
const HOLE: Lnglat[] = [[127.0004, 36.99905], [127.0006, 36.99905], [127.0006, 36.99925], [127.0004, 36.99925]];

test('평지: draw, hole, panel, undo / redo, delete, save', async ({ page }) => {
  const ed = new Editor(page);
  await ed.open('e2e-plaza');
  await ed.view([127.0005, 36.99915], 19);
  await ed.click(ed.tool('평지'));
  for (const p of OUTER) await ed.clickMap(p);
  await expect(page.locator('.status-message')).toContainText('새 평지를 그립니다.');
  await page.keyboard.press('Enter');
  await expect(page.locator('.status-message')).toContainText('평지 추가: 완료했습니다');
  // The new plaza is selected with 상세 정보 open.
  await expect(page.locator('.plaza-panel .props-kind')).toHaveText('평지');
  await expect(page.locator('.plaza-panel [data-fact="holes"]')).toHaveText('0개');

  // A ring started inside the plaza is a hole.
  await ed.clickMap(HOLE[0]!);
  await expect(page.locator('.status-message')).toContainText('안쪽에서 시작했습니다. 구멍으로 뚫립니다.');
  for (const p of HOLE.slice(1)) await ed.clickMap(p);
  await page.keyboard.press('Enter');
  await expect(page.locator('.status-message')).toContainText('구멍 뚫기: 완료했습니다');
  await expect(page.locator('.plaza-panel [data-fact="holes"]')).toHaveText('1개');
  await page.locator('.plaza-panel').getByLabel('평지 이름').fill('시험 광장');
  await page.locator('.plaza-panel').getByLabel('평지 이름').press('Enter');
  await expect(page.locator('.status-message')).toContainText('이름 바꾸기: 완료했습니다');
  await page.screenshot({ path: process.env['CAMPO_PLAZA_SHOT'] ?? 'test-results/plaza.png' });

  // One Ctrl+Z each: the name, the hole; Ctrl+Shift+Z brings them back (the name field lets the keys go first).
  await page.locator('.plaza-panel').getByLabel('평지 이름').blur();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await ed.click(ed.tool('선택'));
  await ed.clickMap([127.0002, 36.999]);
  await expect(page.locator('.plaza-panel [data-fact="holes"]')).toHaveText('0개');
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.plaza-panel [data-fact="holes"]')).toHaveText('1개');
  // A click in the hole does not pick the plaza.
  await ed.clickMap([127.0005, 36.99915]);
  await expect(page.locator('.plaza-panel')).toHaveCount(0);

  await ed.save();
  const { campus, result } = checkSaved('e2e-plaza');
  expect(result.errors).toEqual([]);
  const plaza = campus.features.map((f) => f.feature as { properties: { kind: string; name?: string }; geometry: { coordinates: unknown[] } })
    .find((f) => f.properties.kind === 'plaza')!;
  expect(plaza.properties.name).toBe('시험 광장');
  expect(plaza.geometry.coordinates).toHaveLength(2);

  // Delete with the selection's Delete.
  await ed.clickMap([127.0002, 36.999]);
  await page.keyboard.press('Delete');
  await expect(page.locator('.status-message')).toContainText('평지 1개 삭제: 완료했습니다');
});
