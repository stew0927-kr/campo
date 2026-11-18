"""
실행:  cd tools/elevation && python -m pytest -q test_solver_v2_cli.py

엔진 v2 CLI: 출력 파일·키가 v1 계약을 지키는지(같은 입력을 --engine v1/v2로 돌려 비교), 기존 CLI 장면 3개가 v2로도 통과하는지,
길 셀이 풀린 높이에 놓이는지, buildings.json·설정 파일·--set, v1이 만든 derived를 v2가 전부 다시 쓰는지, 엔진 선택.
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
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))
from campo_grid import Grid  # noqa: E402
from test_campus_constraints import feat_building, feat_edge, feat_node, write_campus  # noqa: E402

CAMPUS_BASIC = REPO / "packages" / "core" / "test" / "fixtures" / "campus-basic"
SCRIPT = HERE / "campo_height_solver.py"
EMPTY_STORE = {"schemaVersion": 1, "positionCrs": "EPSG:4326", "verticalDatum": "KVD_INCHEON_MSL", "nodes": [], "sessions": [],
               "edges": []}


def cli(*args, env=None, code=0, utf8=True):
    e = {k: v for k, v in os.environ.items() if k != "CAMPO_ELEVATION_ENGINE"}
    if utf8:
        e["PYTHONIOENCODING"] = "utf-8"
    else:
        e.pop("PYTHONIOENCODING", None)
    e.update(env or {})
    r = subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True, encoding="utf-8",
                       errors="replace", env=e)
    assert r.returncode == code, (r.returncode, r.stdout[-2000:], r.stderr[-2000:])
    return r


def transforms():
    from pyproj import Transformer
    return (Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True),
            Transformer.from_crs("EPSG:5186", "EPSG:4326", always_xy=True))


def small_scene(tmp_path):
    """test_campus_constraints.write_campus + its DEM (0.2 % east, 3.2 m rise where the 20-step flight is)."""
    to_grid, to_ll = transforms()
    gx, gy = to_grid.transform(127.045, 37.557)
    lonlat = lambda dx, dy: to_ll.transform(gx + dx, gy + dy)  # noqa: E731
    xs = gx - 50 + (np.arange(140) + 0.5)
    ys = gy + 60 - (np.arange(120) + 0.5)
    X, Y = np.meshgrid(xs, ys)
    Grid(25.0 + 0.002 * (X - gx) + (3.2 / 15) * np.clip(Y - gy - 15, 0, 15), gx - 50, gy + 60, 1.0).save(tmp_path / "dem")
    camp = tmp_path / "campus"
    write_campus(camp, lonlat)
    (tmp_path / "store.json").write_text(json.dumps(EMPTY_STORE), encoding="utf-8")
    return camp, lonlat, (gx, gy)


def basic_scene(tmp_path):
    """packages/core campus-basic + the test_core_contract DEM (2 % north, 0.5 % east)."""
    to_grid, _ = transforms()
    gx, gy = to_grid.transform(127.0, 37.0)
    xs = gx - 100 + (np.arange(400) + 0.5)
    ys = gy + 300 - (np.arange(400) + 0.5)
    X, Y = np.meshgrid(xs, ys)
    Grid(30.0 + 0.02 * (Y - gy) + 0.005 * (X - gx), gx - 100, gy + 300, 1.0).save(tmp_path / "dem")
    (tmp_path / "store.json").write_text(json.dumps(EMPTY_STORE), encoding="utf-8")
    return CAMPUS_BASIC


def run_both(tmp_path, camp, *extra):
    out = {}
    for eng in ("v1", "v2"):
        o = tmp_path / eng
        cli("--engine", eng, "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp, "--out", o,
            "--derived-out", o / "elevation.json", *extra)
        out[eng] = o
    return out


GRID_KEYS = ("format", "crs", "vertical_datum", "origin_x", "origin_y", "res", "width", "height", "dtype", "nodata")


# ---------------------------------------------------------------- 4.5 계약

@pytest.mark.parametrize("which", ["small", "campus-basic"])
def test_outputs_keep_the_v1_contract(tmp_path, which):
    camp = small_scene(tmp_path)[0] if which == "small" else basic_scene(tmp_path)
    o = run_both(tmp_path, camp)
    files = {p.name for p in o["v1"].iterdir()}
    assert {"corrected_dem.json", "corrected_dem.bin", "residual_field.json", "residual_field.bin", "store.solved.json"} <= files
    assert files <= {p.name for p in o["v2"].iterdir()}
    dem = Grid.load(tmp_path / "dem.json")
    for name in ("corrected_dem", "residual_field"):
        m1 = json.loads((o["v1"] / f"{name}.json").read_text(encoding="utf-8"))
        m2 = json.loads((o["v2"] / f"{name}.json").read_text(encoding="utf-8"))
        assert set(m1) == set(m2)
        assert all(m1[k] == m2[k] for k in GRID_KEYS)
        assert (o["v2"] / m2["bin"]).stat().st_size == m2["width"] * m2["height"] * 4
    c = Grid.load(o["v2"] / "corrected_dem.json").data
    r = Grid.load(o["v2"] / "residual_field.json").data
    miss = ~np.isfinite(dem.data)
    assert np.all(np.isnan(c[miss])) and np.all(r[miss] == 0)
    assert np.all(np.isfinite(c[~miss])) and np.all(np.isfinite(r[~miss]))
    assert np.allclose(c[~miss] - dem.data[~miss], r[~miss], atol=1e-4)

    d1 = json.loads((o["v1"] / "elevation.json").read_text(encoding="utf-8"))
    d2 = json.loads((o["v2"] / "elevation.json").read_text(encoding="utf-8"))
    assert set(d1) <= set(d2) and set(d2) - set(d1) == {"engine"} and d2["format"] == d1["format"]
    assert d2["engine"] == "campo-height-solver/2"
    assert set(d2["nodes"]) == set(d1["nodes"])
    for v in d2["nodes"].values():
        assert set(v) == {"z_m", "sigma_m", "floating"}
        assert isinstance(v["floating"], bool) and all(isinstance(v[k], (int, float)) and math.isfinite(v[k]) for k in ("z_m", "sigma_m"))
    assert set(d2["edges"]) == set(d1["edges"])
    for v in d2["edges"].values():
        assert set(v) == {"elev_diff_m", "elev_sigma_m"}
        assert math.isfinite(v["elev_diff_m"]) and v["elev_sigma_m"] > 0

    s1 = json.loads((o["v1"] / "store.solved.json").read_text(encoding="utf-8"))
    s2 = json.loads((o["v2"] / "store.solved.json").read_text(encoding="utf-8"))
    assert set(s1) == set(s2) and set(s1["lastSolve"]) == set(s2["lastSolve"])
    for e in s2["estimates"]:
        assert set(e) == {"key", "hM", "sigmaM", "sigmaRelM", "floating"}
    report = json.loads((o["v2"] / "solve_report.json").read_text(encoding="utf-8"))
    assert report["format"] == "campo-solve-report/1" and report["grid"]["cg_converged"] == 1


# ---------------------------------------------------------------- 기존 CLI 장면을 v2로

def test_existing_cli_scenarios_pass_with_engine_v2(tmp_path):
    import test_campo_height_solver as t1

    # (1) test_cli_end_to_end_with_latlng_store, no --campus
    _, to_ll = transforms()
    grid = t1.flat_grid(1.0)
    grid.save(tmp_path / "campus_dem")
    store = dict(EMPTY_STORE, nodes=[], edges=[])
    for n in t1.nodes():
        if n.kind == "outdoor_point":
            lng, lat = to_ll.transform(n.x, n.y)
            store["nodes"].append({"kind": "outdoor_point", "key": n.key, "position": {"lat": lat, "lng": lng},
                                   "influenceRadiusM": n.influence_r, "createdAt": 0})
        else:
            _, b, f = n.key.split(":")
            store["nodes"].append({"kind": "floor_plane", "key": n.key, "buildingId": b, "floorId": f, "createdAt": 0})
    for e in t1.make_edges():
        store["edges"].append({"edgeId": e.id, "from": e.frm, "to": e.to, "dhM": e.dh, "sigmaM": e.sigma, "dtS": 300,
                               "offsetFromM": e.off_from, "offsetToM": e.off_to, "sessionId": "s", "method": "static_pair",
                               "qc": "pending", "model": {"tempC": 15, "sigmaInstFloorHpa": 0.03, "driftHpaPerHour": 0.3},
                               "createdAt": 0})
    (tmp_path / "s1").mkdir()
    (tmp_path / "s1" / "store.json").write_text(json.dumps(store), encoding="utf-8")
    cli("--engine", "v2", "--store", tmp_path / "s1" / "store.json", "--dem", tmp_path / "campus_dem.json", "--out", tmp_path / "o1")
    solved = json.loads((tmp_path / "o1" / "store.solved.json").read_text(encoding="utf-8"))
    assert solved["lastSolve"]["rejectedEdgeIds"] == ["e2_bad"]
    assert next(e for e in solved["edges"] if e["edgeId"] == "e2_bad")["qc"] == "rejected"
    assert Grid.load(tmp_path / "o1" / "corrected_dem.json").data.shape == grid.data.shape

    # (2) test_cli_with_campus_writes_derived_and_dirty_run_matches_full
    t2 = tmp_path / "s2"
    t2.mkdir()
    camp, lonlat, _ = small_scene(t2)
    dem_before = (t2 / "dem.bin").read_bytes()
    common = ["--engine", "v2", "--store", t2 / "store.json", "--dem", t2 / "dem.json", "--campus", camp]
    r = cli(*common, "--out", t2 / "full", "--derived-out", t2 / "full" / "elevation.json")
    assert "wrote" in r.stdout
    assert (t2 / "dem.bin").read_bytes() == dem_before
    d = json.loads((t2 / "full" / "elevation.json").read_text(encoding="utf-8"))
    assert abs(d["edges"]["e_12"]["elev_diff_m"]) < 0.05
    assert d["edges"]["e_23"]["elev_diff_m"] == pytest.approx(20 * 0.16, abs=0.3)
    assert abs(d["edges"]["e_door"]["elev_diff_m"]) < 0.05
    assert set(d["nodes"]) == {"n_out_1", "n_out_2", "n_out_3", "n_E_1_entr"}
    (t2 / "dirty.json").write_text(json.dumps({"format": "campo-elevation-dirty/1", "heightNodes": [], "campusNodes": ["n_out_3"],
                                              "campusEdges": ["e_23"], "buildings": []}), encoding="utf-8")
    cli(*common, "--out", t2 / "inc", "--derived-out", t2 / "inc" / "elevation.json", "--dirty", t2 / "dirty.json",
        "--previous-residual", t2 / "full" / "residual_field.json", "--previous-derived", t2 / "full" / "elevation.json")
    inc = json.loads((t2 / "inc" / "elevation.json").read_text(encoding="utf-8"))
    assert inc["nodes"] == d["nodes"] and inc["edges"] == d["edges"]
    assert np.allclose(Grid.load(t2 / "full" / "residual_field.json").data, Grid.load(t2 / "inc" / "residual_field.json").data,
                       atol=1e-5)

    # (3) test_dirty_run_for_a_changed_breakline_only_matches_a_full_run
    t3 = tmp_path / "s3"
    t3.mkdir()
    camp, lonlat, _ = small_scene(t3)
    common = ["--engine", "v2", "--dem", t3 / "dem.json", "--campus", camp]
    cli(*common, "--store", t3 / "store.json", "--out", t3 / "before", "--derived-out", t3 / "before" / "elevation.json")
    a, b = lonlat(20, -10), lonlat(20, 10)
    store3 = dict(EMPTY_STORE, breaklines=[{"id": "bl-1", "coordinates": [{"lng": a[0], "lat": a[1]}, {"lng": b[0], "lat": b[1]}],
                                            "source": "manual", "createdAt": 0, "lowSide": "left", "dropM": 1.2}])
    (t3 / "store_line.json").write_text(json.dumps(store3), encoding="utf-8")
    cli(*common, "--store", t3 / "store_line.json", "--out", t3 / "full", "--derived-out", t3 / "full" / "elevation.json")
    lo, hi = lonlat(19, -11), lonlat(21, 11)
    (t3 / "dirty.json").write_text(json.dumps({
        "format": "campo-elevation-dirty/1", "heightNodes": [], "campusNodes": [], "campusEdges": [], "buildings": [],
        "breaklines": [{"id": "bl-1", "boxes": [[min(lo[0], hi[0]), min(lo[1], hi[1]), max(lo[0], hi[0]), max(lo[1], hi[1])]]}]}),
        encoding="utf-8")
    cli(*common, "--store", t3 / "store_line.json", "--out", t3 / "inc", "--derived-out", t3 / "inc" / "elevation.json",
        "--dirty", t3 / "dirty.json", "--previous-residual", t3 / "before" / "residual_field.json",
        "--previous-derived", t3 / "before" / "elevation.json")
    z_before = Grid.load(t3 / "before" / "corrected_dem.json").data
    z_full = Grid.load(t3 / "full" / "corrected_dem.json").data
    z_inc = Grid.load(t3 / "inc" / "corrected_dem.json").data
    assert not np.allclose(z_before, z_full, atol=1e-3)
    assert np.allclose(z_full, z_inc, atol=1e-4)
    d_full = json.loads((t3 / "full" / "elevation.json").read_text(encoding="utf-8"))
    d_inc = json.loads((t3 / "inc" / "elevation.json").read_text(encoding="utf-8"))
    d_before = json.loads((t3 / "before" / "elevation.json").read_text(encoding="utf-8"))
    assert d_full["edges"]["e_12"] != d_before["edges"]["e_12"]
    assert d_inc["edges"] == d_full["edges"] and d_inc["nodes"] == d_full["nodes"]


def test_road_cells_sit_on_the_solved_heights(tmp_path):
    camp, lonlat, (gx, gy) = small_scene(tmp_path)
    o = tmp_path / "o"
    cli("--engine", "v2", "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp, "--out", o,
        "--derived-out", o / "elevation.json")
    d = json.loads((o / "elevation.json").read_text(encoding="utf-8"))
    g = Grid.load(o / "corrected_dem.json")
    to_grid, _ = transforms()
    (ax, ay), (bx, by) = (to_grid.transform(*lonlat(0, 0)), to_grid.transform(*lonlat(40, 0)))
    xs, ys = g.cell_centers()
    X, Y = np.meshgrid(xs, ys)
    vx, vy = bx - ax, by - ay
    t = np.clip(((X - ax) * vx + (Y - ay) * vy) / (vx * vx + vy * vy), 0, 1)
    dist = np.hypot(X - (ax + t * vx), Y - (ay + t * vy))
    road = dist <= 0.95  # inside the 2 m corridor of e_12, away from the cells the portal or the stair might own
    road &= (t > 0.05) & (t < 0.95)
    za, zb = d["nodes"]["n_out_1"]["z_m"], d["nodes"]["n_out_2"]["z_m"]
    assert road.sum() > 40
    assert np.allclose(g.data[road], ((1 - t) * za + t * zb)[road], atol=2e-3)


# ---------------------------------------------------------------- buildings.json

def building_campus_folder(folder: Path, lonlat):
    """One 20 m x 12 m building with a 1F door 2 m outside its west wall, a footway to a second outdoor point."""
    (folder / "buildings" / "K").mkdir(parents=True)
    fc = lambda feats: json.dumps({"type": "FeatureCollection", "features": feats})  # noqa: E731
    ring = [list(lonlat(x, y)) for x, y in ((0, 0), (20, 0), (20, 12), (0, 12), (0, 0))]
    b = feat_building("bldg_K", [1, 2])
    b["geometry"] = {"type": "Polygon", "coordinates": [ring]}
    out = [feat_node("n_door", *lonlat(-2, 6)), feat_node("n_far", *lonlat(-30, 6)),
           feat_edge("e_walk", "n_far", "n_door"), feat_edge("e_portal", "n_door", "n_K_1_entr", edge_type="portal")]
    (folder / "outdoor.geojson").write_text(fc(out), encoding="utf-8")
    (folder / "buildings" / "K" / "building.geojson").write_text(fc([b]), encoding="utf-8")
    (folder / "buildings" / "K" / "L1.geojson").write_text(
        fc([feat_node("n_K_1_entr", *lonlat(1, 6), "bldg_K", 1, "entrance")]), encoding="utf-8")


def building_scene(tmp_path):
    to_grid, to_ll = transforms()
    gx, gy = to_grid.transform(127.03, 37.55)
    lonlat = lambda dx, dy: to_ll.transform(gx + dx, gy + dy)  # noqa: E731
    xs = gx - 60 + (np.arange(120) + 0.5)
    ys = gy + 50 - (np.arange(100) + 0.5)
    X, Y = np.meshgrid(xs, ys)
    Grid(30.0 + 0.05 * (X - gx), gx - 60, gy + 50, 1.0).save(tmp_path / "dem")  # 5 % up to the east
    camp = tmp_path / "campus"
    building_campus_folder(camp, lonlat)
    (tmp_path / "store.json").write_text(json.dumps(EMPTY_STORE), encoding="utf-8")
    return camp


def test_buildings_sidecar(tmp_path):
    camp = building_scene(tmp_path)
    common = ["--engine", "v2", "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp]
    # without the file: pad from the ring DEM
    cli(*common, "--out", tmp_path / "plain", "--derived-out", tmp_path / "plain" / "elevation.json")
    plain = json.loads((tmp_path / "plain" / "solve_report.json").read_text(encoding="utf-8"))
    assert plain["buildings"]["bldg_K"]["ref_source"] == "entrance_ring"
    # with the file next to store.json (read automatically): surveyed H_1F and one measured difference
    side = {"format": "campo-elevation-buildings/1", "buildings": {"bldg_K": {"h1fM": 30.4, "h1fSource": "floorplan"}},
            "measurements": [{"id": "bm-1", "buildingId": "bldg_K", "point": {"campusNode": "n_door"},
                              "buildingMinusPointM": 0.6, "sigmaM": 0.02}]}
    (tmp_path / "buildings.json").write_text(json.dumps(side), encoding="utf-8")
    o = tmp_path / "side"
    cli(*common, "--out", o, "--derived-out", o / "elevation.json")
    rep = json.loads((o / "solve_report.json").read_text(encoding="utf-8"))["buildings"]["bldg_K"]
    assert rep["ref_source"] == "survey" and rep["h_1f_ref_m"] == 30.4
    assert rep["h_1f_m"] >= rep["h_1f_ref_m"] - 1e-9
    assert rep["buried_m2"] <= rep["buried_ref_m2"] + 1e-9
    assert abs(rep["measurement_residuals_m"]["bm-1"]) <= 0.03
    g = Grid.load(o / "corrected_dem.json")
    to_grid, to_ll = transforms()
    gx, gy = to_grid.transform(127.03, 37.55)
    xs, ys = g.cell_centers()
    X, Y = np.meshgrid(xs, ys)
    inside = (X > gx + 1) & (X < gx + 19) & (Y > gy + 1) & (Y < gy + 11)
    assert np.allclose(g.data[inside], rep["h_1f_m"], atol=1e-4)
    # a wrong format stops with exit code 2
    (tmp_path / "bad.json").write_text(json.dumps({"format": "other/1"}), encoding="utf-8")
    r = cli(*common, "--out", tmp_path / "bad", "--buildings", tmp_path / "bad.json", code=2)
    assert "campo-elevation-buildings/1" in r.stderr


def triangle_scene(tmp_path):
    to_grid, to_ll = transforms()
    gx, gy = to_grid.transform(127.02, 37.54)
    lonlat = lambda dx, dy: to_ll.transform(gx + dx, gy + dy)  # noqa: E731
    xs = gx - 10 + (np.arange(70) + 0.5)
    ys = gy + 10 - (np.arange(70) + 0.5)
    X, Y = np.meshgrid(xs, ys)
    Grid(30 + 0.08 * (X - gx) + 0.5 * np.sin((Y - gy) / 4), gx - 10, gy + 10, 1.0).save(tmp_path / "dem")
    camp = tmp_path / "campus"
    camp.mkdir()
    pts = {"n_a": (15, -15), "n_b": (40, -17), "n_c": (26, -38)}
    feats = [feat_node(k, *lonlat(*v)) for k, v in pts.items()]
    feats += [feat_edge("e_ab", "n_a", "n_b", flat_exact=True), feat_edge("e_bc", "n_b", "n_c", flat_exact=True),
              feat_edge("e_ca", "n_c", "n_a", flat_exact=True)]
    (camp / "outdoor.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    (tmp_path / "store.json").write_text(json.dumps(EMPTY_STORE), encoding="utf-8")
    return camp


def test_config_file_and_set(tmp_path):
    camp = triangle_scene(tmp_path)
    common = ["--engine", "v2", "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp]
    rep = lambda o: json.loads((o / "solve_report.json").read_text(encoding="utf-8"))  # noqa: E731
    cli(*common, "--out", tmp_path / "default")
    assert rep(tmp_path / "default")["grid"]["island_cells"] > 0
    cli(*common, "--out", tmp_path / "set", "--set", "island.area_max_m2=1", "--set", "island.radius_max_m=1")
    r = rep(tmp_path / "set")
    assert r["grid"]["island_cells"] == 0 and r["config"]["island"]["area_max_m2"] == 1.0
    (tmp_path / "solver_config.json").write_text(json.dumps(
        {"format": "campo-solver-config/1", "island": {"area_max_m2": 1, "radius_max_m": 1}}), encoding="utf-8")
    cli(*common, "--out", tmp_path / "auto")
    assert rep(tmp_path / "auto")["grid"]["island_cells"] == 0
    cli(*common, "--out", tmp_path / "bad", "--set", "island.kappa=0.9", code=2)
    cli(*common, "--out", tmp_path / "bad2", "--set", "island.nope=1", code=2)


def test_previous_derived_from_v1_is_rewritten_in_full(tmp_path):
    camp = small_scene(tmp_path)[0]
    common = ["--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp]
    cli("--engine", "v1", *common, "--out", tmp_path / "v1", "--derived-out", tmp_path / "v1" / "elevation.json")
    cli("--engine", "v2", *common, "--out", tmp_path / "full", "--derived-out", tmp_path / "full" / "elevation.json")
    (tmp_path / "dirty.json").write_text(json.dumps({"format": "campo-elevation-dirty/1", "heightNodes": [], "campusNodes": [],
                                                     "campusEdges": ["e_23"], "buildings": []}), encoding="utf-8")
    r = cli("--engine", "v2", *common, "--out", tmp_path / "inc", "--derived-out", tmp_path / "inc" / "elevation.json",
            "--dirty", tmp_path / "dirty.json", "--previous-derived", tmp_path / "v1" / "elevation.json")
    assert "not from engine v2" in r.stdout
    full = json.loads((tmp_path / "full" / "elevation.json").read_text(encoding="utf-8"))
    inc = json.loads((tmp_path / "inc" / "elevation.json").read_text(encoding="utf-8"))
    assert inc["engine"] == "campo-height-solver/2"
    assert inc["nodes"] == full["nodes"] and inc["edges"] == full["edges"]


def test_engine_is_v2_by_default_and_v1_is_opt_in(tmp_path):
    camp = small_scene(tmp_path)[0]
    common = ["--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp]
    o = tmp_path / "default"
    cli(*common, "--out", o, "--derived-out", o / "elevation.json")
    assert json.loads((o / "elevation.json").read_text(encoding="utf-8"))["engine"] == "campo-height-solver/2"
    assert (o / "solve_report.json").exists()
    for name, args, env in (("flag", ["--engine", "v1"], {}), ("legacy", ["--legacy"], {}),
                            ("legacy_after_v2", ["--engine", "v2", "--legacy"], {}),
                            ("env", [], {"CAMPO_ELEVATION_ENGINE": "v1"})):
        o = tmp_path / name
        cli(*common, *args, "--out", o, "--derived-out", o / "elevation.json", env=env)
        d = json.loads((o / "elevation.json").read_text(encoding="utf-8"))
        assert "engine" not in d and not (o / "solve_report.json").exists(), name
    o = tmp_path / "env2"
    cli(*common, "--out", o, "--derived-out", o / "elevation.json", env={"CAMPO_ELEVATION_ENGINE": "v2"})
    assert json.loads((o / "elevation.json").read_text(encoding="utf-8"))["engine"] == "campo-height-solver/2"


def test_dem_is_not_modified_and_output_is_ascii(tmp_path):
    camp = basic_scene(tmp_path)
    before = (tmp_path / "dem.bin").read_bytes()
    # no PYTHONIOENCODING: the pipe uses the platform code page, as when the editor server spawns the solver
    r = cli("--engine", "v2", "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp,
            "--out", tmp_path / "o", "--derived-out", tmp_path / "o" / "elevation.json", utf8=False)
    assert (tmp_path / "dem.bin").read_bytes() == before
    assert r.stdout.isascii() and "wrote" in r.stdout
