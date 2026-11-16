"""
실행:  cd tools/elevation && python -m pytest -q test_portal_pads.py

포탈 기준 다단 대지(terraced pads)와 기반층(ext.plinth_floors): 건물마다 출입문(포탈)을 모으고, 문이 닿는 원본 DEM으로
지지되는 층만 테라스(접지면)로 깔며, 테라스 경계는 옹벽(불연속선)으로 둔다. 하한·묻힌 면적은 접지면 기준.
좌표는 격자 CRS 미터를 그대로 쓴다(project = 항등). CLI 장면만 test_solver_v2_cli.py처럼 경위도로 쓴다.
"""
import dataclasses
import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from campo_grid import Grid  # noqa: E402
from campo_height_solver import (  # noqa: E402
    DEFAULT_FLOOR_HEIGHT_M, Node, building_extras, building_pads, building_portals, campus_corridors, campus_model,
    solve_report, terraced_pads, wls_problem,
)
from grid_grading import (  # noqa: E402
    Corridors, Pad, Terrace, breakline_links, buried_area, grade_grid, pad_ring, rasterize_pads, rasterize_polygon,
)
from node_wls import BuildingPad, HeightVar, WlsProblem, solve_nodes  # noqa: E402
from solver_config import SolverConfig, validate, with_overrides  # noqa: E402
from test_campus_constraints import X0, Y0, feat_building, feat_edge, feat_node, ident  # noqa: E402

CFG = SolverConfig()
FH = DEFAULT_FLOOR_HEIGHT_M


def make_grid(x0, y0, w, h, fn, res=1.0):
    """Grid whose top-left corner is (x0, y0) (grid CRS m)."""
    xs = x0 + (np.arange(w) + 0.5) * res
    ys = y0 - (np.arange(h) + 0.5) * res
    X, Y = np.meshgrid(xs, ys)
    return Grid(np.asarray(fn(X, Y), float), x0, y0, res)


def rect(x0, y0, x1, y1):
    return [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]


def building(bid, levels, ring, ground_levels=None, **ext):
    b = feat_building(bid, levels, **ext)
    b["geometry"] = {"type": "Polygon", "coordinates": ring}
    if ground_levels is not None:
        b["properties"]["ground_levels"] = ground_levels
    return b


def run_v2(features, grid, cfg=CFG, sidecar=None, previous=None):
    """The _run_v2 pipeline in memory (no store, no drawn break lines): WLS, terraced pads, grid, report pieces."""
    sidecar = sidecar or {}
    cm = campus_model(features, ident)
    nodes, edges, soft = list(cm.nodes), list(cm.edges), list(cm.soft_flat)
    log, meta = [], {}
    pads, rings_of = building_pads(features, ident, sidecar, grid, cm, cfg, log, previous, meta)
    keys = {n.key for n in nodes}
    for p in pads:
        if p.var not in keys:
            nodes.append(Node(p.var, "floor_plane"))
    problem = wls_problem(nodes, edges, cm, features, soft, {}, pads, sidecar, cfg, log, project=ident)
    dem0 = lambda x, y: float(grid.sample_bilinear(x, y)[0])  # noqa: E731
    w = solve_nodes(problem, cfg.wls, cfg.building, dem_at=dem0, cell_area_m2=grid.res ** 2)
    heights = {k: h for k, h in w.h.items() if not w.floating[k]}
    corr = campus_corridors(features, cm, ident, heights)
    portals = building_portals(features, cm, ident, dem0)
    t_log = []
    pad_list, plans = terraced_pads(grid, pads, rings_of, meta, portals, w.h, cfg, t_log)
    g = grade_grid(grid, corr, pad_list, cfg)
    x_log = []
    extra = building_extras(grid, g, pads, pad_list, rings_of, meta, portals, plans, w.h, cfg, x_log)
    rep = solve_report(cfg, w, g, extra, "test", {}, extra_log=[*t_log, *x_log])
    return dict(cm=cm, pads=pads, pad_list=pad_list, w=w, g=g, rep=rep, log=log + t_log + x_log, portals=portals,
                corr=corr, rings_of=rings_of, meta=meta)


# ---------------------------------------------------------------- 장면: 앞문 1F / 뒷문 3F 언덕 건물

BX0, BX1, BY_FRONT, BY_BACK = X0 + 40, X0 + 70, Y0 - 50, Y0 - 30  # 30 m x 20 m, front (south) wall low, back wall high
RISE = 2 * FH  # the hill is 2 storeys higher behind the building


def hill_dem(X, Y):
    """30 m in front of the building, 30 + 2 x 3.9 m behind it, rising linearly under the footprint."""
    return 30.0 + RISE * np.clip((Y - BY_FRONT) / (BY_BACK - BY_FRONT), 0.0, 1.0)


