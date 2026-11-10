import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCampusApi, isCampusPath } from '../server/campus-api.ts';

let root: string;
let server: Server;
let base: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'campo-api-'));
  const api = createCampusApi(root);
  server = createServer((req, res) => void api(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  await rm(root, { recursive: true, force: true });
});

const put = (id: string, files: unknown) =>
  fetch(`${base}/api/campuses/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });

describe('campus API (dev server)', () => {
  it('only accepts paths of the SPEC §4.3 layout', () => {
    for (const ok of ['campus.json', 'outdoor.geojson', 'connections.geojson', 'buildings/ENG1/building.geojson', 'buildings/ENG1/L4.geojson', 'buildings/ENG1/L-1.geojson']) {
      expect(isCampusPath(ok), ok).toBe(true);
    }
    for (const bad of ['../x.geojson', 'buildings/../../x.geojson', '/etc/passwd', 'buildings/A/L0.geojson', 'notes.txt', 'buildings/A/B/L1.geojson']) {
      expect(isCampusPath(bad), bad).toBe(false);
    }
  });

  it('returns no files for a campus folder that does not exist yet', async () => {
    const res = await fetch(`${base}/api/campuses/new-campus`);
    expect(await res.json()).toEqual({ files: [] });
  });

  it('writes files, reads them back, and removes layout files that are gone', async () => {
    let res = await put('c1', { 'campus.json': '{}\n', 'outdoor.geojson': 'A', 'buildings/X/L2.geojson': 'B' });
    expect(res.status).toBe(200);
    expect(await readFile(join(root, 'c1', 'buildings/X/L2.geojson'), 'utf8')).toBe('B');
    await writeFile(join(root, 'c1', 'README.md'), 'keep me');

    res = await put('c1', { 'campus.json': '{}\n', 'outdoor.geojson': 'A2' });
    expect(await res.json()).toEqual({ written: ['campus.json', 'outdoor.geojson'], removed: ['buildings/X/L2.geojson'] });
    expect((await readdir(join(root, 'c1'))).sort()).toEqual(['README.md', 'campus.json', 'outdoor.geojson']); // empty building folder removed

    const read = await (await fetch(`${base}/api/campuses/c1`)).json();
    expect(read).toEqual({ files: [{ path: 'campus.json', text: '{}\n' }, { path: 'outdoor.geojson', text: 'A2' }] });
  });

  it('refuses bad paths and bad campus ids without writing anything', async () => {
    await mkdir(join(root, 'c2'));
    let res = await put('c2', { 'outdoor.geojson': 'A', '../../evil.geojson': 'x' });
    expect(res.status).toBe(400);
    expect(await readdir(join(root, 'c2'))).toEqual([]);

    res = await put('..%2F..', { 'outdoor.geojson': 'A' });
    expect(res.status).toBe(400);
    res = await put('c2', 'not an object');
    expect(res.status).toBe(400);
  });
});
