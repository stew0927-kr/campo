"""
실행:  cd tools/elevation && python -m pytest -q test_drop_walls.py

사람이 그린 고도 단절선(옹벽)의 lowSide·dropM이 격자(grade_grid)에서 실제 단차를 만드는지. 선을 가로지르는 링크 (hi, lo)의
양끝 셀(링)을 변위 d = h − DEM으로 고정(핀)한다: d_hi = +s·δ·τ, d_lo = −(1−s)·δ·τ (s = wall_high_share, τ = 끝점 테이퍼).
측정 단차는 DEM의 자연 경사를 뺀 초과분 ex = (h_hi − h_lo) − (DEM_hi − DEM_lo)이고 δ·τ와 같아야 한다.
좌표는 격자 CRS 미터(project = 항등). 벽 끝점은 셀 중심·셀 경계와 겹치지 않는 비정수로 잡는다.
회귀 골든(golden/grade_grid_no_walls.npz)은 이 기능 이전의 grade_grid로 만든 것이다(write_golden).
"""
import json
import sys
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import grid_grading as gg  # noqa: E402
from campo_grid import Grid  # noqa: E402
from grid_grading import Corridors, Pad, SoftPoint, breakline_links, grade_grid  # noqa: E402
from solver_config import SolverConfig, with_overrides  # noqa: E402
from test_campus_constraints import X0, Y0  # noqa: E402
from test_portal_pads import CFG, make_grid  # noqa: E402
from test_solver_v2_cli import EMPTY_STORE, cli, transforms  # noqa: E402

RES = 2.0
N = 61  # 61 x 61 cells of 2 m: x = X0 + 1 + 2c, y = Y0 - 1 - 2r
GOLDEN = HERE / "golden" / "grade_grid_no_walls.npz"


def slope_dem(X, Y):
    return 50.0 + 0.3 * (X - X0) + 0.1 * (Y - Y0)


def grid_of(fn=slope_dem):
    return make_grid(X0, Y0, N, N, fn, res=RES)


def P(u, v):
    """u m east and v m south of the top-left corner."""
    return (X0 + u, Y0 - v)


def wall(wid, pts, low_side, drop):
    return gg.DropWall(wid, np.array([P(u, v) for u, v in pts], float), low_side, float(drop))


NORTH = [(62.3, 100.3), (62.3, 20.3)]  # south -> north at x = 62.3 (between columns 30 and 31), 80 m long
EAST = [(20.3, 60.3), (100.3, 60.3)]  # west -> east at y = -60.3 (between rows 29 and 30), 80 m long
DIAG = [(20.3, 100.7), (90.1, 30.9)]  # south-west -> north-east


def run(grid, walls=(), corridors=None, pads=(), cfg=CFG, **kw):
    return grade_grid(grid, corridors if corridors is not None else Corridors.empty(), list(pads), cfg,
                      drop_walls=tuple(walls), **kw)


def links(grid, w):
    p, q, p_hi, s, L = gg.wall_links(grid, w.coords, w.low_side)
    return np.where(p_hi, p, q), np.where(p_hi, q, p), s, L


def excess(g, grid, hi, lo):
    h, dem = g.h.ravel(), grid.data.ravel()
    return (h[hi] - h[lo]) - (dem[hi] - dem[lo])


def want_drop(s, L, delta, cfg=CFG):
    """delta x min(1, s / L_t, (L - s) / L_t), L_t = delta / wall_tip_slope (no taper when the slope is 0)."""
    k = cfg.shoulder.wall_tip_slope
    if k <= 0:
        return np.full(len(s), float(delta))
    return delta * np.clip(np.minimum(s, L - s) / (delta / k), 0.0, 1.0)


def corridor(pts_uv, dz, dem_fn=slope_dem):
    """One straight corridor through cell centres with target height DEM + dz at both ends."""
    xy = np.array([[P(*pts_uv[0]), P(*pts_uv[1])]], float)
    z = np.array([[dem_fn(*xy[0, 0]) + dz, dem_fn(*xy[0, 1]) + dz]], float)
    return Corridors(xy, z, np.array([[0.0, 1.0]]), np.zeros(1, np.int32), ("e_road",))


