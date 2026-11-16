"""
실행:  cd tools/elevation && python -m pytest -q test_node_wls.py

v2 1단계 노드 풀이(node_wls): 평지 클러스터 병합과 회랑 prior, 계단 단높이 변수·방향 2-pass, 경사로 g_max, 이상 간선,
건물 대지 하한과 실측 높이차의 4분면 규칙, v2 기능이 없는 문제에서 v1 solve_heights와 같은 해.
격자 없이 dem_at 콜백(식)과 가짜 corridor_dem만 쓴다.
"""
import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from campo_height_solver import Edge, Node, campus_model, solve_heights  # noqa: E402
from grid_grading import buried_area  # noqa: E402
from node_wls import (  # noqa: E402
    BuildingMeasurement, BuildingPad, DiffRow, FlatLink, HeightVar, Ramp, SoftFlatCand, Stair, WlsProblem, building_sigma,
    cluster_prior, solve_nodes,
)
from solver_config import SolverConfig, with_overrides  # noqa: E402

X0, Y0 = 203000.0, 552000.0
CFG = SolverConfig()


def run(problem, dem, corridor=None, cfg=CFG, **kw):
    return solve_nodes(problem, cfg.wls, cfg.building, dem_at=dem, corridor_dem=corridor, **kw)


def marker(i):
    """A polyline whose first x tells the fake corridor_dem which cluster asks."""
    return np.array([[float(i), 0.0], [float(i) + 1.0, 0.0]])


def fake_corridor(table):
    return lambda xy: np.asarray(table[int(round(xy[0, 0]))], float)


def diff_sigma(res, a, b):
    idx, Q = res.cov[res.comp_of[a]]
    i, j = idx[a], idx[b]
    return math.sqrt(max(Q[i, i] + Q[j, j] - 2 * Q[i, j], 0.0))


# ---------------------------------------------------------------- (c) 평지-계단·경사로 연동

def scene(delta=None, q_dem=31.6, t_dem=31.0, f_values=None, stair_sign=1, ramp_gmax=1 / 8, extra_rows=(), stair_n=10):
    """Flat cluster F (F1, F2, F3), stair F1 -> Q, ramp F2 -> T; optionally a strong cluster G tied to F by H_F - H_G = delta."""
    pts = {"cn:F1": (X0, Y0), "cn:F2": (X0 + 10, Y0), "cn:F3": (X0 + 5, Y0 + 8), "cn:Q": (X0 - 5, Y0 - 3),
           "cn:T": (X0 + 34, Y0)}
    dem = {"cn:F1": 30.0, "cn:F2": 30.0, "cn:F3": 30.0, "cn:Q": q_dem, "cn:T": t_dem}
    flats = [FlatLink("flat_exact:f12", "cn:F1", "cn:F2", marker(1)), FlatLink("flat_exact:f23", "cn:F2", "cn:F3"),
             FlatLink("flat_exact:f31", "cn:F3", "cn:F1")]
    table = {1: f_values if f_values is not None else [30.0] * 5}
    rows = list(extra_rows)
    if delta is not None:
        pts.update({"cn:G1": (X0 + 500, Y0), "cn:G2": (X0 + 520, Y0)})
        dem.update({"cn:G1": 30.0, "cn:G2": 30.0})
        flats.append(FlatLink("flat_exact:g", "cn:G1", "cn:G2", marker(2)))
        table[2] = [30.0] * 250
        rows.append(DiffRow("link", "cn:G1", "cn:F1", delta, 0.01, "measured"))
    vars_ = [HeightVar(k, "outdoor_point", *xy) for k, xy in pts.items()]
    lookup = {xy: dem[k] for k, xy in pts.items()}
    p = WlsProblem(vars_, rows=rows, flats=flats, stairs=[Stair("stair:s", "cn:F1", "cn:Q", stair_n, stair_sign)],
                   ramps=[Ramp("ramp:r", "cn:F2", "cn:T", 24.0, ramp_gmax)], stair_or_ramp_only={"cn:Q"})
    return p, (lambda x, y: lookup[(x, y)]), fake_corridor(table)


def test_flat_cluster_is_one_variable():
    res = run(*scene())
    h = [res.h[k] for k in ("cn:F1", "cn:F2", "cn:F3")]
    assert h[0] == h[1] == h[2]
    assert res.cluster_of["cn:F1"] == res.cluster_of["cn:F2"] == res.cluster_of["cn:F3"] == "cn:F1"
    assert diff_sigma(res, "cn:F1", "cn:F3") == 0.0


