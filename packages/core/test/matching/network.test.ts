// Matcher network, local frame and the campus-basic smoke run (docs/MAP_MATCHING.md 2).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { metres } from '../../src/edit/geo.ts';
import { buildGraph, type CampusGraph } from '../../src/graph.ts';
import { bearingDeg, createFrame, signedAngleDiffDeg, toLngLat, toLocal } from '../../src/matching/geo.ts';
import { createMatcherState, matchStep } from '../../src/matching/hmm.ts';
import {
  buildMatchNetwork,
  createCandidateSet,
  findCandidates,
  routeDistance,
  searchFrom,
  type MatchNetwork,
} from '../../src/matching/network.ts';
import { loadCampus } from '../../src/node/index.ts';
import * as core from '../../src/index.ts';
import { fixesOf, gridCampus, walk, FRAME, type TruthPoint } from './fixtures.ts';

describe('local frame', () => {
  it('round-trips and agrees with geodesic distance on campus scale', () => {
    const frame = createFrame(127.0453, 37.5572);
    const a: [number, number] = [127.0441, 37.5561];
    const b: [number, number] = [127.0479, 37.5590];
    const [ax, ay] = toLocal(frame, a[0], a[1]);
    const [bx, by] = toLocal(frame, b[0], b[1]);
    const back = toLngLat(frame, bx, by);
    expect(back[0]).toBeCloseTo(b[0], 10);
    expect(back[1]).toBeCloseTo(b[1], 10);
    const geodesic = metres(a, b);
    expect(Math.abs(Math.hypot(bx - ax, by - ay) - geodesic) / geodesic).toBeLessThan(1e-3);
  });

  it('measures bearings clockwise from north', () => {
    expect(bearingDeg(0, 1)).toBe(0);
    expect(bearingDeg(1, 0)).toBe(90);
    expect(bearingDeg(0, -1)).toBe(180);
    expect(bearingDeg(-1, 0)).toBe(270);
    expect(signedAngleDiffDeg(10, 350)).toBe(20);
    expect(signedAngleDiffDeg(350, 10)).toBe(-20);
  });
});

describe('network search', () => {
  const net = buildMatchNetwork(buildGraph(gridCampus(5, 5, 20)));
  const at = (x: number, y: number) => {
    const [lng, lat] = toLngLat(FRAME, x, y);
    return toLocal(net.frame, lng, lat);
  };

  it('finds the nearest edges first, at most K', () => {
    const [x, y] = at(30, 2);
    const out = createCandidateSet(3);
    expect(findCandidates(net, x, y, 25, { kind: 'all' }, out)).toBe(3);
    expect(net.edgeIds[out.edge[0]!]).toBe('h_1_0');
    expect(out.dist[0]).toBeCloseTo(2, 6);
    expect(out.t[0]).toBeCloseTo(0.5, 6);
    expect(out.dist[1]!).toBeGreaterThanOrEqual(out.dist[0]!);
    expect(out.dist[2]!).toBeGreaterThanOrEqual(out.dist[1]!);
  });

  it('measures undirected route distance, on the same edge too', () => {
    const e = net.edgeIndex.get('h_0_0')!;
    const f = net.edgeIndex.get('v_1_0')!; // north from g_1_0, the far end of h_0_0
    searchFrom(net, e, 0.25, 100);
    expect(routeDistance(net, e, 0.75)).toBeCloseTo(10, 3);
    expect(routeDistance(net, f, 0.5)).toBeCloseTo(15 + 10, 3);
    searchFrom(net, e, 0.25, 12);
    expect(routeDistance(net, f, 0.5)).toBe(Infinity);
  });
});

