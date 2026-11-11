// Invariants I1–I5 of the edit state (SPEC-v0.2 4.2). I6 (undo to the start gives the start) is a History property.
// Comparing levels here (I4) is a check, not routing.
import distance from '@turf/distance';
import { ELEVATOR_STOP_M } from './tolerances.ts';
import {
  isPosition,
  isScopeBound,
  samePosition,
  scopeOfNode,
  sortedValues,
  type EditNode,
  type EditState,
} from './state.ts';

export type InvariantCode = 'I1' | 'I2' | 'I3' | 'I4' | 'I5';

export interface InvariantViolation {
  code: InvariantCode;
  /** Sorted Feature ids involved. */
  ids: string[];
  /** Korean. */
  message: string;
}

export function checkInvariants(state: EditState, codes?: readonly InvariantCode[]): InvariantViolation[] {
  const want = (c: InvariantCode) => codes === undefined || codes.includes(c);
  const out: InvariantViolation[] = [];
  const push = (code: InvariantCode, ids: string[], message: string) => out.push({ code, ids: [...new Set(ids)].sort(), message });

  // I1. Every edge's from / to node exists.
  if (want('I1')) {
    for (const edge of sortedValues(state.edges)) {
      for (const end of ['from', 'to'] as const) {
        const ref = edge.props[end];
        if (!(ref in state.nodes)) push('I1', [edge.id, ref], `구간 "${edge.id}"의 ${end}가 없는 지점 "${ref}"를 가리킵니다.`);
      }
    }
  }

  // I2. The saved LineString starts and ends on the from / to nodes. Structurally true here, so this checks
  // that every coordinate the save would write is a finite [lng, lat] pair and that the ends are the node coordinates.
  if (want('I2')) {
    for (const node of sortedValues(state.nodes)) {
      if (!isPosition(node.coord)) push('I2', [node.id], `지점 "${node.id}"의 좌표가 [경도, 위도] 숫자 쌍이 아닙니다.`);
    }
    for (const edge of sortedValues(state.edges)) {
      if (!Array.isArray(edge.vertices) || !edge.vertices.every(isPosition)) {
        push('I2', [edge.id], `구간 "${edge.id}"의 꺾임점 좌표가 [경도, 위도] 숫자 쌍이 아닙니다.`);
        continue;
      }
      const from = state.nodes[edge.props.from];
      const to = state.nodes[edge.props.to];
      if (!from || !to || !isPosition(from.coord) || !isPosition(to.coord)) continue;
      const line = [from.coord, ...edge.vertices, to.coord];
      if (!samePosition(line[0]!, from.coord) || !samePosition(line[line.length - 1]!, to.coord)) {
        push('I2', [edge.id], `구간 "${edge.id}"의 끝 좌표가 지점 좌표와 다릅니다.`);
      }
    }
  }

  // I3. Ids are unique: each record key matches its Feature, and no id is used twice across collections.
  if (want('I3')) {
    const seen = new Map<string, string>();
    const see = (id: string, where: string) => {
      const first = seen.get(id);
      if (first !== undefined) push('I3', [id], `id "${id}"가 ${first}와 ${where}에 겹칩니다.`);
      else seen.set(id, where);
    };
    for (const [coll, record] of [['nodes', state.nodes], ['edges', state.edges], ['rooms', state.rooms]] as const) {
      for (const [key, f] of Object.entries(record)) {
        if (f.id !== key) push('I3', [key, f.id], `${coll}의 키 "${key}"와 id "${f.id}"가 다릅니다.`);
        see(f.id, coll);
      }
    }
    for (const [code, b] of Object.entries(state.buildings)) {
      if (b.props.code !== code) push('I3', [b.id], `건물 "${b.id}"의 code "${b.props.code}"가 키 "${code}"와 다릅니다.`);
      see(b.id, 'buildings');
    }
  }

  // I4. Flat edges (footway / corridor) stay in one scope. Only portals and bridges cross.
  if (want('I4')) {
    for (const edge of sortedValues(state.edges)) {
      if (!isScopeBound(edge.props)) continue;
      const from = state.nodes[edge.props.from];
      const to = state.nodes[edge.props.to];
      if (!from || !to) continue;
      if (scopeOfNode(from) !== scopeOfNode(to)) {
        push('I4', [edge.id], `평지 구간 "${edge.id}"가 서로 다른 범위(${scopeOfNode(from)} → ${scopeOfNode(to)})를 잇습니다.`);
      }
    }
  }

  // I5. Stops of one elevator_id share one coordinate.
  if (want('I5')) {
    for (const [elevatorId, group] of elevatorGroups(state)) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i]!;
          const b = group[j]!;
          if (!stopsTogether(a.coord, b.coord)) {
            push('I5', [a.id, b.id], `elevator_id "${elevatorId}"의 정차 지점 "${a.id}"와 "${b.id}"가 다른 자리에 있습니다.`);
          }
        }
      }
    }
  }
  return out;
}

/** elevator_id → its elevator_stop nodes (id order). */
export function elevatorGroups(state: EditState): Map<string, EditNode[]> {
  const groups = new Map<string, EditNode[]>();
  for (const node of sortedValues(state.nodes)) {
    const id = node.props.elevator_id;
    if (node.props.node_type !== 'elevator_stop' || id === undefined) continue;
    groups.set(id, [...(groups.get(id) ?? []), node]);
  }
  return groups;
}

export function stopsTogether(a: EditNode['coord'], b: EditNode['coord']): boolean {
  if (!isPosition(a) || !isPosition(b)) return false;
  return samePosition(a, b) || distance(a, b, { units: 'meters' }) <= ELEVATOR_STOP_M;
}

const key = (v: InvariantViolation) => `${v.code}:${v.ids.join(',')}`;

/** Violations in `after` that `before` did not have. Actions use this to refuse a change that would break I4 / I5. */
export function newViolations(before: EditState, after: EditState, codes: readonly InvariantCode[]): InvariantViolation[] {
  const old = new Set(checkInvariants(before, codes).map(key));
  return checkInvariants(after, codes).filter((v) => !old.has(key(v)));
}