def test_cluster_prior_uses_the_corridor_median():
    vals = [30.0] * 55 + [50.0] * 5
    res = run(*scene(f_values=vals))
    assert abs(res.h["cn:F1"] - 30.0) < 0.05
    z, s = cluster_prior(np.array(vals), 1.0, CFG.wls)
    assert z == 30.0 and abs(s - 3.0 / math.sqrt(6)) < 1e-12
    assert res.prior_h["cn:F2"] == 30.0


def lift(**kw):
    a, b = run(*scene(delta=0.0, **kw)), run(*scene(delta=2.0, **kw))
    return a, b, b.h["cn:F1"] - a.h["cn:F1"]


def test_stair_follows_the_flat_cluster():
    a, b, dF = lift()
    assert dF > 1.5
    assert b.h["cn:Q"] - a.h["cn:Q"] >= 0.99 * dF


@pytest.mark.parametrize("sign", [1, None])
def test_riser_stays_in_range(sign):
    for q_dem in (31.6, 34.0):
        res = run(*scene(q_dem=q_dem, stair_sign=sign))
        r = res.stairs["stair:s"].riser_m
        assert 0.13 <= r <= 0.19
        assert abs((res.h["cn:Q"] - res.h["cn:F1"]) / 10 - r) <= 0.02
        assert res.stairs["stair:s"].direction_source == ("attribute" if sign else "auto")


@pytest.mark.parametrize("sign", [1, None])
def test_stair_follows_the_flat_cluster_with_and_without_the_incline(sign):
    # Q's DEM stays above the lifted cluster, so the 2-pass direction is "up" in both solves.
    a, b, dF = lift(stair_sign=sign, q_dem=34.6)
    assert b.h["cn:Q"] - a.h["cn:Q"] >= 0.99 * dF
    for res in (a, b):
        assert 0.13 <= res.stairs["stair:s"].riser_m <= 0.19 and res.stairs["stair:s"].sign == 1


def test_ramp_follows_the_flat_cluster():
    a, b, dF = lift()
    assert b.h["cn:T"] - a.h["cn:T"] >= 0.85 * dF
    for res in (a, b):
        assert abs(res.h["cn:T"] - res.h["cn:F2"]) / 24 <= 1 / 8
        assert res.ramps_capped == []


@pytest.mark.parametrize("gmax", [1 / 8, 1 / 12])
def test_ramp_is_capped_at_g_max(gmax):
    res = run(*scene(t_dem=34.0, ramp_gmax=gmax))
    assert abs(res.h["cn:T"] - res.h["cn:F2"]) / 24 <= gmax + 1e-3
    assert res.ramps_capped == ["ramp:r"]


def test_stair_direction_from_attribute_and_auto():
    res = run(*scene(q_dem=28.0, stair_sign=1))  # the DEM goes down, the attribute says up
    assert res.h["cn:Q"] - res.h["cn:F1"] > 0 and res.stairs["stair:s"].direction_source == "attribute"
    res = run(*scene(q_dem=28.8, stair_sign=None))  # DEM difference -1.2 m
    assert res.h["cn:Q"] - res.h["cn:F1"] < 0
    assert res.stairs["stair:s"].direction_source == "auto" and res.stairs["stair:s"].sign == -1
    res = run(*scene(q_dem=30.05, stair_sign=None))  # 5 cm: cannot tell
    assert res.stairs["stair:s"].direction_source == "dropped"
    assert any("stair:s: direction not determined" in line for line in res.log)


def test_outlier_rows_are_logged():
    # A strong 4.0 m drop row on the ends of a 10-step stair: the riser is held at 0.19 m and the stair row takes the rest.
    force = DiffRow("breakline_drop:x", "cn:F1", "cn:Q", 4.0, 0.01, "breakline_drop")
    res = run(*scene(extra_rows=[force]))
    assert res.stairs["stair:s"].riser_m == 0.19
    hit = [o for o in res.outliers if o.id == "stair:s" and o.kind == "stair"]
    assert hit and hit[0].ratio > 3
    assert any(o.kind == "stair_riser" for o in res.outliers)
    assert any(line.startswith("outlier stair stair:s") for line in res.log)


