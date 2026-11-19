"""
실행:  cd tools/elevation && python -m pytest -q test_road_width.py

길마다 다른 폭(width_m): 솔버 v2는 길의 width_m(없으면 2.0 m)의 반폭으로 회랑을 고정한다(feat/solver-edge-width).
  I1 횡단 기울기 0: 경성 셀 h = (1 - t)·z0 + t·z1 (폭과 무관, 오차 <= 1e-12 m)
  I2 폭 정확도: 경성 폭 = width_m ± 1셀 (하한 min_half_width_cells·res는 유지)
  I3 무회귀: 폭이 하나도 없는 데이터(half_width=None)·NaN 배열·per_edge_width=false는 지금과 비트 동일
  I4 보고 = 실제: solve_report roads[]는 평지 컷 이후 래스터에 쓰인 회랑과 같은 선분·z(1 mm)·폭
겹친 회랑은 부호 거리 d - hw가 작은 쪽(더 깊이 안쪽인 회랑)이 이긴다. 좌표는 격자 CRS 미터, 격자 왼쪽 위 모서리 (X0, Y0).
"""
import dataclasses
import json
import math
import shutil
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import grid_grading as gg  # noqa: E402
from campo_grid import Grid  # noqa: E402
from campo_height_solver import campus_corridors, campus_model, roads_report_rows, solve_report  # noqa: E402
from grid_grading import Corridors, Plaza, grade_grid, rasterize_corridors  # noqa: E402
from solver_config import SolverConfig, validate, with_overrides  # noqa: E402
from test_campus_constraints import feat_edge, feat_node  # noqa: E402
from test_grid_grading import CFG, X0, Y0, corridors, make_grid, project, slope_dem  # noqa: E402

ident = lambda lon, lat: (lon, lat)  # noqa: E731
A, B = (55.2, -50.3), (102.7, -68.9)


def corridors_w(segs, widths):
    """corridors() with a full width per segment (None = no width: NaN). widths None -> half_width None."""
    c = corridors(segs)
    if widths is None:
        return c
    hw = np.array([np.nan if w is None else w / 2.0 for w in widths], float)
    return dataclasses.replace(c, half_width=hw)


def seg_at(angle_deg, length=70.0, centre=(80.0, -60.0)):
    a = math.radians(angle_deg)
    dx, dy = 0.5 * length * math.cos(a), 0.5 * length * math.sin(a)
    return (centre[0] - dx, centre[1] - dy), (centre[0] + dx, centre[1] + dy)


# ---------------------------------------------------------------- I3 무회귀

MANY = [(A, B, 31.0, 35.0), ((20.3, -20.7), (140.1, -100.2), 29.0, 37.0), ((30.2, -90.4), (150.6, -30.1), 33.0, 30.0),
        ((70.1, -10.3), (70.9, -110.2), 32.0, 32.5)]


def test_without_widths_is_bit_identical_to_legacy():
    g = make_grid(160, 120, slope_dem)
    legacy = corridors(MANY)
    assert legacy.half_width is None
    nan = dataclasses.replace(legacy, half_width=np.full(len(MANY), np.nan))
    a, b = grade_grid(g, legacy, [], CFG), grade_grid(g, nan, [], CFG)
    assert np.array_equal(a.h, b.h, equal_nan=True)
    assert np.array_equal(a.road, b.road) and a.stats == b.stats
    ra, rb = rasterize_corridors(g, legacy, CFG.raster), rasterize_corridors(g, nan, CFG.raster)
    for k in ("road", "ring", "seg", "dist"):
        assert np.array_equal(getattr(ra, k), getattr(rb, k)), k
    assert np.array_equal(ra.z, rb.z, equal_nan=True)
    assert ra.half_width_m == rb.half_width_m == 1.0
    # the default width given explicitly is the default (2.0 m everywhere)
    two = corridors_w(MANY, [2.0] * len(MANY))
    assert np.array_equal(grade_grid(g, two, [], CFG).h, a.h, equal_nan=True)


def test_per_edge_width_false_reads_no_width():
    feats, heights = _line_campus({"e1": 6.0, "e2": None})
    cm = campus_model(feats, ident)
    off = with_overrides(CFG, {"raster.per_edge_width": False})
    assert campus_corridors(feats, cm, ident, heights, raster_cfg=off.raster).half_width is None
    on = campus_corridors(feats, cm, ident, heights, raster_cfg=CFG.raster)
    assert on.half_width is not None
    # no width anywhere: None (the legacy path), even with per_edge_width on
    feats0, heights0 = _line_campus({"e1": None, "e2": None})
    assert campus_corridors(feats0, campus_model(feats0, ident), ident, heights0, raster_cfg=CFG.raster).half_width is None


