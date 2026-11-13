import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCampusApi, createReportsApi, createSurveysApi, isCampusPath, isChangesetFileName, isReportPath, isSurveyId, isSurveyPhotoName,
} from '../server/campus-api.ts';

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

  it('PUT may write overrides.json, but no other extra file', async () => {
    let res = await put('c2', { 'campus.json': '{}\n', 'overrides.json': '[]\n' });
    expect(res.status).toBe(200);
    expect(await readFile(join(root, 'c2', 'overrides.json'), 'utf8')).toBe('[]\n');
    expect(((await (await fetch(`${base}/api/campuses/c2`)).json()) as { files: { path: string }[] }).files.map((f) => f.path)).toEqual(['campus.json', 'overrides.json']);
    res = await put('c2', { 'calibration.json': '{}' });
    expect(res.status).toBe(400);
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

describe('campus API: extras', () => {
  it('sends overrides, calibration and observations on GET; PUT writes observations/*.jsonl but refuses calibration.json', async () => {
    await mkdir(join(root, 'c3', 'observations'), { recursive: true });
    await writeFile(join(root, 'c3', 'overrides.json'), '[]\n');
    await writeFile(join(root, 'c3', 'observations', 'a.jsonl'), '{"target":"edge:x"}\n');
    await writeFile(join(root, 'c3', 'notes.txt'), 'no');
    const read = (await (await fetch(`${base}/api/campuses/c3`)).json()) as { files: { path: string }[] };
    expect(read.files.map((f) => f.path)).toEqual(['observations/a.jsonl', 'overrides.json']);
    expect((await put('c3', { 'calibration.json': '{}' })).status).toBe(400);
    // measurements typed in the editor: observations/*.jsonl, one level deep
    const line = '{"target":"edge:x"}\n';
    expect((await put('c3', { 'observations/editor.jsonl': line })).status).toBe(200);
    expect(await readFile(join(root, 'c3', 'observations', 'editor.jsonl'), 'utf8')).toBe(line);
    expect((await put('c3', { 'observations/sub/x.jsonl': line })).status).toBe(400);
    expect((await put('c3', { 'observations/x.txt': line })).status).toBe(400);
    expect((await put('c3', { 'observations/../outdoor.jsonl': line })).status).toBe(400);
  });
});

describe('reports and changesets API', () => {
  let reportsDir: string;
  let changesetsDir: string;
  let rserver: Server;
  let rbase: string;
  const report = (id: string) => JSON.stringify({ id, campus: 'c', status: 'new' }, null, 2) + '\n';

  beforeEach(async () => {
    reportsDir = join(root, 'reports');
    changesetsDir = join(root, 'changesets');
    await mkdir(join(reportsDir, 'sample'), { recursive: true });
    await writeFile(join(reportsDir, 'sample', 'rp-1.json'), report('rp-1'));
    await writeFile(join(reportsDir, 'rp-2.json'), report('rp-2'));
    await writeFile(join(reportsDir, 'notes.txt'), 'not a report');
    const api = createReportsApi(reportsDir, changesetsDir);
    rserver = createServer((req, res) => void api(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((r) => rserver.listen(0, '127.0.0.1', r));
    rbase = `http://127.0.0.1:${(rserver.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise((r) => rserver.close(r));
  });

  const send = (method: string, path: string, body: unknown) =>
    fetch(`${rbase}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('whitelists report paths and changeset file names', () => {
    for (const ok of ['rp-1.json', 'sample/rp-20261110-0001.json', 'a/b/c/d.json']) expect(isReportPath(ok), ok).toBe(true);
    for (const bad of ['../x.json', 'a/../x.json', '/etc/x.json', 'x.txt', '.hidden.json', 'a/b/c/d/e.json', 'a b.json', 'a\b.json', 'a//b.json']) expect(isReportPath(bad), bad).toBe(false);
    for (const ok of ['20261111-ev1-fix.json', '20261113-rp-20261111-0004-and-4-more.json']) expect(isChangesetFileName(ok), ok).toBe(true);
    for (const bad of ['../20261111-x.json', '2026111-x.json', '20261111-X.json', '20261111-.json', 'cs-20261111-x.json', 'sub/20261111-x.json']) expect(isChangesetFileName(bad), bad).toBe(false);
  });

  it('lists report files recursively (only *.json) in path order', async () => {
    const body = (await (await fetch(`${rbase}/api/reports`)).json()) as { reports: { path: string; text: string }[] };
    expect(body.reports.map((f) => f.path)).toEqual(['rp-2.json', 'sample/rp-1.json']);
    expect(JSON.parse(body.reports[1]!.text).id).toBe('rp-1');
  });

  it('lists nothing when the reports folder does not exist', async () => {
    await rm(reportsDir, { recursive: true });
    expect(await (await fetch(`${rbase}/api/reports`)).json()).toEqual({ reports: [] });
  });

  it('rewrites existing report files, and refuses new files, bad paths and non-reports without writing anything', async () => {
    const changed = report('rp-1').replace('"new"', '"applied"');
    let res = await send('PUT', '/api/reports', { files: { 'sample/rp-1.json': changed } });
    expect(res.status).toBe(200);
    expect(await readFile(join(reportsDir, 'sample', 'rp-1.json'), 'utf8')).toBe(changed);

    for (const files of [
      { 'rp-2.json': changed, 'rp-new.json': changed }, // one file does not exist
      { 'rp-2.json': changed, '../evil.json': changed },
      { 'rp-2.json': 'not json' },
      { 'rp-2.json': '[]' },
      { 'rp-2.json': '{"no":"id"}' },
    ]) {
      res = await send('PUT', '/api/reports', { files });
      expect(res.status, JSON.stringify(Object.keys(files))).toBe(400);
    }
    expect(await readFile(join(reportsDir, 'rp-2.json'), 'utf8')).toBe(report('rp-2'));
    expect((await readdir(reportsDir)).sort()).toEqual(['notes.txt', 'rp-2.json', 'sample']);
    expect((await send('PUT', '/api/reports', { files: 'nope' })).status).toBe(400);
  });

  it('writes a changeset file once; the same text again is fine, different text under the same name is a conflict', async () => {
    const text = JSON.stringify({ id: 'cs-20261113-x', changes: [] }) + '\n';
    let res = await send('PUT', '/api/changesets/20261113-x.json', { text });
    expect(await res.json()).toEqual({ written: true, path: '20261113-x.json' });
    expect(await readFile(join(changesetsDir, '20261113-x.json'), 'utf8')).toBe(text);
    res = await send('PUT', '/api/changesets/20261113-x.json', { text });
    expect(await res.json()).toEqual({ written: false, path: '20261113-x.json' });
    res = await send('PUT', '/api/changesets/20261113-x.json', { text: JSON.stringify({ changes: [1] }) });
    expect(res.status).toBe(409);
    expect(await readFile(join(changesetsDir, '20261113-x.json'), 'utf8')).toBe(text);
  });

  it('refuses a bad changeset name or body', async () => {
    const text = '{"changes":[]}';
    for (const name of ['..%2Fevil.json', '20261113-X.json', 'notes.txt', '%2Fetc%2Fpasswd']) {
      expect((await send('PUT', `/api/changesets/${name}`, { text })).status, name).toBe(400);
    }
    expect((await send('PUT', '/api/changesets/20261113-x.json', { text: 'not json' })).status).toBe(400);
    expect((await send('PUT', '/api/changesets/20261113-x.json', { text: '{"id":"x"}' })).status).toBe(400);
    expect((await send('PUT', '/api/changesets/20261113-x.json', {})).status).toBe(400);
    expect((await send('GET', '/api/changesets/20261113-x.json', undefined)).status).toBe(405);
    await expect(readdir(changesetsDir)).rejects.toThrow(); // nothing was created
  });
});

describe('surveys API (현장 기록)', () => {
  let surveysDir: string;
  let sserver: Server;
  let sbase: string;
  const ID = 'sv-20261114-eng1-1000';
  const text = (id = ID) => `${JSON.stringify({ format: 'campo-survey', version: 1, id, campus: 'c', attachments: {}, vertical: [] }, null, 2)}\n`;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);

  beforeEach(async () => {
    surveysDir = join(root, 'surveys');
    const api = createSurveysApi(surveysDir);
    sserver = createServer((req, res) => void api(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((r) => sserver.listen(0, '127.0.0.1', r));
    sbase = `http://127.0.0.1:${(sserver.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise((r) => sserver.close(r));
  });

  const put = (id: string, body: unknown) =>
    fetch(`${sbase}/api/surveys/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('only accepts survey ids and plain photo names', () => {
    for (const ok of ['sv-20261114-a', 'sv-20261114-eng1-1000']) expect(isSurveyId(ok), ok).toBe(true);
    for (const bad of ['..', 'sv-2026-a', 'sv-20261114-', 'sv-20261114-A', 'cs-20261114-a', 'sv-20261114-a/..']) expect(isSurveyId(bad), bad).toBe(false);
    for (const ok of ['n_A_1_door_k7x2qa-1.jpg', 'a.png', 'x-2.heic']) expect(isSurveyPhotoName(ok), ok).toBe(true);
    for (const bad of ['../a.jpg', 'a/b.jpg', '.hidden.jpg', 'a.jpg.exe', 'a.svg', 'a..jpg', 'survey.json']) expect(isSurveyPhotoName(bad), bad).toBe(false);
  });

  it('lists nothing before the folder exists, then keeps a survey with its photos and serves them back', async () => {
    expect(await (await fetch(`${sbase}/api/surveys`)).json()).toEqual({ surveys: [] });
    const res = await put(ID, { text: text(), photos: { 'n_1-1.jpg': jpeg.toString('base64') } });
    expect(await res.json()).toEqual({ written: ['survey.json', 'photos/n_1-1.jpg'] });
    expect(await readFile(join(surveysDir, ID, 'survey.json'), 'utf8')).toBe(text());
    expect(await (await fetch(`${sbase}/api/surveys`)).json()).toEqual({ surveys: [{ id: ID, text: text() }] });

    const photo = await fetch(`${sbase}/api/surveys/${ID}/photos/n_1-1.jpg`);
    expect(photo.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await photo.arrayBuffer())).toEqual(jpeg);
    expect((await fetch(`${sbase}/api/surveys/${ID}/photos/none.jpg`)).status).toBe(404);
  });

  it('the same survey again is a retry (photos are added); a different one under the same id is refused', async () => {
    await put(ID, { text: text(), photos: {} });
    const retry = await put(ID, { text: text(), photos: { 'n_2-2.jpg': jpeg.toString('base64') } });
    expect(await retry.json()).toEqual({ written: ['photos/n_2-2.jpg'] });
    const other = await put(ID, { text: text().replace('"c"', '"d"'), photos: {} });
    expect(other.status).toBe(409);
    expect(await readFile(join(surveysDir, ID, 'survey.json'), 'utf8')).toBe(text());
  });

  it('writes nothing for a bad id, a text that is another survey, a bad photo name or a path that leaves the folder', async () => {
    expect((await put('sv-bad', { text: text('sv-bad'), photos: {} })).status).toBe(400);
    expect((await put(ID, { text: text('sv-20261114-other'), photos: {} })).status).toBe(400);
    expect((await put(ID, { text: '{ not json', photos: {} })).status).toBe(400);
    expect((await put(ID, { text: text(), photos: { '../../campus.json': 'AAAA' } })).status).toBe(400);
    expect((await put(ID, { text: text(), photos: { 'a.jpg': 1 } })).status).toBe(400);
    expect((await put(ID, { photos: {} })).status).toBe(400);
    expect((await fetch(`${sbase}/api/surveys/${ID}/photos/..%2Fsurvey.json`)).status).toBe(400);
    expect((await fetch(`${sbase}/api/surveys/${ID}`, { method: 'DELETE' })).status).toBe(405);
    expect(await readdir(root)).not.toContain('surveys');
  });
});
