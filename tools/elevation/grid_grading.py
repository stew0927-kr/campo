"""
CAMPO height solver v2, grid stages 2-5 (docs/ELEVATION_SOLVER_V2.md).

  2. 2 m corridor rasterisation (road cells fixed at a height that depends only on t: level across the width)
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
    from solver_config import BuildingConfig, IslandConfig, RasterConfig, ShoulderConfig, SolverConfig
except ImportError:  # pragma: no cover
    from .campo_grid import Grid  # type: ignore
    from .solver_config import BuildingConfig, IslandConfig, RasterConfig, ShoulderConfig, SolverConfig  # type: ignore

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
    outside_dem: tuple[Optional[float], ...] = ()  # DEM_0 at the outside points (fallback of the support)
    storeys: float = math.nan


@dataclass(frozen=True)
class SoftPoint:  # barometer point (op:) off the corridors
    x: float
    y: float
    h: float
    radius_m: float


@dataclass
class RoadRaster:
    road: np.ndarray  # (H, W) bool: d <= half_width
    z: np.ndarray  # (H, W) float64: target height of road and ring cells, NaN elsewhere
    dist: np.ndarray  # (H, W) float32: distance to the nearest segment m, inf where none reached
    seg: np.ndarray  # (H, W) int32: that segment, -1 if none
    ring: np.ndarray  # (H, W) bool: half_width < d <= half_width + soft_ring
    half_width_m: float = 1.0  # the half width actually used


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


def rasterize_corridors(grid: Grid, corridors: Corridors, cfg: RasterConfig) -> RoadRaster:
    H, W = grid.height, grid.width
    xs, ys = grid.cell_centers()
    best = np.full((H, W), np.inf)
    zt = np.full((H, W), np.nan)
    seg = np.full((H, W), -1, np.int32)
    hw = effective_half_width(cfg, grid.res)
    outer = hw + cfg.soft_ring_m
    reach = outer + cfg.bbox_pad_m
    for s in range(len(corridors.edge_ids)):
        (xi, yi), (xj, yj) = corridors.xy[s]
        zi, zj = corridors.z[s]
        if not np.all(np.isfinite([xi, yi, xj, yj, zi, zj])):
            continue
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
        upd = d < bw  # ties keep the earlier segment
        bw[upd] = d[upd]
        zw[upd] = z[upd]
        sw[upd] = s
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
# 4. islands
# ------------------------------------------------------------------ #


def find_islands(fixed: np.ndarray, valid: np.ndarray, res: float, cfg: IslandConfig,
                 exclude: Optional[np.ndarray] = None) -> tuple[np.ndarray, np.ndarray]:
    """(island, mid): enclosed free regions (4-connected, not touching the grid edge or missing DEM)."""
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
               soft_points: Sequence[SoftPoint] = (), exclude: Optional[np.ndarray] = None) -> GridResult:
    T0 = time.perf_counter()
    log: list[str] = []
    dem = np.asarray(grid.data, float)
    valid = np.isfinite(dem)
    res = grid.res

    # 2. corridors
    t = time.perf_counter()
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
    t_build = time.perf_counter() - t

    # 4. islands
    t = time.perf_counter()
    link_e, link_s = breakline_links(grid, breaklines, breakline_attenuation)
    if len(walls):  # terrace boundaries always cut the links fully (attenuation 0), whatever the drawn lines use
        we, ws = breakline_links(grid, walls, 0.0)
        link_e, link_s = np.minimum(link_e, we), np.minimum(link_s, ws)
    island, mid = find_islands(fixed, valid, res, cfg.island, exclude)
    h_fixed = fill_islands(dem, h_fixed, fixed, island, res, cfg.island, link_e, link_s)
    fixed2 = fixed | island
    t_island = time.perf_counter() - t

    # soft targets (alpha-weighted mean of the displacement targets)
    alpha = np.zeros(dem.shape)
    num = np.zeros(dem.shape)
    ring = road.ring & ~fixed2 & valid
    if ring.any():
        a = (road.half_width_m + cfg.raster.soft_ring_m - road.dist[ring].astype(float)) / cfg.raster.soft_ring_m
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
    timings = {"rasterize": t_raster, "buildings": t_build, "islands": t_island, "assemble": info["assemble"],
               "cg": info["cg"], "total": total}
    return GridResult(h, residual, road.road, pr.pad_id, apron & ~pad, island, mid, unknown, stats, timings, log,
                      pr.terrace_of, pr.terrace_h, t_info, walls if len(walls) else None)
