import { describe, expect, it } from 'vitest';
import { checkInvariants, newViolations, type EditState } from '../../src/index.ts';
import { fixtureState } from './helpers.ts';

/** A mutable copy of the fixture, broken by `mutate`. Invariants are checked on hand-broken states only here. */
async function broken(mutate: (s: EditState) => void): Promise<EditState> {
  const s = JSON.parse(JSON.stringify(await fixtureState())) as EditState;
  mutate(s);
  return s;
}

describe('checkInvariants', () => {
  it('the fixture has no violations', async () => {
    expect(checkInvariants(await fixtureState())).toEqual([]);
  });

  it('I1: an edge pointing at a missing node', async () => {
    const s = await broken((s) => {
      delete s.nodes['n_A_3_north'];
    });
    const v = checkInvariants(s);
    expect(v.map((x) => x.code)).toEqual(['I1', 'I1']);
    expect(v[0]!.ids).toEqual(['e_A_3_hall__A_3_north', 'n_A_3_north']);
  });

  it('I2: a coordinate the save would write is not a number pair', async () => {
    const s = await broken((s) => {
      s.edges['e_A_3_hall__A_3_north']!.vertices = [[Number.NaN, 37]];
      (s.nodes['n_out_0001']!.coord as unknown) = [127];
    });
    expect(checkInvariants(s).filter((x) => x.code === 'I2').map((x) => x.ids[0])).toEqual(['n_out_0001', 'e_A_3_hall__A_3_north']);
  });

  it('I3: an id used twice across collections, or a key that is not its id', async () => {
    const s = await broken((s) => {
      s.rooms['n_A_1_hall'] = { id: 'n_A_1_hall', polygon: [], props: { kind: 'room', building_id: 'bldg_A', level: 1, source: 'x', rev: 1 } };
      s.nodes['n_other'] = { ...s.nodes['n_out_0001']! };
      s.buildings['Z'] = s.buildings['A']!;
    });
    const v = checkInvariants(s).filter((x) => x.code === 'I3');
    expect(v.map((x) => x.ids)).toEqual([['n_other', 'n_out_0001'], ['n_out_0001'], ['n_A_1_hall'], ['bldg_A'], ['bldg_A']]);
  });

  it('I4: a flat edge across scopes that is not a portal or bridge', async () => {
    const s = await broken((s) => {
      s.edges['e_portal_A_1_main']!.props.edge_type = 'outdoor';
      s.edges['e_A_1_hall__A_1_esc']!.props.to = 'n_A_2_esc';
      s.edges['e_A_1_stair__A_2_stair']!.props.highway = 'steps'; // steps may cross
    });
    expect(checkInvariants(s).map((x) => [x.code, x.ids[0]])).toEqual([['I4', 'e_A_1_hall__A_1_esc'], ['I4', 'e_portal_A_1_main']]);
  });

  it('I5: stops of one elevator_id apart (more than 1.0m), but not within 1.0m', async () => {
    const far = await broken((s) => {
      s.nodes['n_A_elevA_L3']!.coord = [127.00085, 37.0005];
    });
    const v = checkInvariants(far);
    expect(v.map((x) => x.code)).toEqual(['I5', 'I5', 'I5']);
    expect(v.every((x) => x.ids.includes('n_A_elevA_L3'))).toBe(true);
    const near = await broken((s) => {
      s.nodes['n_A_elevA_L3']!.coord = [127.000805, 37.0005];
    });
    expect(checkInvariants(near)).toEqual([]);
  });

  it('can check a subset of codes, and newViolations ignores what was already broken', async () => {
    const s = await broken((s) => {
      delete s.nodes['n_A_3_north'];
    });
    expect(checkInvariants(s, ['I4', 'I5'])).toEqual([]);
    const worse = await broken((s) => {
      delete s.nodes['n_A_3_north'];
      s.edges['e_portal_A_1_main']!.props.edge_type = 'outdoor';
    });
    expect(newViolations(s, worse, ['I1', 'I4']).map((x) => x.code)).toEqual(['I4']);
  });
});
