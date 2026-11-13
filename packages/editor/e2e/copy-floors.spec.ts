// SPEC-v0.2 5.1 작업: right-click menu, 다른 층에 복사, and the shortcut list.
// A corridor of 5 points and 4 edges on A동 1층 is copied to 2~4층 with the menu; one Ctrl+Z takes all the copies back.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { Editor, checkSaved } from './support.ts';
import { COPY_CORRIDOR } from './seed.ts';

/** Only used inside page.evaluate, where these are the browser's (this folder is checked without DOM types). */
type Dispatching = { dispatchEvent(e: object): boolean };
declare const document: { querySelector(selector: string): Dispatching | null };
declare const MouseEvent: new (type: string, init: object) => object;

const CAMPUS = 'e2e-copy';
const SHOTS = join(fileURLToPath(new URL('../../../', import.meta.url)), 'docs', 'v0.2', 'screens');
const shot = (page: Page, name: string) => (process.env['CAMPO_E2E_SHOT'] ? page.screenshot({ path: join(SHOTS, name) }) : Promise.resolve(undefined));

/** Point and edge counts of the floor shown (the status bar counts what lies on it). */
async function counts(page: Page): Promise<{ nodes: number; edges: number }> {
  const bar = page.locator('.status');
  const text = await bar.innerText();
  return { nodes: Number(/지점 (\d+)개/.exec(text)![1]), edges: Number(/구간 (\d+)개/.exec(text)![1]) };
}

/** Show a floor with the floor picker (setup, not part of the copy clicks). */
async function showFloor(page: Page, floor: string): Promise<void> {
  await page.getByRole('navigation', { name: 'A동 층 선택' }).getByRole('button', { name: floor }).click();
  await expect(page.locator('.status-mode')).toHaveText(`A동 ${floor}`);
}

