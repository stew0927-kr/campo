import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runValidate } from '../src/cli.ts';

const FIXTURE = fileURLToPath(new URL('../../core/test/fixtures/campus-basic', import.meta.url));

let root: string;
let lines: string[];
const out = { log: (l: string) => lines.push(l), error: (l: string) => lines.push(l) };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'campo-validate-'));
  lines = [];
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('campo-validate', () => {
  it('exits 0 when there are no campuses yet', async () => {
    expect(await runValidate(root, out, root)).toBe(0);
    expect(lines.join('\n')).toContain('검사할 캠퍼스가 없습니다');
  });

  it('exits 0 for a clean campus', async () => {
    await cp(FIXTURE, join(root, 'fixture'), { recursive: true });
    expect(await runValidate(root, out, root)).toBe(0);
    expect(lines).toContain('■ fixture — 오류 0개, 경고 0개');
  });

  it('exits 1 and names the file and feature when a campus has errors', async () => {
    await cp(FIXTURE, join(root, 'ok'), { recursive: true });
    await cp(FIXTURE, join(root, 'bad'), { recursive: true });
    const file = join(root, 'bad', 'connections.geojson');
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('"to":"n_out_0006"', '"to":"n_out_9999"'));

    expect(await runValidate(root, out, root)).toBe(1);
    expect(lines).toContain('■ bad — 오류 1개, 경고 0개');
    expect(lines.some((l) => l.includes('[dangling-ref] bad/connections.geojson #e_portal_B_1_main'))).toBe(true);
  });

  it('exits 1 when the campuses folder does not exist', async () => {
    expect(await runValidate(join(root, 'missing'), out, root)).toBe(1);
  });
});
