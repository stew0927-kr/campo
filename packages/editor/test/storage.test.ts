// The server build's store (src/storage.ts) against a fake Supabase client: paging, the state sent back to
// save_campus_map(), which files go up, and the Korean messages.
import { afterEach, describe, expect, it } from 'vitest';
import { loadFromServer, MAP_PATH, saveToServer, serverMessage, setStoreClientForTests, type StoreClient } from '../src/storage.ts';

type Row = { path: string; text: string; updated_at: string };

function fake(rows: Row[], opts: { session?: boolean; rpc?: (args: Record<string, unknown>) => { data?: unknown; error?: { code: string; message: string } } } = {}) {
  const calls: { ranges: [number, number][]; rpc: Record<string, unknown>[] } = { ranges: [], rpc: [] };
  const client = {
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        range: async (a: number, b: number) => {
          calls.ranges.push([a, b]);
          return { data: rows.slice(a, b + 1), error: null };
        },
      };
      return q;
    },
    rpc: async (_name: string, args: Record<string, unknown>) => {
      calls.rpc.push(args);
      return opts.rpc ? { data: null, error: null, ...opts.rpc(args) } : { data: null, error: null };
    },
    auth: { getSession: async () => ({ data: { session: opts.session === false ? null : { user: { id: 'u' } } } }) },
  } as unknown as StoreClient;
  setStoreClientForTests(client);
  return calls;
}

const row = (path: string, at = '2026-11-24T10:00:00.123456+00:00'): Row => ({ path, text: `{"p":"${path}"}`, updated_at: at });

afterEach(() => setStoreClientForTests(null));

describe('loadFromServer', () => {
  it('reads every page and gives path + text', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => row(`buildings/B${i}/building.geojson`));
    const calls = fake(rows);
    const files = await loadFromServer('hanyang-seoul');
    expect(files).toHaveLength(501);
    expect(files[0]).toEqual({ path: 'buildings/B0/building.geojson', text: '{"p":"buildings/B0/building.geojson"}' });
    expect(calls.ranges).toEqual([[0, 499], [500, 999]]);
  });
  it('an empty server says where to upload the folder', async () => {
    fake([]);
    await expect(loadFromServer('hanyang-seoul')).rejects.toThrow('폴더를 먼저 올려 주세요');
  });
});

describe('saveToServer', () => {
  it('sends the map files only, the state seen at load, prune on; remembers the new state', async () => {
    const state2 = { 'campus.json': '2026-11-24T11:00:00+00:00' };
    const calls = fake([row('campus.json'), row('outdoor.geojson')], {
      rpc: () => ({ data: { written: ['campus.json'], removed: ['outdoor.geojson'], state: state2 } }),
    });
    await loadFromServer('hanyang-seoul');
    const result = await saveToServer('hanyang-seoul', { 'campus.json': '{}', 'overrides.json': '{}', 'observations/editor.jsonl': '' });
    expect(result).toEqual({ written: ['campus.json'], removed: ['outdoor.geojson'], skipped: ['observations/editor.jsonl', 'overrides.json'] });
    expect(calls.rpc[0]).toEqual({
      p_campus_id: 'hanyang-seoul',
      p_files: [{ path: 'campus.json', text: '{}' }],
      p_expected: { 'campus.json': '2026-11-24T10:00:00.123456+00:00', 'outdoor.geojson': '2026-11-24T10:00:00.123456+00:00' },
      p_prune: true,
    });
    // The second save of the same page must not look like someone else's save: it sends the state the first one returned.
    await saveToServer('hanyang-seoul', { 'campus.json': '{}' });
    expect(calls.rpc[1]!.p_expected).toEqual(state2);
  });
  it('without a login: the admin-web message, nothing sent', async () => {
    const calls = fake([row('campus.json')], { session: false });
    await loadFromServer('hanyang-seoul');
    await expect(saveToServer('hanyang-seoul', { 'campus.json': '{}' })).rejects.toThrow('관리자 웹에서 로그인한 뒤 저장해 주세요.');
    expect(calls.rpc).toHaveLength(0);
  });
  it('someone saved first: says how to reload, and that the edits are lost', async () => {
    fake([row('campus.json')], { rpc: () => ({ error: { code: 'PT409', message: '다른 곳에서 먼저 저장했습니다. 새로고침(F5) 후 다시 저장해 주세요.' } }) });
    await loadFromServer('hanyang-seoul');
    await expect(saveToServer('hanyang-seoul', { 'campus.json': '{}' })).rejects.toThrow('편집 화면 다시 불러오기');
  });
});

describe('serverMessage and MAP_PATH', () => {
  it('never shows the raw RLS text', () => {
    expect(serverMessage({ code: '42501', message: 'permission denied for function save_campus_map' })).toContain('관리자 계정만');
    expect(serverMessage({ message: 'TypeError: Failed to fetch' })).toContain('인터넷 연결');
    expect(serverMessage({ code: '22023', message: '올바른 JSON이 아닙니다: outdoor.geojson' })).toBe('올바른 JSON이 아닙니다: outdoor.geojson');
  });
  it('the same path rule as the dev server', () => {
    expect(['campus.json', 'buildings/A1/L1.geojson', 'buildings/A1/L-1.geojson'].every((p) => MAP_PATH.test(p))).toBe(true);
    expect(['overrides.json', 'buildings/A1/L0.geojson'].some((p) => MAP_PATH.test(p))).toBe(false);
  });
});