def test_default_width_is_two_metres():
    g = make_grid(160, 120, slope_dem)
    _, d = project(g, A, B)
    for c in (corridors([(A, B, 33.0, 33.0)]), corridors_w([(A, B, 33.0, 33.0)], [None])):
        assert np.array_equal(rasterize_corridors(g, c, CFG.raster).road, d <= 1.0)


# ---------------------------------------------------------------- I2 폭 정확도

@pytest.mark.parametrize("w", [1.0, 2.0, 4.0, 6.0])
def test_per_edge_width_sets_the_hard_band(w):
    g = make_grid(160, 120, slope_dem)
    _, d = project(g, A, B)
    r = grade_grid(g, corridors_w([(A, B, 33.0, 33.0)], [w]), [], CFG)
    hw = max(w / 2.0, CFG.raster.min_half_width_cells * 1.0)
    assert np.array_equal(r.road, d <= hw)
    assert np.all(r.h[r.road] == 33.0)
    rr = rasterize_corridors(g, corridors_w([(A, B, 33.0, 33.0)], [w]), CFG.raster)
    assert np.array_equal(rr.ring, (d > hw) & (d <= hw + CFG.raster.soft_ring_m))
    # dist stays the distance to the winning segment (the soft ring weight reads it), inf where no segment reached
    reached = rr.seg >= 0
    assert np.all(np.isinf(rr.dist[~reached])) and np.allclose(rr.dist[reached], d[reached], rtol=0, atol=1e-5)
    if rr.half_width_map is not None:
        assert np.all(rr.half_width_map[reached] == np.float32(hw))


@pytest.mark.parametrize("w", [2.0, 3.0, 4.0])
@pytest.mark.parametrize("angle", [0.0, 45.0])
def test_measured_width_is_within_one_cell(w, angle):
    res = 1.0
    g = make_grid(160, 120, slope_dem, res)
    a, b = seg_at(angle)
    road = grade_grid(g, corridors_w([(a, b, 33.0, 33.0)], [w]), [], CFG).road
    t, d = project(g, a, b)
    # cells on the line through the middle of the segment, across its axis (spacing res at 0 deg, res*sqrt2 at 45 deg)
    cx, cy = 0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1])
    col, row = int(math.floor(cx / res)), int(math.floor(-cy / res))
    if angle == 0.0:
        line = [road[row + k, col] for k in range(-20, 21)]
        step = res
    else:
        line = [road[row + k, col + k] for k in range(-20, 21)]
        step = res * math.sqrt(2.0)
    n = int(np.sum(line))
    assert abs(n * step - w) <= step + 1e-9, (n, step, w)
    # area over the middle half of the segment / its length: the mean hard width, within one cell
    mid = (t > 0.25) & (t < 0.75)
    width = float((road & mid).sum()) * res * res / (0.5 * 70.0)
    assert abs(width - w) <= res + 1e-9, width


# ---------------------------------------------------------------- I1 횡단 기울기 0

@pytest.mark.parametrize("w", [1.0, 2.0, 3.5])
@pytest.mark.parametrize("angle", [0.0, 30.0, 45.0, 90.0, 135.0])
def test_cross_section_is_level_for_any_width_and_angle(w, angle):
    g = make_grid(160, 120, slope_dem)
    a, b = seg_at(angle, length=60.0)
    r = grade_grid(g, corridors_w([(a, b, 31.0, 35.0)], [w]), [], CFG)
    t, _ = project(g, a, b)
    assert r.road.sum() > 50
    expect = (1 - t) * 31.0 + t * 35.0
    assert np.max(np.abs(r.h[r.road] - expect[r.road])) < 1e-12


# ---------------------------------------------------------------- 겹침: 부호 거리

def test_wider_corridor_wins_the_overlap():
    g = make_grid(160, 120, slope_dem)
    P0, NA, WB = (40.0, -60.0), (120.0, -70.0), (120.0, -60.0)  # the 2 m one first: ties would keep it
    c = corridors_w([(P0, NA, 30.0, 30.0), (P0, WB, 40.0, 40.0)], [2.0, 6.0])
    r = grade_grid(g, c, [], CFG)
    at = lambda v, z: v.size > 0 and np.max(np.abs(v - z)) < 1e-9  # noqa: E731  ((1 - t) z + t z is z to 1 ulp)
    _, dA = project(g, P0, NA)
    _, dB = project(g, P0, WB)
    in6, in2 = dB <= 3.0, dA <= 1.0
    sdA, sdB = dA - 1.0, dB - 3.0
    # the rule: the corridor the cell is deeper inside wins (ties: the earlier segment)
    win_b = sdB < sdA
    assert at(r.h[(in6 | in2) & win_b], 40.0) and at(r.h[(in6 | in2) & ~win_b], 30.0)
    # the wide corridor keeps its whole band against the narrow road beside it ...
    assert at(r.h[in6 & ~in2], 40.0)
    # ... and the cells of the narrow road that the nearest axis rule would give it (dA < dB) inside the wide band
    took = in6 & in2 & (dA < dB) & win_b
    assert took.sum() > 10 and at(r.h[took], 40.0)
    # outside the wide band the narrow road keeps its own height
    assert (in2 & ~in6).sum() > 20 and at(r.h[in2 & ~in6], 30.0)
    assert np.array_equal(r.road, in6 | in2)