def hill_grid():
    return make_grid(X0, Y0, 110, 90, hill_dem)


def hill_campus(back_level=3, plinth=None, back_door=True):
    ext = {} if plinth is None else {"plinth_floors": plinth}
    feats = [
        building("bldg_H", [1, 2, 3], rect(BX0, BY_FRONT, BX1, BY_BACK), **ext),
        feat_node("n_front_far", X0 + 55, Y0 - 80), feat_node("n_front", X0 + 55, BY_FRONT - 4),
        feat_node("n_H_1_main", X0 + 55, BY_FRONT + 1, "bldg_H", 1, "entrance"),
        feat_edge("e_front_walk", "n_front_far", "n_front"),
        feat_edge("e_portal_front", "n_H_1_main", "n_front", edge_type="portal", door_role="front"),
    ]
    if back_door:
        feats += [
            feat_node("n_back_far", X0 + 55, Y0 - 5), feat_node("n_back", X0 + 55, BY_BACK + 4),
            feat_node(f"n_H_{back_level}_back", X0 + 55, BY_BACK - 1, "bldg_H", back_level, "entrance"),
            feat_edge("e_back_walk", "n_back", "n_back_far"),
            feat_edge("e_portal_back", f"n_H_{back_level}_back", "n_back", edge_type="portal", door_role="back"),
        ]
    return feats


def footprint(grid):
    return rasterize_polygon(grid, [np.array(rect(BX0, BY_FRONT, BX1, BY_BACK)[0], float)])


# ---------------------------------------------------------------- 1. 포탈 인벤토리

def test_portal_inventory():
    feats = hill_campus()
    grid = hill_grid()
    cm = campus_model(feats, ident)
    dem0 = lambda x, y: float(grid.sample_bilinear(x, y)[0])  # noqa: E731
    ports = building_portals(feats, cm, ident, dem0)
    assert set(ports) == {"bldg_H"}
    by = {c.edge_id: c for c in ports["bldg_H"]}
    assert set(by) == {"e_portal_front", "e_portal_back"}
    f, b = by["e_portal_front"], by["e_portal_back"]
    assert (f.level, f.role, f.outside_var) == (1, "front", "cn:n_front")
    assert (b.level, b.role, b.outside_var) == (3, "back", "cn:n_back")
    assert f.door_xy == (X0 + 55, BY_FRONT + 1) and b.outside_xy == (X0 + 55, BY_BACK + 4)
    assert f.outside_dem_m == pytest.approx(30.0) and b.outside_dem_m == pytest.approx(30.0 + RISE)
    assert f.step_free is True
    # a portal between two buildings' floors counts for both; an indoor edge never does
    feats2 = feats + [building("bldg_G", [1], rect(X0 + 75, BY_FRONT, X0 + 90, BY_BACK)),
                      feat_node("n_G_1_w", X0 + 76, Y0 - 40, "bldg_G", 1, "entrance"),
                      feat_node("n_H_1_e", X0 + 69, Y0 - 40, "bldg_H", 1, "entrance"),
                      feat_edge("e_portal_hg", "n_H_1_e", "n_G_1_w", edge_type="portal"),
                      feat_edge("e_in", "n_H_1_e", "n_H_1_main", highway="corridor", edge_type="indoor")]
    ports2 = building_portals(feats2, campus_model(feats2, ident), ident, dem0)
    assert "e_portal_hg" in {c.edge_id for c in ports2["bldg_G"]} and "e_portal_hg" in {c.edge_id for c in ports2["bldg_H"]}
    assert "e_in" not in {c.edge_id for cs in ports2.values() for c in cs}
    assert next(c for c in ports2["bldg_G"] if c.edge_id == "e_portal_hg").outside_var == "fp:bldg_H:1F"


# ---------------------------------------------------------------- 1(필수). 앞문 1F / 뒷문 3F

