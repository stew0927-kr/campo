// SPEC-v0.2 2.7, 3.8, 3.9: draw an escalator pair with the E tool, see the routes change, type two measurements, save,
// run `npm run calibrate`'s CLI on the temporary folder, and see the estimate and the longer route after reloading.
// Everything happens in a temporary campus folder (CAMPO_CAMPUSES_DIR); data/ is never touched.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { Editor, checkSaved, readSaved } from './support.ts';
import { E2E_DIR, ESCALATOR } from './seed.ts';

const CAMPUS = 'e2e-escalator';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SHOTS = join(REPO, 'docs', 'v0.2', 'screens');
const shot = (page: Page, name: string) => (process.env['CAMPO_E2E_SHOT'] ? page.screenshot({ path: join(SHOTS, name) }) : Promise.resolve(undefined));

/** The tab 길찾기: the two cards for 101호 -> 201호. Returns the cards and the minutes of the shortest one. */
async function route(page: Page, ed: Editor): Promise<{ shortest: Locator; stepFree: Locator; minutes: number }> {
  await ed.click(page.getByRole('tab', { name: '경로 테스트' }));
  await page.getByLabel('출발', { exact: true }).fill(ESCALATOR.from);
  await page.getByLabel('도착', { exact: true }).fill(ESCALATOR.to);
  const shortest = page.getByRole('region', { name: '계단 포함 최단 경로' });
  const stepFree = page.getByRole('region', { name: '계단 없는 경로' });
  await expect(shortest.locator('.route-stats')).toBeVisible();
  const text = await shortest.locator('.route-stats div', { hasText: '시간' }).locator('dd').innerText();
  return { shortest, stepFree, minutes: parseFloat(text) };
}

async function showFloor(page: Page, ed: Editor, floor: string): Promise<void> {
  await ed.click(ed.tool('건물 선택'));
  await ed.clickMap([127.0005, 37.0004]);
  await ed.click(page.getByRole('navigation', { name: 'A동 층 선택' }).getByRole('button', { name: floor }));
}

