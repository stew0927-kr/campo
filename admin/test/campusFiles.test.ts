import { describe, expect, it } from 'vitest';
import {
  compareWithServer,
  findCampusRoot,
  formatBytes,
  MAP_PATH,
  normalizeText,
  scanFolder,
  stateOf,
  zipEntries,
  zipName,
  type PickedFile,
} from '../src/lib/campusFiles.ts';

const CAMPUS = '{"id":"hanyang-seoul","name":"한양대학교 서울캠퍼스"}';
const FC = '{"type":"FeatureCollection","features":[]}';
const pick = (relativePath: string, text: string): PickedFile => ({ relativePath, size: text.length, read: async () => text });

describe('MAP_PATH (same rule as the editor and 0006)', () => {
  it('takes campus files and floors L1, L12, L-1', () => {
    for (const p of ['campus.json', 'outdoor.geojson', 'connections.geojson', 'buildings/OSMw187181264/building.geojson', 'buildings/A1/L1.geojson', 'buildings/A1/L12.geojson', 'buildings/A1/L-1.geojson']) {
      expect(MAP_PATH.test(p), p).toBe(true);
    }
  });
  it('leaves out the rest', () => {
    for (const p of ['overrides.json', 'observations/editor.jsonl', 'buildings/A1/L0.geojson', 'buildings/A-1/L1.geojson', 'buildings/A1/L-0.geojson', 'derived/elevation.json', '.DS_Store', 'buildings/A1/sub/L1.geojson']) {
      expect(MAP_PATH.test(p), p).toBe(false);
    }
  });
});

describe('findCampusRoot', () => {
  it('finds the folder that holds campus.json, however deep the pick was', () => {
    expect(findCampusRoot(['hanyang-seoul/campus.json', 'hanyang-seoul/outdoor.geojson'])).toEqual({ root: 'hanyang-seoul' });
    expect(findCampusRoot(['campo/data/campuses/hanyang-seoul/campus.json'])).toEqual({ root: 'campo/data/campuses/hanyang-seoul' });
  });
  it('prefers the campus named hanyang-seoul when several have campus.json', () => {
    expect(findCampusRoot(['campuses/other/campus.json', 'campuses/hanyang-seoul/campus.json'])).toEqual({ root: 'campuses/hanyang-seoul' });
  });
  it('says what to pick when there is no campus.json or it is ambiguous', () => {
    expect(findCampusRoot(['x/outdoor.geojson'])).toHaveProperty('error');
    expect(findCampusRoot(['a/campus.json', 'b/campus.json'])).toHaveProperty('error');
  });
});

describe('scanFolder', () => {
  it('keeps map files, explains the others, counts files outside the campus folder', async () => {
    const scan = await scanFolder([
      pick('campuses/hanyang-seoul/campus.json', CAMPUS),
      pick('campuses/hanyang-seoul/outdoor.geojson', FC),
      pick('campuses/hanyang-seoul/buildings/A1/L1.geojson', FC),
      pick('campuses/hanyang-seoul/overrides.json', '{}'),
      pick('campuses/hanyang-seoul/buildings/A1/L2.geojson', '{"type": '),
      pick('campuses/README.md', '# x'),
    ]);
    if ('error' in scan) throw new Error(scan.error);
    expect(scan.root).toBe('campuses/hanyang-seoul');
    expect(scan.files.map((f) => f.path)).toEqual(['buildings/A1/L1.geojson', 'campus.json', 'outdoor.geojson']);
    expect(scan.skipped).toEqual([
      { path: 'buildings/A1/L2.geojson', reason: 'JSON 형식 오류(올리지 않음)' },
      { path: 'overrides.json', reason: '지도 파일이 아님(올리지 않음)' },
    ]);
    expect(scan.outside).toBe(1);
  });
  it('turns Windows line ends and a BOM into plain text', async () => {
    const scan = await scanFolder([pick('hanyang-seoul/campus.json', `\uFEFF${CAMPUS}\r\n`)]);
    if ('error' in scan) throw new Error(scan.error);
    expect(scan.files[0]!.text).toBe(`${CAMPUS}\n`);
    expect(normalizeText('a\r\nb')).toBe('a\nb');
  });
  it('refuses a folder of another campus', async () => {
    const scan = await scanFolder([pick('other/campus.json', '{"id":"other"}')]);
    expect(scan).toHaveProperty('error');
  });
  it('reads the real campus folder of this repository without leaving anything out', async () => {
    // The files as text, through Vite (no Node types needed): keys look like ../../data/campuses/hanyang-seoul/...
    const raw = import.meta.glob('../../data/campuses/hanyang-seoul/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const picked = Object.entries(raw).map(([key, text]) => pick(key.replace('../../data/campuses/', ''), text));
    expect(picked.length).toBeGreaterThan(3);
    const scan = await scanFolder(picked);
    if ('error' in scan) throw new Error(scan.error);
    expect(scan.files.length).toBe(picked.length);
    expect(scan.skipped).toEqual([]);
    expect(scan.files.some((f) => f.path === 'campus.json')).toBe(true);
  });
});

describe('compareWithServer', () => {
  it('sorts files into new, changed, same and server-only (geojson only)', () => {
    const folder = [{ path: 'campus.json', text: CAMPUS }, { path: 'outdoor.geojson', text: FC }, { path: 'buildings/A1/L1.geojson', text: FC }];
    const server = [{ path: 'campus.json', text: CAMPUS }, { path: 'outdoor.geojson', text: '{}' }, { path: 'buildings/B2/L1.geojson', text: FC }];
    expect(compareWithServer(folder, server)).toEqual({
      added: ['buildings/A1/L1.geojson'],
      changed: ['outdoor.geojson'],
      same: ['campus.json'],
      serverOnly: ['buildings/B2/L1.geojson'],
    });
  });
  it('an empty server makes everything new', () => {
    expect(compareWithServer([{ path: 'campus.json', text: CAMPUS }], []).added).toEqual(['campus.json']);
  });
});

describe('small helpers', () => {
  it('stateOf maps path to updated_at', () => {
    expect(stateOf([{ path: 'campus.json', text: '', updated_at: '2026-11-24T10:00:00.123456+00:00' }])).toEqual({ 'campus.json': '2026-11-24T10:00:00.123456+00:00' });
  });
  it('zip puts everything under the campus folder and names the file in Korea time', () => {
    expect(zipEntries([{ path: 'buildings/A1/L1.geojson', text: FC }])).toEqual({ 'hanyang-seoul/buildings/A1/L1.geojson': FC });
    expect(zipName(new Date('2026-11-24T10:30:00Z'))).toBe('hanyang-seoul-map-20261124-1930.zip');
  });
  it('formatBytes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(233_237)).toBe('228 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
