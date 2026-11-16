"""
실행:  cd tools/elevation && python -m pytest -q test_grid_grading.py

v2 격자 단계(grid_grading): 폭 2 m 회랑 평탄화, 삼각형 아일랜드 Laplace 메우기, 중간 영역, 건물 대지·앞마당·깎기·쌓기 사면.
노드 높이는 손으로 준다. 좌표는 격자 CRS 미터, 격자 왼쪽 위 모서리가 (X0, Y0).
"""
import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from campo_grid import Grid  # noqa: E402
from grid_grading import (  # noqa: E402
    Corridors, Pad, buried_area, grade_grid, pad_ring, rasterize_corridors, rasterize_pads, rasterize_polygon,
    reference_height,
)
from solver_config import SolverConfig, with_overrides  # noqa: E402

X0, Y0 = 203000.0, 552000.0
CFG = SolverConfig()


def make_grid(w, h, fn, res=1.0):
    xs = X0 + (np.arange(w) + 0.5) * res
    ys = Y0 - (np.arange(h) + 0.5) * res
    X, Y = np.meshgrid(xs, ys)
    return Grid(np.asarray(fn(X, Y), float), X0, Y0, res)


def corridors(segs):
    """segs: [((x1, y1), (x2, y2), z1, z2), ...] in metres from (X0, Y0)."""
    xy = np.array([[[X0 + a[0], Y0 + a[1]], [X0 + b[0], Y0 + b[1]]] for a, b, _, _ in segs], float).reshape(-1, 2, 2)
    z = np.array([[za, zb] for _, _, za, zb in segs], float).reshape(-1, 2)
    t = np.tile([0.0, 1.0], (len(segs), 1)).astype(float)
    return Corridors(xy, z, t, np.zeros(len(segs), np.int32), tuple(f"e{i}" for i in range(len(segs))))


def project(grid, a, b):
    """t and distance of every cell centre to segment a-b (the same formula as rasterize_corridors)."""
    xs, ys = grid.cell_centers()
    X, Y = np.meshgrid(xs, ys)
    xi, yi, xj, yj = X0 + a[0], Y0 + a[1], X0 + b[0], Y0 + b[1]
    vx, vy = xj - xi, yj - yi
    t = np.clip(((X - xi) * vx + (Y - yi) * vy) / (vx * vx + vy * vy), 0.0, 1.0)
    return t, np.hypot(X - (xi + t * vx), Y - (yi + t * vy))


# ---------------------------------------------------------------- (a) 폭 2 m 평탄화

def slope_dem(X, Y):
    return 30 + 0.05 * (X - X0) + 0.03 * (Y - Y0)


A, B = (55.2, -50.3), (102.7, -68.9)


def test_flat_segment_is_level_across_its_width():
    g = make_grid(160, 120, slope_dem)
    r = grade_grid(g, corridors([(A, B, 33.0, 33.0)]), [], CFG)
    _, d = project(g, A, B)
    assert np.array_equal(r.road, d <= 1.0)
    assert np.all(r.h[r.road] == 33.0)


def test_sloped_segment_height_depends_only_on_t():
    g = make_grid(160, 120, slope_dem)
    r = grade_grid(g, corridors([(A, B, 31.0, 35.0)]), [], CFG)
    t, d = project(g, A, B)
    assert r.road.sum() > 100
    expect = (1 - t) * 31.0 + t * 35.0
    assert np.max(np.abs(r.h[r.road] - expect[r.road])) < 1e-12


def test_partial_cover_ring_is_soft_not_fixed():
    g = make_grid(160, 120, slope_dem)
    za, zb = slope_dem(X0 + A[0], Y0 + A[1]) + 1.5, slope_dem(X0 + B[0], Y0 + B[1]) + 1.5
    r = grade_grid(g, corridors([(A, B, za, zb)]), [], CFG)
    t, d = project(g, A, B)
    ring = (d > 1.0) & (d <= 1.5)
    assert ring.any()
    assert not np.any(r.road[ring]) and np.all(r.unknown[ring])
    z = (1 - t) * za + t * zb
    assert np.all(np.abs(r.h[ring] - z[ring]) < np.abs(g.data[ring] - z[ring]))


def test_far_cells_keep_the_dem():
    g = make_grid(160, 120, slope_dem)
    r = grade_grid(g, corridors([(A, B, 31.0, 35.0)]), [], CFG)
    _, d = project(g, A, B)
    far = d > 1.5 + 5 * 8 + 1
    assert far.any()
    assert np.all(r.h[far] == g.data[far]) and np.all(r.residual[far] == 0.0)
    assert not np.any(r.unknown[far])