describe('campus-basic fixture', () => {
  const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/campus-basic', import.meta.url));
  let g: CampusGraph;
  let net: MatchNetwork;
  let edgeIds: Set<string>;
  beforeAll(async () => {
    const campus = await loadCampus(FIXTURE_DIR);
    g = buildGraph(campus);
    net = buildMatchNetwork(g);
    edgeIds = new Set(campus.features.flatMap(({ feature }) => {
      const f = feature as { id?: unknown; properties?: { kind?: unknown } };
      return f.properties?.kind === 'edge' && typeof f.id === 'string' ? [f.id] : [];
    }));
  });

  it('lists the portals with their outdoor and indoor ends', () => {
    expect(net.portals.map((p) => p.edgeId).sort()).toEqual(['e_portal_A_1_main', 'e_portal_A_4_north', 'e_portal_B_1_main', 'e_portal_C_5_main']);
    expect(net.portals.find((p) => p.edgeId === 'e_portal_A_1_main')).toEqual({
      edgeId: 'e_portal_A_1_main', buildingId: 'bldg_A', level: 1, outdoorNode: 'n_out_0002', indoorNode: 'n_A_1_main',
    });
    // Elevator edges are no candidates (no walkable line).
    expect(net.edgeIndex.has('e_A_elevA_L1__A_elevA_L2')).toBe(false);
  });

  it('filters candidates by scope: ground floors outdoors, one floor indoors', () => {
    const hall = net.nodeIndex.get('n_A_1_hall')!;
    const x = net.nodeX[hall]!;
    const y = net.nodeY[hall]!;
    const out = createCandidateSet(64);
    const ids = (scope: Parameters<typeof findCandidates>[4]) => {
      const n = findCandidates(net, x, y, 80, scope, out);
      return new Set(Array.from(out.edge.subarray(0, n), (e) => net.edgeIds[e]!));
    };
    const ground = ids({ kind: 'ground' });
    expect(ground.has('e_A_1_main__A_1_hall')).toBe(true);
    expect(ground.has('e_out_0001__out_0002')).toBe(true);
    expect(ground.has('e_A_3_hall__A_3_bridge')).toBe(false);
    expect(ground.has('e_A_1_stair__A_2_stair')).toBe(false);
    const third = ids({ kind: 'floor', buildingId: 'bldg_A', level: 3 });
    expect(third.has('e_A_3_hall__A_3_bridge')).toBe(true);
    expect(third.has('e_A_2_stair__A_3_stair')).toBe(true);
    expect(third.has('e_A_3_bridge__B_2_bridge')).toBe(true);
    expect(third.has('e_A_1_main__A_1_hall')).toBe(false);
    expect(third.has('e_out_0001__out_0002')).toBe(false);
  });

  it('matches a walk to real edge ids (smoke)', () => {
    // n_out_0001 → n_out_0002 → n_out_0004, in the network's own frame.
    const p = (id: string) => [net.nodeX[net.nodeIndex.get(id)!]!, net.nodeY[net.nodeIndex.get(id)!]!] as [number, number];
    const local = walk([p('n_out_0001'), p('n_out_0002'), p('n_out_0004')], 1.3);
    // walk() and fixesOf() use the test frame; re-express the truth there.
    const truth: TruthPoint[] = local.map((q) => {
      const [lng, lat] = toLngLat(net.frame, q.x, q.y);
      const [x, y] = toLocal(FRAME, lng, lat);
      return { ...q, x, y };
    });
    const state = createMatcherState();
    const results = fixesOf(truth, 41, { sigmaM: 3, accuracyM: 5 }).map((f) => matchStep(net, state, f));
    expect(results.every((r) => r.edgeId !== null && edgeIds.has(r.edgeId))).toBe(true);
    const first = results.slice(5, 25).filter((r) => r.edgeId === 'e_out_0001__out_0002').length;
    const second = results.slice(-15).filter((r) => r.edgeId === 'e_out_0002__out_0004').length;
    expect(first).toBeGreaterThanOrEqual(18);
    expect(second).toBeGreaterThanOrEqual(13);
  });

  it('is exported from the package root', () => {
    expect(typeof core.buildMatchNetwork).toBe('function');
    expect(typeof core.matchStep).toBe('function');
    expect(typeof core.navStep).toBe('function');
    expect(core.DEFAULT_MATCH_PARAMS.maxCandidates).toBe(8);
  });
});

describe('rules on the source', () => {
  it('reads no clock, randomness or I/O in the step code', async () => {
    for (const file of ['geo.ts', 'network.ts', 'hmm.ts', 'nav.ts', 'types.ts']) {
      const source = await readFile(new URL(`../../src/matching/${file}`, import.meta.url), 'utf8');
      const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, file).not.toMatch(/Date\.now|new Date|Math\.random|performance\.now|['"]node:|\bdocument\.|\bwindow\./);
    }
  });

  it('leaves graph.ts and route.ts without floor numbers', async () => {
    for (const file of ['graph.ts', 'route.ts']) {
      const source = await readFile(new URL(`../../src/${file}`, import.meta.url), 'utf8');
      const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, file).not.toMatch(/level/i);
    }
  });
});
