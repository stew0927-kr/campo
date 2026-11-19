"""
CAMPO height solver v2, grid stages 2-5 (docs/ELEVATION_SOLVER_V2.md).

  2. corridor rasterisation, each edge at its width_m (2 m by default; road cells fixed at a height that depends only on t:
     level across the width)
  3. building pads (polygon -> ground plane, one plane or several portal terraces), aprons, cut / fill slope targets
  4. island detection and Laplace fill (h), mid regions (displacement only)
  5. shoulder screened Poisson on the displacement d = h - DEM:  (-Laplace + mu + alpha) d = alpha d_hat

Only numpy and scipy (ndimage, sparse, sparse.linalg) are used. Every tuning number comes from solver_config.
Arrays are (height, width), row 0 north, cell centres from Grid.cell_centers(). DEM NaN = missing (never fixed or unknown).
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Optional, Sequence

import numpy as np
import scipy.sparse as sp
from scipy import ndimage
from scipy.sparse.linalg import cg, splu

try:  # same folder modules
    from campo_grid import Grid
    from solver_config import BuildingConfig, IslandConfig, PlazaConfig, RasterConfig, ShoulderConfig, SolverConfig
except ImportError:  # pragma: no cover
    from .campo_grid import Grid  # type: ignore
    from .solver_config import BuildingConfig, IslandConfig, PlazaConfig, RasterConfig, ShoulderConfig, SolverConfig  # type: ignore

_CROSS = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]], bool)  # 4-connectivity
_SQUARE = np.ones((3, 3), bool)  # 8-connectivity


# ------------------------------------------------------------------ #
# data structures
# ------------------------------------------------------------------ #


@dataclass(frozen=True)
class Corridors:
    xy: np.ndarray  # (S, 2, 2) float64: [segment, end (0|1), (x, y)] grid CRS m
    z: np.ndarray  # (S, 2) float64: target height at both ends
    t_range: np.ndarray  # (S, 2) float64: [t0, t1] of this segment within its whole edge (stair display)
    steps: np.ndarray  # (S,) int32: step count of the edge, 0 if not stairs
    edge_ids: tuple[str, ...]  # length S: campus edge id
    # (S,) float64 half width per segment m, NaN = raster.half_width_m. None = every segment at the default half width
    # (the path of the data without width_m: bit identical to the time before per edge widths)
    half_width: Optional[np.ndarray] = None

    @staticmethod
    def empty() -> "Corridors":
        return Corridors(np.zeros((0, 2, 2)), np.zeros((0, 2)), np.zeros((0, 2)), np.zeros(0, np.int32), ())


@dataclass(frozen=True)
class Terrace:
    """An upper terrace of a pad: the ground plane of a door level that the terrain in front of the door supports."""
    level: int  # campus level of the doors (3 = 3F)
    plane: float  # ground plane height of the terrace (m) = H(level)
    doors: tuple[tuple[float, float], ...] = ()  # building side door points: pad cells near them belong to this terrace
    storeys: float = math.nan  # expected step to the base plane in floor heights (storeys + plinth floors)
    source: str = "portal"  # portal | ground_level


@dataclass(frozen=True)
class Pad:
    building_id: str
    rings: tuple[np.ndarray, ...]  # each (k, 2) float64 grid CRS m. rings[0] outer, the rest holes (even-odd rule)
    h: float  # base ground plane (m): H_1F, or H_1F - plinth. NaN is allowed while the reference height is being found
    terraces: tuple[Terrace, ...] = ()  # supported upper terraces; empty -> one plane over the whole polygon (as before)
    level: Optional[int] = None  # pad level (logs only)
    floor_height_m: Optional[float] = None  # storey height (terrace step check)
    base_doors: tuple[tuple[float, float], ...] = ()  # pad level door points: pad cells near them stay on the base plane


@dataclass(frozen=True)
class TerraceCandidate:
    """A level that might carry a terrace (pad level, door levels, ground levels) with what the terrain says about it."""
    level: int
    plane: float  # ground plane if this level were a terrace (NaN: floor plane unknown)
    source: str  # sidecar | ground_level | portal
    doors: tuple[tuple[float, float], ...] = ()  # building side door points
    outside: tuple[tuple[float, float], ...] = ()  # outside points of the same doors
    outside_dem: tuple[Optional[float], ...] = ()  # DEM_0 at the outside points (the support of each door)
    storeys: float = math.nan


@dataclass(frozen=True)
class SoftPoint:  # barometer point (op:) off the corridors
    x: float
    y: float
    h: float
    radius_m: float


@dataclass(frozen=True)
class DropWall:
    """A drawn break line with lowSide and dropM (a retaining wall): the low side is drop_m below the high side."""
    id: str
    coords: np.ndarray  # (k, 2) float64 grid CRS m polyline (closed when coords[0] == coords[-1])
    low_side: str  # 'left' | 'right' of the direction coords[0] -> coords[-1]
    drop_m: float  # > 0


@dataclass(frozen=True)
class Plaza:
    """평지 (a drawn flat ground area): every solid cell is held at one height (docs/ELEVATION_SOLVER_V2.md, 평지)."""
    plaza_id: str
    rings: tuple[np.ndarray, ...]  # grid CRS m, rings[0] outer, the rest holes (even-odd)
    h: Optional[float] = None  # fixed_height_m or the WLS value; None: the DEM_0 reference rule
    h_source: str = "dem_median"  # 'fixed' | 'wls' | 'dem_median'
    name: str = ""
    nodes: int = 0  # outdoor nodes on the plaza (merged into one WLS variable), report only


@dataclass
class PlazaRaster:
    id: np.ndarray  # (H, W) int32: index into h, -1 off every plaza
    h: np.ndarray  # (n,) held height of each rasterised plaza
    hole: np.ndarray  # (H, W) bool: inside a plaza hole (not solid)
    report: list[dict]  # one per rasterised plaza (index = id), measure_plazas fills the cut / fill keys
    log: list[str]


@dataclass
class RoadRaster:
    road: np.ndarray  # (H, W) bool: d <= half_width
    z: np.ndarray  # (H, W) float64: target height of road and ring cells, NaN elsewhere
    dist: np.ndarray  # (H, W) float32: distance to the nearest segment m, inf where none reached
    seg: np.ndarray  # (H, W) int32: that segment, -1 if none
    ring: np.ndarray  # (H, W) bool: half_width < d <= half_width + soft_ring
    half_width_m: float = 1.0  # the default half width actually used (effective_half_width)
    # (H, W) float32 half width of the winning segment, 0 where none reached (per edge widths only; None: half_width_m
    # everywhere)
    half_width_map: Optional[np.ndarray] = None


@dataclass
class PadRaster:
    pad_id: np.ndarray  # (H, W) int32: index into the Pad list, -1 if none
    h: np.ndarray  # (P,) float64: pad heights (base planes)
    skipped: list[str]  # building ids whose raster is empty
    log: list[str] = field(default_factory=list)
    terrace_of: Optional[np.ndarray] = None  # (H, W) int32: index into terrace_h, -1 off the pads
    terrace_h: np.ndarray = field(default_factory=lambda: np.zeros(0))  # (T,) ground plane per terrace
    terrace_pad: np.ndarray = field(default_factory=lambda: np.zeros(0, np.int32))  # (T,) pad index of each terrace
    terrace_level: list[Optional[int]] = field(default_factory=list)  # (T,) level (None: unknown)
    terrace_storeys: list[float] = field(default_factory=list)  # (T,) storeys above the base (0 for the base)


@dataclass
class GridResult:
    h: np.ndarray  # (H, W) float64: corrected heights, NaN where the DEM is NaN
    residual: np.ndarray  # (H, W) float64: h - DEM, 0 where the DEM is NaN
    road: np.ndarray
    pad_id: np.ndarray
    apron: np.ndarray
    island: np.ndarray
    mid: np.ndarray
    unknown: np.ndarray
    stats: dict[str, float]
    timings: dict[str, float]
    log: list[str]
    terrace_of: Optional[np.ndarray] = None  # (H, W) int32 terrace of each pad cell, -1 elsewhere
    terrace_h: np.ndarray = field(default_factory=lambda: np.zeros(0))  # (T,) ground plane per terrace
    terraces: list[dict] = field(default_factory=list)  # per terrace: building_id, level, plane_m, cells, boundary_step_m
    wall_segments: Optional[np.ndarray] = None  # (K, 2, 2) terrace boundary (retaining wall) segments, grid CRS m
    wall_report: list = field(default_factory=list)  # per drawn drop wall: id, drop_m, links, conflicts, measured_*_m
    plaza_id: Optional[np.ndarray] = None  # (H, W) int32 plaza of each held cell, -1 elsewhere (None without plazas)
    plaza_report: list = field(default_factory=list)  # per plaza: id, name, h_m, h_source, cells, cut / fill, ...
    corridors_final: Optional[Corridors] = None  # the corridors rasterised (after the plaza cut): solve_report roads[]
    # (H, W) bool cells held at a plaza's H around its solid cells (plaza_collar; all False with collar_cells 0, None without
    # plazas). Not in plaza_id, which keeps the centre rule.
    plaza_collar: Optional[np.ndarray] = None


# ------------------------------------------------------------------ #
# helpers
# ------------------------------------------------------------------ #


def effective_half_width(cfg: RasterConfig, res: float) -> float:
    """Corridor half width, never below min_half_width_cells cells (a coarse grid keeps the cells the line passes)."""
    return max(cfg.half_width_m, cfg.min_half_width_cells * res)


def _window(grid: Grid, xmin: float, xmax: float, ymin: float, ymax: float) -> tuple[int, int, int, int]:
    """Row/col slice bounds [r0, r1) x [c0, c1) of the cell centres inside the box (clipped, may be empty)."""
    c0 = max(int(math.floor((xmin - grid.origin_x) / grid.res - 0.5)), 0)
    c1 = min(int(math.ceil((xmax - grid.origin_x) / grid.res - 0.5)), grid.width - 1) + 1
    r0 = max(int(math.floor((grid.origin_y - ymax) / grid.res - 0.5)), 0)
    r1 = min(int(math.ceil((grid.origin_y - ymin) / grid.res - 0.5)), grid.height - 1) + 1
    return r0, r1, c0, c1


def _project(X: np.ndarray, Y: np.ndarray, xi: float, yi: float, xj: float, yj: float) -> tuple[np.ndarray, np.ndarray]:
    """t (clipped to [0, 1]) and distance of points to the segment."""
    vx, vy = xj - xi, yj - yi
    L2 = vx * vx + vy * vy
    shape = np.broadcast(X, Y).shape
    if L2 > 0:
        t = np.clip(((X - xi) * vx + (Y - yi) * vy) / L2, 0.0, 1.0)
        t = np.broadcast_to(t, shape)
    else:
        t = np.zeros(shape)
    d = np.hypot(X - (xi + t * vx), Y - (yi + t * vy))
    return t, d


# ------------------------------------------------------------------ #
# 2. corridors
# ------------------------------------------------------------------ #


def segment_half_widths(corridors: Corridors, cfg: RasterConfig, res: float) -> Optional[np.ndarray]:
    """
    (S,) half width of each segment (NaN -> raster.half_width_m, never below min_half_width_cells cells, the same floor
    as effective_half_width), or None when every segment has the default one: the legacy path, bit identical.
    """
    if corridors.half_width is None:
        return None
    hw = np.asarray(corridors.half_width, float).reshape(-1)
    hw = np.where(np.isfinite(hw), hw, cfg.half_width_m)
    hw = np.maximum(hw, cfg.min_half_width_cells * res)
    return None if np.all(hw == effective_half_width(cfg, res)) else hw


def rasterize_corridors(grid: Grid, corridors: Corridors, cfg: RasterConfig) -> RoadRaster:
    """
    Road cells (fixed at the corridor height) and soft ring cells of the corridor segments.

    One half width for every segment (no width_m in the data): the nearest segment wins a cell, road = d <= half width.
    Per segment half widths: the signed distance sd = d - hw decides instead, so the corridor a cell is deepest inside
    wins it (a 6 m road keeps its whole band against a 2 m footway beside it; with nearest axis the footway's axis would
    cut into it). Road = sd <= 0, ring = 0 < sd <= soft_ring. With equal widths sd orders the cells like d does.
    Ties keep the earlier segment in both paths.
    """
    H, W = grid.height, grid.width
    xs, ys = grid.cell_centers()
    best = np.full((H, W), np.inf)  # d of the winner, or its sd with per segment half widths
    zt = np.full((H, W), np.nan)
    seg = np.full((H, W), -1, np.int32)
    hw = effective_half_width(cfg, grid.res)
    outer = hw + cfg.soft_ring_m
    reach = outer + cfg.bbox_pad_m
    hw_s = segment_half_widths(corridors, cfg, grid.res)
    if hw_s is not None:
        hw_map = np.zeros((H, W), np.float32)  # half width of the winning segment (0 where none reached)
    for s in range(len(corridors.edge_ids)):
        (xi, yi), (xj, yj) = corridors.xy[s]
        zi, zj = corridors.z[s]
        if not np.all(np.isfinite([xi, yi, xj, yj, zi, zj])):
            continue
        if hw_s is not None:
            reach = hw_s[s] + cfg.soft_ring_m + cfg.bbox_pad_m
        r0, r1, c0, c1 = _window(grid, min(xi, xj) - reach, max(xi, xj) + reach, min(yi, yj) - reach, max(yi, yj) + reach)
        if r0 >= r1 or c0 >= c1:
            continue
        X, Y = xs[None, c0:c1], ys[r0:r1, None]
        t, d = _project(X, Y, xi, yi, xj, yj)
        n = int(corridors.steps[s]) if len(corridors.steps) else 0
        if cfg.stair_display and n > 0:
            t0, t1 = corridors.t_range[s]
            if t1 > t0:  # heights of the whole edge from this segment's ends (linear in the edge parameter)
                zf, zto = zi - (zj - zi) * t0 / (t1 - t0), zi + (zj - zi) * (1.0 - t0) / (t1 - t0)
            else:
                zf, zto = zi, zj
            T = t0 + t * (t1 - t0)
            z = zf + np.floor(T * n) / n * (zto - zf)
        else:
            z = (1.0 - t) * zi + t * zj
        bw, zw, sw = best[r0:r1, c0:c1], zt[r0:r1, c0:c1], seg[r0:r1, c0:c1]
        if hw_s is not None:
            d -= hw_s[s]  # signed distance sd = d - hw: < 0 inside this corridor
        upd = d < bw  # ties keep the earlier segment
        bw[upd] = d[upd]
        if hw_s is not None:
            hw_map[r0:r1, c0:c1][upd] = hw_s[s]
        zw[upd] = z[upd]
        sw[upd] = s
    if hw_s is not None:
        road = best <= 0.0
        ring = (best > 0.0) & (best <= cfg.soft_ring_m)
        z = np.where(road | ring, zt, np.nan)
        dist = (best + hw_map).astype(np.float32)  # distance to the winning segment (inf + 0 where none reached)
        return RoadRaster(road, z, dist, seg, ring, half_width_m=hw, half_width_map=hw_map)
    road = best <= hw
    ring = (best > hw) & (best <= outer)
    z = np.where(road | ring, zt, np.nan)
    return RoadRaster(road, z, best.astype(np.float32), seg, ring, hw)


def corridor_dem_values(grid: Grid, polyline: np.ndarray, half_width_m: float) -> np.ndarray:
    """Finite DEM values of the cells within half_width_m of the polyline (each cell once)."""
    pts = np.asarray(polyline, float)
    if pts.ndim != 2 or len(pts) < 2:
        return np.zeros(0)
    xs, ys = grid.cell_centers()
    idx: list[np.ndarray] = []
    for (xi, yi), (xj, yj) in zip(pts[:-1], pts[1:]):
        r0, r1, c0, c1 = _window(grid, min(xi, xj) - half_width_m, max(xi, xj) + half_width_m,
                                 min(yi, yj) - half_width_m, max(yi, yj) + half_width_m)
        if r0 >= r1 or c0 >= c1:
            continue
        _, d = _project(xs[None, c0:c1], ys[r0:r1, None], xi, yi, xj, yj)
        rr, cc = np.nonzero(d <= half_width_m)
        idx.append((rr + r0) * grid.width + (cc + c0))
    if not idx:
        return np.zeros(0)
    flat = np.unique(np.concatenate(idx))
    v = grid.data.ravel()[flat]
    return v[np.isfinite(v)]


# ------------------------------------------------------------------ #
# 3. buildings
# ------------------------------------------------------------------ #


def rasterize_polygon(grid: Grid, rings: Sequence[np.ndarray]) -> np.ndarray:
    """Cell centres inside the polygon (crossing number, even-odd over all rings). Rings under 3 points are ignored."""
    out = np.zeros((grid.height, grid.width), bool)
    rs = [np.asarray(r, float) for r in rings if r is not None and len(r) >= 3]
    rs = [r for r in rs if r.ndim == 2 and r.shape[1] >= 2]
    if not rs:
        return out
    allp = np.concatenate(rs)
    r0, r1, c0, c1 = _window(grid, allp[:, 0].min(), allp[:, 0].max(), allp[:, 1].min(), allp[:, 1].max())
    if r0 >= r1 or c0 >= c1:
        return out
    xs, ys = grid.cell_centers()
    X, Y = xs[None, c0:c1], ys[r0:r1, None]
    inside = np.zeros((r1 - r0, c1 - c0), bool)
    for ring in rs:
        x1s, y1s = ring[:, 0], ring[:, 1]
        x2s, y2s = np.roll(x1s, -1), np.roll(y1s, -1)
        for x1, y1, x2, y2 in zip(x1s, y1s, x2s, y2s):
            if y1 == y2:
                continue  # never crosses a horizontal ray
            cond = (y1 > Y) != (y2 > Y)
            xint = (x2 - x1) * (Y - y1) / (y2 - y1) + x1
            inside ^= cond & (X < xint)
    out[r0:r1, c0:c1] = inside
    return out


def level_name(level: Optional[int]) -> str:
    """1 -> '1F', -1 -> 'B1' (campo_height_solver.floor_id_of_level; None -> '?')."""
    if not isinstance(level, int) or level == 0:
        return "?"
    return f"{level}F" if level > 0 else f"B{-level}"


def assign_terraces(grid: Grid, mask: np.ndarray, planes: Sequence[float], doors: Sequence[Sequence[tuple[float, float]]],
                    cfg: BuildingConfig) -> tuple[np.ndarray, list[str]]:
    """
    Terrace label (index into planes, 0 = base) of every pad cell: the plane nearest to DEM_0 of the cell, the base when
    |DEM_0 - base| <= terrace_tol_m / 2 (or DEM_0 is missing); pad cells within entrance_ring_radius_m of a door of a level
    are forced to that level (nearest door wins); 4-connected pieces under terrace_min_cells cells (with no forced cell)
    merge into the neighbouring terrace they touch most. Returns ((H, W) int32 label, -1 off the mask; log).
    """
    out = np.full(mask.shape, -1, np.int32)
    if not mask.any():
        return out, []
    ar, ac = np.nonzero(mask)  # work in the polygon's bounding box (+1 cell) only
    R0, R1 = max(int(ar.min()) - 1, 0), min(int(ar.max()) + 2, mask.shape[0])
    C0, C1 = max(int(ac.min()) - 1, 0), min(int(ac.max()) + 2, mask.shape[1])
    mask = mask[R0:R1, C0:C1]
    lab = np.full(mask.shape, -1, np.int32)
    P = np.asarray(planes, float)
    rr, cc = np.nonzero(mask)
    z = grid.data[R0:R1, C0:C1][rr, cc]
    with np.errstate(invalid="ignore"):
        cost = np.abs(z[:, None] - P[None, :])
    cost = np.where(np.isfinite(cost), cost, np.inf)
    cost[~np.isfinite(z), 0] = 0.0
    k = np.argmin(cost, axis=1).astype(np.int32)  # ties: the lower plane (the base first)
    with np.errstate(invalid="ignore"):
        k[~np.isfinite(z) | (np.abs(z - P[0]) <= 0.5 * cfg.terrace_tol_m)] = 0
    xs, ys = grid.cell_centers()
    X, Y = xs[C0:C1][cc], ys[R0:R1][rr]
    dmin = np.full((len(rr), len(P)), np.inf)
    for t, pts in enumerate(doors):
        q = np.asarray(pts, float).reshape(-1, 2)
        if len(q):
            dmin[:, t] = np.min(np.hypot(X[:, None] - q[None, :, 0], Y[:, None] - q[None, :, 1]), axis=1)
    near = dmin.min(axis=1) <= cfg.entrance_ring_radius_m
    k[near] = np.argmin(dmin[near], axis=1)
    lab[rr, cc] = k
    forced = np.zeros(mask.shape, bool)
    forced[rr[near], cc[near]] = True
    log: list[str] = []
    changed = True
    while changed:  # every merge removes one 4-connected piece, so this ends
        changed = False
        for t in range(len(P)):
            comp, n = ndimage.label(lab == t, structure=_CROSS)
            if n == 0:
                continue
            sizes = np.bincount(comp.ravel(), minlength=n + 1)
            has_forced = np.bincount(comp[forced], minlength=n + 1) > 0
            for j in np.nonzero(sizes < cfg.terrace_min_cells)[0]:
                if j == 0 or has_forced[j]:
                    continue
                piece = comp == j
                nb = ndimage.binary_dilation(piece, structure=_CROSS) & ~piece & mask & (lab != t)
                if not nb.any():
                    continue
                new = int(np.argmax(np.bincount(lab[nb], minlength=len(P))))
                lab[piece] = new
                changed = True
                log.append(f"terrace piece of {int(sizes[j])} cell(s) merged from plane {t} into plane {new}")
    out[R0:R1, C0:C1][mask] = lab[mask]
    return out, log


def rasterize_pads(grid: Grid, pads: Sequence[Pad], cfg: Optional[BuildingConfig] = None) -> PadRaster:
    """
    Pad cells of every polygon (an earlier pad keeps overlapping cells) and their terraces. A pad without terraces (or
    cfg None / terrace_enabled False) is one terrace at Pad.h over the whole polygon, as before terraced pads.
    """
    pad_id = np.full((grid.height, grid.width), -1, np.int32)
    terrace_of = np.full((grid.height, grid.width), -1, np.int32)
    t_h: list[float] = []
    t_pad: list[int] = []
    t_level: list[Optional[int]] = []
    t_storeys: list[float] = []
    skipped: list[str] = []
    log: list[str] = []
    for i, p in enumerate(pads):
        m = rasterize_polygon(grid, p.rings)
        overlap = m & (pad_id >= 0)
        if overlap.any():
            log.append(f"building {p.building_id}: {int(overlap.sum())} cell(s) overlap an earlier pad, kept by the earlier one")
            m &= ~overlap
        if not m.any():
            skipped.append(p.building_id)
            continue
        pad_id[m] = i
        ups = [t for t in p.terraces if np.isfinite(t.plane)] if cfg is not None and cfg.terrace_enabled else []
        if not ups:
            terrace_of[m] = len(t_h)
            t_h.append(float(p.h))
            t_pad.append(i)
            t_level.append(p.level)
            t_storeys.append(0.0)
            continue
        lab, alog = assign_terraces(grid, m, [p.h] + [t.plane for t in ups], [p.base_doors] + [t.doors for t in ups], cfg)
        log += [f"building {p.building_id}: {line}" for line in alog]
        levels = [p.level] + [t.level for t in ups]
        storeys = [0.0] + [t.storeys for t in ups]
        for k, plane in enumerate([p.h] + [t.plane for t in ups]):
            sel = lab == k
            if k > 0 and not sel.any():
                log.append(f"building {p.building_id}: terrace {level_name(levels[k])} keeps no pad cell -> dropped")
                continue
            terrace_of[sel] = len(t_h)
            t_h.append(float(plane))
            t_pad.append(i)
            t_level.append(levels[k])
            t_storeys.append(float(storeys[k]))
    return PadRaster(pad_id, np.array([p.h for p in pads], float), skipped, log, terrace_of, np.array(t_h, float),
                     np.array(t_pad, np.int32), t_level, t_storeys)


def pad_ring(pad_mask: np.ndarray) -> np.ndarray:
    """The 1-cell ring just outside the pad (8-neighbours)."""
    return ndimage.binary_dilation(pad_mask, structure=_SQUARE) & ~pad_mask


def buried_area(dem0: np.ndarray, ring: np.ndarray, h, res: float) -> float:
    """
    A_bur(H) = res * sum over ring cells of max(0, DEM_0 - H) (finite cells only). H is the ground plane: one number, or an
    (H, W) array with the plane of the terrace each ring cell faces (terraced pads).
    """
    v = np.asarray(dem0)[ring]
    if np.ndim(h) == 2:
        h = np.asarray(h, float)[ring]
    else:
        h = np.full(v.shape, float(h))
    fin = np.isfinite(v)
    return float(res * np.sum(np.maximum(0.0, v[fin] - h[fin])))


def ring_planes(pad_mask: np.ndarray, plane_of_cell: np.ndarray) -> np.ndarray:
    """(H, W) plane of the nearest pad cell (the terrace a ring cell faces). plane_of_cell is read on pad cells only."""
    if not pad_mask.any():
        return np.full(pad_mask.shape, np.nan)
    _, (ir, ic) = ndimage.distance_transform_edt(~pad_mask, return_indices=True)
    return np.asarray(plane_of_cell, float)[ir, ic]


def ring_support(grid: Grid, pad_mask: np.ndarray) -> Optional[float]:
    """support(pad level): median DEM_0 of the 1-cell ring just outside the polygon (None without DEM)."""
    v = grid.data[pad_ring(pad_mask)]
    v = v[np.isfinite(v)]
    return float(np.median(v)) if v.size else None


def door_support(grid: Grid, pad_mask: np.ndarray, outside_xy: tuple[float, float], outside_dem: Optional[float],
                 cfg: BuildingConfig) -> Optional[float]:
    """
    DEM_0 the door stands on: the DEM_0 of the outside point itself (PortalContact.outside_dem_m, bilinear DEM_0). Only when
    that point has no DEM, the median of the cells off the polygon within entrance_ring_radius_m of it. That disc is a
    fallback, not the first choice: it reaches up a slope, so on a grade s the disc median sits about s x r / 2 high
    (0.5 grade: about 1.0-1.3 m) and would reject an upper door that does stand on the hillside.
    """
    if outside_dem is not None and math.isfinite(outside_dem):
        return float(outside_dem)
    x, y = outside_xy
    r = cfg.entrance_ring_radius_m
    r0, r1, c0, c1 = _window(grid, x - r, x + r, y - r, y + r)
    if r0 < r1 and c0 < c1:
        xs, ys = grid.cell_centers()
        near = np.hypot(xs[None, c0:c1] - x, ys[r0:r1, None] - y) <= r
        win = grid.data[r0:r1, c0:c1]
        sel = near & ~pad_mask[r0:r1, c0:c1] & np.isfinite(win)
        if sel.any():
            return float(np.median(win[sel]))
    return None


def plan_terraces(grid: Grid, pad_mask: np.ndarray, base_level: int, candidates: Sequence[TerraceCandidate],
                  cfg: BuildingConfig) -> tuple[list[Terrace], list[dict], list[str]]:
    """
    Which candidate levels become terraces. The base (pad level) always is; its support is the ring DEM_0 median. An upper
    level L is a terrace only if plane(L) is above the pad ground plane and |support(L) - plane(L)| <= terrace_tol_m,
    support(L) = median over the doors of L of the DEM_0 each door's outside point stands on (the 5 m off-pad disc median
    when that point has no DEM). At most terrace_max_levels terraces (the
    base included), best supported first. A candidate whose floor plane is not above the base ground plane is not a step up
    from the ground (the level order alone does not guarantee the height order: a door level that is not one of the
    building's levels gets its own floor plane without a floor prior chain, and it can land below the pad level).
    Returns (accepted upper terraces sorted by level, one report row per candidate, log).
    """
    rows: list[dict] = []
    log: list[str] = []
    ok: list[tuple[float, TerraceCandidate, dict]] = []
    base_plane = next((c.plane for c in candidates if c.level == base_level), math.nan)
    for c in sorted(candidates, key=lambda c: c.level):
        row = {"level": c.level, "plane_m": float(c.plane) if math.isfinite(c.plane) else None, "source": c.source,
               "supported": False, "support_m": None, "port_count": len(c.doors), "cells": 0, "boundary_step_m": None}
        name = level_name(c.level)
        if c.level == base_level:
            sup = ring_support(grid, pad_mask)
            row.update(supported=True, support_m=sup)
            rows.append(row)
            continue
        if not cfg.terrace_enabled:
            row["reason"] = "terraced pads are off (building.terrace_enabled = false)"
        elif c.level < base_level:
            row["reason"] = f"{name} is below the pad level {level_name(base_level)}"
        elif not math.isfinite(c.plane):
            row["reason"] = f"{name} has no floor plane height"
        elif math.isfinite(base_plane) and c.plane <= base_plane:
            row["reason"] = (f"{name} plane {c.plane:.2f} m is at or below the pad ground plane {base_plane:.2f} m")
        elif not c.outside:
            row["reason"] = f"{name} has no door to the outside, nothing in the terrain supports it"
        else:
            od = list(c.outside_dem) + [None] * (len(c.outside) - len(c.outside_dem))
            sups = [door_support(grid, pad_mask, xy, z, cfg) for xy, z in zip(c.outside, od)]
            sups = [v for v in sups if v is not None]
            if not sups:
                row["reason"] = f"{name} door has no DEM in front of it"
            else:
                sup = float(np.median(sups))
                row["support_m"] = sup
                if abs(sup - c.plane) <= cfg.terrace_tol_m:
                    ok.append((abs(sup - c.plane), c, row))
                else:
                    row["reason"] = (f"{name} door not supported by the terrain: plane {c.plane:.2f} m, support {sup:.2f} m "
                                     f"(|diff| {abs(sup - c.plane):.2f} m > terrace_tol_m {cfg.terrace_tol_m:g} m)")
        if "reason" in row and cfg.terrace_enabled:
            log.append(f"{row['reason']} -> no terrace")
        rows.append(row)
    ok.sort(key=lambda v: v[0])
    keep = max(cfg.terrace_max_levels - 1, 0)
    accepted = []
    for rank, (_, c, row) in enumerate(ok):
        if rank < keep:
            row["supported"] = True
            accepted.append(Terrace(c.level, float(c.plane), tuple(c.doors), c.storeys, c.source))
        else:
            row["reason"] = f"{level_name(c.level)}: more than terrace_max_levels = {cfg.terrace_max_levels} terraces"
            log.append(f"{row['reason']} -> no terrace")
    accepted.sort(key=lambda t: t.level)
    return accepted, rows, log


def reference_height(grid: Grid, pad_mask: np.ndarray, entrances_xy: np.ndarray,
                     cfg: BuildingConfig) -> Optional[tuple[float, str]]:
    """H_1F^0 from the original DEM on the pad ring: entrance-side median, else the ring percentile. None if no DEM."""
    ring = pad_ring(pad_mask) & np.isfinite(grid.data)
    if not ring.any():
        return None
    rr, cc = np.nonzero(ring)
    vals = grid.data[rr, cc]
    ent = np.asarray(entrances_xy, float).reshape(-1, 2)
    if len(ent):
        xs, ys = grid.cell_centers()
        X, Y = xs[cc], ys[rr]
        dmin = np.min(np.hypot(X[:, None] - ent[None, :, 0], Y[:, None] - ent[None, :, 1]), axis=1)
        near = dmin <= cfg.entrance_ring_radius_m
        if near.any():
            return float(np.median(vals[near])), "entrance_ring"
    return float(np.percentile(vals, cfg.ref_percentile)), "ring_percentile"


def _smin(x: np.ndarray, y: np.ndarray, k: float) -> np.ndarray:
    return -k * np.logaddexp(-x / k, -y / k)


def _smax(x: np.ndarray, y: np.ndarray, k: float) -> np.ndarray:
    return k * np.logaddexp(x / k, y / k)


def building_targets(grid: Grid, pads: PadRaster, cfg: BuildingConfig, return_owner: bool = False):
    """
    (apron, h_star, slope[, owner]). apron: 0 < delta <= a (h_star = the terrace plane exactly there). Beyond the apron the
    DEM is clamped softly between the fill and cut planes: h* = smax_k(smin_k(DEM, G_cut), G_fill). slope: delta > a and
    |h* - DEM| > eps. Computed per terrace (a pad without terraces is one terrace, as before); where windows of several
    terraces or buildings overlap, the nearer terrace (smaller delta) wins. owner: (H, W) int32 terrace index of the cells
    whose target came from a terrace, -1 elsewhere.
    """
    H, W = grid.height, grid.width
    dem = grid.data
    res = grid.res
    best = np.full((H, W), np.inf)
    h_star = np.full((H, W), np.nan)
    apron_h = np.full((H, W), np.nan)
    owner = np.full((H, W), -1, np.int32)
    pad_any = pads.pad_id >= 0
    min_slope = min(cfg.cut_slope, cfg.fill_slope)
    if pads.terrace_of is not None:
        label, planes = pads.terrace_of, pads.terrace_h
    else:
        label, planes = pads.pad_id, pads.h
    for i, hb in enumerate(planes):
        if not np.isfinite(hb):
            continue
        m = label == i
        if not m.any():
            continue
        rr, cc = np.nonzero(m)
        cap = int(math.ceil((cfg.apron_m + cfg.max_reach_m) / res)) + 1
        R0, R1 = max(rr.min() - cap, 0), min(rr.max() + cap + 1, H)
        C0, C1 = max(cc.min() - cap, 0), min(cc.max() + cap + 1, W)
        win = dem[R0:R1, C0:C1]
        fin = win[np.isfinite(win)]
        rng = float(fin.max() - fin.min()) if fin.size else 0.0
        reach = cfg.apron_m + min(cfg.max_reach_m, rng / min_slope)
        pad_c = int(math.ceil(reach / res)) + 1
        r0, r1 = max(rr.min() - pad_c, 0), min(rr.max() + pad_c + 1, H)
        c0, c1 = max(cc.min() - pad_c, 0), min(cc.max() + pad_c + 1, W)
        mw = m[r0:r1, c0:c1]
        delta = ndimage.distance_transform_edt(~mw) * res
        dw = dem[r0:r1, c0:c1]
        beyond = np.maximum(0.0, delta - cfg.apron_m)
        g_cut = hb + cfg.cut_slope * beyond
        g_fill = hb - cfg.fill_slope * beyond
        with np.errstate(invalid="ignore"):
            hs = _smax(_smin(dw, g_cut, cfg.smooth_k_m), g_fill, cfg.smooth_k_m)
        bw = best[r0:r1, c0:c1]
        upd = (delta > 0) & (delta <= reach) & (delta < bw) & ~pad_any[r0:r1, c0:c1]
        bw[upd] = delta[upd]
        h_star[r0:r1, c0:c1][upd] = hs[upd]
        aw = apron_h[r0:r1, c0:c1]
        aw[upd] = hb
        owner[r0:r1, c0:c1][upd] = i
    apron = (best > 0) & (best <= cfg.apron_m)
    h_star = np.where(apron, apron_h, h_star)
    with np.errstate(invalid="ignore"):
        slope = (best > cfg.apron_m) & np.isfinite(best) & np.isfinite(dem) & (np.abs(h_star - dem) > cfg.target_eps_m)
    if return_owner:
        return apron, h_star, slope, owner
    return apron, h_star, slope


# ------------------------------------------------------------------ #
# sparse 5-point assembly shared by the island fill and the shoulder
# ------------------------------------------------------------------ #


def _assemble(unknown: np.ndarray, link_e: np.ndarray, link_s: np.ndarray, usable: np.ndarray, res: float):
    """
    Weighted graph Laplacian over the unknown cells (scaled 1/res^2). Links touching an unusable cell are dropped.
    Returns (offdiag coo pieces, diag (n,), boundary (unknown index, neighbour flat index, weight)).
    """
    H, W = unknown.shape
    n = int(unknown.sum())
    ids = np.full(H * W, -1, np.int64)
    ids[unknown.ravel()] = np.arange(n)
    ids = ids.reshape(H, W)
    flat = np.arange(H * W, dtype=np.int64).reshape(H, W)
    inv = 1.0 / (res * res)
    rows, cols, vals = [], [], []
    diag = np.zeros(n)
    bi, bq, bw = [], [], []
    pairs = (
        (ids[:, :-1], ids[:, 1:], flat[:, :-1], flat[:, 1:], link_e * usable[:, :-1] * usable[:, 1:]),
        (ids[:-1, :], ids[1:, :], flat[:-1, :], flat[1:, :], link_s * usable[:-1, :] * usable[1:, :]),
    )
    for pa, pb, fa, fb, w in pairs:
        w = w.astype(np.float64) * inv
        live = w > 0
        both = live & (pa >= 0) & (pb >= 0)
        a, b, ww = pa[both], pb[both], w[both]
        rows += [a, b]
        cols += [b, a]
        vals += [-ww, -ww]
        diag += np.bincount(a, weights=ww, minlength=n) + np.bincount(b, weights=ww, minlength=n)
        for m, u, q in ((live & (pa >= 0) & (pb < 0), pa, fb), (live & (pb >= 0) & (pa < 0), pb, fa)):
            uu, qq, w2 = u[m], q[m], w[m]
            diag += np.bincount(uu, weights=w2, minlength=n)
            bi.append(uu)
            bq.append(qq)
            bw.append(w2)
    off = (np.concatenate(rows) if rows else np.zeros(0, np.int64), np.concatenate(cols) if cols else np.zeros(0, np.int64),
           np.concatenate(vals) if vals else np.zeros(0))
    bnd = (np.concatenate(bi) if bi else np.zeros(0, np.int64), np.concatenate(bq) if bq else np.zeros(0, np.int64),
           np.concatenate(bw) if bw else np.zeros(0))
    return n, off, diag, bnd


def _matrix(n: int, off, diag: np.ndarray) -> sp.csr_matrix:
    r, c, v = off
    A = sp.coo_matrix((v, (r, c)), shape=(n, n)).tocsr()
    return (A + sp.diags(diag)).tocsr()


# ------------------------------------------------------------------ #
# 3b. plazas (평지)
# ------------------------------------------------------------------ #


def plaza_reference(grid: Grid, mask: np.ndarray, cfg: PlazaConfig) -> Optional[float]:
    """DEM_0 ref_percentile of the plaza cells erode_cells inside its edge (all of them when erosion leaves none)."""
    m = mask
    if cfg.erode_cells > 0:
        er = ndimage.binary_erosion(mask, structure=_CROSS, iterations=cfg.erode_cells)
        if er.any():
            m = er
    v = np.asarray(grid.data, float)[m]
    v = v[np.isfinite(v)]
    return float(np.percentile(v, cfg.ref_percentile)) if v.size else None


def rasterize_plazas(grid: Grid, plazas: Sequence[Plaza], pad_mask: np.ndarray, cfg: PlazaConfig) -> PlazaRaster:
    """
    Solid cells of every plaza (even-odd over its rings, so holes are left out), minus building pad cells (a building
    pad wins) and cells an earlier plaza took. Under min_cells cells: skipped. Height: Plaza.h, else plaza_reference.
    """
    H, W = grid.height, grid.width
    pid = np.full((H, W), -1, np.int32)
    hole = np.zeros((H, W), bool)
    hs: list[float] = []
    report: list[dict] = []
    log: list[str] = []
    dem = np.asarray(grid.data, float)
    for p in plazas:
        rings = [np.asarray(r, float) for r in p.rings]
        solid = rasterize_polygon(grid, rings)
        outer = rasterize_polygon(grid, rings[:1])
        p_hole = outer & ~solid & ~pad_mask
        overlap_pad = int((solid & pad_mask).sum())
        cells = solid & ~pad_mask & (pid < 0)
        n = int(cells.sum())
        if n < cfg.min_cells:
            log.append(f"plaza {p.plaza_id}: {n} cell(s) < min_cells {cfg.min_cells} -> skipped")
            continue
        h, src = (float(p.h), p.h_source) if p.h is not None and math.isfinite(p.h) else (plaza_reference(grid, cells, cfg), "dem_median")
        if h is None:
            log.append(f"plaza {p.plaza_id}: no DEM under the plaza and no height -> skipped")
            continue
        vals = dem[cells]
        vals = vals[np.isfinite(vals)]
        relief = float(vals.max() - vals.min()) if vals.size else 0.0
        if relief > cfg.relief_warn_m:
            log.append(f"plaza {p.plaza_id}: DEM relief {relief:.2f} m over {cfg.relief_warn_m:g} m under the plaza (H {h:.2f} m)")
        if overlap_pad:
            log.append(f"plaza {p.plaza_id}: {overlap_pad} cell(s) under building pads keep the pad height")
        k = len(hs)
        pid[cells] = k
        hole |= p_hole
        hs.append(h)
        allp = np.concatenate(rings)
        report.append({"id": p.plaza_id, "name": p.name, "h_m": h, "h_source": src, "cells": n,
                       "hole_cells": int(p_hole.sum()), "area_m2": n * grid.res ** 2, "nodes": int(p.nodes),
                       "overlap_pad_cells": overlap_pad, "relief_m": relief,
                       "bbox_xy": [float(allp[:, 0].min()), float(allp[:, 1].min()), float(allp[:, 0].max()), float(allp[:, 1].max())]})
    return PlazaRaster(pid, np.asarray(hs, float), hole, report, log)


_EIGHT = np.ones((3, 3), bool)


def plaza_collar(plaza_id: np.ndarray, blocked: np.ndarray, k: int) -> np.ndarray:
    """
    (H, W) int32 plaza index of each collar cell, -1 elsewhere: the solid plaza cells (plaza_id >= 0, the centre rule)
    grown k times over the 8 neighbours, through cells that are neither solid (a cell inside another plaza is that
    plaza's) nor blocked (building pads and hard road cells win over the collar). A plaza hole is not solid, so the
    collar also runs into a hole (its rim is held at H, the middle stays free). Where the collars of several plazas
    meet, a cell goes to the plaza whose nearest solid cell centre is closest; on a tie the earlier plaza keeps it.

    Why (the cells are read as a bilinear lattice: their centres are the corners of the quads that corrected_dem
    consumers such as Grid.sample_bilinear interpolate over): take a point p of the plaza and the quad of the four cell
    centres around it. The centre of the cell that contains p is one of those four corners, and the four corners are
    within one cell of each other over the 8 neighbours. So when that cell (or any of the four corners) is in the
    centre rule mask, k = 1 puts all four corners at H - unless one of them is a building pad, a hard road cell or
    another plaza, which win on purpose - and the bilinear surface is exactly H at p. The assumption fails only where
    the plaza is thinner than a cell: a sharp tip at a polygon vertex, or a sliver under one cell wide whose points
    have no solid cell centre among their four corners. There the solver does not promise a flat quad: the guarantee
    belongs to the 3D viewer, which carves its terrain mesh under the drawn footprint itself (planned as PR 4,
    feat/terrain-exact-plaza-3d, of the plaza / road width plan). This collar only keeps corrected_dem visibly flat.
    """
    out = np.full(plaza_id.shape, -1, np.int32)
    if k <= 0 or not (plaza_id >= 0).any():
        return out
    H, W = plaza_id.shape
    free = (plaza_id < 0) & ~blocked
    best = np.full(plaza_id.shape, np.inf)
    for i, sl in enumerate(ndimage.find_objects(plaza_id + 1)):
        if sl is None:
            continue
        r0, r1 = max(sl[0].start - k, 0), min(sl[0].stop + k, H)
        c0, c1 = max(sl[1].start - k, 0), min(sl[1].stop + k, W)
        win = (slice(r0, r1), slice(c0, c1))
        own = plaza_id[win] == i
        reach = ndimage.binary_dilation(own, structure=_EIGHT, iterations=k, mask=own | free[win]) & ~own
        d = ndimage.distance_transform_edt(~own)
        take = reach & (d < best[win])
        out[win][take] = i
        best[win][take] = d[take]
    return out


def _point_in_rings(rings: Sequence[np.ndarray], x: float, y: float) -> bool:
    inside = False
    for r in rings:
        xs, ys = r[:, 0], r[:, 1]
        x2, y2 = np.roll(xs, -1), np.roll(ys, -1)
        with np.errstate(divide="ignore", invalid="ignore"):
            cond = (ys > y) != (y2 > y)
            xint = (x2 - xs) * (y - ys) / (y2 - ys) + xs
        inside ^= bool(np.count_nonzero(cond & (x < xint)) % 2)
    return inside


def _ring_params(p0: np.ndarray, p1: np.ndarray, rings: Sequence[np.ndarray]) -> list[float]:
    """Parameters t in (0, 1) where the segment p0 -> p1 crosses a ring edge."""
    r = p1 - p0
    out: list[float] = []
    for ring in rings:
        a = ring
        b = np.roll(ring, -1, axis=0)
        s = b - a
        den = r[0] * s[:, 1] - r[1] * s[:, 0]
        ca = a - p0
        ok = np.abs(den) > 1e-12
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (ca[:, 0] * s[:, 1] - ca[:, 1] * s[:, 0]) / den
            u = (ca[:, 0] * r[1] - ca[:, 1] * r[0]) / den
        hit = ok & (t > 1e-9) & (t < 1 - 1e-9) & (u >= -1e-9) & (u <= 1 + 1e-9)
        out += [float(v) for v in t[hit]]
    return sorted(set(out))


def clip_corridors_to_plazas(corridors: Corridors, plazas: Sequence[Plaza], plaza_h: Sequence[float]) -> Corridors:
    """
    Cut the parts of the corridor segments inside a plaza's solid area (the plaza holds those cells). The parts left
    start at H where they leave the plaza: z is re-interpolated from H at the plaza edge to the old z at the far end.
    Parts inside a hole stay (both ends at H). plaza_h[k] is the height of plazas[k].
    """
    xy, z, tr, st, ids = list(corridors.xy), list(corridors.z), list(corridors.t_range), list(corridors.steps), list(corridors.edge_ids)
    has_hw = corridors.half_width is not None  # every piece keeps the half width of its segment
    hw = list(corridors.half_width) if has_hw else [math.nan] * len(ids)
    for p, H in zip(plazas, plaza_h):
        if H is None or not math.isfinite(H):
            continue
        rings = [np.asarray(r, float)[:, :2] for r in p.rings if len(r) >= 3]
        if not rings:
            continue
        nxy, nz, ntr, nst, nids, nhw = [], [], [], [], [], []
        for s in range(len(ids)):
            p0, p1 = np.asarray(xy[s][0], float), np.asarray(xy[s][1], float)
            z0, z1 = float(z[s][0]), float(z[s][1])
            ts = _ring_params(p0, p1, rings)
            if not ts:
                mid = 0.5 * (p0 + p1)
                if _point_in_rings(rings, float(mid[0]), float(mid[1])):
                    continue  # wholly inside the solid area
                nxy.append(xy[s]); nz.append(z[s]); ntr.append(tr[s]); nst.append(st[s]); nids.append(ids[s])
                nhw.append(hw[s])
                continue
            cuts = [0.0, *ts, 1.0]
            t0, t1 = float(tr[s][0]), float(tr[s][1])
            for a, b in zip(cuts[:-1], cuts[1:]):
                if b - a <= 1e-12:
                    continue
                m = p0 + 0.5 * (a + b) * (p1 - p0)
                if _point_in_rings(rings, float(m[0]), float(m[1])):
                    continue
                za = H if a > 0.0 else z0
                zb = H if b < 1.0 else z1
                nxy.append(np.array([p0 + a * (p1 - p0), p0 + b * (p1 - p0)]))
                nz.append(np.array([za, zb]))
                ntr.append(np.array([t0 + a * (t1 - t0), t0 + b * (t1 - t0)]))
                nst.append(st[s])
                nids.append(ids[s])
                nhw.append(hw[s])
        xy, z, tr, st, ids, hw = nxy, nz, ntr, nst, nids, nhw
    if not ids:
        return Corridors.empty()
    return Corridors(np.asarray(xy, float).reshape(-1, 2, 2), np.asarray(z, float).reshape(-1, 2),
                     np.asarray(tr, float).reshape(-1, 2), np.asarray(st, np.int32), tuple(ids),
                     half_width=np.asarray(hw, float) if has_hw else None)


def measure_plazas(plaza_raster: PlazaRaster, h: np.ndarray, dem: np.ndarray, res: float) -> list[dict]:
    """The report rows with cut / fill volumes (m3), the largest cut and fill (m) and the flatness error |h - H| (m)."""
    out = []
    for k, row in enumerate(plaza_raster.report):
        cells = (plaza_raster.id == k) & np.isfinite(dem) & np.isfinite(h)
        dh = h[cells] - dem[cells]
        H = float(plaza_raster.h[k])
        out.append({**row,
                    "cut_m3": float(np.clip(-dh, 0, None).sum() * res * res),
                    "fill_m3": float(np.clip(dh, 0, None).sum() * res * res),
                    "max_cut_m": float(np.clip(-dh, 0, None).max()) if dh.size else 0.0,
                    "max_fill_m": float(np.clip(dh, 0, None).max()) if dh.size else 0.0,
                    "flat_error_m": float(np.abs(h[cells] - H).max()) if dh.size else 0.0})
    return out


# ------------------------------------------------------------------ #
# 4. islands
# ------------------------------------------------------------------ #


def find_islands(fixed: np.ndarray, valid: np.ndarray, res: float, cfg: IslandConfig,
                 exclude: Optional[np.ndarray] = None, keep_free: Optional[np.ndarray] = None) -> tuple[np.ndarray, np.ndarray]:
    """
    (island, mid): enclosed free regions (4-connected, not touching the grid edge or missing DEM). A region with a
    keep_free cell (a plaza hole) is neither: the shoulder solves it, so it follows the DEM instead of being filled.
    """
    free = ~fixed & valid
    lab, n = ndimage.label(free, structure=_CROSS)
    empty = np.zeros_like(fixed, bool)
    if n == 0 or not fixed.any():
        return empty, empty.copy()
    bad = np.zeros(n + 1, bool)
    bad[0] = True
    bad[np.unique(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))] = True
    near_missing = ndimage.binary_dilation(~valid, structure=_CROSS) & free
    bad[np.unique(lab[near_missing])] = True
    area = np.bincount(lab.ravel(), minlength=n + 1).astype(float) * res * res
    edt = ndimage.distance_transform_edt(~fixed)
    rmax = np.zeros(n + 1)
    rmax[1:] = np.asarray(ndimage.maximum(edt, lab, index=np.arange(1, n + 1)), float) * res
    is_island = ~bad & ((area <= cfg.area_max_m2) | (rmax <= cfg.radius_max_m))
    is_mid = ~bad & ~is_island & (area <= cfg.area_big_m2)
    if exclude is not None:
        for k in np.nonzero(is_island | is_mid)[0]:
            comp = lab == k
            ring = ndimage.binary_dilation(comp, structure=_CROSS) & ~comp
            if ring.any() and fixed[ring].mean() < cfg.fixed_ring_min_ratio:
                is_island[k] = is_mid[k] = False
    if keep_free is not None and keep_free.any():
        kept = np.unique(lab[keep_free & free])
        is_island[kept] = is_mid[kept] = False
    is_island[0] = is_mid[0] = False
    return is_island[lab], is_mid[lab]


def fill_islands(dem: np.ndarray, h_fixed: np.ndarray, fixed: np.ndarray, island: np.ndarray,
                 res: float, cfg: IslandConfig, link_e: np.ndarray, link_s: np.ndarray) -> np.ndarray:
    """Laplace h = 0 in the islands with h = h_fixed on their boundary (one sparse LU for all of them)."""
    out = h_fixed.copy()
    if not island.any():
        return out
    usable = (fixed | island) & np.isfinite(dem)
    n, off, diag, (bi, bq, bw) = _assemble(island, link_e, link_s, usable, res)
    diag = np.where(diag > 0, diag, 1.0)  # a cell cut off by break lines keeps h = 0 + boundary average (never NaN)
    A = _matrix(n, off, diag).tocsc()
    lu = splu(A)
    hf = h_fixed.ravel()
    rhs = np.bincount(bi, weights=bw * hf[bq], minlength=n)
    x = lu.solve(rhs)
    if cfg.kappa > 0:
        dfl = dem.ravel()
        x_dem = lu.solve(np.bincount(bi, weights=bw * dfl[bq], minlength=n))
        x = x + cfg.kappa * (dem[island] - x_dem)
    out[island] = x
    return out


# ------------------------------------------------------------------ #
# 5. break lines and the shoulder
# ------------------------------------------------------------------ #


def breakline_links(grid: Grid, lines: Optional[np.ndarray], attenuation: float) -> tuple[np.ndarray, np.ndarray]:
    """(link_e (H, W-1), link_s (H-1, W)): 1 except where the centre-to-centre link truly crosses a line segment."""
    H, W = grid.height, grid.width
    link_e = np.ones((H, max(W - 1, 0)), np.float32)
    link_s = np.ones((max(H - 1, 0), W), np.float32)
    if lines is None or len(lines) == 0:
        return link_e, link_s
    xs, ys = grid.cell_centers()
    res = grid.res
    for (ax, ay), (bx, by) in np.asarray(lines, float).reshape(-1, 2, 2):
        r0, r1, c0, c1 = _window(grid, min(ax, bx) - res, max(ax, bx) + res, min(ay, by) - res, max(ay, by) + res)
        if r0 >= r1 or c0 >= c1:
            continue
        ex, ey = bx - ax, by - ay
        for horizontal in (True, False):
            if horizontal:
                cc1 = min(c1, W - 1)
                if c0 >= cc1:
                    continue
                PX, PY = xs[None, c0:cc1], ys[r0:r1, None]
                QX, QY = xs[None, c0 + 1:cc1 + 1], PY
            else:
                rr1 = min(r1, H - 1)
                if r0 >= rr1:
                    continue
                PX, PY = xs[None, c0:c1], ys[r0:rr1, None]
                QX, QY = PX, ys[r0 + 1:rr1 + 1, None]
            d1 = ex * (PY - ay) - ey * (PX - ax)
            d2 = ex * (QY - ay) - ey * (QX - ax)
            fx, fy = QX - PX, QY - PY
            d3 = fx * (ay - PY) - fy * (ax - PX)
            d4 = fx * (by - PY) - fy * (bx - PX)
            cross = (d1 * d2 < 0) & (d3 * d4 < 0)
            if horizontal:
                blk = link_e[r0:r1, c0:cc1]
            else:
                blk = link_s[r0:rr1, c0:c1]
            blk[np.broadcast_to(cross, blk.shape)] = attenuation
    return link_e, link_s


# drawn break lines with a drop (retaining walls): pinned ring cells, docs/ELEVATION_SOLVER_V2.md "고도 단절선 단차"


def wall_links(grid: Grid, coords: np.ndarray, low_side: str):
    """
    4-neighbour links P -> Q (Q east or south of P) that cross the polyline: (p_flat, q_flat, p_is_high, arc_s, L).
    P is left of the segment a -> b when (b - a) x (P - a) >= 0 (closed half plane, so a centre on the line has one side
    whatever the direction). A link crosses when its ends are on different sides and the line PQ meets the segment at
    t in [0, 1). The low side is the left (low_side 'left') or the right one. arc_s = arc length at the crossing, L = the
    polyline length. A link may be listed once per segment it crosses.
    """
    H, W = grid.height, grid.width
    pts = np.asarray(coords, float).reshape(-1, 2)
    seg_len = np.hypot(*np.diff(pts, axis=0).T) if len(pts) >= 2 else np.zeros(0)
    cum = np.concatenate([[0.0], np.cumsum(seg_len)])
    xs, ys = grid.cell_centers()
    res = grid.res
    flat = np.arange(H * W, dtype=np.int64).reshape(H, W)
    left_low = low_side == "left"
    out_p, out_q, out_hi, out_s = [], [], [], []
    for j in range(len(pts) - 1):
        (ax, ay), (bx, by) = pts[j], pts[j + 1]
        if not seg_len[j] > 0:
            continue
        r0, r1, c0, c1 = _window(grid, min(ax, bx) - res, max(ax, bx) + res, min(ay, by) - res, max(ay, by) + res)
        if r0 >= r1 or c0 >= c1:
            continue
        ex, ey = bx - ax, by - ay
        for horizontal in (True, False):  # the same windows as breakline_links
            if horizontal:
                cc1 = min(c1, W - 1)
                if c0 >= cc1:
                    continue
                PX, PY = xs[None, c0:cc1], ys[r0:r1, None]
                QX, QY = xs[None, c0 + 1:cc1 + 1], PY
                PF, QF = flat[r0:r1, c0:cc1], flat[r0:r1, c0 + 1:cc1 + 1]
            else:
                rr1 = min(r1, H - 1)
                if r0 >= rr1:
                    continue
                PX, PY = xs[None, c0:c1], ys[r0:rr1, None]
                QX, QY = PX, ys[r0 + 1:rr1 + 1, None]
                PF, QF = flat[r0:rr1, c0:c1], flat[r0 + 1:rr1 + 1, c0:c1]
            shape = PF.shape
            dP = np.broadcast_to(ex * (PY - ay) - ey * (PX - ax), shape)
            dQ = np.broadcast_to(ex * (QY - ay) - ey * (QX - ax), shape)
            fx, fy = QX - PX, QY - PY
            d3 = fx * (ay - PY) - fy * (ax - PX)
            d4 = fx * (by - PY) - fy * (bx - PX)
            den = d3 - d4
            t = np.broadcast_to(np.where(den != 0, d3 / np.where(den != 0, den, 1.0), -1.0), shape)
            lp, lq = dP >= 0, dQ >= 0
            cross = (lp != lq) & (t >= 0) & (t < 1)
            if not cross.any():
                continue
            out_p.append(PF[cross])
            out_q.append(QF[cross])
            out_hi.append(lp[cross] != left_low)
            out_s.append(cum[j] + t[cross] * seg_len[j])
    if not out_p:
        return np.zeros(0, np.int64), np.zeros(0, np.int64), np.zeros(0, bool), np.zeros(0), float(cum[-1])
    return (np.concatenate(out_p), np.concatenate(out_q), np.concatenate(out_hi), np.concatenate(out_s), float(cum[-1]))


def _is_closed(coords: np.ndarray) -> bool:
    c = np.asarray(coords, float).reshape(-1, 2)
    return len(c) >= 3 and bool(np.array_equal(c[0], c[-1]))


def wall_pins(grid: Grid, walls: Sequence[DropWall], fixed: np.ndarray, d_fixed: np.ndarray, usable_cell: np.ndarray,
              cfg: ShoulderConfig) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    """
    Pinned displacements d = h - DEM on the ring cells of the drop walls: (pin (H, W) bool, pin_d (H, W), records).
    Per crossing link (hi, lo) with v = drop x tau (tau: 1, or the open-end taper min(s, L - s) / L_t, L_t = drop /
    wall_tip_slope; links with v <= wall_min_step_m keep no pin): d_hi = +s v, d_lo = -(1 - s) v, s = wall_high_share.
    Within one wall a cell keeps the value of largest |.| (the low side value wins on a cell that is both). Fixed cells
    (roads, pads, aprons) never change: with one fixed end the free end gets d_fixed -/+ v (the mean of its links), with
    both ends fixed the link is a conflict, not enforced. Unusable (missing DEM, excluded) cells are not pinned. Pins of
    different walls add up (crossing walls). Walls crossing the same (hi, lo) links count once, the larger drop kept.
    records: one dict per wall (input order) with id, drop_m, hi, lo, tau, v, both (conflict mask), links, conflicts,
    pins, log, duplicate_of.
    """
    H, W = grid.height, grid.width
    HW = H * W
    pin = np.zeros(HW, bool)
    pin_d = np.zeros(HW)
    records: list[dict] = []
    if not walls:
        return pin.reshape(H, W), pin_d.reshape(H, W), records
    fx = np.asarray(fixed, bool).ravel()
    dfx = np.asarray(d_fixed, float).ravel()
    use = np.asarray(usable_cell, bool).ravel()
    share = cfg.wall_high_share
    found = []
    for w in walls:
        p, q, p_hi, s, L = wall_links(grid, w.coords, w.low_side)
        hi, lo = np.where(p_hi, p, q), np.where(p_hi, q, p)
        found.append((hi, lo, s, L, np.unique(hi * HW + lo).tobytes()))
    winner: dict[bytes, int] = {}
    for i, (w, (hi, _, _, _, key)) in enumerate(zip(walls, found)):
        if len(hi) == 0:
            continue
        j = winner.get(key)
        if j is None or float(w.drop_m) > float(walls[j].drop_m):
            winner[key] = i
    empty_i, empty_f = np.zeros(0, np.int64), np.zeros(0)
    for i, (w, (hi, lo, s, L, key)) in enumerate(zip(walls, found)):
        delta = float(w.drop_m)
        rec = dict(id=w.id, drop_m=delta, hi=empty_i, lo=empty_i, tau=empty_f, v=empty_f, both=np.zeros(0, bool), links=0,
                   conflicts=0, pins=0, log=[], duplicate_of=None)
        records.append(rec)
        if len(hi) == 0:
            rec["log"].append(f"breakline {w.id}: crosses no grid link -> no drop")
            continue
        j = winner[key]
        if j != i:
            rec["duplicate_of"] = walls[j].id
            rec["log"].append(f"breakline {w.id}: crosses the same grid links as {walls[j].id} -> dropM {delta:g} m not used "
                              f"(dropM {float(walls[j].drop_m):g} m kept)")
            continue
        Lt = delta / cfg.wall_tip_slope if cfg.wall_tip_slope > 0 else 0.0
        if _is_closed(w.coords) or Lt <= 0:
            tau = np.ones(len(s))
        else:
            tau = np.clip(np.minimum(s, L - s) / Lt, 0.0, 1.0)
        v = delta * tau
        keep = v > cfg.wall_min_step_m
        hi, lo, tau, v = hi[keep], lo[keep], tau[keep], v[keep]
        ok = use[hi] & use[lo]
        hi, lo, tau, v = hi[ok], lo[ok], tau[ok], v[ok]
        # free-free: the largest |value| per cell (max of the high side values, then the low side values over them)
        val = np.zeros(HW)
        m = ~fx[hi]
        np.maximum.at(val, hi[m], share * v[m])
        m = ~fx[lo]
        lo_val = np.zeros(HW)
        np.minimum.at(lo_val, lo[m], -(1.0 - share) * v[m])
        val[lo[m]] = lo_val[lo[m]]
        # one end fixed: the free end follows the fixed one exactly
        fh, fl = fx[hi], fx[lo]
        a1, a2 = fh & ~fl, fl & ~fh
        tc = np.concatenate([lo[a1], hi[a2]])
        tv = np.concatenate([dfx[hi[a1]] - v[a1], dfx[lo[a2]] + v[a2]])
        if tc.size:
            u, inv = np.unique(tc, return_inverse=True)
            val[u] = np.bincount(inv, weights=tv) / np.bincount(inv)
            mx, mn = np.full(len(u), -np.inf), np.full(len(u), np.inf)
            np.maximum.at(mx, inv, tv)
            np.minimum.at(mn, inv, tv)
            spread = mx - mn
            if (spread > 0.02).any():
                rec["log"].append(f"breakline {w.id}: {int((spread > 0.02).sum())} cell(s) next to fixed cells take the mean of "
                                  f"targets {float(spread.max()):.2f} m apart")
        both = fh & fl
        touched = np.zeros(HW, bool)
        touched[hi] = True
        touched[lo] = True
        touched &= ~fx
        pin_d[touched] += val[touched]
        pin |= touched
        rec.update(hi=hi, lo=lo, tau=tau, v=v, both=both, links=int(len(hi)), conflicts=int(both.sum()),
                   pins=int(touched.sum()))
        if both.any():
            rec["log"].append(f"breakline {w.id}: {int(both.sum())} crossing link(s) with both cells fixed (road, pad, apron) "
                              f"-> drop not enforced there")
    return pin.reshape(H, W), pin_d.reshape(H, W), records


def measure_walls(records: Sequence[dict], h: np.ndarray, dem: np.ndarray) -> list[dict]:
    """
    Measured drop of every wall: the excess ex = (h_hi - h_lo) - (DEM_hi - DEM_lo) over its full height links (tau >= 0.999,
    conflicts left out): min / median / max, and max |ex - drop x tau| (None without such links).
    """
    hf, df = np.asarray(h, float).ravel(), np.asarray(dem, float).ravel()
    out = []
    for r in records:
        e = dict(id=r["id"], drop_m=r["drop_m"], links=r["links"], conflicts=r["conflicts"], pins=r["pins"],
                 duplicate_of=r["duplicate_of"], measured_min_m=None, measured_median_m=None, measured_max_m=None,
                 max_error_m=None)
        hi, lo = r["hi"], r["lo"]
        full = ~r["both"] & (r["tau"] >= 0.999)
        if full.any():
            ex = ((hf[hi] - hf[lo]) - (df[hi] - df[lo]))[full]
            e.update(measured_min_m=float(ex.min()), measured_median_m=float(np.median(ex)), measured_max_m=float(ex.max()),
                     max_error_m=float(np.abs(ex - r["v"][full]).max()))
        out.append(e)
    return out


def _wall_settings(cfg: ShoulderConfig) -> None:
    def num(v):
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)

    if not (num(cfg.wall_high_share) and 0.0 <= cfg.wall_high_share <= 1.0):
        raise ValueError(f"shoulder.wall_high_share must be within [0, 1] (got {cfg.wall_high_share!r})")
    if not (num(cfg.wall_tip_slope) and cfg.wall_tip_slope >= 0.0):
        raise ValueError(f"shoulder.wall_tip_slope must be >= 0 (got {cfg.wall_tip_slope!r})")
    if not (num(cfg.wall_min_step_m) and cfg.wall_min_step_m >= 0.0):
        raise ValueError(f"shoulder.wall_min_step_m must be >= 0 (got {cfg.wall_min_step_m!r})")


def _cg(A, b, M, rtol: float, maxiter: int):
    it = [0]

    def cb(_xk):
        it[0] += 1

    try:
        x, info = cg(A, b, M=M, rtol=rtol, maxiter=maxiter, callback=cb)
    except TypeError:  # SciPy < 1.12 has tol= instead of rtol=
        it[0] = 0
        x, info = cg(A, b, M=M, tol=rtol, maxiter=maxiter, callback=cb)
    return x, info, it[0]


def solve_shoulder(dem: np.ndarray, h_fixed: np.ndarray, fixed: np.ndarray, *, res: float,
                   soft_alpha: np.ndarray, soft_target: np.ndarray, mid: np.ndarray,
                   link_e: np.ndarray, link_s: np.ndarray, exclude: Optional[np.ndarray],
                   cfg: ShoulderConfig) -> tuple[np.ndarray, np.ndarray, dict[str, float]]:
    """
    Displacement d = h - DEM on a band around the fixed cells:
      sum_q w_pq (d_p - d_q) / res^2 + (mu_p + alpha_p) d_p = alpha_p d_hat_p
    fixed neighbours carry d = h_fixed - DEM, valid cells outside the band (and excluded cells) d = 0, missing cells no link.
    """
    t0 = time.perf_counter()
    valid = np.isfinite(dem)
    excl = exclude if exclude is not None else np.zeros_like(valid)
    fixed = fixed & valid
    d_fixed = np.where(fixed, h_fixed - np.where(valid, dem, 0.0), 0.0)
    if fixed.any():
        _, (ir, ic) = ndimage.distance_transform_edt(~fixed, return_indices=True)
        d_near = np.abs(d_fixed[ir, ic])
    else:
        d_near = np.zeros_like(dem)
    if cfg.adaptive:
        ell = np.clip(d_near / cfg.side_slope, cfg.decay_min_m, cfg.decay_max_m)
    else:
        ell = np.full(dem.shape, cfg.decay_length_m)
    mu = 1.0 / ell ** 2
    mu[mid] = 0.0
    src = fixed | (soft_alpha > 0)
    if src.any():
        dist2 = ndimage.distance_transform_edt(~src) * res
    else:
        dist2 = np.full(dem.shape, np.inf)
    unknown = valid & ~fixed & ~excl & ((dist2 <= cfg.band_factor * ell) | mid)
    d = np.where(fixed, d_fixed, 0.0)
    info = {"shoulder_unknowns": float(unknown.sum()), "cg_iterations": 0.0, "cg_converged": 1.0,
            "assemble": 0.0, "cg": 0.0}
    if not unknown.any():
        info["assemble"] = time.perf_counter() - t0
        return d, unknown, info
    n, off, diag, (bi, bq, bw) = _assemble(unknown, link_e, link_s, valid, res)
    diag = diag + mu[unknown] + soft_alpha[unknown]
    diag = np.where(diag > 0, diag, 1.0)
    A = _matrix(n, off, diag)
    rhs = np.bincount(bi, weights=bw * d_fixed.ravel()[bq], minlength=n)
    a_u = soft_alpha[unknown]
    rhs += np.where(a_u > 0, a_u * np.nan_to_num(soft_target[unknown]), 0.0)
    M = sp.diags(1.0 / diag)
    t1 = time.perf_counter()
    x, cg_info, iters = _cg(A, rhs, M, cfg.cg_rtol, cfg.cg_maxiter)
    t2 = time.perf_counter()
    d[unknown] = x
    info.update(cg_iterations=float(iters), cg_converged=1.0 if cg_info == 0 else 0.0, assemble=t1 - t0, cg=t2 - t1)
    return d, unknown, info


# ------------------------------------------------------------------ #
# driver
# ------------------------------------------------------------------ #


def _vertical_steps(h_fixed: np.ndarray, fixed: np.ndarray, grid: Grid, limit: float,
                    pairs: Optional[tuple[np.ndarray, np.ndarray]] = None):
    """
    4-neighbour fixed cell pairs whose height difference exceeds limit: (count, max, top-5 [(dh, x, y)]).
    pairs: (east (H, W-1), south (H-1, W)) masks of the pairs to look at (None: all).
    """
    xs, ys = grid.cell_centers()
    found = []
    count, worst = 0, 0.0
    for horizontal in (True, False):
        if horizontal:
            a, b = h_fixed[:, :-1], h_fixed[:, 1:]
            m = fixed[:, :-1] & fixed[:, 1:]
        else:
            a, b = h_fixed[:-1, :], h_fixed[1:, :]
            m = fixed[:-1, :] & fixed[1:, :]
        if pairs is not None:
            m = m & pairs[0 if horizontal else 1]
        dh = np.where(m, np.abs(b - a), 0.0)
        dh = np.nan_to_num(dh)
        if dh.size:
            worst = max(worst, float(dh.max()))
        over = dh > limit
        count += int(over.sum())
        rr, cc = np.nonzero(over)
        for r, c in zip(rr, cc):
            x = xs[c] + (0.5 * grid.res if horizontal else 0.0)
            y = ys[r] - (0.0 if horizontal else 0.5 * grid.res)
            found.append((float(dh[r, c]), float(x), float(y)))
    found.sort(key=lambda v: -v[0])
    return count, worst, found[:5]


def terrace_walls(owner: np.ndarray, terrace_pad: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """
    Terrace boundaries: 4-neighbour pairs whose cells take their height from two different terraces of the same building
    (pad cells, and the apron / slope cells each terrace owns). (east (H, W-1), south (H-1, W)) bool masks.
    """
    tp = np.append(np.asarray(terrace_pad, np.int64), -1)  # owner -1 -> sentinel -1
    out = []
    for a, b in ((owner[:, :-1], owner[:, 1:]), (owner[:-1, :], owner[1:, :])):
        out.append((a >= 0) & (b >= 0) & (a != b) & (tp[a] == tp[b]))
    return out[0], out[1]


def _runs(v: np.ndarray) -> list[tuple[int, int]]:
    """[start, end] (inclusive) index pairs of the True runs of a 1-D bool array."""
    d = np.diff(np.concatenate([[0], v.astype(np.int8), [0]]))
    starts, ends = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0] - 1
    return list(zip(starts.tolist(), ends.tolist()))


def wall_segments(grid: Grid, wall_e: np.ndarray, wall_s: np.ndarray) -> np.ndarray:
    """Cell edges between the wall pairs as line segments (collinear neighbours merged), (K, 2, 2) grid CRS m."""
    xs, ys = grid.cell_centers()
    h = 0.5 * grid.res
    segs = []
    for c in np.nonzero(wall_e.any(axis=0))[0]:  # pair (r, c) | (r, c + 1): the vertical edge x = xs[c] + h
        for r0, r1 in _runs(wall_e[:, c]):
            segs.append([[xs[c] + h, ys[r0] + h], [xs[c] + h, ys[r1] - h]])
    for r in np.nonzero(wall_s.any(axis=1))[0]:  # pair (r, c) | (r + 1, c): the horizontal edge y = ys[r] - h
        for c0, c1 in _runs(wall_s[r, :]):
            segs.append([[xs[c0] - h, ys[r] - h], [xs[c1] + h, ys[r] - h]])
    return np.array(segs, float).reshape(-1, 2, 2)


def _terrace_report(pads: Sequence[Pad], pr: PadRaster, owner: np.ndarray, pad: np.ndarray, wall_e: np.ndarray,
                    wall_s: np.ndarray, cfg: BuildingConfig) -> tuple[list[dict], list[str]]:
    """Per terrace info and the terrace boundary (retaining wall) log lines."""
    th = pr.terrace_h
    T = len(th)
    cells = np.bincount(pr.terrace_of[pad], minlength=T) if T else np.zeros(0, int)
    pairs: dict[tuple[int, int], int] = {}
    for w, a, b, pa, pb in ((wall_e, owner[:, :-1], owner[:, 1:], pad[:, :-1], pad[:, 1:]),
                            (wall_s, owner[:-1, :], owner[1:, :], pad[:-1, :], pad[1:, :])):
        sel = w & pa & pb
        for u, v in zip(a[sel].tolist(), b[sel].tolist()):
            key = (min(u, v), max(u, v))
            pairs[key] = pairs.get(key, 0) + 1
    bstep = [None] * T
    log = []
    for (u, v), n in sorted(pairs.items()):
        step = abs(float(th[u]) - float(th[v]))
        for t in (u, v):
            bstep[t] = step if bstep[t] is None else max(bstep[t], step)
        pd = pads[int(pr.terrace_pad[u])]
        hi, lo = (u, v) if th[u] >= th[v] else (v, u)
        names = f"{level_name(pr.terrace_level[hi])}/{level_name(pr.terrace_level[lo])}"
        fh = pd.floor_height_m
        if fh is not None and fh > 0:
            log.append(f"building {pd.building_id}: terrace boundary {names} step {step:.2f} m = {step / fh:.1f} x {fh:.2f} m "
                       f"(retaining wall, {n} cell pair(s))")
            k = abs(pr.terrace_storeys[hi] - pr.terrace_storeys[lo])
            if math.isfinite(k) and abs(step - k * fh) > cfg.terrace_multiple_tol_m:
                log.append(f"building {pd.building_id}: warning: terrace boundary {names} step {step:.2f} m is not "
                           f"{k:g} x {fh:.2f} m = {k * fh:.2f} m")
        else:
            log.append(f"building {pd.building_id}: terrace boundary {names} step {step:.2f} m (retaining wall, {n} cell pair(s))")
    info = [{"building_id": pads[int(pr.terrace_pad[t])].building_id, "level": pr.terrace_level[t], "plane_m": float(th[t]),
             "cells": int(cells[t]), "boundary_step_m": bstep[t]} for t in range(T)]
    return info, log


def _max_slope(h: np.ndarray, mask: np.ndarray, res: float) -> float:
    if not mask.any() or min(h.shape) < 2:
        return 0.0
    gy, gx = np.gradient(h, res)
    g = np.hypot(gx, gy)[mask]
    g = g[np.isfinite(g)]
    return float(g.max()) if g.size else 0.0


def grade_grid(grid: Grid, corridors: Corridors, pads: Sequence[Pad], cfg: SolverConfig, *,
               breaklines: Optional[np.ndarray] = None, breakline_attenuation: float = 0.0,
               soft_points: Sequence[SoftPoint] = (), exclude: Optional[np.ndarray] = None,
               drop_walls: Sequence[DropWall] = (), plazas: Sequence[Plaza] = ()) -> GridResult:
    T0 = time.perf_counter()
    _wall_settings(cfg.shoulder)
    log: list[str] = []
    dem = np.asarray(grid.data, float)
    valid = np.isfinite(dem)
    res = grid.res

    # 2. corridors (with plazas: the parts inside a plaza are cut, the rest starts at H on the plaza edge)
    t = time.perf_counter()
    pz: Optional[PlazaRaster] = None
    if plazas:
        pad0 = rasterize_pads(grid, [p for p in pads if np.isfinite(p.h)], cfg.building).pad_id >= 0
        pz = rasterize_plazas(grid, plazas, pad0, cfg.plaza)
        log += pz.log
        by_id = {r["id"]: r["h_m"] for r in pz.report}
        corridors = clip_corridors_to_plazas(corridors, plazas, [by_id.get(p.plaza_id) for p in plazas])
    road = rasterize_corridors(grid, corridors, cfg.raster)
    t_raster = time.perf_counter() - t

    # 3. pads, aprons, slopes
    t = time.perf_counter()
    good = [p for p in pads if np.isfinite(p.h)]
    pr = rasterize_pads(grid, good, cfg.building)
    log += pr.log
    for bid in pr.skipped:
        log.append(f"building {bid}: pad raster is empty -> no pad")
    apron, h_star, slope, owner = building_targets(grid, pr, cfg.building, return_owner=True)
    pad = pr.pad_id >= 0
    h_fixed = np.full(dem.shape, np.nan)
    sel = apron & ~road.road & ~pad
    h_fixed[sel] = h_star[sel]
    sel = road.road & ~pad
    h_fixed[sel] = road.z[sel]
    h_fixed[pad] = pr.terrace_h[pr.terrace_of[pad]]  # one plane per terrace (the pad plane when there are no terraces)
    fixed = (pad | road.road | apron) & valid
    plaza_cells = np.zeros_like(valid)
    collar_id = None
    collar = np.zeros_like(valid)
    if pz is not None:  # priority: building pad > plaza > road > plaza collar > apron (pad cells were never plaza cells)
        plaza_cells = (pz.id >= 0) & ~pad
        h_fixed[plaza_cells] = pz.h[pz.id[plaza_cells]]
        fixed |= plaza_cells & valid
        collar_id = plaza_collar(np.where(plaza_cells, pz.id, -1), pad | road.road, cfg.plaza.collar_cells)
        collar = collar_id >= 0
        h_fixed[collar] = pz.h[collar_id[collar]]  # over the apron; h = h_fixed below keeps the same bits
        fixed |= collar & valid
    owner = np.where(pad, pr.terrace_of, owner)
    wall_e, wall_s = terrace_walls(owner, pr.terrace_pad)
    n_steps, max_step, worst = _vertical_steps(h_fixed, fixed, grid, cfg.building.step_max_m, (~wall_e, ~wall_s))
    if n_steps:
        log.append(f"vertical steps over {cfg.building.step_max_m:g} m: {n_steps} cell pair(s), max {max_step:.2f} m")
        for dh, x, y in worst:
            log.append(f"  step {dh:.2f} m at ({x:.1f}, {y:.1f})")
    n_wall, max_wall, _ = _vertical_steps(h_fixed, fixed, grid, cfg.building.step_max_m, (wall_e, wall_s))
    t_info, t_log = _terrace_report(good, pr, owner, pad, wall_e, wall_s, cfg.building)
    log += t_log
    if n_wall:
        log.append(f"terrace boundaries (retaining walls, not terrain steps) over {cfg.building.step_max_m:g} m: "
                   f"{n_wall} cell pair(s), max {max_wall:.2f} m")
    walls = wall_segments(grid, wall_e, wall_s) if cfg.building.terrace_breakline else np.zeros((0, 2, 2))
    # drawn drop walls: their ring cells join the fixed cells (after the step counts, which stay about the terrain)
    wall_recs: list[dict] = []
    n_pins = 0
    if drop_walls:
        excl = exclude if exclude is not None else np.zeros_like(valid)
        d_fix = np.where(fixed, h_fixed - np.where(valid, dem, 0.0), 0.0)
        pin, pin_d, wall_recs = wall_pins(grid, drop_walls, fixed, d_fix, valid & ~excl, cfg.shoulder)
        for r in wall_recs:
            log += r["log"]
        h_fixed = np.where(pin, dem + pin_d, h_fixed)
        fixed = fixed | pin
        n_pins = int(pin.sum())
    t_build = time.perf_counter() - t

    # 4. islands
    t = time.perf_counter()
    link_e, link_s = breakline_links(grid, breaklines, breakline_attenuation)
    if len(walls):  # terrace boundaries always cut the links fully (attenuation 0), whatever the drawn lines use
        we, ws = breakline_links(grid, walls, 0.0)
        link_e, link_s = np.minimum(link_e, we), np.minimum(link_s, ws)
    island, mid = find_islands(fixed, valid, res, cfg.island, exclude, keep_free=pz.hole if pz is not None else None)
    h_fixed = fill_islands(dem, h_fixed, fixed, island, res, cfg.island, link_e, link_s)
    fixed2 = fixed | island
    t_island = time.perf_counter() - t

    # soft targets (alpha-weighted mean of the displacement targets)
    alpha = np.zeros(dem.shape)
    num = np.zeros(dem.shape)
    ring = road.ring & ~fixed2 & valid
    if ring.any():
        # the half width of the segment that won the cell (per edge widths), or the one half width of every corridor
        hw_ring = road.half_width_map[ring].astype(float) if road.half_width_map is not None else road.half_width_m
        a = (hw_ring + cfg.raster.soft_ring_m - road.dist[ring].astype(float)) / cfg.raster.soft_ring_m
        alpha[ring] += a
        num[ring] += a * (road.z[ring] - dem[ring])
    sl = slope & ~fixed2 & valid
    if sl.any():
        alpha[sl] += cfg.building.alpha_b
        num[sl] += cfg.building.alpha_b * (h_star[sl] - dem[sl])
    if soft_points:
        xs, ys = grid.cell_centers()
        for p in soft_points:
            if not (np.isfinite(p.h) and np.isfinite(p.x) and np.isfinite(p.y)):
                continue
            r0, r1, c0, c1 = _window(grid, p.x - p.radius_m, p.x + p.radius_m, p.y - p.radius_m, p.y + p.radius_m)
            if r0 >= r1 or c0 >= c1:
                continue
            near = np.hypot(xs[None, c0:c1] - p.x, ys[r0:r1, None] - p.y) <= p.radius_m
            near &= ~fixed2[r0:r1, c0:c1] & valid[r0:r1, c0:c1]
            alpha[r0:r1, c0:c1][near] += cfg.shoulder.point_alpha
            num[r0:r1, c0:c1][near] += cfg.shoulder.point_alpha * (p.h - dem[r0:r1, c0:c1][near])
    target = np.where(alpha > 0, num / np.where(alpha > 0, alpha, 1.0), 0.0)

    # 5. shoulder
    d, unknown, info = solve_shoulder(dem, h_fixed, fixed2, res=res, soft_alpha=alpha, soft_target=target, mid=mid,
                                      link_e=link_e, link_s=link_s, exclude=exclude, cfg=cfg.shoulder)
    if not info["cg_converged"]:
        log.append(f"shoulder CG did not converge in {int(info['cg_iterations'])} iteration(s)")
    h = dem + d
    h[fixed2] = h_fixed[fixed2]
    if pz is not None:  # held exactly (variable elimination): the same bits in every plaza cell
        hold = plaza_cells & valid
        h[hold] = pz.h[pz.id[hold]]
    h[~valid] = np.nan
    residual = np.where(valid, h - dem, 0.0)
    total = time.perf_counter() - T0
    stats = {
        "road_cells": float(road.road.sum()), "pad_cells": float(pad.sum()), "apron_cells": float((apron & ~pad).sum()),
        "island_cells": float(island.sum()), "mid_cells": float(mid.sum()), "shoulder_unknowns": info["shoulder_unknowns"],
        "cg_iterations": info["cg_iterations"], "cg_converged": info["cg_converged"],
        "max_abs_residual_m": float(np.abs(residual).max()) if residual.size else 0.0,
        "max_shoulder_slope": _max_slope(h, unknown, res), "max_dem_slope": _max_slope(dem, valid, res),
        "vertical_steps_over_limit": float(n_steps), "max_vertical_step_m": float(max_step),
        "terraces": float(len(pr.terrace_h) - len(set(pr.terrace_pad.tolist()))),
        "terrace_wall_pairs": float(n_wall), "max_terrace_wall_m": float(max_wall),
    }
    wall_report = measure_walls(wall_recs, h, dem) if drop_walls else []
    for e in wall_report:
        if e["duplicate_of"] is not None or e["links"] == 0:
            continue
        if e["measured_median_m"] is None:
            log.append(f"breakline {e['id']}: dropM {e['drop_m']:.2f} m, no full height link to measure "
                       f"({e['links']} link(s)), conflicts {e['conflicts']}")
        else:
            log.append(f"breakline {e['id']}: dropM {e['drop_m']:.2f} m, measured {e['measured_median_m']:.3f} m "
                       f"({e['links']} link(s), min {e['measured_min_m']:.3f} .. max {e['measured_max_m']:.3f}), "
                       f"conflicts {e['conflicts']}")
    if drop_walls:  # only with drop walls, so the stats of a run without them stay as they were
        used = [e for e in wall_report if e["duplicate_of"] is None and e["links"] > 0]
        stats.update(drop_walls=float(len(used)), drop_wall_links=float(sum(e["links"] for e in used)),
                     drop_wall_pins=float(n_pins),
                     max_drop_wall_error_m=max([e["max_error_m"] for e in used if e["max_error_m"] is not None], default=0.0))
    plaza_report: list[dict] = []
    plaza_id = None
    if pz is not None:  # only with plazas, so the stats of a run without them stay as they were
        plaza_report = measure_plazas(pz, h, dem, res)
        n_collar = np.bincount(collar_id[collar], minlength=len(pz.report))
        plaza_report = [{**r, "collar_cells": int(n_collar[k])} for k, r in enumerate(plaza_report)]
        plaza_id = np.where(plaza_cells, pz.id, -1).astype(np.int32)
        stats.update(plazas=float(len(pz.report)), plaza_cells=float(plaza_cells.sum()))
    timings = {"rasterize": t_raster, "buildings": t_build, "islands": t_island, "assemble": info["assemble"],
               "cg": info["cg"], "total": total}
    return GridResult(h, residual, road.road, pr.pad_id, apron & ~pad, island, mid, unknown, stats, timings, log,
                      pr.terrace_of, pr.terrace_h, t_info, walls if len(walls) else None, wall_report,
                      plaza_id, plaza_report, corridors_final=corridors, plaza_collar=collar if pz is not None else None)