def corridors_of(*cs):
    return Corridors(np.concatenate([c.xy for c in cs]), np.concatenate([c.z for c in cs]),
                     np.concatenate([c.t_range for c in cs]), np.concatenate([c.steps for c in cs]),
                     tuple(e for c in cs for e in c.edge_ids))


def rect_ring(u0, v0, u1, v1):
    return np.array([P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), P(u0, v0)], float)


def report_of(g, wid):
    return next(r for r in g.wall_report if r["id"] == wid)


# ---------------------------------------------------------------- 1. 경사 DEM 위의 단차


def test_drop_on_a_sloped_dem_is_the_excess_over_the_natural_slope():
    grid = grid_of()
    w = wall("w1", NORTH, "right", 3.0)
    g = run(grid, [w])
    hi, lo, s, L = links(grid, w)
    assert len(hi) == 40 and L == pytest.approx(80.0)
    xs, _ = grid.cell_centers()
    assert np.all(xs[hi % N] == X0 + 61) and np.all(xs[lo % N] == X0 + 63)  # right of a northward line = east = low
    full = want_drop(s, L, 3.0) >= 3.0 * 0.999
    assert full.sum() == 34
    ex = excess(g, grid, hi, lo)
    assert np.allclose(ex[full], 3.0, atol=1e-6)
    h, dem = g.h.ravel(), grid.data.ravel()
    assert np.allclose(dem[hi] - dem[lo], -0.6)  # the natural slope (0.3 east) is kept under the drop
    assert np.allclose((h[hi] - h[lo])[full], (dem[hi] - dem[lo])[full] + 3.0, atol=1e-6)
    d = g.residual.ravel()
    assert np.allclose(d[hi][full], 1.5, atol=1e-9) and np.allclose(d[lo][full], -1.5, atol=1e-9)  # wall_high_share 0.5
    assert g.stats["cg_converged"] == 1.0 and g.stats["drop_walls"] == 1.0 and g.stats["drop_wall_links"] == 40.0
    assert g.stats["drop_wall_pins"] == 80.0 and g.stats["max_drop_wall_error_m"] < 1e-6
    # the drop fades out with the displacement away from the wall (no plateau over the whole map)
    assert abs(g.residual[30, 0]) < 0.05 and abs(g.residual[30, -1]) < 0.05


def test_high_share_zero_only_lowers_the_low_side():
    grid = grid_of()
    w = wall("w1", NORTH, "right", 3.0)
    g = run(grid, [w], cfg=with_overrides(CFG, {"shoulder.wall_high_share": 0.0}))
    hi, lo, s, L = links(grid, w)
    full = want_drop(s, L, 3.0) >= 3.0 * 0.999
    d = g.residual.ravel()
    assert np.allclose(d[hi][full], 0.0, atol=1e-9) and np.allclose(d[lo][full], -3.0, atol=1e-9)
    assert np.allclose(excess(g, grid, hi, lo)[full], 3.0, atol=1e-6)


@pytest.mark.parametrize("key, value", [("shoulder.wall_high_share", 1.5), ("shoulder.wall_high_share", -0.1),
                                        ("shoulder.wall_tip_slope", -1.0), ("shoulder.wall_min_step_m", -0.001)])
def test_wall_settings_out_of_range_raise(key, value):
    with pytest.raises(ValueError, match=key.split(".")[1]):
        run(grid_of(), [wall("w1", NORTH, "right", 3.0)], cfg=with_overrides(CFG, {key: value}))


# ---------------------------------------------------------------- 2. 끝점 테이퍼


def max_jump_near_ends(g, grid, w, radius=8.0):
    """Largest |d_p - d_q| over 4-neighbour pairs near the wall's ends that do not cross the wall."""
    d = g.residual
    xs, ys = grid.cell_centers()
    X, Y = np.meshgrid(xs, ys)
    le, ls = breakline_links(grid, np.stack([w.coords[:-1], w.coords[1:]], axis=1), 0.0)
    ends = w.coords[[0, -1]]

    def near(x, y):
        return np.min(np.hypot(x[..., None] - ends[:, 0], y[..., None] - ends[:, 1]), axis=-1) <= radius

    out = 0.0
    for jump, live, mx, my in ((np.abs(np.diff(d, axis=1)), le > 0, 0.5 * (X[:, :-1] + X[:, 1:]), Y[:, :-1]),
                               (np.abs(np.diff(d, axis=0)), ls > 0, X[:-1], 0.5 * (Y[:-1] + Y[1:]))):
        m = live & near(mx, my)
        out = max(out, float(jump[m].max()))
    return out


