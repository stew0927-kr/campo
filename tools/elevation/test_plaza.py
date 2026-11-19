"""
실행:  cd tools/elevation && python -m pytest -q test_plaza.py

평지(plaza): 그린 외곽선 안의 고체 셀을 한 높이 H로 고정(변수 소거)한다. 평지 안은 기울기 0·곡률 0·h == H가 비트 단위로
정확하고, 구멍은 평평해지지 않고 DEM을 따르며, 건물 대지가 평지보다 먼저이고, 평지를 가로지르는 회랑은 평지 경계에서 H로
시작한다. H는 fixed_height_m > 평지 위 노드의 WLS 값 > 평지 셀 DEM₀ 중앙값(경계 침식) 순서로 정한다.
좌표는 격자 CRS 미터(project = 항등). 평지 꼭짓점은 셀 중심과 겹치지 않는 비정수로 잡는다.
"""
import json
import math
import shutil
import sys
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import grid_grading as gg  # noqa: E402
from campo_grid import Grid  # noqa: E402
from grid_grading import Corridors, Pad, Plaza, grade_grid  # noqa: E402
from solver_config import SolverConfig, with_overrides  # noqa: E402
from test_campus_constraints import X0, Y0  # noqa: E402
from test_portal_pads import CFG, make_grid  # noqa: E402
from test_solver_v2_cli import EMPTY_STORE, REPO, cli, transforms  # noqa: E402

RES = 2.0
N = 61


def P(u, v):
    """u m east and v m south of the top-left corner."""
    return (X0 + u, Y0 - v)


def ring(u0, v0, u1, v1):
    return np.array([P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), P(u0, v0)], float)


def noisy_slope(X, Y):
    rng = np.random.default_rng(7)
    return 50.0 + 0.25 * (X - X0) + 0.1 * (Y - Y0) + 0.4 * rng.standard_normal(X.shape)


def grid_of(fn=noisy_slope):
    return make_grid(X0, Y0, N, N, fn, res=RES)


def run(grid, plazas=(), corridors=None, pads=(), cfg=CFG, **kw):
    return grade_grid(grid, corridors if corridors is not None else Corridors.empty(), list(pads), cfg, plazas=tuple(plazas), **kw)


def cells_of(grid, rings):
    return gg.rasterize_polygon(grid, rings)


SQUARE = ring(30.3, 30.3, 90.7, 90.7)  # 60 x 60 m
HOLE = ring(50.3, 50.3, 70.7, 70.7)  # 20 x 20 m


# ---------------------------------------------------------------- 1. 평평함

def test_plaza_cells_are_exactly_h_with_zero_slope_and_curvature():
    grid = grid_of()
    g = run(grid, [Plaza("p", (SQUARE,), h=60.0, h_source="fixed")])
    m = cells_of(grid, [SQUARE])
    assert m.sum() > 500
    assert np.array_equal(g.h[m], np.full(m.sum(), 60.0))
    rows, cols = np.nonzero(m)
    sub = g.h[rows.min():rows.max() + 1, cols.min():cols.max() + 1]
    assert np.all(np.diff(sub, axis=0) == 0) and np.all(np.diff(sub, axis=1) == 0)
    assert np.all(np.diff(sub, n=2, axis=0) == 0) and np.all(np.diff(sub, n=2, axis=1) == 0)
    assert np.array_equal(g.plaza_id >= 0, m)
    assert g.stats["plazas"] == 1 and g.stats["plaza_cells"] == m.sum()


def test_a_hole_is_not_flattened_and_is_no_island():
    grid = grid_of()
    g = run(grid, [Plaza("p", (SQUARE, HOLE), h=60.0, h_source="fixed")])
    outer = cells_of(grid, [SQUARE])
    solid = cells_of(grid, [SQUARE, HOLE])
    hole = outer & ~solid
    assert hole.sum() > 50
    assert np.all(g.h[solid] == 60.0)
    assert not g.island[hole].any() and not g.mid[hole].any()
    # the hole keeps a shape of its own (outside the plaza collar: its 1 cell rim is held at H, plaza.collar_cells)
    assert np.mean(g.h[hole & ~g.plaza_collar] == 60.0) < 0.05
    # the shoulder pulls the hole towards H near its edge only: the centre stays close to the DEM
    centre = (slice(28, 33), slice(28, 33))
    assert hole[centre].all()
    assert np.median(np.abs(g.h[centre] - grid.data[centre])) < np.median(np.abs(60.0 - grid.data[centre]))
    # without keep_free the same hole would be an island and filled smoothly (the old behaviour for closed rings)
    island, _ = gg.find_islands(g.plaza_id >= 0, np.isfinite(grid.data), RES, CFG.island)
    assert island[hole].all()


