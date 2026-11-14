// 층 연동, 끊긴 지점 찾기, 출입 정보, OSM 건물 가져오기, and the magnet of 현장 기록 불러오기, in the running editor.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addEdge, addNode, buildSurvey, compose, createHistory, formatSurvey, fromCampus, parseCampus,
  type EditState, type Position, type Survey,
} from '@campo/core';
import { expect, test, type Page } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { COPY_CORRIDOR, REPORTS_CAMPUS } from './seed.ts';
import { Editor, checkSaved, readSaved } from './support.ts';

const SHOTS = join(fileURLToPath(new URL('../../../', import.meta.url)), 'docs', 'v0.2', 'screens');
const shot = (page: Page, name: string) => (process.env['CAMPO_E2E_SHOT'] ? page.screenshot({ path: join(SHOTS, name) }) : Promise.resolve(undefined));

const status = (page: Page) => page.locator('.status-message');
async function counts(page: Page): Promise<{ nodes: number; edges: number }> {
  const text = await page.locator('.status').innerText();
  return { nodes: Number(/지점 (\d+)개/.exec(text)![1]), edges: Number(/구간 (\d+)개/.exec(text)![1]) };
}
async function showFloor(page: Page, floor: string): Promise<void> {
  await page.getByRole('navigation', { name: 'A동 층 선택' }).getByRole('button', { name: new RegExp(`^${floor}`) }).click();
  await expect(page.locator('.status-mode')).toHaveText(`A동 ${floor}`);
}
const mid = (a: Position, b: Position): Position => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const [C1, C2, C3, C4, C5] = COPY_CORRIDOR as [Position, Position, Position, Position, Position];