test('복도 지점 5개와 구간 4개를 2~4층에 복사하고 되돌리기 한 번으로 모두 없앱니다', async ({ page }) => {
  const ed = new Editor(page);
  await ed.open(CAMPUS);

  // ---- setup: show 1층 with the select tool, and pick the whole corridor with a box (5 points + its 4 edges) ----
  await ed.click(ed.tool('건물 선택'));
  await ed.clickMap([127.0005, 37.0004]);
  await showFloor(page, '1층');
  await ed.click(ed.tool('선택'));
  expect(await counts(page)).toEqual({ nodes: 5, edges: 4 });
  const [first, last] = [COPY_CORRIDOR[0]!, COPY_CORRIDOR[4]!];
  await ed.boxSelect([first[0] - 0.00005, first[1] + 0.00008], [last[0] + 0.00005, last[1] - 0.00008]);
  await expect(page.locator('.status-message')).toContainText('지점 5개, 구간 4개를 골랐습니다');
  const setupClicks = ed.clicks;

  // ---- the copy: right-click (1), menu item (1), 전체 선택 (1), 복사하기 (1) ----
  ed.clicks = 0;
  await ed.rightClickMap(COPY_CORRIDOR[2]!);
  const menu = page.getByRole('menu', { name: '선택한 것의 메뉴' });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('지점 5개, 구간 4개');
  await expect(menu.getByRole('menuitem', { name: '속성 바로 편집' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '삭제' })).toBeVisible();
  await shot(page, 'context-menu.png');
  await ed.click(menu.getByRole('menuitem', { name: '다른 층에 복사…' }));
  const panel = page.getByRole('region', { name: '다른 층에 복사' });
  await expect(panel).toBeVisible();
  await expect(menu).toBeHidden();
  await expect(panel.getByRole('checkbox')).toHaveCount(4); // 전체 선택, and 2, 3, 4층 (not the floor copied from)
  await ed.click(panel.getByRole('checkbox', { name: '전체 선택' }));
  for (const f of ['2층', '3층', '4층']) await expect(panel.getByRole('checkbox', { name: f })).toBeChecked();
  await shot(page, 'copy-panel.png');
  await ed.click(panel.getByRole('button', { name: /^복사하기/ }));
  const copyClicks = ed.clicks;
  expect(copyClicks).toBe(4);
  await expect(panel.getByRole('list', { name: '복사 결과' })).toContainText('지점 15개 만듦, 0개 재사용, 구간 12개 만듦');
  await expect(page.locator('.status-message')).toContainText('3개 층에 복사: 완료했습니다');
  await shot(page, 'copy-result.png');
  await panel.getByRole('button', { name: '닫기' }).click();
  await expect(panel).toBeHidden();

  // ---- every floor holds 5 points and 4 edges; 1층 is as it was ----
  for (const f of ['1층', '2층', '3층', '4층']) {
    await showFloor(page, f);
    expect(await counts(page), f).toEqual({ nodes: 5, edges: 4 });
  }

  // ---- saved data: each floor has its own copies, nothing joins two floors, the checks pass ----
  await ed.save();
  const { campus, result } = checkSaved(CAMPUS);
  // The seed has no entrance on the ground floor: that is the only thing the checks may say.
  expect(result.errors.map((e) => e.code)).toEqual(['ground-level-without-entrance']);
  const features = campus.features.map((f) => f.feature as { id: string; properties: { kind: string; level?: number; from?: string; to?: string } });
  const nodes = features.filter((f) => f.properties.kind === 'node');
  const edges = features.filter((f) => f.properties.kind === 'edge');
  expect(nodes).toHaveLength(20);
  expect(edges).toHaveLength(16);
  const levelOf = new Map(nodes.map((n) => [n.id, n.properties.level]));
  for (const e of edges) expect(levelOf.get(e.properties.from!), e.id).toBe(levelOf.get(e.properties.to!));
  for (const level of [1, 2, 3, 4]) expect(nodes.filter((n) => n.properties.level === level)).toHaveLength(5);

  // ---- one Ctrl+Z takes all 3 copies back ----
  await showFloor(page, '1층');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.status-message')).toContainText('되돌렸습니다');
  for (const f of ['2층', '3층', '4층']) {
    await showFloor(page, f);
    expect(await counts(page), `${f} after undo`).toEqual({ nodes: 0, edges: 0 });
  }
  await showFloor(page, '1층');
  expect(await counts(page)).toEqual({ nodes: 5, edges: 4 });
  console.log(`copy-floors.spec: copy UI clicks ${copyClicks} (right-click 1, menu item 1, 전체 선택 1, 복사하기 1); setup clicks ${setupClicks} + 1 box drag`);
});

test('두 번째 복사는 같은 자리의 지점을 재사용하고, 바깥 지점과 층 사이 연결은 막거나 건너뜁니다', async ({ page }) => {
  const ed = new Editor(page);
  await ed.open('e2e-escalator'); // A동 1-2층 with a corridor, doors, an elevator on both floors and an entrance on 1층
  await ed.click(ed.tool('건물 선택'));
  await ed.clickMap([127.0005, 37.0004]);
  await showFloor(page, '1층');
  await ed.click(ed.tool('선택'));

  // The whole of 1층 in a box: corridor points, the door, the elevator stop, the entrance, and the edges among them.
  await ed.boxSelect([127.00005, 37.0005], [127.00095, 37.00002]);
  await ed.rightClickMap([127.0001, 37.0003]);
  const menu = page.getByRole('menu', { name: '선택한 것의 메뉴' });
  await ed.click(menu.getByRole('menuitem', { name: '다른 층에 복사…' }));
  const panel = page.getByRole('region', { name: '다른 층에 복사' });
  await expect(panel.getByRole('checkbox')).toHaveCount(4); // 전체 선택, 2, 3, 4층
  await ed.click(panel.getByRole('checkbox', { name: '2층' }));
  await ed.click(panel.getByRole('button', { name: /^복사하기/ }));
  const result = panel.getByRole('list', { name: '복사 결과' });
  await expect(result).toContainText('지점 2개 만듦, 1개 재사용, 구간 2개 만듦'); // 2층 has a corridor point at the same place as 1층's east end
  await expect(result).toContainText('엘리베이터 정차 지점');
  await expect(result).toContainText('출입구');
  await expect(result).toContainText('엘리베이터·계단·에스컬레이터·연결통로 도구로 만들어 주세요');
  await shot(page, 'copy-skipped.png');
});

