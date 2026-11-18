"""
실행:  cd tools/elevation && python -m pytest -q test_solver_config.py

solver_config: 기본값이 설계 명세(docs/ELEVATION_SOLVER_V2.md 권장 파라미터 표)와 같고, JSON·점 경로·--set 덮어쓰기가 동작하며,
모르는 키와 범위를 벗어난 값을 거부한다.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from solver_config import (  # noqa: E402
    CONFIG_FORMAT, SolverConfig, config_from_dict, config_to_dict, load_config, parse_set_args, validate, with_overrides,
)


def test_defaults_match_the_design():
    c = SolverConfig()
    assert (c.raster.half_width_m, c.raster.soft_ring_m) == (1.0, 0.5)
    assert (c.island.area_max_m2, c.island.radius_max_m, c.island.area_big_m2, c.island.kappa) == (400.0, 5.0, 3000.0, 0.0)
    s = c.shoulder
    assert (s.decay_length_m, s.adaptive, s.decay_min_m, s.decay_max_m, s.side_slope) == (3.0, True, 2.0, 8.0, 0.5)
    assert s.band_factor * s.decay_length_m == 15.0
    assert (s.cg_rtol, s.cg_maxiter) == (1e-6, 500)
    assert (s.wall_high_share, s.wall_tip_slope, s.wall_min_step_m) == (0.5, 0.5, 0.001)
    b = c.building
    assert (b.apron_m, b.cut_slope, b.fill_slope, b.smooth_k_m, b.alpha_b, b.step_max_m) == (1.0, 0.67, 0.5, 0.3, 4.0, 0.5)
    assert (b.sigma_meas_m, b.up_share_point_below, b.up_share_point_above) == (0.02, 0.95, 0.80)
    w = c.wls
    assert (w.riser_m, w.riser_sigma_m) == (0.16, 0.015)
    assert (w.ramp_gmax_accessible, w.ramp_gmax_general) == (1 / 12, 1 / 8)
    assert (w.sigma_dem_m, w.sigma_stair_mid_m, w.ramp_sigma_m) == (3.0, 5.0, 1.0)
    assert w.stair_sigma_base_m == 0.05 and w.stair_sigma_per_step_m == 0.01
    assert validate(c) == []


def test_json_roundtrip():
    cfg = with_overrides(SolverConfig(), {"island.area_max_m2": 600, "wls.soft_flat_sigma_m": 0.15, "shoulder.adaptive": False})
    d = json.loads(json.dumps(config_to_dict(cfg)))
    assert d["format"] == CONFIG_FORMAT
    assert config_from_dict(d) == cfg
    assert config_from_dict(config_to_dict(SolverConfig())) == SolverConfig()


def test_overrides(tmp_path):
    cfg = with_overrides(SolverConfig(), {"island.area_max_m2": 600, "building.up_share_point_above": 0.7})
    assert cfg.island.area_max_m2 == 600.0 and cfg.building.up_share_point_above == 0.7
    assert cfg.island.radius_max_m == 5.0  # untouched keys keep the base
    sets = parse_set_args(["island.area_max_m2=600", "shoulder.adaptive=false", "shoulder.cg_maxiter=200"])
    assert sets == {"island.area_max_m2": 600, "shoulder.adaptive": False, "shoulder.cg_maxiter": 200}
    # file -> --set: the later one wins
    p = tmp_path / "c.json"
    p.write_text(json.dumps({"format": CONFIG_FORMAT, "island": {"area_max_m2": 900, "kappa": 0.1}}), encoding="utf-8")
    from_file = load_config(p)
    assert from_file.island.area_max_m2 == 900 and from_file.island.kappa == 0.1
    final = with_overrides(from_file, parse_set_args(["island.area_max_m2=1200"]))
    assert final.island.area_max_m2 == 1200 and final.island.kappa == 0.1
    # integer fields stay integers, Optional floats accept null
    assert isinstance(with_overrides(SolverConfig(), {"shoulder.cg_maxiter": 300.0}).shoulder.cg_maxiter, int)
    assert with_overrides(cfg, {"wls.soft_flat_sigma_m": None}).wls.soft_flat_sigma_m is None


def test_unknown_keys_are_rejected():
    with pytest.raises(ValueError):
        config_from_dict({"islands": {"area_max_m2": 1}})
    with pytest.raises(ValueError):
        config_from_dict({"island": {"area_max": 1}})
    with pytest.raises(ValueError):
        config_from_dict({"format": "other/1"})
    with pytest.raises(ValueError):
        with_overrides(SolverConfig(), {"area_max_m2": 1})
    with pytest.raises(ValueError):
        parse_set_args(["island.area_max_m2"])
    with pytest.raises(ValueError):
        with_overrides(SolverConfig(), {"shoulder.adaptive": "yes"})


def test_validate():
    bad = {
        "raster.half_width_m": -1.0,
        "island.kappa": 0.5,
        "building.up_share_point_above": 1.0,
        "island.area_max_m2": 5000.0,
        "shoulder.decay_min_m": 9.0,
        "wls.riser_min_m": 0.17,
        "building.ref_percentile": 120.0,
    }
    for key, v in bad.items():
        msgs = validate(with_overrides(SolverConfig(), {key: v}))
        assert len(msgs) == 1, (key, msgs)


def test_plaza_section():
    c = SolverConfig()
    pz = c.plaza
    assert (pz.ref_percentile, pz.min_cells, pz.erode_cells, pz.relief_warn_m, pz.node_tol_m) == (50.0, 4, 1, 3.0, 0.1)
    cfg = with_overrides(c, parse_set_args(["plaza.min_cells=9", "plaza.ref_percentile=40"]))
    assert cfg.plaza.min_cells == 9 and isinstance(cfg.plaza.min_cells, int) and cfg.plaza.ref_percentile == 40.0
    assert config_from_dict(json.loads(json.dumps(config_to_dict(cfg)))) == cfg
    assert config_from_dict({"format": CONFIG_FORMAT, "plaza": {"node_tol_m": 0.2}}).plaza.node_tol_m == 0.2
    with pytest.raises(ValueError):
        config_from_dict({"plaza": {"height": 1}})
    for key, v in {"plaza.ref_percentile": 101.0, "plaza.min_cells": -1, "plaza.relief_warn_m": -0.5}.items():
        assert len(validate(with_overrides(SolverConfig(), {key: v}))) == 1, key
