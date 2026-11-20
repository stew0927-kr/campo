import { describe, expect, it } from 'vitest';
import { buildNodeIndex, decide, headingOf, ID_MAX, parseArgs, photoIdOf, planSurvey, storagePaths, type ExistingRow } from '../src/plan.ts';

const all = () => true;
const survey = (attachments: unknown) => ({ format: 'campo-survey', version: 1, id: 'sv-20261120-x', attachments, vertical: [] });

describe('photoIdOf', () => {
  it('keeps a clean ASCII id as it is, lowercased', () => {
    expect(photoIdOf('n_ENG1_3_door_k7x2qa', 'photos/n_ENG1_3_door_k7x2qa-1.jpg')).toBe('n_eng1_3_door_k7x2qa-n_eng1_3_door_k7x2qa-1');
    expect(photoIdOf('n_a', 'photos/x-1.jpg')).toBe('n_a-x-1');
  });

  it('is stable: the same photo always gets the same id', () => {
    expect(photoIdOf('n_a', 'photos/x-1.jpg')).toBe(photoIdOf('n_a', 'photos/x-1.jpg'));
  });

  it('Korean, spaces and capitals become a safe id, and two such ids never collide', () => {
    const a = photoIdOf('강의실 앞', 'photos/a1.jpg');
    const b = photoIdOf('화장실 앞', 'photos/a1.jpg');
    expect(a).toMatch(/^[a-z0-9_-]+$/);
    expect(b).toMatch(/^[a-z0-9_-]+$/);
    expect(a).not.toBe(b);
  });

  it('never goes past 80 characters and stays unique when cut', () => {
    const long = 'n_' + 'x'.repeat(120);
    const a = photoIdOf(long, 'photos/p-1.jpg');
    const b = photoIdOf(long, 'photos/p-2.jpg');
    expect(a.length).toBeLessThanOrEqual(ID_MAX);
    expect(b.length).toBeLessThanOrEqual(ID_MAX);
    expect(a).not.toBe(b);
  });
});

describe('planSurvey', () => {
  const nodes = buildNodeIndex([
    { type: 'FeatureCollection', features: [
      { type: 'Feature', id: 'n_A_1_main', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { kind: 'node', building_id: 'bldg_A', level: 1 } },
      { type: 'Feature', id: 'e_x', geometry: { type: 'LineString', coordinates: [] }, properties: { kind: 'edge' } },
    ] },
  ]);

  it('reads heading, source, field of view and hint; missing heading becomes null', () => {
    const plan = planSurvey(survey({
      n_A_1_main: {
        photos: ['photos/a-1.jpg', 'photos/a-2.jpg'],
        photo_meta: { 'photos/a-1.jpg': { heading_deg: 87.5, heading_source: 'dial', hfov_deg: 65.2, direction_hint: ' 오른쪽 두 번째 문 ' } },
      },
    }), 'sv-1', nodes, all);
    expect(plan.photos).toHaveLength(2);
    const [a, b] = plan.photos;
    expect(a).toMatchObject({ node_id: 'n_A_1_main', building_id: 'bldg_A', level: 1, heading_deg: 87.5, heading_source: 'dial', hfov_deg: 65.2, direction_hint: '오른쪽 두 번째 문' });
    expect(b).toMatchObject({ heading_deg: null, heading_source: null, hfov_deg: null, direction_hint: null });
  });

  it('a node that is not in the map data gets null building and level (not an error)', () => {
    const plan = planSurvey(survey({ n_unknown: { photos: ['photos/u-1.jpg'] } }), 'sv-1', nodes, all);
    expect(plan.photos[0]).toMatchObject({ building_id: null, level: null });
    expect(plan.warnings).toEqual([]);
  });

  it('skips photos listed but missing on disk, with a warning', () => {
    const plan = planSurvey(survey({ n_A_1_main: { photos: ['photos/a-1.jpg', 'photos/gone.jpg'] } }), 'sv-1', nodes, (p) => p !== 'photos/gone.jpg');
    expect(plan.photos.map((p) => p.photoPath)).toEqual(['photos/a-1.jpg']);
    expect(plan.warnings.join()).toContain('photos/gone.jpg');
  });

  it('rejects paths outside photos/ (no ../ tricks)', () => {
    const plan = planSurvey(survey({ n_A_1_main: { photos: ['../secret.jpg', 'photos/deleted/a.jpg'] } }), 'sv-1', nodes, all);
    expect(plan.photos).toEqual([]);
    expect(plan.warnings).toHaveLength(2);
  });

  it('an empty attachments object plans nothing', () => {
    expect(planSurvey(survey({}), 'sv-1', nodes, all)).toEqual({ photos: [], warnings: [] });
  });

  it('out-of-range values are dropped', () => {
    expect(headingOf(360)).toBeNull();
    expect(headingOf(-1)).toBeNull();
    expect(headingOf('87')).toBeNull();
    expect(headingOf(0)).toBe(0);
    const plan = planSurvey(survey({ n: { photos: ['photos/a.jpg'], photo_meta: { 'photos/a.jpg': { heading_deg: 400, heading_source: 'gps', hfov_deg: 200 } } } }), 'sv', nodes, all);
    expect(plan.photos[0]).toMatchObject({ heading_deg: null, heading_source: null, hfov_deg: null });
  });
});