def test_drop_tapers_linearly_to_zero_at_open_ends():
    grid = grid_of()
    w = wall("w1", NORTH, "right", 3.0)
    g = run(grid, [w])
    hi, lo, s, L = links(grid, w)
    want = want_drop(s, L, 3.0)
    assert want.min() == pytest.approx(3.0 * 0.7 / 6.0)  # the north end link is 0.7 m from the end, L_t = 3 / 0.5 = 6 m
    assert np.allclose(excess(g, grid, hi, lo), want, atol=1e-6)
    flat = with_overrides(CFG, {"shoulder.wall_tip_slope": 0.0})
    g0 = run(grid, [w], cfg=flat)
    assert np.allclose(excess(g0, grid, hi, lo), 3.0, atol=1e-6)
    j_taper, j_flat = max_jump_near_ends(g, grid, w), max_jump_near_ends(g0, grid, w)
    print(f"max d jump near the ends: taper {j_taper:.3f} m, no taper {j_flat:.3f} m")
    assert j_taper < j_flat


def test_links_below_the_min_step_keep_no_pin():
    grid = grid_of()
    w = wall("w1", NORTH, "right", 3.0)
    g = run(grid, [w], cfg=with_overrides(CFG, {"shoulder.wall_min_step_m": 1.0}))
    hi, lo, s, L = links(grid, w)
    big = want_drop(s, L, 3.0) > 1.0
    assert 0 < big.sum() < len(big)
    assert g.stats["drop_wall_links"] == float(big.sum()) and g.stats["drop_wall_pins"] == 2.0 * big.sum()
    assert np.allclose(excess(g, grid, hi, lo)[big], want_drop(s, L, 3.0)[big], atol=1e-6)


# ---------------------------------------------------------------- 3. 이미 고정된 셀(도로·대지)


def test_road_cells_keep_their_height_and_the_free_side_follows_them():
    grid = grid_of()
    w = wall("w1", NORTH, "right", 3.0)
    # a road on column 30 (the high side) at DEM + 0.4, and a short road on column 31 (the low side) at DEM - 0.2
    road = corridors_of(corridor([(61, 110), (61, 10)], 0.4), corridor([(63, 40.5), (63, 59.5)], -0.2))
    base = run(grid, [], corridors=road)
    g = run(grid, [w], corridors=road)
    hi, lo, s, L = links(grid, w)
    want = want_drop(s, L, 3.0)
    assert base.road.ravel()[hi].all()
    assert np.array_equal(g.h.ravel()[hi], base.h.ravel()[hi])  # fixed cells never move
    both = base.road.ravel()[lo]
    assert both.sum() == 10
    d = g.residual.ravel()
    assert np.allclose(d[hi], 0.4, atol=1e-9)
    assert np.allclose(d[lo][~both], 0.4 - want[~both], atol=1e-9)  # -2.6 where the drop is full
    assert np.allclose(d[lo][~both & (want > 2.999)], -2.6, atol=1e-9)
    assert np.array_equal(g.h.ravel()[lo][both], base.h.ravel()[lo][both])  # both fixed: not enforced
    r = report_of(g, "w1")
    assert r["conflicts"] == 10 and r["links"] == 40
    assert any(line.startswith("breakline w1: dropM 3.00 m") and "conflicts 10" in line for line in g.log)