test('끊긴 지점을 찾아 가까운 길에 잇고, 출입 정보를 적고, 층 복사로 연동한 구간이 다른 층에도 함께 생기고 지워집니다', async ({ page }) => {
  const CAMPUS = 'e2e-sync';
  const ed = new Editor(page);
  await ed.open(CAMPUS);
  await ed.click(ed.tool('건물 선택'));
  await ed.clickMap([127.0005, 37.0004]);
  await showFloor(page, '1층');
  const findBroken = page.getByRole('group', { name: '자동화 매크로' }).getByRole('button', { name: /^끊긴 지점 찾기/ });
  await expect(findBroken).toHaveText('끊긴 지점 찾기');

  // ---- 끊긴 지점 찾기: a point left 1.2m beside the corridor ----
  const lone: Position = [mid(C4, C5)[0], C4[1] - 1.2 / 111_320];
  await ed.click(ed.tool('지점 추가'));
  await ed.clickMap(lone);
  expect(await counts(page)).toEqual({ nodes: 6, edges: 4 });
  await expect(findBroken).toHaveText('끊긴 지점 찾기 (1)');
  await expect(page.getByRole('navigation', { name: 'A동 층 선택' }).locator('.floor-broken')).toHaveText('1');
  await findBroken.click(); // the 오류 검사 tab opens on the item, the point is selected
  const section = page.getByRole('region', { name: '끊긴 지점 찾기' });
  await expect(section).toContainText('외톨이 지점');
  await expect(section).toContainText('1.2m 옆에 길이 있습니다');
  await expect(section.getByRole('list', { name: '층별 끊긴 지점 수' })).toContainText('A동 1층 1');
  await expect(status(page)).toContainText('A동 1층: 어떤 구간에도 이어지지 않은 지점입니다');
  await shot(page, 'broken-found.png');
  await section.getByRole('button', { name: '가까운 길에 자동 연결' }).click();
  await expect(status(page)).toContainText('가까운 길에 연결: 완료했습니다');
  expect(await counts(page)).toEqual({ nodes: 7, edges: 6 }); // the corridor was cut (+1 point, +1 edge) and joined (+1 edge)
  await expect(findBroken).toHaveText('끊긴 지점 찾기');
  await page.keyboard.press('Control+z'); // one entry
  expect(await counts(page)).toEqual({ nodes: 6, edges: 4 });
  await page.keyboard.press('Control+z'); // and the lone point itself
  expect(await counts(page)).toEqual({ nodes: 5, edges: 4 });

  // ---- 출입 정보: a preset and a typed value on one point ----
  await ed.click(ed.tool('선택'));
  await ed.clickMap(C5);
  await page.getByRole('tab', { name: '상세 정보' }).click().catch(() => page.getByRole('button', { name: '상세 정보' }).click());
  const access = page.getByRole('group', { name: '출입 정보' });
  await access.getByRole('group', { name: '개방시간 빠른 선택' }).getByRole('button', { name: '24/7' }).click();
  await expect(access.getByLabel('개방시간 (hours)')).toHaveValue('24/7');
  await access.getByLabel('개방조건 (access_condition)').fill('경비실 문의');
  await access.getByLabel('개방조건 (access_condition)').press('Enter');
  await access.getByLabel('폐쇄기간 (closed_period)').fill('2026-11-15~2026-11-30');
  await access.getByLabel('폐쇄기간 (closed_period)').blur();
  await expect(status(page)).toContainText('속성 바꾸기: 완료했습니다');
  await shot(page, 'access-fields.png');

  // ---- 다른 층에 복사: source and copies are linked ----
  await ed.boxSelect([C1[0] - 0.00005, C1[1] + 0.00008], [C5[0] + 0.00005, C5[1] - 0.00008]);
  await ed.rightClickMap(C3);
  const menu = page.getByRole('menu', { name: '선택한 것의 메뉴' });
  await expect(menu.getByRole('menuitem', { name: '층 연동 취소' })).toHaveCount(0); // nothing is linked yet
  await menu.getByRole('menuitem', { name: '다른 층에 복사…' }).click();
  const panel = page.getByRole('region', { name: '다른 층에 복사' });
  await expect(panel.getByRole('checkbox', { name: '같은 자리의 기존 지점도 층 연동에 넣기' })).toBeChecked();
  await panel.getByRole('checkbox', { name: '전체 선택' }).click();
  await panel.getByRole('button', { name: /^복사하기/ }).click();
  await expect(panel.getByRole('list', { name: '복사 결과' })).toContainText('지점 15개 만듦, 0개 재사용, 구간 12개 만듦');
  await panel.getByRole('button', { name: '닫기' }).click();
  // each floor's corridor stands alone until stairs or an elevator join the floors: the finder says so, floor by floor
  await expect(findBroken).toHaveText('끊긴 지점 찾기 (3)');
  await expect(page.getByRole('navigation', { name: 'A동 층 선택' }).locator('.floor-broken')).toHaveCount(3);

  // ---- an edge deleted between two linked points goes on the other floors too, in one entry ----
  await ed.clickMap(mid(C2, C3));
  await expect(page.locator('.props-id')).toHaveText('e_A_1_c2__c3');
  await page.keyboard.press('Delete');
  await expect(status(page)).toContainText('연동된 다른 층의 구간 3개도 지웠습니다');
  for (const f of ['2층', '3층', '4층']) {
    await showFloor(page, f);
    expect(await counts(page), f).toEqual({ nodes: 5, edges: 3 });
  }
  await showFloor(page, '1층');

  // ---- and an edge added between them is added there, once ----
  await ed.click(ed.tool('잇기'));
  await ed.clickMap(C2);
  await ed.clickMap(C3);
  await expect(status(page)).toContainText('연동된 다른 층에도 구간 3개를 만들었습니다');
  await showFloor(page, '3층');
  expect(await counts(page)).toEqual({ nodes: 5, edges: 4 });
  await shot(page, 'sync-mirrored.png');
  await page.keyboard.press('Control+z'); // one Ctrl+Z takes the edge back on every floor
  expect(await counts(page)).toEqual({ nodes: 5, edges: 3 });
  await showFloor(page, '1층');
  expect(await counts(page)).toEqual({ nodes: 5, edges: 3 });
  await page.keyboard.press('Control+Shift+z');
  expect(await counts(page)).toEqual({ nodes: 5, edges: 4 });

  // ---- 층 연동 취소: the point of this floor is independent again ----
  await ed.click(ed.tool('선택'));
  await ed.rightClickMap(C3);
  await expect(menu).toContainText('지점 1개가 다른 층과 연동되어 있습니다');
  await shot(page, 'sync-menu.png');
  await menu.getByRole('menuitem', { name: '층 연동 취소' }).click();
  await expect(status(page)).toContainText('층 연동 취소: 완료했습니다');
  await ed.clickMap(mid(C3, C4));
  await page.keyboard.press('Delete');
  await expect(status(page)).toContainText('구간 1개 삭제: 완료했습니다');
  await expect(status(page)).not.toContainText('연동된 다른 층');
  await showFloor(page, '2층');
  expect(await counts(page)).toEqual({ nodes: 5, edges: 4 }); // untouched

  // ---- saved: the link and the access values are in the files, and the files still pass the checks ----
  await ed.save();
  const { campus, result } = checkSaved(CAMPUS);
  expect(result.errors.map((e) => e.code)).toEqual(['ground-level-without-entrance']); // the seed has no entrance
  const nodes = campus.features.map((f) => f.feature as { id: string; properties: Record<string, unknown> }).filter((f) => f.properties['kind'] === 'node');
  expect(nodes).toHaveLength(20);
  const c5 = nodes.find((n) => n.id === 'n_A_1_c5')!.properties;
  expect(c5).toMatchObject({ hours: '24/7', access_condition: '경비실 문의', closed_period: '2026-11-15~2026-11-30' });
  expect(nodes.find((n) => n.id === 'n_A_1_c3')!.properties['sync_group']).toBeUndefined();
  const groups = new Map<string, number>();
  for (const n of nodes) if (typeof n.properties['sync_group'] === 'string') groups.set(n.properties['sync_group'], (groups.get(n.properties['sync_group']) ?? 0) + 1);
  expect([...groups.values()].sort()).toEqual([3, 4, 4, 4, 4]); // five columns of four floors; c3's lost its 1층 point
  // the copies of c5 carry its access values (same properties, another floor)
  expect(nodes.filter((n) => n.properties['sync_group'] === c5['sync_group'] && n.properties['hours'] === '24/7')).toHaveLength(4);
});