# ---------------------------------------------------------------- campus_corridors: 폭 읽기·클램프

def _line_campus(widths):
    """Three outdoor nodes on a line, edges e1 (a-b) and e2 (b-c) with the given width_m (None = no key)."""
    feats = [feat_node("n_a", X0 + 10, Y0 - 50), feat_node("n_b", X0 + 50, Y0 - 50), feat_node("n_c", X0 + 90, Y0 - 50)]
    for eid, (a, b) in (("e1", ("n_a", "n_b")), ("e2", ("n_b", "n_c"))):
        w = widths.get(eid)
        feats.append(feat_edge(eid, a, b, **({} if w is None else {"width_m": w})))
    return feats, {"cn:n_a": 30.0, "cn:n_b": 31.0, "cn:n_c": 32.0}


def test_width_is_clamped_and_logged():
    feats, heights = _line_campus({"e1": 0.2, "e2": 50})
    log = []
    c = campus_corridors(feats, campus_model(feats, ident), ident, heights, raster_cfg=CFG.raster, log=log)
    hw = dict(zip(c.edge_ids, c.half_width))
    assert hw["e1"] == 0.25 and hw["e2"] == 10.0
    assert any("e1" in line and "clamped" in line for line in log)
    assert any("e2" in line and "clamped" in line for line in log)
    # in range: half of it, no log; missing: NaN (the default half width)
    feats, heights = _line_campus({"e1": 3.5, "e2": None})
    log = []
    c = campus_corridors(feats, campus_model(feats, ident), ident, heights, raster_cfg=CFG.raster, log=log)
    hw = dict(zip(c.edge_ids, c.half_width))
    assert hw["e1"] == 1.75 and math.isnan(hw["e2"]) and log == []
    assert c.half_width.dtype == np.float64 and len(c.half_width) == len(c.edge_ids)


def test_width_config_is_validated():
    assert validate(CFG) == []
    bad = with_overrides(CFG, {"raster.width_min_m": 5.0, "raster.width_max_m": 2.0})
    assert any("width_max_m" in m for m in validate(bad))
    assert any("width_min_m" in m for m in validate(with_overrides(CFG, {"raster.width_min_m": 0.0})))
    assert CFG.raster.per_edge_width is True and CFG.raster.width_min_m == 0.5 and CFG.raster.width_max_m == 20.0


# ---------------------------------------------------------------- 평지 컷: 반폭 유지

SQUARE = np.array([[X0 + 40.3, Y0 - 40.3], [X0 + 80.3, Y0 - 40.3], [X0 + 80.3, Y0 - 80.3], [X0 + 40.3, Y0 - 80.3],
                   [X0 + 40.3, Y0 - 40.3]])


def test_clip_keeps_half_width_per_piece():
    plaza = Plaza("p", (SQUARE,))
    seg = [((10.3, -60.3), (110.3, -60.3), 40.0, 50.0), ((10.3, -20.3), (110.3, -20.3), 40.0, 40.0)]
    cut = gg.clip_corridors_to_plazas(corridors_w(seg, [4.0, None]), [plaza], [45.0])
    assert cut.edge_ids == ("e0", "e0", "e1")
    assert cut.half_width[0] == 2.0 and cut.half_width[1] == 2.0 and math.isnan(cut.half_width[2])
    assert gg.clip_corridors_to_plazas(corridors(seg), [plaza], [45.0]).half_width is None


# ---------------------------------------------------------------- I4 보고 = 실제

def _stub_w():
    return SimpleNamespace(buildings={}, stairs={}, ramps_capped=[], outliers=[])