def test_overlapping_segments_take_the_nearest():
    g = make_grid(80, 80, slope_dem)
    s0, s1 = ((20.5, -40.5), (60.5, -40.5)), ((40.5, -20.5), (40.5, -60.5))
    rr = rasterize_corridors(g, corridors([(*s0, 31.0, 31.0), (*s1, 35.0, 35.0)]), CFG.raster)
    _, d0 = project(g, *s0)
    _, d1 = project(g, *s1)
    both = (d0 <= 1.5) & (d1 <= 1.5)
    assert both.sum() > 4
    expect = np.where(d1 < d0, 1, 0)
    assert np.array_equal(rr.seg[both], expect[both])
    assert np.any(both & (d0 == d1))  # exact ties exist and keep the earlier segment
    assert np.all(rr.z[both & (expect == 0)] == 31.0) and np.all(rr.z[both & (expect == 1)] == 35.0)


def test_round_caps_fill_a_bend():
    g = make_grid(80, 80, slope_dem)
    v = (40.0, -40.0)
    r = grade_grid(g, corridors([((10.0, -40.0), v, 32.0, 32.0), (v, (40.0, -10.0), 32.0, 32.0)]), [], CFG)
    xs, ys = g.cell_centers()
    X, Y = np.meshgrid(xs, ys)
    near = np.hypot(X - (X0 + v[0]), Y - (Y0 + v[1])) <= 1.0
    assert near.any() and np.all(r.road[near])


def test_nan_dem_cells_stay_nan():
    def dem(X, Y):
        z = slope_dem(X, Y)
        z[(X > X0 + 70) & (X < X0 + 90) & (Y < Y0 - 50) & (Y > Y0 - 70)] = np.nan
        return z

    g = make_grid(160, 120, dem)
    r = grade_grid(g, corridors([(A, B, 31.0, 35.0)]), [], CFG)
    miss = ~np.isfinite(g.data)
    assert miss.any()
    assert np.all(np.isnan(r.h[miss])) and np.all(r.residual[miss] == 0.0)
    assert np.all(np.isfinite(r.h[~miss]))


def test_half_metre_grid():
    g1 = make_grid(160, 120, slope_dem)
    g2 = make_grid(320, 240, slope_dem, res=0.5)
    r1 = grade_grid(g1, corridors([(A, B, 31.0, 35.0)]), [], CFG)
    r2 = grade_grid(g2, corridors([(A, B, 31.0, 35.0)]), [], CFG)
    t, _ = project(g2, A, B)
    expect = (1 - t) * 31.0 + t * 35.0
    assert np.max(np.abs(r2.h[r2.road] - expect[r2.road])) < 1e-12
    ratio = r2.road.sum() / r1.road.sum()
    assert 3.5 <= ratio <= 4.5, ratio


# ---------------------------------------------------------------- (b) 아일랜드

def wavy_dem(X, Y):
    return 30 + 0.08 * (X - X0) + 0.5 * np.sin((Y - Y0) / 4)


TRI = [(15.0, -15.0), (40.0, -17.0), (26.0, -38.0)]


def triangle(scale=1.0, heights=(32.0, 32.0, 32.0)):
    p = [(x * scale, y * scale) for x, y in TRI]
    return corridors([(p[i], p[(i + 1) % 3], heights[i], heights[(i + 1) % 3]) for i in range(3)])


def test_triangle_island_is_a_plane():
    g = make_grid(60, 60, wavy_dem)
    r = grade_grid(g, triangle(), [], CFG)
    assert r.island.any() and not r.mid.any()
    assert np.ptp(r.h[r.island]) < 1e-9
    assert np.abs(r.h[r.island] - 32.0).max() < 1e-9


def test_island_never_exceeds_its_roads():
    g = make_grid(60, 60, wavy_dem)
    r = grade_grid(g, triangle(heights=(31.0, 32.0, 33.5)), [], CFG)
    assert r.island.any()
    assert r.h[r.island].max() <= r.h[r.road].max() + 1e-9
    assert r.h[r.island].min() >= r.h[r.road].min() - 1e-9


def test_large_enclosure_is_delta_filled():
    g = make_grid(160, 160, wavy_dem)
    c = triangle(scale=3.0)
    r = grade_grid(g, c, [], CFG)
    assert not r.island.any() and r.mid.any()
    rr = rasterize_corridors(g, c, CFG.raster)
    bound = np.concatenate([(r.h - g.data)[r.road], (rr.z - g.data)[rr.ring]])
    dm = (r.h - g.data)[r.mid]
    assert dm.min() >= bound.min() - 1e-4 and dm.max() <= bound.max() + 1e-4


