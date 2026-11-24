// Marker / indoor label layout performance and equivalence.
// `legacyDeclutter` is the pre-optimisation declutter copied verbatim (git 80244b4, mapLabels.ts). It is the oracle:
// the optimised declutter must place exactly the same markers with the same labels and coordinates, and the
// legacy "re-declutter on every region event" pipeline must fail the work budgets the new pipeline meets.
import { describe, expect, it } from 'vitest';
import type { CampusPlace } from '../src/contracts.ts';
import {
  DeclutterScheduler, ICON_GAP_PX, ICON_SIZE_PX, LABEL_GAP_PX, LABEL_HEIGHT_PX, MAX_ICONS, MAX_LABELS, OVERVIEW_ICON_GAP_PX,
  buildMarkers, declutter, estimateLabelWidth, floorFacilityNodes, labelLift, toScreen, zoomStage,
  type DeclutterStats, type MapMarker, type MapView, type MarkerKind, type MarkerTone, type PlacedMarker, type ZoomStage,
} from '../src/features/map/mapLabels.ts';
import { loadBundledCampus } from '../src/campus/loadBundledCampus.ts';
import indoorFixture from '../src/features/map/indoorFixture.json';
import type { BundledCampus } from '../src/campus/types.ts';

/* ---------- legacy oracle (verbatim) ---------- */
interface Box { left: number; top: number; right: number; bottom: number }
const overlaps = (a: Box, b: Box, gap: number) =>
  a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
function anchorBox(x: number, y: number, tone: MarkerTone): Box {
  if (tone === 'start' || tone === 'end') return { left: x - 22, top: y - 52, right: x + 22, bottom: y + 8 };
  if (tone === 'selected') return { left: x - 15, top: y - 30, right: x + 15, bottom: y };
  const r = ICON_SIZE_PX / 2;
  return { left: x - r, top: y - r, right: x + r, bottom: y + r };
}
function legacyDeclutter(markers: readonly MapMarker[], view: MapView, { stage, margin = 40, maxIcons = MAX_ICONS, maxLabels = MAX_LABELS, stats }: { stage: ZoomStage; margin?: number; maxIcons?: number; maxLabels?: number; stats?: DeclutterStats }): PlacedMarker[] {
  const halfW = view.width / 2 + margin, halfH = view.height / 2 + margin;
  const iconGap = stage === 'overview' ? OVERVIEW_ICON_GAP_PX : ICON_GAP_PX;
  if (stats) stats.projected += markers.length;
  const sorted = markers
    .map((marker, order) => ({ marker, order, ...toScreen(marker.lng, marker.lat, view) }))
    .filter((m) => Math.abs(m.x) <= halfW && Math.abs(m.y) <= halfH)
    .sort((a, b) => a.marker.priority - b.marker.priority || a.order - b.order);
  const icons: Box[] = [];
  const labels: Box[] = [];
  const placed: PlacedMarker[] = [];
  let labelCount = 0;
  for (const { marker, x, y } of sorted) {
    const pinned = marker.tone !== 'normal';
    const box = anchorBox(x, y, marker.tone);
    if (!pinned && (icons.length >= maxIcons || icons.some((b) => overlaps(b, box, iconGap)) || labels.some((b) => overlaps(b, box, ICON_GAP_PX)))) continue;
    icons.push(box);
    let label = false;
    if (stage === 'labels' && marker.name && labelCount < maxLabels) {
      const w = estimateLabelWidth(marker.name);
      const bottom = y - labelLift(marker.tone);
      const lb: Box = { left: x - w / 2, top: bottom - LABEL_HEIGHT_PX, right: x + w / 2, bottom };
      const free = labels.every((b) => !overlaps(b, lb, LABEL_GAP_PX)) && icons.every((b) => b === box || !overlaps(b, lb, ICON_GAP_PX));
      if (free) { labels.push(lb); labelCount++; label = true; }
    }
    placed.push({ marker, x, y, label });
  }
  return placed;
}
/** The legacy CampusMap: onRegionDidChange → setView → declutter again → a new array (re-render) every event. */
class LegacyPipeline {
  placed: PlacedMarker[] = [];
  readonly stats = { computed: 0, skipped: 0, changed: 0, projected: 0, compared: 0 };
  constructor(private markers: readonly MapMarker[], private indoor: boolean) {}
  event(view: MapView) {
    const work = { projected: 0, compared: 0 };
    this.placed = legacyDeclutter(this.markers, view, { stage: zoomStage(view.zoom, this.indoor), stats: work });
    this.stats.computed++; this.stats.changed++; this.stats.projected += work.projected;
  }
}

