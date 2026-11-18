"""
실행:  cd tools/elevation && python -m pytest -q test_terrace_edges.py

적대적(adversarial) 엣지케이스: 다단 대지·기반층·옹벽 경계의 경계값과 기하 모순.
 1) 비볼록(ㄱ자) 건물 폴리곤에서 테라스 분할과 옹벽 선분이 실제 단차 위에만 놓이는지
 2) 포탈이 건물 levels에 없는 층을 가리킬 때(층 평면이 대지 접지면보다 낮게 풀리는 경우) 역전된 테라스가 생기지 않는지
 3) 대지 셀이 모두 위 테라스로 가서 base 테라스가 셀을 갖지 못할 때 보고가 supported=False인지
 4) 급경사 지형에서도 문 지지값이 문 바깥 지점의 DEM₀을 써서 경사만큼 치우치지 않는지(수정 반영)
 5) 겹치는 건물 폴리곤(앞 대지가 셀을 가져감)
 6) 실지형 재현: 급경사 + 1F/3F 출입구 + 건물 2 m 옆 도로를 CLI v2로 끝까지
좌표는 격자 CRS 미터를 그대로 쓴다(project = 항등). CLI 장면만 경위도로 쓴다.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from campo_grid import Grid  # noqa: E402
from grid_grading import breakline_links, rasterize_polygon  # noqa: E402
from test_campus_constraints import X0, Y0, feat_edge, feat_node, ident  # noqa: E402
from test_portal_pads import CFG, FH, building, make_grid, plinth_scene, rect, run_v2  # noqa: E402

ERROR = CFG.building.terrace_multiple_tol_m


def pad_planes(g):
    pad = g.pad_id >= 0
    return sorted(np.unique(np.round(g.h[pad], 6)).tolist())


def heights_of(r, bid):
    b = r["rep"]["buildings"][bid]
    return {t["level"]: t for t in b["terraces"]}


# ---------------------------------------------------------------- 1. 비볼록(ㄱ자) 폴리곤

L_OUT = [[X0 + 40, Y0 - 50], [X0 + 80, Y0 - 50], [X0 + 80, Y0 - 30], [X0 + 40, Y0 - 30], [X0 + 40, Y0 - 50]]
L_NOTCH = [[X0 + 60, Y0 - 41], [X0 + 60, Y0 - 30], [X0 + 80, Y0 - 30], [X0 + 80, Y0 - 41], [X0 + 60, Y0 - 41]]


def l_scene():
    """L-shaped footprint (the NE corner is a notch) on a terrain that steps 7.8 m at x = X0 + 60."""
    grid = make_grid(X0, Y0, 110, 90, lambda X, Y: np.where(X < X0 + 60, 30.0, 37.8))
    feats = [building("bldg_L", [1, 2, 3], [L_OUT, L_NOTCH]),
             feat_node("n_s", X0 + 50, Y0 - 53), feat_node("n_L_1", X0 + 50, Y0 - 49, "bldg_L", 1, "entrance"),
             feat_edge("e_portal_s", "n_L_1", "n_s", edge_type="portal", door_role="front"),
             feat_node("n_e", X0 + 83, Y0 - 46), feat_node("n_L_3", X0 + 79, Y0 - 46, "bldg_L", 3, "entrance"),
             feat_edge("e_portal_e", "n_L_3", "n_e", edge_type="portal", door_role="back")]
    return grid, feats


def test_l_shaped_terrace_boundary_lies_on_the_step():
    grid, feats = l_scene()
    r = run_v2(feats, grid)
    g, w = r["g"], r["w"]
    h1, h3 = w.h["fp:bldg_L:1F"], w.h["fp:bldg_L:3F"]
    assert h3 - h1 == pytest.approx(2 * FH, abs=0.05)
    assert pad_planes(g) == pytest.approx([h1, h3])
    rows = heights_of(r, "bldg_L")
    assert set(rows) == {1, 3}
    assert rows[1]["supported"] and rows[3]["supported"]
    assert rows[1]["cells"] > 100 and rows[3]["cells"] > 100
    assert rows[1]["cells"] + rows[3]["cells"] == int((g.pad_id >= 0).sum())
    # the notch is not a pad, and the terrace never leaks into the other arm
    xs, ys = grid.cell_centers()
    notch = (xs[None, :] > X0 + 61) & (ys[:, None] > Y0 - 40)
    assert not (g.pad_id >= 0)[notch].any()
    west_arm = (g.pad_id >= 0) & (xs[None, :] < X0 + 57) & (ys[:, None] > Y0 - 41)
    east_arm = (g.pad_id >= 0) & (xs[None, :] > X0 + 63) & (ys[:, None] < Y0 - 42)
    assert np.allclose(g.h[west_arm], h1) and np.allclose(g.h[east_arm], h3)
    # no terrain step is left over inside the footprint: the only step is the retaining wall
    assert g.stats["vertical_steps_over_limit"] == 0
    assert g.stats["terrace_wall_pairs"] > 0
    assert g.stats["max_terrace_wall_m"] == pytest.approx(2 * FH, abs=0.05)
    assert any("terrace boundary 3F/1F step 7.80 m = 2.0 x 3.90 m" in line for line in g.log)
    # every link the wall segments cut between two pad cells really separates the two terrace planes
    # (no crossed, duplicated or inverted wall line)
    assert g.wall_segments is not None and len(g.wall_segments) > 0
    pad = g.pad_id >= 0
    le, ls = breakline_links(grid, g.wall_segments, 0.0)
    e_both = (le == 0) & pad[:, :-1] & pad[:, 1:]
    s_both = (ls == 0) & pad[:-1, :] & pad[1:, :]
    across = np.concatenate([np.abs(g.h[:, :-1] - g.h[:, 1:])[e_both], np.abs(g.h[:-1, :] - g.h[1:, :])[s_both]])
    assert across.size >= 5
    assert np.allclose(across, 2 * FH, atol=0.05), across
    # and no pad cell pair of the two planes is left uncut inside the footprint
    pair = pad[:, :-1] & pad[:, 1:] & (np.abs(g.h[:, :-1] - g.h[:, 1:]) > 1.0)
    assert np.all(e_both[pair])
    pair = pad[:-1, :] & pad[1:, :] & (np.abs(g.h[:-1, :] - g.h[1:, :]) > 1.0)
    assert np.all(s_both[pair])
    # the wall inside the footprint follows the terrain step line (x = X0 + 60), not a scrambled or crossed line
    e_cols = np.nonzero(e_both.any(axis=0))[0]
    assert e_both.any() and e_both.sum() >= 6
    assert np.all(np.abs(np.array([xs[c] for c in e_cols]) - (X0 + 60)) <= 0.5)


# ---------------------------------------------------------------- 2. 층 평면이 접지면 아래로 풀리는 경우

def missing_level_scene():
    """A portal on 2F while the building has levels [1, 3]: the 2F floor plane has no floor prior chain."""
    grid = make_grid(X0, Y0, 80, 70, lambda X, Y: 30.0 + 0.05 * (X - X0))
    feats = [building("bldg_B", [1, 3], rect(X0 + 25, Y0 - 45, X0 + 50, Y0 - 25)),
             feat_node("n_out", X0 + 22, Y0 - 35), feat_node("n_B_2", X0 + 26, Y0 - 35, "bldg_B", 2, "entrance"),
             feat_edge("e_portal_b", "n_B_2", "n_out", edge_type="portal")]
    return grid, feats


def test_floor_plane_below_the_pad_ground_plane_is_not_a_terrace():
    grid, feats = missing_level_scene()
    r = run_v2(feats, grid)
    g, w = r["g"], r["w"]
    h1, h2 = w.h["fp:bldg_B:1F"], w.h["fp:bldg_B:2F"]
    assert h2 < h1  # the door level was not in levels, so nothing keeps its floor above 1F
    row = heights_of(r, "bldg_B")[2]
    assert row["supported"] is False and row["cells"] == 0
    assert f"2F plane {row['plane_m']:.2f} m is at or below the pad ground plane" in row["reason"]
    assert any("is at or below the pad ground plane" in line for line in r["log"])
    # the pad is one plane: nothing is dug below the pad ground plane and no retaining wall is invented
    assert pad_planes(g) == [pytest.approx(h1)]
    assert g.stats["terraces"] == 0 and g.stats["terrace_wall_pairs"] == 0 and g.wall_segments is None
    assert not any("terrace boundary" in line for line in g.log)
    pad = g.pad_id >= 0
    assert np.all(g.h[pad] >= h1 - 1e-9)


def step_terrace_scene(levels, door_level, step=FH):
    """A building on a step of `step` m at x = X0 + 37: a 1F door west, a door of door_level east."""
    grid = make_grid(X0, Y0, 90, 70, lambda X, Y: np.where(X < X0 + 37, 30.0, 30.0 + step))
    feats = [building("bldg_B", levels, rect(X0 + 25, Y0 - 45, X0 + 50, Y0 - 25)),
             feat_node("n_w", X0 + 22, Y0 - 35), feat_node("n_B_1", X0 + 26, Y0 - 35, "bldg_B", 1, "entrance"),
             feat_edge("e_portal_w", "n_B_1", "n_w", edge_type="portal"),
             feat_node("n_e", X0 + 53, Y0 - 35),
             feat_node(f"n_B_{door_level}", X0 + 49, Y0 - 35, "bldg_B", door_level, "entrance"),
             feat_edge("e_portal_e", f"n_B_{door_level}", "n_e", edge_type="portal")]
    return grid, feats


def test_a_plane_above_the_base_is_still_a_terrace():
    """The new rule is only a lower bound on the plane: a real upper door one storey up is unaffected."""
    grid, feats = step_terrace_scene([1, 2, 3], 2, FH)
    r = run_v2(feats, grid)
    h1, h2 = r["w"].h["fp:bldg_B:1F"], r["w"].h["fp:bldg_B:2F"]
    assert h2 - h1 == pytest.approx(FH, abs=0.05)
    row = heights_of(r, "bldg_B")[2]
    assert row["supported"] is True and row["cells"] > 0
    assert pad_planes(r["g"]) == pytest.approx(sorted([h1, h2]))
    assert r["g"].stats["terraces"] == 1


# ---------------------------------------------------------------- 3. base 테라스가 셀을 잃는 경우

def tower_scene():
    """A 6 m x 6 m tower with only a 3F door on a 7.8 m step: every pad cell is forced to the 3F terrace."""
    grid = make_grid(X0, Y0, 70, 70, lambda X, Y: np.where(Y < Y0 - 24, 30.0, 37.8))
    feats = [building("tower", [1, 2, 3], rect(X0 + 20, Y0 - 27, X0 + 26, Y0 - 21), ground_levels=[1]),
             feat_node("n_out", X0 + 23, Y0 - 19), feat_node("n_T_3", X0 + 23, Y0 - 22, "tower", 3, "entrance"),
             feat_edge("e_T", "n_T_3", "n_out", edge_type="portal")]
    return grid, feats


def test_base_terrace_that_keeps_no_cell_is_reported_unsupported():
    grid, feats = tower_scene()
    r = run_v2(feats, grid)
    g, rep = r["g"], r["rep"]["buildings"]["tower"]
    rows = {t["level"]: t for t in rep["terraces"]}
    assert rows[1]["supported"] is False and rows[1]["cells"] == 0
    assert rows[1]["reason"] == "1F terrace keeps no pad cell"
    assert rows[3]["supported"] is True and rows[3]["cells"] == int((g.pad_id >= 0).sum()) == 36
    assert [(t["level"], t["cells"]) for t in g.terraces] == [(1, 0), (3, 36)]
    assert pad_planes(g) == pytest.approx([r["w"].h["fp:tower:3F"]])
    # a terrace with no cell is not sold as a supported terrace any more
    assert [t["level"] for t in rep["terraces"] if t["supported"]] == [3]


# ---------------------------------------------------------------- 4. 급경사에서 문 지지값 (문 바깥 지점 DEM₀)

def test_upper_door_on_a_linear_slope_is_supported():
    grade = 0.5
    y0 = -46.0                     # terrain 30.0 m here
    y_out = y0 + 7.8 / grade       # 3F outside point: terrain exactly 37.8 m
    grid = make_grid(X0, Y0, 100, 100, lambda X, Y: 30.0 + grade * np.clip(Y - (Y0 + y0), 0.0, None))
    feats = [building("bldg_S", [1, 2, 3], rect(X0 + 30, Y0 + y0, X0 + 50, Y0 + y_out - 1.0), ground_levels=[1]),
             feat_node("n_1_out", X0 + 40, Y0 + y0 - 1.0), feat_node("n_S_1", X0 + 40, Y0 + y0 + 1.0, "bldg_S", 1, "entrance"),
             feat_edge("e_portal_1", "n_S_1", "n_1_out", edge_type="portal"),
             feat_node("n_3_out", X0 + 40, Y0 + y_out), feat_node("n_S_3", X0 + 40, Y0 + y_out - 2.0, "bldg_S", 3, "entrance"),
             feat_edge("e_portal_3", "n_S_3", "n_3_out", edge_type="portal")]
    r = run_v2(feats, grid)
    row = heights_of(r, "bldg_S")[3]
    assert row["supported"] is True, row["reason"]
    assert r["g"].stats["terraces"] == 1


def test_door_support_reads_the_outside_point_dem_not_the_half_disc():
    """The same scene as above: the support comes from the outside point, so there is no slope bias left in it."""
    grade = 0.5
    y0 = -46.0
    y_out = y0 + 7.8 / grade
    grid = make_grid(X0, Y0, 100, 100, lambda X, Y: 30.0 + grade * np.clip(Y - (Y0 + y0), 0.0, None))
    feats = [building("bldg_S", [1, 2, 3], rect(X0 + 30, Y0 + y0, X0 + 50, Y0 + y_out - 1.0), ground_levels=[1]),
             feat_node("n_1_out", X0 + 40, Y0 + y0 - 1.0), feat_node("n_S_1", X0 + 40, Y0 + y0 + 1.0, "bldg_S", 1, "entrance"),
             feat_edge("e_portal_1", "n_S_1", "n_1_out", edge_type="portal"),
             feat_node("n_3_out", X0 + 40, Y0 + y_out), feat_node("n_S_3", X0 + 40, Y0 + y_out - 2.0, "bldg_S", 3, "entrance"),
             feat_edge("e_portal_3", "n_S_3", "n_3_out", edge_type="portal")]
    r = run_v2(feats, grid)
    row = heights_of(r, "bldg_S")[3]
    plane, support = row["plane_m"], row["support_m"]
    # the DEM at the door's outside point is what the door stands on, and that is the support now
    outside_dem = float(grid.sample_bilinear(X0 + 40, Y0 + y_out)[0])
    assert outside_dem == pytest.approx(37.8, abs=0.3)
    assert support == pytest.approx(outside_dem, abs=0.05)
    assert plane == pytest.approx(37.8, abs=0.5)
    # ... where the 5 m half disc median would read the upslope half and land ~1 m above the door
    assert abs(support - plane) <= CFG.building.terrace_tol_m
    assert row["supported"] is True and "not supported by the terrain" not in (row.get("reason") or "")


# ---------------------------------------------------------------- 5. 겹치는 건물 폴리곤

def overlapping_scene():
    """A small building inside a bigger one's footprint: the earlier pad keeps the shared cells."""
    grid = make_grid(X0, Y0, 90, 80, lambda X, Y: 30.0 + 0.05 * (X - X0) + 0.4 * np.cos((Y - Y0) / 9.0))
    feats = [building("bldg_M", [1, 2], rect(X0 + 20, Y0 - 55, X0 + 60, Y0 - 20)),
             building("bldg_N", [1], rect(X0 + 30, Y0 - 45, X0 + 40, Y0 - 35)),
             feat_node("n_out", X0 + 17, Y0 - 38), feat_node("n_M_1", X0 + 21, Y0 - 38, "bldg_M", 1, "entrance"),
             feat_edge("e_M", "n_M_1", "n_out", edge_type="portal"),
             feat_node("n_out2", X0 + 35, Y0 - 47), feat_node("n_N_1", X0 + 35, Y0 - 44, "bldg_N", 1, "entrance"),
             feat_edge("e_N", "n_N_1", "n_out2", edge_type="portal")]
    return grid, feats


