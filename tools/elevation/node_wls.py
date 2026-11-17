"""
CAMPO height solver v2, stage 1: node WLS (docs/ELEVATION_SOLVER_V2.md "1단계: 노드 WLS").

Unknowns are one height per flat cluster (flat_exact links merged by union-find, so dh = 0 exactly) and one riser height per
stair. Rows: barometer dh (measured: Baarda snooping, Huber IRLS, chi2 as v1), floor priors, break-line drops, stairs
(x_to - x_frm - s n r = 0 with r ~ N(0.16, 0.015), 0.13 <= r <= 0.19), ramps (follow the DEM difference, |dh| <= g_max L by
an active set), soft flats (v1 leave-one-out rule), cluster / node DEM priors (Huber IRLS), building pads (prior N(H_1F^0,
sigma_B) and the lower bound H_1F >= H_1F^0 through scipy.optimize.lsq_linear bounds) and measured building - point height
differences. sigma_B = sigma_P sqrt(rho / (1 - rho)), rho = building_up_share chosen once from the DEM reference values.

This module does not import campo_height_solver (the CLI converts its Node / Edge into WlsProblem). Every tuning number comes
from solver_config.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Literal, Optional, Sequence

import numpy as np
import scipy.sparse as sp
from scipy.optimize import lsq_linear
from scipy.sparse.linalg import splu
from scipy.stats import chi2, norm

try:  # same folder module
    from solver_config import BuildingConfig, WlsConfig
except ImportError:  # pragma: no cover
    from .solver_config import BuildingConfig, WlsConfig  # type: ignore

DemAt = Callable[[float, float], float]
CorridorDem = Callable[[np.ndarray], np.ndarray]

# ------------------------------------------------------------------ #
# data structures
# ------------------------------------------------------------------ #


@dataclass(frozen=True)
class HeightVar:
    key: str  # "op:..." | "cn:..." | "fp:<building>:<floor>"
    kind: Literal["outdoor_point", "floor_plane"]
    x: Optional[float] = None  # grid CRS m (None for floor planes)
    y: Optional[float] = None


@dataclass(frozen=True)
class DiffRow:  # x_to - x_frm = dh - off_to + off_frm, sigma
    id: str
    frm: str
    to: str
    dh: float
    sigma: float
    kind: Literal["measured", "floor_prior", "breakline_drop"]
    off_frm: float = 0.0
    off_to: float = 0.0
    qc: str = "pending"  # "superseded" rows are reported, never used


@dataclass(frozen=True)
class FlatLink:  # flat_exact: the two variables merge
    id: str
    frm: str
    to: str
    xy: Optional[np.ndarray] = None  # (k, 2) polyline for the corridor prior, None if not rasterised


@dataclass(frozen=True)
class SoftFlatCand:
    id: str
    frm: str
    to: str
    length_m: float


@dataclass(frozen=True)
class Stair:
    id: str
    frm: str
    to: str
    n: int
    sign: Optional[int] = None  # +1: to is higher, -1: to is lower, None: 2-pass


@dataclass(frozen=True)
class Ramp:
    id: str
    frm: str
    to: str
    length_m: float
    g_max: float


@dataclass(frozen=True)
class BuildingPad:
    building_id: str
    var: str  # pad floor plane variable key
    h_ref: float  # H_1F^0
    ref_source: Literal["survey", "entrance_ring", "ring_percentile"]
    lower_bound: float


@dataclass(frozen=True)
class BuildingMeasurement:
    id: str
    building_id: str
    point: str  # outside point variable key
    d_meas: float  # measured H_1F - h_P (m)
    sigma: Optional[float] = None


@dataclass
class WlsProblem:
    vars: list[HeightVar]
    rows: list[DiffRow] = field(default_factory=list)
    flats: list[FlatLink] = field(default_factory=list)
    soft_flats: list[SoftFlatCand] = field(default_factory=list)
    stairs: list[Stair] = field(default_factory=list)
    ramps: list[Ramp] = field(default_factory=list)
    pads: list[BuildingPad] = field(default_factory=list)
    measurements: list[BuildingMeasurement] = field(default_factory=list)
    sigma_scale: dict[str, float] = field(default_factory=dict)
    stair_or_ramp_only: set[str] = field(default_factory=set)


@dataclass(frozen=True)
class RowReport:
    id: str
    residual_m: float
    w_test: float
    redundancy: float
    robust_weight: float
    qc: str  # ok | downweighted | rejected | untestable | superseded


@dataclass(frozen=True)
class StairSolve:
    riser_m: float
    sign: int
    direction_source: Literal["attribute", "auto", "dropped"]


@dataclass(frozen=True)
class BuildingSolve:
    h: float
    h_ref: float
    ref_source: str
    lower_bound: float
    lower_bound_active: bool
    sigma_b: float
    up_share: float
    measurement_residuals: dict[str, float]


@dataclass(frozen=True)
class Outlier:
    id: str
    kind: str
    residual_m: float
    sigma_m: float
    ratio: float


@dataclass
class WlsResult:
    h: dict[str, float]
    sigma: dict[str, float]
    sigma_rel: dict[str, float]
    floating: dict[str, bool]
    prior_h: dict[str, Optional[float]]
    cluster_of: dict[str, str]
    rows: dict[str, RowReport]
    soft_flat: dict[str, dict]
    stairs: dict[str, StairSolve]
    ramps_capped: list[str]
    buildings: dict[str, BuildingSolve]
    outliers: list[Outlier]
    chi2: float
    dof: int
    global_test_passed: bool
    components: list[list[str]]
    cov: list[tuple[dict[str, int], np.ndarray]]
    comp_of: dict[str, int]
    log: list[str]


# ------------------------------------------------------------------ #
# small public helpers
# ------------------------------------------------------------------ #


def flat_clusters(keys: Sequence[str], links: Sequence[tuple[str, str]]) -> dict[str, str]:
    """Union-find over flat links. The representative is the lexicographically first key of its cluster."""
    parent = {k: k for k in keys}

    def find(a: str) -> str:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a, b in links:
        if a in parent and b in parent:
            ra, rb = find(a), find(b)
            if ra != rb:
                if rb < ra:
                    ra, rb = rb, ra
                parent[rb] = ra
    return {k: find(k) for k in keys}


def cluster_prior(values: np.ndarray, cell_area_m2: float, cfg: WlsConfig) -> tuple[float, float]:
    """(median, sigma_c) with sigma_c = sigma_dem / sqrt(clip(N * cell_area / corr_area, 1, N_max))."""
    v = np.asarray(values, float)
    v = v[np.isfinite(v)]
    n_eff = float(np.clip(len(v) * cell_area_m2 / cfg.cluster_corr_area_m2, 1.0, cfg.cluster_n_max))
    return float(np.median(v)), float(cfg.sigma_dem_m / math.sqrt(n_eff))


def building_sigma(sigma_p: float, d0: float, cfg: BuildingConfig) -> tuple[float, float]:
    """(sigma_B, rho): rho = up share when the point is below (d0 >= 0) or above (d0 < 0) the building."""
    rho = cfg.up_share_point_below if d0 >= 0 else cfg.up_share_point_above
    return float(sigma_p * math.sqrt(rho / (1.0 - rho))), float(rho)


# ------------------------------------------------------------------ #
# internal linear system
# ------------------------------------------------------------------ #


@dataclass
class _Row:
    id: Optional[str]
    kind: str  # measured | floor_prior | breakline_drop | stair | riser | ramp | ramp_cap | soft_flat | measurement
    #            | dem_prior | building_prior | gauge
    cols: tuple[int, ...]  # global reduced variable indices
    coefs: tuple[float, ...]
    l: float
    sigma: float

    @property
    def measured(self) -> bool:
        return self.kind == "measured"

    @property
    def dem_prior(self) -> bool:
        return self.kind == "dem_prior"


def _system(rows: list[_Row], idx: dict[int, int], n: int):
    r, c, v = [], [], []
    for i, row in enumerate(rows):
        for col, coef in zip(row.cols, row.coefs):
            r.append(i)
            c.append(idx[col])
            v.append(coef)
    A = sp.csr_matrix((v, (r, c)), shape=(len(rows), n))
    l = np.array([row.l for row in rows], float)
    p = np.array([1.0 / row.sigma ** 2 for row in rows], float)
    return A, l, p


def _lsq(A, l, p):
    N = (A.T @ sp.diags(p) @ A).tocsc()
    lu = splu(N)
    return lu.solve(A.T @ (p * l)), lu


def _qvv_diag(A, Q, p):
    AQ = np.asarray(A @ Q)
    return 1.0 / p - np.asarray(A.multiply(AQ).sum(axis=1)).ravel()


def _solve_fixed(N: np.ndarray, rhs: np.ndarray, fixed: np.ndarray, val: np.ndarray) -> np.ndarray:
    """Minimise 1/2 x'Nx - rhs'x with x[fixed] = val[fixed]."""
    x = np.where(fixed, val, 0.0).astype(float)
    free = ~fixed
    if free.any():
        Nf = sp.csc_matrix(N[np.ix_(free, free)])
        b = rhs[free] - N[np.ix_(free, fixed)] @ x[fixed]
        x[free] = splu(Nf).solve(b)
    return x


def _box_solve(A, l, w, lb, ub, cfg: WlsConfig, btol: float, log: list[str]):
    """
    Bounded weighted least squares. (i) plain solve; if every bound holds, done. (ii) scipy.optimize.lsq_linear with the
    bounds finds the active set. (iii) the active variables are put exactly on their bound and the rest re-solved directly,
    checking KKT (free inside, right gradient sign at the bound) and repairing up to kkt_max_rounds times.
    Returns (x, on_bound mask).
    """
    n = A.shape[1]
    x, _ = _lsq(A, l, w)
    on = np.zeros(n, bool)
    if np.all(x >= lb) and np.all(x <= ub):  # strict: a bound reached only within rounding goes through (ii)-(iii)
        return x, on
    sw = np.sqrt(w)
    Aw = sp.diags(sw) @ A
    bw = sw * l
    if n <= cfg.dense_max_vars:
        res = lsq_linear(Aw.toarray(), bw, bounds=(lb, ub), method="bvls", tol=1e-12)
    else:  # pragma: no cover - only for very large components
        res = lsq_linear(Aw.tocsr(), bw, bounds=(lb, ub), method="trf", tol=1e-12, lsmr_tol="auto")
    x_ls = res.x
    at_lb = np.isfinite(lb) & (np.abs(x_ls - lb) <= max(btol, 1e-7))
    at_ub = np.isfinite(ub) & (np.abs(x_ls - ub) <= max(btol, 1e-7)) & ~at_lb
    N = (A.T @ sp.diags(w) @ A).toarray()
    rhs = A.T @ (w * l)
    scale = max(1.0, float(np.max(np.abs(rhs))) if rhs.size else 1.0)
    for _ in range(cfg.kkt_max_rounds):
        fixed = at_lb | at_ub
        val = np.where(at_lb, lb, np.where(at_ub, ub, 0.0))
        x = _solve_fixed(N, rhs, fixed, val)
        lo_v = np.where(~fixed & (x < lb - btol), lb - x, 0.0)
        hi_v = np.where(~fixed & (x > ub + btol), x - ub, 0.0)
        if lo_v.max(initial=0.0) > 0 or hi_v.max(initial=0.0) > 0:
            if lo_v.max(initial=0.0) >= hi_v.max(initial=0.0):
                at_lb[int(np.argmax(lo_v))] = True
            else:
                at_ub[int(np.argmax(hi_v))] = True
            continue
        g = N @ x - rhs  # gradient: >= 0 at a lower bound, <= 0 at an upper bound
        bad = np.where(at_lb & (g < -1e-9 * scale), -g, 0.0) + np.where(at_ub & (g > 1e-9 * scale), g, 0.0)
        if bad.max(initial=0.0) > 0:
            k = int(np.argmax(bad))
            at_lb[k] = at_ub[k] = False
            continue
        return x, fixed
    log.append("bounded solve: KKT repair did not settle, using the lsq_linear solution")
    return x_ls, at_lb | at_ub


# ------------------------------------------------------------------ #
# main entry
# ------------------------------------------------------------------ #


def solve_nodes(
    problem: WlsProblem,
    cfg: WlsConfig,
    building_cfg: BuildingConfig,
    *,
    dem_at: DemAt,
    corridor_dem: Optional[CorridorDem] = None,
    cell_area_m2: float = 1.0,
    alpha: float = 0.001,
    huber_k: float = 1.5,
    min_redundancy: float = 0.05,
) -> WlsResult:
    log: list[str] = []
    keys = [v.key for v in problem.vars]
    by_key = {v.key: v for v in problem.vars}
    reports: dict[str, RowReport] = {}

    # ---- 1. merge flat clusters ------------------------------------------------------------------------------------
    flats = [f for f in problem.flats if f.frm in by_key and f.to in by_key]
    rep = flat_clusters(keys, [(f.frm, f.to) for f in flats])
    cl_index: dict[str, int] = {}
    cl_rep: list[str] = []
    members: list[list[str]] = []
    for k in keys:
        r = rep[k]
        if r not in cl_index:
            cl_index[r] = len(cl_rep)
            cl_rep.append(r)
            members.append([])
        members[cl_index[r]].append(k)
    ci = {k: cl_index[rep[k]] for k in keys}  # original key -> cluster (global reduced) index
    n_cl = len(cl_rep)

    def ends(frm: str, to: str, rid: str, constant: bool, report_measured: Optional[float] = None) -> Optional[tuple[int, int]]:
        if frm not in by_key or to not in by_key or frm == to:
            return None
        a, b = ci[frm], ci[to]
        if a == b:
            if constant:
                log.append(f"conflict {rid}: both ends in one flat cluster")
            if report_measured is not None:
                reports[rid] = RowReport(rid, float(-report_measured), math.nan, 0.0, 1.0, "untestable")
            return None
        return a, b

    # ---- 3. priors -------------------------------------------------------------------------------------------------
    def node_dem(v: HeightVar) -> Optional[float]:
        if v.kind != "outdoor_point" or v.x is None or v.y is None:
            return None
        z = float(dem_at(v.x, v.y))
        return z if math.isfinite(z) else None

    prior_h: list[Optional[float]] = [None] * n_cl
    prior_s: list[Optional[float]] = [None] * n_cl
    flats_of: dict[int, list[FlatLink]] = {}
    for f in flats:
        flats_of.setdefault(ci[f.frm], []).append(f)
    for c in range(n_cl):
        mem = members[c]
        if len(mem) >= 2:
            vals = []
            if corridor_dem is not None:
                for f in flats_of.get(c, []):
                    if f.xy is not None:
                        v = np.asarray(corridor_dem(np.asarray(f.xy, float)), float)
                        vals.append(v[np.isfinite(v)])
            vals_a = np.concatenate(vals) if vals else np.zeros(0)
            if vals_a.size:
                prior_h[c], prior_s[c] = cluster_prior(vals_a, cell_area_m2, cfg)
            else:
                d = [z for z in (node_dem(by_key[k]) for k in mem) if z is not None]
                if d:
                    prior_h[c], prior_s[c] = float(np.median(d)), cfg.sigma_dem_m
        else:
            k = mem[0]
            z = node_dem(by_key[k])
            if z is not None:
                prior_h[c] = z
                if k in problem.stair_or_ramp_only:
                    prior_s[c] = cfg.sigma_stair_mid_m
                else:
                    prior_s[c] = cfg.sigma_dem_m * problem.sigma_scale.get(k, 1.0)

    # ---- fixed rows ------------------------------------------------------------------------------------------------
    base: list[_Row] = []
    for r in problem.rows:
        if r.qc == "superseded":
            reports[r.id] = RowReport(r.id, math.nan, math.nan, math.nan, 0.0, "superseded")
            continue
        l = r.dh - r.off_to + r.off_frm
        e = ends(r.frm, r.to, r.id, abs(l) > 1e-9, l if r.kind == "measured" else None)
        if e is None:
            continue
        base.append(_Row(r.id, r.kind, (e[0], e[1]), (-1.0, 1.0), l, r.sigma))

    for c in range(n_cl):
        if prior_h[c] is not None:
            base.append(_Row(None, "dem_prior", (c,), (1.0,), prior_h[c], prior_s[c]))

    # ---- 5. buildings ----------------------------------------------------------------------------------------------
    lb = np.full(n_cl, -np.inf)
    pad_of: dict[str, BuildingPad] = {}
    for p in problem.pads:
        if p.var not in by_key:
            log.append(f"building {p.building_id}: pad variable {p.var} unknown -> no pad")
            continue
        pad_of[p.building_id] = p
        lb[ci[p.var]] = max(lb[ci[p.var]], p.lower_bound)
    meas_of: dict[str, list[BuildingMeasurement]] = {}
    for m in problem.measurements:
        if m.building_id not in pad_of or m.point not in by_key:
            log.append(f"building measurement {m.id}: building pad or point unknown -> ignored")
            continue
        meas_of.setdefault(m.building_id, []).append(m)
    b_info: dict[str, tuple[float, float]] = {}
    for bid, p in pad_of.items():
        c = ci[p.var]
        choices = []
        for m in meas_of.get(bid, []):
            cp = ci[m.point]
            sp_ = prior_s[cp]
            if sp_ is None:
                sp_ = cfg.sigma_dem_m
                log.append(f"building measurement {m.id}: point {m.point} has no prior -> sigma_P = {sp_:g} m")
            d0 = 0.0 if prior_h[cp] is None else p.h_ref - prior_h[cp]
            choices.append((*building_sigma(sp_, d0, building_cfg), d0))
        if choices:
            if len({d0 >= 0 for _, _, d0 in choices}) > 1:
                log.append(f"building {bid}: measured points both below and above the building, smallest sigma_B used")
            sb, rho, _ = min(choices)
        else:
            sb, rho = building_sigma(cfg.sigma_dem_m, 0.0, building_cfg)
        b_info[bid] = (sb, rho)
        has_dem = prior_h[c] is not None and any(by_key[k].kind == "outdoor_point" for k in members[c])
        if not has_dem:
            base.append(_Row(f"building_prior:{bid}", "building_prior", (c,), (1.0,), p.h_ref, sb))
        for m in meas_of.get(bid, []):
            e = ends(m.point, p.var, m.id, True)
            if e is None:
                continue
            base.append(_Row(m.id, "measurement", e, (-1.0, 1.0), m.d_meas,
                             m.sigma if m.sigma is not None else building_cfg.sigma_meas_m))

    # ---- 6. ramps --------------------------------------------------------------------------------------------------
    ramps: list[tuple[Ramp, int, int]] = []
    for rp in problem.ramps:
        e = ends(rp.frm, rp.to, rp.id, False)
        if e is None:
            continue
        ramps.append((rp, *e))
        if prior_h[e[0]] is not None and prior_h[e[1]] is not None:
            base.append(_Row(rp.id, "ramp", e, (-1.0, 1.0), prior_h[e[1]] - prior_h[e[0]], cfg.ramp_sigma_m))

    # ---- soft flats ------------------------------------------------------------------------------------------------
    softs: list[tuple[SoftFlatCand, int, int]] = []
    for s in problem.soft_flats:
        e = ends(s.frm, s.to, s.id, False)
        if e is not None:
            softs.append((s, *e))

    def soft_sigma(s: SoftFlatCand) -> float:
        if cfg.soft_flat_sigma_m is not None:
            return cfg.soft_flat_sigma_m
        return cfg.soft_flat_max_grade * max(s.length_m, 1.0)

    def soft_row(s, a, b) -> _Row:
        return _Row(s.id, "soft_flat", (a, b), (-1.0, 1.0), 0.0, soft_sigma(s))

    # ---- 4. stairs (riser variables, 2-pass direction) -------------------------------------------------------------
    stair_solve: dict[str, StairSolve] = {}
    stairs: list[tuple[Stair, int, int, int]] = []  # stair, frm, to, sign
    pending: list[tuple[Stair, int, int]] = []
    for st in problem.stairs:
        if not isinstance(st.n, int) or st.n <= 0:
            continue
        e = ends(st.frm, st.to, st.id, True)
        if e is None:
            continue
        if st.sign in (1, -1):
            stairs.append((st, e[0], e[1], int(st.sign)))
            stair_solve[st.id] = StairSolve(math.nan, int(st.sign), "attribute")
        else:
            pending.append((st, *e))

    n_glob = [n_cl]

    def stair_rows(st: Stair, a: int, b: int, s: int, riser_col: int) -> list[_Row]:
        return [_Row(st.id, "stair", (a, b, riser_col), (-1.0, 1.0, -float(s * st.n)), 0.0,
                     cfg.stair_sigma_base_m + cfg.stair_sigma_per_step_m * st.n),
                _Row(f"riser:{st.id}", "riser", (riser_col,), (1.0,), cfg.riser_m, cfg.riser_sigma_m)]

    if pending:
        # direction pass: everything but the undirected stairs, all soft flats on, no bounds
        rows0 = list(base) + [soft_row(s, a, b) for s, a, b in softs]
        cols0 = n_cl
        for st, a, b, s in stairs:
            rows0 += stair_rows(st, a, b, s, cols0)
            cols0 += 1
        x0, floating0 = _plain_solve(rows0, cols0, cfg)
        for st, a, b in pending:
            if floating0[a] or floating0[b]:
                stair_solve[st.id] = StairSolve(math.nan, 0, "dropped")
                log.append(f"stair {st.id}: direction not determined (no height datum)")
                continue
            dh = float(x0[b] - x0[a])
            if abs(dh) < cfg.stair_dir_min_m:
                stair_solve[st.id] = StairSolve(math.nan, 0, "dropped")
                log.append(f"stair {st.id}: direction not determined (|dh| = {abs(dh):.3f} m)")
                continue
            if abs(dh) < cfg.stair_dir_weak_ratio * st.n * cfg.riser_m:
                log.append(f"stair {st.id}: direction from a weak DEM difference (|dh| = {abs(dh):.3f} m)")
            s = 1 if dh > 0 else -1
            stairs.append((st, a, b, s))
            stair_solve[st.id] = StairSolve(math.nan, s, "auto")

    ub = list(np.full(n_cl, np.inf))
    lbl = list(lb)
    riser_of: dict[str, int] = {}
    for st, a, b, s in stairs:
        col = n_glob[0]
        n_glob[0] += 1
        riser_of[st.id] = col
        base += stair_rows(st, a, b, s, col)
        lbl.append(cfg.riser_min_m if cfg.riser_bounds else -np.inf)
        ub.append(cfg.riser_max_m if cfg.riser_bounds else np.inf)
    n_all = n_glob[0]
    lb_all, ub_all = np.array(lbl, float), np.array(ub, float)

    # ---- 2. components (original keys, v1 ordering) ----------------------------------------------------------------
    parent = list(range(n_all))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for row in base:
        for c in row.cols[1:]:
            ra, rb = find(row.cols[0]), find(c)
            if ra != rb:
                parent[ra] = rb
    for _, a, b in softs:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    groups: dict[int, list[str]] = {}
    for k in keys:
        groups.setdefault(find(ci[k]), []).append(k)
    comps = sorted(groups.values(), key=lambda g: (-len(g), g[0]))

    # ---- per component ---------------------------------------------------------------------------------------------
    crit = float(norm.ppf(1 - alpha / 2))
    h_out: dict[str, float] = {}
    s_out: dict[str, float] = {}
    sr_out: dict[str, float] = {}
    fl_out: dict[str, bool] = {}
    cov: list[tuple[dict[str, int], np.ndarray]] = []
    comp_of: dict[str, int] = {}
    soft_report: dict[str, dict] = {}
    outliers: list[Outlier] = []
    capped: list[str] = []
    x_glob = np.full(n_all, np.nan)
    on_glob = np.zeros(n_all, bool)
    chi2_total, dof_total = 0.0, 0

    for comp in comps:
        root = find(ci[comp[0]])
        gvars = [g for g in range(n_all) if find(g) == root]
        idx = {g: i for i, g in enumerate(gvars)}
        n = len(gvars)
        gset = set(gvars)
        c_rows = [r for r in base if r.cols[0] in gset]
        c_soft = [(s, a, b) for s, a, b in softs if a in gset]
        has_datum = any(r.kind in ("dem_prior", "building_prior") for r in c_rows)
        floating = not has_datum
        if floating:
            c_rows.append(_Row(None, "gauge", (ci[comp[0]],), (1.0,), 0.0, cfg.floating_sigma_m))
            log.append(f"component {comp[:3]}... has no DEM prior -> floating (relative heights only)")
        clb, cub = lb_all[gvars], ub_all[gvars]

        # 7. soft flat selection (v1 rule, no bounds)
        active = {s.id for s, _, _ in c_soft}
        by_id = {s.id: (s, a, b) for s, a, b in c_soft}
        if c_soft and cfg.soft_flat_sigma_m is None:
            loo: dict[str, Optional[float]] = {s.id: None for s, _, _ in c_soft}
            for _ in range(len(c_soft) + 1):
                rows = c_rows + [soft_row(*by_id[i]) for i in sorted(active)]
                A, l, p = _system(rows, idx, n)
                x, lu = _lsq(A, l, p)
                v = A @ x - l
                worst = None
                for j, row in enumerate(rows):
                    if row.kind != "soft_flat" or row.id not in active:
                        continue
                    s, a, b = by_id[row.id]
                    vec = np.zeros(n)
                    vec[idx[b]], vec[idx[a]] = 1.0, -1.0
                    qvv = 1.0 / p[j] - float(vec @ lu.solve(vec))
                    red = qvv * p[j]
                    if red < cfg.soft_flat_min_redundancy:
                        loo[row.id] = None
                        continue
                    g = abs(v[j] / red) / max(s.length_m, 1e-9)
                    loo[row.id] = float(g)
                    if g > cfg.soft_flat_max_grade and (worst is None or g > worst[0]):
                        worst = (g, s)
                if worst is None:
                    break
                g, s = worst
                active.discard(s.id)
                log.append(f"soft-flat off {s.id}: leave-one-out grade {g * 100:.2f} % > {cfg.soft_flat_max_grade * 100:.1f} %")
            soft_report.update({i: {"active": i in active, "loo_grade": loo[i]} for i in by_id})
        elif c_soft:
            soft_report.update({i: {"active": True, "loo_grade": None} for i in by_id})
        rows_all = c_rows + [soft_row(*by_id[i]) for i in sorted(active)]

        # 8. Baarda data snooping on measured rows (nominal weights, no bounds)
        rejected: set[str] = set()
        for _ in range(cfg.max_snoop):
            act = [r for r in rows_all if r.id not in rejected or not r.measured]
            A, l, p = _system(act, idx, n)
            if len(l) <= n:
                break
            x, lu = _lsq(A, l, p)
            v = A @ x - l
            Q = lu.solve(np.eye(n))
            qvv = np.maximum(_qvv_diag(A, Q, p), 0.0)
            red = qvv * p
            w = np.where(qvv > 1e-12, v / np.sqrt(np.maximum(qvv, 1e-30)), 0.0)
            cand = [(abs(w[i]), i) for i, r in enumerate(act) if r.measured and red[i] >= min_redundancy]
            if not cand:
                break
            wmax, imax = max(cand)
            if wmax <= crit:
                break
            rejected.add(act[imax].id)
            log.append(f"w-test reject {act[imax].id} |w|={wmax:.2f} > {crit:.2f}")

        # 9-10. outer loop: Huber (measured, DEM priors), bounded solve, ramp active set
        act = [r for r in rows_all if not (r.measured and r.id in rejected)]
        c_ramps = [(rp, a, b) for rp, a, b in ramps if a in gset and b in gset]
        A, l, p_nom = _system(act, idx, n)
        mult = np.ones_like(p_nom)
        x = np.zeros(n)
        ramp_rounds = 0
        prior_rounds = 0
        btol = building_cfg.bound_tol_m
        for it in range(cfg.max_outer_rounds):
            x_new, _ = _box_solve(A, l, p_nom * mult, clb, cub, cfg, btol, log)
            v = A @ x_new - l
            u = np.abs(v) * np.sqrt(p_nom)
            meas = np.array([r.measured for r in act], bool)
            demp = np.array([r.dem_prior for r in act], bool)
            m_new = np.where(meas & (u > huber_k), huber_k / np.maximum(u, 1e-12), 1.0)
            if prior_rounds < cfg.huber_rounds:
                m_new = np.where(demp & (u > cfg.huber_delta), cfg.huber_delta / np.maximum(u, 1e-12), m_new)
                prior_rounds += 1
            else:
                m_new = np.where(demp, mult, m_new)
            added = False
            if c_ramps and ramp_rounds < cfg.ramp_active_max_rounds:
                for rp, a, b in c_ramps:
                    if rp.id in capped:
                        continue
                    dh = x_new[idx[b]] - x_new[idx[a]]
                    lim = rp.g_max * rp.length_m
                    if abs(dh) > lim * (1 + 1e-9):
                        act.append(_Row(f"{rp.id}:cap", "ramp_cap", (a, b), (-1.0, 1.0), math.copysign(lim, dh),
                                        cfg.ramp_active_sigma_m))
                        capped.append(rp.id)
                        added = True
                if added:
                    ramp_rounds += 1
                    A, l, p_nom = _system(act, idx, n)
                    m_new = np.concatenate([m_new, np.ones(len(act) - len(m_new))])
            done = it > 0 and not added and np.max(np.abs(x_new - x)) < cfg.converge_m
            x, mult = x_new, m_new
            if done:
                break
        x, on = _box_solve(A, l, p_nom * mult, clb, cub, cfg, btol, log)
        v = A @ x - l
        w_fin = p_nom * mult
        free = ~on
        Q = np.zeros((n, n))
        if free.any():
            N = (A.T @ sp.diags(w_fin) @ A).tocsc()[free][:, free]
            Q[np.ix_(free, free)] = splu(sp.csc_matrix(N)).solve(np.eye(int(free.sum())))
        qvv = np.maximum(_qvv_diag(A, Q, w_fin), 0.0)
        red = qvv * w_fin
        wt = np.where(qvv > 1e-12, v / np.sqrt(np.maximum(qvv, 1e-30)), 0.0)

        # 13. chi2 with nominal weights
        dof = max(len(l) - int(free.sum()), 0)
        chi2_total += float(np.sum(p_nom * v ** 2))
        dof_total += dof

        sig = np.sqrt(np.maximum(np.diag(Q), 0.0))
        J = [idx[r.cols[0]] for r in act if r.kind == "dem_prior"]
        if floating or not J:
            sig_rel = sig
        else:
            sig_rel = np.sqrt(np.maximum(np.diag(Q) - 2 * Q[:, J].mean(axis=1) + Q[np.ix_(J, J)].mean(), 0.0))
        key_idx = {k: idx[ci[k]] for k in comp}
        cov.append((key_idx, Q))
        for k in comp:
            i = idx[ci[k]]
            comp_of[k] = len(cov) - 1
            h_out[k] = float(x[i])
            s_out[k] = float(sig[i])
            sr_out[k] = float(sig_rel[i])
            fl_out[k] = floating
        for g in gvars:
            x_glob[g] = x[idx[g]]
            on_glob[g] = on[idx[g]]

        for j, r in enumerate(act):
            if not r.measured:
                continue
            q = "ok"
            if red[j] < min_redundancy:
                q = "untestable"
            elif mult[j] < 0.999:
                q = "downweighted"
            reports[r.id] = RowReport(r.id, float(v[j]), float(wt[j]), float(red[j]), float(mult[j]), q)
        for r in rows_all:
            if r.measured and r.id in rejected:
                vv = float(x[idx[r.cols[1]]] - x[idx[r.cols[0]]] - r.l)
                reports[r.id] = RowReport(r.id, vv, math.nan, math.nan, 0.0, "rejected")

        # 14. outliers
        for j, r in enumerate(act):
            if r.kind in ("stair", "ramp", "ramp_cap", "soft_flat", "breakline_drop", "floor_prior", "measurement"):
                ratio = abs(v[j]) / r.sigma
                if ratio > cfg.outlier_ratio:
                    outliers.append(Outlier(r.id, r.kind, float(v[j]), float(r.sigma), float(ratio)))
                    log.append(f"outlier {r.kind} {r.id}: residual {v[j]:.3f} m, sigma {r.sigma:.3f} m")
                if r.kind == "measurement" and abs(v[j]) > cfg.measurement_tol_m:
                    log.append(f"building measurement {r.id}: residual {v[j]:.3f} m > {cfg.measurement_tol_m:g} m")

    # ---- reports ---------------------------------------------------------------------------------------------------
    for st, a, b, s in stairs:
        col = riser_of[st.id]
        r_val = float(x_glob[col])
        stair_solve[st.id] = StairSolve(r_val, s, stair_solve[st.id].direction_source)
        if on_glob[col]:
            ratio = abs(r_val - cfg.riser_m) / cfg.riser_sigma_m
            outliers.append(Outlier(st.id, "stair_riser", r_val - cfg.riser_m, cfg.riser_sigma_m, float(ratio)))
            log.append(f"outlier stair_riser {st.id}: riser held at {r_val:.3f} m (prior {cfg.riser_m:g} m)")
    buildings: dict[str, BuildingSolve] = {}
    for bid, p in pad_of.items():
        c = ci[p.var]
        hb = float(x_glob[c])
        resid = {}
        for m in meas_of.get(bid, []):
            resid[m.id] = float(hb - x_glob[ci[m.point]] - m.d_meas)
        sb, rho = b_info[bid]
        active_lb = bool(on_glob[c]) or abs(hb - lb[c]) <= building_cfg.bound_tol_m
        buildings[bid] = BuildingSolve(hb, p.h_ref, p.ref_source, float(lb[c]), active_lb, sb, rho, resid)

    passed = True
    if dof_total > 0:
        lo, hi = chi2.ppf(0.025, dof_total), chi2.ppf(0.975, dof_total)
        passed = bool(lo <= chi2_total <= hi)
        log.append(f"global chi2 = {chi2_total:.2f}, dof = {dof_total}, 95% range [{lo:.2f}, {hi:.2f}] -> "
                   f"{'PASS' if passed else 'FAIL'}")
    prior_out = {k: prior_h[ci[k]] for k in keys}
    return WlsResult(h_out, s_out, sr_out, fl_out, prior_out, {k: rep[k] for k in keys}, reports, soft_report,
                     stair_solve, capped, buildings, outliers, chi2_total, dof_total, passed, comps, cov, comp_of, log)


def _plain_solve(rows: list[_Row], n: int, cfg: WlsConfig) -> tuple[np.ndarray, np.ndarray]:
    """Unbounded WLS over all variables, one block per connected part; parts without a datum get a gauge (floating)."""
    parent = list(range(n))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for r in rows:
        for c in r.cols[1:]:
            ra, rb = find(r.cols[0]), find(c)
            if ra != rb:
                parent[ra] = rb
    datum = {find(r.cols[0]) for r in rows if r.kind in ("dem_prior", "building_prior")}
    floating = np.array([find(g) not in datum for g in range(n)], bool)
    extra = []
    seen = set()
    for g in range(n):
        root = find(g)
        if root not in datum and root not in seen:
            seen.add(root)
            extra.append(_Row(None, "gauge", (g,), (1.0,), 0.0, cfg.floating_sigma_m))
    idx = {g: g for g in range(n)}
    A, l, p = _system(rows + extra, idx, n)
    x, _ = _lsq(A, l, p)
    return x, floating
