import { DERIVED_ELEVATION_PROPS, type DerivedElevationProp } from '../../types.ts';
import { bumpRev, defineAction, type Action } from '../action.ts';
import type { EditState } from '../state.ts';
import { missing } from './common.ts';

/** New derived values of one edge. A key left out (or the whole entry null) removes that value from the edge. */
export type EdgeElevationValues = Partial<Record<DerivedElevationProp, number>>;

/** Remove every derived elevation value from edge props (a split or a heal, until the next recompute). */
export function dropDerivedElevation(props: object): void {
  const p = props as Record<string, unknown>;
  for (const k of DERIVED_ELEVATION_PROPS) delete p[k];
}

function changes(state: EditState, id: string, values: EdgeElevationValues | null): boolean {
  const p = state.edges[id]!.props as unknown as Record<string, unknown>;
  return DERIVED_ELEVATION_PROPS.some((k) => p[k] !== values?.[k]);
}

/**
 * Write the elevation recompute's derived values (elev_diff_m, elev_sigma_m, grade_pct) onto edges, one history entry.
 * Edges whose values do not change are left alone (no rev bump). Every other property stays.
 */
export function setEdgeElevation(values: Readonly<Record<string, EdgeElevationValues | null>>): Action {
  const ids = Object.keys(values);
  return defineAction({
    annotation: '고도 다시 계산 반영',
    disabled(state) {
      const gone = missing('구간', ids, (id) => id in state.edges);
      if (gone) return gone;
      for (const id of ids) {
        for (const [k, v] of Object.entries(values[id] ?? {})) {
          if (!(DERIVED_ELEVATION_PROPS as readonly string[]).includes(k)) return `고도 값이 아닌 속성은 여기서 바꿀 수 없습니다: ${k}`;
          if (typeof v !== 'number' || !Number.isFinite(v)) return `구간 "${id}"의 ${k} 값이 숫자가 아닙니다.`;
          if (k === 'elev_sigma_m' && v <= 0) return `구간 "${id}"의 elev_sigma_m은 0보다 커야 합니다.`;
        }
      }
      if (!ids.some((id) => changes(state, id, values[id] ?? null))) return '바뀔 고도 값이 없습니다.';
      return false;
    },
    recipe(draft) {
      for (const id of ids) {
        if (!changes(draft, id, values[id] ?? null)) continue;
        const props = draft.edges[id]!.props;
        dropDerivedElevation(props);
        // Same key order every time: elev_diff_m, elev_sigma_m, grade_pct (after the other properties).
        for (const k of DERIVED_ELEVATION_PROPS) {
          const v = values[id]?.[k];
          if (v !== undefined) (props as unknown as Record<string, number>)[k] = v;
        }
        bumpRev(props);
      }
    },
  });
}