def test_pad_cells_keep_their_height_and_the_free_side_follows_them():
    grid = grid_of()
    w = wall("w1", NORTH, "right", 3.0)
    high = Pad("bldg_high", (rect_ring(40.0, 70.0, 62.0, 90.0),), 75.0)  # columns <= 30, rows 35..44: high side only
    across = Pad("bldg_across", (rect_ring(50.0, 30.0, 74.0, 50.0),), 70.0)  # columns 25..36, rows 15..24: both sides
    base = run(grid, [], pads=[high, across])
    g = run(grid, [w], pads=[high, across])
    hi, lo, s, L = links(grid, w)
    want = want_drop(s, L, 3.0)
    pad = base.pad_id.ravel()
    one = (pad[hi] == 0) & (pad[lo] < 0)
    both = (pad[hi] == 1) & (pad[lo] == 1)
    assert one.sum() == 10 and both.sum() == 10
    assert np.array_equal(g.h.ravel()[pad >= 0], base.h.ravel()[pad >= 0])
    h, dem = g.h.ravel(), grid.data.ravel()
    assert np.allclose(h[lo][one], 75.0 - want[one] - (dem[hi] - dem[lo])[one], atol=1e-9)
    assert np.allclose(excess(g, grid, hi, lo)[one], want[one], atol=1e-9)
    assert report_of(g, "w1")["conflicts"] == 10
    free = (pad[hi] < 0) & (pad[lo] < 0)
    assert np.allclose(excess(g, grid, hi, lo)[free], want[free], atol=1e-6)


# ---------------------------------------------------------------- 4. lowSide 반전과 선 방향


@pytest.mark.parametrize("pts", [NORTH, DIAG], ids=["vertical", "diagonal"])
def test_low_side_flip_swaps_the_sides_and_a_reversed_line_is_the_same_wall(pts):
    grid = grid_of()
    a, b = wall("a", pts, "right", 3.0), wall("a", pts, "left", 3.0)
    ga, gb = run(grid, [a]), run(grid, [b])
    hi, lo, s, L = links(grid, a)
    hib, lob, _, _ = links(grid, b)
    assert set(zip(hi.tolist(), lo.tolist())) == set(zip(lob.tolist(), hib.tolist()))
    full = want_drop(s, L, 3.0) >= 3.0 * 0.999
    assert full.sum() > 10
    assert np.allclose(excess(ga, grid, hi, lo)[full], 3.0, atol=1e-6)
    assert np.allclose(excess(gb, grid, hi, lo)[full], -3.0, atol=1e-6)
    gr = run(grid, [wall("a", pts[::-1], "left", 3.0)])
    assert np.allclose(gr.h, ga.h, atol=1e-9)


# ---------------------------------------------------------------- 5. 여러 단절선