test('에스컬레이터 한 쌍을 그리고, 측정 두 개를 넣고, 보정한 뒤 길찾기 시간이 늘어납니다', async ({ page }) => {
  const ed = new Editor(page);
  await ed.open(CAMPUS);

  // ---- 1. The E tool: first point on 1층, the small window (방향, 층), second point on 2층 ----
  await showFloor(page, ed, '1층');
  await ed.click(ed.tool('에스컬레이터'));
  await ed.clickMap(ESCALATOR.lowerStart);
  const window_ = page.getByRole('region', { name: '에스컬레이터 끝 지점 고르기' });
  await expect(window_).toBeVisible();
  await expect(page.locator('.status-mode')).toHaveText('A동 2층'); // the floor above is shown, only its points are dark
  await expect(window_.getByRole('group', { name: '위쪽 층' }).getByRole('button', { name: '2층' })).toHaveAttribute('aria-pressed', 'true');
  await ed.click(window_.getByRole('radio', { name: '상행+하행 한 쌍' }));
  await shot(page, 'escalator-window.png');
  await ed.clickMap(ESCALATOR.upperStart);
  await expect(page.locator('.status-message')).toContainText('에스컬레이터 추가(상행+하행 한 쌍): 완료했습니다');
  await expect(window_).toBeHidden();

  // the pair is drawn side by side, each with its arrow
  await ed.view([(ESCALATOR.lowerStart[0] + ESCALATOR.upperStart[0]) / 2, ESCALATOR.lowerStart[1]], 20.2);
  await shot(page, 'escalator-pair.png');
  await ed.view([127.0005, 37.0003], 18.4);

  // ---- 2. The routes: 최단 goes up the escalator, 계단 없는 경로 takes the elevator ----
  const before = await route(page, ed);
  await expect(before.shortest).toContainText('에스컬레이터');
  await expect(before.stepFree).toContainText('엘리베이터');
  await expect(before.stepFree).not.toContainText('에스컬레이터');
  await shot(page, 'escalator-routes.png');

  // ---- 3. Select the 상행 belt (the left one of the pair) and add two measurements ----
  await ed.click(ed.tool('선택'));
  const mid = await ed.px([(ESCALATOR.lowerStart[0] + ESCALATOR.upperStart[0]) / 2, ESCALATOR.lowerStart[1]]);
  await page.mouse.click(mid.x, mid.y - 5); // 5 px to the left of the way it was drawn (east): the 상행 side
  ed.clicks++;
  await expect(page.locator('.props-kind')).toHaveText('에스컬레이터');
  await expect(page.locator('.conveying-note')).toContainText('그린 방향(시작 → 끝)으로 움직입니다');
  const measure = page.getByRole('region', { name: '측정' });
  await expect(measure).toContainText('현재 추정값아직 없음');
  for (const seconds of ['85', '95']) {
    await ed.click(measure.getByRole('button', { name: '측정 추가' }));
    await page.getByLabel('시간(초)').fill(seconds);
    await ed.click(page.getByRole('button', { name: '측정 넣기' }));
    await expect(page.getByRole('dialog')).toBeHidden();
  }
  await expect(measure).toContainText('측정2개');
  await expect(measure).toContainText('저장한 뒤 npm run calibrate를 다시 돌리세요.');
  await expect(measure.getByRole('button', { name: '저장 전 측정 2개 · 지우기' })).toBeVisible();
  await shot(page, 'measure-panel.png');

  // ---- 4. Save: the layout files and observations/editor.jsonl; calibration.json is not the editor's to write ----
  await ed.save();
  const saved = checkSaved(CAMPUS);
  expect(saved.result.errors).toEqual([]);
  expect(saved.result.warnings).toEqual([]);
  const lines = readSaved(CAMPUS).find((f) => f.path === 'observations/editor.jsonl')!.text.trim().split('\n').map((l) => JSON.parse(l) as { target: string; duration_sec: number; source: string });
  expect(lines.map((l) => l.duration_sec)).toEqual([85, 95]);
  expect(lines.every((l) => l.source === 'field' && l.target.startsWith('edge:'))).toBe(true);
  expect(existsSync(join(E2E_DIR, CAMPUS, 'calibration.json'))).toBe(false);
  await expect(measure.getByRole('button', { name: /지우기/ })).toBeHidden();

  // ---- 5. npm run calibrate's CLI, on the temporary folder only ----
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const out = execFileSync(process.execPath, [tsx, join(REPO, 'packages', 'tools', 'src', 'calibrate.ts'), join(E2E_DIR, CAMPUS)], { encoding: 'utf8' });
  const calibration = JSON.parse(readFileSync(join(E2E_DIR, CAMPUS, 'calibration.json'), 'utf8')) as Record<string, { n: number; estimate_sec: number; prior_sec: number }>;
  const entries = Object.entries(calibration);
  expect(entries, out).toHaveLength(1);
  const [key, entry] = entries[0]!;
  expect(key.startsWith('edge:')).toBe(true);
  expect(entry.n).toBe(2);
  expect(entry.estimate_sec).toBeGreaterThan(entry.prior_sec);

  // ---- 6. Load again: the estimate is there, the notice is gone, and the shortest route got longer ----
  await ed.open(CAMPUS);
  const after = await route(page, ed);
  console.log(`escalator.spec: shortest ${before.minutes} min -> ${after.minutes} min after calibration (estimate ${entry.estimate_sec}s, prior ${entry.prior_sec}s)`);
  expect(after.minutes).toBeGreaterThan(before.minutes);
  await expect(after.shortest).toContainText('에스컬레이터'); // still faster than the elevator, even with the measured time
  await showFloor(page, ed, '2층');
  await ed.click(ed.tool('선택'));
  const mid2 = await ed.px([(ESCALATOR.lowerStart[0] + ESCALATOR.upperStart[0]) / 2, ESCALATOR.lowerStart[1]]);
  await page.mouse.click(mid2.x, mid2.y - 5);
  ed.clicks++;
  await ed.click(page.getByRole('tab', { name: '상세 정보' }));
  const measure2 = page.getByRole('region', { name: '측정' });
  await expect(measure2).toContainText('측정2개');
  await expect(measure2).toContainText(`현재 추정값${entry.estimate_sec.toFixed(1)}초`);
  await expect(measure2).not.toContainText('npm run calibrate');
  await shot(page, 'measure-calibrated.png');
  console.log(`escalator.spec: ${ed.clicks} clicks`);
});