test('바깥 지점은 복사 메뉴가 막히고 이유가 보입니다. 우클릭 메뉴에서 속성을 바로 고칠 수 있습니다', async ({ page }) => {
  const ed = new Editor(page);
  await ed.open('e2e-scope'); // an outdoor point and an entrance
  await ed.view([127.0005, 36.9998], 18.4); // the outdoor point is south of the building
  await ed.rightClickMap([127.0005, 36.9996]); // the outdoor point
  const menu = page.getByRole('menu', { name: '선택한 것의 메뉴' });
  await expect(menu).toBeVisible();
  const copy = menu.getByRole('menuitem', { name: '다른 층에 복사…' });
  await expect(copy).toHaveAttribute('aria-disabled', 'true');
  await expect(menu).toContainText('건물 안의 층에서만 복사할 수 있습니다');

  // Edit the name right in the menu (setProps), and close with Esc.
  await menu.getByRole('menuitem', { name: /속성 바로 편집/ }).click();
  await menu.getByLabel('이름').fill('정문 앞');
  await page.keyboard.press('Enter');
  await expect(page.locator('.status-message')).toContainText('이름 바꾸기: 완료했습니다');
  await expect(menu).toBeHidden();
  await ed.rightClickMap([127.0005, 36.9996]);
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  // The browser's own menu is blocked on the map only.
  const blocked = await page.evaluate(() => {
    const fire = (el: Dispatching | null) => !el!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); // true: the default was prevented
    return { map: fire(document.querySelector('.map canvas')), outside: fire(document.querySelector('.toolbar')) };
  });
  expect(blocked).toEqual({ map: true, outside: false });
});

test('? 키와 도움말 버튼이 도구 단축키 목록을 엽니다. 목록의 도구 이름과 키는 도구 모음과 같습니다', async ({ page }) => {
  const ed = new Editor(page);
  await ed.open('e2e-copy');
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: '도구 단축키' });
  await expect(help).toBeVisible();
  await shot(page, 'help-shortcuts.png');

  // Each tool button's tooltip starts with its name and key ("호실 연속 입력 (D)"), then says what the tool does;
  // the list shows the same name and key under the same group name.
  const tools = await page.locator('.toolbar-section').evaluateAll((sections) => sections.flatMap((s) => {
    const group = (s.querySelector('.toolbar-caption')?.textContent ?? '').trim();
    return [...s.querySelectorAll('button.tool:not(.op)')].map((b) => ({ group, label: (b.textContent ?? '').trim(), title: b.getAttribute('title') ?? '' }));
  }));
  expect(tools.length).toBeGreaterThan(10);
  expect([...new Set(tools.map((t) => t.group))]).toEqual(['그리기 도구', '자동화 매크로']);
  for (const t of tools) {
    const lines = t.title.split('\n');
    const m = /^.+ \((.+)\)$/.exec(lines[0]!);
    const row = help.getByRole('region', { name: t.group }).locator('dl > div').filter({ has: page.locator('dd').filter({ hasText: new RegExp('^' + t.label + '$') }) });
    await expect(row, t.label).toHaveCount(1);
    await expect(row.locator('dt'), t.label).toHaveText(m ? m[1]! : '-');
    expect(lines.length, t.label).toBeGreaterThan(1);
  }
  await expect(help).toContainText('Delete');
  await expect(help).toContainText('Ctrl+Z');
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await ed.click(page.getByRole('button', { name: '도움말' }));
  await expect(help).toBeVisible();
  await help.getByRole('button', { name: '닫기' }).click();
  await expect(help).toBeHidden();
});