/* ---------- synthetic data ---------- */
function random(seed: number) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
const KINDS: MarkerKind[] = ['door', 'elevator', 'stairs', 'restroom', 'entrance', 'place'];
const CENTER = { lng: 127.045, lat: 37.5575 };
/**
 * `n` markers through the real buildMarkers: registered places + unnamed facilities, a start, an end, a selection
 * and a route through every 25th marker. `spread`: 'campus' ≈ 900 m × 700 m, 'floor' ≈ one 120 m × 60 m floor.
 */
function dataset(n: number, spread: 'campus' | 'floor', seed = 1): MapMarker[] {
  const r = random(seed);
  const [w, h] = spread === 'campus' ? [0.0102, 0.0063] : [0.00136, 0.00054];
  const places: CampusPlace[] = [];
  const facilities: { id: string; kind: MarkerKind; lng: number; lat: number; name: string | null }[] = [];
  for (let i = 0; i < n; i++) {
    const lng = CENTER.lng + (r() - 0.5) * w, lat = CENTER.lat + (r() - 0.5) * h;
    const kind = KINDS[i % KINDS.length]!;
    if (kind === 'stairs' || kind === 'elevator') facilities.push({ id: `f${i}`, kind, lng, lat, name: null });
    else places.push({ id: `p${i}`, name: kind === 'door' ? `${100 + (i % 900)}호 강의실` : `가상 장소 ${i}`, nodeType: kind === 'place' ? 'poi' : kind === 'door' ? 'door' : kind, buildingId: null, level: null, lng, lat });
  }
  const route = places.filter((_, i) => i % 25 === 0).map((p) => p.id);
  return buildMarkers({ places, facilities, from: places[0] ?? null, to: places[1] ?? null, selected: places[2] ?? null, routeNodeIds: route });
}
const view = (zoom: number, extra: Partial<MapView> = {}): MapView => ({ ...CENTER, zoom, bearing: 0, width: 390, height: 700, ...extra });
const stageOf = (zoom: number, indoor = true) => zoomStage(zoom, indoor);

/* ---------- rule checker: independent of both implementations ---------- */
function violations(placed: readonly PlacedMarker[], v: MapView, stage: ZoomStage, margin = 40): string[] {
  const out: string[] = [];
  const iconGap = stage === 'overview' ? OVERVIEW_ICON_GAP_PX : ICON_GAP_PX;
  const halfW = v.width / 2 + margin, halfH = v.height / 2 + margin;
  const boxes = placed.map((p) => ({ p, box: anchorBox(p.x, p.y, p.marker.tone) }));
  const labelBoxes = placed.flatMap((p, i) => {
    if (!p.label) return [];
    const w = estimateLabelWidth(p.marker.name!), bottom = p.y - labelLift(p.marker.tone);
    return [{ i, box: { left: p.x - w / 2, top: bottom - LABEL_HEIGHT_PX, right: p.x + w / 2, bottom } }];
  });
  const normal = placed.filter((p) => p.marker.tone === 'normal').length;
  if (normal > MAX_ICONS) out.push(`icons ${normal} > ${MAX_ICONS}`);
  if (labelBoxes.length > MAX_LABELS) out.push(`labels ${labelBoxes.length} > ${MAX_LABELS}`);
  for (const { p } of boxes) if (Math.abs(p.x) > halfW || Math.abs(p.y) > halfH) out.push(`off screen ${p.marker.id}`);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    if ((a.p.marker.tone === 'normal' || b.p.marker.tone === 'normal') && overlaps(a.box, b.box, iconGap)) out.push(`icon overlap ${a.p.marker.id} ${b.p.marker.id}`);
  }
  for (let i = 0; i < labelBoxes.length; i++) for (let j = i + 1; j < labelBoxes.length; j++) {
    if (overlaps(labelBoxes[i]!.box, labelBoxes[j]!.box, LABEL_GAP_PX)) out.push(`label overlap ${labelBoxes[i]!.i} ${labelBoxes[j]!.i}`);
  }
  for (const l of labelBoxes) for (let k = 0; k < boxes.length; k++) {
    if (k !== l.i && overlaps(boxes[k]!.box, l.box, ICON_GAP_PX)) out.push(`label ${l.i} over icon ${k}`);
  }
  return out;
}

const time = (run: () => void) => { const t0 = performance.now(); run(); return performance.now() - t0; };
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
/** Collected for the PR table (printed once at the end). */
const report: Record<string, string | number>[] = [];