def test_overlapping_footprints_keep_the_cells_with_the_earlier_pad():
    grid, feats = overlapping_scene()
    r = run_v2(feats, grid)
    g, rep = r["g"], r["rep"]["buildings"]
    ids = {p.building_id: i for i, p in enumerate(r["pad_list"])}
    assert set(ids) == {"bldg_M", "bldg_N"}
    inside_n = rasterize_polygon(grid, r["rings_of"]["bldg_N"])
    assert inside_n.sum() > 50
    assert np.all(g.pad_id[inside_n] == ids["bldg_M"])  # the earlier pad keeps the shared cells
    assert any("100 cell(s) overlap an earlier pad, kept by the earlier one" in line for line in g.log)
    assert any("building bldg_N: pad raster is empty -> no pad" in line for line in g.log)
    # the pad that owns no cell reports no terrace, and the owning pad is one plane
    assert rep["bldg_N"]["terraces"][0]["supported"] is False
    assert rep["bldg_N"]["terraces"][0]["cells"] == 0
    assert rep["bldg_M"]["terraces"][0]["cells"] == int((g.pad_id == ids["bldg_M"]).sum())
    assert g.stats["terraces"] == 0 and g.stats["terrace_wall_pairs"] == 0


# ---------------------------------------------------------------- 7. 기반층과 대지 레벨 문

