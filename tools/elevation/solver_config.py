"""
CAMPO height solver v2 tuning parameters (docs/ELEVATION_SOLVER_V2.md, recommended parameter table).

Every tuning number of the v2 engine lives here; node_wls.py and grid_grading.py take these dataclasses and hold no
magic numbers of their own. Overrides come, later winning, from: defaults -> <store folder>/solver_config.json ->
--config <file> -> --set key=value (repeatable) -> the legacy dedicated CLI flags (--sigma-dem, --soft-flat-max-grade).

    { "format": "campo-solver-config/1", "island": { "area_max_m2": 600 }, "building": { "up_share_point_above": 0.7 } }

Only the standard library is imported.
"""
from __future__ import annotations

import dataclasses
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Optional

CONFIG_FORMAT = "campo-solver-config/1"


@dataclass(frozen=True)
class RasterConfig:
    half_width_m: float = 1.0  # HALF_W: corridor half width
    soft_ring_m: float = 0.5  # SOFT_RING: partial cover ring (half_width < d <= half_width + soft_ring)
    bbox_pad_m: float = 2.0  # segment bounding box margin
    stair_display: bool = False  # stepped target: z = H_i + floor(t*n)/n * (H_j - H_i)
    min_half_width_cells: float = 0.71  # half width is at least this many cells (coarse grids keep the centre line)
    per_edge_width: bool = True  # read each edge's width_m (half width = width_m / 2); False: half_width_m everywhere
    width_min_m: float = 0.5  # edge width_m below this is clamped up to it (logged)
    width_max_m: float = 20.0  # edge width_m above this is clamped down to it (logged)


@dataclass(frozen=True)
class IslandConfig:
    area_max_m2: float = 400.0  # A_max
    radius_max_m: float = 5.0  # R_max
    area_big_m2: float = 3000.0  # A_big
    kappa: float = 0.0  # detail preservation, 0 <= kappa <= 0.3
    fixed_ring_min_ratio: float = 0.8  # with an exclusion mask: share of fixed cells on the outer ring


@dataclass(frozen=True)
class ShoulderConfig:
    decay_length_m: float = 3.0  # l (when adaptive is False)
    adaptive: bool = True  # l_p = clip(|d_near| / side_slope, decay_min, decay_max)
    decay_min_m: float = 2.0
    decay_max_m: float = 8.0
    side_slope: float = 0.5  # s_side (1:2)
    band_factor: float = 5.0  # band width = band_factor * l (15 m when l = 3)
    point_alpha: float = 1.0  # soft target weight of barometer points (1/m^2)
    cg_rtol: float = 1e-6
    cg_maxiter: int = 500
    # drawn break lines with lowSide / dropM (retaining walls): pinned ring cells on both sides of the line
    wall_high_share: float = 0.5  # 0..1: share of the drop the high side goes up (0 = only the low side goes down)
    wall_tip_slope: float = 0.5  # the drop shrinks to 0 at the open ends of a line with this slope (0 = no taper)
    wall_min_step_m: float = 0.001  # crossing links whose drop is at or below this keep no pin


@dataclass(frozen=True)
class BuildingConfig:
    apron_m: float = 1.0  # apron width a
    cut_slope: float = 0.67  # s_cut (1:1.5)
    fill_slope: float = 0.5  # s_fill (1:2)
    smooth_k_m: float = 0.3  # smooth-min / smooth-max k
    alpha_b: float = 4.0  # slope soft target weight alpha_B (1/m^2)
    target_eps_m: float = 0.01  # |h* - DEM| below this is not a slope cell
    step_max_m: float = 0.5  # h_step: logged above this
    max_reach_m: float = 60.0  # slope reach cap (window size)
    up_share_point_below: float = 0.95  # building_up_share when the point is below the building (D0 >= 0)
    up_share_point_above: float = 0.80  # building_up_share when the point is above the building (D0 < 0)
    sigma_meas_m: float = 0.02  # measured building <-> point height difference sigma
    ref_percentile: float = 30.0  # ring DEM_0 percentile when no entrance is known
    entrance_ring_radius_m: float = 5.0  # ring cells within this distance of an entrance
    ratchet: bool = False  # lower bound ratchet mode
    bound_tol_m: float = 1e-9  # a variable within this of a bound is on the bound
    # terraced pads (portal-based multi-level ground planes, docs/ELEVATION_SOLVER_V2.md "포탈 기준 다단 대지")
    terrace_enabled: bool = True  # False: one pad plane per building (the behaviour before terraced pads)
    terrace_tol_m: float = 0.6  # an upper level is a terrace only if |support - plane| <= this
    terrace_min_cells: int = 4  # 4-connected terrace pieces under this many cells merge into a neighbour
    terrace_max_levels: int = 3  # terraces per building, the base included
    terrace_multiple_tol_m: float = 0.05  # terrace step farther than this from k x floor height -> warning
    terrace_breakline: bool = True  # terrace boundaries (pad, apron, slope zone) cut the grid links like a break line
    door_sill_tol_m: float = 0.25  # |door floor - terrain in front of the door| logged above this


