// SPEC-v0.2 7.3: the 제보 tab processes the 8 sample reports of the fixture campus.
//   temporary ones (elevator, locked door, construction) -> overrides.json, the map is not touched
//   permanent ones (stairs, door place, restroom, and the two same-spot step_free reports as one bundle) -> one changeset file
// Everything is written to temporary folders (E2E_DIR); the changeset is left in <E2E_DIR>/changesets and the campus as it was
// before saving in <E2E_DIR>/pristine, so a person can run `npm run apply -- <changeset> --campuses-dir=<E2E_DIR>/pristine --dry-run`.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateChangeset, validateReport, type Changeset, type Report } from '@campo/core';
import { expect, test, type Page } from '@playwright/test';
import { CHANGESETS_DIR, E2E_DIR, PRISTINE_DIR, REPORTS_CAMPUS, REPORTS_DIR } from './seed.ts';
import { Editor, checkSaved } from './support.ts';

const SHOTS = join(fileURLToPath(new URL('../../../', import.meta.url)), 'docs', 'v0.2', 'screens');
const shot = (page: Page, name: string) => (process.env['CAMPO_E2E_SHOT'] ? page.screenshot({ path: join(SHOTS, name) }) : Promise.resolve(undefined));

/** The clock the editor sees: before the sample reports' `until` dates (2026-11-14 and 2026-11-20), after they came in. */
const NOW = new Date('2026-11-13T09:00:00+09:00');

const readReports = (): Report[] => readdirSync(REPORTS_DIR).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(REPORTS_DIR, f), 'utf8')) as Report);

