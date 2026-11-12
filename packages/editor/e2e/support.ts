// Helpers for the editor e2e tests: coordinates to pixels through the map, counted clicks, reading the saved folder.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { parseCampus, validateCampus, type LoadedFile } from '@campo/core';
import { CENTER, E2E_DIR } from './seed.ts';

/** Only used inside page.evaluate, where it is the browser's window (this folder is checked without DOM types). */
declare const window: object;

type Lnglat = [number, number];

export class Editor {
  clicks = 0;

  constructor(readonly page: Page) {
    // validateCampus errors would pop a confirm before saving; the tests check the result themselves.
    page.on('dialog', (d) => void d.accept());
  }

  async open(campusId: string): Promise<void> {
    await this.page.goto(`/?campus=${campusId}`);
    await this.page.waitForFunction(() => '__campoMap' in window && (window as unknown as { __campoMap: { loaded(): boolean } }).__campoMap.loaded());
    await this.view(CENTER, 18.4);
  }

  /** Move the map (not a click). */
  async view(center: Lnglat, zoom: number): Promise<void> {
    await this.page.evaluate(([lng, lat, z]) => {
      const map = (window as unknown as { __campoMap: { jumpTo(o: object): void } }).__campoMap;
      map.jumpTo({ center: [lng, lat], zoom: z });
    }, [center[0], center[1], zoom] as [number, number, number]);
    await this.page.waitForTimeout(400);
  }

  /** Pixel position on the page of a coordinate. */
  async px([lng, lat]: Lnglat): Promise<{ x: number; y: number }> {
    const p = await this.page.evaluate(([a, b]) => {
      const map = (window as unknown as { __campoMap: { project(c: number[]): { x: number; y: number }; getContainer(): { getBoundingClientRect(): { left: number; top: number } } } }).__campoMap;
      const o = map.project([a!, b!]);
      const r = map.getContainer().getBoundingClientRect();
      return { x: o.x + r.left, y: o.y + r.top };
    }, [lng, lat] as Lnglat);
    return p;
  }

  /** One counted click on the map. */
  async clickMap(at: Lnglat, opts: { shift?: boolean } = {}): Promise<void> {
    const { x, y } = await this.px(at);
    await this.page.mouse.move(x, y);
    if (opts.shift) await this.page.keyboard.down('Shift');
    await this.page.mouse.click(x, y);
    if (opts.shift) await this.page.keyboard.up('Shift');
    this.clicks++;
    await this.page.waitForTimeout(60);
  }

  /** One counted click on a button or radio. */
  async click(target: Locator): Promise<void> {
    await target.click();
    this.clicks++;
  }

  tool(label: string): Locator {
    return this.page.getByRole('group', { name: '도구' }).getByRole('button', { name: label, exact: true });
  }

  async save(): Promise<void> {
    await this.click(this.page.getByRole('button', { name: /^저장$/ }));
    await this.page.getByText(/^저장했습니다/).waitFor();
  }
}

/** Every file of the saved campus folder, the way the editor's own loader reads them. */
export function readSaved(campusId: string): LoadedFile[] {
  const dir = join(E2E_DIR, campusId);
  const files: LoadedFile[] = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    files.push({ path: relative(dir, abs).split(sep).join('/'), text: readFileSync(abs, 'utf8') });
  }
  return files;
}

export function checkSaved(campusId: string) {
  const campus = parseCampus(readSaved(campusId));
  return { campus, result: validateCampus(campus) };
}
