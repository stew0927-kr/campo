// Performance budget (docs/MAP_MATCHING.md 8): one matchStep + navStep on a 2,025-node grid must average well under
// 2 ms here, so it stays under 10 ms per fix on a phone (Hermes is several times slower than V8 with JIT). The bound
// is loose on purpose: it catches an accidental O(network) step, not small regressions.
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../../src/graph.ts';
import { createMatcherState, matchStep } from '../../src/matching/hmm.ts';
import { buildNavRoute, initialNavState, navStep } from '../../src/matching/nav.ts';
import { buildMatchNetwork } from '../../src/matching/network.ts';
import { fixesOf, gridCampus, walk, type XY } from './fixtures.ts';

describe('performance budget', () => {
  it('averages under 2 ms per fix on a 2,000-node network', () => {
    const N = 45; // 45 × 45 = 2,025 nodes, 3,960 edges, 10 m apart
    const graph = buildGraph(gridCampus(N, N, 10));
    const net = buildMatchNetwork(graph);
    expect(net.nodeIds.length).toBe(2025);

    // A long meander across the grid, with poor fixes (accuracy 25 m: sigma 25, radius 75 m, many edges in reach).
    const pts: XY[] = [];
    for (let row = 0; row < 9; row++) {
      const y = 20 + row * 50;
      pts.push(row % 2 === 0 ? [0, y] : [440, y], row % 2 === 0 ? [440, y] : [0, y]);
    }
    const truth = walk(pts, 1.4).slice(0, 1500);
    const fixes = fixesOf(truth, 51, { sigmaM: 12, accuracyM: 25 });
    const route = buildNavRoute(net, Array.from({ length: N }, (_, i) => `g_${i}_2`));

    const state = createMatcherState();
    let nav = initialNavState(0);
    const warm = 100;
    let start = 0;
    for (let k = 0; k < fixes.length; k++) {
      if (k === warm) start = performance.now();
      const r = matchStep(net, state, fixes[k]!);
      nav = navStep(nav, r, fixes[k]!, { net, route }).nav;
    }
    const avgMs = (performance.now() - start) / (fixes.length - warm);
    expect(avgMs).toBeLessThan(2);
  });
});
