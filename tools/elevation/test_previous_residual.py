"""A DEM regenerated between two recomputes (another --res / --buffer, or another source): the residual field of the
earlier run belongs to the old grid, so a dirty run must not reuse it (numpy shape error, or a silently shifted or stale
field), and the run falls back to a full one."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from campo_grid import Grid  # noqa: E402
from test_campus_constraints import run_cli, write_campus  # noqa: E402


def _setup(tmp_path):
    from pyproj import Transformer
    to_grid = Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True)
    to_ll = Transformer.from_crs("EPSG:5186", "EPSG:4326", always_xy=True)
    gx, gy = to_grid.transform(127.045, 37.557)
    lonlat = lambda dx, dy: to_ll.transform(gx + dx, gy + dy)  # noqa: E731
    camp = tmp_path / "campus"
    write_campus(camp, lonlat)
    # A second, separate component the dirty request does not touch: two measured points 40 m east of the campus with a
    # 2 m barometer step the DEM does not have, so its residual field is far from 0 and lives in tiles of its own.
    pa, pb = lonlat(70, -40), lonlat(85, -40)
    store = {"schemaVersion": 1, "positionCrs": "EPSG:4326", "verticalDatum": "KVD_INCHEON_MSL", "sessions": [],
             "nodes": [{"key": "op:a", "kind": "outdoor_point", "position": {"lng": pa[0], "lat": pa[1]}, "influenceRadiusM": 15},
                       {"key": "op:b", "kind": "outdoor_point", "position": {"lng": pb[0], "lat": pb[1]}, "influenceRadiusM": 15}],
             "edges": [{"edgeId": "m1", "from": "op:a", "to": "op:b", "dhM": 2.0, "sigmaM": 0.05}]}
    (tmp_path / "store.json").write_text(json.dumps(store), encoding="utf-8")
    (tmp_path / "dirty.json").write_text(json.dumps({"format": "campo-elevation-dirty/1", "heightNodes": [],
                                                     "campusNodes": ["n_out_3"], "campusEdges": ["e_23"], "buildings": []}),
                                         encoding="utf-8")
    return gx, gy, camp


def _dem(gx, gy, res, west=50.0, north=60.0, width_m=140.0, height_m=120.0, bump=0.0):
    w, h = int(round(width_m / res)), int(round(height_m / res))
    xs = gx - west + (np.arange(w) + 0.5) * res
    ys = gy + north - (np.arange(h) + 0.5) * res
    X, Y = np.meshgrid(xs, ys)
    hill = bump * np.exp(-((X - gx - 85) ** 2 + (Y - gy + 40) ** 2) / (2 * 4.0 ** 2))  # under op:b only
    return Grid(25.0 + hill + 0.002 * (X - gx) + (3.2 / 15) * np.clip(Y - gy - 15, 0, 15), gx - west, gy + north, res)


@pytest.mark.parametrize("second", [
    dict(res=0.5),                                   # dem_prep --res 0.5 after --res 1: shape (240, 280) vs (120, 140)
    dict(res=1.0, west=70.0, width_m=180.0),         # another --buffer: wider grid, other origin
    dict(res=1.0, west=60.0, north=50.0),            # same shape, origin moved by 10 m: a silent shift without a check
    dict(res=1.0, bump=1.0),                         # same grid, other DEM values (another source): a stale field
], ids=["res", "buffer", "shifted", "values"])
@pytest.mark.parametrize("engine", ["v1", "v2"])
def test_dirty_run_after_dem_regeneration_matches_a_full_run(tmp_path, second, engine):
    gx, gy, camp = _setup(tmp_path)
    _dem(gx, gy, 1.0).save(tmp_path / "dem")
    common = ["--engine", engine, "--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp]
    run_cli(*common, "--out", tmp_path / "solve", "--derived-out", tmp_path / "elevation.json")

    _dem(gx, gy, **second).save(tmp_path / "dem")  # dem_prep run again into the same file
    run_cli(*common, "--out", tmp_path / "full", "--derived-out", tmp_path / "full" / "elevation.json")
    r = run_cli(*common, "--out", tmp_path / "solve", "--derived-out", tmp_path / "elevation.json", "--dirty",
                tmp_path / "dirty.json", "--previous-residual", tmp_path / "solve" / "residual_field.json",
                "--previous-derived", tmp_path / "elevation.json")
    assert "previous residual field" in r.stdout  # says why it was not reused
    z_full = Grid.load(tmp_path / "full" / "corrected_dem.json").data
    z_inc = Grid.load(tmp_path / "solve" / "corrected_dem.json").data
    assert z_inc.shape == z_full.shape
    assert np.allclose(z_full, z_inc, atol=1e-4)
    d_full = json.loads((tmp_path / "full" / "elevation.json").read_text(encoding="utf-8"))
    d_inc = json.loads((tmp_path / "elevation.json").read_text(encoding="utf-8"))
    for k, v in d_full["edges"].items():
        assert d_inc["edges"][k]["elev_diff_m"] == pytest.approx(v["elev_diff_m"], abs=1e-6)
    for k, v in d_full["nodes"].items():
        assert d_inc["nodes"][k]["z_m"] == pytest.approx(v["z_m"], abs=1e-6)


def test_dirty_run_on_the_same_dem_still_reuses_the_previous_field(tmp_path):
    """v1: the same DEM keeps the incremental path (the fingerprint written by the first run matches)."""
    gx, gy, camp = _setup(tmp_path)
    _dem(gx, gy, 1.0).save(tmp_path / "dem")
    common = ["--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp]
    run_cli(*common, "--out", tmp_path / "solve", "--derived-out", tmp_path / "elevation.json")
    r = run_cli(*common, "--out", tmp_path / "solve", "--derived-out", tmp_path / "elevation.json", "--dirty",
                tmp_path / "dirty.json", "--previous-residual", tmp_path / "solve" / "residual_field.json",
                "--previous-derived", tmp_path / "elevation.json")
    assert "dirty tile(s) updated" in r.stdout
    assert "not reused" not in r.stdout
    assert len(Grid.load(tmp_path / "solve" / "residual_field.json").meta["dem_sha256"]) == 64


def test_previous_residual_without_a_fingerprint_is_not_trusted(tmp_path):
    """A residual_field.json written before dem_sha256 existed: one full run, then incremental again."""
    gx, gy, camp = _setup(tmp_path)
    _dem(gx, gy, 1.0).save(tmp_path / "dem")
    common = ["--store", tmp_path / "store.json", "--dem", tmp_path / "dem.json", "--campus", camp]
    run_cli(*common, "--out", tmp_path / "solve", "--derived-out", tmp_path / "elevation.json")
    meta_path = tmp_path / "solve" / "residual_field.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    del meta["dem_sha256"]
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    dirty = ["--out", tmp_path / "solve", "--derived-out", tmp_path / "elevation.json", "--dirty", tmp_path / "dirty.json",
             "--previous-residual", meta_path, "--previous-derived", tmp_path / "elevation.json"]
    assert "made before DEM fingerprints" in run_cli(*common, *dirty).stdout
    assert "dirty tile(s) updated" in run_cli(*common, *dirty).stdout