# ---------------------------------------------------------------- v1 동등성

def to_problem(nodes, edges, soft=(), scale=None):
    vars_ = [HeightVar(n.key, n.kind, n.x, n.y) for n in nodes]
    rows = [DiffRow(e.id, e.frm, e.to, e.dh, e.sigma, e.kind, e.off_from, e.off_to, e.qc) for e in edges
            if e.kind in ("measured", "floor_prior", "breakline_drop")]
    assert len(rows) == len(edges), "the scene has v2-only rows"
    return WlsProblem(vars_, rows=rows, soft_flats=[SoftFlatCand(s.id, s.frm, s.to, s.length) for s in soft],
                      sigma_scale=dict(scale or {}))


def v1_scenes():
    import test_campo_height_solver as t1
    import test_campus_constraints as t2
    out = [("hill", t1.nodes(), t1.make_edges(), (), {}, t1.coarse_dem, {})]
    ns = t1.nodes() + [Node("fp:lib:1F", "floor_plane"), Node("fp:lib:2F", "floor_plane"),
                       Node("op:O6", "outdoor_point", 203100, 552100)]
    es = t1.make_edges() + [Edge("lib_up", "fp:lib:1F", "fp:lib:2F", 4.5, 0.25),
                            Edge("lib_up2", "fp:lib:1F", "fp:lib:2F", 4.3, 0.25), Edge("dangling", "op:O5", "op:O6", 1.0, 0.3)]
    out.append(("floating", ns, es, (), {}, t1.coarse_dem, {}))
    out.append(("huber", t1.nodes(), t1.make_edges(), (), {}, t1.coarse_dem, {"alpha": 1e-15}))
    for name, feats, dem in (
        ("building", t2.building_campus(), lambda x, y: 30.0),
        ("hill_portals", t2.building_campus() + [
            t2.feat_node("n_out_top", X0 + 30, Y0), t2.feat_node("n_E_4_entr", X0 + 27, Y0, "bldg_E", 4, "entrance"),
            t2.feat_edge("e_portal_top", "n_E_4_entr", "n_out_top", edge_type="portal")],
         lambda x, y: 30.0 + 2.0 * (x >= X0 + 30)),
        ("flat", t2.two_points(0.005)[0], None), ("slope", t2.two_points(0.05)[0], None),
    ):
        if isinstance(feats, list):
            cm = campus_model(feats, t2.ident)
        else:
            cm, dem = feats, (lambda g: (lambda x, y: 30.0 + g * (x - X0)))(0.005 if name == "flat" else 0.05)
        out.append((name, cm.nodes, cm.edges, cm.soft_flat, cm.sigma_dem_scale, dem, {}))
    return out


@pytest.mark.parametrize("scene_", v1_scenes(), ids=lambda s: s[0])
def test_matches_v1_without_v2_features(scene_):
    _, nodes, edges, soft, scale, dem, kw = scene_
    v1 = solve_heights(nodes, edges, dem_fn=dem, soft_flat=soft, sigma_dem_scale=scale, **kw)
    v2 = run(to_problem(nodes, edges, soft, scale), dem, **kw)
    assert set(v2.h) == set(v1.nodes)
    for k, r in v1.nodes.items():
        assert abs(v2.h[k] - r.h) < 1e-9, k
        assert abs(v2.sigma[k] - r.sigma) < 1e-9, k
        assert abs(v2.sigma_rel[k] - r.sigma_rel) < 1e-9, k
        assert v2.floating[k] == r.floating
    assert {k for k, v in v2.rows.items() if v.qc == "rejected"} == {k for k, v in v1.edges.items() if v.qc == "rejected"}
    assert {k: v.qc for k, v in v2.rows.items()} == {k: v.qc for k, v in v1.edges.items()}
    assert {k: v["active"] for k, v in v2.soft_flat.items()} == {k: v["active"] for k, v in v1.soft_flat.items()}
    assert v2.components == v1.components
    assert abs(v2.chi2 - v1.chi2) < 1e-6 and v2.dof == v1.dof


# ---------------------------------------------------------------- (d) 건물: 실측 높이차 4분면

PAD = "fp:bldg_T:1F"


