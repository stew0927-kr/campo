// Real React screen handlers in a test-only DOM adapter. Not an Android/MapLibre/Expo Go test.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { LIVE_ROWS } from './liveRows.mjs';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = process.env.CAMPO_UI_RESULTS ?? join(tmpdir(), 'campo-a-ui');
const url = process.env.CAMPO_UI_URL ?? 'http://127.0.0.1:5209/';
await mkdir(output, { recursive: true });
const log = createWriteStream(join(output, 'server.log'));
const server = process.env.CAMPO_UI_URL ? null : spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'apps/app/test/uiHarness/vite.config.ts', '--port', '5209'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
server?.stdout.pipe(log); server?.stderr.pipe(log);
const results = [];
let browser;
const text = (page, value) => page.getByText(value).filter({ visible: true }).first();
const button = (page, name) => page.getByRole('button', { name, exact: typeof name === 'string' });
// Half-screen place search sheet (replaces the old full-screen search dialog).
const searchSheet = (page) => page.locator('[aria-label="장소 검색 시트"]');
const tab = (page, name) => page.getByRole('tab', { name, exact: true });
async function selected(page, name) { assert.equal(await tab(page, name).getAttribute('aria-selected'), 'true'); }
/** Let React flush updates that a non-React caller (the hardware back key) scheduled, so absence checks are not racy. */
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
/** Android back key through the app's BackHandler stand-in. Returns whether the app handled it. */
async function back(page) { const handled = await page.evaluate(() => window.__campoBack()); await settle(page); return handled; }
async function absent(locator) { await settle(locator.page()); assert.equal(await locator.count(), 0, `expected none of ${locator}`); }
const checked = async (locator, value) => assert.equal(await locator.getAttribute('aria-checked'), String(value));
const isSelected = async (locator, value = true) => assert.equal(await locator.getAttribute('aria-selected'), String(value));
const radio = (page, name) => page.getByRole('radio', { name, exact: true });
const toggle = (page) => page.getByRole('switch', { name: '건물에서 층 고르기' });
const wheelchair = (page) => page.getByRole('switch', { name: '휠체어 가능' });
const roundTrip = (page) => page.getByRole('switch', { name: '왕복 보기(돌아오는 길 포함)' });
const roadview = (page) => page.getByRole('dialog');
/** Exact visible text (route leg titles: '오는 길' is also part of '돌아오는 길'). */
const exactText = (page, value) => page.getByText(value, { exact: true }).filter({ visible: true });
const searchBox = (page) => searchSheet(page).getByRole('textbox', { name: '장소 검색어' });
/** Developer data switch; the sheet is collapsed first so the floating menu is never under it. */
async function useDemo(page, name, example = null) {
  const collapse = button(page, '시트 접기');
  if (await collapse.count()) await collapse.first().click();
  await button(page, '개발 데이터').click(); await button(page, name).click();
  if (!example) return;
  if (await collapse.count()) await collapse.first().click();
  await button(page, '개발 데이터').click(); await button(page, example).click();
}
/** Value shown above a Stat label in the route sheet (e.g. 계단 → "0곳"). */
const stat = (page, label) => page.evaluate((name) => [...document.querySelectorAll('span')].find((el) => el.textContent === name && el.offsetParent !== null)?.previousElementSibling?.textContent ?? null, label);
/** Route numbers as the sheet shows them and as the map stand-in received them. */
async function routeNumbers(page) {
  const sheet = await page.evaluate(() => {
    const time = document.querySelector('[aria-label$="분"]:not([role])');
    const dist = [...document.querySelectorAll('span')].find((el) => /^\d+m( · 왕복)?$/.test(el.textContent ?? '') && el.offsetParent !== null);
    return { minutes: time ? Number.parseInt(time.getAttribute('aria-label'), 10) : null, distance: dist ? Number.parseInt(dist.textContent, 10) : null };
  });
  const mapLine = await text(page, '검사 경로 좌표').textContent();
  const steps = await page.getByRole('button', { name: /^\d+단계\. / }).count();
  return { ...sheet, mapDistance: Number(/· (\d+)m/.exec(mapLine)[1]), steps };
}
const modeNames = ['가장 빠른 길', '계단 없는 길', '계단 최소', '휠체어', '엘리베이터 우선'];
async function onlyMode(page, name) { for (const other of modeNames) await isSelected(button(page, other), other === name); }
/** CAMPO_UI_ONLY=<regex> runs only matching scenarios (local debugging; the full run is the check). */
const only = process.env.CAMPO_UI_ONLY ? new RegExp(process.env.CAMPO_UI_ONLY) : null;
async function scenario(name, run, viewport = { width: 390, height: 844 }, source = null, query = '') {
  if (only && !only.test(name)) return;
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(7000);
  try {
    if (source) await page.route('https://example.test/rest/v1/**', async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey,authorization', 'Access-Control-Allow-Methods': 'GET' } }); return; }
      assert.equal(request.method(), 'GET');
      const endpoint = new URL(request.url());
      const table = endpoint.pathname.split('/').at(-1);
      assert.ok(Object.hasOwn(LIVE_ROWS, table));
      if (table !== 'festival_days' && table !== 'campus_photos') assert.equal(endpoint.searchParams.get('is_published'), 'eq.true');
      if (table === 'campus_photos') assert.equal(endpoint.searchParams.get('campus_id'), 'eq.hanyang-seoul');
      if (source === 'offline') { await route.abort('failed'); return; }
      if (source === 'photo-error' && table === 'campus_photos') { await route.fulfill({ status: 503, body: '{}' }); return; }
      const rows = source === 'empty' ? [] : source === 'bad-node' && table === 'essay_sessions'
        ? LIVE_ROWS[table].map((row) => ({ ...row, destination_node_id: 'missing-campus-node' })) : LIVE_ROWS[table];
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(rows) });
    });
    const params = new URLSearchParams(query); if (source) params.set('source', source);
    await page.goto(params.size ? `${url}?${params}` : url);
    await text(page, '가장 가까운 화장실').waitFor();
    await run(page);
    assert.deepEqual(errors, []);
    results.push({ name, passed: true }); console.log('PASS', name);
  } catch (error) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
    results.push({ name, passed: false, error: String(error) }); throw error;
  } finally { await page.close(); }
}
/** The real CampusMap over the fake MapLibre (campusMap.html): marker layout and re-render work per region event. */
async function markerScenario(name, run) {
  if (only && !only.test(name)) return;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(7000);
  try {
    await page.goto(`${url}campusMap.html?n=1000`);
    await page.waitForFunction(() => window.__campoMap && document.querySelector('[data-marker]'));
    await run(page);
    assert.deepEqual(errors, []);
    results.push({ name, passed: true }); console.log('PASS', name);
  } catch (error) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
    results.push({ name, passed: false, error: String(error) }); throw error;
  } finally { await page.close(); }
}
async function handoffSearch(page, expected) {
  await button(page, '여기까지 길찾기').click();
  await selected(page, '지도·길찾기');
  const dialog = searchSheet(page); await dialog.waitFor();
  assert.equal(await dialog.getByRole('textbox', { name: '장소 검색어' }).inputValue(), expected);
  await button(page, '검색 닫기').click();
}
try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 79) throw Error('UI harness did not start. See server.log.');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ executablePath: process.env.CAMPO_CHROMIUM ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  await scenario('five tabs, retained detail and back navigation', async (p) => {
    for (const name of ['지도·길찾기', '논술', '축제', '학교행사', '내정보']) { await tab(p, name).click(); await selected(p, name); }
    await tab(p, '논술').click(); await button(p, '2026-11-29').click();
    await p.getByRole('textbox', { name: '시험·고사장 검색' }).fill('상경');
    await button(p, '고사장 상세 보기').click(); await text(p, '가상 상경계열 오전').waitFor();
    await tab(p, '축제').click(); await tab(p, '논술').click();
    await button(p, '시험 목록으로').waitFor();
    await p.evaluate(() => window.__campoBack()); await button(p, '고사장 상세 보기').waitFor();
    await p.evaluate(() => window.__campoBack()); await selected(p, '지도·길찾기');
  });
  await scenario('essay date and multiword search, checklist, favorites and route handoff', async (p) => {
    await tab(p, '논술').click(); await button(p, '2026-11-28').click();
    await p.getByRole('textbox', { name: '시험·고사장 검색' }).fill('오후   402');
    assert.equal(await button(p, '고사장 상세 보기').count(), 1);
    await button(p, '고사장 상세 보기').click();
    await text(p, '실제 일정·배정 고사장').waitFor();
    const check = p.getByRole('checkbox').first(); await check.click(); assert.equal(await check.getAttribute('aria-checked'), 'true');
    await button(p, '즐겨찾기 추가').click(); await handoffSearch(p, '가상 시험관 가상 402호');
    await tab(p, '내정보').click(); await button(p, '기타').click();
    await handoffSearch(p, '가상 시험관 가상 402호');
    await tab(p, '내정보').click(); await button(p, '즐겨찾기에서 삭제').click(); await text(p, '아직 담은 항목이 없습니다').waitFor();
  });
  await scenario('festival dates, category filter, favorites and all three flow buttons', async (p) => {
    await tab(p, '축제').click(); await button(p, '2026-11-21').click();
    await text(p, '가상 밴드 2').waitFor(); await button(p, '2026-11-20').click(); await button(p, '부스').click();
    await p.getByRole('textbox', { name: '축제 부스 검색' }).fill('가상  만들기');
    assert.equal(await button(p, '부스 상세 보기').count(), 1); await button(p, '부스 상세 보기').click();
    await text(p, '실제 대기 시간은 제공하지 않습니다').waitFor(); await button(p, '즐겨찾기 추가').click();
    for (const name of ['입장 동선 · 지도 연결 대기', '대기 동선 · 지도 연결 대기', '퇴장 동선 · 지도 연결 대기']) {
      await tab(p, '축제').click(); await button(p, name).click(); await selected(p, '지도·길찾기');
      await searchSheet(p).waitFor(); assert.equal(await p.getByRole('textbox', { name: '장소 검색어' }).inputValue(), '가상 축제 광장'); await button(p, '검색 닫기').click();
      await button(p, '출발: 검색해서 선택해 주세요').waitFor();
    }
    await tab(p, '내정보').click(); await button(p, '부스').click(); await text(p, '가상 만들기 부스').waitFor();
  });
  await scenario('event category and search, detail, route and favorite handoff', async (p) => {
    await tab(p, '학교행사').click(); await text(p, '고정 · 가상 행사 운영 안내').waitFor(); await button(p, '다가오는 행사').click(); await button(p, '강연').click();
    await p.getByRole('textbox', { name: '학교행사 검색' }).fill('가상 학술팀');
    assert.equal(await button(p, '행사 상세 보기').count(), 1); await button(p, '행사 상세 보기').click();
    await text(p, '주최: 가상 학술팀').waitFor(); assert.equal(await button(p, '원문 링크 미제공 · 시연용 정보').isDisabled(), true); await button(p, '즐겨찾기 추가').click(); await handoffSearch(p, '가상 강연관 201호');
    await tab(p, '내정보').click(); await button(p, '행사').click(); await handoffSearch(p, '가상 강연관 201호');
  });
  await scenario('empty filter recovery, pinned notices and app information links', async (p) => {
    await tab(p, '학교행사').click();
    await p.getByRole('textbox', { name: '학교행사 검색' }).fill('검색결과가없는문자열');
    await text(p, '조건에 맞는 행사가 없습니다').waitFor();
    await button(p, '전체 일정 보기').click(); assert.equal(await button(p, '행사 상세 보기').count(), 7);
    await button(p, '공지').click(); await text(p, '고정 · 가상 행사 운영 안내').waitFor();
    assert.equal(await button(p, '행사 상세 보기').count(), 2);
    await tab(p, '내정보').click(); await button(p, 'Expo · MIT · 외부 링크 열기').click(); await button(p, '기기 앱 설정 열기').click();
    const links = await p.evaluate(() => window.__campoLinks);
    assert.ok(links.includes('https://github.com/expo/expo')); assert.ok(links.includes('app-settings'));
  });
  await scenario('walking preferences update real map controls and denied GPS stays manual', async (p) => {
    await tab(p, '내정보').click(); await button(p, '휠체어 보행을 기본으로 설정').click();
    await tab(p, '지도·길찾기').click(); await button(p, '길찾기').click();
    assert.equal(await button(p, '휠체어').getAttribute('aria-selected'), 'true');
    await button(p, '길찾기 닫기').click(); await text(p, '가장 가까운 화장실').waitFor();
    await button(p, '내 위치로 이동').click(); await text(p, '위치 권한이 없어도 출발지와 목적지를 직접 선택').waitFor();
    await button(p, '길찾기').click(); await button(p, '출발: 검색해서 선택해 주세요').click();
    await button(p, '현재 위치를 출발지로').click(); await text(p, '위치 권한이 없어도 출발지와 목적지를 직접 선택').waitFor();
    assert.equal(await searchSheet(p).count(), 0);
    await button(p, '길찾기 닫기').click();
    await p.getByRole('switch', { name: '건물에서 층 고르기' }).click(); await text(p, '등록된 실내 건물·층 데이터가 없습니다').waitFor();
  });
  await scenario('granted GPS centres the map and can become the start', async (p) => {
    await p.evaluate(() => { window.__campoGps = { lat: 37.5572, lng: 127.045 }; });
    await button(p, '내 위치로 이동').click(); await text(p, '검사 카메라 이동 1회').waitFor();
    await button(p, '길찾기').click(); await button(p, '출발: 검색해서 선택해 주세요').click();
    await button(p, '현재 위치를 출발지로').click(); await button(p, '출발: 현재 위치').waitFor();
    await text(p, '현재 위치를 출발지로 선택했습니다').waitFor();
  });
  await scenario('home search focuses a place, sets endpoints and routes with bottom travel modes', async (p) => {
    await button(p, '개발 데이터').click(); await button(p, '야외 가상 경로 시험').click();
    await button(p, '장소 검색 열기').click();
    let dialog = searchSheet(p); await dialog.getByRole('textbox', { name: '장소 검색어' }).fill('가상 시험 지점 1');
    await dialog.getByRole('button', { name: /가상 시험 지점 1/ }).click();
    await text(p, '검사 선택 장소: 가상 시험 지점 1').waitFor(); await text(p, '검사 카메라 이동 1회').waitFor();
    await button(p, '출발지로').click(); await button(p, '출발: 가상 시험 지점 1').waitFor();
    await button(p, '도착: 검색해서 선택해 주세요').click(); dialog = searchSheet(p);
    await dialog.getByRole('textbox').fill('가상 시험 지점 3'); await dialog.getByRole('button', { name: /가상 시험 지점 3/ }).click();
    await text(p, '검사 경로 좌표').waitFor(); await text(p, '단계별 안내').waitFor();
    await button(p, '계단 없는 길').click(); assert.equal(await button(p, '계단 없는 길').getAttribute('aria-selected'), 'true');
    await text(p, '검사 경로 좌표').waitFor();
    await p.evaluate(() => window.__campoBack()); await button(p, '출발: 가상 시험 지점 1').waitFor();
    assert.equal(await text(p, '검사 경로 좌표').count(), 0);
    await button(p, '출발·도착 바꾸기').click(); await text(p, '검사 경로 좌표').waitFor();
    await button(p, '출발·도착 수정').click(); await button(p, '출발: 가상 시험 지점 3').waitFor();
    await p.evaluate(() => window.__campoBack()); await text(p, '가장 가까운 화장실').waitFor();
    await button(p, '길찾기').click(); await button(p, '출발: 검색해서 선택해 주세요').waitFor();
  });
  await scenario('selection back, half-screen search, building switch and floor picker', async (p) => {
    await button(p, '개발 데이터').click(); await button(p, '실내·계단·엘리베이터 시험').click();
    // 1. A place picked from a search with words: ← drops it and reopens that search; ← again (hardware) → plain map.
    await button(p, '장소 검색 열기').click();
    await searchSheet(p).getByRole('textbox', { name: '장소 검색어' }).fill('408');
    await searchSheet(p).getByRole('button', { name: /408/ }).first().click();
    await button(p, '선택 취소').waitFor(); assert.equal(await button(p, '장소 검색 열기').count(), 0);
    await button(p, '선택 취소').click();
    assert.equal(await searchSheet(p).getByRole('textbox', { name: '장소 검색어' }).inputValue(), '408');
    await back(p); assert.equal(await searchSheet(p).count(), 0);
    await button(p, '장소 검색 열기').waitFor(); assert.equal(await button(p, '선택 취소').count(), 0);
    // The search selection entered A동 4층; go back outdoors for the rest.
    await button(p, '실외 지도로 나가기').click(); await text(p, '실외 지도').waitFor();
    // A place tapped on the map: ← goes straight back to the map, no search.
    await button(p, /^검사 지점:/).first().click(); await button(p, '선택 취소').click();
    assert.equal(await searchSheet(p).count(), 0); await button(p, '장소 검색 열기').waitFor();
    // 4. Opening a building in the search list moves the camera and keeps the sheet open on its floors.
    await button(p, '장소 검색 열기').click(); await searchSheet(p).getByRole('button', { name: /^A동,/ }).click();
    await text(p, '검사 카메라 이동 2회').waitFor(); await text(p, '검사 검색 건물: bldg_A').waitFor();
    assert.equal(await searchSheet(p).count(), 1); await searchSheet(p).getByRole('button', { name: /A동 4층/ }).click();
    await button(p, '검색 접기').click(); await settle(p); assert.equal(await searchSheet(p).count(), 0);
    // Closed: the camera stays at the building (no reset), nothing is selected and the building keeps its mark.
    await text(p, '검사 카메라 이동 2회').waitFor(); assert.equal(await button(p, '선택 취소').count(), 0);
    await text(p, '검사 검색 건물: bldg_A').waitFor();
    // 3. The building switch highlights mapped buildings; a tap opens the floor card, a floor enters it.
    const toggle = p.getByRole('switch', { name: '건물에서 층 고르기' });
    await toggle.click(); assert.equal(await toggle.getAttribute('aria-checked'), 'true'); await text(p, '검사 건물 강조').waitFor();
    await button(p, '검사 건물 누르기: bldg_B').click(); await button(p, '층 선택 닫기').waitFor();
    await back(p); assert.equal(await button(p, '층 선택 닫기').count(), 0);
    await button(p, '검사 건물 누르기: bldg_B').click(); await button(p, 'B동 2층').click();
    await text(p, 'B동 · 2층').waitFor(); await text(p, '검사 실내: bldg_B 2층').waitFor();
    // Another highlighted building can be picked from inside; a one-floor building opens at once.
    await button(p, '검사 건물 누르기: bldg_C').click(); await text(p, '검사 실내: bldg_C 5층').waitFor();
    await toggle.click(); assert.equal(await toggle.getAttribute('aria-checked'), 'false'); await text(p, '실외 지도').waitFor();
    assert.equal(await text(p, '검사 건물 강조').count(), 0);
  });
  await scenario('manual demo route, map selection cancel and map point start', async (p) => {
    await button(p, '개발 데이터').click(); await button(p, '야외 가상 경로 시험').click();
    await button(p, '길찾기').click();
    for (const [field, name] of [['출발', '가상 시험 지점 1'], ['도착', '가상 시험 지점 3']]) {
      await button(p, new RegExp(`^${field}:`)).click(); const dialog = searchSheet(p);
      await dialog.getByRole('textbox').fill(name); await dialog.getByRole('button', { name: new RegExp(name) }).click();
    }
    await text(p, '검사 경로 좌표').waitFor();
    await button(p, '출발·도착 수정').click(); await button(p, '길찾기 닫기').click();
    await button(p, '길찾기').click(); await button(p, '도착: 검색해서 선택해 주세요').waitFor();
    await button(p, /^출발:/).click(); await button(p, '지도에서 출발 선택').click(); await button(p, '지도 선택 취소').click();
    assert.equal(await button(p, '지도 선택 취소').count(), 0);
    await button(p, /^출발:/).click(); await button(p, '지도에서 출발 선택').click(); await button(p, '검사: 지도 임의 점 선택').click();
    await button(p, '출발: 지도에서 선택한 위치').waitFor();
  });
  await scenario('indoor route, floor controls and cross-tab intent clears the developer fixture', async (p) => {
    await button(p, '개발 데이터').click(); await button(p, '실내·계단·엘리베이터 시험').click();
    await button(p, '개발 데이터').click(); await button(p, '정문 → 가상 408호 선택').click();
    await button(p, '엘리베이터 우선').click(); await button(p, '길찾기').click();
    await text(p, '검사 경로 좌표').waitFor(); await text(p, '층 (엘리베이터)').waitFor();
    // Route planning stays on the outdoor map even when the end is a room (the building is opened by the user).
    await text(p, '실외 지도').waitFor(); assert.equal(await button(p, '실외 지도로 나가기').count(), 0);
    assert.equal(await p.getByRole('switch', { name: '건물에서 층 고르기' }).getAttribute('aria-checked'), 'false');
    await button(p, '건물 목록').click(); await button(p, /^A동, 4개 층/).click();
    await button(p, 'A동 4층').click(); await text(p, 'A동 · 4층').waitFor(); await text(p, '검사 실내: bldg_A 4층').waitFor();
    assert.equal(await p.getByRole('switch', { name: '건물에서 층 고르기' }).getAttribute('aria-checked'), 'true');
    await button(p, '휠체어').click(); assert.equal(await button(p, '휠체어').getAttribute('aria-selected'), 'true'); await text(p, '검사 경로 좌표').waitFor();
    await tab(p, '논술').click(); await button(p, '고사장 상세 보기').first().click(); await handoffSearch(p, '가상 시험관 가상 301호');
    await text(p, '실제 캠퍼스 길 데이터가 아직 없습니다').waitFor();
  });
  await scenario('intercepted public server rows appear in existing tabs and photos reach the map', async (p) => {
    await text(p, '서버 공개 사진 1장을 읽었습니다').waitFor();
    await tab(p, '논술').click(); await text(p, '검사 서버 논술').waitFor(); await text(p, '서버 공개 데이터를 표시합니다').waitFor();
    assert.equal(await text(p, '차기 시즌 프로토타입').count(), 0);
    await button(p, '고사장 상세 보기').click(); await handoffSearch(p, '검사 고사관 101호');
    await tab(p, '축제').click(); await text(p, '검사 서버 출연진').waitFor(); await text(p, '검사 서버 부스').waitFor();
    await button(p, '부스 상세 보기').click(); await handoffSearch(p, '검사 축제관');
    await tab(p, '학교행사').click(); await text(p, '검사 서버 행사').waitFor(); await button(p, '행사 상세 보기').click(); await handoffSearch(p, '검사 행사관');
    await tab(p, '내정보').click(); await text(p, '콘텐츠는 서버 공개 데이터입니다').waitFor();
  }, undefined, 'live');
  await scenario('empty public server stays empty rather than silently substituting demo rows', async (p) => {
    await text(p, '서버에 공개된 한양대 사진이 없습니다').waitFor();
    await tab(p, '논술').click(); await text(p, '서버에 공개된 논술 일정이 없습니다').waitFor();
    await tab(p, '축제').click(); await text(p, '공개된 축제 정보가 없습니다').waitFor();
    await tab(p, '학교행사').click(); await text(p, '서버에 공개된 학교행사가 없습니다').waitFor();
    assert.equal(await text(p, '가상 입학설명회').count(), 0);
  }, undefined, 'empty');
  await scenario('failed public reads show explicit demo fallback and remain retryable', async (p) => {
    await text(p, '사진 서버에 연결하지 못했습니다').waitFor(); await tab(p, '논술').click();
    await text(p, '서버에 연결하지 못해 시연용 데이터를 표시합니다').waitFor(); await text(p, '가상 인문계열 오전').waitFor();
    await button(p, '서버 다시 조회').click(); await text(p, '서버에 연결하지 못해 시연용 데이터를 표시합니다').waitFor();
    assert.equal(await text(p, '서버 공개 데이터를 표시합니다').count(), 0);
  }, undefined, 'offline');
  await scenario('photo outage does not replace successful public content with demo data', async (p) => {
    await text(p, '사진 서버에 연결하지 못했습니다').waitFor(); await tab(p, '논술').click(); await text(p, '검사 서버 논술').waitFor();
    await text(p, '서버 공개 데이터를 표시합니다').waitFor();
  }, undefined, 'photo-error');
  await scenario('cross-tab destination clears a pending map selection', async (p) => {
    await button(p, '길찾기').click(); await button(p, /^출발:/).click(); await button(p, '지도에서 출발 선택').click(); await button(p, '지도 선택 취소').waitFor();
    await tab(p, '논술').click(); await button(p, '고사장 상세 보기').first().click();
    await handoffSearch(p, '가상 시험관 가상 301호');
    assert.equal(await button(p, '지도 선택 취소').count(), 0);
    await button(p, '출발: 검색해서 선택해 주세요').waitFor();
    await button(p, '도착: 검색해서 선택해 주세요').waitFor();
    assert.equal(await button(p, '길찾기').isDisabled(), true);
  });
  await scenario('nonexistent server destination never becomes an engine endpoint', async (p) => {
    await tab(p, '논술').click(); await button(p, '고사장 상세 보기').click();
    await handoffSearch(p, '검사 고사관 101호');
    await text(p, '연결된 지도 지점이 아직 없습니다').waitFor();
    await button(p, '도착: 검색해서 선택해 주세요').waitFor();
    assert.equal(await button(p, '길찾기').isDisabled(), true);
  }, undefined, 'bad-node');
  await scenario('out-of-campus route failure shows guidance without a stale route', async (p) => {
    await button(p, '개발 데이터').click(); await button(p, '야외 가상 경로 시험').click();
    await button(p, '길찾기').click(); await button(p, '도착: 검색해서 선택해 주세요').click();
    await searchSheet(p).getByRole('textbox').fill('결과없는장소');
    await text(p, '검색 결과가 없습니다').waitFor();
    await searchSheet(p).getByRole('textbox').fill('가상 시험 지점 3');
    await searchSheet(p).getByRole('button', { name: /가상 시험 지점 3/ }).click();
    await button(p, /^출발:/).click(); await button(p, '지도에서 출발 선택').click(); await button(p, '검사: 캠퍼스 밖 선택').click();
    await text(p, '걷는 길이 없는 위치입니다').waitFor();
    assert.equal(await text(p, '검사 경로 좌표').count(), 0);
  });
  /* ---------- 1. Half-screen search: a building moves the camera; closing keeps it there ---------- */
  await scenario('search: a building moves the camera and 검색 닫기 keeps camera, mark and no selection', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험');
    await button(p, '장소 검색 열기').click();
    await searchSheet(p).getByRole('button', { name: /^B동,/ }).click();
    await text(p, '검사 카메라 이동 1회').waitFor(); await text(p, '배율 18').waitFor(); await text(p, '검사 검색 건물: bldg_B').waitFor();
    // The sheet stays open on that building's floors.
    await searchSheet(p).getByRole('button', { name: /^B동 2층, 시설 \d+곳$/ }).waitFor();
    const where = await text(p, '검사 카메라 위치').textContent();
    await button(p, '검색 닫기').click(); await absent(searchSheet(p));
    assert.equal(await text(p, '검사 카메라 위치').textContent(), where);
    await text(p, '검사 카메라 이동 1회').waitFor(); await absent(text(p, '검사 카메라 이동 2회'));
    await absent(button(p, '선택 취소')); await absent(text(p, '검사 선택 장소'));
    await text(p, '검사 검색 건물: bldg_B').waitFor(); await text(p, '실외 지도').waitFor(); await absent(text(p, '검사 실내'));
    await button(p, '장소 검색 열기').waitFor();
  });
  await scenario('search: a building place found by words enters its floor and ← keeps the camera', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험');
    await button(p, '장소 검색 열기').click(); await searchBox(p).fill('B동 201');
    assert.equal(await searchSheet(p).getByRole('button', { name: /, B동 · 2층/ }).count(), 1);
    await searchSheet(p).getByRole('button', { name: /^201호 강의실, / }).click();
    await text(p, '검사 선택 장소: 201호 강의실').waitFor(); await text(p, '검사 실내: bldg_B 2층').waitFor(); await text(p, 'B동 · 2층').waitFor();
    await text(p, '검사 카메라 이동 1회').waitFor();
    await button(p, '선택 취소').click(); assert.equal(await searchBox(p).inputValue(), 'B동 201');
    await back(p); await absent(searchSheet(p)); await absent(text(p, '검사 선택 장소'));
    // Dropping the selection does not move the camera or leave the floor.
    await text(p, '검사 카메라 이동 1회').waitFor(); await text(p, '검사 실내: bldg_B 2층').waitFor();
  });
  await scenario('search: drilling to a floor and back up, then 검색 접기 keeps the building', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험');
    await button(p, '장소 검색 열기').click(); const sheet = searchSheet(p);
    await sheet.getByRole('button', { name: /^A동,/ }).click(); await text(p, '검사 카메라 이동 1회').waitFor();
    await sheet.getByRole('button', { name: /^A동 4층, 시설/ }).click(); await text(p, 'A동 · 4층').waitFor();
    await sheet.getByRole('button', { name: /^A동 4층 여자 화장실, 여자 화장실/ }).waitFor();
    // Going up inside the same building never moves the camera again.
    await button(p, '위 단계로').click(); await sheet.getByRole('button', { name: /^A동 4층, 시설/ }).waitFor();
    await button(p, '위 단계로').click(); await text(p, '건물을 골라 주세요').waitFor(); await absent(text(p, '검사 카메라 이동 2회'));
    await sheet.getByRole('button', { name: /^A동,/ }).click(); await text(p, '검사 카메라 이동 2회').waitFor();
    await sheet.getByRole('button', { name: /^A동 4층, 시설/ }).click();
    await button(p, '검색 접기').click(); await absent(searchSheet(p));
    await text(p, '검사 카메라 이동 2회').waitFor(); await text(p, '검사 검색 건물: bldg_A').waitFor();
    await absent(button(p, '선택 취소')); await absent(text(p, '검사 실내')); await text(p, '실외 지도').waitFor();
  });
  await scenario('search: after leaving a floor and visiting another tab the searched building is kept', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험');
    await toggle(p).click(); await button(p, '검사 건물 누르기: bldg_B').click(); await button(p, 'B동 2층').click();
    await text(p, '검사 실내: bldg_B 2층').waitFor(); await button(p, '실외 지도로 나가기').click(); await text(p, '실외 지도').waitFor();
    await checked(toggle(p), false);
    await button(p, '장소 검색 열기').click(); await searchSheet(p).getByRole('button', { name: /^C동,/ }).click();
    await text(p, '검사 카메라 이동 1회').waitFor(); await button(p, '검색 닫기').click(); await text(p, '검사 검색 건물: bldg_C').waitFor();
    await tab(p, '논술').click(); await selected(p, '논술'); await tab(p, '지도·길찾기').click(); await selected(p, '지도·길찾기');
    await text(p, '검사 검색 건물: bldg_C').waitFor(); await text(p, '검사 카메라 이동 1회').waitFor();
    await absent(searchSheet(p)); await absent(button(p, '선택 취소')); await text(p, '실외 지도').waitFor();
    // A new search starts empty at the building list.
    await button(p, '장소 검색 열기').click(); assert.equal(await searchBox(p).inputValue(), ''); await text(p, '건물을 골라 주세요').waitFor();
  });

  /* ---------- 2. ← (선택 취소) and the back key ---------- */
  await scenario('selection ←: padded words reopen trimmed, list picks and blank words go to the map', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험');
    await button(p, '장소 검색 열기').click(); await searchBox(p).fill('  408  ');
    await searchSheet(p).getByRole('button', { name: /^408호 강의실, / }).click(); await button(p, '선택 취소').click();
    assert.equal(await searchBox(p).inputValue(), '408');
    // Empty words: a pick from the building tree is not a "search", so ← goes to the map.
    await button(p, '검색어 지우기').click(); await searchSheet(p).getByRole('button', { name: /^A동,/ }).click();
    await searchSheet(p).getByRole('button', { name: /^A동 4층, 시설/ }).click(); await searchSheet(p).getByRole('button', { name: /^408호 강의실, / }).click();
    await text(p, '검사 선택 장소: 408호 강의실').waitFor(); await button(p, '선택 취소').click();
    await absent(searchSheet(p)); await absent(button(p, '선택 취소')); await button(p, '장소 검색 열기').waitFor();
    // Blank words behave like empty words.
    await button(p, '장소 검색 열기').click(); await searchBox(p).fill('   '); await text(p, '건물을 골라 주세요').waitFor();
    await searchSheet(p).getByRole('button', { name: /^B동,/ }).click(); await searchSheet(p).getByRole('button', { name: /^B동 2층, 시설/ }).click();
    await searchSheet(p).getByRole('button', { name: /^201호 강의실, / }).click(); await button(p, '선택 취소').click();
    await absent(searchSheet(p)); await button(p, '장소 검색 열기').waitFor();
  });
  await scenario('search without results offers the building list and never creates a selection', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험');
    await button(p, '장소 검색 열기').click(); await searchBox(p).fill('없는강의실');
    await text(p, '검색 결과가 없습니다').waitFor(); await absent(searchSheet(p).getByRole('button', { name: /호 강의실, / }));
    await button(p, '건물·층으로 찾아보기').click(); assert.equal(await searchBox(p).inputValue(), ''); await text(p, '건물을 골라 주세요').waitFor();
    await searchBox(p).fill('없는강의실'); await button(p, '검색 닫기').click(); await absent(searchSheet(p));
    await absent(button(p, '선택 취소')); await absent(text(p, '검사 선택 장소'));
    await button(p, '장소 검색 열기').click(); assert.equal(await searchBox(p).inputValue(), '');
  });
  await scenario('selection ←: a map tap and a sheet list pick go straight back; the name reopens search', async (p) => {
    await useDemo(p, '야외 가상 경로 시험');
    await button(p, '검사 지점: 가상 시험 지점 2').click();
    await button(p, '선택한 장소: 가상 시험 지점 2, 캠퍼스 야외. 눌러서 다시 검색').waitFor(); await absent(button(p, '장소 검색 열기'));
    await button(p, '선택 취소').click(); await absent(searchSheet(p)); await button(p, '장소 검색 열기').waitFor();
    await button(p, '이 보기의 장소 3곳').click(); await button(p, /^가상 시험 지점 3/).click();
    await text(p, '검사 선택 장소: 가상 시험 지점 3').waitFor(); await text(p, '검사 카메라 이동 1회').waitFor();
    assert.equal(await back(p), true); await absent(searchSheet(p)); await absent(text(p, '검사 선택 장소'));
    await button(p, '검사 지점: 가상 시험 지점 1').click(); await button(p, /^선택한 장소: 가상 시험 지점 1/).click();
    assert.equal(await searchBox(p).inputValue(), ''); await absent(button(p, '선택 취소'));
  });
  await scenario('back key: selection → its search → map, then the key goes back to the system', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험');
    await button(p, '장소 검색 열기').click(); await searchBox(p).fill('남자');
    await searchSheet(p).getByRole('button', { name: /^A동 4층 남자 화장실, / }).click(); await button(p, '선택 취소').waitFor();
    assert.equal(await back(p), true); assert.equal(await searchBox(p).inputValue(), '남자'); await absent(button(p, '선택 취소'));
    assert.equal(await back(p), true); await absent(searchSheet(p)); await button(p, '장소 검색 열기').waitFor();
    assert.equal(await back(p), false);
    // On another tab the key first returns to the map tab.
    await tab(p, '축제').click(); assert.equal(await back(p), true); await selected(p, '지도·길찾기');
  });
  await scenario('selection ← after the place became a start or an end', async (p) => {
    await useDemo(p, '야외 가상 경로 시험');
    await button(p, '검사 지점: 가상 시험 지점 1').click(); await button(p, '출발지로').click();
    await button(p, '출발: 가상 시험 지점 1').waitFor(); await button(p, '도착: 검색해서 선택해 주세요').waitFor(); await absent(button(p, '선택 취소'));
    assert.equal(await back(p), true); await button(p, '장소 검색 열기').waitFor(); await absent(button(p, '선택 취소'));
    await button(p, '길찾기').click(); await button(p, '출발: 검색해서 선택해 주세요').waitFor(); await button(p, '길찾기 닫기').click();
    await button(p, '장소 검색 열기').click(); await searchBox(p).fill('지점 3'); await searchSheet(p).getByRole('button', { name: /^가상 시험 지점 3, / }).click();
    await button(p, '도착지로').click(); await button(p, '도착: 가상 시험 지점 3').waitFor();
    await button(p, '출발: 검색해서 선택해 주세요').click(); await searchBox(p).fill('지점 1'); await searchSheet(p).getByRole('button', { name: /^가상 시험 지점 1, / }).click();
    await text(p, '검사 경로 좌표').waitFor(); await button(p, '출발·도착 수정').click(); await button(p, '출발: 가상 시험 지점 1').waitFor();
    assert.equal(await back(p), true); await button(p, '장소 검색 열기').waitFor(); await absent(button(p, '선택 취소')); await absent(text(p, '검사 경로 좌표'));
  });

  /* ---------- 3. Building switch and floor card ---------- */
  await scenario('building switch: ON highlights only mapped buildings, OFF removes them', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험');
    await checked(toggle(p), false); await absent(text(p, '검사 건물 강조'));
    await toggle(p).click(); await checked(toggle(p), true); await text(p, '검사 건물 강조 3곳').waitFor();
    await text(p, '파란 테두리 건물을 누르면 층을 골라 실내를 볼 수 있어요.').waitFor();
    assert.equal(await button(p, /^검사 건물 누르기:/).count(), 3);
    await toggle(p).click(); await checked(toggle(p), false); await absent(text(p, '검사 건물 강조')); await absent(button(p, /^검사 건물 누르기:/));
  });
  await scenario('floor card: ✕, 지도에서 계속 보기 and back close it; a floor enters and is marked current', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험'); await toggle(p).click();
    const press = () => button(p, '검사 건물 누르기: bldg_B').click();
    await press(); await p.getByLabel('B동 층 선택').waitFor(); assert.equal(await button(p, /^B동 \d층$/).count(), 2);
    await button(p, '층 선택 닫기').click(); await absent(p.getByLabel('B동 층 선택'));
    await press(); await button(p, '지도에서 계속 보기').click(); await absent(button(p, '층 선택 닫기'));
    await press(); await back(p); await absent(button(p, '층 선택 닫기')); await checked(toggle(p), true); await absent(text(p, '검사 실내'));
    await press(); await button(p, 'B동 1층').click(); await absent(button(p, '층 선택 닫기'));
    await text(p, 'B동 · 1층').waitFor(); await text(p, '검사 실내: bldg_B 1층').waitFor();
    await isSelected(button(p, '1층')); await isSelected(button(p, '2층'), false); await checked(toggle(p), true);
    await press(); await isSelected(button(p, 'B동 1층, 지금 보는 층')); await isSelected(button(p, 'B동 2층'), false);
    await button(p, 'B동 2층').click(); await text(p, '검사 실내: bldg_B 2층').waitFor(); await isSelected(button(p, '2층'));
  });
  await scenario('inside a building: switch to another, a one-floor building enters at once, OFF goes outdoors', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험'); await toggle(p).click();
    await button(p, '검사 건물 누르기: bldg_A').click(); await button(p, 'A동 3층').click(); await text(p, '검사 실내: bldg_A 3층').waitFor();
    await button(p, '검사 건물 누르기: bldg_C').click(); await text(p, '검사 실내: bldg_C 5층').waitFor(); await text(p, 'C동 · 5층').waitFor();
    await absent(button(p, '층 선택 닫기'));
    await button(p, '검사 건물 누르기: bldg_A').click(); await absent(button(p, /지금 보는 층$/)); await button(p, 'A동 1층').click();
    await text(p, '검사 실내: bldg_A 1층').waitFor();
    await toggle(p).click(); await checked(toggle(p), false); await text(p, '실외 지도').waitFor();
    await absent(text(p, '검사 실내')); await absent(text(p, '검사 건물 강조'));
    // The sheet's building list is the screen-reader path: it moves the camera and enters a one-floor building.
    await button(p, '건물 목록').click(); await button(p, /^C동, 1개 층/).click();
    await text(p, '검사 실내: bldg_C 5층').waitFor(); await text(p, '검사 카메라 이동 1회').waitFor(); await checked(toggle(p), true);
  });
  await scenario('buildings without floors and places with an unknown floor (test fixture)', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험'); await toggle(p).click(); await text(p, '검사 건물 강조 4곳').waitFor();
    await button(p, '검사 건물 누르기: bldg_D').click(); await text(p, '이 건물의 층 정보가 아직 없습니다.').waitFor();
    await absent(button(p, '층 선택 닫기')); await absent(text(p, '검사 실내'));
    await button(p, '장소 검색 열기').click(); await searchSheet(p).getByRole('button', { name: /^B동,/ }).click();
    await searchSheet(p).getByRole('button', { name: 'B동 층 미확인, 시설 1곳' }).click(); await text(p, 'B동 · 층 미확인').waitFor();
    await searchSheet(p).getByRole('button', { name: /^B동 안내데스크\(층 미확인\), B동$/ }).click();
    await text(p, '검사 선택 장소: B동 안내데스크(층 미확인)').waitFor(); await text(p, 'B동 · 층 미확인').waitFor();
    // No floor chip is current when the floor is unknown.
    await isSelected(button(p, '1층'), false); await isSelected(button(p, '2층'), false);
  }, undefined, null, 'fixture=edge');
  await scenario('real data without indoor buildings: switch explains and the building list stays disabled', async (p) => {
    await toggle(p).click(); await checked(toggle(p), true);
    await text(p, '등록된 실내 건물·층 데이터가 없습니다').waitFor(); await text(p, '검사 건물 강조 0곳').waitFor();
    assert.equal(await button(p, '건물 목록').isDisabled(), true); await absent(button(p, /^검사 건물 누르기:/));
    await toggle(p).click(); await checked(toggle(p), false);
  });

  /* ---------- 4. Nearest restroom ---------- */
  const restroomRows = (p) => searchSheet(p).getByRole('button', { name: /^A동 4층 .*화장실, / });
  await scenario('restroom gender lists: 남자 drops only female, 여자 drops only male, no-gender kinds stay in both', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험'); await button(p, '가장 가까운 화장실 찾기').click();
    await text(p, '화장실 찾기 · 출발 위치').waitFor(); await checked(radio(p, '전체 화장실'), true);
    await searchBox(p).fill('화장실'); assert.equal(await restroomRows(p).count(), 6);
    const both = ['A동 4층 공용 화장실, 남녀공용 화장실', 'A동 4층 가족 화장실, 가족 화장실', 'A동 4층 미지정 화장실, 화장실', 'A동 4층 기타 표기 화장실, 화장실'];
    for (const [gender, gone, kept] of [['남자', '여자', '남자'], ['여자', '남자', '여자']]) {
      await radio(p, `${gender} 화장실`).click(); await checked(radio(p, `${gender} 화장실`), true); await checked(radio(p, '전체 화장실'), false);
      assert.equal(await restroomRows(p).count(), 5);
      await absent(searchSheet(p).getByRole('button', { name: new RegExp(`^A동 4층 ${gone} 화장실`) }));
      await searchSheet(p).getByRole('button', { name: new RegExp(`^A동 4층 ${kept} 화장실, ${kept} 화장실`) }).waitFor();
      for (const name of both) await searchSheet(p).getByRole('button', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')} · A동 · 4층$`) }).waitFor();
    }
    // The building tree is filtered the same way.
    await button(p, '건물·층으로 찾아보기').click(); await searchSheet(p).getByRole('button', { name: /^A동,/ }).click();
    await searchSheet(p).getByRole('button', { name: /^A동 4층, 시설/ }).click(); await text(p, '화장실 5').waitFor();
    await radio(p, '전체 화장실').click(); await text(p, '화장실 6').waitFor();
    // Start/end searches are never reduced by the restroom gender.
    await button(p, '검색 닫기').click(); await button(p, '길찾기').click(); await button(p, '도착: 검색해서 선택해 주세요').click();
    await searchBox(p).fill('화장실'); assert.equal(await restroomRows(p).count(), 6);
  }, undefined, null, 'fixture=edge');
  await scenario('restroom: gender chosen before the start, then the start gives the route', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험'); await button(p, '가장 가까운 화장실 찾기').click();
    await radio(p, '여자 화장실').click(); await searchBox(p).fill('408'); await searchSheet(p).getByRole('button', { name: /^408호 강의실, / }).click();
    await text(p, '가장 가까운 여자 화장실 · A동 4층 여자 화장실').waitFor(); await checked(radio(p, '여자 화장실'), true);
    await text(p, '검사 경로 좌표').waitFor(); await text(p, '단계별 안내').waitFor();
    assert.ok((await routeNumbers(p)).steps >= 1);
    await button(p, /^출발·도착 다시 고치기/).waitFor(); await text(p, 'A동 4층 여자 화장실').waitFor();
    await absent(button(p, '가장 빠른 길')); // restroom results show gender chips instead of travel modes
  }, undefined, null, 'fixture=edge');
  await scenario('restroom: 전체/남자/여자 × 휠체어 pick the expected nearest restroom', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험'); await button(p, '가장 가까운 화장실 찾기').click();
    await searchBox(p).fill('408'); await searchSheet(p).getByRole('button', { name: /^408호 강의실, / }).click();
    const expected = [
      ['전체', false, '가장 가까운 화장실 · A동 4층 남자 화장실'], ['남자', false, '가장 가까운 남자 화장실 · A동 4층 남자 화장실'],
      ['여자', false, '가장 가까운 여자 화장실 · A동 4층 여자 화장실'], ['여자', true, '가장 가까운 여자 화장실 · A동 4층 여자 화장실'],
      ['남자', true, '가장 가까운 남자 화장실 · A동 4층 공용 화장실'], ['전체', true, '가장 가까운 화장실 · A동 4층 여자 화장실'],
    ];
    for (const [gender, chair, title] of expected) {
      if ((await wheelchair(p).getAttribute('aria-checked')) !== String(chair)) await wheelchair(p).click();
      await radio(p, `${gender} 화장실`).click();
      await p.getByRole('heading', { name: title, exact: true }).waitFor();
      await checked(wheelchair(p), chair); await checked(radio(p, `${gender} 화장실`), true); await text(p, '검사 경로 좌표').waitFor();
    }
  }, undefined, null, 'fixture=edge');
  await scenario('restroom: no match shows guidance and no stale route', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험'); await button(p, '가장 가까운 화장실 찾기').click();
    await searchBox(p).fill('408'); await searchSheet(p).getByRole('button', { name: /^408호 강의실, / }).click(); await text(p, '검사 경로 좌표').waitFor();
    await radio(p, '남자 화장실').click(); await wheelchair(p).click();
    await text(p, '휠체어로 갈 수 있는 화장실을 찾지 못했습니다').waitFor(); await absent(text(p, '검사 경로 좌표'));
    await wheelchair(p).click(); await p.getByRole('heading', { name: '가장 가까운 남자 화장실 · A동 4층 남자 화장실' }).waitFor();
    // A campus without restrooms: 전체 and a gender each give their own guidance.
    await button(p, '출발·도착 수정').click(); await button(p, '길찾기 닫기').click();
    await useDemo(p, '야외 가상 경로 시험'); await button(p, '가장 가까운 화장실 찾기').click();
    await searchBox(p).fill('지점 1'); await searchSheet(p).getByRole('button', { name: /^가상 시험 지점 1, / }).click();
    await text(p, '가까운 화장실을 찾지 못했습니다').waitFor(); await absent(text(p, '검사 경로 좌표'));
    await radio(p, '여자 화장실').click(); await text(p, '조건에 맞는 화장실을 찾지 못했습니다').waitFor(); await absent(text(p, '검사 경로 좌표'));
  });
  await scenario('restroom: filter is kept while editing, across tabs, and reset on a new search', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험'); await button(p, '가장 가까운 화장실 찾기').click();
    await radio(p, '남자 화장실').click(); await button(p, '검색 닫기').click();
    await button(p, '가장 가까운 화장실 찾기').click(); await checked(radio(p, '전체 화장실'), true);
    await radio(p, '여자 화장실').click(); await searchBox(p).fill('408'); await searchSheet(p).getByRole('button', { name: /^408호 강의실, / }).click();
    await p.getByRole('heading', { name: '가장 가까운 여자 화장실 · A동 4층 여자 화장실' }).waitFor();
    await tab(p, '학교행사').click(); await tab(p, '지도·길찾기').click();
    await p.getByRole('heading', { name: '가장 가까운 여자 화장실 · A동 4층 여자 화장실' }).waitFor(); await checked(radio(p, '여자 화장실'), true);
    await button(p, '출발·도착 수정').click(); await checked(radio(p, '여자 화장실'), true); await checked(wheelchair(p), false);
    await button(p, '길찾기 닫기').click(); await button(p, '가장 가까운 화장실 찾기').click(); await checked(radio(p, '전체 화장실'), true);
  }, undefined, null, 'fixture=edge');

  /* ---------- 5. Route options, round trip and roadview ---------- */
  await scenario('travel modes: one selected at a time, numbers agree between sheet, collapsed bar and map', async (p) => {
    await useDemo(p, '실내·계단·엘리베이터 시험', '정문 → 가상 408호 선택'); await button(p, '길찾기').click(); await text(p, '검사 경로 좌표').waitFor();
    const seen = {};
    for (const name of modeNames) {
      await button(p, name).click(); await onlyMode(p, name); await text(p, '단계별 안내').waitFor();
      const n = await routeNumbers(p); seen[name] = n;
      assert.equal(n.distance, n.mapDistance, JSON.stringify(n)); assert.ok(n.minutes >= 1 && n.steps >= 1, JSON.stringify(n));
      await checked(wheelchair(p), name === '휠체어');
      await button(p, '시트 접기').click(); await text(p, `${n.minutes}분 · ${n.distance}m`).waitFor(); await button(p, '시트 펼치기').click();
      if (name === '계단 없는 길' || name === '휠체어') assert.equal(await stat(p, '계단'), '0곳');
      if (name === '엘리베이터 우선') await text(p, '(엘리베이터)').waitFor();
    }
    // The wheelchair switch and the 휠체어 chip are the same option.
    await checked(wheelchair(p), false); await wheelchair(p).click(); await onlyMode(p, '휠체어'); await checked(wheelchair(p), true);
    assert.equal((await routeNumbers(p)).distance, seen['휠체어'].distance);
    // Off returns to the walking default (가장 빠른 길), not to the last chip.
    await wheelchair(p).click(); await onlyMode(p, '가장 빠른 길'); assert.equal((await routeNumbers(p)).distance, seen['가장 빠른 길'].distance);
  });
  await scenario('round trip: switch joins both legs and turning it off restores the one-way route', async (p) => {
    await useDemo(p, '실내·실외 로드뷰 시험', '갈림길 예시: 정문 → 가상 중앙 광장');
    await text(p, '검사 경로 좌표').waitFor(); const one = await routeNumbers(p);
    await checked(roundTrip(p), false); await absent(exactText(p, '가는 길')); await absent(exactText(p, '오는 길'));
    await roundTrip(p).click(); await checked(roundTrip(p), true); await text(p, `m · 왕복`).waitFor();
    const both = await routeNumbers(p);
    assert.equal(both.distance, both.mapDistance); assert.equal(both.distance, one.distance * 2); assert.equal(both.steps, one.steps * 2);
    assert.equal(await exactText(p, '가는 길').count(), 1); assert.equal(await exactText(p, '오는 길').count(), 1);
    await roundTrip(p).click(); await checked(roundTrip(p), false); await absent(exactText(p, '오는 길')); await absent(text(p, 'm · 왕복')); assert.deepEqual(await routeNumbers(p), one);
  });
  await scenario('roadview: open, move by index, full screen, close and back key, step bubbles', async (p) => {
    await useDemo(p, '실내·실외 로드뷰 시험', '정문 → 가상 201호 강의실'); await text(p, '검사 경로 좌표').waitFor();
    await button(p, '로드뷰로 보기').click(); const rv = roadview(p); await rv.waitFor();
    await rv.getByText('1 / 8 · 가상 정문').waitFor(); assert.equal(await button(p, '이전 단계').isDisabled(), true);
    for (let i = 2; i <= 8; i++) { await button(p, '다음 단계').click(); await rv.getByText(new RegExp(`^${i} / 8 · `)).waitFor(); }
    assert.equal(await button(p, '다음 단계').isDisabled(), true); await button(p, '이전 단계').click(); await rv.getByText(/^7 \/ 8 · /).waitFor();
    await button(p, '전체화면으로 보기').click(); await absent(rv.getByText(/^검사 미니 지도/));
    await button(p, '분할 화면으로 돌아가기').click(); await rv.getByText(/^검사 미니 지도/).waitFor();
    await button(p, '로드뷰 닫기').click(); await absent(roadview(p));
    await button(p, '로드뷰로 보기').click(); await roadview(p).getByText('1 / 8 · 가상 정문').waitFor();
    assert.equal(await back(p), true); await absent(roadview(p)); await text(p, '검사 경로 좌표').waitFor();
    // A step with a photo opens a bubble on the map; the bubble opens the roadview at that step.
    await button(p, /^3단계\. .*눌러서 지도에서 사진 보기$/).click(); await text(p, '검사 말풍선').waitFor();
    await p.getByLabel('검사 로드뷰 말풍선').getByRole('button').click(); await roadview(p).getByText(/^3 \/ 8 · /).waitFor();
    await button(p, '로드뷰 닫기').click(); await absent(text(p, '검사 말풍선'));
    // A point passed twice on the way (steps 6 and 7) asks which step to show.
    await button(p, '검사 경로 사진 묶음: 6단계 / 7단계').click();
    assert.equal(await p.getByLabel('검사 로드뷰 말풍선').getByRole('button').count(), 2);
    assert.equal(await back(p), true); await absent(text(p, '검사 말풍선'));
    await button(p, '검사 경로 사진 묶음: 6단계 / 7단계').click(); await button(p, '7단계 로드뷰 보기').click(); await roadview(p).getByText(/^7 \/ 8 · /).waitFor();
  });
  await scenario('roadview round trip: 가는 길 / 오는 길 frames and the two-way bubble', async (p) => {
    await useDemo(p, '실내·실외 로드뷰 시험', '왕복 예시: 정문 ↔ 가상 본관 앞'); await checked(roundTrip(p), true);
    await button(p, '로드뷰로 보기').click(); const rv = roadview(p);
    await rv.getByText('가는 길 · 1 / 5 · 가상 정문').waitFor();
    const counters = ['가는 길 · 1 / 5'];
    for (let i = 2; i <= 5; i++) { await button(p, '다음 단계').click(); counters.push(await rv.getByText(new RegExp(`^(가는|오는) 길 · ${i} / 5`)).textContent()); }
    assert.ok(counters.some((c) => c.startsWith('가는 길')) && counters.at(-1).startsWith('오는 길 · 5 / 5'), counters.join(' | '));
    await button(p, '로드뷰 닫기').click();
    const group = button(p, '검사 경로 사진 묶음: 가는 길 · 2단계 / 오는 길 · 4단계');
    await group.click(); await button(p, '가는 길 · 2단계 로드뷰 보기').click(); await roadview(p).getByText(/^가는 길 · 2 \/ 5/).waitFor();
    await button(p, '로드뷰 닫기').click();
    await group.click(); await button(p, '오는 길 · 4단계 로드뷰 보기').click(); await roadview(p).getByText(/^오는 길 · 4 \/ 5/).waitFor();
    await button(p, '로드뷰 닫기').click(); await absent(roadview(p)); await absent(text(p, '검사 말풍선'));
  });
  await scenario('roadview branch: other directions at a fork, chosen per point and reset on reopen', async (p) => {
    await useDemo(p, '실내·실외 로드뷰 시험', '갈림길 예시: 정문 → 가상 중앙 광장');
    await button(p, '로드뷰로 보기').click(); const rv = roadview(p); await rv.getByText(/^1 \/ 3 · /).waitFor();
    await button(p, '다음 단계').click(); await rv.getByText('2 / 3 · 가상 본관 앞 갈림길').waitFor();
    const others = button(p, '이 지점 다른 방향 사진 3장');
    assert.equal(await others.getAttribute('aria-expanded'), 'false'); await others.click(); assert.equal(await others.getAttribute('aria-expanded'), 'true');
    const chips = rv.getByRole('button', { name: /° 방향 사진$/ }); assert.equal(await chips.count(), 4);
    await isSelected(button(p, '서쪽 270° 방향 사진')); await rv.getByText(/^검사 미니 지도: .* · 서쪽 270°/).waitFor();
    await button(p, '북쪽 0° 방향 사진').click(); await isSelected(button(p, '북쪽 0° 방향 사진')); await isSelected(button(p, '서쪽 270° 방향 사진'), false);
    await rv.getByText(/^검사 미니 지도: .* · 북쪽 0°/).waitFor(); await rv.getByText('북쪽 0° 방향을 보고 있습니다', { exact: false }).first().waitFor();
    await button(p, '다음 단계').click(); await rv.getByText(/^3 \/ 3 · /).waitFor(); await absent(button(p, /° 방향 사진$/));
    await button(p, '이전 단계').click(); await rv.getByText(/^검사 미니 지도: .* · 북쪽 0°/).waitFor();
    await button(p, '로드뷰 닫기').click(); await button(p, '로드뷰로 보기').click(); await button(p, '다음 단계').click();
    await roadview(p).getByText(/^검사 미니 지도: .* · 서쪽 270°/).waitFor();
  });
  await scenario('another tab and back keeps travel mode, round trip, route and sheet', async (p) => {
    await useDemo(p, '실내·실외 로드뷰 시험', '왕복 예시: 정문 ↔ 가상 본관 앞');
    await button(p, '계단 최소').click(); await onlyMode(p, '계단 최소'); await checked(roundTrip(p), true);
    const before = await routeNumbers(p);
    for (const name of ['논술', '축제', '내정보']) { await tab(p, name).click(); await selected(p, name); }
    await tab(p, '지도·길찾기').click();
    await onlyMode(p, '계단 최소'); await checked(roundTrip(p), true); assert.deepEqual(await routeNumbers(p), before);
    await button(p, '출발·도착 수정').waitFor(); await text(p, '단계별 안내').waitFor(); await absent(roadview(p)); await absent(searchSheet(p));
  });
  await scenario('changing an option clears the roadview bubble and the roadview restarts at the first step', async (p) => {
    await useDemo(p, '실내·실외 로드뷰 시험', '정문 → 가상 201호 강의실');
    await button(p, /^3단계\. .*눌러서 지도에서 사진 보기$/).click(); await text(p, '검사 말풍선').waitFor();
    await button(p, '계단 없는 길').click(); await onlyMode(p, '계단 없는 길'); await absent(text(p, '검사 말풍선'));
    await button(p, '검사 경로 사진 묶음: 1단계').click(); await text(p, '검사 말풍선').waitFor();
    await roundTrip(p).click(); await absent(text(p, '검사 말풍선'));
    await button(p, '로드뷰로 보기').click(); await roadview(p).getByText(/^가는 길 · 1 \/ /).waitFor();
  });

  /* ---------- Marker layout in the real CampusMap (fake MapLibre, counts React work) ---------- */
  await markerScenario('CampusMap markers: throttled pan, exact settle, no re-render when the layout is unchanged', async (p) => {
    // Helpers live in the page: region events, frame pacing, render counters and the exact layout for comparison.
    await p.evaluate(() => {
      const ev = (lng, lat, zoom, bearing = 0) => ({ nativeEvent: { center: [lng, lat], zoom, bearing } });
      window.__t = {
        frame: () => new Promise((resolve) => setTimeout(resolve, 16)),
        moving: (lng, lat, zoom) => window.__campoMap.onRegionIsChanging(ev(lng, lat, zoom)),
        settle: (lng, lat, zoom) => window.__campoMap.onRegionDidChange(ev(lng, lat, zoom)),
        counts: () => ({ map: window.__campoRenders.map, markers: window.__campoRenders.markers }),
        shown: () => [...document.querySelectorAll('[data-marker]')].map((el) => el.getAttribute('data-marker')).sort(),
        expected: (lng, lat, zoom) => {
          const L = window.__campoLabels;
          const frame = document.querySelector('[aria-label="검사 지도"]').getBoundingClientRect();
          const markers = L.buildMarkers({ places: window.__campoPlaces, facilities: L.floorFacilityNodes(window.__campoGraph, 'bldg_A', 4) });
          const placed = L.declutter(markers, { lng, lat, zoom, bearing: 0, width: frame.width, height: frame.height }, { stage: L.zoomStage(zoom, true) });
          return [...placed.filter((x) => x.marker.tone === 'normal').map((x) => `facility:${x.marker.id}`), ...placed.filter((x) => x.label).map((x) => `place-label:${x.marker.id}`)].sort();
        },
      };
    });
    const lng0 = 127.00065, lat0 = 37.0005;
    await p.evaluate(async ([lng, lat]) => { window.__t.settle(lng, lat, 20.2); await window.__t.frame(); }, [lng0, lat0]);
    const first = await p.evaluate(([lng, lat]) => ({ shown: window.__t.shown(), expected: window.__t.expected(lng, lat, 20.2) }), [lng0, lat0]);
    assert.deepEqual(first.shown, first.expected);
    const labelsShown = first.shown.filter((id) => id.startsWith('place-label:')).length, iconsShown = first.shown.length - labelsShown;
    assert.ok(labelsShown > 0 && labelsShown <= 16 && iconsShown > 0 && iconsShown <= 48, JSON.stringify({ labelsShown, iconsShown }));
    // 60 frames of panning (≈ 7 px per frame at zoom 20.2), then the settle event.
    const pan = await p.evaluate(async ([lng, lat]) => {
      const t = window.__t, before = t.counts();
      for (let f = 1; f <= 60; f++) { t.moving(lng + f * 4e-6, lat, 20.2); await t.frame(); }
      t.settle(lng + 60 * 4e-6, lat, 20.2); await t.frame(); await t.frame();
      const after = t.counts();
      return { map: after.map - before.map, markers: after.markers - before.markers, shown: t.shown(), expected: t.expected(lng + 60 * 4e-6, lat, 20.2) };
    }, [lng0, lat0]);
    assert.deepEqual(pan.shown, pan.expected);
    // The pre-optimisation map re-rendered on all 61 events and rebuilt every drawn marker each time (61 × shown).
    assert.ok(pan.map <= 15, `map renders ${pan.map}`);
    assert.ok(pan.markers <= first.shown.length * 6, `marker renders ${pan.markers} for ${first.shown.length} shown`);
    console.log(`  campus map pan: map renders ${pan.map} (legacy 61), Marker renders ${pan.markers} (legacy ${61 * first.shown.length})`);
    // A resting finger (±0.3 px) changes nothing: no map or Marker render at all.
    const jitter = await p.evaluate(async ([lng, lat]) => {
      const t = window.__t, before = t.counts(), x = lng + 60 * 4e-6;
      for (let f = 0; f < 60; f++) { t.moving(x + (f % 2 ? 1 : -1) * 1.5e-7, lat, 20.2); await t.frame(); }
      t.settle(x, lat, 20.2); await t.frame();
      const after = t.counts(); return { map: after.map - before.map, markers: after.markers - before.markers };
    }, [lng0, lat0]);
    assert.deepEqual(jitter, { map: 0, markers: 0 });
    // A parent re-render with a new onPlace does not rebuild markers, and a tap still reaches the latest callback.
    const parent = await p.evaluate(async () => { const before = window.__t.counts(); window.__campoRerenderParent(); await window.__t.frame(); return window.__t.counts().markers - before.markers; });
    assert.equal(parent, 0);
    const tappable = p.locator('[data-marker^="facility:syn_"] button').first();
    const id = (await tappable.locator('xpath=ancestor::*[@data-marker][1]').getAttribute('data-marker')).replace('facility:', '');
    await tappable.click(); assert.equal(await p.evaluate(() => window.__campoPicked), `1:${id}`);
    // Zooming out past the label stage drops the names at once (stage changes are never throttled).
    await p.evaluate(async ([lng, lat]) => { window.__t.moving(lng, lat, 18.4); await window.__t.frame(); }, [lng0, lat0]);
    const zoomedOut = await p.evaluate(([lng, lat]) => ({ shown: window.__t.shown(), expected: window.__t.expected(lng, lat, 18.4) }), [lng0, lat0]);
    assert.deepEqual(zoomedOut.shown, zoomedOut.expected); assert.equal(zoomedOut.shown.filter((x) => x.startsWith('place-label:')).length, 0);
  });
  for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1024, height: 1366 }, { width: 320, height: 568, fontScale: 1.6 }]) {
    await scenario(`layout ${size.width}x${size.height} font ${size.fontScale ?? 1}`, async (p) => {
      if (size.fontScale) await p.evaluate((scale) => { window.__campoFontScale = scale; window.dispatchEvent(new Event('resize')); }, size.fontScale);
      let i = 0;
      for (const name of ['지도·길찾기', '논술', '축제', '학교행사', '내정보']) {
        await tab(p, name).click(); await selected(p, name);
        const metrics = await p.evaluate(() => ({ width: innerWidth, height: innerHeight, bodyWidth: document.body.scrollWidth, bodyHeight: document.body.scrollHeight, tabs: [...document.querySelectorAll('[role=tab]')].map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) }));
        assert.ok(metrics.bodyWidth <= size.width + 1, JSON.stringify(metrics));
        assert.ok(metrics.bodyHeight <= size.height + 1, JSON.stringify(metrics));
        assert.equal(metrics.tabs.length, 5);
        for (const rect of metrics.tabs) { assert.ok(rect.width >= 44 && rect.height >= 44, JSON.stringify(rect)); assert.ok(rect.x >= -1 && rect.x + rect.width <= size.width + 1 && rect.y + rect.height <= size.height + 1, JSON.stringify(rect)); }
        await p.screenshot({ path: join(output, `${size.width}-${size.height}-${size.fontScale ?? 1}-tab-${i++}.png`) });
      }
    }, size);
  }
} finally {
  await browser?.close(); server?.kill('SIGTERM'); log.end();
  await writeFile(join(output, 'report.json'), JSON.stringify({ nativeVerified: false, kind: 'DOM-adapted real React screen interactions', results }, null, 2));
  console.log(`Report: ${join(output, 'report.json')}`);
}
