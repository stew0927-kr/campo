"""
실행:  cd tools/elevation && python -m pytest -q test_campo_height_solver.py

가상 캠퍼스(언덕 지형):
  실외 O1~O5, 1공학관(eng1) 1F·2F 층 평면, 루프·왕복 엣지 + 의도적 오차 엣지 1개(e2_bad, +2.5 m)
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from campo_grid import Grid  # noqa: E402
from campo_height_solver import (  # noqa: E402
    Edge, Node, ResidualCenter, dirty_tiles, residual_centers, residual_field,
    solve_heights, update_tiles, wendland_c2,
)

TRUE = {"op:O1": 30.0, "op:O2": 31.5, "op:O3": 34.0, "op:O4": 36.2, "op:O5": 42.0,
        "fp:eng1:1F": 34.6, "fp:eng1:2F": 38.8}
XY = {"op:O1": (203000, 552000), "op:O2": (203020, 552010), "op:O3": (203045, 552025),
      "op:O4": (203060, 552050), "op:O5": (203040, 552075)}


def nodes():
    ns = [Node(k, "outdoor_point", *XY[k], influence_r=1.0 if k != "op:O5" else 3.0) for k in XY]
    ns += [Node("fp:eng1:1F", "floor_plane"), Node("fp:eng1:2F", "floor_plane")]
    return ns


def make_edges(seed=7, bad=2.5):
    g = np.random.default_rng(seed)
    spec = [  # id, from, to, sigma, offset_to
        ("e1", "op:O1", "op:O2", 0.30, 0.0),
        ("e2_bad", "op:O2", "op:O3", 0.30, 0.0),
        ("e2_day2", "op:O2", "op:O3", 0.35, 0.0),
        ("e3", "op:O3", "op:O4", 0.30, 0.0),
        ("e4", "op:O4", "op:O5", 0.40, 0.0),
        ("e5_loop", "op:O5", "op:O1", 0.45, 0.0),
        ("e6", "op:O2", "op:O4", 0.35, 0.0),
        ("e7_entr_a", "op:O3", "fp:eng1:1F", 0.30, 0.0),   # 정문 → 1층
        ("e8_entr_b", "op:O4", "fp:eng1:1F", 0.30, 0.4),   # 다른 날, 후문(층 대비 +0.4 m 단차 지점)
        ("e9_up", "fp:eng1:1F", "fp:eng1:2F", 0.25, 0.0),
        ("e10_down", "fp:eng1:2F", "fp:eng1:1F", 0.25, 0.0),
        ("e11_bridge", "op:O5", "fp:eng1:2F", 0.30, 0.0),  # 언덕 위 2층 출입구
    ]
    out = []
    for eid, a, b, s, off_to in spec:
        dh = TRUE[b] + off_to - TRUE[a] + g.normal(0, s)
        if eid == "e2_bad":
            dh += bad
        out.append(Edge(eid, a, b, float(dh), s, 0.0, off_to))
    return out


def coarse_dem(x, y):
    """90 m급 DEM 흉내: 평면 근사 + 완만한 편향(국소 단차를 못 잡음)"""
    return 30.0 + 0.11 * (x - 203000) + 0.09 * (y - 552000) - 1.0


def rel(res, k, ref="op:O1"):
    return res.nodes[k].h - res.nodes[ref].h


# ---------------------------------------------------------------- 1단계

def test_bad_edge_rejected_by_w_test_and_heights_recovered():
    res = solve_heights(nodes(), make_edges(), dem_fn=coarse_dem, sigma_dem=3.0)
    rejected = [k for k, v in res.edges.items() if v.qc == "rejected"]
    assert rejected == ["e2_bad"], res.log
    for k in TRUE:
        err = rel(res, k) - (TRUE[k] - TRUE["op:O1"])
        assert abs(err) < 0.4, (k, err)
    # 층고 2F − 1F
    assert abs((res.nodes["fp:eng1:2F"].h - res.nodes["fp:eng1:1F"].h) - 4.2) < 0.25
    assert res.global_test_passed, res.log


def test_floor_plane_shared_by_two_entrances_on_different_days():
    res = solve_heights(nodes(), make_edges(), dem_fn=coarse_dem)
    # 두 입구 엣지가 같은 1F 변수에 묶여 잔차가 둘 다 작아야 함(오프셋 0.4 m 반영)
    for eid in ("e7_entr_a", "e8_entr_b"):
        assert abs(res.edges[eid].residual_m) < 0.6, (eid, res.edges[eid])
    assert res.nodes["fp:eng1:1F"].dem_h is None  # 층 평면엔 DEM prior 없음


def test_huber_alone_downweights_when_snooping_disabled():
    res = solve_heights(nodes(), make_edges(), dem_fn=coarse_dem, alpha=1e-15)  # 임계 ≈ 8σ
    assert res.edges["e2_bad"].qc == "downweighted"
    assert res.edges["e2_bad"].robust_weight < 0.5
    err = rel(res, "op:O3") - (TRUE["op:O3"] - TRUE["op:O1"])
    assert abs(err) < 0.8


def test_absolute_datum_comes_from_dem_and_is_uncertain():
    res = solve_heights(nodes(), make_edges(), dem_fn=coarse_dem, sigma_dem=3.0)
    # 절대 높이 σ는 DEM prior 평균 수준(≈3/√5), 상대 σ(datum 오차 제외)는 Δh 정밀도 수준
    assert 0.8 < res.nodes["op:O1"].sigma < 2.0
    assert res.nodes["op:O1"].sigma_rel < 0.4


def test_floating_component_and_untestable_dangling_edge():
    ns = nodes() + [Node("fp:lib:1F", "floor_plane"), Node("fp:lib:2F", "floor_plane"),
                    Node("op:O6", "outdoor_point", 203100, 552100)]
    es = make_edges() + [
        Edge("lib_up", "fp:lib:1F", "fp:lib:2F", 4.5, 0.25),
        Edge("lib_up2", "fp:lib:1F", "fp:lib:2F", 4.3, 0.25),
        Edge("dangling", "op:O5", "op:O6", 1.0, 0.3),
    ]
    res = solve_heights(ns, es, dem_fn=coarse_dem)
    assert res.nodes["fp:lib:1F"].floating and res.nodes["fp:lib:2F"].floating
    assert abs((res.nodes["fp:lib:2F"].h - res.nodes["fp:lib:1F"].h) - 4.4) < 1e-6
    assert res.edges["dangling"].qc == "untestable"  # 루프 없음 → 검출 불가
    assert not res.nodes["op:O1"].floating


def test_superseded_edges_are_ignored():
    es = make_edges()
    es[0].qc = "superseded"
    es[0].dh += 100  # 만약 쓰였다면 해가 망가졌을 값
    res = solve_heights(nodes(), es, dem_fn=coarse_dem)
    ref = solve_heights(nodes(), make_edges()[1:], dem_fn=coarse_dem)  # e1을 아예 뺀 해와 같아야 함
    assert res.edges["e1"].qc == "superseded"
    for k in TRUE:
        assert abs(res.nodes[k].h - ref.nodes[k].h) < 1e-9


# ---------------------------------------------------------------- 2단계

def test_wendland_c2_properties():
    t = np.array([0.0, 0.5, 1.0, 1.2])
    phi = wendland_c2(t)
    assert phi[0] == 1.0 and phi[2] == 0.0 and phi[3] == 0.0
    h = 1e-4  # t=1에서 1·2차 도함수 ≈ 0 (C²)
    d1 = (wendland_c2(1.0) - wendland_c2(1 - h)) / h
    d2 = (wendland_c2(1.0) - 2 * wendland_c2(1 - h) + wendland_c2(1 - 2 * h)) / h ** 2
    assert abs(d1) < 1e-8 and abs(d2) < 1e-3


def flat_grid(res=0.5):
    w, hgt = int(130 / res), int(140 / res)  # O1~O5를 넉넉히 덮는 130 m × 140 m
    x0, y0 = 202970.0, 552120.0
    xs = x0 + (np.arange(w) + 0.5) * res
    ys = y0 - (np.arange(hgt) + 0.5) * res
    X, Y = np.meshgrid(xs, ys)
    return Grid(coarse_dem(X, Y), x0, y0, res)


def test_residual_field_compact_support_and_center_value():
    grid = flat_grid()
    res = solve_heights(nodes(), make_edges(), dem=grid, sigma_dem=3.0)
    cs = residual_centers(nodes(), res)
    z = residual_field(grid, cs, method="fusion", sigma_prior=3.0)
    X, Y = np.meshgrid(*grid.cell_centers())
    near = np.zeros_like(z, bool)
    for c in cs:
        near |= np.hypot(X - c.x, Y - c.y) < c.radius
    assert np.all(z[~near] == 0.0)  # 반경 밖은 정확히 DEM 그대로
    for c in cs:
        col, row = grid.xy_to_colrow(c.x, c.y)
        zc = z[int(round(float(row))), int(round(float(col)))]
        assert abs(zc - c.r) < 0.25 * abs(c.r) + 0.05, (c.key, zc, c.r)
    # 가변 반경: O5(R=3 m)는 2 m 떨어진 곳도 보정, O1(R=1 m)은 0
    for key, d, expect_nonzero in (("op:O5", 2.0, True), ("op:O1", 2.0, False)):
        c = next(cc for cc in cs if cc.key == key)
        col, row = grid.xy_to_colrow(c.x + d, c.y)
        v = z[int(round(float(row))), int(round(float(col)))]
        assert (abs(v) > 1e-3) == expect_nonzero, (key, v)


def test_rbf_method_uniform_radius():
    grid = flat_grid()
    cs = [ResidualCenter("a", 203000.0, 552050.0, 1.2, 0.2, 2.0),
          ResidualCenter("b", 203001.5, 552050.0, -0.4, 0.2, 2.0)]
    z = residual_field(grid, cs, method="rbf", sigma_prior=3.0, rbf_smooth=1.0)
    col, row = grid.xy_to_colrow(203000.0, 552050.0)
    assert abs(z[int(row), int(col)] - 1.2) < 0.3
    with pytest.raises(ValueError):
        residual_field(grid, cs[:1] + [ResidualCenter("c", 203010, 552050, 0.1, 0.2, 5.0)], method="rbf")


def test_incremental_tile_update_equals_full_recompute():
    grid = flat_grid()
    res = solve_heights(nodes(), make_edges(), dem=grid)
    cs = residual_centers(nodes(), res)
    z_old = residual_field(grid, cs)
    # O3만 새 측정으로 0.7 m 바뀌었다고 가정
    cs2 = [ResidualCenter(c.key, c.x, c.y, c.r + (0.7 if c.key == "op:O3" else 0.0), c.sigma, c.radius) for c in cs]
    changed = [c for c in cs2 if c.key == "op:O3"]
    tiles = dirty_tiles(grid, changed, tile=32)
    assert 1 <= len(tiles) <= 4
    z_inc = update_tiles(grid, z_old, cs2, tiles, tile=32)
    z_full = residual_field(grid, cs2)
    assert np.allclose(z_inc, z_full, atol=1e-12)


# ---------------------------------------------------------------- 격자 포맷 + CLI

def test_grid_roundtrip_float32_and_uint16(tmp_path):
    g = flat_grid(1.0)
    g.data[0, 0] = np.nan
    for dt, tol in (("float32", 1e-4), ("uint16", 0.006)):
        g.save(tmp_path / f"g_{dt}", dtype=dt)
        g2 = Grid.load(tmp_path / f"g_{dt}.json")
        assert np.isnan(g2.data[0, 0])
        assert np.nanmax(np.abs(g2.data - g.data)) < tol
    v = g.sample_bilinear(203010.3, 552020.7)[0]
    assert abs(v - coarse_dem(203010.3, 552020.7)) < 1e-6  # 평면이면 쌍선형이 정확


def test_cli_end_to_end_with_latlng_store(tmp_path):
    from pyproj import Transformer
    inv = Transformer.from_crs("EPSG:5186", "EPSG:4326", always_xy=True)
    grid = flat_grid(1.0)
    grid.save(tmp_path / "campus_dem")
    store = {"schemaVersion": 1, "positionCrs": "EPSG:4326", "verticalDatum": "KVD_INCHEON_MSL",
             "nodes": [], "sessions": [], "edges": []}
    for n in nodes():
        if n.kind == "outdoor_point":
            lng, lat = inv.transform(n.x, n.y)
            store["nodes"].append({"kind": "outdoor_point", "key": n.key, "position": {"lat": lat, "lng": lng},
                                   "influenceRadiusM": n.influence_r, "createdAt": 0})
        else:
            _, b, f = n.key.split(":")
            store["nodes"].append({"kind": "floor_plane", "key": n.key, "buildingId": b, "floorId": f, "createdAt": 0})
    for e in make_edges():
        store["edges"].append({"edgeId": e.id, "from": e.frm, "to": e.to, "dhM": e.dh, "sigmaM": e.sigma,
                               "dtS": 300, "offsetFromM": e.off_from, "offsetToM": e.off_to, "sessionId": "s",
                               "method": "static_pair", "qc": "pending",
                               "model": {"tempC": 15, "sigmaInstFloorHpa": 0.03, "driftHpaPerHour": 0.3},
                               "createdAt": 0})
    sp_ = tmp_path / "store.json"
    sp_.write_text(json.dumps(store), encoding="utf-8")
    out = tmp_path / "out"
    r = subprocess.run([sys.executable, str(Path(__file__).parent / "campo_height_solver.py"), "--store", str(sp_),
                        "--dem", str(tmp_path / "campus_dem.json"), "--out", str(out)], capture_output=True, text=True,
                       encoding="utf-8", env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    assert r.returncode == 0, r.stderr
    solved = json.loads((out / "store.solved.json").read_text(encoding="utf-8"))
    assert solved["lastSolve"]["rejectedEdgeIds"] == ["e2_bad"]
    assert next(e for e in solved["edges"] if e["edgeId"] == "e2_bad")["qc"] == "rejected"
    corrected = Grid.load(out / "corrected_dem.json")
    assert corrected.data.shape == grid.data.shape
