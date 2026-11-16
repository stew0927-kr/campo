"""
실행:  cd tools/elevation && python -m pytest -q test_campus_constraints.py

캠퍼스 제약(docs/ELEVATION_INTEGRATION.md): 층고 prior(기본 3.9 m), 계단 칸 수·기압 실측 우선, flat_exact 강한 제약,
표시 없는 footway의 1 % 평지 보정, Break-line 측면 분리, 지연 재계산(성분·타일), derived/elevation.json, CLI.
좌표는 격자 CRS 미터를 그대로 쓴다(project = 항등).
"""
import json
import math
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from campo_grid import Grid  # noqa: E402
from campo_height_solver import (  # noqa: E402
    DEFAULT_FLOOR_HEIGHT_M, Breakline, Edge, ResidualCenter, breakline_drop_edges, campus_model, derived_elevation, dirty_seeds,
    dirty_tiles, floor_id_of_level, residual_field, solve_heights, store_breaklines, storeys_between, update_tiles,
)

X0, Y0 = 203000.0, 552000.0
ident = lambda lon, lat: (lon, lat)  # noqa: E731  (features carry grid metres directly)


def feat_node(nid, x, y, building=None, level=None, node_type=None):
    nt = node_type or ("outdoor" if building is None else "corridor")
    return {"type": "Feature", "id": nid, "geometry": {"type": "Point", "coordinates": [x, y]},
            "properties": {"kind": "node", "node_type": nt, "building_id": building, "level": level, "source": "t", "rev": 1}}


