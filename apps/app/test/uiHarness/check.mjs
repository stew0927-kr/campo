// Real React screen handlers in a test-only DOM adapter. Not an Android/MapLibre/Expo Go test.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
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
const tab = (page, name) => page.getByRole('tab', { name, exact: true });
async function selected(page, name) { assert.equal(await tab(page, name).getAttribute('aria-selected'), 'true'); }
async function scenario(name, run, viewport = { width: 390, height: 844 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(7000);
  try {
    await page.goto(url);
    await text(page, '어디로 가시나요?').waitFor();
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
  const dialog = page.getByRole('dialog'); await dialog.waitFor();
  assert.equal(await dialog.getByRole('textbox', { name: '장소 검색어' }).inputValue(), expected);
  await button(page, '닫기').click();
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
      await p.getByRole('dialog').waitFor(); assert.equal(await p.getByRole('textbox', { name: '장소 검색어' }).inputValue(), '가상 축제 광장'); await button(p, '닫기').click();
      await text(p, '출발: 검색해서 선택해 주세요').waitFor();
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
    await tab(p, '지도·길찾기').click(); assert.equal(await button(p, '휠체어').getAttribute('aria-selected'), 'true');
    await button(p, '현재 위치를 출발지로').click(); await text(p, '위치 권한이 없어도 출발지와 목적지를 직접 선택').waitFor();
    await button(p, '실내').click(); await text(p, '등록된 실내 건물·층 데이터가 없습니다').waitFor();
  });
  await scenario('manual demo route, swap, reset and map selection cancel', async (p) => {
    await button(p, '야외 가상 경로 시험').click();
    for (const [field, name] of [['출발', '가상 시험 지점 1'], ['도착', '가상 시험 지점 3']]) {
      await button(p, new RegExp(`^${field}:`)).click(); const dialog = p.getByRole('dialog');
      await dialog.getByRole('textbox').fill(name); await dialog.getByRole('button', { name: new RegExp(name) }).click();
    }
    await button(p, '길찾기').click(); await text(p, '검사 경로 좌표').waitFor();
    await button(p, '출발·도착 바꾸기').click(); await button(p, '출발: 가상 시험 지점 3').waitFor();
    await button(p, '길찾기').click(); await text(p, '검사 경로 좌표').waitFor();
    await button(p, '선택 초기화').click(); await button(p, '도착: 검색해서 선택해 주세요').waitFor();
    await button(p, '지도에서 출발 선택').click(); await button(p, '지도 선택 취소').click();
    assert.equal(await button(p, '지도 선택 취소').count(), 0);
    await button(p, '지도에서 출발 선택').click(); await button(p, '검사: 지도 임의 점 선택').click();
    await button(p, '출발: 지도에서 선택한 위치').waitFor();
  });
  await scenario('indoor route, floor controls and cross-tab intent clears the developer fixture', async (p) => {
    await button(p, '실내·계단·엘리베이터 시험').click(); await button(p, '정문 → 가상 408호 선택').click();
    await button(p, '엘리베이터 우선').click(); await button(p, '길찾기').click();
    await text(p, '검사 경로 좌표').waitFor(); await text(p, '층 (엘리베이터)').waitFor();
    await button(p, '실외').click(); assert.equal(await button(p, '실외').getAttribute('aria-selected'), 'true');
    await button(p, '실내').click(); assert.equal(await button(p, '실내').getAttribute('aria-selected'), 'true');
    await tab(p, '논술').click(); await button(p, '고사장 상세 보기').first().click(); await handoffSearch(p, '가상 시험관 가상 301호');
    await text(p, '실제 캠퍼스 길 데이터가 아직 없습니다').waitFor();
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
