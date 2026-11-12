// SPEC-v0.2 6.5 "클릭 수 예시": one empty floor made with the tools. Prints how many clicks it took.
// Corridor 1, classrooms 20 and doors 30, stairs 1, elevator 1. The saved folder must pass validateCampus.
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { Editor, checkSaved } from './support.ts';

const SHOT = fileURLToPath(new URL('../../../docs/v0.2/screenshots/door-tool-preview.png', import.meta.url));
const Y = 37.0003; // the corridor
const M3 = 0.000027; // about 3 m, in latitude

test('빈 2층에 복도, 강의실 20개, 문 30개, 계단, 엘리베이터를 클릭 40번 안팎으로 만듭니다', async ({ page }) => {
  const ed = new Editor(page);
  await ed.open('e2e-floor');

  // The floor: 건물 선택 -> the building -> 2층
  await ed.click(ed.tool('건물 선택'));
  await ed.clickMap([127.0005, 37.0004]);
  await ed.click(page.getByRole('navigation', { name: 'A동 층 선택' }).getByRole('button', { name: '2층' }));
  await expect(page.locator('.status-mode')).toHaveText('A동 2층');

  // Corridor: two clicks and Enter. The first click is inside the outline, so it is a corridor of this floor.
  await ed.click(ed.tool('길 그리기'));
  await ed.clickMap([127.0002, Y]);
  await ed.clickMap([127.0008, Y]);
  await page.keyboard.press('Enter');
  await expect(page.locator('.status-message')).toContainText('복도 1구간 그리기: 완료했습니다');

  // Classrooms on the south side: 강의실 줄 = corridor, first door, last door (3 clicks), then the numbers and Enter.
  await ed.click(ed.tool('강의실 줄'));
  await ed.clickMap([127.0005, Y]);
  await ed.clickMap([127.00025, Y - M3]);
  await ed.clickMap([127.00075, Y - M3]);
  await page.locator('.strip-ref').fill('401');
  await expect(page.locator('.strip-status')).toContainText('문 10개');
  await page.keyboard.press('Enter'); // focus is in the field: its own Enter handler runs the row
  await expect(page.locator('.status-message')).toContainText('강의실 10개 문 놓기: 완료했습니다');

  // The other side: 문 연속 찍기. A front door per click, Shift+click for the back door of the same room. The number counts up by itself.
  await ed.click(ed.tool('문 연속 찍기'));
  await page.locator('.door-ref').fill('301');
  await page.locator('.toolbar-main').click({ position: { x: 5, y: 5 } }); // leave the field so keys reach the map (not counted: not a map click)
  for (let i = 0; i < 10; i++) {
    const x = 127.00022 + i * 0.00005;
    await ed.clickMap([x, Y + M3]);
    if (i === 4 && process.env['CAMPO_E2E_SHOT']) {
      // the preview the tool shows while the mouse moves: foot of the perpendicular, its link, and the scope next to the cursor
      await ed.view([x + 0.00012, Y], 20.2);
      const at = await ed.px([x + 0.00012, Y + M3 * 1.3]);
      await page.mouse.move(at.x, at.y);
      await page.waitForTimeout(600);
      await page.screenshot({ path: SHOT });
      await ed.view([127.0005, 37.0003], 18.4);
    }
    await ed.clickMap([x + 0.00002, Y + M3], { shift: true });
  }
  await expect(page.locator('.door-ref')).toHaveValue('311');

  // Stairs: 지점 추가 -> 계단, one click on the map, one in the form.
  await ed.click(ed.tool('지점 추가'));
  await ed.click(page.locator('.toolbar-options label.kind').filter({ hasText: '계단' }));
  await ed.clickMap([127.0003, 37.0005]);
  await ed.click(page.getByRole('button', { name: '계단 만들기' }));

  // Elevator: the tool, one click, the form (every floor checked).
  await ed.click(ed.tool('엘리베이터'));
  await ed.clickMap([127.00078, Y + M3]);
  await ed.click(page.getByRole('button', { name: '엘리베이터 만들기' }));
  await expect(page.locator('.status-message')).toContainText('엘리베이터 추가');

  await ed.save();
  const { campus, result } = checkSaved('e2e-floor');
  expect(result.errors).toEqual([]);

  const nodes = campus.features.map((f) => f.feature).filter((f) => (f as { properties: { kind: string } }).properties.kind === 'node') as { properties: { node_type: string; level: number | null; room_ref?: string; elevator_id?: string } }[];
  const doors = nodes.filter((n) => n.properties.node_type === 'door' && n.properties.level === 2);
  expect(doors).toHaveLength(30);
  expect(new Set(doors.map((d) => d.properties.room_ref)).size).toBe(20);
  expect(nodes.filter((n) => n.properties.node_type === 'elevator_stop')).toHaveLength(4);
  console.log(`floor-in-60-clicks: ${ed.clicks} clicks`);
  expect(ed.clicks).toBeLessThanOrEqual(60);
});