test('OSM 건물 가져오기: 누른 자리의 외곽선·이름·층수로 건물이 생기고, 되돌릴 수 있고, 실패하면 이유를 알려 줍니다', async ({ page }) => {
  const hosts = new Set<string>();
  page.on('request', (r) => hosts.add(new URL(r.url()).hostname));
  const AT: Position = [127.0018, 37.0003]; // east of A동, nothing there
  const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([x, y]) => ({ lon: AT[0] + x! * 0.0002, lat: AT[1] + y! * 0.00015 }));
  let asked = '';
  let fail = false;
  await page.route('https://overpass-api.de/**', async (route) => {
    asked = decodeURIComponent(route.request().postData() ?? '');
    if (fail) return route.abort('internetdisconnected');
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ elements: [{ type: 'way', id: 4242, tags: { building: 'university', name: '테스트관', 'building:levels': '3', 'building:levels:underground': '1' }, geometry: ring }] }),
    });
  });

  const ed = new Editor(page);
  await ed.open('e2e-osm');
  await ed.view(AT, 18.4);
  await ed.click(ed.tool('OSM 건물 가져오기'));
  await ed.clickMap(AT);
  await expect(status(page)).toContainText('OSM 건물 "테스트관" 가져오기: 완료했습니다');
  await expect(status(page)).toContainText('OSM의 층수(4개 층)를 넣었습니다');
  expect(asked).toMatch(/way\["building"\]\(around:120,37\.000\d+,127\.001\d+\);relation\["building"\]/);
  // selected, with its floor picker: B1 and 1~3
  const floors = page.getByRole('navigation', { name: '테스트관 층 선택' });
  await expect(floors.getByRole('button')).toHaveCount(5); // 4 floors + 바깥으로
  await expect(floors.getByRole('button', { name: /^지하 1층/ })).toBeVisible();
  await shot(page, 'osm-building.png');

  await ed.save();
  const saved = readSaved('e2e-osm').find((f) => f.path === 'buildings/OSMw4242/building.geojson');
  const feature = (JSON.parse(saved!.text) as { features: { id: string; geometry: { coordinates: number[][][] }; properties: Record<string, unknown> }[] }).features[0]!;
  expect(feature.properties).toMatchObject({ kind: 'building', name: '테스트관', code: 'OSMw4242', levels: [-1, 1, 2, 3], ground_levels: [1], source: 'osm', needs_check: true });
  expect(feature.geometry.coordinates[0]).toHaveLength(5);
  expect(checkSaved('e2e-osm').result.errors.filter((e) => e.featureId === 'bldg_OSMw4242').map((e) => e.code)).toEqual(['ground-level-without-entrance']);

  // ---- the same building again is refused (the click is inside it now); undo takes it away ----
  await ed.clickMap(AT);
  await expect(status(page)).toContainText('여기에는 이미 건물(테스트관)이 있습니다');
  await page.keyboard.press('Control+z');
  await expect(floors).toHaveCount(0);

  // ---- no network: a sentence, and nothing changes ----
  fail = true;
  await ed.clickMap(AT);
  await expect(status(page)).toContainText('OSM 서버(Overpass)에 닿지 못했습니다');
  await expect(status(page).locator('.notice-error')).toBeVisible();

  // SPEC §3: no Google, Naver or Kakao map is ever asked
  expect([...hosts].filter((h) => /google|naver|kakao|daum/.test(h))).toEqual([]);
});