def test_hill_building_gets_two_terraces_and_no_cut():
    grid = hill_grid()
    r = run_v2(hill_campus(), grid)
    g, w, rep = r["g"], r["w"], r["rep"]["buildings"]["bldg_H"]
    h1, h3 = w.h["fp:bldg_H:1F"], w.h["fp:bldg_H:3F"]
    assert h1 == pytest.approx(30.0, abs=0.05) and h3 - h1 == pytest.approx(RISE, abs=0.05)
    # two terraces: the base on the low (front) ground, the upper one at H(3F)
    terr = {t["level"]: t for t in rep["terraces"] if t["supported"]}
    assert set(terr) == {1, 3} and g.stats["terraces"] == 1
    assert terr[1]["plane_m"] == pytest.approx(h1) and terr[3]["plane_m"] == pytest.approx(h3)
    assert terr[1]["source"] == "ground_level" and terr[3]["source"] == "portal" and terr[3]["port_count"] == 1
    assert abs(terr[3]["support_m"] - terr[3]["plane_m"]) <= CFG.building.terrace_tol_m
    assert terr[1]["cells"] > 100 and terr[3]["cells"] > 100
    pad = footprint(grid) & (g.pad_id >= 0)
    assert sorted(np.unique(g.h[pad]).tolist()) == [h1, h3]
    front_half = pad & (grid.data < 30.0 + RISE / 2 - 0.5)
    back_half = pad & (grid.data > 30.0 + RISE / 2 + 0.5)
    assert np.allclose(g.h[front_half], h1) and np.allclose(g.h[back_half], h3)
    # the doors sit on the terrain in front of them
    for c in rep["portal_contacts"]:
        assert abs(c["door_residual_m"]) <= CFG.building.door_sill_tol_m, c
    # the 7.8 m cut / vertical step at the back door is gone; the terrace boundary is a retaining wall, logged apart
    assert g.stats["vertical_steps_over_limit"] == 0 or g.stats["max_vertical_step_m"] <= 0.5
    assert g.stats["terrace_wall_pairs"] > 0 and g.stats["max_terrace_wall_m"] == pytest.approx(RISE, abs=0.05)
    assert any("terrace boundary 3F/1F step 7.80 m = 2.0 x 3.90 m" in line for line in g.log)
    assert not any(line.startswith("vertical steps over") for line in g.log)
    assert terr[1]["boundary_step_m"] == pytest.approx(RISE, abs=0.05)
    # terrain behind the building is no longer dug down to the 1F plane
    behind = (np.abs(grid.cell_centers()[0][None, :] - (X0 + 55)) < 10) & (grid.cell_centers()[1][:, None] > BY_BACK)
    behind = behind & (grid.cell_centers()[1][:, None] < BY_BACK + 6)
    assert np.all(g.h[behind] >= 30.0 + RISE - 0.6)


def test_hill_building_without_terraces_is_the_old_cut():
    """The same scene with building.terrace_enabled = false: one pad plane, the back door stands over a big step."""
    grid = hill_grid()
    cfg = with_overrides(CFG, {"building.terrace_enabled": False})
    r = run_v2(hill_campus(), grid, cfg)
    g = r["g"]
    assert g.stats["terraces"] == 0 and g.stats["terrace_wall_pairs"] == 0
    assert g.stats["max_vertical_step_m"] > RISE - 1.0
    assert any(line.startswith("vertical steps over") for line in g.log)
    pad = g.pad_id >= 0
    assert np.all(g.h[pad] == r["w"].h["fp:bldg_H:1F"])


# ---------------------------------------------------------------- 2. 기반층

def plinth_scene(plinth):
    grid = make_grid(X0, Y0, 80, 70, lambda X, Y: 30.0 + 0.05 * (X - X0))
    feats = [building("bldg_P", [1, 2, 3], rect(X0 + 25, Y0 - 45, X0 + 50, Y0 - 25),
                      **({} if plinth is None else {"plinth_floors": plinth})),
             feat_node("n_far", X0 + 5, Y0 - 35), feat_node("n_door", X0 + 22, Y0 - 35),
             feat_node("n_P_1_main", X0 + 26, Y0 - 35, "bldg_P", 1, "entrance"),
             feat_edge("e_walk", "n_far", "n_door"), feat_edge("e_portal", "n_P_1_main", "n_door", edge_type="portal")]
    return grid, feats


def test_plinth_floors_lower_the_ground_plane_and_the_bound_sits_on_it():
    grid, feats = plinth_scene(2)
    r = run_v2(feats, grid)
    w, g, rep = r["w"], r["g"], r["rep"]["buildings"]["bldg_P"]
    b = w.buildings["bldg_P"]
    plinth = 2 * FH
    h = w.h["fp:bldg_P:1F"]
    assert rep["plinth_m"] == pytest.approx(plinth) and b.plinth_m == pytest.approx(plinth)
    assert rep["h_pad_m"] == pytest.approx(h - plinth)  # ground plane = H(1F) - 2 x 3.9
    assert rep["h_pad_ref_m"] == pytest.approx(rep["h_1f_ref_m"] - plinth)
    assert rep["lower_bound_basis"] == "ground_plane"
    # the bound is on the ground plane: H - plinth >= the ring reference (entrance side ring median)
    pad = g.pad_id >= 0
    mask = rasterize_polygon(grid, r["rings_of"]["bldg_P"])
    assert rep["ref_source"] == "entrance_ring"
    assert rep["pad_lower_bound_m"] == pytest.approx(rep["h_pad_ref_m"])
    assert rep["h_pad_m"] >= rep["h_pad_ref_m"] - 1e-9 and rep["lower_bound_active"]
    assert np.all(g.h[pad] == pytest.approx(h - plinth))
    ring = pad_ring(mask)
    assert buried_area(grid.data, ring, rep["h_pad_m"], 1.0) <= buried_area(grid.data, ring, rep["h_pad_ref_m"], 1.0) + 1e-9
    assert rep["buried_m2"] <= rep["buried_ref_m2"] + 1e-9


