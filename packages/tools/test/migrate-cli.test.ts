import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrate } from '../src/migrate-cli.ts';
import { runValidate } from '../src/cli.ts';

let root: string;
let lines: string[];
const out = { log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'campo-migrate-'));
  lines = [];
});
afterEach(() => rm(root, { recursive: true, force: true }));

const META = `${JSON.stringify({ id: 't', name: 'T', center: [127, 37], bbox: [126.9, 36.9, 127.1, 37.1] }, null, 2)}\n`;
const EMPTY = '{"type":"FeatureCollection","features":[]}\n';

const node = (id: string, x: number, extra: object = {}) =>
  JSON.stringify({
    type: 'Feature', id, geometry: { type: 'Point', coordinates: [127 + x, 37] },
    properties: { kind: 'node', node_type: 'outdoor', building_id: null, level: null, source: 'estimate', ...extra },
  });
const edge = (id: string, from: string, to: string, a: number, b: number, extra: object) =>
  JSON.stringify({
    type: 'Feature', id, geometry: { type: 'LineString', coordinates: [[127 + a, 37], [127 + b, 37]] },
    properties: { kind: 'edge', from, to, bidirectional: true, source: 'estimate', ...extra },
  });

/** A v0.1 campus folder with a ramp to fix and (optionally) two lift stops whose shaft_ids disagree. */
async function writeV01(dir: string, { mixed = false } = {}): Promise<void> {
  await mkdir(dir, { recursive: true });
  const lift = (id: string, x: number, shaft: string) => node(id, x, { node_type: 'elevator_stop', building_id: 'bldg_T', level: 1, shaft_id: shaft });
  const features = [
    node('n_a', 0), node('n_b', 0.0001),
    edge('e_ramp', 'n_a', 'n_b', 0, 0.0001, { highway: 'ramp', edge_type: 'outdoor', step_free: false }),
    lift('n_l1', 0.0002, 'T_x'), lift('n_l2', 0.0002, mixed ? 'T_y' : 'T_x'),
    edge('e_lift', 'n_l1', 'n_l2', 0.0002, 0.0002, { highway: 'elevator', edge_type: 'indoor', step_free: false, level_from: 1, level_to: 1 }),
  ];
  await writeFile(join(dir, 'campus.json'), META);
  await writeFile(join(dir, 'outdoor.geojson'), `{"type":"FeatureCollection","features":[\n${features.join(',\n')}\n]}\n`);
}

const snapshot = async (dir: string) =>
  Object.fromEntries(await Promise.all((await readdir(dir)).sort().map(async (f) => [f, await readFile(join(dir, f), 'utf8')])));

describe('campo-migrate', () => {
  it('--dry-run reports counts by kind and writes nothing', async () => {
    const dir = join(root, 'c');
    await writeV01(dir);
    const before = await snapshot(dir);

    expect(await runMigrate([dir], { dryRun: true }, out, root)).toBe(0);
    expect(lines.join('\n')).toContain('step_free: 계단·턱 있음(false) → 모름(null) (현장 확인 없음, 경사로 포함): 1');
    expect(lines.join('\n')).toContain('elevator_id: 기존 shaft_id 값을 옮김: 2');
    expect(lines.join('\n')).toContain('rev: 1 추가: 6');
    expect(lines).toContain('--dry-run: 파일을 쓰지 않았습니다.');
    expect(await snapshot(dir)).toEqual(before);
  });

  it('migrates, and a second run changes nothing', async () => {
    const dir = join(root, 'c');
    await writeV01(dir);
    expect(await runMigrate([dir], {}, out, root)).toBe(0);
    const once = await snapshot(dir);
    expect(JSON.parse(once['campus.json']!)).toMatchObject({ schema_version: '0.2' });
    expect(once['outdoor.geojson']).toContain('"elevator_id":"T_x"');
    expect(once['outdoor.geojson']).not.toContain('shaft_id');

    lines = [];
    expect(await runMigrate([dir], {}, out, root)).toBe(0);
    expect(lines.join('\n')).toContain('바꿀 것이 없습니다');
    expect(await snapshot(dir)).toEqual(once);
  });

  it('takes a folder of campuses too', async () => {
    await writeV01(join(root, 'one'));
    await writeV01(join(root, 'two'));
    expect(await runMigrate([root], {}, out, root)).toBe(0);
    expect(lines.filter((l) => l.startsWith('■'))).toHaveLength(2);
    expect(JSON.parse(await readFile(join(root, 'two', 'campus.json'), 'utf8'))).toMatchObject({ schema_version: '0.2' });
  });

  it('stops with exit 1, lists the stops, and writes nothing anywhere when shaft_ids are mixed', async () => {
    await writeV01(join(root, 'a-clean'));
    await writeV01(join(root, 'b-mixed'), { mixed: true });
    const before = [await snapshot(join(root, 'a-clean')), await snapshot(join(root, 'b-mixed'))];

    expect(await runMigrate([root], {}, out, root)).toBe(1);
    const text = lines.join('\n');
    expect(text).toContain('mixed-shaft');
    expect(text).toContain('n_l1  shaft_id=T_x');
    expect(text).toContain('n_l2  shaft_id=T_y');
    expect(text).toContain('아무 파일도 쓰지 않았습니다');
    expect([await snapshot(join(root, 'a-clean')), await snapshot(join(root, 'b-mixed'))]).toEqual(before);
  });

  it('migrates an empty campus twice with no error and the same result, and validate passes', async () => {
    const dir = join(root, 'empty');
    await mkdir(dir);
    await writeFile(join(dir, 'campus.json'), META);
    await writeFile(join(dir, 'outdoor.geojson'), EMPTY);
    await writeFile(join(dir, 'connections.geojson'), EMPTY);

    expect(await runMigrate([dir], {}, out, root)).toBe(0);
    const once = await snapshot(dir);
    expect(await runMigrate([dir], {}, out, root)).toBe(0);
    expect(await snapshot(dir)).toEqual(once);
    expect(once['outdoor.geojson']).toBe(EMPTY);

    lines = [];
    expect(await runValidate(root, out, root)).toBe(0);
    expect(lines).toContain('■ empty — 오류 0개, 경고 0개');
  });

  it('exits 1 for a folder that does not exist', async () => {
    expect(await runMigrate([join(root, 'nope')], {}, out, root)).toBe(1);
    expect(lines.join('\n')).toContain('폴더를 찾을 수 없습니다');
  });
});