test('현장 기록: 기존 길을 따라 걸은 구간은 그 길에 붙고, 새 길만 만들어져 기존 길 위에 이어집니다', async ({ page }) => {
  const base: EditState = fromCampus(parseCampus(readSaved(REPORTS_CAMPUS))).state;
  const [A, B] = [base.nodes['n_out_0002']!.coord, base.nodes['n_out_0004']!.coord];
  const MID = mid(A, B);
  /** `m` metres to the south-west side of the way from n_out_0002 to n_out_0004. */
  const beside = (m: number): Position => [MID[0] - (0.781 * m) / (111_320 * Math.cos((MID[1] * Math.PI) / 180)), MID[1] - (0.625 * m) / 111_320];
  const AT = '2026-11-14T11:00:00+09:00';
  const SOURCE = 'field-survey-2026-11';
  const walk = createHistory(base);
  const outdoor = (id: string, coord: Position) => addNode({ id, coord, props: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: SOURCE } });
  const footway = (id: string, from: string, to: string) => addEdge({ id, props: { kind: 'edge', highway: 'footway', edge_type: 'outdoor', from, to, bidirectional: true, step_free: null, source: SOURCE } });
  walk.perform(compose([outdoor('n_out_snap1', beside(3)), footway('e_out_snap1', 'n_out_0002', 'n_out_snap1'), outdoor('n_out_snap2', beside(30)), footway('e_out_snap2', 'n_out_snap1', 'n_out_snap2')], '걷기'));
  const survey: Survey = buildSurvey({
    base, current: walk.current(), campus: REPORTS_CAMPUS, id: 'sv-20261114-snap-1100', surveyedAt: AT, summary: '현장 조사',
    attachments: {},
    vertical: [{ edge_id: 'e_out_snap1', pressure_start_hpa: 1012.5, pressure_end_hpa: 1012.3, height_m: 1.67, grade_pct: 5.9, method: 'barometer', measured_at: AT }],
  });

  const ed = new Editor(page);
  await ed.open(REPORTS_CAMPUS);
  await ed.view(MID, 19);
  const before = await counts(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('group', { name: '편집 작업' }).getByRole('button', { name: '현장 기록 불러오기' }).click();
  await (await chooser).setFiles({ name: 'snap.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ 'survey.json': strToU8(formatSurvey(survey)) })) });
  await expect(status(page)).toContainText('기존 길을 따라 걸은 구간 1개와 지점 0개는 새로 만들지 않았습니다');
  await expect(status(page)).toContainText('새 길의 끝 1곳을 기존 길 위에 이었습니다');
  // the walked-along stretch is not drawn twice: +2 points, +1 new edge, +1 for the old way cut in two
  expect(await counts(page)).toEqual({ nodes: before.nodes + 2, edges: before.edges + 2 });

  // the height measured along the old way shows on the piece of it that was walked
  await ed.click(ed.tool('선택'));
  await ed.clickMap(mid(A, MID));
  const notes = page.getByRole('region', { name: '현장 기록' });
  await expect(notes).toContainText('이 길을 따라 걸으며 남긴 기록입니다(e_out_snap1)');
  await expect(notes).toContainText('높이 +1.7m');
  await shot(page, 'survey-snap.png');
  // the new point sits on the old way
  await ed.clickMap(MID);
  await expect(page.locator('.props-id')).toHaveText('n_out_snap1');

  await page.keyboard.press('Control+z'); // one entry
  expect(await counts(page)).toEqual(before);
});
