import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addNode,
  changesetFileName,
  createHistory,
  createIdGen,
  deleteBuilding,
  featureOf,
  formatChangeset,
  fromCampus,
  historyToChangeset,
  moveNode,
  setProps,
  type Action,
  type Changeset,
  type EditState,
} from '@campo/core';
import { loadCampus } from '@campo/core/node';
import { runApply } from '../src/apply-cli.ts';
import { BAK_SUFFIX, TMP_SUFFIX, commitFiles, nodeFs, type ApplyFs } from '../src/atomic-write.ts';

const FIXTURE = fileURLToPath(new URL('../../core/test/fixtures/campus-basic', import.meta.url));
const CAMPUS = 'fixture-basic';

let root: string;
let campuses: string;
let campusDir: string;
let changesets: string;
let lines: string[];
const out = { log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };
const text = () => lines.join('\n');

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'campo-apply-'));
  campuses = join(root, 'campuses');
  campusDir = join(campuses, CAMPUS);
  changesets = join(root, 'changesets');
  await mkdir(changesets, { recursive: true });
  await cp(FIXTURE, campusDir, { recursive: true });
  lines = [];
});
afterEach(() => rm(root, { recursive: true, force: true }));

/** Every file under `dir` (relative path -> bytes as text), so a comparison catches changed, added and removed files. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name)).sort();
  return Object.fromEntries(await Promise.all(files.map(async (f) => [relative(dir, f).split(sep).join('/'), await readFile(f, 'utf8')])));
}

async function state(): Promise<EditState> {
  return fromCampus(await loadCampus(campusDir)).state;
}

/** Edit the campus state in memory and write the changeset file. Returns its path and the expected end state. */
async function makeChangeset(slug: string, actions: Action[], base?: EditState): Promise<{ path: string; cs: Changeset; expected: EditState }> {
  const h = createHistory(base ?? (await state()));
  for (const a of actions) h.perform(a);
  const cs = historyToChangeset(h.base(), h.current(), { id: `cs-20261113-${slug}`, campus: CAMPUS, source: 'editor', summary: slug });
  const path = join(changesets, changesetFileName(cs.id));
  await writeFile(path, formatChangeset(cs));
  return { path, cs, expected: h.current() };
}

async function writeRaw(name: string, cs: unknown): Promise<string> {
  const path = join(changesets, name);
  await writeFile(path, typeof cs === 'string' ? cs : `${JSON.stringify(cs, null, 2)}\n`);
  return path;
}

const opts = (extra: object = {}) => ({ campusesDir: campuses, now: new Date('2026-11-13T09:00:00+09:00'), ...extra });
const MOVE_HALL = () => moveNode('n_A_1_hall', [127.00061, 37.00051]);

