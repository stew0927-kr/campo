import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCampus, validateCampus } from '@campo/core';
import { loadCampus } from '@campo/core/node';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { docFromLoaded, defaultMeta, type CampusDoc } from '../src/model/document.ts';
import { docToFiles, formatFeatureCollection } from '../src/model/files.ts';
import { addOutdoorPath } from '../src/model/outdoor-path.ts';

const FIXTURE = fileURLToPath(new URL('../../core/test/fixtures/campus-basic', import.meta.url));

describe('formatFeatureCollection', () => {
  it('sorts by id and writes one feature per line', () => {
    const text = formatFeatureCollection([{ id: 'b', n: 2 }, { id: 'a', n: 1 }, { id: 'B', n: 3 }]);
    expect(text).toBe('{"type":"FeatureCollection","features":[\n{"id":"B","n":3},\n{"id":"a","n":1},\n{"id":"b","n":2}\n]}\n');
    expect(JSON.parse(text).features).toHaveLength(3);
  });
});

describe('docToFiles (SPEC §4.3 배치)', () => {
  it('writes the fixture back byte for byte in the same files', async () => {
    const doc = docFromLoaded('fixture', await loadCampus(FIXTURE));
    expect(doc.passthrough).toEqual([]);
    const files = docToFiles(doc);
    const expected = [
      'buildings/A/L1.geojson', 'buildings/A/L2.geojson', 'buildings/A/L3.geojson', 'buildings/A/L4.geojson',
      'buildings/A/building.geojson', 'buildings/B/L1.geojson', 'buildings/B/L2.geojson',
      'buildings/B/building.geojson', 'campus.json', 'connections.geojson', 'outdoor.geojson',
    ];
    expect(Object.keys(files).sort()).toEqual(expected);
    for (const path of expected) {
      expect(files[path], path).toBe(await readFile(join(FIXTURE, path), 'utf8'));
    }
  });

  it('puts drawn outdoor paths in outdoor.geojson and the result passes validation', () => {
    const empty: CampusDoc = { campusId: 'x', meta: defaultMeta('x'), features: new Map(), passthrough: [] };
    const { doc } = addOutdoorPath(empty, [{ position: [127, 37] }, { position: [127.001, 37] }], 'flat');
    const files = docToFiles(doc);
    expect(Object.keys(files).sort()).toEqual(['campus.json', 'outdoor.geojson']);
    const result = validateCampus(parseCampus(Object.entries(files).map(([path, text]) => ({ path, text }))));
    expect(result).toEqual({ errors: [], warnings: [] });
  });

  it('keeps features that fail the schema in their original file', () => {
    const broken = { type: 'Feature', id: 'n_bad', properties: { kind: 'node' } };
    const doc = docFromLoaded('x', parseCampus([
      { path: 'campus.json', text: JSON.stringify(defaultMeta('x')) },
      { path: 'buildings/Z/L1.geojson', text: JSON.stringify({ type: 'FeatureCollection', features: [broken] }) },
    ]));
    expect(doc.passthrough).toHaveLength(1);
    expect(JSON.parse(docToFiles(doc)['buildings/Z/L1.geojson']!).features).toEqual([broken]);
  });
});