test('8개 샘플 제보를 처리하고 저장하면 changeset 1개와 overrides가 생깁니다', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  const ed = new Editor(page);
  await ed.open(REPORTS_CAMPUS);
  const pristineBefore = readFileSync(join(PRISTINE_DIR, REPORTS_CAMPUS, 'buildings', 'A', 'L1.geojson'), 'utf8');

  const undo = page.getByRole('group', { name: '편집 작업' }).getByRole('button', { name: /^되돌리기/ });

  // ---- the tab: badge, queue, the bundle ----
  const tab = page.getByRole('tab', { name: /^제보/ });
  await expect(tab.getByLabel('대기 중인 제보 8건')).toBeVisible();
  await tab.click();
  const queue = page.getByRole('list', { name: '제보 대기열' });
  const rows = queue.getByRole('listitem', { name: /^제보 rp-/ });
  await expect(rows).toHaveCount(7); // 8 reports, two of them one bundle
  const bundle = queue.getByRole('listitem', { name: '제보 rp-20261112-0007' });
  await expect(bundle).toContainText('묶음 2건');
  await expect(bundle.getByRole('button', { name: 'rp-20261112-0008 묶음에서 빼기' })).toBeVisible();
  await expect(queue.getByRole('listitem', { name: '제보 rp-20261110-0001' })).toContainText('엘리베이터 고장');
  await expect(queue.getByRole('listitem', { name: '제보 rp-20261110-0001' })).toContainText('A동 1층');
  await expect(queue.getByRole('listitem', { name: '제보 rp-20261110-0001' })).toContainText('새 제보');

  // clicking a report takes the map there (the floor of its Feature)
  await queue.getByRole('button', { name: /^rp-20261111-0005 .*지도에서 보기$/ }).click();
  await expect(page.locator('.status-mode')).toHaveText('A동 4층');
  await shot(page, 'reports-tab.png');

  // ---- temporary reports: overrides only ----
  const stateBefore = readFileSync(join(E2E_DIR, REPORTS_CAMPUS, 'buildings', 'A', 'L1.geojson'), 'utf8');
  for (const id of ['rp-20261110-0001', 'rp-20261110-0002', 'rp-20261110-0003']) {
    await queue.getByRole('button', { name: `${id} 적용` }).click();
    await expect(queue.getByRole('listitem', { name: `제보 ${id}` })).toHaveCount(0); // applied: it left the queue
  }
  await expect(page.locator('.status-message')).toContainText('overrides.json');
  // an undone step must not appear: the map was not edited by the temporary ones
  await expect(undo).toHaveAttribute('aria-disabled', 'true');

  // ---- permanent reports: one history entry each, the changed Features are highlighted on the map ----
  for (const id of ['rp-20261111-0004', 'rp-20261111-0005', 'rp-20261111-0006', 'rp-20261112-0007']) {
    await queue.getByRole('button', { name: `${id} 적용` }).click();
    await expect(queue.getByRole('listitem', { name: `제보 ${id}` })).toContainText('적용했습니다');
  }
  await expect(undo).toHaveAttribute('aria-disabled', 'false');
  await shot(page, 'reports-applied.png');

  // ---- 저장: campus, changeset, report files ----
  await page.getByRole('button', { name: '제보 처리 저장' }).click();
  const result = page.getByRole('list', { name: '저장 결과' });
  await expect(result).toContainText('changeset');
  await shot(page, 'reports-saved.png');

  // the changeset file: one, valid, the bundle's primary before its member
  const csFiles = readdirSync(CHANGESETS_DIR).filter((f) => f.endsWith('.json'));
  expect(csFiles).toHaveLength(1);
  const csPath = join(CHANGESETS_DIR, csFiles[0]!);
  const cs = JSON.parse(readFileSync(csPath, 'utf8')) as Changeset;
  expect(validateChangeset(cs).ok).toBe(true);
  expect(cs).toMatchObject({ campus: REPORTS_CAMPUS, source: 'report' });
  expect([...cs.report_ids].sort()).toEqual(['rp-20261111-0004', 'rp-20261111-0005', 'rp-20261111-0006', 'rp-20261112-0007', 'rp-20261112-0008']);
  expect(cs.report_ids.indexOf('rp-20261112-0007')).toBeLessThan(cs.report_ids.indexOf('rp-20261112-0008'));
  expect(cs.changes.some((c) => c.op === 'create')).toBe(true);
  expect(cs.changes.some((c) => c.op === 'modify')).toBe(true);
  console.log(`[reports e2e] changeset: ${csPath}`);
  console.log(`[reports e2e] pristine campuses dir (for apply --dry-run): ${PRISTINE_DIR}`);

  // the report files: all 8 applied, the permanent ones name the changeset
  const reports = readReports();
  expect(reports).toHaveLength(8);
  for (const r of reports) {
    expect(validateReport(r).ok, r.id).toBe(true);
    expect(r.status, r.id).toBe('applied');
    const last = r.status_log.at(-1)!;
    if (cs.report_ids.includes(r.id)) expect(last.changeset_id, r.id).toBe(cs.id);
  }

  // overrides.json holds the temporary ones (the elevator closes every stop), with expiry and the report id
  const overrides = JSON.parse(readFileSync(join(E2E_DIR, REPORTS_CAMPUS, 'overrides.json'), 'utf8')) as { feature_id: string; status: string; until: string; report_id: string }[];
  expect(new Set(overrides.map((o) => o.report_id))).toEqual(new Set(['rp-20261110-0001', 'rp-20261110-0002', 'rp-20261110-0003']));
  expect(overrides.filter((o) => o.report_id === 'rp-20261110-0002').map((o) => o.feature_id)).toEqual(['n_B_1_main']);
  expect(overrides.every((o) => Date.parse(o.until) > NOW.getTime())).toBe(true);

  // the saved campus is valid, and it is a different folder from the pristine copy, which was not touched
  expect(checkSaved(REPORTS_CAMPUS).result.errors).toEqual([]);
  expect(readFileSync(join(PRISTINE_DIR, REPORTS_CAMPUS, 'buildings', 'A', 'L1.geojson'), 'utf8')).toBe(pristineBefore);
  expect(existsSync(join(PRISTINE_DIR, REPORTS_CAMPUS, 'overrides.json'))).toBe(false);
  expect(readFileSync(join(E2E_DIR, REPORTS_CAMPUS, 'buildings', 'A', 'L1.geojson'), 'utf8')).not.toBe(stateBefore);

  // nothing is left in the queue
  await expect(page.getByRole('tab', { name: /^제보/ }).getByLabel(/대기 중인 제보/)).toHaveCount(0);
  await expect(queue).toHaveCount(0);
});