PLINTH_XFAIL = pytest.mark.xfail(strict=True, reason=(
    "plinth_floors is only known to the pad lower bound (node_wls.BuildingPad). The pad-level portal keeps its dh = 0 "
    "soft_flat and campus_corridors starts at H(pad level), so the road in front of a ground-level door is fixed on a "
    "plinth-high ramp (4.83 m step, sill residual +6.93 m logged). Fix: give the pad-level portal an offset of +plinth "
    "(Edge.off_from/off_to) and start its corridor at H - plinth.") )


def plinth_road_strip(g, grid):
    xs, ys = grid.cell_centers()
    from test_campus_constraints import X0, Y0
    return (xs[None, :] > X0 + 20.5) & (xs[None, :] < X0 + 24.5) & (np.abs(ys[:, None] - (Y0 - 35)) < 1.0)


@PLINTH_XFAIL
def test_plinth_building_pad_level_door_keeps_the_ground_in_front():
    """With plinth floors the ground plane in front of a pad-level door is H - plinth: the door must stand on it."""
    grid, feats = plinth_scene(2)
    r = run_v2(feats, grid)
    g = r["g"]
    b = r["rep"]["buildings"]["bldg_P"]
    assert b["plinth_m"] == pytest.approx(2 * FH)
    assert b["h_pad_m"] == pytest.approx(b["h_pad_ref_m"], abs=1e-6)
    strip = plinth_road_strip(g, grid)
    assert np.all(np.abs(g.h[strip] - b["h_pad_m"]) < 0.5), g.h[strip]
    assert abs(b["portal_contacts"][0]["door_residual_m"]) <= CFG.building.door_sill_tol_m
    assert g.stats["vertical_steps_over_limit"] == 0