@dataclass(frozen=True)
class WlsConfig:
    sigma_dem_m: float = 3.0  # lone node prior sigma (--sigma-dem)
    sigma_stair_mid_m: float = 5.0  # prior sigma of points touched only by stairs / ramps
    cluster_corr_area_m2: float = 10.0  # corridor area per independent sample (l_corr ~ 10 cells @ 1 m)
    cluster_n_max: float = 25.0  # N_max -> sigma_c >= sigma_dem / 5
    stair_sigma_base_m: float = 0.05  # sigma_st = base + per_step * n
    stair_sigma_per_step_m: float = 0.01
    riser_m: float = 0.16  # r_0
    riser_sigma_m: float = 0.015  # sigma_r
    riser_min_m: float = 0.13
    riser_max_m: float = 0.19
    riser_bounds: bool = True
    stair_dir_min_m: float = 0.10  # 2-pass: |dh| below this -> direction unknown, stair dropped
    stair_dir_weak_ratio: float = 0.25  # 2-pass: |dh| < ratio * n * riser -> direction used but logged
    soft_flat_sigma_m: Optional[float] = None  # None: v1 rule (grade * max(L, 1) + leave-one-out), number: fixed sigma
    soft_flat_max_grade: float = 0.01  # --soft-flat-max-grade
    soft_flat_min_redundancy: float = 1e-6  # v1 SOFT_FLAT_MIN_REDUNDANCY
    ramp_sigma_m: float = 1.0
    ramp_gmax_accessible: float = 1.0 / 12.0
    ramp_gmax_general: float = 1.0 / 8.0
    ramp_active_sigma_m: float = 0.01
    ramp_active_max_rounds: int = 3
    huber_delta: float = 1.5  # Huber delta of DEM prior rows (sigma multiples)
    huber_rounds: int = 3
    outlier_ratio: float = 3.0  # |residual| / sigma above this -> data error candidate
    measurement_tol_m: float = 0.03  # building measurement residual logged above this
    breakline_dem_sigma_factor: float = 2.0  # v1 BREAKLINE_DEM_SIGMA_FACTOR (breakline_drop ends)
    dense_max_vars: int = 3000  # lsq_linear: bvls (dense) up to this, trf above
    max_outer_rounds: int = 20
    max_snoop: int = 20  # v1 Baarda rounds
    floating_sigma_m: float = 1e-3  # v1 gauge sigma of a floating component
    converge_m: float = 1e-7  # outer loop stop: max |dx|
    kkt_max_rounds: int = 10


@dataclass(frozen=True)
class PlazaConfig:
    """평지(plaza, a drawn flat ground area): every solid cell is held at one height H_plaza (variable elimination)."""
    ref_percentile: float = 50.0  # DEM_0 reference percentile of the plaza cells (when no node and no fixed_height_m)
    min_cells: int = 4  # a plaza with fewer cells is skipped (logged)
    erode_cells: int = 1  # the reference reads only cells this many cells inside the plaza edge
    relief_warn_m: float = 3.0  # log a plaza whose DEM relief (max - min) is larger
    node_tol_m: float = 0.1  # an outdoor node within this of the plaza edge counts as on the plaza
    collar_cells: int = 1  # hold this many cells (8-neighbour rings) around the solid cells at H too; 0 = no collar


@dataclass(frozen=True)
class SolverConfig:
    raster: RasterConfig = field(default_factory=RasterConfig)
    island: IslandConfig = field(default_factory=IslandConfig)
    shoulder: ShoulderConfig = field(default_factory=ShoulderConfig)
    building: BuildingConfig = field(default_factory=BuildingConfig)
    wls: WlsConfig = field(default_factory=WlsConfig)
    plaza: PlazaConfig = field(default_factory=PlazaConfig)


_GROUPS = ("raster", "island", "shoulder", "building", "wls", "plaza")


def config_to_dict(cfg: SolverConfig) -> dict[str, Any]:
    out: dict[str, Any] = {"format": CONFIG_FORMAT}
    for g in _GROUPS:
        out[g] = dataclasses.asdict(getattr(cfg, g))
    return out