def test_plinth_zero_is_the_old_result():
    base = run_v2(*reversed(plinth_scene(None)))
    zero = run_v2(*reversed(plinth_scene(0)))
    neg = run_v2(*reversed(plinth_scene(-1)))  # negative -> 0
    for r in (zero, neg):
        assert r["w"].h == base["w"].h
        assert np.array_equal(r["g"].h, base["g"].h, equal_nan=True)
        assert r["rep"]["buildings"]["bldg_P"]["plinth_m"] == 0
    b = base["w"].buildings["bldg_P"]
    assert b.lower_bound == b.h_ref and b.pad_lower_bound == b.h_ref  # H_1F >= H_1F^0 exactly
    assert b.h_pad == b.h and b.h_pad_ref == b.h_ref


def test_building_pad_five_arguments_and_plinth_bound():
    vars_ = [HeightVar("fp:B:1F", "floor_plane"), HeightVar("cn:P", "outdoor_point", 0.0, 0.0)]
    old = BuildingPad("B", "fp:B:1F", 31.0, "survey", 31.0)
    assert old.plinth_m == 0.0 and old.h_pad_ref == 31.0 and old.var_lower_bound == 31.0
    w = solve_nodes(WlsProblem(vars_, pads=[old]), CFG.wls, CFG.building, dem_at=lambda x, y: 30.0)
    assert w.h["fp:B:1F"] >= 31.0 - 1e-9 and w.buildings["B"].lower_bound == 31.0
    pl = BuildingPad("B", "fp:B:1F", 31.0 + 7.8, "survey", 31.0, 7.8)  # ground plane reference 31, plinth 7.8
    w = solve_nodes(WlsProblem(vars_, pads=[pl]), CFG.wls, CFG.building, dem_at=lambda x, y: 30.0)
    b = w.buildings["B"]
    assert w.h["fp:B:1F"] >= 38.8 - 1e-9 and b.h_pad >= 31.0 - 1e-9
    assert b.pad_lower_bound == pytest.approx(31.0) and b.lower_bound == pytest.approx(38.8)


def test_ratchet_works_on_the_ground_plane():
    grid, feats = plinth_scene(1)
    cfg = with_overrides(CFG, {"building.ratchet": True})
    cm = campus_model(feats, ident)
    log = []
    pads, _ = building_pads(feats, ident, {}, grid, cm, cfg, log, {"fp:bldg_P:1F": 50.0})
    assert pads[0].plinth_m == pytest.approx(FH)
    assert pads[0].lower_bound == pytest.approx(50.0 - FH) and pads[0].var_lower_bound == pytest.approx(50.0)
    side = {"buildings": {"bldg_P": {"h1fM": 33.0}}}
    pads, _ = building_pads(feats, ident, side, grid, cm, CFG, log)
    assert pads[0].h_ref == 33.0 and pads[0].h_pad_ref == pytest.approx(33.0 - FH)
    assert pads[0].lower_bound == pytest.approx(33.0 - FH)


# ---------------------------------------------------------------- 3. 회귀: 문 1개·단일 층

def single_door_scene():
    grid = make_grid(X0, Y0, 80, 70, lambda X, Y: 30.0 + 0.04 * (X - X0) + 0.3 * np.sin((Y - Y0) / 6))
    feats = [building("bldg_S", [1], rect(X0 + 25, Y0 - 45, X0 + 50, Y0 - 25)),
             feat_node("n_far", X0 + 5, Y0 - 35), feat_node("n_door", X0 + 22, Y0 - 35),
             feat_node("n_S_1_main", X0 + 26, Y0 - 35, "bldg_S", 1, "entrance"),
             feat_edge("e_walk", "n_far", "n_door"), feat_edge("e_portal", "n_S_1_main", "n_door", edge_type="portal")]
    return grid, feats