def test_area_max_is_configurable():
    g = make_grid(160, 160, wavy_dem)
    r = grade_grid(g, triangle(scale=3.0), [], with_overrides(CFG, {"island.area_max_m2": 3000}))
    assert r.island.any() and not r.mid.any()


def test_open_region_is_not_an_island():
    g = make_grid(60, 60, wavy_dem)
    u = corridors([((15.0, -15.0), (15.0, -40.0), 32.0, 32.0), ((15.0, -40.0), (40.0, -40.0), 32.0, 32.0),
                   ((40.0, -40.0), (40.0, -15.0), 32.0, 32.0)])
    r = grade_grid(g, u, [], CFG)
    assert not r.island.any() and not r.mid.any()


def test_thin_enclosure_counts_by_radius():
    g = make_grid(110, 40, wavy_dem)
    y1, y2 = -16.0, -24.0  # centre lines 8 m apart: a 6 m strip between the road edges, 88 m long
    c = corridors([((10.0, y1), (100.0, y1), 32.0, 32.0), ((10.0, y2), (100.0, y2), 32.0, 32.0),
                   ((10.0, y1), (10.0, y2), 32.0, 32.0), ((100.0, y1), (100.0, y2), 32.0, 32.0)])
    r = grade_grid(g, c, [], CFG)
    assert r.island.sum() * g.res ** 2 > 400
    assert not r.mid.any()


# ---------------------------------------------------------------- (d) 건물(격자)

def ramp_dem(X, Y):
    return 30 + 0.1 * (X - X0)


def rotated_rect(cx, cy, w, h, deg):
    a = math.radians(deg)
    out = []
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1), (-1, -1)):
        dx, dy = sx * w / 2, sy * h / 2
        out.append((cx + dx * math.cos(a) - dy * math.sin(a), cy + dx * math.sin(a) + dy * math.cos(a)))
    return np.array(out)


RECT = rotated_rect(X0 + 40, Y0 - 40, 20, 12, 20)
H1F = 34.0


def bgrid():
    return make_grid(80, 80, ramp_dem)


def crossing_number(x, y, rings):
    inside = False
    for ring in rings:
        pts = list(map(tuple, ring))
        if len(pts) < 3:
            continue
        for k in range(len(pts)):
            x1, y1 = pts[k]
            x2, y2 = pts[(k + 1) % len(pts)]
            if y1 == y2:
                continue
            if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / (y2 - y1) + x1):
                inside = not inside
    return inside


def test_polygon_raster_matches_point_in_polygon():
    g = bgrid()
    xs, ys = g.cell_centers()
    hole = rotated_rect(X0 + 40, Y0 - 40, 8, 4, 20)
    ell = np.array([[X0 + 10, Y0 - 10], [X0 + 30, Y0 - 10], [X0 + 30, Y0 - 16], [X0 + 16, Y0 - 16], [X0 + 16, Y0 - 30],
                    [X0 + 10, Y0 - 30]])
    for rings in ([RECT], [RECT, hole], [ell]):
        m = rasterize_polygon(g, rings)
        expect = np.array([[crossing_number(x, y, rings) for x in xs] for y in ys])
        assert m.any() and np.array_equal(m, expect)


def building_run(segs=(), h=H1F):
    g = bgrid()
    c = corridors(list(segs)) if segs else Corridors.empty()
    return g, grade_grid(g, c, [Pad("bldg_T", (RECT,), h)], CFG)


def test_pad_is_level_at_h1f():
    _, r = building_run()
    pad = r.pad_id >= 0
    assert pad.sum() > 200
    assert np.all(r.h[pad] == H1F)


def test_apron_is_level_at_h1f():
    from scipy import ndimage
    g, r = building_run()
    delta = ndimage.distance_transform_edt(~(r.pad_id >= 0)) * g.res
    apron = (delta > 0) & (delta <= 1.0)
    assert apron.any() and np.array_equal(apron, r.apron)
    assert np.all(r.h[apron] == H1F)


