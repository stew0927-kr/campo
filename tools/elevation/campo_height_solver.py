"""
CAMPO 높이 솔버 — 1단계 WLS(층 평면 변수 공유 + Baarda data snooping + Huber IRLS + χ² 검정)
                 + 2단계 Wendland C² 컴팩트 지지 잔차 보간(가변 영향 반경, Break-line 측면 분리)

입력: packages/core 의 ElevationStore JSON + dem_prep.py 가 만든 campo-grid (+ 선택: 캠퍼스 GeoJSON 폴더)
출력: 노드 추정치(정표고, σ, floating), 엣지 QC, 보정 격자(DEM + 잔차장), (선택) derived/elevation.json

    python campo_height_solver.py --store store.json --dem campus_dem.json --sigma-dem 3.0 --out out/ \
        [--campus data/campuses/hanyang-seoul --derived-out derived/elevation.json] \
        [--dirty dirty.json --previous-residual out/residual_field.json --previous-derived derived/elevation.json]

의존성: numpy, scipy (pyproj는 위경도→격자 좌표 변환에만 필요)

원본 DEM은 읽기 전용 Prior다. 결과는 언제나 새 파일(corrected_dem, residual_field)로 쓰고 --dem 파일은 건드리지 않는다.

[수학 요약]
  미지수 x = [h_실외(op:, cn:)..., H_(건물,층)(fp:)...]
  엣지 관측   l_e = Δh_e − off_to + off_from,   v_e = x_to − x_from − l_e,  p_e = 1/σ_e²
  DEM prior   v_i = x_i − DEM(p_i),           p_i = 1/σ_DEM²   (실외 노드만, datum 결정)
  해          x̂ = (AᵀPA)⁻¹ AᵀP l,   Qxx = (AᵀPA)⁻¹
  잔차 공분산  Qvv = P⁻¹ − A Qxx Aᵀ,  redundancy r_e = p_e·qvv_e
  Baarda w    w_e = v_e / sqrt(qvv_e)   (σ0 = 1 가정, |w| > z_{1−α/2} 이면 최대 1개씩 제거)
  전역 χ²     T = vᵀPv ~ χ²(m − n)
  Huber IRLS  u = v·√p,  가중 배수 = 1 (|u|≤k) / k/|u| (|u|>k)
  캠퍼스 제약(kind)
     floor_prior  인접 층 평면 H(lv+1) − H(lv) = ext.floor_height_m 또는 3.9 m, σ 큼(층마다 1 m)
     step_count   계단 Δh = ±step_count × 0.16 m (incline 또는 양 끝 층으로 방향), σ = max(0.05, 0.015·n)
     flat_exact   Δh = 0, σ = 1 cm (강한 제약)
     soft_flat    표시 없는 footway(포탈 포함): Δh = 0, σ = 1 %·L. 이 행을 뺀 해(leave-one-out)의 경사
                  |v_j / r_j| / L 가 1 %를 넘으면 실제 경사로 보고 행을 끈다(가장 큰 것 하나씩 끄고 다시 푼다).
  잔차장      r_i = x̂_i − DEM(p_i)
     fusion:  z(p) = Σ φ_i(p) π_i r_i / (π_0 + Σ φ_i(p) π_i),  φ_i = φ(‖p−p_i‖/R_i)   (가변 R, 선형계 풀이 없음)
     rbf:     (Φ + λ·diag(σ̂_i²)) c = r,  z(p) = Σ c_i φ(‖p−p_i‖/R)                (균일 R, 양정치 보장)
     Wendland C²: φ(t) = (1−t)₊⁴ (4t + 1)
     Break-line: 센터 p_i → 격자 p 선분이 불연속선을 가로지르면 φ_i(p) × a (기본 a = 0: 측면 분리)
  사람이 그린 불연속선의 낮은 쪽 면(lowSide)·단차(dropM) (둘 다 있을 때만, 없으면 측면 분리만)
     breakline_drop  선을 가로지르는 캠퍼스 구간(양 끝이 선의 서로 다른 면): h_높은쪽 − h_낮은쪽 = dropM,
                     σ = max(0.15 m, 10 %·dropM). 같은 구간의 step_count·flat_exact가 우선(로그만), soft_flat은 끔
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Optional

import numpy as np
import scipy.sparse as sp
from scipy.sparse.linalg import splu
from scipy.spatial import cKDTree
from scipy.stats import chi2, norm

try:  # 같은 폴더 모듈
    from campo_grid import Grid
except ImportError:  # pragma: no cover
    from .campo_grid import Grid  # type: ignore

# ------------------------------------------------------------------ #
# 기본 파라미터 (docs/ELEVATION_INTEGRATION.md 에 같은 표가 있다)
# ------------------------------------------------------------------ #

DEFAULT_FLOOR_HEIGHT_M = 3.9  # 대학 건물 평균 층고. building.ext.floor_height_m 이 있으면 그 값
FLOOR_PRIOR_SIGMA_M = 1.0  # 층 하나당 층고 prior σ(약한 제약: 기압 Δh σ 0.3~0.45 m, 계단 칸 수보다 훨씬 약함)
STEP_RISE_M = 0.16  # 계단 한 칸 높이
STEP_RISE_SIGMA_M = 0.015  # 한 칸당 σ(같은 계단은 칸 높이가 같이 틀리므로 칸 수에 비례)
STEP_MIN_SIGMA_M = 0.05
FLAT_EXACT_SIGMA_M = 0.01  # flat_exact: 사실상 Δh = 0
SOFT_FLAT_MAX_GRADE = 0.01  # 표시 없는 footway 평지 보정 허용 경사(1 %)
# soft_flat 행 말고는 근거가 전혀 없을 때(redundancy ≈ 0, 예: 포탈 하나로만 이어진 건물) 검정하지 않고 평지로 둔다.
# 0.05(엣지 QC 기준)를 쓰면 거친 DEM에서 모든 footway가 검정 불가가 되므로 따로 둔다. v/r 은 r > 0이면 정확한 LOO 값이다.
SOFT_FLAT_MIN_REDUNDANCY = 1e-6
BREAKLINE_HALF_WIDTH_M = 3.0  # 구간에서 만든 불연속선의 반폭(구간 가운데에 수직)
BREAKLINE_DEM_SIGMA_FACTOR = 2.0  # 불연속선 구간 끝 실외 노드의 DEM prior σ 배수(DEM은 단차를 뭉갬)
BREAKLINE_DROP_MIN_SIGMA_M = 0.15  # 사람이 넣은 단차(dropM) 제약의 최소 σ(눈대중 값)
BREAKLINE_DROP_REL_SIGMA = 0.10  # 단차 σ = max(최소, 10 %·dropM)
BREAKLINE_SIDES = ("left", "right")

MEASURED = "measured"  # 기압 Δh 엣지(QC 대상). 나머지 kind는 제약이라 snooping/Huber 대상이 아니다

# ------------------------------------------------------------------ #
# 데이터 구조
# ------------------------------------------------------------------ #


@dataclass
class Node:
    key: str
    kind: str  # 'outdoor_point' | 'floor_plane'
    x: Optional[float] = None  # 격자 CRS(EPSG:5186) m
    y: Optional[float] = None
    influence_r: float = 1.0


@dataclass
class Edge:
    id: str
    frm: str
    to: str
    dh: float
    sigma: float
    off_from: float = 0.0
    off_to: float = 0.0
    qc: str = "pending"
    kind: str = MEASURED  # measured | floor_prior | step_count | flat_exact | soft_flat | breakline_drop


@dataclass
class SoftFlat:
    """표시 없는 footway 후보: frm·to 높이를 같게 끄는 약한 제약(경사 1 % 이내일 때만 켜짐)."""
    id: str
    frm: str
    to: str
    length: float  # 평면 길이 m


@dataclass
class Breakline:
    id: str
    coords: np.ndarray  # (k, 2) 격자 CRS 꺾은선
    low_side: Optional[str] = None  # 'left' | 'right' (coords 진행 방향 기준), None = 모름
    drop_m: Optional[float] = None  # 높은 쪽 − 낮은 쪽(m, 0 이상), None = 모름


@dataclass
class EdgeReport:
    id: str
    residual_m: float
    w_test: float
    redundancy: float
    robust_weight: float
    qc: str  # ok | downweighted | rejected | untestable | superseded


@dataclass
class NodeResult:
    key: str
    h: float
    sigma: float
    floating: bool
    dem_h: Optional[float] = None
    residual_to_dem: Optional[float] = None
    # 공통 datum(=DEM prior 평균) 오차를 뺀 상대 σ. 2단계 잔차장 가중에 사용
    sigma_rel: Optional[float] = None


@dataclass
class SolveResult:
    nodes: dict[str, NodeResult]
    edges: dict[str, EdgeReport]
    chi2: float
    dof: int
    global_test_passed: bool
    components: list[list[str]]
    log: list[str] = field(default_factory=list)
    # soft_flat id → {"active": bool, "loo_grade": float | None}
    soft_flat: dict[str, dict] = field(default_factory=dict)
    # 성분별 (key → 행/열 번호, Qxx). 엣지 Δh의 σ(상관 포함)에 쓴다
    cov: list[tuple[dict[str, int], np.ndarray]] = field(default_factory=list)
    comp_of: dict[str, int] = field(default_factory=dict)
    solved: set[str] = field(default_factory=set)  # 이번에 푼 성분의 key(restrict_to가 있으면 일부)

    def diff_sigma(self, a: str, b: str) -> Optional[float]:
        """σ(x_b − x_a) = sqrt(Q_aa + Q_bb − 2 Q_ab). 다른 성분이면 None."""
        ca, cb = self.comp_of.get(a), self.comp_of.get(b)
        if ca is None or ca != cb:
            return None
        idx, Q = self.cov[ca]
        i, j = idx[a], idx[b]
        return float(math.sqrt(max(Q[i, i] + Q[j, j] - 2 * Q[i, j], 0.0)))


# ------------------------------------------------------------------ #
# 그래프 유틸
# ------------------------------------------------------------------ #


def connected_components(keys: Iterable[str], edges: Iterable[Edge | SoftFlat]) -> list[list[str]]:
    parent = {k: k for k in keys}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for e in edges:
        if e.frm in parent and e.to in parent:
            ra, rb = find(e.frm), find(e.to)
            if ra != rb:
                parent[ra] = rb
    groups: dict[str, list[str]] = {}
    for k in parent:
        groups.setdefault(find(k), []).append(k)
    return sorted(groups.values(), key=lambda g: (-len(g), g[0]))


# ------------------------------------------------------------------ #
# 1단계: WLS
# ------------------------------------------------------------------ #


@dataclass
class _Obs:
    rows_cols: list[tuple[int, int, float]]
    l: np.ndarray
    p: np.ndarray
    edge_ids: list[Optional[str]]  # None = DEM prior / gauge
    measured: np.ndarray  # bool: QC(snooping, Huber) 대상 행


def _build(idx: dict[str, int], edges: list[Edge], priors: list[tuple[str, float, float]]) -> _Obs:
    rc: list[tuple[int, int, float]] = []
    l, p, ids, measured = [], [], [], []
    r = 0
    for e in edges:
        rc += [(r, idx[e.frm], -1.0), (r, idx[e.to], 1.0)]
        l.append(e.dh - e.off_to + e.off_from)
        p.append(1.0 / e.sigma ** 2)
        ids.append(e.id)
        measured.append(e.kind == MEASURED)
        r += 1
    for key, h, s in priors:
        rc.append((r, idx[key], 1.0))
        l.append(h)
        p.append(1.0 / s ** 2)
        ids.append(None)
        measured.append(False)
        r += 1
    return _Obs(rc, np.asarray(l, float), np.asarray(p, float), ids, np.asarray(measured, bool))


def _matrix(obs: _Obs, n: int) -> sp.csr_matrix:
    r, c, v = zip(*obs.rows_cols)
    return sp.csr_matrix((v, (r, c)), shape=(len(obs.l), n))


def _lsq(A: sp.csr_matrix, l: np.ndarray, p: np.ndarray):
    N = (A.T @ sp.diags(p) @ A).tocsc()
    lu = splu(N)
    x = lu.solve(A.T @ (p * l))
    return x, lu


def _qxx_dense(lu, n: int) -> np.ndarray:
    return lu.solve(np.eye(n))  # 캠퍼스 성분 크기(수천)면 충분히 빠름


def _qvv_diag(A: sp.csr_matrix, Qxx: np.ndarray, p: np.ndarray) -> np.ndarray:
    """diag(Qvv) = 1/p − diag(A Qxx Aᵀ)"""
    AQ = np.asarray(A @ Qxx)  # (m, n) dense
    aqa = np.asarray(A.multiply(AQ).sum(axis=1)).ravel()
    return 1.0 / p - aqa


def _soft_rows(soft: list[SoftFlat], max_grade: float) -> list[Edge]:
    return [Edge(s.id, s.frm, s.to, 0.0, max_grade * max(s.length, 1.0), kind="soft_flat") for s in soft]


def _select_soft_flat(idx, c_edges, priors, c_soft, max_grade, log) -> tuple[set[str], dict[str, dict]]:
    """
    표시 없는 footway 평지 보정: 처음엔 모두 켜고, 그 행을 뺀 해의 경사(leave-one-out: Δh₋ⱼ = v_j / r_j)가
    max_grade를 넘는 행 가운데 가장 큰 것 하나를 끄고 다시 푼다.
    redundancy가 SOFT_FLAT_MIN_REDUNDANCY 미만이면(다른 근거가 없음) 검정할 수 없으므로 켜 둔다(평지로 가정).
    한 번에 하나만 끄는 이유: r > 0인 행 하나를 빼도 datum 없는 부분이 생기지 않지만(그렇다면 r = 0), 둘을 함께 빼면
    생길 수 있다(예: 1층·4층 포탈 두 개로만 땅에 닿은 건물).
    """
    n = len(idx)
    active = {s.id for s in c_soft}
    by_id = {s.id: s for s in c_soft}
    loo: dict[str, Optional[float]] = {s.id: None for s in c_soft}
    for _ in range(len(c_soft) + 1):
        rows = c_edges + _soft_rows([by_id[i] for i in sorted(active)], max_grade)
        obs = _build(idx, rows, priors)
        A = _matrix(obs, n)
        x, lu = _lsq(A, obs.l, obs.p)
        v = A @ x - obs.l
        worst: Optional[tuple[float, SoftFlat]] = None
        for j, eid in enumerate(obs.edge_ids):
            s = by_id.get(eid) if eid is not None else None
            if s is None or eid not in active:
                continue
            a = np.zeros(n)
            a[idx[s.to]], a[idx[s.frm]] = 1.0, -1.0
            qvv = 1.0 / obs.p[j] - float(a @ lu.solve(a))
            red = qvv * obs.p[j]
            if red < SOFT_FLAT_MIN_REDUNDANCY:
                loo[eid] = None
                continue
            g = abs(v[j] / red) / max(s.length, 1e-9)
            loo[eid] = float(g)
            if g > max_grade and (worst is None or g > worst[0]):
                worst = (g, s)
        if worst is None:
            break
        g, s = worst
        active.discard(s.id)
        log.append(f"soft-flat off {s.id}: leave-one-out grade {g * 100:.2f} % > {max_grade * 100:.1f} %")
    return active, {i: {"active": i in active, "loo_grade": loo[i]} for i in by_id}


def solve_heights(
    nodes: list[Node],
    edges: list[Edge],
    dem: Optional[Grid] = None,
    dem_fn: Optional[Callable[[float, float], float]] = None,
    sigma_dem: float = 3.0,
    alpha: float = 0.001,
    huber_k: float = 1.5,
    irls_iters: int = 20,
    max_snoop: int = 20,
    min_redundancy: float = 0.05,
    soft_flat: Iterable[SoftFlat] = (),
    soft_flat_max_grade: float = SOFT_FLAT_MAX_GRADE,
    sigma_dem_scale: Optional[dict[str, float]] = None,
    restrict_to: Optional[set[str]] = None,
) -> SolveResult:
    """
    성분(component)별로 독립 해. dem 또는 dem_fn 중 하나로 DEM prior 공급.
    edges 중 kind != 'measured'(캠퍼스 제약)는 QC(snooping·Huber) 대상이 아니다. soft_flat은 _select_soft_flat.
    restrict_to가 있으면 그 key를 하나라도 가진 성분만 푼다(지연 재계산). 성분은 서로 독립이라 결과는 전체 풀이와 같다.
    """
    log: list[str] = []
    by_key = {n.key: n for n in nodes}
    scale = sigma_dem_scale or {}
    usable = [e for e in edges if e.qc not in ("superseded",) and e.frm in by_key and e.to in by_key and e.frm != e.to]
    soft = [s for s in soft_flat if s.frm in by_key and s.to in by_key and s.frm != s.to]
    reports: dict[str, EdgeReport] = {
        e.id: EdgeReport(e.id, math.nan, math.nan, math.nan, 0.0, "superseded") for e in edges if e.qc == "superseded"
    }

    def dem_at(n: Node) -> Optional[float]:
        if n.kind != "outdoor_point" or n.x is None:
            return None
        if dem_fn is not None:
            v = dem_fn(n.x, n.y)
        elif dem is not None:
            v = float(dem.sample_bilinear(n.x, n.y)[0])
        else:
            return None
        return v if np.isfinite(v) else None

    node_results: dict[str, NodeResult] = {}
    soft_report: dict[str, dict] = {}
    cov: list[tuple[dict[str, int], np.ndarray]] = []
    comp_of: dict[str, int] = {}
    solved: set[str] = set()
    chi2_total, dof_total = 0.0, 0
    comps = connected_components(by_key.keys(), [*usable, *soft])
    crit = float(norm.ppf(1 - alpha / 2))

    for comp in comps:
        if restrict_to is not None and not restrict_to.intersection(comp):
            continue
        solved.update(comp)
        cset = set(comp)
        c_edges = [e for e in usable if e.frm in cset]
        c_soft = [s for s in soft if s.frm in cset]
        idx = {k: i for i, k in enumerate(comp)}
        n = len(comp)
        priors = []
        for k in comp:
            d = dem_at(by_key[k])
            if d is not None:
                priors.append((k, d, sigma_dem * scale.get(k, 1.0)))
        floating = len(priors) == 0
        if floating:
            # datum 결함: 첫 노드를 0으로 고정(상대 높이만 의미)
            priors = [(comp[0], 0.0, 1e-3)]
            log.append(f"component {comp[:3]}... has no DEM prior → floating (relative heights only)")

        if c_soft:
            active, rep = _select_soft_flat(idx, c_edges, priors, c_soft, soft_flat_max_grade, log)
            soft_report.update(rep)
            c_edges = c_edges + _soft_rows([s for s in c_soft if s.id in active], soft_flat_max_grade)

        rejected: set[str] = set()
        # ---- (a) Baarda data snooping: 측정 엣지 중 최대 |w|를 하나씩 제거 ----
        for _ in range(max_snoop):
            act = [e for e in c_edges if e.id not in rejected]
            obs = _build(idx, act, priors)
            if len(obs.l) <= n:
                break
            A = _matrix(obs, n)
            x, lu = _lsq(A, obs.l, obs.p)
            v = A @ x - obs.l
            Qxx = _qxx_dense(lu, n)
            qvv = np.maximum(_qvv_diag(A, Qxx, obs.p), 0.0)
            red = qvv * obs.p
            w = np.where(qvv > 1e-12, v / np.sqrt(np.maximum(qvv, 1e-30)), 0.0)
            cand = [(abs(w[i]), i) for i in range(len(obs.l)) if obs.measured[i] and red[i] >= min_redundancy]
            if not cand:
                break
            wmax, imax = max(cand)
            if wmax <= crit:
                break
            rejected.add(obs.edge_ids[imax])
            log.append(f"w-test reject {obs.edge_ids[imax]} |w|={wmax:.2f} > {crit:.2f}")

        # ---- (b) Huber IRLS on remaining measured edges ----
        act = [e for e in c_edges if e.id not in rejected]
        obs = _build(idx, act, priors)
        A = _matrix(obs, n)
        p_nom = obs.p.copy()
        mult = np.ones_like(p_nom)
        x = np.zeros(n)
        for it in range(irls_iters):
            x_new, lu = _lsq(A, obs.l, p_nom * mult)
            v = A @ x_new - obs.l
            u = np.abs(v) * np.sqrt(p_nom)
            m_new = np.where(obs.measured & (u > huber_k), huber_k / np.maximum(u, 1e-12), 1.0)
            done = it > 0 and np.max(np.abs(x_new - x)) < 1e-7
            x, mult = x_new, m_new
            if done:
                break
        x, lu = _lsq(A, obs.l, p_nom * mult)
        v = A @ x - obs.l
        Qxx = _qxx_dense(lu, n)
        qvv = np.maximum(_qvv_diag(A, Qxx, p_nom * mult), 0.0)
        red = qvv * p_nom * mult
        w = np.where(qvv > 1e-12, v / np.sqrt(np.maximum(qvv, 1e-30)), 0.0)

        # χ²(명목 가중). floating이면 gauge 1개가 datum 결함 1개를 메우므로 dof = m − n 그대로
        dof = max(len(obs.l) - n, 0)
        T = float(np.sum(p_nom * v ** 2))
        chi2_total += T
        dof_total += dof

        sig = np.sqrt(np.maximum(np.diag(Qxx), 0.0))
        J = [idx[k] for k, _, _ in priors]
        if floating:
            sig_rel = sig
        else:  # var(x_i − mean_J x) = Q_ii − 2·mean_j Q_ij + mean_jk Q_jk
            sig_rel = np.sqrt(np.maximum(np.diag(Qxx) - 2 * Qxx[:, J].mean(axis=1) + Qxx[np.ix_(J, J)].mean(), 0.0))
        cov.append((idx, Qxx))
        for k, i in idx.items():
            comp_of[k] = len(cov) - 1
            d = dem_at(by_key[k])
            node_results[k] = NodeResult(k, float(x[i]), float(sig[i]), floating, d,
                                         None if d is None else float(x[i] - d), float(sig_rel[i]))
        for j, eid in enumerate(obs.edge_ids):
            if eid is None or not obs.measured[j]:
                continue
            q = "ok"
            if red[j] < min_redundancy:
                q = "untestable"  # 루프가 없어 오차 검출 불가(왕복/루프 측정 권장)
            elif mult[j] < 0.999:
                q = "downweighted"
            reports[eid] = EdgeReport(eid, float(v[j]), float(w[j]), float(red[j]), float(mult[j]), q)
        for e in c_edges:
            if e.id in rejected:
                # 제거된 엣지의 최종 해 기준 잔차
                vv = (x[idx[e.to]] - x[idx[e.frm]]) - (e.dh - e.off_to + e.off_from)
                reports[e.id] = EdgeReport(e.id, float(vv), math.nan, math.nan, 0.0, "rejected")

    passed = True
    if dof_total > 0:
        lo, hi = chi2.ppf(0.025, dof_total), chi2.ppf(0.975, dof_total)
        passed = bool(lo <= chi2_total <= hi)
        log.append(f"global χ² = {chi2_total:.2f}, dof = {dof_total}, 95% range [{lo:.2f}, {hi:.2f}] → {'PASS' if passed else 'FAIL'}")
    return SolveResult(node_results, reports, chi2_total, dof_total, passed, comps, log, soft_report, cov, comp_of, solved)


# ------------------------------------------------------------------ #
# 캠퍼스 GeoJSON → 높이 변수와 제약 (floor prior, step_count, flat_exact, soft_flat, break-line)
# ------------------------------------------------------------------ #


def floor_id_of_level(level: int) -> str:
    """packages/core elevation floorIdOfLevel 과 같은 규칙: 1 → '1F', -1 → 'B1' (0은 없음)."""
    if not isinstance(level, int) or level == 0:
        raise ValueError(f"not a campus level: {level}")
    return f"{level}F" if level > 0 else f"B{-level}"


def storeys_between(lo: int, hi: int) -> int:
    """층 번호 lo < hi 사이 층 수(0층이 없으므로 지하→지상은 하나 덜 셈)."""
    return (hi - lo) - (1 if lo < 0 < hi else 0)


def is_breakline(p: dict) -> bool:
    """packages/core elevation isBreakline 과 같은 규칙."""
    v = p.get("is_breakline")
    if v is not None:
        return bool(v)
    return p.get("edge_type") == "outdoor" and p.get("highway") == "steps"


@dataclass
class CampusModel:
    nodes: list[Node]  # cn:<id> 실외 변수 + fp:<building>:<floor> 층 평면(건물 levels 전부)
    edges: list[Edge]  # floor_prior / step_count / flat_exact 제약 행
    soft_flat: list[SoftFlat]
    breaklines: list[Breakline]
    var_of: dict[str, str]  # 캠퍼스 지점 id → 높이 변수 key
    edge_vars: dict[str, tuple[str, str]]  # 캠퍼스 구간 id → (from 변수, to 변수), 엘리베이터 제외
    sigma_dem_scale: dict[str, float]
    log: list[str] = field(default_factory=list)
    edge_xy: dict[str, tuple[tuple[float, float], tuple[float, float]]] = field(default_factory=dict)  # 구간 id → 양 끝 격자 좌표


def campus_model(
    features: list[dict],
    project: Callable[[float, float], tuple[float, float]],
    floor_height_default: float = DEFAULT_FLOOR_HEIGHT_M,
    floor_prior_sigma: float = FLOOR_PRIOR_SIGMA_M,
    breakline_half_width: float = BREAKLINE_HALF_WIDTH_M,
    breakline_dem_sigma_factor: float = BREAKLINE_DEM_SIGMA_FACTOR,
) -> CampusModel:
    """
    캠퍼스 Feature(GeoJSON dict) → 솔버 입력. project(lon, lat) → 격자 CRS (x, y).
    - 실외 지점: 변수 cn:<id> (DEM prior를 받는 outdoor_point)
    - 건물 안 지점: 그 건물·층의 층 평면 fp:<building_id>:<floor_id_of_level(level)>
    - 건물마다 levels 인접 층 사이 floor_prior(ext.floor_height_m 또는 기본 3.9 m × 층 수, σ = floor_prior_sigma·√층 수)
    - steps + step_count: 방향(incline, 없으면 양 끝 층 번호)이 정해질 때만 step_count 제약
    - flat_exact: Δh = 0 강한 제약 / 그 밖의 footway(포탈 포함, 불연속선 아님): soft_flat 후보
    - 불연속선(is_breakline): 구간 가운데에 수직인 길이 2·half_width 선, 끝 실외 노드 DEM σ × factor
    """
    log: list[str] = []
    kind = lambda f: (f.get("properties") or {}).get("kind")  # noqa: E731
    buildings = [f for f in features if kind(f) == "building"]
    cnodes = {f["id"]: f for f in features if kind(f) == "node"}
    cedges = [f for f in features if kind(f) == "edge"]

    nodes: dict[str, Node] = {}
    var_of: dict[str, str] = {}
    xy: dict[str, tuple[float, float]] = {}
    level_of: dict[str, int] = {}

    def floor_var(bid: str, level: int) -> str:
        key = f"fp:{bid}:{floor_id_of_level(level)}"
        nodes.setdefault(key, Node(key, "floor_plane"))
        return key

    for nid, f in cnodes.items():
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"][:2]
        xy[nid] = project(lon, lat)
        if p.get("building_id") is None or p.get("level") is None:
            key = f"cn:{nid}"
            nodes[key] = Node(key, "outdoor_point", *xy[nid])
        else:
            level_of[nid] = int(p["level"])
            key = floor_var(p["building_id"], level_of[nid])
        var_of[nid] = key

    edges: list[Edge] = []
    for b in buildings:
        p = b["properties"]
        levels = sorted(int(lv) for lv in p.get("levels", []))
        height = (p.get("ext") or {}).get("floor_height_m") or floor_height_default
        for lo, hi in zip(levels, levels[1:]):
            k = storeys_between(lo, hi)
            edges.append(Edge(f"floor_prior:{b['id']}:{floor_id_of_level(lo)}", floor_var(b["id"], lo), floor_var(b["id"], hi),
                              height * k, floor_prior_sigma * math.sqrt(k), kind="floor_prior"))

    soft: list[SoftFlat] = []
    breaklines: list[Breakline] = []
    scale: dict[str, float] = {}
    edge_vars: dict[str, tuple[str, str]] = {}
    edge_xy: dict[str, tuple[tuple[float, float], tuple[float, float]]] = {}
    for f in cedges:
        p, eid = f["properties"], f["id"]
        a, b = p.get("from"), p.get("to")
        if a not in var_of or b not in var_of:
            continue
        va, vb = var_of[a], var_of[b]
        hw = p.get("highway")
        if hw != "elevator":
            edge_vars[eid] = (va, vb)
            edge_xy[eid] = (xy[a], xy[b])
        length = math.dist(xy[a], xy[b])
        if is_breakline(p) and length > 0 and (va.startswith("cn:") or vb.startswith("cn:")):
            (ax, ay), (bx, by) = xy[a], xy[b]
            mx, my = (ax + bx) / 2, (ay + by) / 2
            nx, ny = -(by - ay) / length, (bx - ax) / length
            breaklines.append(Breakline(f"edge:{eid}", np.array([[mx - nx * breakline_half_width, my - ny * breakline_half_width],
                                                                 [mx + nx * breakline_half_width, my + ny * breakline_half_width]])))
            for v in (va, vb):
                if v.startswith("cn:"):
                    scale[v] = breakline_dem_sigma_factor
        if va == vb:
            continue  # 같은 층 평면 안(복도 등): 층 평면 모델에서는 높이 차가 없다
        if p.get("flat_exact") is True:
            edges.append(Edge(f"flat_exact:{eid}", va, vb, 0.0, FLAT_EXACT_SIGMA_M, kind="flat_exact"))
        elif hw == "steps":
            n = p.get("step_count")
            sign = {"up": 1.0, "down": -1.0}.get(p.get("incline"))
            if sign is None and a in level_of and b in level_of and level_of[a] != level_of[b]:
                sign = 1.0 if level_of[b] > level_of[a] else -1.0
            if isinstance(n, int) and n > 0 and sign is not None and p.get("conveying") is None:
                edges.append(Edge(f"step_count:{eid}", va, vb, sign * n * STEP_RISE_M,
                                  max(STEP_MIN_SIGMA_M, STEP_RISE_SIGMA_M * n), kind="step_count"))
            elif isinstance(n, int) and n > 0:
                log.append(f"steps {eid}: step_count without a direction (incline) → not used")
        elif hw == "footway" and not is_breakline(p):
            soft.append(SoftFlat(f"soft_flat:{eid}", va, vb, length))
    return CampusModel(list(nodes.values()), edges, soft, breaklines, var_of, edge_vars, scale, log, edge_xy)


def _side(ax: float, ay: float, bx: float, by: float, px: float, py: float) -> float:
    """> 0: p는 a→b 진행 방향의 왼쪽, < 0: 오른쪽 (격자 CRS는 x 동, y 북)."""
    return (bx - ax) * (py - ay) - (by - ay) * (px - ax)


def _crossings(line: Breakline, p: tuple[float, float], q: tuple[float, float]) -> list[str]:
    """p→q 선분이 꺾은선의 선분을 '진짜로' 가로지를 때마다 p가 그 선분의 어느 면('left'|'right')인지(끝점 접촉은 아님)."""
    out = []
    for a, b in zip(line.coords[:-1], line.coords[1:]):
        dp, dq = _side(a[0], a[1], b[0], b[1], *p), _side(a[0], a[1], b[0], b[1], *q)
        da, db = _side(p[0], p[1], q[0], q[1], a[0], a[1]), _side(p[0], p[1], q[0], q[1], b[0], b[1])
        if dp * dq < 0 and da * db < 0:
            out.append("left" if dp > 0 else "right")
    return out


def breakline_drop_edges(
    lines: Iterable[Breakline],
    cm: CampusModel,
    dem_sigma_factor: float = BREAKLINE_DEM_SIGMA_FACTOR,
) -> tuple[list[Edge], set[str], dict[str, float], list[str]]:
    """
    사람이 그린 불연속선의 lowSide·dropM → 그 선을 가로지르는 캠퍼스 구간마다 Δh 제약(kind 'breakline_drop').
    반환: (제약 행, 끌 soft_flat id, DEM σ 배수를 줄 실외 변수, 로그). lowSide·dropM이 다 있어야 행을 만든다.
    한 구간이 같은 선을 여러 번 가로지르면(지그재그) 높이차를 알 수 없어 쓰지 않는다.
    """
    rows: list[Edge] = []
    off_soft: set[str] = set()
    scale: dict[str, float] = {}
    log: list[str] = []
    taken = {e.id for e in cm.edges}
    for bl in lines:
        if bl.low_side is None and bl.drop_m is None:
            continue
        if bl.low_side is None:
            log.append(f"breakline {bl.id}: dropM {bl.drop_m:g} m without lowSide → side separation only")
            continue
        if bl.drop_m is None:
            log.append(f"breakline {bl.id}: lowSide {bl.low_side} without dropM → side separation only")
            continue
        used = 0
        for eid, (va, vb) in cm.edge_vars.items():
            if va == vb or eid not in cm.edge_xy:
                continue
            sides = _crossings(bl, *cm.edge_xy[eid])
            if not sides:
                continue
            if len(sides) != 1:
                log.append(f"breakline {bl.id}: edge {eid} crosses it {len(sides)} times → not used")
                continue
            if f"flat_exact:{eid}" in taken:
                if bl.drop_m > 0:
                    log.append(f"breakline {bl.id}: edge {eid} is flat_exact but crosses a {bl.drop_m:g} m drop → flat_exact kept")
                continue
            if f"step_count:{eid}" in taken:
                log.append(f"breakline {bl.id}: edge {eid} has step_count → step_count kept")
                continue
            # from이 낮은 쪽이면 to가 dropM만큼 높다.
            dh = bl.drop_m if sides[0] == bl.low_side else -bl.drop_m
            sigma = max(BREAKLINE_DROP_MIN_SIGMA_M, BREAKLINE_DROP_REL_SIGMA * bl.drop_m)
            rows.append(Edge(f"breakline_drop:{bl.id}:{eid}", va, vb, dh, sigma, kind="breakline_drop"))
            off_soft.add(f"soft_flat:{eid}")
            for v in (va, vb):
                if v.startswith("cn:"):
                    scale[v] = dem_sigma_factor
            used += 1
        log.append(f"breakline {bl.id}: low side {bl.low_side}, drop {bl.drop_m:g} m → {used} crossing edge(s) constrained")
    return rows, off_soft, scale, log


def read_campus_features(folder: str | Path) -> list[dict]:
    """캠퍼스 폴더의 *.geojson 전부(SPEC.md 4.3 배치: outdoor, connections, buildings/*/…)."""
    out: list[dict] = []
    for path in sorted(Path(folder).rglob("*.geojson")):
        fc = json.loads(path.read_text(encoding="utf-8"))
        if fc.get("type") == "FeatureCollection":
            out += [f for f in fc.get("features", []) if isinstance(f, dict)]
    return out


def _r(v: float, digits: int = 3) -> float:
    return round(v, digits) + 0.0  # no -0.0 in the JSON


def derived_elevation(cm: CampusModel, res: SolveResult, run_id: str, solved_at_ms: int,
                      previous: Optional[dict] = None) -> dict:
    """
    derived/elevation.json (packages/core elevation DerivedElevation). 지점은 변수의 높이·상대 σ, 구간은
    양 끝 변수가 다를 때만 Δh와 상관을 반영한 σ. previous가 있으면 이번에 풀지 않은 성분의 값은 그대로 둔다.
    """
    nodes = dict((previous or {}).get("nodes", {}))
    edges = dict((previous or {}).get("edges", {}))
    for nid, key in cm.var_of.items():
        r = res.nodes.get(key)
        if r is not None and key in res.solved:
            s = r.sigma_rel if r.sigma_rel is not None else r.sigma
            nodes[nid] = {"z_m": _r(r.h), "sigma_m": _r(s), "floating": r.floating}
    for eid, (va, vb) in cm.edge_vars.items():
        if va == vb or va not in res.solved:
            continue
        s = res.diff_sigma(va, vb)
        if s is None:
            continue
        edges[eid] = {"elev_diff_m": _r(res.nodes[vb].h - res.nodes[va].h), "elev_sigma_m": _r(s)}
    return {"format": "campo-derived-elevation/1", "runId": run_id, "solvedAt": solved_at_ms,
            "nodes": dict(sorted(nodes.items())), "edges": dict(sorted(edges.items()))}


def breakline_boxes(req: dict, project: Optional[Callable[[float, float], tuple[float, float]]]) -> list[tuple[float, float, float, float]]:
    """
    RecomputeRequest.breaklines[].boxes (WGS84 [minLng, minLat, maxLng, maxLat]: where a 고도 단절선 was drawn, changed or
    removed, before and after) → 격자 CRS의 (xmin, ymin, xmax, ymax). 투영 함수가 없으면 빈 목록.
    """
    out = []
    if project is None:
        return out
    for line in req.get("breaklines", []) or []:
        for b in line.get("boxes", []) or []:
            if len(b) != 4:
                continue
            xs, ys = zip(*(project(lng, lat) for lng in (b[0], b[2]) for lat in (b[1], b[3])))
            out.append((min(xs), min(ys), max(xs), max(ys)))
    return out


def dirty_seeds(req: dict, cm: Optional[CampusModel], keys: Iterable[str],
                project: Optional[Callable[[float, float], tuple[float, float]]] = None) -> set[str]:
    """
    RecomputeRequest(packages/core elevation recomputeRequest) → 다시 풀 성분을 고르는 변수 key.
    고도 단절선이 바뀐 곳(req.breaklines)을 지나는 캠퍼스 구간은 그 구간 변수까지(breakline_drop 제약이 생기거나 사라진다).
    """
    seeds = set(req.get("heightNodes", []))
    if cm is not None:
        seeds |= {cm.var_of[n] for n in req.get("campusNodes", []) if n in cm.var_of}
        for eid in req.get("campusEdges", []):
            seeds |= set(cm.edge_vars.get(eid, ()))
        for x0, y0, x1, y1 in breakline_boxes(req, project):
            for eid, ((ax, ay), (bx, by)) in cm.edge_xy.items():
                if max(ax, bx) >= x0 and min(ax, bx) <= x1 and max(ay, by) >= y0 and min(ay, by) <= y1:
                    seeds |= set(cm.edge_vars.get(eid, ()))
    for bid in req.get("buildings", []):
        seeds |= {k for k in keys if k.startswith(f"fp:{bid}:")}
    return seeds


# ------------------------------------------------------------------ #
# 2단계: Wendland C² 잔차장 (+ Break-line)
# ------------------------------------------------------------------ #


def wendland_c2(t: np.ndarray) -> np.ndarray:
    """φ(t) = (1 − t)₊⁴ (4t + 1).  φ(0)=1, φ(1)=0, φ'(1)=φ''(1)=0 (C²), ℝ³까지 양정치."""
    t = np.asarray(t, float)
    a = np.clip(1.0 - t, 0.0, None)
    return a ** 4 * (4.0 * t + 1.0)


@dataclass
class ResidualCenter:
    key: str
    x: float
    y: float
    r: float  # 잔차 x̂ − DEM
    sigma: float  # 노드 상대 σ(공통 datum 오차 제외)
    radius: float  # 영향 반경 R_i


def residual_centers(nodes: list[Node], res: SolveResult) -> list[ResidualCenter]:
    out = []
    for n in nodes:
        nr = res.nodes.get(n.key)
        if n.kind != "outdoor_point" or nr is None or nr.floating or nr.residual_to_dem is None:
            continue
        s_ = nr.sigma_rel if nr.sigma_rel is not None else nr.sigma
        out.append(ResidualCenter(n.key, n.x, n.y, nr.residual_to_dem, max(s_, 1e-3), n.influence_r))
    return out


def _window(grid: Grid, x: float, y: float, R: float, bounds=None):
    c0, r0 = grid.xy_to_colrow(x - R, y + R)
    c1, r1 = grid.xy_to_colrow(x + R, y - R)
    cmin, cmax = max(int(math.floor(c0)), 0), min(int(math.ceil(c1)), grid.width - 1)
    rmin, rmax = max(int(math.floor(r0)), 0), min(int(math.ceil(r1)), grid.height - 1)
    if bounds is not None:
        rb0, rb1, cb0, cb1 = bounds
        rmin, rmax, cmin, cmax = max(rmin, rb0), min(rmax, rb1 - 1), max(cmin, cb0), min(cmax, cb1 - 1)
    return rmin, rmax, cmin, cmax


def _segments_near(lines: list[Breakline], x0: float, y0: float, x1: float, y1: float) -> list[np.ndarray]:
    """bbox [x0,x1]×[y0,y1]와 겹치는 불연속선 선분들(각 (2, 2))."""
    out = []
    for bl in lines:
        for a, b in zip(bl.coords[:-1], bl.coords[1:]):
            if max(a[0], b[0]) < x0 or min(a[0], b[0]) > x1 or max(a[1], b[1]) < y0 or min(a[1], b[1]) > y1:
                continue
            out.append(np.array([a, b], float))
    return out


def _crosses(cx: float, cy: float, X: np.ndarray, Y: np.ndarray, segs: list[np.ndarray]) -> np.ndarray:
    """센터 (cx, cy) → 각 점 (X, Y) 선분이 불연속선 선분 하나라도 '진짜로' 가로지르는지(끝점 접촉은 아님)."""
    out = np.zeros(np.shape(X), bool)
    for (ax, ay), (bx, by) in segs:
        ex, ey = bx - ax, by - ay
        d1 = ex * (cy - ay) - ey * (cx - ax)  # 센터가 선의 어느 쪽
        d2 = ex * (Y - ay) - ey * (X - ax)  # 격자점이 선의 어느 쪽
        fx, fy = X - cx, Y - cy
        d3 = fx * (ay - cy) - fy * (ax - cx)  # 선 끝점들이 센터→격자점 선분의 어느 쪽
        d4 = fx * (by - cy) - fy * (bx - cx)
        out |= (d1 * d2 < 0) & (d3 * d4 < 0)
    return out


def _kernel(c: ResidualCenter, X: np.ndarray, Y: np.ndarray, R: float, lines: list[Breakline], attenuation: float) -> np.ndarray:
    phi = wendland_c2(np.hypot(X - c.x, Y - c.y) / R)
    if lines:
        segs = _segments_near(lines, c.x - R, c.y - R, c.x + R, c.y + R)
        if segs:
            phi = np.where(_crosses(c.x, c.y, X, Y, segs), phi * attenuation, phi)
    return phi


def residual_field(
    grid: Grid,
    centers: list[ResidualCenter],
    method: str = "fusion",
    sigma_prior: float = 3.0,
    rbf_smooth: float = 1.0,
    bounds: Optional[tuple[int, int, int, int]] = None,
    breaklines: Iterable[Breakline] = (),
    breakline_attenuation: float = 0.0,
) -> np.ndarray:
    """
    격자 위 잔차장 z. bounds=(row0,row1,col0,col1)이면 그 타일만 계산(나머지 0).
    - fusion: 반경 가변 OK. 잔차 prior 0(정밀도 π0=1/σ_prior²)과 커널 가중 융합.
    - rbf:    모든 센터의 R이 같아야 함. 희소 (Φ + λΣ) c = r 풀이.
    breaklines: 센터→격자점 선분이 가로지르면 커널 × breakline_attenuation(0이면 반대편에 전혀 퍼지지 않음).
    rbf는 센터 쌍 Φ_ij에도 같은 감쇠를 곱한다(λΣ 대각 덕분에 풀 수 있지만 양정치 보장은 감쇠 없을 때만).
    지지 반경은 그대로라 dirty_tiles / update_tiles 의 국소 갱신은 그대로 정확하다.
    """
    lines = list(breaklines)
    z = np.zeros((grid.height, grid.width))
    if not centers:
        return z
    xs_all, ys_all = grid.cell_centers()

    if method == "fusion":
        num = np.zeros_like(z)
        den = np.full_like(z, 1.0 / sigma_prior ** 2)
        for c in centers:
            rmin, rmax, cmin, cmax = _window(grid, c.x, c.y, c.radius, bounds)
            if rmin > rmax or cmin > cmax:
                continue
            X, Y = np.meshgrid(xs_all[cmin:cmax + 1], ys_all[rmin:rmax + 1])
            phi = _kernel(c, X, Y, c.radius, lines, breakline_attenuation)
            pi = 1.0 / c.sigma ** 2
            num[rmin:rmax + 1, cmin:cmax + 1] += phi * pi * c.r
            den[rmin:rmax + 1, cmin:cmax + 1] += phi * pi
        z = num / den
    elif method == "rbf":
        R = centers[0].radius
        if any(abs(c.radius - R) > 1e-9 for c in centers):
            raise ValueError("rbf method needs a uniform radius (use fusion for variable radii)")
        P = np.array([[c.x, c.y] for c in centers])
        tree = cKDTree(P)
        pairs = tree.sparse_distance_matrix(tree, R, output_type="coo_matrix")
        off = pairs.row != pairs.col  # 대각은 SciPy 버전에 따라 포함/누락 → 직접 1로 둔다
        rows, cols = pairs.row[off], pairs.col[off]
        vals = wendland_c2(pairs.data[off] / R)
        if lines:
            for k, (i, j) in enumerate(zip(rows, cols)):
                ci, cj = centers[i], centers[j]
                segs = _segments_near(lines, min(ci.x, cj.x), min(ci.y, cj.y), max(ci.x, cj.x), max(ci.y, cj.y))
                if segs and _crosses(ci.x, ci.y, np.array(cj.x), np.array(cj.y), segs):
                    vals[k] *= breakline_attenuation
        Phi = sp.coo_matrix((vals, (rows, cols)), shape=(len(P), len(P))).tocsc() + sp.identity(len(P), format="csc")
        lam = sp.diags([rbf_smooth * c.sigma ** 2 / sigma_prior ** 2 for c in centers])
        coef = splu((Phi + lam).tocsc()).solve(np.array([c.r for c in centers]))
        for c, a in zip(centers, coef):
            rmin, rmax, cmin, cmax = _window(grid, c.x, c.y, R, bounds)
            if rmin > rmax or cmin > cmax:
                continue
            X, Y = np.meshgrid(xs_all[cmin:cmax + 1], ys_all[rmin:rmax + 1])
            z[rmin:rmax + 1, cmin:cmax + 1] += a * _kernel(c, X, Y, R, lines, breakline_attenuation)
    else:
        raise ValueError(method)

    if bounds is not None:
        rb0, rb1, cb0, cb1 = bounds
        mask = np.zeros_like(z, bool)
        mask[rb0:rb1, cb0:cb1] = True
        z = np.where(mask, z, 0.0)
    return z


def dirty_tiles(grid: Grid, changed: list[ResidualCenter], tile: int = 64) -> set[tuple[int, int]]:
    """바뀐 노드의 bbox ⊕ R과 겹치는 타일 (tile_row, tile_col) 집합."""
    out = set()
    for c in changed:
        rmin, rmax, cmin, cmax = _window(grid, c.x, c.y, c.radius)
        for tr in range(rmin // tile, rmax // tile + 1):
            for tc in range(cmin // tile, cmax // tile + 1):
                out.add((tr, tc))
    return out


def box_tiles(grid: Grid, boxes: Iterable[tuple[float, float, float, float]], reach: float, tile: int = 64) -> set[tuple[int, int]]:
    """격자 평면 상자(xmin, ymin, xmax, ymax)를 reach만큼 넓힌 곳과 겹치는 타일 (tile_row, tile_col) 집합."""
    out = set()
    for x0, y0, x1, y1 in boxes:
        c0, r0 = grid.xy_to_colrow(x0 - reach, y1 + reach)
        c1, r1 = grid.xy_to_colrow(x1 + reach, y0 - reach)
        cmin, cmax = max(int(math.floor(c0)), 0), min(int(math.ceil(c1)), grid.width - 1)
        rmin, rmax = max(int(math.floor(r0)), 0), min(int(math.ceil(r1)), grid.height - 1)
        for tr in range(rmin // tile, rmax // tile + 1):
            for tc in range(cmin // tile, cmax // tile + 1):
                out.add((tr, tc))
    return out


def update_tiles(grid: Grid, z: np.ndarray, centers: list[ResidualCenter], tiles: set[tuple[int, int]],
                 tile: int = 64, **kw) -> np.ndarray:
    """fusion 잔차장의 국소 재계산(컴팩트 지지 덕분에 전체 재계산과 정확히 같다)."""
    z = z.copy()
    for tr, tc in tiles:
        b = (tr * tile, min((tr + 1) * tile, grid.height), tc * tile, min((tc + 1) * tile, grid.width))
        zt = residual_field(grid, centers, bounds=b, **kw)
        z[b[0]:b[1], b[2]:b[3]] = zt[b[0]:b[1], b[2]:b[3]]
    return z


# ------------------------------------------------------------------ #
# ElevationStore JSON ↔ 내부 구조
# ------------------------------------------------------------------ #


def load_store(path: str | Path, grid_crs: str = "EPSG:5186") -> tuple[list[Node], list[Edge], dict]:
    s = json.loads(Path(path).read_text(encoding="utf-8"))
    if s.get("schemaVersion") != 1:
        raise ValueError("unsupported schemaVersion")
    from pyproj import Transformer  # 실외 노드 위경도 → 격자 평면좌표

    tf = Transformer.from_crs("EPSG:4326", grid_crs, always_xy=True)
    nodes = []
    for n in s["nodes"]:
        if n["kind"] == "outdoor_point":
            x, y = tf.transform(n["position"]["lng"], n["position"]["lat"])
            nodes.append(Node(n["key"], "outdoor_point", x, y, n.get("influenceRadiusM", 1.0)))
        else:
            nodes.append(Node(n["key"], "floor_plane"))
    edges = [Edge(e["edgeId"], e["from"], e["to"], e["dhM"], e["sigmaM"], e.get("offsetFromM", 0.0),
                  e.get("offsetToM", 0.0), e.get("qc", "pending")) for e in s["edges"]]
    return nodes, edges, s


def store_breaklines(store: dict, project: Callable[[float, float], tuple[float, float]],
                     log: Optional[list[str]] = None) -> list[Breakline]:
    """
    ElevationStore.breaklines(사람이 그린 선, WGS84) → 격자 CRS. 선택 필드 lowSide('left'|'right')·dropM(m ≥ 0)도 읽는다.
    없는 예전 파일은 그대로(측면 분리만). 값이 잘못되면 그 필드만 버리고 log에 남긴다.
    격자 CRS가 x 동·y 북이면 좌/우 판정은 WGS84에서와 같다(투영은 방향을 뒤집지 않는다).
    """
    out = []
    for b in store.get("breaklines", []) or []:
        pts = [project(c["lng"], c["lat"]) for c in b.get("coordinates", [])]
        if len(pts) < 2:
            continue
        bid = b.get("id", "?")
        side = b.get("lowSide")
        if side is not None and side not in BREAKLINE_SIDES:
            if log is not None:
                log.append(f"breakline {bid}: lowSide {side!r} is not 'left' or 'right' → ignored")
            side = None
        drop = b.get("dropM")
        if drop is not None:
            ok = isinstance(drop, (int, float)) and not isinstance(drop, bool) and math.isfinite(drop) and drop >= 0
            if not ok:
                if log is not None:
                    log.append(f"breakline {bid}: dropM {drop!r} is not a height >= 0 m → ignored")
                drop = None
        out.append(Breakline(bid, np.array(pts, float), side, None if drop is None else float(drop)))
    return out


def write_back(store: dict, res: SolveResult, run_id: str, solved_at_ms: int) -> dict:
    """솔버 결과를 store JSON 캐시 필드(estimates/lastSolve, edge.qc)에 반영. 캠퍼스 변수(cn:)는 derived 파일로만."""
    s = json.loads(json.dumps(store))
    for e in s["edges"]:
        r = res.edges.get(e["edgeId"])
        if r:
            e["qc"] = {"untestable": "ok"}.get(r.qc, r.qc)
            e["robustWeight"] = r.robust_weight
    estimates = {e["key"]: e for e in s.get("estimates", []) or []}
    for k, v in res.nodes.items():
        if k.startswith(("op:", "fp:")):
            estimates[k] = {"key": k, "hM": v.h, "sigmaM": v.sigma, "sigmaRelM": v.sigma_rel, "floating": v.floating}
    s["estimates"] = sorted(estimates.values(), key=lambda e: e["key"])
    s["lastSolve"] = {
        "runId": run_id, "solvedAt": solved_at_ms, "nNodes": len(res.nodes), "nEdges": len(s["edges"]),
        "chi2": res.chi2, "dof": res.dof, "globalTestPassed": res.global_test_passed,
        "rejectedEdgeIds": [k for k, v in res.edges.items() if v.qc == "rejected"],
    }
    return s


def previous_results(nodes: list[Node], store: dict, derived: Optional[dict], cm: Optional[CampusModel],
                     dem_h: Callable[[Node], Optional[float]], skip: set[str]) -> dict[str, NodeResult]:
    """지난 풀이 값(store.estimates, 지난 derived 파일의 실외 지점) → NodeResult. 잔차장 국소 갱신용."""
    h: dict[str, tuple[float, float, bool]] = {}
    for e in store.get("estimates", []) or []:
        h[e["key"]] = (e["hM"], e.get("sigmaRelM") or e["sigmaM"], e.get("floating", False))
    if derived and cm:
        for nid, v in derived.get("nodes", {}).items():
            key = cm.var_of.get(nid)
            if key and key.startswith("cn:"):
                h[key] = (v["z_m"], v["sigma_m"], v.get("floating", False))
    out = {}
    for n in nodes:
        if n.key in skip or n.key not in h:
            continue
        z, s, fl = h[n.key]
        d = dem_h(n)
        out[n.key] = NodeResult(n.key, z, s, fl, d, None if d is None else z - d, s)
    return out


def _dem_value(grid: Grid, n: Node) -> Optional[float]:
    if n.kind != "outdoor_point" or n.x is None:
        return None
    v = float(grid.sample_bilinear(n.x, n.y)[0])
    return v if np.isfinite(v) else None


ENGINE_V2 = "campo-height-solver/2"
DEFAULT_ENGINE = "v1"  # the editor keeps v1 until v2 is validated on real campus data (CAMPO_ELEVATION_ENGINE=v2 opts in)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--store", required=True, help="ElevationStore JSON")
    ap.add_argument("--dem", required=True, help="campo-grid meta JSON (dem_prep.py 출력, 읽기 전용)")
    ap.add_argument("--sigma-dem", type=float, default=None, help="DEM prior σ(m). 90 m DEM≈3~5, 등고선 TIN≈1.5~2.5 (기본 3.0)")
    ap.add_argument("--alpha", type=float, default=0.001)
    ap.add_argument("--huber-k", type=float, default=1.5)
    ap.add_argument("--method", choices=["fusion", "rbf"], default="fusion")
    ap.add_argument("--campus", help="캠퍼스 폴더(data/campuses/<id>): 층고 prior, 계단 칸 수, 평지·불연속선 제약")
    ap.add_argument("--floor-height-default", type=float, default=DEFAULT_FLOOR_HEIGHT_M)
    ap.add_argument("--floor-prior-sigma", type=float, default=FLOOR_PRIOR_SIGMA_M)
    ap.add_argument("--soft-flat-max-grade", type=float, default=None, help="표시 없는 footway 평지 보정 허용 경사(비율, 기본 0.01)")
    ap.add_argument("--breakline-attenuation", type=float, default=0.0, help="불연속선 너머 커널 배수(0 = 완전 분리)")
    ap.add_argument("--dirty", help="packages/core recomputeRequest JSON: 그 성분만 다시 풀기")
    ap.add_argument("--previous-residual", help="지난 residual_field.json(--dirty와 함께: dirty 타일만 갱신)")
    ap.add_argument("--previous-derived", help="지난 derived/elevation.json(--dirty와 함께: 안 푼 성분의 값 유지)")
    ap.add_argument("--derived-out", help="derived/elevation.json 경로(--campus 필요)")
    ap.add_argument("--out", required=True)
    # engine v2 (docs/ELEVATION_SOLVER_V2.md). All optional; without them the solver behaves as before.
    env_engine = os.environ.get("CAMPO_ELEVATION_ENGINE") or DEFAULT_ENGINE
    ap.add_argument("--engine", choices=["v1", "v2"], default=env_engine if env_engine in ("v1", "v2") else DEFAULT_ENGINE,
                    help="풀이 엔진(기본 v1, 환경 변수 CAMPO_ELEVATION_ENGINE)")
    ap.add_argument("--legacy", action="store_true", help="--engine v1 의 별칭")
    ap.add_argument("--config", help="v2 설정 JSON(campo-solver-config/1)")
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VALUE", help="v2 설정 한 항목 덮어쓰기(여러 번)")
    ap.add_argument("--buildings", help="v2 건물 기준고·실측 JSON(campo-elevation-buildings/1, 기본 <store 폴더>/buildings.json)")
    a = ap.parse_args(argv)
    if a.legacy:
        a.engine = "v1"
    if a.engine == "v2":
        return _run_v2(a)
    a.sigma_dem = 3.0 if a.sigma_dem is None else a.sigma_dem
    a.soft_flat_max_grade = SOFT_FLAT_MAX_GRADE if a.soft_flat_max_grade is None else a.soft_flat_max_grade
    return _run_v1(a)


def _run_v1(a: argparse.Namespace):
    import time
    import uuid
    from pyproj import Transformer

    grid = Grid.load(a.dem)
    nodes, edges, store = load_store(a.store, grid.crs)
    tf = Transformer.from_crs("EPSG:4326", grid.crs, always_xy=True)
    bl_log: list[str] = []
    breaklines = store_breaklines(store, tf.transform, bl_log)
    cm, soft, scale = None, [], {}
    if a.campus:
        cm = campus_model(read_campus_features(a.campus), tf.transform, a.floor_height_default, a.floor_prior_sigma)
        known = {n.key for n in nodes}
        nodes += [n for n in cm.nodes if n.key not in known]
        drops, off_soft, drop_scale, drop_log = breakline_drop_edges(breaklines, cm)
        edges += cm.edges + drops
        soft = [s for s in cm.soft_flat if s.id not in off_soft]
        scale = {**cm.sigma_dem_scale, **drop_scale}
        breaklines = breaklines + cm.breaklines
        bl_log += drop_log
        for line in cm.log:
            print(line)
    elif any(b.low_side is not None and b.drop_m is not None for b in breaklines):
        bl_log.append("breaklines with lowSide/dropM: height constraints need --campus (side separation only)")
    for line in bl_log:
        print(line)
    restrict = None
    line_boxes: list[tuple[float, float, float, float]] = []
    if a.dirty:
        req = json.loads(Path(a.dirty).read_text(encoding="utf-8"))
        restrict = dirty_seeds(req, cm, [n.key for n in nodes], tf.transform)
        line_boxes = breakline_boxes(req, tf.transform)
    res = solve_heights(nodes, edges, dem=grid, sigma_dem=a.sigma_dem, alpha=a.alpha, huber_k=a.huber_k,
                        soft_flat=soft, soft_flat_max_grade=a.soft_flat_max_grade, sigma_dem_scale=scale, restrict_to=restrict)
    for line in res.log:
        print(line)

    prev_derived = json.loads(Path(a.previous_derived).read_text(encoding="utf-8")) if a.previous_derived else None
    kw = dict(method=a.method, sigma_prior=a.sigma_dem, breaklines=breaklines, breakline_attenuation=a.breakline_attenuation)
    if restrict is not None:
        merged = SolveResult({**previous_results(nodes, store, prev_derived, cm, lambda n: _dem_value(grid, n), res.solved), **res.nodes},
                             res.edges, res.chi2, res.dof, res.global_test_passed, res.components)
        centers = residual_centers(nodes, merged)
    else:
        centers = residual_centers(nodes, res)
    if restrict is not None and a.previous_residual:
        z_prev = Grid.load(a.previous_residual).data
        tiles = dirty_tiles(grid, [c for c in centers if c.key in res.solved])
        # A 고도 단절선 changed: every tile a centre could reach across it is redone, even where no point of the campus is near.
        # (Without any centre, the default influence radius.)
        tiles |= box_tiles(grid, line_boxes, max([c.radius for c in centers], default=30.0))
        z = update_tiles(grid, z_prev, centers, tiles, **kw)
        print(f"residual field: {len(tiles)} dirty tile(s) updated")
    else:
        z = residual_field(grid, centers, **kw)

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    Grid(grid.data + z, grid.origin_x, grid.origin_y, grid.res, grid.crs, grid.vertical_datum).save(
        out / "corrected_dem", source=f"{grid.meta.get('source', '')} + CAMPO residual ({a.method})")
    Grid(z, grid.origin_x, grid.origin_y, grid.res, grid.crs, grid.vertical_datum).save(out / "residual_field")
    run_id, now_ms = str(uuid.uuid4()), int(time.time() * 1000)
    (out / "store.solved.json").write_text(
        json.dumps(write_back(store, res, run_id, now_ms), ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {out}/corrected_dem.(json|bin), residual_field.*, store.solved.json")
    if a.derived_out:
        if cm is None:
            raise SystemExit("--derived-out 에는 --campus 가 필요합니다")
        dp = Path(a.derived_out)
        dp.parent.mkdir(parents=True, exist_ok=True)
        keep = prev_derived if restrict is not None else None  # a full run starts the file over
        dp.write_text(json.dumps(derived_elevation(cm, res, run_id, now_ms, keep), ensure_ascii=False, indent=2) + "\n",
                      encoding="utf-8")
        print(f"wrote {dp}")


# ------------------------------------------------------------------ #
# engine v2: node_wls (stage 1) + grid_grading (stages 2-5), docs/ELEVATION_SOLVER_V2.md
# The v1 code above is frozen; v2 only reuses its readers, campus_model, breakline_drop_edges, dirty_seeds,
# derived_elevation and write_back.
# ------------------------------------------------------------------ #

BUILDINGS_FORMAT = "campo-elevation-buildings/1"
REPORT_FORMAT = "campo-solve-report/1"


def _ascii(line: str) -> str:
    """v2 output is ASCII only: the editor reads UTF-8 while Windows Python writes the pipe in the ANSI code page."""
    line = line.replace("→", "->").replace("χ²", "chi2").replace("≥", ">=").replace("≤", "<=")
    return line.encode("ascii", "backslashreplace").decode("ascii")


def _say(line: str) -> None:
    print(_ascii(line))


def _fail(msg: str, code: int = 2):
    print(_ascii(msg), file=sys.stderr)
    raise SystemExit(code)


def _kind(f: dict) -> Optional[str]:
    return (f.get("properties") or {}).get("kind")


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _num(v) -> Optional[float]:
    return float(v) if _is_number(v) else None


def load_buildings_sidecar(path: Optional[Path], log: list[str]) -> dict:
    """Optional campo-elevation-buildings/1 file (H_1F reference heights, measured building - point differences)."""
    if path is None:
        return {}
    p = Path(path)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as e:
        _fail(f"{p}: cannot read the buildings file ({e})")
    if not isinstance(data, dict) or data.get("format") != BUILDINGS_FORMAT:
        _fail(f"{p}: format is not {BUILDINGS_FORMAT}")
    if not isinstance(data.get("buildings", {}), dict) or not isinstance(data.get("measurements", []), list):
        _fail(f"{p}: 'buildings' must be an object and 'measurements' a list")
    log.append(f"buildings file {p.name}: {len(data.get('buildings') or {})} building(s), "
               f"{len(data.get('measurements') or [])} measurement(s)")
    return data


def edge_polyline(feature: dict, xy_from: tuple[float, float], xy_to: tuple[float, float], project) -> np.ndarray:
    """[from point, inner LineString vertices, to point] in grid CRS (the ends are the node positions)."""
    g = feature.get("geometry") or {}
    coords = g.get("coordinates") if g.get("type") == "LineString" else None
    inner = []
    if isinstance(coords, list) and len(coords) > 2 and project is not None:
        for c in coords[1:-1]:
            if isinstance(c, (list, tuple)) and len(c) >= 2:
                inner.append(project(c[0], c[1]))
    return np.array([xy_from, *inner, xy_to], float)


def _corridor_edge(f: dict, cm: CampusModel, eid: str) -> bool:
    p = f.get("properties") or {}
    if eid not in cm.edge_vars or eid not in cm.edge_xy:
        return False
    if p.get("highway") == "elevator" or p.get("edge_type") == "bridge":
        return False
    va, vb = cm.edge_vars[eid]
    return va.startswith("cn:") or vb.startswith("cn:")


def campus_corridors(features: list[dict], cm: CampusModel, project, heights: dict[str, float]):
    """Corridor segments of the outside edges and portals whose both end heights are known (and not floating)."""
    from grid_grading import Corridors

    xy, z, tr, steps, ids = [], [], [], [], []
    for f in features:
        if _kind(f) != "edge" or not _corridor_edge(f, cm, f["id"]):
            continue
        p, eid = f["properties"], f["id"]
        va, vb = cm.edge_vars[eid]
        ha, hb = heights.get(va), heights.get(vb)
        if ha is None or hb is None or not (math.isfinite(ha) and math.isfinite(hb)):
            continue
        poly = edge_polyline(f, *cm.edge_xy[eid], project)
        seg = np.hypot(*np.diff(poly, axis=0).T)
        total = float(seg.sum())
        frac = np.concatenate([[0.0], np.cumsum(seg)]) / total if total > 0 else np.zeros(len(poly))
        if total > 0:
            frac[-1] = 1.0
        n = p.get("step_count") if p.get("highway") == "steps" else 0
        n = n if isinstance(n, int) and not isinstance(n, bool) and n > 0 else 0
        for k in range(len(poly) - 1):
            xy.append([poly[k], poly[k + 1]])
            z.append([ha + (hb - ha) * frac[k], ha + (hb - ha) * frac[k + 1]])
            tr.append([frac[k], frac[k + 1]])
            steps.append(n)
            ids.append(eid)
    if not ids:
        return Corridors.empty()
    return Corridors(np.array(xy, float), np.array(z, float), np.array(tr, float), np.array(steps, np.int32), tuple(ids))


def building_pads(features: list[dict], project, sidecar: dict, grid: Grid, cm: Optional[CampusModel], cfg,
                  log: list[str], previous: Optional[dict[str, float]] = None):
    """
    Building pads: pad level = sidecar padLevel or min(ground_levels); polygon = sidecar polygon, floor_outlines[level] or
    the building geometry; H_1F^0 = sidecar h1fM ("survey") or the ring DEM (entrance side median, else the percentile).
    Returns (BuildingPad list, building id -> rings in grid CRS).
    """
    from grid_grading import rasterize_polygon, reference_height
    from node_wls import BuildingPad

    sc = (sidecar or {}).get("buildings") or {}
    known = {f["id"] for f in features if _kind(f) == "building"}
    for bid in sorted(set(sc) - known):
        log.append(f"buildings file: unknown building {bid} -> ignored")
    node_feats = [f for f in features if _kind(f) == "node"]
    pads, rings_of = [], {}
    for f in features:
        if _kind(f) != "building":
            continue
        bid, p = f["id"], f.get("properties") or {}
        s = sc.get(bid) or {}
        if p.get("building_type") == "bridge":
            continue
        if s.get("noPad") is True:
            log.append(f"building {bid}: noPad -> no pad")
            continue
        gl = [lv for lv in (p.get("ground_levels") or []) if isinstance(lv, int) and not isinstance(lv, bool) and lv != 0]
        level = s.get("padLevel", min(gl) if gl else None)
        if not isinstance(level, int) or isinstance(level, bool) or level == 0:
            log.append(f"building {bid}: no pad level -> no pad")
            continue
        coords = s.get("polygon") or (p.get("floor_outlines") or {}).get(str(level))
        if not coords:
            g = f.get("geometry") or {}
            coords = g.get("coordinates") if g.get("type") == "Polygon" else None
        rings = []
        for ring in coords or []:
            if not isinstance(ring, list):
                continue
            pts = [project(c[0], c[1]) for c in ring if isinstance(c, (list, tuple)) and len(c) >= 2]
            if len(pts) >= 3:
                rings.append(np.array(pts, float))
        if not rings:
            log.append(f"building {bid}: no polygon with 3 or more points -> no pad")
            continue
        mask = rasterize_polygon(grid, rings)
        if not mask.any():
            log.append(f"building {bid}: polygon covers no grid cell -> no pad")
            continue
        key = f"fp:{bid}:{floor_id_of_level(level)}"
        if _is_number(s.get("h1fM")):
            h_ref, src = float(s["h1fM"]), "survey"
        else:
            ents = [project(*nf["geometry"]["coordinates"][:2]) for nf in node_feats
                    if (nf.get("properties") or {}).get("building_id") == bid and nf["properties"].get("level") == level
                    and nf["properties"].get("node_type") == "entrance"]
            ref = reference_height(grid, mask, np.array(ents, float).reshape(-1, 2), cfg.building)
            if ref is None:
                log.append(f"building {bid}: no DEM on the pad ring -> no pad")
                continue
            h_ref, src = ref
        lower = h_ref
        if cfg.building.ratchet and previous and _is_number(previous.get(key)):
            lower = max(h_ref, float(previous[key]))
        pads.append(BuildingPad(bid, key, h_ref, src, lower))
        rings_of[bid] = tuple(rings)
    return pads, rings_of


def wls_problem(nodes: list[Node], edges: list[Edge], cm: Optional[CampusModel], features: list[dict],
                soft: list[SoftFlat], scale: dict[str, float], pads, sidecar: dict, cfg, log: list[str], project=None):
    """v1 structures -> node_wls.WlsProblem (stairs and ramps rebuilt from the campus features)."""
    from node_wls import BuildingMeasurement, DiffRow, FlatLink, HeightVar, Ramp, SoftFlatCand, Stair, WlsProblem

    keyset = {n.key for n in nodes}
    efeat = {f["id"]: f for f in features if _kind(f) == "edge"}
    nfeat = {f["id"]: f for f in features if _kind(f) == "node"}
    level_of = {nid: int(f["properties"]["level"]) for nid, f in nfeat.items()
                if f["properties"].get("building_id") is not None and f["properties"].get("level") is not None}
    stairs, ramps = [], []
    if cm is not None:
        for eid, f in efeat.items():
            p = f["properties"]
            if eid not in cm.edge_vars:
                continue
            va, vb = cm.edge_vars[eid]
            if va == vb:
                continue
            hw = p.get("highway")
            if hw == "steps":
                n = p.get("step_count")
                if not (isinstance(n, int) and not isinstance(n, bool) and n > 0) or p.get("conveying") is not None:
                    continue
                sign = {"up": 1, "down": -1}.get(p.get("incline"))
                fa, fb = p.get("from"), p.get("to")
                if sign is None and fa in level_of and fb in level_of and level_of[fa] != level_of[fb]:
                    sign = 1 if level_of[fb] > level_of[fa] else -1
                stairs.append(Stair(f"stair:{eid}", va, vb, n, sign))
            elif hw == "ramp":
                poly = edge_polyline(f, *cm.edge_xy[eid], project)
                length = float(np.hypot(*np.diff(poly, axis=0).T).sum())
                g = cfg.wls.ramp_gmax_accessible if p.get("step_free") is True else cfg.wls.ramp_gmax_general
                ramps.append(Ramp(f"ramp:{eid}", va, vb, length, g))
    stair_edges = {s.id[len("stair:"):] for s in stairs}
    rows, flats = [], []
    for e in edges:
        if e.kind in (MEASURED, "floor_prior"):
            rows.append(DiffRow(e.id, e.frm, e.to, e.dh, e.sigma, e.kind, e.off_from, e.off_to, e.qc))
        elif e.kind == "breakline_drop":
            if any(e.id.endswith(":" + s) for s in stair_edges):
                log.append(f"{e.id}: the edge is a stair -> stair kept")
                continue
            rows.append(DiffRow(e.id, e.frm, e.to, e.dh, e.sigma, "breakline_drop", e.off_from, e.off_to, e.qc))
        elif e.kind == "flat_exact":
            eid = e.id[len("flat_exact:"):]
            f = efeat.get(eid)
            xy = None
            if f is not None and cm is not None and _corridor_edge(f, cm, eid):
                xy = edge_polyline(f, *cm.edge_xy[eid], project)
            flats.append(FlatLink(e.id, e.frm, e.to, xy))
        # step_count rows are rebuilt as Stair above
    touch: dict[str, set] = {}
    if cm is not None:
        for eid, (va, vb) in cm.edge_vars.items():
            hw = (efeat.get(eid, {}).get("properties") or {}).get("highway")
            for v in (va, vb):
                if v.startswith("cn:"):
                    touch.setdefault(v, set()).add(hw)
    only = {v for v, hs in touch.items() if hs and hs <= {"steps", "ramp"}}
    padded = {p.building_id for p in pads}
    meas = []
    for m in (sidecar or {}).get("measurements") or []:
        if not isinstance(m, dict):
            continue
        mid, bid, pt, d = m.get("id"), m.get("buildingId"), m.get("point") or {}, m.get("buildingMinusPointM")
        key = None
        if isinstance(pt, dict) and "campusNode" in pt and cm is not None:
            key = cm.var_of.get(pt["campusNode"])
        elif isinstance(pt, dict):
            key = pt.get("heightNode")
        if not isinstance(mid, str) or bid not in padded or key not in keyset or not _is_number(d):
            log.append(f"building measurement {mid}: unknown building pad or point, or no height -> ignored")
            continue
        sig = m.get("sigmaM")
        meas.append(BuildingMeasurement(mid, bid, key, float(d), float(sig) if _is_number(sig) and sig > 0 else None))
    return WlsProblem([HeightVar(n.key, n.kind, n.x, n.y) for n in nodes], rows, flats,
                      [SoftFlatCand(s.id, s.frm, s.to, s.length) for s in soft], stairs, ramps, list(pads), meas,
                      dict(scale), only)


def to_solve_result(w, solved: set[str], nodes: Optional[list[Node]] = None,
                    dem_value: Optional[Callable[[Node], Optional[float]]] = None) -> SolveResult:
    """node_wls.WlsResult -> v1 SolveResult (so write_back and derived_elevation work unchanged)."""
    by = {n.key: n for n in nodes or []}
    out = {}
    for k, h in w.h.items():
        d = dem_value(by[k]) if dem_value is not None and k in by else None
        out[k] = NodeResult(k, h, w.sigma[k], w.floating[k], d, None if d is None else h - d, w.sigma_rel[k])
    edges = {k: EdgeReport(r.id, r.residual_m, r.w_test, r.redundancy, r.robust_weight, r.qc) for k, r in w.rows.items()}
    return SolveResult(out, edges, w.chi2, w.dof, w.global_test_passed, w.components, list(w.log), w.soft_flat, w.cov,
                       w.comp_of, set(solved))


def resolve_config(a: argparse.Namespace):
    """defaults -> <store folder>/solver_config.json -> --config -> --set -> explicit --sigma-dem / --soft-flat-max-grade."""
    from solver_config import SolverConfig, load_config, parse_set_args, validate, with_overrides

    try:
        cfg = SolverConfig()
        auto = Path(a.store).parent / "solver_config.json"
        if auto.exists():
            cfg = load_config(auto, cfg)
        if a.config:
            cfg = load_config(a.config, cfg)
        if a.set:
            cfg = with_overrides(cfg, parse_set_args(a.set))
        legacy = {}
        if a.sigma_dem is not None:
            legacy["wls.sigma_dem_m"] = a.sigma_dem
        if a.soft_flat_max_grade is not None:
            legacy["wls.soft_flat_max_grade"] = a.soft_flat_max_grade
        if legacy:
            cfg = with_overrides(cfg, legacy)
    except (ValueError, OSError) as e:
        _fail(f"solver config: {e}")
    errs = validate(cfg)
    if errs:
        _fail("solver config: " + "; ".join(errs))
    return cfg


def solve_report(cfg, w, g, buildings: dict[str, dict], run_id: str, timings: dict[str, float]) -> dict:
    from solver_config import config_to_dict

    conf = config_to_dict(cfg)
    conf.pop("format", None)
    counts = {"road_cells", "pad_cells", "apron_cells", "island_cells", "mid_cells", "shoulder_unknowns", "cg_iterations",
              "cg_converged", "vertical_steps_over_limit"}
    grid_stats = {k: (int(v) if k in counts else _num(v)) for k, v in g.stats.items()}
    b_out = {}
    for bid, b in sorted(w.buildings.items()):
        extra = buildings.get(bid, {})
        b_out[bid] = {"h_1f_m": _num(b.h), "h_1f_ref_m": _num(b.h_ref), "ref_source": b.ref_source,
                      "lower_bound_m": _num(b.lower_bound), "lower_bound_active": bool(b.lower_bound_active),
                      "sigma_b_m": _num(b.sigma_b), "up_share": _num(b.up_share),
                      "buried_ref_m2": _num(extra.get("buried_ref_m2")), "buried_m2": _num(extra.get("buried_m2")),
                      "measurement_residuals_m": {k: _num(v) for k, v in sorted(b.measurement_residuals.items())}}
    return {
        "format": REPORT_FORMAT, "engine": ENGINE_V2, "runId": run_id, "config": conf,
        "timings": {k: _num(v) for k, v in timings.items()},
        "grid": grid_stats,
        "buildings": b_out,
        "stairs": {sid.split(":", 1)[1]: {"riser_m": _num(s.riser_m), "sign": int(s.sign), "direction_source": s.direction_source}
                   for sid, s in sorted(w.stairs.items())},
        "ramps_capped": [rid.split(":", 1)[1] for rid in w.ramps_capped],
        "outliers": [{"id": o.id, "kind": o.kind, "residual_m": _num(o.residual_m), "sigma_m": _num(o.sigma_m),
                      "ratio": _num(o.ratio)} for o in w.outliers],
        "log": [_ascii(line) for line in g.log],
    }


def _run_v2(a: argparse.Namespace):
    import time
    import uuid

    from pyproj import Transformer

    from grid_grading import Corridors, Pad, SoftPoint, buried_area, corridor_dem_values, effective_half_width, grade_grid
    from grid_grading import pad_ring, rasterize_polygon
    from node_wls import solve_nodes

    t_start = time.perf_counter()
    cfg = resolve_config(a)
    grid = Grid.load(a.dem)
    nodes, edges, store = load_store(a.store, grid.crs)
    tf = Transformer.from_crs("EPSG:4326", grid.crs, always_xy=True)
    bl_log: list[str] = []
    breaklines = store_breaklines(store, tf.transform, bl_log)
    drawn = list(breaklines)
    cm, soft, drop_scale, features = None, [], {}, []
    if a.campus:
        features = read_campus_features(a.campus)
        cm = campus_model(features, tf.transform, a.floor_height_default, a.floor_prior_sigma)
        known = {n.key for n in nodes}
        nodes += [n for n in cm.nodes if n.key not in known]
        drops, off_soft, drop_scale, drop_log = breakline_drop_edges(breaklines, cm)
        edges += cm.edges + drops
        soft = [s for s in cm.soft_flat if s.id not in off_soft]
        bl_log += drop_log
        for line in cm.log:
            _say(line)
    elif any(b.low_side is not None and b.drop_m is not None for b in breaklines):
        bl_log.append("breaklines with lowSide/dropM: height constraints need --campus (side separation only)")
    for line in bl_log:
        _say(line)
    if a.method != "fusion":
        _say("--method is not used by engine v2")
    if a.previous_residual:
        _say("v2 recomputes the grid in full (--previous-residual is not read)")

    log: list[str] = []
    if a.buildings:
        sidecar = load_buildings_sidecar(Path(a.buildings), log)
    else:
        auto = Path(a.store).parent / "buildings.json"
        sidecar = load_buildings_sidecar(auto, log) if auto.exists() else {}
    previous_h = {e["key"]: e.get("hM") for e in store.get("estimates", []) or [] if isinstance(e, dict) and "key" in e}
    pads, rings_of = (building_pads(features, tf.transform, sidecar, grid, cm, cfg, log, previous_h)
                      if cm is not None else ([], {}))
    keys = {n.key for n in nodes}
    for p in pads:
        if p.var not in keys:
            nodes.append(Node(p.var, "floor_plane"))
            keys.add(p.var)
    problem = wls_problem(nodes, edges, cm, features, soft, drop_scale, pads, sidecar, cfg, log, project=tf.transform)
    for line in log:
        _say(line)

    hw = effective_half_width(cfg.raster, grid.res)
    t0 = time.perf_counter()
    w = solve_nodes(problem, cfg.wls, cfg.building, dem_at=lambda x, y: float(grid.sample_bilinear(x, y)[0]),
                    corridor_dem=lambda xy: corridor_dem_values(grid, xy, hw), cell_area_m2=grid.res ** 2,
                    alpha=a.alpha, huber_k=a.huber_k)
    t_wls = time.perf_counter() - t0
    for line in w.log:
        _say(line)

    prev_derived = json.loads(Path(a.previous_derived).read_text(encoding="utf-8")) if a.previous_derived else None
    all_keys = set(w.h)
    solved, partial = all_keys, False
    if a.dirty:
        req = json.loads(Path(a.dirty).read_text(encoding="utf-8"))
        if prev_derived is not None and prev_derived.get("engine") == ENGINE_V2:
            seeds = dirty_seeds(req, cm, [n.key for n in nodes], tf.transform)
            solved = {k for comp in w.components if seeds.intersection(comp) for k in comp}
            partial = True
        else:
            _say("previous derived elevation is not from engine v2 -> every component is written")
    res = to_solve_result(w, solved, nodes, lambda n: _dem_value(grid, n))

    heights = {k: h for k, h in w.h.items() if not w.floating[k]}
    corr = campus_corridors(features, cm, tf.transform, heights) if cm is not None else Corridors.empty()
    pad_list = [Pad(p.building_id, rings_of[p.building_id], w.h[p.var]) for p in pads if p.var in w.h]
    points = [SoftPoint(n.x, n.y, w.h[n.key], n.influence_r) for n in nodes
              if n.key.startswith("op:") and n.kind == "outdoor_point" and n.x is not None and n.key in w.h
              and not w.floating[n.key]]
    segs = [np.array([p0, p1], float) for bl in drawn for p0, p1 in zip(bl.coords[:-1], bl.coords[1:])]
    g = grade_grid(grid, corr, pad_list, cfg, breaklines=np.array(segs).reshape(-1, 2, 2) if segs else None,
                   breakline_attenuation=a.breakline_attenuation, soft_points=points)
    for line in g.log:
        _say(line)
    b_extra = {}
    for p in pads:
        mask = rasterize_polygon(grid, rings_of[p.building_id])
        ring = pad_ring(mask)
        b_extra[p.building_id] = {"buried_ref_m2": buried_area(grid.data, ring, p.h_ref, grid.res),
                                  "buried_m2": buried_area(grid.data, ring, w.h[p.var], grid.res)}

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    Grid(g.h, grid.origin_x, grid.origin_y, grid.res, grid.crs, grid.vertical_datum).save(
        out / "corrected_dem", source=f"{grid.meta.get('source', '')} + CAMPO grading (v2)")
    Grid(g.residual, grid.origin_x, grid.origin_y, grid.res, grid.crs, grid.vertical_datum).save(out / "residual_field")
    run_id, now_ms = str(uuid.uuid4()), int(time.time() * 1000)
    (out / "store.solved.json").write_text(
        json.dumps(write_back(store, res, run_id, now_ms), ensure_ascii=False, indent=2), encoding="utf-8")
    timings = {"wls": t_wls, **g.timings, "run": time.perf_counter() - t_start}
    (out / "solve_report.json").write_text(json.dumps(solve_report(cfg, w, g, b_extra, run_id, timings), indent=2) + "\n",
                                           encoding="utf-8")
    _say(f"grid: {int(g.stats['road_cells'])} road, {int(g.stats['pad_cells'])} pad, {int(g.stats['island_cells'])} island, "
         f"{int(g.stats['shoulder_unknowns'])} shoulder cells, CG {int(g.stats['cg_iterations'])} iteration(s), "
         f"{g.timings['total']:.2f} s")
    _say(f"wrote {out}/corrected_dem.(json|bin), residual_field.*, store.solved.json, solve_report.json")
    if a.derived_out:
        if cm is None:
            _fail("--derived-out needs --campus", 1)
        dp = Path(a.derived_out)
        dp.parent.mkdir(parents=True, exist_ok=True)
        d = derived_elevation(cm, res, run_id, now_ms, prev_derived if partial else None)
        for v in d["edges"].values():
            v["elev_sigma_m"] = max(v["elev_sigma_m"], 0.01)
        d["engine"] = ENGINE_V2
        dp.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        _say(f"wrote {dp}")


if __name__ == "__main__":
    main()