def _coerce(group: str, name: str, cur: Any, value: Any, ftype: Any) -> Any:
    """Type check one value against the field it replaces."""
    t = str(ftype)
    if "bool" in t:
        if not isinstance(value, bool):
            raise ValueError(f"{group}.{name}: expected true/false, got {value!r}")
        return value
    if "int" in t and "float" not in t:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or float(value) != int(value):
            raise ValueError(f"{group}.{name}: expected an integer, got {value!r}")
        return int(value)
    if "float" in t:
        if value is None and "Optional" in t or value is None and "None" in t:
            return None
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{group}.{name}: expected a number, got {value!r}")
        return float(value)
    return value


def config_from_dict(data: Mapping[str, Any], base: Optional[SolverConfig] = None) -> SolverConfig:
    if not isinstance(data, Mapping):
        raise ValueError("solver config must be a JSON object")
    fmt = data.get("format")
    if fmt is not None and fmt != CONFIG_FORMAT:
        raise ValueError(f"solver config format {fmt!r} is not {CONFIG_FORMAT}")
    cfg = base or SolverConfig()
    for gname, gval in data.items():
        if gname == "format":
            continue
        if gname not in _GROUPS:
            raise ValueError(f"unknown solver config group {gname!r}")
        if not isinstance(gval, Mapping):
            raise ValueError(f"solver config group {gname!r} must be an object")
        group = getattr(cfg, gname)
        fields = {f.name: f for f in dataclasses.fields(group)}
        changes = {}
        for k, v in gval.items():
            if k not in fields:
                raise ValueError(f"unknown solver config key {gname}.{k}")
            changes[k] = _coerce(gname, k, getattr(group, k), v, fields[k].type)
        cfg = dataclasses.replace(cfg, **{gname: dataclasses.replace(group, **changes)})
    return cfg


def with_overrides(cfg: SolverConfig, overrides: Mapping[str, Any]) -> SolverConfig:
    """Dotted keys: {"island.area_max_m2": 600, "building.up_share_point_above": 0.7}."""
    nested: dict[str, dict[str, Any]] = {}
    for key, v in overrides.items():
        if key.count(".") != 1:
            raise ValueError(f"solver config override {key!r} must be <group>.<key>")
        g, k = key.split(".")
        nested.setdefault(g, {})[k] = v
    return config_from_dict(nested, cfg)


def parse_set_args(items: list[str]) -> dict[str, Any]:
    """["island.area_max_m2=600", "shoulder.adaptive=false"] -> {"island.area_max_m2": 600, "shoulder.adaptive": False}."""
    out: dict[str, Any] = {}
    for item in items or []:
        if "=" not in item:
            raise ValueError(f"--set {item!r}: expected key=value")
        k, v = item.split("=", 1)
        try:
            out[k.strip()] = json.loads(v)
        except json.JSONDecodeError:
            out[k.strip()] = v
    return out


def load_config(path: str | Path, base: Optional[SolverConfig] = None) -> SolverConfig:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ValueError(f"{path}: not JSON ({e})") from e
    return config_from_dict(data, base)


