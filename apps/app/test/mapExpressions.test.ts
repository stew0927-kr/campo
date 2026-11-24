import { describe, expect, it } from 'vitest';
import { CAMPUS_SKETCH_STYLE } from '../src/map/style.ts';
import { WAY_WIDTH } from '../src/map/wayWidth.ts';

type Expr = unknown;
const isZoom = (e: Expr) => Array.isArray(e) && e[0] === 'zoom';

/** Returns every place a ['zoom'] appears that is NOT the direct input of a top-level step/interpolate. */
function zoomViolations(expr: Expr, path = '$'): string[] {
  if (!Array.isArray(expr)) return [];
  const [op] = expr;
  const bad: string[] = [];
  if (op === 'zoom') return [`${path}: zoom outside a top-level step/interpolate input`];
  // Top-level step/interpolate: the zoom input is allowed; outputs must contain no zoom at all.
  const isCurve = op === 'interpolate' || op === 'interpolate-hcl' || op === 'interpolate-lab' || op === 'step';
  if (isCurve && path !== '$') {
    if (containsZoom(expr)) bad.push(`${path}: nested ${String(op)} containing zoom`);
    return bad;
  }
  if (isCurve) {
    const inputIndex = op === 'step' ? 1 : 2;
    if (!isZoom(expr[inputIndex])) return [`${path}: ${String(op)} input is not ['zoom']`].filter(() => containsZoom(expr));
    expr.forEach((child, i) => { if (i !== inputIndex) bad.push(...zoomViolations(child, `${path}[${i}]`).map((m) => m.replace(/zoom outside.*/, 'zoom inside curve output'))); });
    return bad;
  }
  if (containsZoom(expr)) bad.push(`${path}: zoom under non-curve operator ${String(op)}`);
  return bad;
}
function containsZoom(e: Expr): boolean { return Array.isArray(e) && (e[0] === 'zoom' || e.some(containsZoom)); }

/** Minimal evaluator for the operators WAY_WIDTH uses. */
function evalExpr(e: Expr, zoom: number, props: Record<string, number>): number {
  if (typeof e === 'number') return e;
  const [op, ...a] = e as unknown[];
  switch (op) {
    case 'get': return props[a[0] as string]!;
    case 'coalesce': { for (const x of a) { const v = evalExpr(x, zoom, props); if (v !== undefined && !Number.isNaN(v)) return v; } return NaN; }
    case '*': return a.reduce<number>((p, x) => p * evalExpr(x, zoom, props), 1);
    case '/': return evalExpr(a[0], zoom, props) / evalExpr(a[1], zoom, props);
    case 'min': return Math.min(...a.map((x) => evalExpr(x, zoom, props)));
    case 'max': return Math.max(...a.map((x) => evalExpr(x, zoom, props)));
    case 'interpolate': {
      const z = zoom; const stops = a.slice(2) as unknown[];
      for (let i = 0; i < stops.length; i += 2) {
        const s = stops[i] as number;
        if (z <= s) { if (i === 0) return evalExpr(stops[1], z, props); const p = stops[i - 2] as number; const t = (z - p) / (s - p); const lo = evalExpr(stops[i - 1], z, props); const hi = evalExpr(stops[i + 1], z, props); return lo + (hi - lo) * t; }
      }
      return evalExpr(stops[stops.length - 1], z, props);
    }
    default: throw new Error(`unsupported op ${String(op)}`);
  }
}

describe('WAY_WIDTH expression', () => {
  const expr = WAY_WIDTH as unknown as unknown[];
  it('has a top-level interpolate whose input is ["zoom"]', () => {
    expect(expr[0]).toBe('interpolate');
    expect(expr[1]).toEqual(['linear']);
    expect(expr[2]).toEqual(['zoom']);
  });
  it('uses zoom nowhere except that input', () => {
    expect(JSON.stringify(expr).match(/\["zoom"\]/g)).toHaveLength(1);
    expect(zoomViolations(expr)).toEqual([]);
  });
  it('keeps the visual result: 2 m wide = 1x, clamped 0.7x–1.8x, zoom 14–20 = 1.4–11', () => {
    expect(evalExpr(expr, 16, { width: 2 })).toBeCloseTo(2.6);
    expect(evalExpr(expr, 14, { width: 2 })).toBeCloseTo(1.4);
    expect(evalExpr(expr, 20, { width: 2 })).toBeCloseTo(11);
    expect(evalExpr(expr, 16, { width: 100 })).toBeCloseTo(2.6 * 1.8);
    expect(evalExpr(expr, 16, { width: 0.1 })).toBeCloseTo(2.6 * 0.7);
  });
});

describe('zoom rule checker', () => {
  it('rejects the old multiplied form and nested interpolates', () => {
    expect(zoomViolations(['*', ['interpolate', ['linear'], ['zoom'], 14, 1, 20, 2], 3]).length).toBeGreaterThan(0);
    expect(zoomViolations(['interpolate', ['linear'], ['zoom'], 14, ['interpolate', ['linear'], ['zoom'], 1, 2], 20, 2]).length).toBeGreaterThan(0);
  });
  it('accepts a plain top-level interpolate/step', () => {
    expect(zoomViolations(['interpolate', ['linear'], ['zoom'], 14, 1, 20, 2])).toEqual([]);
    expect(zoomViolations(['step', ['zoom'], 1, 14, 2])).toEqual([]);
  });
});

describe('map/style.ts layers', () => {
  it('use zoom only as the direct input of a top-level step/interpolate', () => {
    const problems: string[] = [];
    for (const layer of CAMPUS_SKETCH_STYLE.layers as unknown as Record<string, Record<string, unknown>>[]) {
      for (const group of ['paint', 'layout'] as const) {
        for (const [prop, value] of Object.entries((layer as never as Record<string, Record<string, unknown>>)[group] ?? {})) {
          for (const m of zoomViolations(value)) problems.push(`${(layer as never as { id: string }).id}.${group}.${prop} ${m}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