describe('npm run apply', () => {
  it('--dry-run prints the per-building summary and the files, and writes nothing', async () => {
    const { path } = await makeChangeset('hall', [MOVE_HALL(), setProps(['n_out_0004'], { name: '갈림길' })]);
    const before = await snapshot(root);

    expect(await runApply([path], opts({ dryRun: true }), out, root)).toBe(0);
    expect(text()).toContain('■ changesets/20261113-hall.json — cs-20261113-hall (fixture-basic) "hall"');
    expect(lines).toContain('  A동(A): 추가 0개, 삭제 0개, 변경 5개');
    expect(lines).toContain('  바깥: 추가 0개, 삭제 0개, 변경 1개');
    expect(lines).toContain('  합계: 추가 0개, 삭제 0개, 변경 6개');
    expect(lines).toContain('바뀌는 파일 2개');
    expect(lines).toContain('  수정 campuses/fixture-basic/buildings/A/L1.geojson');
    expect(lines).toContain('  수정 campuses/fixture-basic/outdoor.geojson');
    expect(lines).toContain('--dry-run: 파일을 쓰지 않았습니다.');
    expect(await snapshot(root)).toEqual(before);
  });

  it('applies, touching only the changed files, and refuses the same changeset a second time', async () => {
    const { path, expected } = await makeChangeset('hall', [MOVE_HALL()]);
    const before = await snapshot(campusDir);

    expect(await runApply([path], opts(), out, root)).toBe(0);
    expect(text()).toContain('적용했습니다. changeset 1개, 파일 1개.');
    const after = await snapshot(campusDir);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const file of Object.keys(before)) {
      if (file === 'buildings/A/L1.geojson') expect(after[file]).not.toBe(before[file]);
      else expect(after[file], file).toBe(before[file]);
    }
    expect(await state()).toEqual(expected);

    lines = [];
    expect(await runApply([path], opts(), out, root)).toBe(1);
    expect(text()).toContain('이미 적용된 changeset입니다');
    expect(text()).toContain('아무 파일도 쓰지 않았습니다');
    expect(await snapshot(campusDir)).toEqual(after);
  });

  it('collects every conflict (rev_mismatch incl. a missing target, id_exists, still_referenced) and writes nothing', async () => {
    const s = await state();
    const f = (id: string) => featureOf(s, id)!;
    const withRev = (id: string, rev: number) => ({ ...f(id), properties: { ...f(id).properties, rev } });
    const path = await writeRaw('20261113-conflicts.json', {
      id: 'cs-20261113-conflicts', campus: CAMPUS, source: 'editor', report_ids: [], summary: '충돌',
      changes: [
        { op: 'modify', base_rev: 4, feature: withRev('n_out_0004', 5) },
        { op: 'delete', base_rev: 1, id: 'n_out_9999' },
        { op: 'create', feature: f('n_A_1_main') },
        { op: 'delete', base_rev: 1, id: 'n_A_1_stair' },
      ],
    });
    const before = await snapshot(root);

    expect(await runApply([path], opts(), out, root)).toBe(1);
    expect(text()).toContain('적용할 수 없습니다 (충돌 4개, 문제 0개)');
    expect(text()).toContain('충돌 [rev_mismatch] #n_out_0004: "n_out_0004": 기준 rev 4, 현재 rev 1.');
    expect(text()).toContain('충돌 [rev_mismatch] #n_out_9999: "n_out_9999": 기준 rev 1, 현재 없음.');
    expect(text()).toContain('충돌 [id_exists] #n_A_1_main');
    expect(text()).toContain('충돌 [still_referenced] #n_A_1_stair');
    expect(text()).toContain('충돌 4개를 포함해 changeset 1개에 문제가 있어 아무 파일도 쓰지 않았습니다.');
    expect(await snapshot(root)).toEqual(before);
  });

  it('applies several files in file-name order, each on the state the earlier ones leave', async () => {
    const first = await makeChangeset('a-name', [setProps(['n_out_0004'], { name: '하나' })]);
    const second = await makeChangeset('b-name', [setProps(['n_out_0004'], { name: '둘' })], first.expected);
    expect(await runApply([second.path, first.path], opts(), out, root)).toBe(0);
    expect(text().indexOf('20261113-a-name.json')).toBeLessThan(text().indexOf('20261113-b-name.json'));
    expect((await state()).nodes['n_out_0004']!.props).toMatchObject({ name: '둘', rev: 3 });
  });

  it('two files made from the same base: the second conflicts and neither is written', async () => {
    const base = await state();
    const one = await makeChangeset('one', [setProps(['n_out_0004'], { name: '하나' })], base);
    const two = await makeChangeset('two', [setProps(['n_out_0004'], { name: '둘' })], base);
    const before = await snapshot(campusDir);
    expect(await runApply([one.path, two.path], opts(), out, root)).toBe(1);
    expect(text()).toContain('충돌 [rev_mismatch] #n_out_0004: "n_out_0004": 기준 rev 1, 현재 rev 2.');
    expect(await snapshot(campusDir)).toEqual(before);
  });

  it('refuses a result with validation errors (a restroom joined to nothing, E10) and writes nothing', async () => {
    const { path } = await makeChangeset('wc', [
      addNode({ id: 'n_A_1_wc_x', coord: [127.00065, 37.00047], props: { kind: 'node', node_type: 'restroom', building_id: 'bldg_A', level: 1, restroom_gender: 'unisex', wheelchair: 'unknown', source: 'estimate' } }),
    ]);
    const before = await snapshot(root);
    expect(await runApply([path], opts(), out, root)).toBe(1);
    expect(text()).toContain('적용한 결과에 검사 오류 1개');
    expect(text()).toContain('[restroom-not-connected]');
    expect(text()).toContain('검사 오류가 있어 아무 파일도 쓰지 않았습니다.');
    expect(await snapshot(root)).toEqual(before);
  });

  it('a write that fails at any step leaves every file byte for byte as it was (also deleted files)', async () => {
    const { path } = await makeChangeset('wide', [MOVE_HALL(), deleteBuilding('C', { ids: createIdGen(1) }), setProps(['n_out_0004'], { name: 'x' })]);
    const before = await snapshot(campusDir);

    // dry run first: how many files and renames there are
    expect(await runApply([path], opts({ dryRun: true }), out, root)).toBe(0);
    expect(text()).toContain('  삭제 campuses/fixture-basic/buildings/C/L5.geojson');
    expect(text()).toContain('  삭제 campuses/fixture-basic/buildings/C/building.geojson');

    let calls = 0;
    for (let failAt = 1; ; failAt++) {
      lines = [];
      calls = 0;
      const failing: ApplyFs = {
        ...nodeFs,
        writeFile: async (p, t) => {
          if (++calls === failAt) throw new Error(`simulated write failure ${failAt}`);
          return nodeFs.writeFile(p, t);
        },
        rename: async (a, b) => {
          if (++calls === failAt) throw new Error(`simulated rename failure ${failAt}`);
          return nodeFs.rename(a, b);
        },
      };
      const code = await runApply([path], opts({ fs: failing }), out, root);
      if (code === 0) break; // failAt is past the last write / rename: it went through
      expect(text()).toContain('파일을 쓰다가 실패해서 원래 파일로 되돌렸습니다');
      expect(await snapshot(campusDir), `failure at step ${failAt}`).toEqual(before);
    }
    expect(calls).toBeGreaterThan(6);
    const after = await snapshot(campusDir);
    expect(Object.keys(after).some((f) => f.endsWith(TMP_SUFFIX) || f.endsWith(BAK_SUFFIX))).toBe(false);
    expect(after['buildings/C/L5.geojson']).toBeUndefined();
  });

  it('exits 1 for a missing file, broken JSON, a schema error or an unknown campus', async () => {
    expect(await runApply([join(changesets, 'nope.json')], opts(), out, root)).toBe(1);
    expect(text()).toContain('파일을 찾을 수 없습니다');
    lines = [];
    expect(await runApply([await writeRaw('20261113-broken.json', '{')], opts(), out, root)).toBe(1);
    expect(text()).toContain('JSON으로 읽을 수 없습니다');
    lines = [];
    expect(await runApply([await writeRaw('20261113-bad.json', { id: 'cs-20261113-bad', campus: CAMPUS, source: 'editor', report_ids: [], changes: [], summary: '' })], opts(), out, root)).toBe(1);
    expect(text()).toContain('changeset 형식에 맞지 않습니다');
    lines = [];
    const { cs } = await makeChangeset('elsewhere', [setProps(['n_out_0004'], { name: 'x' })]);
    expect(await runApply([await writeRaw('20261113-elsewhere.json', { ...cs, campus: 'nowhere' })], opts(), out, root)).toBe(1);
    expect(text()).toContain('캠퍼스 폴더를 찾을 수 없습니다');
    lines = [];
    expect(await runApply([], opts(), out, root)).toBe(1);
  });
});