def validate(cfg: SolverConfig) -> list[str]:
    """Range violations (empty list = valid)."""
    out: list[str] = []

    def pos(name: str, v: Optional[float]) -> None:
        if v is not None and not (isinstance(v, (int, float)) and math.isfinite(v) and v > 0):
            out.append(f"{name} must be > 0 (got {v!r})")

    r, i, s, b, w = cfg.raster, cfg.island, cfg.shoulder, cfg.building, cfg.wls
    for name, v in (("raster.half_width_m", r.half_width_m), ("raster.soft_ring_m", r.soft_ring_m),
                    ("raster.bbox_pad_m", r.bbox_pad_m), ("raster.width_min_m", r.width_min_m),
                    ("raster.width_max_m", r.width_max_m), ("island.area_max_m2", i.area_max_m2),
                    ("island.radius_max_m", i.radius_max_m), ("island.area_big_m2", i.area_big_m2),
                    ("shoulder.decay_length_m", s.decay_length_m), ("shoulder.decay_min_m", s.decay_min_m),
                    ("shoulder.decay_max_m", s.decay_max_m), ("shoulder.side_slope", s.side_slope),
                    ("shoulder.band_factor", s.band_factor), ("shoulder.point_alpha", s.point_alpha),
                    ("shoulder.cg_rtol", s.cg_rtol), ("shoulder.cg_maxiter", s.cg_maxiter),
                    ("building.apron_m", b.apron_m), ("building.cut_slope", b.cut_slope),
                    ("building.fill_slope", b.fill_slope), ("building.smooth_k_m", b.smooth_k_m),
                    ("building.alpha_b", b.alpha_b), ("building.target_eps_m", b.target_eps_m),
                    ("building.step_max_m", b.step_max_m), ("building.max_reach_m", b.max_reach_m),
                    ("building.sigma_meas_m", b.sigma_meas_m), ("building.entrance_ring_radius_m", b.entrance_ring_radius_m),
                    ("building.terrace_tol_m", b.terrace_tol_m), ("building.terrace_multiple_tol_m", b.terrace_multiple_tol_m),
                    ("building.door_sill_tol_m", b.door_sill_tol_m),
                    ("wls.sigma_dem_m", w.sigma_dem_m), ("wls.sigma_stair_mid_m", w.sigma_stair_mid_m),
                    ("wls.cluster_corr_area_m2", w.cluster_corr_area_m2), ("wls.cluster_n_max", w.cluster_n_max),
                    ("wls.stair_sigma_base_m", w.stair_sigma_base_m), ("wls.stair_sigma_per_step_m", w.stair_sigma_per_step_m),
                    ("wls.riser_m", w.riser_m), ("wls.riser_sigma_m", w.riser_sigma_m),
                    ("wls.stair_dir_min_m", w.stair_dir_min_m), ("wls.soft_flat_sigma_m", w.soft_flat_sigma_m),
                    ("wls.soft_flat_max_grade", w.soft_flat_max_grade), ("wls.ramp_sigma_m", w.ramp_sigma_m),
                    ("wls.ramp_gmax_accessible", w.ramp_gmax_accessible), ("wls.ramp_gmax_general", w.ramp_gmax_general),
                    ("wls.ramp_active_sigma_m", w.ramp_active_sigma_m), ("wls.huber_delta", w.huber_delta),
                    ("wls.outlier_ratio", w.outlier_ratio), ("wls.breakline_dem_sigma_factor", w.breakline_dem_sigma_factor)):
        pos(name, v)
    if r.width_max_m < r.width_min_m:
        out.append(f"raster.width_max_m must be >= raster.width_min_m (got {r.width_max_m!r} < {r.width_min_m!r})")
    if not 0.0 <= i.kappa <= 0.3:
        out.append(f"island.kappa must be within [0, 0.3] (got {i.kappa!r})")
    for name, v in (("building.up_share_point_below", b.up_share_point_below),
                    ("building.up_share_point_above", b.up_share_point_above)):
        if not 0.0 < v < 1.0:
            out.append(f"{name} must be within (0, 1) (got {v!r})")
    if i.area_max_m2 > i.area_big_m2:
        out.append("island.area_max_m2 must be <= island.area_big_m2")
    if s.decay_min_m > s.decay_max_m:
        out.append("shoulder.decay_min_m must be <= shoulder.decay_max_m")
    if not w.riser_min_m < w.riser_m < w.riser_max_m:
        out.append("wls.riser_min_m < wls.riser_m < wls.riser_max_m must hold")
    if not 0.0 <= b.ref_percentile <= 100.0:
        out.append(f"building.ref_percentile must be within [0, 100] (got {b.ref_percentile!r})")
    for name, v in (("building.terrace_min_cells", b.terrace_min_cells),
                    ("building.terrace_max_levels", b.terrace_max_levels)):
        if not (isinstance(v, int) and not isinstance(v, bool) and v >= 1):
            out.append(f"{name} must be an integer >= 1 (got {v!r})")
    pz = cfg.plaza
    if not 0.0 <= pz.ref_percentile <= 100.0:
        out.append(f"plaza.ref_percentile must be within [0, 100] (got {pz.ref_percentile!r})")
    for name, v in (("plaza.min_cells", pz.min_cells), ("plaza.erode_cells", pz.erode_cells),
                    ("plaza.collar_cells", pz.collar_cells)):
        if not (isinstance(v, int) and not isinstance(v, bool) and v >= 0):
            out.append(f"{name} must be an integer >= 0 (got {v!r})")
    for name, v in (("plaza.relief_warn_m", pz.relief_warn_m), ("plaza.node_tol_m", pz.node_tol_m)):
        if not (isinstance(v, (int, float)) and math.isfinite(v) and v >= 0):
            out.append(f"{name} must be >= 0 (got {v!r})")
    if not 0.0 <= i.fixed_ring_min_ratio <= 1.0:
        out.append(f"island.fixed_ring_min_ratio must be within [0, 1] (got {i.fixed_ring_min_ratio!r})")
    return out
