import type { EdgeProperties } from '../types.ts';

/**
 * Is this campus edge a terrain break-line (EdgeProperties.is_breakline)? is_breakline when set, else outdoor steps
 * (edge_type 'outdoor' + highway 'steps'). The height solver draws the break as a short line across the edge's middle
 * (tools/elevation/campo_height_solver.py breaklines_from_campus) and keeps residual corrections on their own side.
 */
export function isBreakline(edge: Pick<EdgeProperties, 'is_breakline' | 'edge_type' | 'highway'>): boolean {
  return edge.is_breakline ?? (edge.edge_type === 'outdoor' && edge.highway === 'steps');
}