def test_cut_and_fill_slopes_are_bounded():
    g, r = building_run()
    gy, gx = np.gradient(r.h, g.res)
    mag = np.hypot(gx, gy)
    east = r.unknown & (g.data > H1F)
    west = r.unknown & (g.data < H1F)
    assert east.any() and west.any()
    assert mag[east].max() <= 0.67 + 0.05, mag[east].max()
    assert mag[west].max() <= 0.5 + 0.05, mag[west].max()
    steps = []
    for a, b, ua, ub in ((r.h[:, :-1], r.h[:, 1:], r.unknown[:, :-1], r.unknown[:, 1:]),
                         (r.h[:-1, :], r.h[1:, :], r.unknown[:-1, :], r.unknown[1:, :])):
        steps.append(np.abs(b - a)[ua | ub])
    assert np.concatenate(steps).max() <= 0.72


def test_cut_only_cuts_and_fill_only_fills():
    g, r = building_run()
    cut = r.unknown & (g.data > H1F + 0.5)
    fill = r.unknown & (g.data < H1F - 0.5)
    assert cut.any() and fill.any()
    assert np.all(r.h[cut] <= g.data[cut] + 0.05)
    assert np.all(r.h[fill] >= g.data[fill] - 0.05)


def test_road_wins_over_the_slope():
    # 2 m east of the corner: the road (half width 1 m) meets the 1 m apron, no room for a slope -> vertical step
    x_line = RECT[:, 0].max() - X0 + 2.0
    z = 30 + 0.1 * x_line
    g, r = building_run([((x_line, -10.0), (x_line, -70.0), z, z)])
    rr = rasterize_corridors(g, corridors([((x_line, -10.0), (x_line, -70.0), z, z)]), CFG.raster)
    road = rr.road & ~(r.pad_id >= 0)
    assert np.all(r.h[road] == rr.z[road]) and np.allclose(rr.z[road], z, atol=1e-12)
    assert r.stats["vertical_steps_over_limit"] > 0
    assert any("vertical steps" in line for line in r.log)


def test_pad_beats_road_inside_the_polygon():
    seg = ((40.0, -40.0), (70.0, -40.0), H1F, 37.0)
    g, r = building_run([seg])
    rr = rasterize_corridors(g, corridors([seg]), CFG.raster)
    pad = r.pad_id >= 0
    assert np.all(r.h[pad] == H1F)
    out = rr.road & ~pad
    assert out.any() and np.all(r.h[out] == rr.z[out])


def test_buried_area_is_monotone():
    g = bgrid()
    pad = rasterize_polygon(g, [RECT])
    ring = pad_ring(pad)
    hs = np.arange(32.0, 37.0, 0.1)
    a = [buried_area(g.data, ring, h, g.res) for h in hs]
    assert all(a[k + 1] <= a[k] for k in range(len(a) - 1))
    h0 = 34.0
    assert all(buried_area(g.data, ring, h, g.res) <= buried_area(g.data, ring, h0, g.res) for h in hs if h >= h0)


def test_reference_height_sources():
    g = bgrid()
    pad = rasterize_polygon(g, [RECT])
    ring = pad_ring(pad)
    xs, ys = g.cell_centers()
    rr, cc = np.nonzero(ring)
    ent = np.array([[RECT[:, 0].max(), Y0 - 40]])
    h, src = reference_height(g, pad, ent, CFG.building)
    near = np.hypot(xs[cc] - ent[0, 0], ys[rr] - ent[0, 1]) <= 5.0
    assert src == "entrance_ring" and abs(h - np.median(g.data[rr, cc][near])) < 1e-12
    h, src = reference_height(g, pad, np.zeros((0, 2)), CFG.building)
    assert src == "ring_percentile" and abs(h - np.percentile(g.data[ring], 30)) < 1e-12
    far = np.array([[X0 + 2, Y0 - 2]])
    assert reference_height(g, pad, far, CFG.building)[1] == "ring_percentile"
    g.data[ring] = np.nan
    assert reference_height(g, pad, ent, CFG.building) is None


def test_degenerate_polygons_are_skipped():
    g = bgrid()
    pads = [Pad("empty", (), 34.0), Pad("two", (np.array([[X0 + 5, Y0 - 5], [X0 + 9, Y0 - 9]]),), 34.0),
            Pad("tiny", (np.array([[X0 + 5.05, Y0 - 5.05], [X0 + 5.2, Y0 - 5.05], [X0 + 5.1, Y0 - 5.2]]),), 34.0)]
    pr = rasterize_pads(g, pads)
    assert set(pr.skipped) == {"empty", "two", "tiny"} and not np.any(pr.pad_id >= 0)
    r = grade_grid(g, Corridors.empty(), pads, CFG)
    assert np.array_equal(r.h, g.data)