# ---------------------------------------------------------------- 2. H 규칙

def test_h_rule_fixed_then_given_then_dem_reference_with_erosion():
    grid = grid_of()
    m = cells_of(grid, [SQUARE])
    fixed = run(grid, [Plaza("p", (SQUARE,), h=61.25, h_source="fixed")])
    assert fixed.plaza_report[0]["h_m"] == 61.25 and fixed.plaza_report[0]["h_source"] == "fixed"
    wls = run(grid, [Plaza("p", (SQUARE,), h=58.5, h_source="wls")])
    assert wls.plaza_report[0]["h_source"] == "wls" and np.all(wls.h[m] == 58.5)
    auto = run(grid, [Plaza("p", (SQUARE,))])
    from scipy import ndimage
    inner = ndimage.binary_erosion(m, structure=gg._CROSS, iterations=1)
    want = float(np.percentile(grid.data[inner], 50.0))
    assert auto.plaza_report[0]["h_source"] == "dem_median" and auto.plaza_report[0]["h_m"] == pytest.approx(want, abs=0)
    assert np.all(auto.h[m] == want)
    # the reference without erosion differs on a slope with noise: the edge cells are not read
    assert want != float(np.percentile(grid.data[m], 50.0))
    p40 = run(grid, [Plaza("p", (SQUARE,))], cfg=with_overrides(CFG, {"plaza.ref_percentile": 40}))
    assert p40.plaza_report[0]["h_m"] == pytest.approx(float(np.percentile(grid.data[inner], 40.0)))


def test_relief_over_the_limit_is_logged():
    grid = grid_of()
    g = run(grid, [Plaza("p", (SQUARE,))], cfg=with_overrides(CFG, {"plaza.relief_warn_m": 1.0}))
    assert any("plaza p: DEM relief" in line for line in g.log)


# ---------------------------------------------------------------- 3. 경계 연속성

def test_ground_around_the_plaza_eases_back_to_the_dem():
    grid = grid_of(lambda X, Y: 50.0 + 0.0 * X)
    small = ring(50.3, 50.3, 70.7, 70.7)
    g = run(grid, [Plaza("p", (small,), h=53.0, h_source="fixed")])
    m = cells_of(grid, [small])
    assert np.all(g.h[m] == 53.0)
    edt = ndimage_edt(~(m | g.plaza_collar)) * RES  # measured from the collar out: its 1 cell ring is held at H too
    lift = g.h - 50.0
    rings_ = [lift[(edt > d - 1) & (edt <= d + 1)] for d in (2, 6, 10, 20)]
    means = [float(np.mean(r)) for r in rings_]
    assert means[0] > means[1] > means[2] > means[3] >= -1e-9
    assert means[3] < 0.1 * 3.0  # under a tenth of the 3 m lift 20 m out
    gy, gx = np.gradient(g.h, RES)
    slope = np.hypot(gx, gy)[(edt > 1.5) & (edt < 20)]
    assert slope.max() <= CFG.shoulder.side_slope * 1.5


def ndimage_edt(mask):
    from scipy import ndimage
    return ndimage.distance_transform_edt(mask)


# ---------------------------------------------------------------- 4. 우선순위

def test_building_pad_wins_over_the_plaza_and_is_reported():
    grid = grid_of()
    pad_ring = ring(40.3, 40.3, 50.7, 50.7)
    g = run(grid, [Plaza("p", (SQUARE,), h=60.0, h_source="fixed")], pads=[Pad("bldg_x", (pad_ring,), 64.0)])
    pad = g.pad_id >= 0
    solid = cells_of(grid, [SQUARE])
    assert pad.any() and np.all(g.h[pad] == 64.0)
    assert np.all(g.h[solid & ~pad] == 60.0)
    assert not (g.plaza_id[pad] >= 0).any()
    assert g.plaza_report[0]["overlap_pad_cells"] == int((solid & pad).sum())
    assert any("under building pads keep the pad height" in line for line in g.log)