def test_single_door_building_is_unchanged():
    grid, feats = single_door_scene()
    r = run_v2(feats, grid)
    w, g = r["w"], r["g"]
    assert g.stats["terraces"] == 0 and g.stats["terrace_wall_pairs"] == 0 and g.wall_segments is None
    (p,) = r["pad_list"]
    assert p.terraces == () and p.h == w.h["fp:bldg_S:1F"]
    # what the grid stage got before terraced pads: Pad(id, rings, H_1F) -> the same grid bit for bit
    old = grade_grid(grid, r["corr"], [Pad("bldg_S", r["rings_of"]["bldg_S"], w.h["fp:bldg_S:1F"])], CFG)
    for k in ("h", "residual", "road", "pad_id", "apron", "island", "mid", "unknown"):
        assert np.array_equal(getattr(g, k), getattr(old, k), equal_nan=True), k
    assert g.log == old.log
    assert {k: v for k, v in g.stats.items()} == {k: v for k, v in old.stats.items()}
    off = run_v2(feats, grid, with_overrides(CFG, {"building.terrace_enabled": False}))
    assert np.array_equal(off["g"].h, g.h, equal_nan=True)
    rep = r["rep"]["buildings"]["bldg_S"]
    assert [t["level"] for t in rep["terraces"]] == [1] and rep["terraces"][0]["supported"]
    assert rep["h_pad_m"] == rep["h_1f_m"] and rep["plinth_m"] == 0


def test_rasterize_pads_without_terraces_keeps_one_plane_per_pad():
    grid, _ = single_door_scene()
    ring = np.array(rect(X0 + 25, Y0 - 45, X0 + 50, Y0 - 25)[0], float)
    pr = rasterize_pads(grid, [Pad("A", (ring,), 31.0)], CFG.building)
    assert np.array_equal(pr.terrace_of >= 0, pr.pad_id >= 0) and list(pr.terrace_h) == [31.0]
    # a terrace whose plane is far from every cell keeps only the forced door cells
    t = Terrace(3, 60.0, ((X0 + 49.0, Y0 - 35.0),), 2.0)
    pr = rasterize_pads(grid, [Pad("A", (ring,), 31.0, (t,), 1, FH)], CFG.building)
    up = pr.terrace_of == 1
    xs, ys = grid.cell_centers()
    d = np.hypot(xs[None, :] - (X0 + 49.0), ys[:, None] - (Y0 - 35.0))
    assert up.any() and np.array_equal(up, (pr.pad_id >= 0) & (d <= CFG.building.entrance_ring_radius_m))
    # ... and with terraces off it is ignored
    pr = rasterize_pads(grid, [Pad("A", (ring,), 31.0, (t,), 1, FH)], with_overrides(CFG, {"building.terrace_enabled": False}).building)
    assert list(pr.terrace_h) == [31.0]


# ---------------------------------------------------------------- 4. 지지되지 않는 문

def hill_portals_scene():
    """test_node_wls hill_portals (1F door and 4F door with only 2 m of terrain between them) with a footprint."""
    import test_campus_constraints as t2
    feats = t2.building_campus() + [
        t2.feat_node("n_out_top", X0 + 30, Y0), t2.feat_node("n_E_4_entr", X0 + 27, Y0, "bldg_E", 4, "entrance"),
        t2.feat_edge("e_portal_top", "n_E_4_entr", "n_out_top", edge_type="portal")]
    feats[0]["geometry"] = {"type": "Polygon", "coordinates": rect(X0 + 2, Y0 - 6, X0 + 28, Y0 + 6)}
    return feats, make_grid(X0 - 30, Y0 + 30, 90, 60, lambda X, Y: 30.0 + 2.0 * (X >= X0 + 30))


def test_unsupported_door_makes_no_terrace():
    feats, grid = hill_portals_scene()
    r = run_v2(feats, grid)
    g, rep = r["g"], r["rep"]["buildings"]["bldg_E"]
    assert g.stats["terraces"] == 0
    row = next(t for t in rep["terraces"] if t["level"] == 4)
    assert row["supported"] is False and row["cells"] == 0 and "not supported" in row["reason"]
    assert f"plane {row['plane_m']:.2f} m, support {row['support_m']:.2f} m" in row["reason"]
    # support = DEM_0 at the door's outside point; that node sits exactly on the 2 m step edge, so the bilinear DEM_0 there
    # is mid-step (31.0 m) and not the 32.0 m of the cells behind it (test_portal_pads 의 장면 한계, 2026-11-17).
    assert row["support_m"] == pytest.approx(float(grid.sample_bilinear(X0 + 30, Y0)[0]), abs=1e-6)
    assert row["plane_m"] - row["support_m"] > CFG.building.terrace_tol_m
    assert any("4F door not supported by the terrain" in line for line in r["log"])
    assert any("4F door not supported by the terrain" in line for line in r["rep"]["log"])
    pad = g.pad_id >= 0
    assert np.all(g.h[pad] == r["w"].h["fp:bldg_E:1F"])  # one plane, as before
    assert any(line.startswith("vertical steps over") for line in g.log)  # the step at the 4F door is still logged
    top = next(c for c in rep["portal_contacts"] if c["edge_id"] == "e_portal_top")
    assert top["level"] == 4 and top["door_residual_m"] is not None
    # candidates are the pad level and the door levels (ground_levels is [1]); the 3F hall has no door
    assert [t["level"] for t in rep["terraces"]] == [1, 4]