def test_plinth_door_ramp_is_the_documented_cause():
    """The same scene without the xfail: what the pipeline does today (the ground in front of the door is a ramp)."""
    grid, feats = plinth_scene(2)
    r = run_v2(feats, grid)
    g, b = r["g"], r["rep"]["buildings"]["bldg_P"]
    strip = plinth_road_strip(g, grid)
    # the pad is right (the bound holds), but the portal corridor is fixed from H(1F) down to the outside node
    assert b["h_pad_m"] == pytest.approx(b["h_pad_ref_m"], abs=1e-6)
    assert g.road[strip].any()
    assert g.h[strip].max() - b["h_pad_m"] > 1.5  # a road cell 2 m in front of the door sits plinth-high
    assert b["portal_contacts"][0]["door_residual_m"] > 5.0
    assert any("sill residual" in line and "(1F)" in line for line in r["log"])  # not silent
    assert g.stats["vertical_steps_over_limit"] > 0


# ---------------------------------------------------------------- 6. 실지형 재현 (CLI v2)

G1F, G3F = 30.0, 37.8      # lower bench (south) and the bench behind the building
WALL_Y = -36.0             # the terrain steps here (a retaining wall in the DEM)
BY0, BY1 = -40.0, -26.0    # south wall on the 1F bench, north wall on the 3F bench
BENCH_N = 18.0             # the 3F bench ends here; a 0.6 grade slope runs up behind it
FRONT_ROAD_Y = BY0 - 2.0   # the street runs 2 m from the south wall
BACK_ROAD_Y = WALL_Y + 10.0