describe('optimised declutter places exactly what the legacy declutter placed', () => {
  it('matches the legacy oracle over random views, stages, bearings, sizes and caps', () => {
    const r = random(42);
    let cases = 0;
    for (const n of [0, 1, 7, 60, 500, 1000]) for (const spread of ['campus', 'floor'] as const) {
      const markers = dataset(n, spread, n + 3);
      for (let k = 0; k < 24; k++) {
        const zoom = 16 + r() * 5.5;
        const v = view(zoom, {
          lng: CENTER.lng + (r() - 0.5) * (spread === 'campus' ? 0.01 : 0.0015), lat: CENTER.lat + (r() - 0.5) * (spread === 'campus' ? 0.006 : 0.0006),
          bearing: [0, 0, 37, 90, 180, 271.5, -45][k % 7]!, width: [390, 320, 1024, 0, 412][k % 5]!, height: [700, 568, 1366, 300, 915][k % 5]!,
        });
        const opts = { stage: (['overview', 'icons', 'labels'] as const)[k % 3]!, margin: [40, 0, 120][k % 3]!, maxIcons: k % 4 === 0 ? 5 : MAX_ICONS, maxLabels: k % 5 === 0 ? 2 : MAX_LABELS };
        expect(declutter(markers, v, opts)).toEqual(legacyDeclutter(markers, v, opts));
        cases++;
      }
    }
    expect(cases).toBe(6 * 2 * 24);
  });
  it('matches with pinned markers ranked low, duplicate priorities and non-finite coordinates', () => {
    const base = dataset(300, 'floor', 9);
    const odd: MapMarker[] = base.map((m, i) => (i % 50 === 7 ? { ...m, tone: 'selected', priority: 5 } : i % 61 === 3 ? { ...m, lng: Number.NaN } : i % 97 === 5 ? { ...m, lat: Number.POSITIVE_INFINITY } : m));
    for (const zoom of [17, 18.6, 20.2]) for (const bearing of [0, 123]) {
      const v = view(zoom, { bearing });
      expect(declutter(odd, v, { stage: stageOf(zoom) })).toEqual(legacyDeclutter(odd, v, { stage: stageOf(zoom) }));
    }
  });
  it('indexes floor facilities once per graph and returns the same nodes in graph order', async () => {
    const rt = loadBundledCampus(indoorFixture as BundledCampus);
    const naive = (buildingId: string, level: number | null) => [...rt.graph.nodes.values()]
      .filter((node) => node.properties.building_id === buildingId && node.properties.level === level && ['door', 'elevator_stop', 'stair_landing', 'restroom', 'entrance'].includes(node.properties.node_type))
      .map((node) => node.id);
    for (const [b, l] of [['bldg_A', 1], ['bldg_A', 4], ['bldg_B', 2], ['bldg_C', 5], ['bldg_A', null], ['bldg_Z', 1]] as const) {
      expect(floorFacilityNodes(rt.graph, b, l).map((f) => f.id)).toEqual(naive(b, l));
    }
    // A caller may change the returned list without touching the index.
    floorFacilityNodes(rt.graph, 'bldg_A', 4).length = 0;
    expect(floorFacilityNodes(rt.graph, 'bldg_A', 4).length).toBe(naive('bldg_A', 4).length);
  });
});

describe('layout rules hold for 1,000 markers', () => {
  it('has zero overlap violations and respects MAX_ICONS / MAX_LABELS in every stage', () => {
    for (const spread of ['campus', 'floor'] as const) {
      const markers = dataset(1000, spread);
      for (const zoom of [16.5, 17.8, 18.4, 19, 19.6, 20.4, 21.2]) for (const bearing of [0, 30, 200]) {
        const v = view(zoom, { bearing }), stage = stageOf(zoom);
        const placed = declutter(markers, v, { stage });
        expect(violations(placed, v, stage)).toEqual([]);
        expect(placed.filter((p) => p.marker.tone === 'normal').length).toBeLessThanOrEqual(MAX_ICONS);
        expect(placed.filter((p) => p.label).length).toBeLessThanOrEqual(MAX_LABELS);
        // Start, end and the selection are never dropped while on screen.
        for (const m of markers.filter((m) => m.tone !== 'normal')) {
          const { x, y } = toScreen(m.lng, m.lat, v);
          if (Math.abs(x) <= v.width / 2 + 40 && Math.abs(y) <= v.height / 2 + 40) expect(placed.some((p) => p.marker === m)).toBe(true);
        }
      }
    }
  });
  it('the caps actually bind with 1,000 markers (so the checks above are not vacuous)', () => {
    // Dense floor at zoom 19: icons hit MAX_ICONS.
    const wide = declutter(dataset(1000, 'floor'), view(19), { stage: 'icons' });
    expect(wide.filter((p) => p.marker.tone === 'normal').length).toBe(MAX_ICONS);
    expect(violations(wide, view(19), 'icons')).toEqual([]);
    // A regular 40 × 25 grid of named places 40 m apart: on a tablet at the outdoor label zoom, names hit MAX_LABELS.
    const places: CampusPlace[] = Array.from({ length: 1000 }, (_, i) => ({ id: `g${i}`, name: `장소 ${i}`, nodeType: 'poi', buildingId: null, level: null,
      lng: CENTER.lng + ((i % 40) - 20) * 40 / 88_300, lat: CENTER.lat + (Math.floor(i / 40) - 12) * 40 / 110_540 }));
    const grid = buildMarkers({ places });
    const v = view(18.2, { width: 1024, height: 1366 });
    const placed = declutter(grid, v, { stage: zoomStage(18.2, false) });
    expect(placed.filter((p) => p.label).length).toBe(MAX_LABELS);
    expect(placed).toEqual(legacyDeclutter(grid, v, { stage: 'labels' }));
    expect(violations(placed, v, 'labels')).toEqual([]);
  });
});