def feat_edge(eid, a, b, **props):
    p = {"kind": "edge", "highway": "footway", "edge_type": "outdoor", "from": a, "to": b, "bidirectional": True,
         "step_free": True, "source": "t", "rev": 1, **props}
    return {"type": "Feature", "id": eid, "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]}, "properties": p}


def feat_building(bid, levels, **ext):
    p = {"kind": "building", "name": bid, "code": bid, "levels": levels, "ground_levels": levels[:1], "source": "t", "rev": 1}
    if ext:
        p["ext"] = ext
    return {"type": "Feature", "id": bid, "geometry": {"type": "Polygon", "coordinates": []}, "properties": p}


def solve(cm, extra_nodes=(), extra_edges=(), dem_fn=None, **kw):
    return solve_heights([*cm.nodes, *extra_nodes], [*cm.edges, *extra_edges], dem_fn=dem_fn or (lambda x, y: 30.0),
                         soft_flat=cm.soft_flat, sigma_dem_scale=cm.sigma_dem_scale, **kw)


def building_campus(**ext):
    """A building of 4 floors with one portal on 1F to an outdoor point, nothing measured inside."""
    return [
        feat_building("bldg_E", [1, 2, 3, 4], **ext),
        feat_node("n_out_door", X0, Y0),
        feat_node("n_E_1_entr", X0 + 3, Y0, "bldg_E", 1, "entrance"),
        feat_node("n_E_3_hall", X0 + 10, Y0, "bldg_E", 3),
        feat_edge("e_portal", "n_E_1_entr", "n_out_door", edge_type="portal"),
    ]


# ---------------------------------------------------------------- 층고 prior

def test_level_helpers_match_core():
    assert [floor_id_of_level(v) for v in (1, 3, -1, -2)] == ["1F", "3F", "B1", "B2"]
    with pytest.raises(ValueError):
        floor_id_of_level(0)
    assert storeys_between(-1, 1) == 1 and storeys_between(1, 4) == 3 and storeys_between(-2, 2) == 3


def test_unmeasured_floors_follow_the_default_floor_height_and_do_not_diverge():
    cm = campus_model(building_campus(), ident)
    res = solve(cm)
    h = {f: res.nodes[f"fp:bldg_E:{f}"] for f in ("1F", "2F", "3F", "4F")}
    assert not any(r.floating for r in h.values())  # tied to the terrain through the portal
    for k, f in enumerate(("2F", "3F", "4F"), start=1):
        assert abs((h[f].h - h["1F"].h) - k * DEFAULT_FLOOR_HEIGHT_M) < 1e-6
        assert np.isfinite(h[f].sigma) and h[f].sigma < 10
    # 1F sits at the outdoor door (soft-flat portal, nothing else to say otherwise)
    assert abs(h["1F"].h - res.nodes["cn:n_out_door"].h) < 0.05
    assert cm.var_of["n_E_3_hall"] == "fp:bldg_E:3F"


def test_building_floor_height_overrides_the_default():
    res = solve(campus_model(building_campus(floor_height_m=4.5), ident))
    assert abs(res.nodes["fp:bldg_E:3F"].h - res.nodes["fp:bldg_E:1F"].h - 9.0) < 1e-6


def test_barometer_and_step_count_win_over_the_floor_prior():
    feats = building_campus() + [
        feat_node("n_E_2_st", X0 + 5, Y0, "bldg_E", 2, "stair_landing"),
        feat_node("n_E_3_st", X0 + 5, Y0, "bldg_E", 3, "stair_landing"),
        feat_edge("e_st_2_3", "n_E_2_st", "n_E_3_st", highway="steps", edge_type="indoor", step_free=False, step_count=28),
    ]
    cm = campus_model(feats, ident)
    assert [e.kind for e in cm.edges].count("step_count") == 1
    baro = Edge("baro_1_2", "fp:bldg_E:1F", "fp:bldg_E:2F", 4.6, 0.3)  # measured storey 4.6 m (prior 3.9 ± 1)
    res = solve(cm, extra_edges=[baro])
    h = lambda f: res.nodes[f"fp:bldg_E:{f}"].h  # noqa: E731
    assert abs((h("2F") - h("1F")) - 4.6) < 0.1  # barometer dominates the prior
    assert abs((h("3F") - h("2F")) - 28 * 0.16) < 0.1  # 28 steps × 0.16 m = 4.48 m
    assert abs((h("4F") - h("3F")) - DEFAULT_FLOOR_HEIGHT_M) < 1e-6  # nothing measured there


# ---------------------------------------------------------------- flat_exact / soft flat

def two_points(grade, **edge_props):
    """Two outdoor points 40 m apart on a DEM that rises `grade` (ratio) from A to B."""
    feats = [feat_node("A", X0, Y0), feat_node("B", X0 + 40, Y0), feat_edge("e_ab", "A", "B", **edge_props)]
    return campus_model(feats, ident), (lambda x, y: 30.0 + grade * (x - X0))


def diff(res):
    return res.nodes["cn:B"].h - res.nodes["cn:A"].h


def test_flat_exact_is_a_hard_zero():
    cm, dem = two_points(0.04, flat_exact=True)
    assert [e.kind for e in cm.edges] == ["flat_exact"] and cm.soft_flat == []
    assert abs(diff(solve(cm, dem_fn=dem))) < 0.02  # DEM says 1.6 m


def test_unmarked_footway_is_pulled_flat_within_one_percent():
    cm, dem = two_points(0.005)  # 0.2 m over 40 m
    res = solve(cm, dem_fn=dem)
    assert res.soft_flat["soft_flat:e_ab"]["active"] is True
    assert res.soft_flat["soft_flat:e_ab"]["loo_grade"] == pytest.approx(0.005, abs=1e-6)
    assert abs(diff(res)) < 0.05


def test_unmarked_footway_steeper_than_one_percent_keeps_its_slope():
    cm, dem = two_points(0.05)  # 2.0 m over 40 m
    res = solve(cm, dem_fn=dem)
    assert res.soft_flat["soft_flat:e_ab"]["active"] is False
    assert abs(diff(res) - 2.0) < 1e-6
    assert any("soft-flat off soft_flat:e_ab" in line for line in res.log)


def test_a_barometer_measurement_decides_a_footway_the_dem_cannot():
    cm, dem = two_points(0.0)  # coarse DEM: flat
    res = solve(cm, extra_edges=[Edge("baro", "cn:A", "cn:B", 1.6, 0.2)], dem_fn=dem)  # measured 4 %
    assert res.soft_flat["soft_flat:e_ab"]["active"] is False
    assert abs(diff(res) - 1.6) < 0.1


def test_hill_building_with_two_portals_turns_off_one_soft_row_at_a_time_and_stays_solvable():
    # 1F door at the foot, 4F door at the top of the hill only 2 m higher: the 3.9 m floor prior and the terrain disagree,
    # so one portal has to give. Turning both off together would cut the floors loose (singular system).
    feats = building_campus() + [
        feat_node("n_out_top", X0 + 30, Y0),
        feat_node("n_E_4_entr", X0 + 27, Y0, "bldg_E", 4, "entrance"),
        feat_edge("e_portal_top", "n_E_4_entr", "n_out_top", edge_type="portal"),
    ]
    res = solve(campus_model(feats, ident), dem_fn=lambda x, y: 30.0 + 2.0 * (x >= X0 + 30))
    states = [res.soft_flat[k]["active"] for k in ("soft_flat:e_portal", "soft_flat:e_portal_top")]
    assert sorted(states) == [False, True]
    assert all(np.isfinite(r.h) for r in res.nodes.values())


def test_soft_flat_never_on_breaklines_steps_or_ramps():
    for props in ({"is_breakline": True}, {"highway": "steps", "step_free": False}, {"highway": "ramp"}):
        cm, _ = two_points(0.0, **props)
        assert cm.soft_flat == [], props


# ---------------------------------------------------------------- Break-line

def test_outdoor_steps_make_a_cross_breakline_and_loosen_the_dem_prior():
    feats = [feat_node("A", X0, Y0), feat_node("B", X0 + 10, Y0),
             feat_edge("e_steps", "A", "B", highway="steps", step_free=False)]
    cm = campus_model(feats, ident, breakline_half_width=2.0)
    (bl,) = cm.breaklines
    assert np.allclose(bl.coords, [[X0 + 5, Y0 - 2], [X0 + 5, Y0 + 2]])  # perpendicular through the middle
    assert cm.sigma_dem_scale == {"cn:A": 2.0, "cn:B": 2.0}
    off = campus_model([*feats[:2], feat_edge("e_steps", "A", "B", highway="steps", is_breakline=False)], ident)
    assert off.breaklines == []


def grid(res=0.5):
    w, h = 80, 60
    return Grid(np.zeros((h, w)), X0 - 10, Y0 + 15, res)


WALL = Breakline("wall", np.array([[X0, Y0 - 5], [X0, Y0 + 5]]))  # north–south line through x = X0, 10 m long
WEST = ResidualCenter("w", X0 - 1, Y0, 1.0, 0.1, 3.0)
EAST = ResidualCenter("e", X0 + 1, Y0, -1.0, 0.1, 3.0)


def at(g, z, x, y):
    col, row = g.xy_to_colrow(x, y)
    return z[int(round(float(row))), int(round(float(col)))]


@pytest.mark.parametrize("method", ["fusion", "rbf"])
def test_breakline_keeps_each_side_to_its_own_correction(method):
    g = grid()
    mixed = residual_field(g, [WEST, EAST], method=method)
    split = residual_field(g, [WEST, EAST], method=method, breaklines=[WALL])
    # Right beside the wall: without it the two corrections blend, with it each side keeps its own sign.
    assert at(g, split, X0 - 0.25, Y0) > 0.5 and at(g, split, X0 + 0.25, Y0) < -0.5
    assert abs(at(g, mixed, X0 - 0.25, Y0)) < at(g, split, X0 - 0.25, Y0)
    # The west centre never reaches past the wall (fusion: exactly; rbf: coefficients still mix, sign holds).
    if method == "fusion":
        only_west = residual_field(g, [WEST], breaklines=[WALL])
        X, Y = np.meshgrid(*g.cell_centers())
        assert np.all(only_west[X > X0 + 1e-9] == 0.0)
    # Beyond the end of the wall (y > Y0 + 5) the field is not split.
    c = ResidualCenter("n", X0 - 1, Y0 + 7, 1.0, 0.1, 3.0)
    assert at(g, residual_field(g, [c], method=method, breaklines=[WALL]), X0 + 0.5, Y0 + 7) > 0.05


def test_breakline_attenuation_is_partial_between_zero_and_one():
    g = grid()
    full = at(g, residual_field(g, [WEST]), X0 + 0.25, Y0)
    half = at(g, residual_field(g, [WEST], breaklines=[WALL], breakline_attenuation=0.5), X0 + 0.25, Y0)
    none = at(g, residual_field(g, [WEST], breaklines=[WALL]), X0 + 0.25, Y0)
    assert none == 0.0 < half < full


def test_tile_update_with_breaklines_equals_full_recompute():
    g = grid()
    cs = [WEST, EAST, ResidualCenter("far", X0 + 20, Y0 + 5, 0.3, 0.2, 2.0)]
    z_old = residual_field(g, cs, breaklines=[WALL])
    cs2 = [ResidualCenter(c.key, c.x, c.y, c.r + (0.4 if c.key == "e" else 0.0), c.sigma, c.radius) for c in cs]
    tiles = dirty_tiles(g, [c for c in cs2 if c.key == "e"], tile=16)
    z_inc = update_tiles(g, z_old, cs2, tiles, tile=16, breaklines=[WALL])
    assert np.allclose(z_inc, residual_field(g, cs2, breaklines=[WALL]), atol=1e-12)


# ---------------------------------------------------------------- 그린 단절선의 낮은 쪽 면(lowSide)·단차(dropM)

def wall_campus(**edge_props):
    """A (west) — B (east) footway crossing WALL (drawn south → north: west is its left, east its right)."""
    return campus_model([feat_node("A", X0 - 5, Y0), feat_node("B", X0 + 5, Y0), feat_edge("e_ab", "A", "B", **edge_props)], ident)


def drop_wall(low_side, drop_m):
    return Breakline("wall", WALL.coords, low_side, drop_m)


@pytest.mark.parametrize("low_side, expect", [("left", 2.0), ("right", -2.0)])
def test_breakline_drop_constrains_the_crossing_edge_by_side(low_side, expect):
    cm = wall_campus()
    rows, off_soft, scale, log = breakline_drop_edges([drop_wall(low_side, 2.0)], cm)
    (row,) = rows
    assert row.kind == "breakline_drop" and (row.frm, row.to) == ("cn:A", "cn:B") and row.dh == expect
    assert row.sigma == pytest.approx(0.2)  # max(0.15, 10 % of 2 m)
    assert off_soft == {"soft_flat:e_ab"} and scale == {"cn:A": 2.0, "cn:B": 2.0}
    assert "1 crossing edge(s)" in log[-1]
    res = solve_heights([*cm.nodes], [*cm.edges, *rows], dem_fn=lambda x, y: 30.0,
                        soft_flat=[s for s in cm.soft_flat if s.id not in off_soft], sigma_dem_scale={**cm.sigma_dem_scale, **scale})
    assert res.nodes["cn:B"].h - res.nodes["cn:A"].h == pytest.approx(expect, abs=0.05)


def test_breakline_without_low_side_or_drop_makes_no_rows():
    cm = wall_campus()
    for line in (WALL, drop_wall("left", None), drop_wall(None, 1.0)):
        rows, off_soft, _, _ = breakline_drop_edges([line], cm)
        assert rows == [] and off_soft == set()
    # An edge that does not cross the line (both ends west) is left alone.
    far = campus_model([feat_node("A", X0 - 5, Y0), feat_node("B", X0 - 1, Y0), feat_edge("e_ab", "A", "B")], ident)
    assert breakline_drop_edges([drop_wall("left", 1.0)], far)[0] == []


def test_breakline_drop_gives_way_to_step_count_and_flat_exact():
    steps = wall_campus(highway="steps", step_free=False, step_count=10, incline="up", is_breakline=False)
    rows, _, _, log = breakline_drop_edges([drop_wall("left", 1.6)], steps)
    assert rows == [] and any("step_count kept" in line for line in log)
    flat = wall_campus(flat_exact=True)
    rows, _, _, log = breakline_drop_edges([drop_wall("left", 1.0)], flat)
    assert rows == [] and any("flat_exact kept" in line for line in log)


def test_store_breaklines_reads_low_side_and_drop_and_stays_compatible():
    pt = lambda lng, lat: {"lng": lng, "lat": lat}  # noqa: E731
    store = {"breaklines": [
        {"id": "old", "coordinates": [pt(0, 0), pt(0, 1)], "source": "manual", "createdAt": 1},
        {"id": "new", "coordinates": [pt(0, 0), pt(0, 1)], "source": "manual", "createdAt": 1, "lowSide": "right", "dropM": 1.25},
        {"id": "bad", "coordinates": [pt(0, 0), pt(0, 1)], "source": "manual", "createdAt": 1, "lowSide": "up", "dropM": -3},
    ]}
    log: list[str] = []
    old, new, bad = store_breaklines(store, ident, log)
    assert (old.low_side, old.drop_m) == (None, None)
    assert (new.low_side, new.drop_m) == ("right", 1.25)
    assert (bad.low_side, bad.drop_m) == (None, None) and len(log) == 2
    assert len(store_breaklines(store, ident)) == 3  # without a log list it still reads every line


# ---------------------------------------------------------------- 지연 재계산 + derived

def two_buildings():
    feats = building_campus() + [
        feat_building("bldg_F", [1, 2]),
        feat_node("n_out_f", X0 + 200, Y0),
        feat_node("n_F_1_entr", X0 + 203, Y0, "bldg_F", 1, "entrance"),
        feat_edge("e_portal_f", "n_F_1_entr", "n_out_f", edge_type="portal"),
        feat_edge("e_lift", "n_F_1_entr", "n_F_1_entr", highway="elevator", edge_type="indoor"),
    ]
    return campus_model(feats, ident)


def test_restricted_solve_equals_the_full_solve_for_its_component_only():
    cm = two_buildings()
    full = solve(cm)
    req = {"heightNodes": [], "campusNodes": ["n_E_3_hall"], "campusEdges": [], "buildings": []}
    seeds = dirty_seeds(req, cm, [n.key for n in cm.nodes])
    assert seeds == {"fp:bldg_E:3F"}
    part = solve(cm, restrict_to=seeds)
    assert part.solved == set(next(c for c in full.components if "fp:bldg_E:3F" in c))
    assert "fp:bldg_F:1F" not in part.nodes
    for k in part.solved:
        assert part.nodes[k].h == pytest.approx(full.nodes[k].h, abs=1e-9)
    assert dirty_seeds({"buildings": ["bldg_F"]}, cm, [n.key for n in cm.nodes]) == {"fp:bldg_F:1F", "fp:bldg_F:2F"}


def test_derived_elevation_edges_use_the_covariance_and_skip_same_plane_and_elevator_edges():
    cm = two_buildings()
    res = solve(cm)
    d = derived_elevation(cm, res, "run", 0)
    assert d["format"] == "campo-derived-elevation/1"
    assert set(d["edges"]) == {"e_portal", "e_portal_f"}  # elevator and same-plane edges are not written
    a, b = res.nodes["fp:bldg_E:1F"], res.nodes["cn:n_out_door"]
    independent = math.hypot(a.sigma, b.sigma)
    assert d["edges"]["e_portal"]["elev_sigma_m"] < 0.2 * independent  # the portal ties them: strongly correlated
    assert d["nodes"]["n_E_3_hall"]["z_m"] == pytest.approx(res.nodes["fp:bldg_E:3F"].h, abs=1e-3)
    # A restricted run keeps the previous values of the components it did not solve.
    part = solve(cm, restrict_to={"fp:bldg_F:1F"})
    merged = derived_elevation(cm, part, "run2", 1, previous=d)
    assert merged["edges"] == d["edges"] and merged["nodes"].keys() == d["nodes"].keys()


# ---------------------------------------------------------------- CLI: --campus, --derived-out, --dirty

def write_campus(folder: Path, lonlat):
    """A tiny campus folder in SPEC.md 4.3 layout, coordinates in WGS84."""
    (folder / "buildings" / "E").mkdir(parents=True)
    (folder / "campus.json").write_text(json.dumps({"id": "t", "schema_version": "0.2", "name": "T",
                                                    "center": [127, 37.5], "bbox": [126, 37, 128, 38]}), encoding="utf-8")
    fc = lambda feats: json.dumps({"type": "FeatureCollection", "features": feats})  # noqa: E731
    out = [feat_node("n_out_1", *lonlat(0, 0)), feat_node("n_out_2", *lonlat(40, 0)), feat_node("n_out_3", *lonlat(40, 30)),
           feat_edge("e_12", "n_out_1", "n_out_2"), feat_edge("e_23", "n_out_2", "n_out_3", highway="steps", step_free=False,
                                                              step_count=20, incline="up"),
           feat_edge("e_door", "n_out_1", "n_E_1_entr", edge_type="portal")]
    (folder / "outdoor.geojson").write_text(fc(out), encoding="utf-8")
    (folder / "buildings" / "E" / "building.geojson").write_text(fc([feat_building("bldg_E", [1, 2, 3])]), encoding="utf-8")
    (folder / "buildings" / "E" / "L1.geojson").write_text(
        fc([feat_node("n_E_1_entr", *lonlat(-3, 0), "bldg_E", 1, "entrance")]), encoding="utf-8")


def run_cli(*args):
    r = subprocess.run([sys.executable, str(HERE / "campo_height_solver.py"), *map(str, args)], capture_output=True,
                       text=True, encoding="utf-8", env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    assert r.returncode == 0, r.stderr
    return r


def test_cli_with_campus_writes_derived_and_dirty_run_matches_full(tmp_path):
    from pyproj import Transformer
    to_grid = Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True)
    to_ll = Transformer.from_crs("EPSG:5186", "EPSG:4326", always_xy=True)
    gx, gy = to_grid.transform(127.045, 37.557)
    lonlat = lambda dx, dy: to_ll.transform(gx + dx, gy + dy)  # noqa: E731

    xs = gx - 50 + (np.arange(140) + 0.5)
    ys = gy + 60 - (np.arange(120) + 0.5)
    X, Y = np.meshgrid(xs, ys)
    # 0.2 % eastwards, and a 3.2 m rise over y = 15…30 m where the 20-step flight is (20 × 0.16 m).
    dem = Grid(25.0 + 0.002 * (X - gx) + (3.2 / 15) * np.clip(Y - gy - 15, 0, 15), gx - 50, gy + 60, 1.0)
    dem.save(tmp_path / "dem")
    dem_before = (tmp_path / "dem.bin").read_bytes()
    camp = tmp_path / "campus"
    write_campus(camp, lonlat)
    store = {"schemaVersion": 1, "positionCrs": "EPSG:4326", "verticalDatum": "KVD_INCHEON_MSL", "nodes": [], "sessions": [],
             "edges": []}
    (tmp_path / "store.json").write_text(json.dumps(store), encoding="utf-8")

    common = ["--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp]
    r = run_cli(*common, "--out", tmp_path / "full", "--derived-out", tmp_path / "full" / "elevation.json")
    assert "wrote" in r.stdout
    assert (tmp_path / "dem.bin").read_bytes() == dem_before  # the DEM prior is read only
    d = json.loads((tmp_path / "full" / "elevation.json").read_text(encoding="utf-8"))
    assert abs(d["edges"]["e_12"]["elev_diff_m"]) < 0.05  # 0.2 % footway → flat
    assert d["edges"]["e_23"]["elev_diff_m"] == pytest.approx(20 * 0.16, abs=0.3)  # step count
    assert abs(d["edges"]["e_door"]["elev_diff_m"]) < 0.05  # portal: floor 1F at the door
    assert set(d["nodes"]) == {"n_out_1", "n_out_2", "n_out_3", "n_E_1_entr"}

    (tmp_path / "dirty.json").write_text(json.dumps({"format": "campo-elevation-dirty/1", "heightNodes": [],
                                                     "campusNodes": ["n_out_3"], "campusEdges": ["e_23"], "buildings": []}),
                                         encoding="utf-8")
    run_cli(*common, "--out", tmp_path / "inc", "--derived-out", tmp_path / "inc" / "elevation.json",
            "--dirty", tmp_path / "dirty.json", "--previous-residual", tmp_path / "full" / "residual_field.json",
            "--previous-derived", tmp_path / "full" / "elevation.json")
    inc = json.loads((tmp_path / "inc" / "elevation.json").read_text(encoding="utf-8"))
    assert inc["nodes"] == d["nodes"] and inc["edges"] == d["edges"]
    z_full = Grid.load(tmp_path / "full" / "residual_field.json").data
    z_inc = Grid.load(tmp_path / "inc" / "residual_field.json").data
    assert np.allclose(z_full, z_inc, atol=1e-5)  # float32 files