def test_terrace_count_is_capped():
    grid = hill_grid()
    feats = hill_campus()
    cfg = with_overrides(CFG, {"building.terrace_max_levels": 1})
    r = run_v2(feats, grid, cfg)
    row = next(t for t in r["rep"]["buildings"]["bldg_H"]["terraces"] if t["level"] == 3)
    assert row["supported"] is False and "terrace_max_levels" in row["reason"] and r["g"].stats["terraces"] == 0


# ---------------------------------------------------------------- 5. 경계 분리

def test_terrace_boundary_is_a_wall_and_each_side_keeps_its_plane():
    grid = hill_grid()
    r = run_v2(hill_campus(), grid)
    g, w = r["g"], r["w"]
    h1, h3 = w.h["fp:bldg_H:1F"], w.h["fp:bldg_H:3F"]
    pad = g.pad_id >= 0
    # pad cell pairs across the boundary differ by a whole number of storeys
    a, b = g.h[:-1, :], g.h[1:, :]
    m = pad[:-1, :] & pad[1:, :] & (np.abs(a - b) > 0.5)
    assert m.any()
    steps = np.abs(a - b)[m]
    assert np.allclose(steps, 2 * FH, atol=0.05)
    # the boundary segments cut the grid links (attenuation 0), in the pad, the apron and the slope zone
    assert g.wall_segments is not None and len(g.wall_segments) > 0
    le, ls = breakline_links(grid, g.wall_segments, 0.0)
    assert np.all(ls[m] == 0)
    outside = ~pad
    side = outside[:-1, :] & outside[1:, :] & (ls == 0)
    assert side.any()
    # aprons beside the side walls: each side of the wall at its own terrace plane
    apron = g.apron
    xs, ys = grid.cell_centers()
    west = apron & (xs[None, :] < BX0) & (xs[None, :] > BX0 - 1.0)
    assert np.any(np.isclose(g.h[west], h1)) and np.any(np.isclose(g.h[west], h3))
    # the shoulder does not drag the high side down across the wall: compare with terrace_breakline off
    off = run_v2(hill_campus(), grid, with_overrides(CFG, {"building.terrace_breakline": False}))["g"]
    assert off.wall_segments is None
    # cells just west of the west apron, one row on each side of the wall
    col = int(np.argmin(np.abs(xs - (BX0 - 2.5))))
    rows = np.nonzero((ls[:, col] == 0))[0]
    assert len(rows)
    r_lo, r_hi = rows[0] + 1, rows[0]  # south of the wall (front, low) / north (back, high): row index grows to the south
    if g.h[r_hi, col] < g.h[r_lo, col]:
        r_lo, r_hi = r_hi, r_lo
    jump_on = g.h[r_hi, col] - g.h[r_lo, col]
    jump_off = off.h[r_hi, col] - off.h[r_lo, col]
    assert jump_on > jump_off + 0.5, (jump_on, jump_off)
    assert g.h[r_hi, col] > off.h[r_hi, col]  # the high side stays up


# ---------------------------------------------------------------- 6. 묻힌 면적 (테라스별)

def test_buried_area_never_grows_on_any_terrace():
    grid = hill_grid()
    r = run_v2(hill_campus(), grid)
    rep = r["rep"]["buildings"]["bldg_H"]
    ups = [t for t in rep["terraces"] if t["supported"]]
    assert len(ups) == 2
    for t in ups:
        assert t["buried_m2"] <= t["buried_ref_m2"] + 1e-9, t
        assert t["plane_m"] >= rep["h_pad_m"]
        k = round((t["plane_m"] - rep["h_pad_m"]) / FH)
        assert t["plane_m"] == pytest.approx(rep["h_pad_m"] + k * FH, abs=0.05)  # H_pad + k x floor height
    assert rep["buried_m2"] <= rep["buried_ref_m2"] + 1e-9
    assert rep["buried_m2"] < rep["buried_single_plane_m2"]  # the terraces bury far less than the one 1F plane
    # with a plinth the terraces ride on the ground plane, still never burying more than the reference
    r2 = run_v2(hill_campus(plinth=0.5), grid)
    rep2 = r2["rep"]["buildings"]["bldg_H"]
    assert rep2["plinth_m"] == pytest.approx(0.5 * FH)
    assert rep2["buried_m2"] <= rep2["buried_ref_m2"] + 1e-9
    for t in rep2["terraces"]:
        if t["supported"] and t.get("buried_m2") is not None:
            assert t["buried_m2"] <= t["buried_ref_m2"] + 1e-9