def scene_dem(dY):
    z = np.where(dY < WALL_Y, G1F + 0.08 * np.clip(dY - (BY0 - 4), 0, None), G3F)
    return np.where(dY > BENCH_N, G3F + 0.6 * (dY - BENCH_N), z)


def hanyang_scene(tmp_path):
    """Steep hillside + a 1F street door and a 3F back door + a street 2 m from the wall, as a campus folder."""
    from test_solver_v2_cli import EMPTY_STORE, transforms

    to_grid, to_ll = transforms()
    gx, gy = to_grid.transform(127.045, 37.557)
    lonlat = lambda dx, dy: to_ll.transform(gx + dx, gy + dy)  # noqa: E731
    xs = gx - 40 + (np.arange(120) + 0.5)
    ys = gy + 60 - (np.arange(120) + 0.5)
    X, Y = np.meshgrid(xs, ys)
    Grid(scene_dem(Y - gy), gx - 40, gy + 60, 1.0).save(tmp_path / "dem")
    b = building("bldg_S", [1, 2, 3], [[[BX0, BY0], [BX1, BY0], [BX1, BY1], [BX0, BY1], [BX0, BY0]]],
                 ground_levels=[1], floor_height_m=FH) if False else None
    b = building("bldg_S", [1, 2, 3], [[[0.0, BY0], [20.0, BY0], [20.0, BY1], [0.0, BY1], [0.0, BY0]]], ground_levels=[1])
    b["properties"]["ext"] = {"floor_height_m": FH}
    feats = [b,
             feat_node("n_1_out", 10.0, BY0 - 1.0), feat_node("n_S_1", 10.0, BY0 + 1.0, "bldg_S", 1, "entrance"),
             feat_edge("e_portal_s", "n_S_1", "n_1_out", edge_type="portal", door_role="front"),
             feat_node("n_1_road", 10.0, FRONT_ROAD_Y), feat_edge("e_walk_s", "n_1_out", "n_1_road"),
             feat_node("n_fr_w", -30.0, FRONT_ROAD_Y), feat_node("n_fr_e", 70.0, FRONT_ROAD_Y),
             feat_edge("e_front_w", "n_fr_w", "n_1_road"), feat_edge("e_front_e", "n_1_road", "n_fr_e"),
             feat_node("n_3_out", 10.0, BY1 + 2.0), feat_node("n_S_3", 10.0, BY1 - 1.0, "bldg_S", 3, "entrance"),
             feat_edge("e_portal_n", "n_S_3", "n_3_out", edge_type="portal", door_role="back"),
             feat_node("n_3_road", 10.0, BACK_ROAD_Y), feat_edge("e_walk_n", "n_3_out", "n_3_road"),
             feat_node("n_bk_w", -30.0, BACK_ROAD_Y), feat_node("n_bk_e", 70.0, BACK_ROAD_Y),
             feat_edge("e_back_w", "n_bk_w", "n_3_road"), feat_edge("e_back_e", "n_3_road", "n_bk_e"),
             feat_node("n_S_1_low", 4.0, BY1 - 6.0, "bldg_S", 1), feat_node("n_S_2_mid", 4.0, BY1 - 8.0, "bldg_S", 2),
             feat_edge("e_stair", "n_S_1_low", "n_S_2_mid", highway="steps", edge_type="indoor", step_count=24, incline="up")]

    def ll(f):
        g = f["geometry"]
        if g["type"] == "Point":
            g["coordinates"] = list(lonlat(*g["coordinates"]))
        elif g["type"] == "Polygon":
            g["coordinates"] = [[list(lonlat(x, y)) for x, y in ring] for ring in g["coordinates"]]
        return f

    feats = [ll(f) for f in feats]
    bld = [f for f in feats if f["properties"]["kind"] == "building"]
    floor = [f for f in feats if f["properties"]["kind"] == "node" and f["properties"]["building_id"]]
    rest = [f for f in feats if f not in bld and f not in floor]
    camp = tmp_path / "campus"
    (camp / "buildings" / "S").mkdir(parents=True)

    def fc(fe):
        return json.dumps({"type": "FeatureCollection", "features": fe})

    (camp / "outdoor.geojson").write_text(fc(rest), encoding="utf-8")
    (camp / "buildings" / "S" / "building.geojson").write_text(fc(bld), encoding="utf-8")
    for lv in (1, 2, 3):
        (camp / "buildings" / "S" / f"L{lv}.geojson").write_text(
            fc([f for f in floor if f["properties"]["level"] == lv]), encoding="utf-8")
    (tmp_path / "store.json").write_text(json.dumps(EMPTY_STORE), encoding="utf-8")
    (tmp_path / "side.json").write_text(json.dumps({"format": "campo-elevation-buildings/1",
                                                    "buildings": {"bldg_S": {}}, "measurements": []}), encoding="utf-8")
    return camp, (gx, gy)