def test_a_drop_wall_does_not_pin_plaza_cells():
    grid = grid_of()
    w = gg.DropWall("w", np.array([P(20.3, 60.3), P(100.3, 60.3)], float), "left", 2.0)
    g = run(grid, [Plaza("p", (SQUARE,), h=60.0, h_source="fixed")], drop_walls=(w,))
    assert np.all(g.h[cells_of(grid, [SQUARE])] == 60.0)


# ---------------------------------------------------------------- 5. 회랑 자르기

def test_corridors_are_cut_at_the_plaza_and_start_at_h():
    xy = np.array([[P(10.3, 60.3), P(110.3, 60.3)]], float)
    c = Corridors(xy, np.array([[40.0, 50.0]]), np.array([[0.0, 1.0]]), np.zeros(1, np.int32), ("e",))
    plaza = Plaza("p", (SQUARE,))
    cut = gg.clip_corridors_to_plazas(c, [plaza], [45.0])
    assert cut.edge_ids == ("e", "e")
    # west piece: 10.3 -> 30.3, its far end keeps 40 and its plaza end is H; east piece: 90.7 -> 110.3
    assert np.allclose(cut.xy[0], [P(10.3, 60.3), P(30.3, 60.3)]) and np.allclose(cut.z[0], [40.0, 45.0])
    assert np.allclose(cut.xy[1], [P(90.7, 60.3), P(110.3, 60.3)]) and np.allclose(cut.z[1], [45.0, 50.0])
    assert np.allclose(cut.t_range, [[0.0, 0.2], [0.804, 1.0]])
    # a hole: the stretch over the hole stays, at H at both ends
    holed = gg.clip_corridors_to_plazas(c, [Plaza("p", (SQUARE, HOLE))], [45.0])
    assert len(holed.edge_ids) == 3 and np.allclose(holed.z[1], [45.0, 45.0])
    # wholly inside: gone; wholly outside: unchanged
    inside = Corridors(np.array([[P(40.3, 40.3), P(45.3, 45.3)]], float), np.array([[1.0, 2.0]]), np.array([[0.0, 1.0]]),
                       np.zeros(1, np.int32), ("in",))
    assert gg.clip_corridors_to_plazas(inside, [plaza], [45.0]).edge_ids == ()
    away = Corridors(np.array([[P(1.3, 1.3), P(5.3, 5.3)]], float), np.array([[1.0, 2.0]]), np.array([[0.0, 1.0]]),
                     np.zeros(1, np.int32), ("out",))
    same = gg.clip_corridors_to_plazas(away, [plaza], [45.0])
    assert np.array_equal(same.xy, away.xy) and np.array_equal(same.z, away.z)


def test_a_corridor_across_the_plaza_meets_it_without_a_step():
    grid = grid_of(lambda X, Y: 50.0 + 0.1 * (X - X0))
    dem = lambda u, v: 50.0 + 0.1 * u  # noqa: E731
    xy = np.array([[P(5.3, 60.3), P(115.3, 60.3)]], float)
    H = 56.0  # DEM at the plaza centre (u = 60.5)
    c = Corridors(xy, np.array([[dem(5.3, 0) + 0.2, dem(115.3, 0) + 0.2]]), np.array([[0.0, 1.0]]), np.zeros(1, np.int32), ("e",))
    g = run(grid, [Plaza("p", (SQUARE,), h=H, h_source="wls")], corridors=c)
    m = cells_of(grid, [SQUARE])
    assert np.all(g.h[m] == H)
    road = g.road & ~m
    assert road.any()
    # where road cells touch plaza cells the height step is within step_max_m
    for axis in (0, 1):
        a = np.moveaxis(road, axis, 0)
        b = np.moveaxis(m, axis, 0)
        h = np.moveaxis(g.h, axis, 0)
        pairs = (a[:-1] & b[1:]) | (b[:-1] & a[1:])
        steps = np.abs(h[:-1] - h[1:])[pairs]
        if steps.size:
            assert steps.max() <= CFG.building.step_max_m
    assert g.stats["road_cells"] > 0