def bscene(h_ref, d_meas=None, lower=None, point="single", attach=None, cfg=CFG):
    """Pad variable + outside point P (DEM 30). point: 'single' (sigma 3) or 'cluster' (two points, corridor sigma 0.6)."""
    vars_ = [HeightVar(PAD, "floor_plane")]
    dem = {}
    flats, table, stairs, soft = [], {}, [], []
    if point == "single":
        vars_.append(HeightVar("cn:P", "outdoor_point", X0, Y0))
        dem[(X0, Y0)] = 30.0
    else:
        vars_ += [HeightVar("cn:P", "outdoor_point", X0, Y0), HeightVar("cn:P2", "outdoor_point", X0 + 8, Y0)]
        dem[(X0, Y0)] = dem[(X0 + 8, Y0)] = 30.0
        flats.append(FlatLink("flat_exact:p", "cn:P", "cn:P2", marker(1)))
        table[1] = [30.0] * 250
    if attach in ("loose_stair", "tight_stair", "soft"):
        if attach == "tight_stair":
            vars_ += [HeightVar("cn:S", "outdoor_point", X0 - 6, Y0), HeightVar("cn:S2", "outdoor_point", X0 - 12, Y0)]
            dem[(X0 - 6, Y0)] = dem[(X0 - 12, Y0)] = 31.6
            flats.append(FlatLink("flat_exact:s", "cn:S", "cn:S2", marker(2)))
            table[2] = [31.6] * 250
        elif attach == "soft":
            vars_ += [HeightVar("cn:S", "outdoor_point", X0 - 6, Y0), HeightVar("cn:S2", "outdoor_point", X0 - 12, Y0)]
            dem[(X0 - 6, Y0)] = dem[(X0 - 12, Y0)] = 30.0
            flats.append(FlatLink("flat_exact:s", "cn:S", "cn:S2", marker(2)))
            table[2] = [30.0] * 250
        else:
            vars_.append(HeightVar("cn:S", "outdoor_point", X0 - 6, Y0))
            dem[(X0 - 6, Y0)] = 31.6
        if attach == "soft":
            soft.append(SoftFlatCand("soft_flat:ps", "cn:P", "cn:S", 6.0))
        else:
            stairs.append(Stair("stair:ps", "cn:P", "cn:S", 10, 1))
    pad = BuildingPad("bldg_T", PAD, h_ref, "survey", h_ref if lower is None else lower)
    meas = [] if d_meas is None else [BuildingMeasurement("bm-1", "bldg_T", "cn:P", d_meas)]
    p = WlsProblem(vars_, flats=flats, stairs=stairs, soft_flats=soft, pads=[pad], measurements=meas)
    return p, (lambda x, y: dem[(x, y)]), fake_corridor(table)


def moves(h_ref, eps, **kw):
    d0 = h_ref - 30.0
    base = run(*bscene(h_ref, d0, **kw), cfg=kw.get("cfg", CFG))
    res = run(*bscene(h_ref, d0 + eps, **kw), cfg=kw.get("cfg", CFG))
    return res, res.h[PAD] - base.h[PAD], res.h["cn:P"] - base.h["cn:P"], base


QUADRANTS = [  # id, h_ref, eps, rho, bound active
    ("below-smaller", 31.0, -1.0, 0.95, True),
    ("below-larger", 31.0, 1.0, 0.95, False),
    ("above-closer", 29.0, 1.0, 0.80, False),
    ("above-farther", 29.0, -1.0, 0.80, True),
]


def check_building(res, h_ref, d_meas):
    b = res.buildings["bldg_T"]
    assert b.h >= h_ref - 1e-9
    assert abs(res.h[PAD] - res.h["cn:P"] - d_meas) <= 0.03
    assert abs(b.measurement_residuals["bm-1"]) <= 0.03
    ring = np.ones((1, 4), bool)
    dem0 = np.array([[h_ref + 0.6, h_ref + 0.2, h_ref - 0.3, h_ref - 1.0]])
    assert buried_area(dem0, ring, b.h, 1.0) <= buried_area(dem0, ring, h_ref, 1.0)


@pytest.mark.parametrize("qid, h_ref, eps, rho, bound", QUADRANTS, ids=[q[0] for q in QUADRANTS])
def test_measured_difference_quadrants(qid, h_ref, eps, rho, bound):
    res, mb, mp, _ = moves(h_ref, eps)
    b = res.buildings["bldg_T"]
    assert b.up_share == rho and b.lower_bound_active == bound
    check_building(res, h_ref, h_ref - 30.0 + eps)
    assert mb >= -1e-9
    if eps > 0:
        assert mb > 0 and mp < 0
        assert abs(mb / eps - rho) <= 0.01
        assert abs(mp / eps + (1 - rho)) <= 0.01
    else:
        assert abs(mb) <= 1e-9 and mp >= 0.99 * abs(eps)
        assert res.h[PAD] == h_ref  # exactly on the bound