# ---------------------------------------------------------------- 8. 설정

def test_config_keys_and_validate():
    b = CFG.building
    assert (b.terrace_tol_m, b.terrace_min_cells, b.terrace_max_levels, b.door_sill_tol_m, b.terrace_breakline,
            b.terrace_enabled) == (0.6, 4, 3, 0.25, True, True)
    assert validate(CFG) == []
    for key, v in (("terrace_tol_m", 0.0), ("door_sill_tol_m", -1.0), ("terrace_min_cells", 0), ("terrace_max_levels", 0),
                   ("terrace_multiple_tol_m", 0.0)):
        bad = dataclasses.replace(CFG, building=dataclasses.replace(b, **{key: v}))
        assert len(validate(bad)) == 1, key
    with pytest.raises(ValueError):
        with_overrides(CFG, {"building.terrace_min_cells": 2.5})


def test_door_sill_residual_is_logged():
    """A door whose floor is far from the terrain in front (sill over door_sill_tol_m) is logged with its residual."""
    feats, grid = hill_portals_scene()
    r = run_v2(feats, grid)
    top = next(c for c in r["rep"]["buildings"]["bldg_E"]["portal_contacts"] if c["edge_id"] == "e_portal_top")
    assert top["door_residual_m"] > CFG.building.door_sill_tol_m
    assert any("door e_portal_top (4F)" in line and "sill residual" in line for line in r["rep"]["log"])
    # the supported hill doors stay quiet
    ok = run_v2(hill_campus(), hill_grid())
    assert not any("sill residual" in line for line in ok["log"])


# ---------------------------------------------------------------- 6·7. CLI와 solve_report

def test_cli_terraced_pads_report(tmp_path):
    from test_solver_v2_cli import EMPTY_STORE, cli, transforms

    to_grid, to_ll = transforms()
    gx, gy = to_grid.transform(127.04, 37.56)
    lonlat = lambda dx, dy: to_ll.transform(gx + dx, gy + dy)  # noqa: E731
    W, Hh = 110, 90
    xs = gx + (np.arange(W) + 0.5)
    ys = gy - (np.arange(Hh) + 0.5)
    X, Y = np.meshgrid(xs, ys)
    Grid(hill_dem(X - gx + X0, Y - gy + Y0), gx, gy, 1.0).save(tmp_path / "dem")
    camp = tmp_path / "campus"
    (camp / "buildings" / "H").mkdir(parents=True)
    fc = lambda feats: json.dumps({"type": "FeatureCollection", "features": feats})  # noqa: E731

    def ll(f):
        g = f["geometry"]
        if g["type"] == "Point":
            g["coordinates"] = list(lonlat(g["coordinates"][0] - X0, g["coordinates"][1] - Y0))
        elif g["type"] == "Polygon":
            g["coordinates"] = [[list(lonlat(x - X0, y - Y0)) for x, y in ring] for ring in g["coordinates"]]
        return f

    feats = [ll(f) for f in hill_campus(plinth=0)]
    bld = [f for f in feats if f["properties"]["kind"] == "building"]
    floor = [f for f in feats if f["properties"]["kind"] == "node" and f["properties"]["building_id"]]
    rest = [f for f in feats if f not in bld and f not in floor]
    (camp / "outdoor.geojson").write_text(fc(rest), encoding="utf-8")
    (camp / "buildings" / "H" / "building.geojson").write_text(fc(bld), encoding="utf-8")
    (camp / "buildings" / "H" / "L1.geojson").write_text(fc([f for f in floor if f["properties"]["level"] == 1]), encoding="utf-8")
    (camp / "buildings" / "H" / "L3.geojson").write_text(fc([f for f in floor if f["properties"]["level"] == 3]), encoding="utf-8")
    (tmp_path / "store.json").write_text(json.dumps(EMPTY_STORE), encoding="utf-8")
    side = {"format": "campo-elevation-buildings/1", "buildings": {"bldg_H": {}}, "measurements": []}
    (tmp_path / "side.json").write_text(json.dumps(side), encoding="utf-8")
    o = tmp_path / "o"
    r = cli("--engine", "v2", "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp,
            "--buildings", tmp_path / "side.json", "--out", o, "--derived-out", o / "elevation.json")
    assert r.stdout.isascii() and "terrace boundary 3F/1F" in r.stdout
    for name in ("corrected_dem.json", "corrected_dem.bin", "residual_field.json", "residual_field.bin", "store.solved.json",
                 "solve_report.json", "elevation.json"):
        assert (o / name).exists(), name
    rep = json.loads((o / "solve_report.json").read_text(encoding="utf-8"))
    assert rep["format"] == "campo-solve-report/1"
    b = rep["buildings"]["bldg_H"]
    for key in ("h_1f_m", "h_1f_ref_m", "ref_source", "lower_bound_m", "lower_bound_active", "sigma_b_m", "up_share",
                "buried_ref_m2", "buried_m2", "measurement_residuals_m"):  # the keys before terraced pads stay
        assert key in b, key
    assert b["plinth_m"] == 0 and b["h_pad_m"] == pytest.approx(b["h_1f_m"]) and b["h_pad_ref_m"] == pytest.approx(b["h_1f_ref_m"])
    sup = [t for t in b["terraces"] if t["supported"]]
    assert [t["level"] for t in sup] == [1, 3]
    for t in b["terraces"]:
        assert {"level", "plane_m", "cells", "source", "supported", "support_m", "boundary_step_m", "port_count"} <= set(t)
    assert {c["edge_id"] for c in b["portal_contacts"]} == {"e_portal_front", "e_portal_back"}
    for c in b["portal_contacts"]:
        assert {"edge_id", "level", "role", "door_residual_m"} <= set(c)
        assert abs(c["door_residual_m"]) <= 0.25
    assert rep["grid"]["terraces"] == 1 and rep["grid"]["terrace_wall_pairs"] > 0
    assert rep["grid"]["vertical_steps_over_limit"] == 0 or rep["grid"]["max_vertical_step_m"] <= 0.5
    assert rep["config"]["building"]["terrace_tol_m"] == 0.6
    assert any("terrace boundary" in line for line in rep["log"])
    assert all(isinstance(v, (int, float)) and math.isfinite(v) for v in
               (t["plane_m"] for t in sup))