# ---------------------------------------------------------------- 6. 양자화, 보고서, 건너뜀

def test_uint16_round_trip_keeps_one_value_on_the_plaza(tmp_path):
    grid = grid_of()
    g = run(grid, [Plaza("p", (SQUARE, HOLE), h=60.004, h_source="fixed")])
    Grid(g.h, grid.origin_x, grid.origin_y, grid.res, grid.crs, grid.vertical_datum).save(tmp_path / "q", dtype="uint16")
    q = Grid.load(tmp_path / "q.json").data
    solid = g.plaza_id >= 0
    assert len(np.unique(q[solid])) == 1


def test_report_keys_bbox_and_flat_error_and_small_plazas_are_skipped():
    grid = grid_of()
    tiny = ring(2.3, 2.3, 3.7, 3.7)  # one cell centre inside
    g = run(grid, [Plaza("p", (SQUARE, HOLE), h=60.0, h_source="fixed", name="광장"), Plaza("t", (tiny,))])
    assert [r["id"] for r in g.plaza_report] == ["p"]
    r = g.plaza_report[0]
    for k in ("id", "name", "h_m", "h_source", "cells", "hole_cells", "area_m2", "cut_m3", "fill_m3", "max_cut_m", "max_fill_m",
              "flat_error_m", "nodes", "overlap_pad_cells", "bbox_xy"):
        assert k in r, k
    assert r["flat_error_m"] == 0.0 and r["name"] == "광장"
    assert r["bbox_xy"] == [P(30.3, 90.7)[0], P(30.3, 90.7)[1], P(90.7, 30.3)[0], P(90.7, 30.3)[1]]
    assert r["area_m2"] == r["cells"] * RES * RES and r["hole_cells"] > 0
    assert r["cut_m3"] > 0 and r["fill_m3"] > 0
    assert any(line.startswith("plaza t: 1 cell(s) < min_cells") for line in g.log)


def test_without_plazas_grade_grid_is_unchanged():
    grid = grid_of()
    a = grade_grid(grid, Corridors.empty(), [], CFG)
    b = run(grid, [])
    assert np.array_equal(a.h, b.h, equal_nan=True) and a.stats == b.stats and a.plaza_id is None and b.plaza_report == []
    assert "plazas" not in a.stats


# ---------------------------------------------------------------- 7. CLI: v2 보고서·노드 높이, v1 경고

def _scene(tmp_path, drop_fixed=False):
    to_grid, _ = transforms()
    gx, gy = to_grid.transform(127.0, 37.0)
    xs = gx - 100 + (np.arange(300) + 0.5)
    ys = gy + 200 - (np.arange(300) + 0.5)
    X, Y = np.meshgrid(xs, ys)
    Grid(30.0 + 0.02 * (Y - gy) + 0.01 * (X - gx), gx - 100, gy + 200, 1.0).save(tmp_path / "dem")
    (tmp_path / "store.json").write_text(json.dumps(EMPTY_STORE), encoding="utf-8")
    camp = tmp_path / "campus"
    shutil.copytree(REPO / "packages" / "core" / "test" / "fixtures" / "campus-plaza", camp)
    if drop_fixed:
        p = camp / "outdoor.geojson"
        fc = json.loads(p.read_text(encoding="utf-8"))
        for f in fc["features"]:
            f["properties"].pop("fixed_height_m", None)
        p.write_text(json.dumps(fc), encoding="utf-8")
    return camp


