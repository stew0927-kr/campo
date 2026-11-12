// SPEC-v0.2 5.2: working on a floor, a path drawn outside stays outdoors without a mode switch,
// and reaching an entrance turns that segment into a portal.
import { expect, test } from '@playwright/test';
import { Editor, checkSaved } from './support.ts';
import { ENTRANCE } from './seed.ts';

test('3층을 보는 채로 바깥 길 2구간을 그리고 출입구에 붙이면 포탈 구간이 생깁니다', async ({ page }) => {
  const ed = new Editor(page);
  await ed.open('e2e-scope');

  // Show the 3rd floor of A동.
  await ed.click(ed.tool('건물 선택'));
  await ed.clickMap([127.0005, 37.0003]);
  await ed.click(page.getByRole('navigation', { name: 'A동 층 선택' }).getByRole('button', { name: '3층' }));
  await expect(page.locator('.status-mode')).toHaveText('A동 3층');

  // 길 그리기: no other mode is chosen. The first click is outside the outline, so the path is an outdoor path.
  await ed.click(ed.tool('길 그리기'));
  await ed.clickMap([127.0002, 36.99985]);
  await ed.clickMap([127.0003, 36.9999]);
  await ed.clickMap([127.0004, 36.99995]);
  await ed.clickMap(ENTRANCE); // the entrance is on the 1st floor, inside the outline: it still attaches from outdoors
  await page.keyboard.press('Enter'); // finish
  await expect(page.locator('.status-message')).toContainText('바깥 길 3구간 그리기: 완료했습니다');
  await expect(page.locator('.status-mode')).toHaveText('A동 3층');

  await ed.save();
  const { campus, result } = checkSaved('e2e-scope');
  expect(result.errors).toEqual([]);
  const edges = campus.features.map((f) => f.feature).filter((f) => (f as { properties: { kind: string } }).properties.kind === 'edge') as { id: string; properties: { edge_type: string; from: string; to: string } }[];
  expect(edges.filter((e) => e.properties.edge_type === 'outdoor')).toHaveLength(2);
  const portals = edges.filter((e) => e.properties.edge_type === 'portal' && e.id !== 'e_conn_seed01');
  expect(portals).toHaveLength(1);
  expect([portals[0]!.properties.from, portals[0]!.properties.to]).toContain('n_A_1_entrance_seed01');
  // the segments were never given floor numbers: outdoor ways have no building or level
  console.log(`scope.spec: ${ed.clicks} clicks`);
});