def test_report_roads_rows():
    g = make_grid(160, 120, slope_dem)
    seg = [((10.3, -60.3), (110.3, -60.3), 40.0, 50.0), ((10.3, -20.3), (110.3, -20.3), 40.0, 40.0)]
    r = grade_grid(g, corridors_w(seg, [4.0, None]), [], CFG, plazas=(Plaza("p", (SQUARE,), h=45.0, h_source="fixed"),))
    fin = r.corridors_final
    assert fin is not None and fin.edge_ids == ("e0", "e0", "e1")
    rep = solve_report(CFG, _stub_w(), r, {}, "t", {})
    rows = rep["roads"]
    assert [row["id"] for row in rows] == ["e0", "e1"]
    assert rows[0]["width_m"] == 4.0 and rows[1]["width_m"] == 2.0
    assert sum(len(row["segments"]) for row in rows) == len(fin.edge_ids)
    flat = [s for row in rows for s in row["segments"]]
    for s, xy, z in zip(flat, fin.xy, fin.z):
        assert len(s) == 6
        assert abs(s[0] - xy[0, 0]) <= 5e-4 and abs(s[1] - xy[0, 1]) <= 5e-4 and abs(s[2] - z[0]) <= 5e-4
        assert abs(s[3] - xy[1, 0]) <= 5e-4 and abs(s[4] - xy[1, 1]) <= 5e-4 and abs(s[5] - z[1]) <= 5e-4
    assert flat[0][5] == 45.0 and flat[1][2] == 45.0  # the pieces meet the plaza at H
    # the corridors the raster used: rasterising corridors_final gives the road cells of the result
    assert np.array_equal(rasterize_corridors(g, fin, CFG.raster).road, r.road)
    json.dumps(rep)  # JSON numbers only
    # no plaza: the input itself; no corridors: no roads key
    r2 = grade_grid(g, corridors_w(seg, [4.0, None]), [], CFG)
    assert r2.corridors_final.edge_ids == ("e0", "e1")
    assert roads_report_rows(r2, CFG.raster)[0]["segments"] == [[203010.3, 551939.7, 40.0, 203110.3, 551939.7, 50.0]]
    assert "roads" not in solve_report(CFG, _stub_w(), grade_grid(g, Corridors.empty(), [], CFG), {}, "t", {})
    # without widths (legacy data): every road at 2 * raster.half_width_m
    r3 = grade_grid(g, corridors(seg), [], CFG)
    assert [row["width_m"] for row in roads_report_rows(r3, CFG.raster)] == [2.0, 2.0]


# ---------------------------------------------------------------- CLI 끝에서 끝까지

def test_cli_v2_width_end_to_end(tmp_path):
    from test_plaza import _scene
    from test_solver_v2_cli import cli, transforms

    camp = _scene(tmp_path)
    p = camp / "outdoor.geojson"
    fc = json.loads(p.read_text(encoding="utf-8"))
    for f in fc["features"]:
        if f["id"] == "e_out_w__e":
            f["properties"]["width_m"] = 4
    p.write_text(json.dumps(fc), encoding="utf-8")
    o = tmp_path / "o"
    cli("--engine", "v2", "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp, "--out", o)
    rep = json.loads((o / "solve_report.json").read_text(encoding="utf-8"))
    rows = {r["id"]: r for r in rep["roads"]}
    assert rows["e_out_w__e"]["width_m"] == 4.0 and rows["e_out_e__b"]["width_m"] == 2.0
    assert rep["config"]["raster"]["per_edge_width"] is True
    # the hard band across the 4 m road: the cells whose height is the corridor height there
    c = Grid.load(o / "corrected_dem.json")
    segs = rows["e_out_w__e"]["segments"]
    s = max(segs, key=lambda q: math.hypot(q[3] - q[0], q[4] - q[1]))
    x0, y0, z0, x1, y1, z1 = s
    L = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    xs, ys = c.cell_centers()
    X, Y = np.meshgrid(xs, ys)
    t = ((X - x0) * ux + (Y - y0) * uy) / L
    d = np.abs((X - x0) * uy - (Y - y0) * ux)
    target = (1 - t) * z0 + t * z1
    mid = (t > 0.3) & (t < 0.7) & (d <= 6.0)
    hard = mid & (np.abs(c.data - target) <= 2e-3)  # the reported z is rounded to 1 mm
    width = float(hard.sum()) * c.res * c.res / (0.4 * L)
    assert abs(width - 4.0) <= c.res + 1e-9, width
    # the same scene without the width: 2 m
    o2 = tmp_path / "o2"
    cli("--engine", "v2", "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp, "--out", o2,
        "--set", "raster.per_edge_width=false")
    rep2 = json.loads((o2 / "solve_report.json").read_text(encoding="utf-8"))
    assert {r["id"]: r for r in rep2["roads"]}["e_out_w__e"]["width_m"] == 2.0