def test_cli_v2_plaza_report_and_node_heights(tmp_path):
    camp = _scene(tmp_path)
    o = tmp_path / "o"
    cli("--engine", "v2", "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp, "--out", o,
        "--derived-out", o / "elevation.json")
    rep = json.loads((o / "solve_report.json").read_text(encoding="utf-8"))
    rows = {r["id"]: r for r in rep["plazas"]}
    assert set(rows) == {"plaza_ring", "plaza_lawn"}
    ring_, lawn = rows["plaza_ring"], rows["plaza_lawn"]
    assert ring_["h_source"] == "fixed" and ring_["h_m"] == 42.5 and ring_["nodes"] == 1 and ring_["hole_cells"] > 0
    assert lawn["h_source"] == "wls" and lawn["nodes"] == 1
    assert ring_["flat_error_m"] == 0 and lawn["flat_error_m"] == 0
    assert len(ring_["bbox_xy"]) == 4 and ring_["bbox_xy"][0] < ring_["bbox_xy"][2]
    assert rep["grid"]["plazas"] == 2 and rep["config"]["plaza"]["node_tol_m"] == 0.1
    d = json.loads((o / "elevation.json").read_text(encoding="utf-8"))
    assert d["nodes"]["n_out_in"]["z_m"] == pytest.approx(42.5, abs=2e-3)  # the fixed prior has sigma 1 mm
    assert d["nodes"]["n_out_b"]["z_m"] == pytest.approx(lawn["h_m"], abs=1e-3)
    c = Grid.load(o / "corrected_dem.json")
    to_grid, _ = transforms()
    x, y = to_grid.transform(127.00007, 37.00004)  # inside plaza_ring's solid area, south-west of the hole
    assert float(c.sample_bilinear(x, y)[0]) == pytest.approx(42.5, abs=1e-5)


def test_cli_v2_plaza_without_fixed_height_takes_the_wls_value(tmp_path):
    camp = _scene(tmp_path, drop_fixed=True)
    o = tmp_path / "o"
    cli("--engine", "v2", "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp, "--out", o,
        "--derived-out", o / "elevation.json")
    rep = json.loads((o / "solve_report.json").read_text(encoding="utf-8"))
    ring_ = next(r for r in rep["plazas"] if r["id"] == "plaza_ring")
    assert ring_["h_source"] == "wls"
    d = json.loads((o / "elevation.json").read_text(encoding="utf-8"))
    assert d["nodes"]["n_out_in"]["z_m"] == pytest.approx(ring_["h_m"], abs=1e-3)