describe('benchmarks (budgets the legacy pipeline does not meet)', () => {
  // Warm the code paths like a running app does (JIT), on a small separate list.
  const warm = dataset(200, 'floor', 77);
  for (let i = 0; i < 30; i++) { declutter(warm, view(18 + i / 10), { stage: 'icons' }); legacyDeclutter(warm, view(18 + i / 10), { stage: 'icons' }); }

  for (const n of [500, 1000]) {
    it(`one declutter of ${n} markers takes under 16 ms, including building the index`, () => {
      const cold: number[] = [], warmRuns: number[] = [], legacy: number[] = [];
      for (let k = 0; k < 10; k++) {
        const markers = dataset(n, 'floor', 100 + k); // a fresh array: the index is built inside this call
        const v = view(19.6 + (k % 3) / 2, { bearing: k * 17 }), stage = stageOf(v.zoom);
        cold.push(time(() => declutter(markers, v, { stage })));
        warmRuns.push(time(() => declutter(markers, { ...v, lng: v.lng + 2e-6 }, { stage })));
        legacy.push(time(() => legacyDeclutter(markers, v, { stage })));
      }
      expect(Math.max(...cold)).toBeLessThan(16);
      expect(Math.max(...warmRuns)).toBeLessThan(16);
      report.push({ case: `declutter ×1, ${n} markers (dense floor)`, legacyMedianMs: +median(legacy).toFixed(3), coldMedianMs: +median(cold).toFixed(3), warmMedianMs: +median(warmRuns).toFixed(3) });
    });
  }

  /** 60 frames of panning at 60 fps (onRegionIsChanging every 16.7 ms), then the settle event. */
  function pan(markers: readonly MapMarker[], start: MapView, dxPerFrame: number, dyPerFrame = 0) {
    const frames: MapView[] = [];
    for (let f = 1; f <= 60; f++) {
      const moved = { ...start };
      // Move the centre by whole pixels in screen space (bearing 0): px × metres/px → degrees.
      const mpp = (78271.517 * Math.cos((start.lat * Math.PI) / 180)) / 2 ** start.zoom;
      moved.lng = start.lng + (dxPerFrame * f * mpp) / (111_320 * Math.cos((start.lat * Math.PI) / 180));
      moved.lat = start.lat - (dyPerFrame * f * mpp) / 110_540;
      frames.push(moved);
    }
    const scheduler = new DeclutterScheduler();
    scheduler.settle(start, 0); scheduler.setMarkers(markers, true);
    const before = { ...scheduler.stats };
    const newMs = time(() => { frames.forEach((v, f) => scheduler.moving(v, (f + 1) * 16.7)); scheduler.settle(frames.at(-1)!, 61 * 16.7); });
    const legacy = new LegacyPipeline(markers, true);
    legacy.event(start);
    const legacyBefore = { ...legacy.stats };
    const legacyMs = time(() => { frames.forEach((v) => legacy.event(v)); legacy.event(frames.at(-1)!); });
    const delta = (a: typeof before, b: typeof before) => ({ computed: a.computed - b.computed, changed: a.changed - b.changed, projected: a.projected - b.projected });
    // The settled layout is exactly what a full legacy declutter gives for the final view.
    expect(scheduler.placed).toEqual(legacyDeclutter(markers, frames.at(-1)!, { stage: stageOf(frames.at(-1)!.zoom) }));
    return { neu: { ...delta(scheduler.stats, before), avgMs: newMs / 60 }, legacy: { ...delta(legacy.stats, legacyBefore), avgMs: legacyMs / 60 } };
  }
  /** Work budget for one 60-frame pan, as fixed counts so it does not depend on the machine. */
  const withinBudget = (r: { computed: number; changed: number; projected: number; avgMs: number }, n: number, { maxChanged = 15 } = {}) =>
    r.avgMs <= 4 && r.computed <= 15 && r.changed <= maxChanged && r.projected / 61 <= n / 5;

  for (const n of [500, 1000]) {
    it(`panning 60 frames over ${n} markers averages ≤ 4 ms/frame with bounded recomputes and projections`, () => {
      for (const [label, markers, start] of [
        ['dense floor, zoom 20.2', dataset(n, 'floor', 5), view(20.2)],
        ['whole campus, zoom 18.6', dataset(n, 'campus', 6), view(18.6)],
      ] as const) {
        const { neu, legacy } = pan(markers, start, 6);
        expect(neu.avgMs).toBeLessThanOrEqual(4);
        expect(withinBudget(neu, n)).toBe(true);
        // The same budget rejects the legacy pipeline: it re-declutters, re-projects every marker and re-renders on all 61 events.
        expect(legacy.computed).toBe(61); expect(legacy.changed).toBe(61); expect(legacy.projected).toBe(61 * n);
        expect(withinBudget(legacy, n)).toBe(false);
        report.push({ case: `pan 60 frames, ${n} markers (${label})`, legacyAvgMs: +legacy.avgMs.toFixed(3), newAvgMs: +neu.avgMs.toFixed(3),
          legacyDeclutters: legacy.computed, newDeclutters: neu.computed, legacyRerenders: legacy.changed, newRerenders: neu.changed,
          legacyProjectedPerFrame: Math.round(legacy.projected / 61), newProjectedPerFrame: Math.round(neu.projected / 61) });
      }
    });
  }
  it('a jittering map whose layout does not change re-renders nothing', () => {
    const markers = dataset(1000, 'floor', 8);
    const start = view(20.2);
    const scheduler = new DeclutterScheduler();
    scheduler.settle(start); scheduler.setMarkers(markers, true);
    const first = scheduler.placed, changed = scheduler.stats.changed;
    const legacy = new LegacyPipeline(markers, true);
    // ±0.4 px back and forth for 60 frames (finger resting on the map), 50 ms apart so the throttle allows recomputes.
    for (let f = 0; f < 60; f++) {
      const v = { ...start, lng: start.lng + (f % 2 ? 1 : -1) * 2e-9 };
      expect(scheduler.moving(v, (f + 1) * 100)).toBe(first);
      legacy.event(v);
    }
    expect(scheduler.settle(start, 7000)).toBe(first);
    expect(scheduler.stats.changed).toBe(changed);
    expect(legacy.stats.changed).toBe(60);
    report.push({ case: 'jitter 60 frames, 1000 markers', legacyRerenders: legacy.stats.changed, newRerenders: scheduler.stats.changed - changed });
  });
  it('recomputes at once when the zoom stage or the marker list changes, and settles exactly', () => {
    const markers = dataset(500, 'floor', 12);
    const scheduler = new DeclutterScheduler();
    scheduler.settle(view(19.4), 0); scheduler.setMarkers(markers, true);
    expect(scheduler.placed.some((p) => p.label)).toBe(false); // icons stage
    // Crossing into the labels stage is not throttled even 1 ms later.
    const labelled = scheduler.moving(view(19.6), 1);
    expect(labelled.some((p) => p.label)).toBe(true);
    expect(labelled).toEqual(legacyDeclutter(markers, view(19.6), { stage: 'labels' }));
    // Within the throttle a small move is deferred, flush() computes it.
    const moved = view(19.6, { lng: CENTER.lng + 0.00004 });
    expect(scheduler.moving(moved, 20)).toBe(labelled);
    expect(scheduler.pending).toBe(true);
    expect(scheduler.flush(30)).toEqual(legacyDeclutter(markers, moved, { stage: 'labels' }));
    // A new marker list (another floor, a new route) is laid out immediately.
    const other = dataset(500, 'floor', 13);
    expect(scheduler.setMarkers(other, true)).toEqual(legacyDeclutter(other, moved, { stage: 'labels' }));
    // No size yet: nothing is drawn.
    const empty = new DeclutterScheduler(); empty.setMarkers(markers, true);
    expect(empty.settle(view(20, { width: 0 }))).toEqual([]);
  });
  it('prints the before/after table', () => {
    expect(report.length).toBeGreaterThanOrEqual(5);
    console.log(`\nMAP PERF REPORT\n${report.map((row) => JSON.stringify(row)).join('\n')}`);
  });
});