describe('decide (running twice changes nothing)', () => {
  const row = (r: Partial<ExistingRow>): ExistingRow => ({ id: 'n_a-x-1', node_id: 'n_a', heading_deg: 90, sha256: 'aaa', ...r });
  const maps = (rows: ExistingRow[]) => [new Map(rows.map((r) => [r.id, r])), new Map(rows.map((r) => [r.sha256!, r]))] as const;
  const photo = { id: 'n_a-x-1', node_id: 'n_a', heading_deg: 90 };

  it('new photo -> upload', () => {
    const [byId, bySha] = maps([]);
    expect(decide(photo, 'aaa', byId, bySha)).toEqual({ action: 'upload', reason: 'new' });
  });

  it('same id, same content -> skip', () => {
    const [byId, bySha] = maps([row({})]);
    expect(decide(photo, 'aaa', byId, bySha)).toEqual({ action: 'skip', reason: 'same' });
  });

  it('same id, new content (photo replaced) -> upload again', () => {
    const [byId, bySha] = maps([row({})]);
    expect(decide(photo, 'bbb', byId, bySha)).toEqual({ action: 'upload', reason: 'changed' });
  });

  it('same content under another file name at the same node and heading -> skip quietly', () => {
    const [byId, bySha] = maps([row({ id: 'n_a-x-copy' })]);
    expect(decide(photo, 'aaa', byId, bySha)).toEqual({ action: 'skip', reason: 'same' });
  });

  it('same content at a different node -> skip and flag for a person', () => {
    const [byId, bySha] = maps([row({ id: 'n_b-x-1', node_id: 'n_b' })]);
    expect(decide(photo, 'aaa', byId, bySha)).toEqual({ action: 'skip', reason: 'duplicate-elsewhere', otherId: 'n_b-x-1' });
  });
});

describe('cli and paths', () => {
  it('accepts --limit=3 and --limit 3', () => {
    expect(parseArgs(['--limit=3']).limit).toBe(3);
    expect(parseArgs(['--limit', '3', '--dry-run']).limit).toBe(3);
    expect(parseArgs(['--limit', '3', '--dry-run']).dryRun).toBe(true);
    expect(parseArgs(['--surveys-dir=sample']).surveysDir).toBe('sample');
  });

  it('reports bad options instead of ignoring them', () => {
    expect(parseArgs(['--limit=abc', '--oops']).unknown).toEqual(['--limit=abc', '--oops']);
  });

  it('storage file names equal the table id', () => {
    expect(storagePaths('n_a-x-1')).toEqual({ thumb: 'thumbs/n_a-x-1.webp', full: 'full/n_a-x-1.webp' });
  });
});
