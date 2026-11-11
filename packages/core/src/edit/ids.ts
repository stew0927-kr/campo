// New Feature ids (SPEC-v0.2 4.1.2): a readable prefix from the v0.1 rules (SPEC §4.4) + a 6-character random tail.
// No global counter: the generator is injected, and tests fix its seed.
import type { NodeType } from '../types.ts';
import { codeOf, idTaken, type StateLike } from './state.ts';

export interface IdGen {
  /** Six lowercase base-36 characters. */
  tail(): string;
}

const TAIL_SPACE = 36 ** 6;

/** Deterministic id generator (mulberry32). The same seed gives the same tails in the same order. */
export function createIdGen(seed: number): IdGen {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { tail: () => Math.floor(next() * TAIL_SPACE).toString(36).padStart(6, '0') };
}

/** Draw `prefix + tail` until the id is free. A taken id is redrawn from the same generator, so the result stays deterministic. */
export function freshId(state: StateLike, ids: IdGen, prefix: string, reserved: ReadonlySet<string> = new Set()): string {
  for (let i = 0; i < 1000; i++) {
    const id = `${prefix}${ids.tail()}`;
    if (!idTaken(state, id) && !reserved.has(id)) return id;
  }
  throw new Error(`no free id with prefix ${prefix}`);
}

export function nodeIdPrefix(state: StateLike, props: { building_id: string | null; level: number | null; node_type: NodeType }): string {
  if (props.building_id === null) return 'n_out_';
  return `n_${codeOf(state, props.building_id)}_${String(props.level)}_${props.node_type}_`;
}

export type EdgeFileScope =
  | { kind: 'outdoor' }
  | { kind: 'connections' }
  | { kind: 'building'; buildingId: string; level: number | null };

/**
 * Where an edge belongs (SPEC §4.3): portals and bridges, and edges whose ends are not in one building, go to
 * connections; edges with both ends outside go outdoors; the rest go to the lower of their two levels.
 * Comparing levels here only picks a file. Routing never does this.
 */
export function edgeFileScope(
  edgeType: string | undefined,
  from: { building_id: string | null; level: number | null },
  to: { building_id: string | null; level: number | null },
): EdgeFileScope {
  if (edgeType === 'portal' || edgeType === 'bridge') return { kind: 'connections' };
  if (from.building_id === null && to.building_id === null) return { kind: 'outdoor' };
  if (from.building_id === null || from.building_id !== to.building_id) return { kind: 'connections' };
  const levels = [from.level, to.level].filter((l): l is number => l !== null);
  return { kind: 'building', buildingId: from.building_id, level: levels.length > 0 ? Math.min(...levels) : null };
}

export function edgeIdPrefix(state: StateLike, scope: EdgeFileScope): string {
  if (scope.kind === 'outdoor') return 'e_out_';
  if (scope.kind === 'connections') return 'e_conn_';
  return `e_${codeOf(state, scope.buildingId)}_${String(scope.level)}_`;
}

export function roomIdPrefix(state: StateLike, buildingId: string, level: number): string {
  return `r_${codeOf(state, buildingId)}_${level}_`;
}