def test_hanyang_like_hillside_scene_end_to_end(tmp_path):
    from test_solver_v2_cli import cli

    camp, (gx, gy) = hanyang_scene(tmp_path)
    o = tmp_path / "o"
    r = cli("--engine", "v2", "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp,
            "--buildings", tmp_path / "side.json", "--out", o, "--derived-out", o / "elevation.json")
    assert r.stdout.isascii()
    rep = json.loads((o / "solve_report.json").read_text(encoding="utf-8"))
    b = rep["buildings"]["bldg_S"]
    sup = {t["level"]: t for t in b["terraces"] if t["supported"]}
    assert set(sup) == {1, 3}
    h1, h3 = sup[1]["plane_m"], sup[3]["plane_m"]
    assert h1 == pytest.approx(G1F, abs=0.5) and h3 == pytest.approx(G3F, abs=0.6)
    assert h3 - h1 == pytest.approx(2 * FH, abs=0.1)
    for lv, t in sup.items():
        if lv != 1:  # the base support is the whole ring median, for the report only
            assert abs(t["support_m"] - t["plane_m"]) <= CFG.building.terrace_tol_m
    assert sup[1]["cells"] > 50 and sup[3]["cells"] > 50
    # the door sills sit on the terrain in front of them
    for c in b["portal_contacts"]:
        assert abs(c["door_residual_m"]) <= CFG.building.door_sill_tol_m, c
    # one retaining wall of two storeys, counted apart from the terrain steps
    assert rep["grid"]["terraces"] == 1
    assert rep["grid"]["terrace_wall_pairs"] > 0
    assert rep["grid"]["max_terrace_wall_m"] == pytest.approx(2 * FH, abs=0.1)
    assert rep["grid"]["vertical_steps_over_limit"] == 0
    assert rep["grid"]["cg_converged"] == 1
    # the grid: no hole where the DEM has a value, the pad has the two terrace planes, the streets keep their target
    dem = Grid.load(tmp_path / "dem.json")
    corr = Grid.load(o / "corrected_dem.json")
    assert not np.isnan(corr.data[np.isfinite(dem.data)]).any()
    xs = gx - 40 + (np.arange(dem.width) + 0.5)
    ys = gy + 60 - (np.arange(dem.height) + 0.5)
    pad = ((xs[None, :] > 2.0 + gx) & (xs[None, :] < 18.0 + gx)
           & (ys[:, None] > BY0 + 1 + gy) & (ys[:, None] < BY1 - 1 + gy))
    planes = np.unique(np.round(corr.data[pad], 6))
    assert len(planes) == 2 and np.allclose(sorted(planes), sorted([h1, h3]), atol=1e-6)
    front = np.abs(ys - (FRONT_ROAD_Y + gy)) < 1.0
    assert np.all(np.abs(corr.data[front] - G1F) < 0.6)  # the 1F street 2 m from the wall stays at the 1F bench
    back = np.abs(ys - (BACK_ROAD_Y + gy)) < 1.0
    assert np.all(np.abs(corr.data[back] - G3F) < 0.6)
    # the stair prior is still solved through the terrace floors
    assert rep["stairs"]["e_stair"]["riser_m"] == pytest.approx(0.16, abs=0.01)
    assert json.loads((o / "elevation.json").read_text(encoding="utf-8"))["engine"] == "campo-height-solver/2"