# ---------------------------------------------------------------- 3·4. 후보·배정 세부

def test_two_doors_on_one_level_make_one_terrace_and_a_door_less_ground_level_none():
    feats = hill_campus() + [
        feat_node("n_back2", X0 + 45, BY_BACK + 4), feat_node("n_H_3_back2", X0 + 45, BY_BACK - 1, "bldg_H", 3, "entrance"),
        feat_edge("e_portal_back2", "n_H_3_back2", "n_back2", edge_type="portal")]
    feats[0]["properties"]["ground_levels"] = [1, 2, 3]  # 2F claims to touch the ground but has no door
    r = run_v2(feats, hill_grid())
    rows = {t["level"]: t for t in r["rep"]["buildings"]["bldg_H"]["terraces"]}
    assert set(rows) == {1, 2, 3}
    assert rows[3]["supported"] and rows[3]["port_count"] == 2 and r["g"].stats["terraces"] == 1
    assert rows[2]["supported"] is False and rows[2]["source"] == "ground_level" and "no door" in rows[2]["reason"]


def test_small_pieces_merge_and_door_cells_are_forced():
    from grid_grading import assign_terraces
    # a 2-cell bump at the upper plane inside the low half merges back into the base; door cells are forced
    def dem(X, Y):
        z = 30.0 + 0.0 * X
        z[(np.abs(X - (X0 + 10.5)) < 1.0) & (np.abs(Y - (Y0 - 10.5)) < 0.6)] = 37.8
        return z
    grid = make_grid(X0, Y0, 30, 30, dem)
    m = rasterize_polygon(grid, [np.array(rect(X0 + 2, Y0 - 25, X0 + 25, Y0 - 2)[0], float)])
    lab, log = assign_terraces(grid, m, [30.0, 37.8], [(), ()], CFG.building)
    assert np.all(lab[m] == 0) and any("merged" in line for line in log)
    lab, _ = assign_terraces(grid, m, [30.0, 37.8], [(), ((X0 + 24.0, Y0 - 13.0),)], CFG.building)
    xs, ys = grid.cell_centers()
    d = np.hypot(xs[None, :] - (X0 + 24.0), ys[:, None] - (Y0 - 13.0))
    assert np.array_equal(lab == 1, m & (d <= CFG.building.entrance_ring_radius_m))


def test_step_that_is_not_a_floor_multiple_warns():
    grid = hill_grid()
    ring = np.array(rect(BX0, BY_FRONT, BX1, BY_BACK)[0], float)
    for plane, warn in ((30.0 + 2 * FH, False), (30.0 + 2 * FH - 0.3, True)):
        t = Terrace(3, plane, ((X0 + 55, BY_BACK - 1),), 2.0)
        g = grade_grid(grid, Corridors.empty(), [Pad("bldg_H", (ring,), 30.0, (t,), 1, FH)], CFG)
        assert any("terrace boundary 3F/1F" in line for line in g.log)
        assert any("warning: terrace boundary 3F/1F" in line and "is not 2 x 3.90 m" in line for line in g.log) == warn