def test_cli_v1_with_plazas_warns_and_goes_on(tmp_path):
    camp = _scene(tmp_path)
    o = tmp_path / "o1"
    r = cli("--engine", "v1", "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp, "--out", o)
    assert "평지는 높이 솔버 v2에서만 반영됩니다(--engine v2)" in r.stdout
    s = json.loads((o / "store.solved.json").read_text(encoding="utf-8"))
    assert s["lastSolve"]["warnings"] == ["평지는 높이 솔버 v2에서만 반영됩니다(--engine v2)"]
    assert (o / "corrected_dem.json").exists()


def test_no_plaza_report_key_without_plazas(tmp_path):
    from test_solver_v2_cli import basic_scene
    camp = basic_scene(tmp_path)
    o = tmp_path / "o"
    cli("--engine", "v2", "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp, "--out", o)
    rep = json.loads((o / "solve_report.json").read_text(encoding="utf-8"))
    assert "plazas" not in rep and "plazas" not in rep["grid"]
    assert math.isfinite(rep["grid"]["max_abs_residual_m"])


# ---------------------------------------------------------------- 8. 평지 경계 콜러(collar)
# collar_cells = k: 평지 고체 셀(중심 규칙)을 8방향으로 k번 넓힌 셀 중 건물 대지·길 경성 셀·다른 평지 고체 셀이 아닌 것을 H로
# 고정한다. 평지 위 점을 둘러싼 격자 사각형(네 셀 중심)의 네 꼭짓점이 모두 H가 되어, 쌍선형으로 읽는 소비자에게도 평지가
# 경계까지 평평하다. collar_cells = 0은 콜러 도입 전과 비트 동일(golden/grade_grid_plaza_legacy.npz).

PLAZA_GOLDEN = HERE / "golden" / "grade_grid_plaza_legacy.npz"
EIGHT = np.ones((3, 3), bool)


def collar_cfg(k):
    return with_overrides(CFG, {"plaza.collar_cells": k})


def dilate8(mask, k=1):
    from scipy import ndimage
    return ndimage.binary_dilation(mask, structure=EIGHT, iterations=k)


def crossing_road(grid, v=60.3):
    dem = lambda u: float(grid.sample_bilinear(*P(u, v))[0])  # noqa: E731
    xy = np.array([[P(5.3, v), P(115.3, v)]], float)
    return Corridors(xy, np.array([[dem(5.3) + 0.2, dem(115.3) + 0.2]]), np.array([[0.0, 1.0]]), np.zeros(1, np.int32), ("e",))


def plaza_golden_scene():
    """A holed plaza at 60 m, a DEM-median plaza 1.6 m east of it, a pad over the plaza edge and a road across both."""
    grid = grid_of()
    plazas = [Plaza("p", (SQUARE, HOLE), h=60.0, h_source="fixed"), Plaza("q", (ring(92.3, 30.3, 110.7, 50.7),))]
    pads = [Pad("bldg_x", (ring(40.3, 20.3, 50.7, 35.7),), 64.0)]
    return grid, plazas, pads, crossing_road(grid)


def write_plaza_golden():  # pragma: no cover (run once with the grade_grid from before the plaza collar)
    grid, plazas, pads, road = plaza_golden_scene()
    g = run(grid, plazas, corridors=road, pads=pads)
    import scipy
    np.savez_compressed(PLAZA_GOLDEN, h=g.h, residual=g.residual, plaza_id=g.plaza_id, stats=json.dumps(g.stats),
                        log=json.dumps(g.log), report=json.dumps(g.plaza_report),
                        versions=json.dumps([np.__version__, scipy.__version__]))


def test_collar_cells_config_default_override_and_validation():
    from solver_config import config_from_dict, config_to_dict, parse_set_args, validate
    assert SolverConfig().plaza.collar_cells == 1
    cfg = with_overrides(SolverConfig(), parse_set_args(["plaza.collar_cells=2"]))
    assert cfg.plaza.collar_cells == 2 and isinstance(cfg.plaza.collar_cells, int)
    assert config_to_dict(cfg)["plaza"]["collar_cells"] == 2
    assert config_from_dict(json.loads(json.dumps(config_to_dict(cfg)))) == cfg
    assert validate(collar_cfg(0)) == []
    msgs = validate(collar_cfg(-1))
    assert len(msgs) == 1 and "plaza.collar_cells" in msgs[0]


def test_collar_cells_zero_is_legacy():
    import scipy
    gold = np.load(PLAZA_GOLDEN)
    same_versions = json.loads(str(gold["versions"])) == [np.__version__, scipy.__version__]
    grid, plazas, pads, road = plaza_golden_scene()
    g = run(grid, plazas, corridors=road, pads=pads, cfg=collar_cfg(0))
    assert g.stats["cg_converged"] == 1.0
    if same_versions:  # bit for bit against the grade_grid from before the collar
        assert np.array_equal(g.h, gold["h"], equal_nan=True) and np.array_equal(g.residual, gold["residual"])
        assert g.stats == json.loads(str(gold["stats"]))
    else:  # another numpy / scipy may round the shoulder CG differently (the held cells stay bit for bit)
        assert np.allclose(g.h, gold["h"], atol=1e-9, equal_nan=True)
    held = gold["plaza_id"] >= 0
    assert np.array_equal(g.plaza_id, gold["plaza_id"]) and np.array_equal(g.h[held], gold["h"][held])
    assert g.log == json.loads(str(gold["log"]))
    assert [{k: v for k, v in r.items() if k != "collar_cells"} for r in g.plaza_report] == json.loads(str(gold["report"]))
    assert g.plaza_collar is not None and not g.plaza_collar.any()
    assert all(r["collar_cells"] == 0 for r in g.plaza_report)


def test_collar_ring_is_held_exactly_at_h():
    grid = grid_of()
    g = run(grid, [Plaza("p", (SQUARE,), h=60.0, h_source="fixed")], cfg=collar_cfg(1))
    m = cells_of(grid, [SQUARE])
    want = dilate8(m) & ~m
    assert want.sum() == 4 * 30 + 4  # one cell all round a 30 x 30 cell square
    assert np.array_equal(g.plaza_collar, want)
    assert np.array_equal(g.h[want], np.full(want.sum(), 60.0))
    assert np.array_equal(g.h[m], np.full(m.sum(), 60.0))
    assert np.array_equal(g.plaza_id >= 0, m)  # plaza_id keeps the centre rule
    assert g.stats["plaza_cells"] == m.sum() and g.plaza_report[0]["cells"] == m.sum()
    assert g.plaza_report[0]["collar_cells"] == want.sum()
    # the shoulder starts outside the collar: the next ring out is free (eased, not held)
    nxt = dilate8(m, 2) & ~dilate8(m)
    assert not g.unknown[want].any() and g.unknown[nxt].all()


def _quad_corners(grid, x, y):
    """Row and column of the north-west of the four cell centres around (x, y)."""
    c = np.floor((x - grid.origin_x) / grid.res - 0.5).astype(int)
    r = np.floor((grid.origin_y - y) / grid.res - 0.5).astype(int)
    return r, c


def _square_points(n, seed=11):
    rng = np.random.default_rng(seed)
    u0, u1 = 30.3, 90.7
    inside = rng.uniform(u0, u1, (n // 2, 2))
    side = rng.integers(0, 4, n - n // 2)
    t = rng.uniform(u0, u1, n - n // 2)
    edge = np.stack([np.where(side == 0, u0, np.where(side == 1, u1, t)), np.where(side == 2, u0, np.where(side == 3, u1, t))], 1)
    pts = np.concatenate([inside, edge])
    corners = np.array([[u0, u0], [u0, u1], [u1, u0], [u1, u1]])
    far = np.min(np.hypot(pts[:, None, 0] - corners[None, :, 0], pts[:, None, 1] - corners[None, :, 1]), axis=1) >= 0.3 * RES
    return pts[far]


def test_every_lattice_quad_touching_the_polygon_is_flat():
    grid = grid_of()
    pts = _square_points(2000)
    assert len(pts) > 1900
    x, y = P(pts[:, 0], pts[:, 1])
    r, c = _quad_corners(grid, x, y)

    def flat(g):
        return (g.h[r, c] == 60.0) & (g.h[r + 1, c] == 60.0) & (g.h[r, c + 1] == 60.0) & (g.h[r + 1, c + 1] == 60.0)

    on = run(grid, [Plaza("p", (SQUARE,), h=60.0, h_source="fixed")], cfg=collar_cfg(1))
    assert flat(on).all()
    # bilinear reads (Grid.sample_bilinear: the consumers of corrected_dem) are H there too, up to the rounding of the
    # interpolation weights (the four corners themselves are bit for bit H above)
    assert np.abs(Grid(on.h, grid.origin_x, grid.origin_y, grid.res).sample_bilinear(x, y) - 60.0).max() <= 1e-12
    off = run(grid, [Plaza("p", (SQUARE,), h=60.0, h_source="fixed")], cfg=collar_cfg(0))
    assert not flat(off).all()  # without the collar the quads on the plaza edge lean towards the DEM


def test_collar_never_overrides_pad_or_road():
    grid = grid_of()
    plazas = [Plaza("p", (SQUARE,), h=60.0, h_source="fixed")]
    pads = [Pad("bldg_x", (ring(40.3, 20.3, 50.7, 35.7),), 64.0)]
    road = crossing_road(grid)
    g0 = run(grid, plazas, corridors=road, pads=pads, cfg=collar_cfg(0))
    g1 = run(grid, plazas, corridors=road, pads=pads, cfg=collar_cfg(1))
    pad, hard = g1.pad_id >= 0, g1.road
    assert np.array_equal(g0.pad_id >= 0, pad) and np.array_equal(g0.road, hard)
    assert np.array_equal(g0.h[pad], g1.h[pad]) and np.all(g1.h[pad] == 64.0)
    assert np.array_equal(g0.h[hard], g1.h[hard])
    m = cells_of(grid, [SQUARE])
    ring1 = dilate8(m & ~pad) & ~m
    assert (ring1 & pad).any() and (ring1 & hard).any()  # the pad and the road both sit where the collar would go
    assert not (g1.plaza_collar & (pad | hard)).any()
    assert np.array_equal(g1.plaza_collar, ring1 & ~pad & ~hard)
    assert np.all(g1.h[g1.plaza_collar] == 60.0)


def test_collar_around_a_hole():
    grid = grid_of()
    g = run(grid, [Plaza("p", (SQUARE, HOLE), h=60.0, h_source="fixed")], cfg=collar_cfg(1))
    outer = cells_of(grid, [SQUARE])
    solid = cells_of(grid, [SQUARE, HOLE])
    hole = outer & ~solid
    rim = hole & dilate8(solid)  # the hole cells one cell in from its edge
    inner = hole & ~dilate8(solid)  # two cells or more in from its edge
    assert rim.sum() == 36 and inner.sum() == 64
    assert np.all(g.h[rim] == 60.0) and g.plaza_collar[rim].all()
    assert not g.plaza_collar[inner].any()
    assert np.mean(g.h[inner] == 60.0) < 0.05  # the middle keeps a shape of its own
    assert not g.island[hole].any() and not g.mid[hole].any() and g.unknown[inner].all()
    centre = (slice(28, 33), slice(28, 33))
    assert inner[centre].all()
    assert np.median(np.abs(g.h[centre] - grid.data[centre])) < np.median(np.abs(60.0 - grid.data[centre]))


def test_collar_between_two_plazas_goes_to_the_nearer_then_the_earlier():
    grid = grid_of()
    east = ring(92.3, 30.3, 110.7, 50.7)  # 1.6 m east of SQUARE: one free cell column (centre u = 91) between them
    a, b = Plaza("p", (SQUARE,), h=60.0, h_source="fixed"), Plaza("q", (east,), h=61.0, h_source="fixed")
    m_p, m_q = cells_of(grid, [SQUARE]), cells_of(grid, [east])
    gap = dilate8(m_p) & dilate8(m_q) & ~m_p & ~m_q
    d_p, d_q = ndimage_edt(~m_p), ndimage_edt(~m_q)  # centre distance to the nearest solid cell of each plaza
    tie = gap & (d_p == d_q)
    assert tie.sum() > 5 and (gap & (d_p < d_q)).any()
    for order, h_tie in (((a, b), 60.0), ((b, a), 61.0)):  # as far from both: the earlier plaza keeps the cell
        g = run(grid, order, cfg=collar_cfg(1))
        assert np.all(g.h[tie] == h_tie) and g.plaza_collar[gap].all()
        assert np.all(g.h[gap & (d_p < d_q)] == 60.0) and np.all(g.h[gap & (d_q < d_p)] == 61.0)  # else the nearer
        assert np.all(g.h[m_p] == 60.0) and np.all(g.h[m_q] == 61.0)  # a solid cell is never another plaza's collar
    # two rings: the far side of the gap is solid q, so the p collar stops there; the q collar stays q's
    g = run(grid, (a, b), cfg=collar_cfg(2))
    assert np.all(g.h[m_q] == 61.0) and np.all(g.h[dilate8(m_q) & ~m_q & ~dilate8(m_p, 2)] == 61.0)
    near_q = dilate8(m_q) & ~m_q & ~gap & dilate8(m_p, 2)  # one cell from q, two from p: the nearer plaza q
    assert near_q.any() and np.all(g.h[near_q] == 61.0)


def test_report_has_collar_cells_key(tmp_path):
    camp = _scene(tmp_path)
    o = tmp_path / "o"
    cli("--engine", "v2", "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp, "--out", o)
    rep = json.loads((o / "solve_report.json").read_text(encoding="utf-8"))
    assert rep["config"]["plaza"]["collar_cells"] == 1
    for r in rep["plazas"]:
        assert isinstance(r["collar_cells"], int) and r["collar_cells"] > 0, r["id"]
    o0 = tmp_path / "o0"
    cli("--engine", "v2", "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp, "--out", o0,
        "--set", "plaza.collar_cells=0")
    rep0 = json.loads((o0 / "solve_report.json").read_text(encoding="utf-8"))
    assert rep0["config"]["plaza"]["collar_cells"] == 0 and all(r["collar_cells"] == 0 for r in rep0["plazas"])
    # without plazas: no plazas[] at all, so no collar_cells key anywhere outside the config
    from test_solver_v2_cli import basic_scene
    plain = tmp_path / "plain"
    plain.mkdir()
    camp2 = basic_scene(plain)
    o2 = plain / "o"
    cli("--engine", "v2", "--store", plain / "store.json", "--dem", plain / "dem.json", "--campus", camp2, "--out", o2)
    rep2 = json.loads((o2 / "solve_report.json").read_text(encoding="utf-8"))
    assert "plazas" not in rep2
    rep2["config"]["plaza"].pop("collar_cells")
    assert "collar_cells" not in json.dumps(rep2)