@pytest.mark.parametrize("h_ref, rho", [(31.0, 0.95), (29.0, 0.80)])
def test_measured_difference_with_a_cluster_point(h_ref, rho):
    res, mb, mp, base = moves(h_ref, 1.0, point="cluster")
    assert abs(mb - rho) <= 0.01 and abs(mp + (1 - rho)) <= 0.01
    assert res.h["cn:P"] - base.h["cn:P"] == res.h["cn:P2"] - base.h["cn:P2"]
    check_building(res, h_ref, h_ref - 30.0 + 1.0)


@pytest.mark.parametrize("attach", ["loose_stair", "tight_stair", "soft"])
@pytest.mark.parametrize("h_ref, rho", [(31.0, 0.95), (29.0, 0.80)])
def test_measured_difference_with_attached_stairs(attach, h_ref, rho):
    cfg = with_overrides(CFG, {"wls.soft_flat_sigma_m": 0.15})
    res, mb, mp, base = moves(h_ref, 1.0, point="cluster", attach=attach, cfg=cfg)
    _, mb_alone, _, _ = moves(h_ref, 1.0, point="cluster", cfg=cfg)
    assert mb > 0 and mp < 0
    assert rho - 0.01 <= mb <= 0.99
    assert mb >= mb_alone - 0.01
    ms = res.h["cn:S"] - base.h["cn:S"]
    assert ms * mp > 0  # the attached point moves with P
    if attach != "soft":
        assert 0.13 <= res.stairs["stair:ps"].riser_m <= 0.19
    check_building(res, h_ref, h_ref - 30.0 + 1.0)


def test_lower_bound_without_measurement():
    cfg = with_overrides(CFG, {"wls.soft_flat_sigma_m": 0.15})
    h_ref = 31.0
    vars_ = [HeightVar(PAD, "floor_plane"), HeightVar("cn:D", "outdoor_point", X0, Y0)]
    p = WlsProblem(vars_, soft_flats=[SoftFlatCand("soft_flat:portal", PAD, "cn:D", 3.0)],
                   pads=[BuildingPad("bldg_T", PAD, h_ref, "entrance_ring", h_ref)])
    res = run(p, lambda x, y: h_ref - 1.0, cfg=cfg)
    b = res.buildings["bldg_T"]
    assert abs(res.h[PAD] - h_ref) <= 1e-9 and b.lower_bound_active
    assert b.sigma_b == pytest.approx(3.0 * math.sqrt(0.95 / 0.05))


def test_buried_area_never_grows():
    for _, h_ref, eps, _, _ in QUADRANTS:
        for eps2 in (eps, 3 * eps, 0.0):
            res, _, _, _ = moves(h_ref, eps2)
            check_building(res, h_ref, h_ref - 30.0 + eps2)


def test_sign_and_sigma_are_fixed_before_solving():
    res, mb, mp, _ = moves(31.0, -3.0)  # the point ends 2 m above the building
    assert res.h["cn:P"] > res.h[PAD]
    assert res.buildings["bldg_T"].up_share == 0.95


def test_ratchet_raises_the_lower_bound():
    res = run(*bscene(31.0, 0.0, lower=31.4))
    assert res.h[PAD] >= 31.4 - 1e-9 and res.buildings["bldg_T"].lower_bound == 31.4


def test_d0_zero_counts_as_below():
    res, mb, _, _ = moves(30.0, 1.0)
    assert res.buildings["bldg_T"].up_share == 0.95
    assert abs(mb - 0.95) <= 0.01
    assert building_sigma(3.0, 0.0, CFG.building)[1] == 0.95


def test_epsilon_zero_changes_nothing():
    for _, h_ref, _, _, _ in QUADRANTS:
        res, mb, mp, _ = moves(h_ref, 0.0)
        assert abs(mb) <= 1e-9 and abs(mp) <= 1e-9
        assert abs(res.h[PAD] - h_ref) <= 1e-9 and abs(res.h["cn:P"] - 30.0) <= 1e-9
