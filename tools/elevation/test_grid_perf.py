"""
실행:  cd tools/elevation && python -m pytest -q -s test_grid_perf.py      (CAMPO_SKIP_PERF=1 이면 건너뜀)

격자 단계 성능: 1500 x 1500 합성 DEM(1 m), 노드 484개, 선분 약 1,100개, 건물 20동에서 grade_grid 한 번의 시간.
상한 30초(설계 명세의 프로토타입 1.72초에 건물·적응형 감쇠 길이와 느린 기계를 감안한 여유). 10초를 넘으면 경고만 한다.
"""
import os
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent))
from campo_grid import Grid  # noqa: E402
from grid_grading import Corridors, Pad, grade_grid, rasterize_corridors  # noqa: E402
from solver_config import SolverConfig  # noqa: E402

X0, Y0 = 203000.0, 552000.0
N, SIZE, STEP = 22, 1500, 65.0


def dem_fn(x, y):
    return 40 + 12 * np.sin(x / 180) * np.cos(y / 230) + 3 * np.sin(x / 37 + y / 53)


def scene():
    rng = np.random.default_rng(0)
    xs = X0 + (np.arange(SIZE) + 0.5)
    ys = Y0 - (np.arange(SIZE) + 0.5)
    X, Y = np.meshgrid(xs, ys)
    grid = Grid(dem_fn(X - X0, Y0 - Y), X0, Y0, 1.0)
    off = (SIZE - (N - 1) * STEP) / 2
    px = X0 + off + STEP * np.arange(N)[None, :] + rng.uniform(-8, 8, (N, N))
    py = Y0 - off - STEP * np.arange(N)[:, None] + rng.uniform(-8, 8, (N, N))
    ph = dem_fn(px - X0, Y0 - py) + rng.uniform(-0.5, 0.5, (N, N))
    segs = []
    for i in range(N):
        for j in range(N):
            if j + 1 < N:
                segs.append(((i, j), (i, j + 1)))
            if i + 1 < N:
                segs.append(((i, j), (i + 1, j)))
    diag = rng.random((N - 1, N - 1)) < 200 / (N - 1) ** 2
    for i, j in zip(*np.nonzero(diag)):
        segs.append(((i, j), (i + 1, j + 1)))
    xy = np.array([[[px[a], py[a]], [px[b], py[b]]] for a, b in segs])
    z = np.array([[ph[a], ph[b]] for a, b in segs])
    corr = Corridors(xy, z, np.tile([0.0, 1.0], (len(segs), 1)), np.zeros(len(segs), np.int32),
                     tuple(f"e{k}" for k in range(len(segs))))
    free = [(i, j) for i in range(N - 1) for j in range(N - 1) if not diag[i, j]]
    pick = rng.choice(len(free), 20, replace=False)
    pads = []
    for k in pick:
        i, j = free[k]
        cx = (px[i, j] + px[i + 1, j + 1]) / 2
        cy = (py[i, j] + py[i + 1, j + 1]) / 2
        ring = np.array([[cx - 7.5, cy - 12.5], [cx + 7.5, cy - 12.5], [cx + 7.5, cy + 12.5], [cx - 7.5, cy + 12.5],
                         [cx - 7.5, cy - 12.5]])
        h = float(dem_fn(cx - X0, Y0 - cy))
        pads.append(Pad(f"b{k}", (ring,), h))
    return grid, corr, pads


@pytest.mark.skipif(os.environ.get("CAMPO_SKIP_PERF") == "1", reason="CAMPO_SKIP_PERF=1")
def test_grid_stage_1500x1500_within_the_limit():
    grid, corr, pads = scene()
    assert len(corr.edge_ids) > 1050
    cfg = SolverConfig()
    best, res = None, None
    for _ in range(2):
        t = time.perf_counter()
        r = grade_grid(grid, corr, pads, cfg)
        el = time.perf_counter() - t
        if best is None or el < best:
            best, res = el, r
    print(f"\ngrade_grid 1500x1500: {best:.2f} s, timings " +
          ", ".join(f"{k} {v:.2f}" for k, v in res.timings.items()))
    print("stats " + ", ".join(f"{k} {v:g}" for k, v in res.stats.items()))
    if best > 10.0:
        warnings.warn(f"grid stage took {best:.1f} s (> 10 s target)")
    assert best < 30.0
    assert res.stats["cg_converged"] == 1 and res.stats["cg_iterations"] <= 500
    assert res.stats["shoulder_unknowns"] > 0 and res.stats["pad_cells"] > 0
    rr = rasterize_corridors(grid, corr, cfg.raster)
    road = rr.road & ~(res.pad_id >= 0)
    assert np.all(res.h[road] == rr.z[road])


@pytest.mark.skipif(os.environ.get("CAMPO_SKIP_PERF") == "1", reason="CAMPO_SKIP_PERF=1")
def test_per_edge_width_raster_is_not_much_slower():
    """The signed distance path (per segment half widths) against the legacy path on the same 1,100 segments.

    The widths are mixed around the default (1 to 3 m, mean 2 m) so both paths scan windows of about the same area:
    this measures the cost of the path itself, not of wider windows (a 6 m road scans a wider window by design).
    """
    import dataclasses

    grid, corr, _ = scene()
    assert len(corr.edge_ids) > 1000
    rng = np.random.default_rng(1)
    widths = rng.choice([1.0, 1.5, 2.0, 2.5, 3.0], len(corr.edge_ids))
    mixed = dataclasses.replace(corr, half_width=widths / 2.0)
    cfg = SolverConfig().raster

    def run(c):
        t = time.perf_counter()
        rasterize_corridors(grid, c, cfg)
        return time.perf_counter() - t

    run(corr), run(mixed)  # warm up
    times = [(run(corr), run(mixed)) for _ in range(7)]  # interleaved, so a slow spell of the machine hits both
    legacy, signed = min(a for a, _ in times), min(b for _, b in times)
    print(f"\nrasterize_corridors 1500x1500, {len(corr.edge_ids)} segments: legacy {legacy:.3f} s, "
          f"per edge width {signed:.3f} s ({signed / legacy:.2f}x)")
    assert signed <= 1.3 * legacy