describe('commitFiles', () => {
  it('removes a folder it made when a later step fails, and restores the originals', async () => {
    const dir = join(root, 'w');
    await mkdir(dir);
    await writeFile(join(dir, 'a.txt'), 'A');
    const ops = [
      { path: join(dir, 'a.txt'), text: 'A2' },
      { path: join(dir, 'new', 'deep', 'b.txt'), text: 'B' },
    ];
    let renames = 0;
    const failing: ApplyFs = { ...nodeFs, rename: async (a, b) => (++renames === 3 ? Promise.reject(new Error('boom')) : nodeFs.rename(a, b)) };
    await expect(commitFiles(ops, failing)).rejects.toThrow('boom');
    expect(await snapshot(dir)).toEqual({ 'a.txt': 'A' });
    expect(await readdir(dir)).toEqual(['a.txt']);

    await commitFiles(ops);
    expect(await snapshot(dir)).toEqual({ 'a.txt': 'A2', 'new/deep/b.txt': 'B' });
  });

  it('refuses to start when a temp or backup file from an earlier run is still there', async () => {
    const dir = join(root, 'w');
    await mkdir(dir);
    await writeFile(join(dir, 'a.txt'), 'A');
    await writeFile(join(dir, `a.txt${BAK_SUFFIX}`), 'old');
    await expect(commitFiles([{ path: join(dir, 'a.txt'), text: 'A2' }])).rejects.toThrow('이전 실행에서 남은 파일');
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('A');
  });
});