def test_crossing_walls_each_keep_their_own_drop():
    grid = grid_of()
    v, e = wall("v", NORTH, "right", 3.0), wall("e", EAST, "right", 2.0)  # east of v is low, south of e is low
    g = run(grid, [v, e])
    assert g.stats["cg_converged"] == 1.0 and g.stats["drop_walls"] == 2.0
    xs, ys = grid.cell_centers()
    cross = np.array(P(62.3, 60.3))
    for w, delta in ((v, 3.0), (e, 2.0)):
        hi, lo, s, L = links(grid, w)
        full = want_drop(s, L, delta) >= delta * 0.999
        ex = excess(g, grid, hi, lo)
        assert np.allclose(ex[full], delta, atol=1e-6), w.id
        mid = np.hypot(xs[hi % N] - cross[0], ys[hi // N] - cross[1]) <= 4.0
        assert (mid & full).sum() >= 2  # links next to the crossing are measured too
        r = report_of(g, w.id)
        assert abs(r["measured_median_m"] - delta) < 1e-6 and r["links"] == len(hi)


def test_identical_walls_count_once_with_the_larger_drop():
    grid = grid_of()
    one = run(grid, [wall("big", NORTH, "right", 3.0)])
    two = run(grid, [wall("small", NORTH, "right", 2.0), wall("big", NORTH, "right", 3.0)])
    assert np.array_equal(two.h, one.h)
    assert two.stats["drop_walls"] == 1.0
    assert any("small" in line and "same grid links as big" in line for line in two.log)


def test_closed_ring_wall_has_the_full_drop_all_around():
    grid = grid_of()
    ring = [(30.3, 30.7), (90.1, 30.7), (90.1, 90.3), (30.3, 90.3), (30.3, 30.7)]  # clockwise: right = inside
    w = wall("ring", ring, "right", 2.5)
    g = run(grid, [w])
    assert np.isfinite(g.h).all() and g.stats["cg_converged"] == 1.0
    hi, lo, s, L = links(grid, w)
    xs, ys = grid.cell_centers()
    inside = (xs[lo % N] > X0 + 30.3) & (xs[lo % N] < X0 + 90.1) & (ys[lo // N] < Y0 - 30.7) & (ys[lo // N] > Y0 - 90.3)
    assert inside.all()
    assert np.allclose(excess(g, grid, hi, lo), 2.5, atol=1e-6)  # no taper on a closed line


# ---------------------------------------------------------------- 6. 도로·대지가 없는 곳


def test_a_wall_alone_makes_shoulder_unknowns():
    grid = grid_of()
    assert run(grid, []).stats["shoulder_unknowns"] == 0.0
    g = run(grid, [wall("w1", NORTH, "right", 3.0)])
    assert g.stats["shoulder_unknowns"] > 0 and g.stats["cg_converged"] == 1.0
    print(f"wall alone: {int(g.stats['shoulder_unknowns'])} unknowns, CG {int(g.stats['cg_iterations'])} iteration(s)")


def test_missing_dem_next_to_the_wall_does_not_spread():
    def fn(X, Y):
        z = slope_dem(X, Y)
        hole = (np.abs(X - (X0 + 63)) < 0.5) & (Y < Y0 - 40) & (Y > Y0 - 50)  # 5 low side cells
        hole |= (np.abs(X - (X0 + 59)) < 0.5) & (Y < Y0 - 70) & (Y > Y0 - 76)  # 3 cells one column west of the high side
        return np.where(hole, np.nan, z)

    grid = grid_of(fn)
    w = wall("w1", NORTH, "right", 3.0)
    g = run(grid, [w])
    valid = np.isfinite(grid.data)
    assert (~valid).sum() == 8
    assert np.isfinite(g.h[valid]).all() and np.isnan(g.h[~valid]).all()
    assert g.stats["cg_converged"] == 1.0
    hi, lo, s, L = links(grid, w)
    ok = valid.ravel()[hi] & valid.ravel()[lo]
    assert (~ok).sum() == 5
    full = ok & (want_drop(s, L, 3.0) >= 3.0 * 0.999)
    assert np.allclose(excess(g, grid, hi, lo)[full], 3.0, atol=1e-6)
    assert report_of(g, "w1")["links"] == 35


# ---------------------------------------------------------------- 7. 벽이 없으면 예전과 같다


def golden_scene():
    """Roads, a pad, a barometer point and a drawn break line without a drop (inputs that existed before drop walls)."""
    grid = grid_of(lambda X, Y: slope_dem(X, Y) + 2.0 * np.sin((X - X0) / 17.0) * np.cos((Y - Y0) / 23.0))
    dem_at = lambda x, y: float(grid.sample_bilinear(x, y)[0])  # noqa: E731
    road = corridors_of(corridor([(11, 21), (101, 37)], 0.3, dem_at), corridor([(101, 37), (81, 111)], -0.2, dem_at))
    pads = [Pad("bldg_g", (rect_ring(30.0, 60.0, 50.0, 80.0),), 58.0)]
    lines = np.array([[P(62.3, 100.3), P(62.3, 20.3)]], float)
    points = [SoftPoint(*P(90.0, 90.0), 75.0, 6.0)]
    return grid, road, pads, dict(breaklines=lines, breakline_attenuation=0.0, soft_points=points)


def write_golden():  # pragma: no cover (run once with the grade_grid from before drop walls)
    grid, road, pads, kw = golden_scene()
    g = grade_grid(grid, road, pads, CFG, **kw)
    import scipy
    GOLDEN.parent.mkdir(exist_ok=True)
    np.savez_compressed(GOLDEN, h=g.h, residual=g.residual, stats=json.dumps(g.stats), log=json.dumps(g.log),
                        versions=json.dumps([np.__version__, scipy.__version__]))


def test_no_drop_walls_is_bit_identical_to_before():
    import scipy
    gold = np.load(GOLDEN)
    grid, road, pads, kw = golden_scene()
    same_versions = json.loads(str(gold["versions"])) == [np.__version__, scipy.__version__]
    plain = grade_grid(grid, road, pads, CFG, **kw)
    for g in (plain, grade_grid(grid, road, pads, CFG, drop_walls=(), **kw)):
        assert g.stats["cg_converged"] == 1.0 and g.stats["cg_iterations"] > 0
        assert np.array_equal(g.h, plain.h, equal_nan=True) and np.array_equal(g.residual, plain.residual)
        if same_versions:  # bit for bit against the grade_grid from before drop walls
            assert np.array_equal(g.h, gold["h"], equal_nan=True) and np.array_equal(g.residual, gold["residual"])
        else:  # another numpy / scipy may round differently
            assert np.allclose(g.h, gold["h"], atol=1e-9, equal_nan=True)
        assert g.stats == json.loads(str(gold["stats"])) or not same_versions
        assert g.log == json.loads(str(gold["log"]))
        assert g.wall_report == []


# ---------------------------------------------------------------- 8. 보고·로그·CLI


def test_log_reports_the_measured_drop():
    grid = grid_of()
    g = run(grid, [wall("w1", NORTH, "right", 3.0)])
    line = next(line for line in g.log if line.startswith("breakline w1:"))
    assert line == "breakline w1: dropM 3.00 m, measured 3.000 m (40 link(s), min 3.000 .. max 3.000), conflicts 0"
    r = report_of(g, "w1")
    assert r["drop_m"] == 3.0 and r["links"] == 40 and r["conflicts"] == 0
    assert abs(r["measured_min_m"] - 3.0) < 1e-6 and abs(r["measured_max_m"] - 3.0) < 1e-6


def test_cli_v2_drop_wall_reaches_the_corrected_dem_and_the_report(tmp_path):
    to_grid, to_ll = transforms()
    gx, gy = to_grid.transform(127.05, 37.56)
    xs = gx + (np.arange(60) + 0.5)
    ys = gy - (np.arange(60) + 0.5)
    X, Y = np.meshgrid(xs, ys)
    Grid(40.0 + 0.05 * (X - gx) - 0.08 * (Y - gy), gx, gy, 1.0).save(tmp_path / "dem")
    a, b = to_ll.transform(gx + 30.3, gy - 50.3), to_ll.transform(gx + 30.3, gy - 10.3)  # northward at x = 30.3

    def store(name, **extra):
        line = {"id": "bl-w", "coordinates": [{"lng": a[0], "lat": a[1]}, {"lng": b[0], "lat": b[1]}], "source": "manual",
                "createdAt": 0, **extra}
        (tmp_path / f"{name}.json").write_text(json.dumps(dict(EMPTY_STORE, breaklines=[line])), encoding="utf-8")
        o = tmp_path / name
        cli("--engine", "v2", "--store", tmp_path / f"{name}.json", "--dem", tmp_path / "dem.json", "--out", o)
        return Grid.load(o / "corrected_dem.json").data, json.loads((o / "solve_report.json").read_text(encoding="utf-8"))

    z, rep = store("drop", lowSide="right", dropM=2.0)
    dem = Grid.load(tmp_path / "dem.json").data
    ex = (z[20:41, 29] - z[20:41, 30]) - (dem[20:41, 29] - dem[20:41, 30])  # rows 20..40 are > 4 m from both ends
    assert np.allclose(ex, 2.0, atol=1e-4)
    assert rep["format"] == "campo-solve-report/1"
    assert rep["grid"]["drop_walls"] == 1 and rep["grid"]["drop_wall_links"] == 40 and rep["grid"]["drop_wall_pins"] == 80
    assert rep["grid"]["max_drop_wall_error_m"] < 1e-6
    (dw,) = rep["dropWalls"]
    assert dw["id"] == "bl-w" and dw["dropM"] == 2.0 and dw["links"] == 40 and dw["conflicts"] == 0
    assert abs(dw["measuredMedian"] - 2.0) < 1e-6 and abs(dw["measuredMin"] - 2.0) < 1e-6
    assert any(line.startswith("breakline bl-w: dropM 2.00 m, measured 2.000 m") for line in rep["log"])
    # no drop (dropM 0, or lowSide without dropM): the line only separates the sides, as before
    z0, rep0 = store("zero", lowSide="right", dropM=0.0)
    z1, rep1 = store("side", lowSide="right")
    assert np.array_equal(z0, z1) and rep0["dropWalls"] == [] and "drop_walls" not in rep0["grid"]
    assert np.allclose(z0, dem, atol=1e-5)
