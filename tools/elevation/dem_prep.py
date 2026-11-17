"""
CAMPO DEM 전처리 — 국토지리정보원 자료 → 캠퍼스 클립 → COG + campo-grid(앱/백엔드 샘플링용)

두 가지 입력 경로
  A) raster   : 국토정보플랫폼 '공개DEM'(.img, 90 m) 또는 보안심사로 받은 5 m/1 m DEM(.img/.tif)
  B) contours : 1:5,000 수치지형도 v2.0(SHP)의 등고선(N3L_F0010000, 5 m 간격) + 표고점(N3P_F0020000)
                → 선형 TIN 보간으로 1 m 격자 생성 (공개 90 m DEM보다 국소 지형을 훨씬 잘 담음)
                --fallback-raster는 TIN이 닿지 않는 칸(등고선·표고점 점들의 볼록 껍질 바깥)만 90 m DEM으로 채운다.
                껍질 안의 등고선 빈 구역(도심 건물 밀집지)은 TIN이 선형 보간한 값을 그대로 둔다

높이 기준: NGII DEM·수치지형도 높이는 국가 수직기준(인천만 평균해수면) 정표고.
           GNSS/스마트폰 GPS 고도(타원체고)와 섞지 말 것. 필요하면 H = h − N (KNGeoid24 등).
           CAMPO는 Δh(상대)만 쓰고 절대 기준을 이 DEM에서 가져오므로, 지오이드 보정은 필요 없다.

예시
  # A) 공개 DEM 2도엽 병합 → 한양대 서울캠퍼스 경계로 자르기 → 1 m
  python dem_prep.py raster --src 37612.img 37613.img --boundary campus.geojson \
      --res 1.0 --out out/hy_seoul_dem

  # B) 수치지형도 등고선 + 표고점 → 1 m TIN, 빈 곳은 90 m DEM으로
  python dem_prep.py contours --contours */N3L_F0010000.shp --spots */N3P_F0020000.shp \
      --boundary campus.geojson --fallback-raster 37612.img --res 1.0 --out out/hy_seoul_tin

  # C) 폴더 하나만: 하위 폴더에서 등고선·표고점·DEM을 재귀 탐색, 영역과 겹치는 도엽만 자동 선택해 합침
  python dem_prep.py ngii --ngii-dir ~/Downloads/ngii-hanyang --bbox 127.0386 37.5520 127.0537 37.5619 \
      --res 1.0 --out derived/hanyang-seoul/dem

  # 샘플링 확인
  python dem_prep.py sample --grid out/hy_seoul_dem.json --lonlat 127.0450 37.5570

경계 대신 --bbox lon_min lat_min lon_max lat_max 도 가능.
의존성: rasterio, pyproj, numpy, scipy, (contours 모드) geopandas, shapely
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
from pathlib import Path

import numpy as np
import rasterio
import rasterio.shutil
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.features import geometry_mask
from rasterio.merge import merge
from rasterio.transform import from_origin
from rasterio.warp import reproject, transform_geom

sys.path.insert(0, str(Path(__file__).parent))
from campo_grid import Grid  # noqa: E402

DST_CRS_DEFAULT = "EPSG:5186"  # GRS80 중부원점(경기·서울) TM — 국내 1:5,000 수치지형도 계열과 동일 계열
NODATA = -9999.0
Z_FIELD_CANDIDATES = ["등고수치", "표고수치", "CONT", "CONT_VAL", "HEIGHT", "ELEV", "ELEVATION", "Z", "NUME", "HGT"]


# ------------------------------------------------------------------ #
# 공통: 영역(경계) 처리
# ------------------------------------------------------------------ #

def load_boundary(path: str | None, bbox: list[float] | None, dst_crs: str) -> dict:
    """GeoJSON(기본 EPSG:4326) 또는 bbox → 목표 CRS의 단일 geometry(dict)."""
    if path:
        gj = json.loads(Path(path).read_text(encoding="utf-8"))
        src_crs = "EPSG:4326"
        if gj.get("crs", {}).get("properties", {}).get("name"):
            src_crs = gj["crs"]["properties"]["name"]
        geoms = []
        feats = gj["features"] if gj.get("type") == "FeatureCollection" else [gj if gj.get("type") == "Feature" else {"geometry": gj}]
        for f in feats:
            geoms.append(f["geometry"])
        if len(geoms) == 1:
            geom = geoms[0]
        else:
            polys = []
            for g in geoms:
                polys += [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
            geom = {"type": "MultiPolygon", "coordinates": polys}
        return transform_geom(src_crs, dst_crs, geom)
    if bbox:
        x0, y0, x1, y1 = bbox
        ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
        return transform_geom("EPSG:4326", dst_crs, {"type": "Polygon", "coordinates": [ring]})
    raise SystemExit("--boundary 또는 --bbox 가 필요합니다")


def geom_bounds(geom: dict) -> tuple[float, float, float, float]:
    xs, ys = [], []

    def walk(c):
        if isinstance(c[0], (int, float)):
            xs.append(c[0]); ys.append(c[1])
        else:
            for cc in c:
                walk(cc)

    walk(geom["coordinates"])
    return min(xs), min(ys), max(xs), max(ys)


EDITOR_CRS = "EPSG:5186"  # packages/editor/server/terrain.ts and model/terrain3d.ts convert this CRS only


def check_dst_crs(dst_crs: str) -> None:
    """
    Output CRS contract: a projected CRS in metres (the grid cell size, --res and --buffer are metres, and the solver
    measures distances on the grid). EPSG:5186 is the default and the only one the editor's 지형 3D reads; another
    projected CRS still works for the solver (it projects WGS84 into the grid's CRS), so it is a warning, not an error.
    """
    crs = CRS.from_user_input(dst_crs)
    unit = (crs.linear_units or "").lower()
    if not crs.is_projected or unit not in ("metre", "meter", "m"):
        raise SystemExit(f"--dst-crs {dst_crs}는 미터 단위 투영 좌표계가 아닙니다(단위: {crs.linear_units or '도'}). "
                         f"격자 크기(--res)와 여유(--buffer)가 미터라 투영 좌표계가 필요합니다. 기본값 {EDITOR_CRS}를 쓰세요")
    if crs != CRS.from_user_input(EDITOR_CRS):
        print(f"경고: 출력 좌표계가 {crs.to_string()}입니다. 고도 솔버는 이 좌표계로도 풀지만, 편집기의 지형 3D는 "
              f"{EDITOR_CRS} 격자만 읽습니다(편집기에서 쓰려면 --dst-crs {EDITOR_CRS}로 다시 만드세요).")


def target_grid(geom: dict, res: float, buffer_m: float):
    """해상도 배수에 정렬(snap)된 목표 격자 — 재처리해도 셀 경계가 흔들리지 않게."""
    x0, y0, x1, y1 = geom_bounds(geom)
    x0 = math.floor((x0 - buffer_m) / res) * res
    y0 = math.floor((y0 - buffer_m) / res) * res
    x1 = math.ceil((x1 + buffer_m) / res) * res
    y1 = math.ceil((y1 + buffer_m) / res) * res
    w, h = int(round((x1 - x0) / res)), int(round((y1 - y0) / res))
    return from_origin(x0, y1, res, res), w, h


def boundary_mask(geom: dict, transform, w: int, h: int, buffer_m: float, res: float) -> np.ndarray:
    """True = 경계(+버퍼) 바깥. 버퍼는 셀 단위 팽창으로 근사."""
    outside = geometry_mask([geom], out_shape=(h, w), transform=transform, invert=False)
    k = int(math.ceil(buffer_m / res))
    if k > 0:
        from scipy.ndimage import binary_dilation
        inside = binary_dilation(~outside, iterations=k)
        outside = ~inside
    return outside


# ------------------------------------------------------------------ #
# A) raster
# ------------------------------------------------------------------ #

def read_merged(srcs: list[str], src_crs: str | None):
    """
    Merge DEM sheets into one array (NaN = no data).
    - nodata: rasterio.merge reads every sheet masked by that sheet's own nodata, so sheets with other nodata values
      (-9999, 0, -32767 …) all end up NaN; the output fill is masked below, and so are values no ground has.
    - CRS: without --src-crs every sheet must carry the same CRS (merge does not reproject). With --src-crs every sheet is
      read as being in that CRS (a warped view with no reprojection), and each sheet whose own CRS said otherwise is named,
      so a wrong override does not go unnoticed.
    """
    from rasterio.vrt import WarpedVRT

    dss = [rasterio.open(s) for s in srcs]
    views = []
    try:
        if src_crs:
            crs = CRS.from_user_input(src_crs)
            for s, d in zip(srcs, dss):
                if d.crs is not None and d.crs != crs:
                    print(f"경고: {s}의 좌표계 {d.crs.to_string()}를 --src-crs {crs.to_string()}로 덮어씁니다 "
                          "(정말 그 좌표계의 자료인지 확인하세요)")
            views = [WarpedVRT(d, src_crs=crs, crs=crs, transform=d.transform, width=d.width, height=d.height,
                               nodata=d.nodata, resampling=Resampling.nearest) for d in dss]
            sources = views
        else:
            crs = dss[0].crs
            if crs is None:
                raise SystemExit(f"{srcs[0]}에 좌표계 정보가 없습니다. --src-crs EPSG:5186(또는 5179/5174 등)을 지정하세요")
            for s, d in zip(srcs[1:], dss[1:]):
                if d.crs != crs:
                    got = d.crs.to_string() if d.crs is not None else "없음"
                    raise SystemExit(f"입력 도엽 간 좌표계가 다릅니다: {srcs[0]}은(는) {crs.to_string()}, {s}은(는) {got}. "
                                     "먼저 한 좌표계로 통일하거나, 모두 같은 좌표계 자료라면 --src-crs로 지정하세요")
            sources = dss
        nod = dss[0].nodata
        fill = nod if nod is not None else NODATA
        arr, tr = merge(sources, nodata=fill)
        a = arr[0].astype("float64")
        a[a == fill] = np.nan
        # NGII 자료에 흔한 결측 표기(-9999, -99999 등)와 비현실적 값 정리
        a[(a < -500) | (a > 9000)] = np.nan
        return a, tr, crs, dss[0].res
    finally:
        for v in views:
            v.close()
        for d in dss:
            d.close()


def resample_to(a, src_tr, src_crs, dst_tr, dst_crs, w, h, method: str) -> np.ndarray:
    dst = np.full((h, w), np.nan)
    reproject(source=a, destination=dst, src_transform=src_tr, src_crs=src_crs,
              src_nodata=np.nan, dst_transform=dst_tr, dst_crs=CRS.from_user_input(dst_crs),
              dst_nodata=np.nan, resampling=getattr(Resampling, method))
    return dst


def cmd_raster(a):
    geom = load_boundary(a.boundary, a.bbox, a.dst_crs)
    tr, w, h = target_grid(geom, a.res, a.buffer)
    src, src_tr, src_crs, src_res = read_merged(a.src, a.src_crs)
    print(f"source: {len(a.src)} file(s), crs={src_crs.to_string()}, res={src_res}")
    if a.res < min(src_res) / 2:
        print(f"note: {min(src_res):.0f} m → {a.res} m 업샘플링은 보간일 뿐 새 지형 정보를 만들지 않습니다(2단계 잔차장이 그 역할)")
    dst = resample_to(src, src_tr, src_crs, tr, a.dst_crs, w, h, a.resampling)
    finish(a, dst, tr, w, h, geom, source=f"NGII raster DEM {','.join(Path(s).name for s in a.src)}")


# ------------------------------------------------------------------ #
# B) contours (+ spot heights) → TIN
# ------------------------------------------------------------------ #

def pd_is_numeric(series) -> bool:
    from pandas.api.types import is_numeric_dtype
    return bool(is_numeric_dtype(series))


def _geometry_z_is_height(gdf) -> bool:
    """Geometry Z counts as a height only when some vertex has a non-zero, finite Z (2D data saved as PolylineZ is all 0)."""
    from shapely import get_coordinates
    if not gdf.geometry.has_z.any():
        return False
    z = get_coordinates(gdf.geometry.values, include_z=True)[:, 2]
    z = z[np.isfinite(z)]
    return bool(z.size) and bool((z != 0).any())


def pick_z_field(gdf, forced: str | None) -> str | None:
    """
    The height column (None = the geometry's Z). By name only: --z-field, else a known NGII / common name, else a geometry
    Z that is not all 0. A numeric column with some other name is never taken on a guess: OBJECTID, lengths or codes fall
    in any plausible height range and would make a TIN of row numbers. The error names such columns for --z-field.
    """
    if forced:
        if forced not in gdf.columns:
            raise SystemExit(f"--z-field {forced} 없음. 열 목록: {list(gdf.columns)}")
        return forced
    for c in Z_FIELD_CANDIDATES:
        if c in gdf.columns:
            return c
    if _geometry_z_is_height(gdf):
        return None  # geometry Z 사용
    num = [c for c in gdf.columns if c != "geometry" and pd_is_numeric(gdf[c])]
    plausible = [c for c in num if gdf[c].notna().any() and -50 <= gdf[c].min() and gdf[c].max() <= 9000 and gdf[c].nunique() > 1]
    hint = (f" 높이일 수 있는 숫자 열: {plausible} — 맞는 열을 --z-field <열 이름>으로 지정하세요." if plausible
            else " 숫자 열이 없습니다(도형 Z도 없거나 모두 0).")
    raise SystemExit(f"높이 필드를 이름으로 찾지 못했습니다(찾는 이름: {Z_FIELD_CANDIDATES}).{hint} "
                     f"--z-field 로 지정하세요. 열 목록: {[c for c in gdf.columns if c != 'geometry']}")


def read_xyz(paths: list[str], dst_crs: str, encoding: str, z_field: str | None, densify_m: float,
             keep_zero: bool = False) -> np.ndarray:
    """
    Contour / spot vertices as (x, y, z) in dst_crs. z = 0 is left out unless keep_zero: on NGII sheets an unfilled
    등고수치/표고수치 reads 0, and inland a 0 m contour digs a trench through the TIN. A coastal campus whose 0 m contour
    is real passes --keep-zero.
    """
    import geopandas as gpd
    from shapely import get_coordinates, segmentize

    pts = []
    zero = 0
    for p in paths:
        g = gpd.read_file(p, encoding=encoding)
        if g.crs is None:
            raise SystemExit(f"{p}: .prj 없음 — 수치지형도 도엽 좌표계를 확인해 --src-crs 대신 .prj를 넣어 주세요")
        g = g.to_crs(dst_crs)
        zf = pick_z_field(g, z_field)
        for geom, z in zip(g.geometry, (g[zf] if zf else [None] * len(g))):
            if geom is None or geom.is_empty:
                continue
            if geom.geom_type in ("LineString", "MultiLineString") and densify_m > 0:
                geom = segmentize(geom, densify_m)
            xyz = get_coordinates(geom, include_z=zf is None)
            if zf is None:
                ok = np.isfinite(xyz[:, 2])
                if not keep_zero:
                    zero += int((ok & (xyz[:, 2] == 0)).sum())
                    ok &= xyz[:, 2] != 0
                pts.append(xyz[ok])
            elif z is not None and np.isfinite(z):
                if float(z) == 0 and not keep_zero:
                    zero += len(xyz)
                    continue
                pts.append(np.column_stack([xyz[:, :2], np.full(len(xyz), float(z))]))
    if zero:
        print(f"note: 높이 0 m 정점 {zero:,}개를 뺐습니다(빈 등고수치/표고수치로 봄). 실제 0 m 등고선이면 --keep-zero")
    pts = [q for q in pts if len(q)]
    if not pts:
        raise SystemExit("등고선/표고점에서 좌표를 하나도 읽지 못했습니다")
    xyz = np.vstack(pts)
    # 같은 좌표 중복 제거(도엽 경계)
    _, ui = np.unique(np.round(xyz[:, :2], 2), axis=0, return_index=True)
    return xyz[np.sort(ui)]


def cmd_contours(a):
    cmd_contours_core(a)


def cmd_contours_core(a, label: str = "NGII 1:5000 contours/spots TIN"):
    from scipy.interpolate import griddata

    geom = load_boundary(a.boundary, a.bbox, a.dst_crs)
    tr, w, h = target_grid(geom, a.res, a.buffer)
    xyz = read_xyz(a.contours + (a.spots or []), a.dst_crs, a.encoding, a.z_field, a.densify, getattr(a, "keep_zero", False))
    # 경계 + 넉넉한 여유(보간 안정용)만 사용
    x0, y1 = tr.c, tr.f
    x1, y0 = x0 + w * a.res, y1 - h * a.res
    m = 200.0
    sel = (xyz[:, 0] > x0 - m) & (xyz[:, 0] < x1 + m) & (xyz[:, 1] > y0 - m) & (xyz[:, 1] < y1 + m)
    xyz = xyz[sel]
    print(f"TIN points: {len(xyz):,}")
    if len(xyz) < 3:
        raise SystemExit("영역 안에 등고선/표고점이 너무 적습니다(도심은 등고선이 끊긴 경우가 많음 → --fallback-raster)")
    xs = x0 + (np.arange(w) + 0.5) * a.res
    ys = y1 - (np.arange(h) + 0.5) * a.res
    X, Y = np.meshgrid(xs, ys)
    dst = griddata(xyz[:, :2], xyz[:, 2], (X, Y), method="linear")  # Delaunay 선형 = TIN
    holes = ~np.isfinite(dst)
    if holes.any() and a.fallback_raster:
        src, src_tr, src_crs, _ = read_merged(a.fallback_raster, a.src_crs)
        fb = resample_to(src, src_tr, src_crs, tr, a.dst_crs, w, h, "bilinear")
        dst = np.where(holes, fb, dst)
        print(f"fallback raster filled {int(holes.sum() - (~np.isfinite(dst)).sum()):,} cells")
    # The fallback fills only cells the TIN leaves empty (outside the hull of the contour/spot points). Inside the hull the
    # TIN interpolates across gaps between contours, which on a gentle slope can be 200 m wide and still right, so a gap
    # is not replaced by the coarse DEM. Cells that stay empty inside the boundary are counted here, even below the 5 %
    # of warn_low_coverage, because the solver and the 3D view get no ground there.
    left = ~np.isfinite(dst) & ~boundary_mask(geom, tr, w, h, 0.0, a.res)
    if left.any():
        fix = "fallback DEM도 덮지 않는 곳입니다" if a.fallback_raster else "--fallback-raster로 DEM을 주면 채웁니다"
        print(f"note: 경계 안 남은 빈 칸 {int(left.sum()):,}개(등고선·표고점 TIN 바깥) — {fix}")
    finish(a, dst, tr, w, h, geom, source=f"{label} ({len(xyz)} pts)")



# ------------------------------------------------------------------ #
# C) ngii-dir: 폴더 재귀 탐색 + 영역과 겹치는 파일만 자동 선택
# ------------------------------------------------------------------ #

CONTOUR_NAME = "n3l_f0010000.shp"
SPOT_NAME = "n3p_f0020000.shp"
RASTER_EXTS = {".img", ".tif", ".tiff"}
MIN_VALID_RATIO = 0.95


def discover_ngii(root: Path) -> dict[str, list[Path]]:
    """root 하위를 재귀 탐색(대소문자 무시). 키: contours / spots / rasters."""
    found: dict[str, list[Path]] = {"contours": [], "spots": [], "rasters": []}
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        n = p.name.lower()
        if n == CONTOUR_NAME:
            found["contours"].append(p)
        elif n == SPOT_NAME:
            found["spots"].append(p)
        elif p.suffix.lower() in RASTER_EXTS:
            found["rasters"].append(p)
    return found


def file_bounds(path: Path, kind: str, dst_crs: str, src_crs: str | None = None):
    """파일 경계를 목표 CRS (xmin, ymin, xmax, ymax)로. 읽을 수 없거나 비어 있으면 (None, 이유)."""
    from rasterio.warp import transform_bounds
    try:
        if kind == "raster":
            with rasterio.open(path) as ds:
                crs = CRS.from_user_input(src_crs) if src_crs else ds.crs
                if crs is None:
                    return None, "좌표계 없음(--src-crs 필요)"
                b = tuple(ds.bounds)
        else:
            import pyogrio
            info = pyogrio.read_info(path)
            if not info.get("crs"):
                return None, ".prj(좌표계) 없음"
            crs = CRS.from_user_input(info["crs"])
            tb = info.get("total_bounds")
            if tb is None or not all(math.isfinite(v) for v in tb):
                return None, "도형이 없음(빈 파일)"
            b = tuple(tb)
        return tuple(transform_bounds(crs, CRS.from_user_input(dst_crs), *b)), None
    except Exception as e:  # 깨진 파일 하나가 전체를 막지 않게
        return None, f"읽기 실패: {e}"


def bounds_overlap(a, b) -> bool:
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def select_overlapping(found: dict[str, list[Path]], request, dst_crs: str, src_crs: str | None = None):
    """request = 목표 CRS의 (xmin, ymin, xmax, ymax). 반환: (선택, 제외[(경로, 이유)])."""
    chosen: dict[str, list[Path]] = {k: [] for k in found}
    skipped: list[tuple[Path, str]] = []
    kinds = {"contours": "vector", "spots": "vector", "rasters": "raster"}
    for key, paths in found.items():
        for p in paths:
            b, why = file_bounds(p, kinds[key], dst_crs, src_crs)
            if b is None:
                skipped.append((p, why))
            elif bounds_overlap(b, request):
                chosen[key].append(p)
            else:
                skipped.append((p, "요청 영역과 겹치지 않음"))
    return chosen, skipped


def cmd_ngii(a):
    root = Path(a.ngii_dir)
    if not root.is_dir():
        raise SystemExit(f"--ngii-dir 폴더가 없습니다: {root}")
    geom = load_boundary(a.boundary, a.bbox, a.dst_crs)
    x0, y0, x1, y1 = geom_bounds(geom)
    request = (x0 - a.buffer, y0 - a.buffer, x1 + a.buffer, y1 + a.buffer)
    found = discover_ngii(root)
    print(f"found in {root}: contours {len(found['contours'])}, spots {len(found['spots'])}, rasters {len(found['rasters'])}")
    if not any(found.values()):
        raise SystemExit(f"{root} 아래에서 N3L_F0010000.shp / N3P_F0020000.shp / *.img / *.tif 를 하나도 찾지 못했습니다")
    chosen, skipped = select_overlapping(found, request, a.dst_crs, a.src_crs)
    for key in ("contours", "spots", "rasters"):
        for p in chosen[key]:
            print(f"selected {key}: {p}")
    for p, why in skipped:
        print(f"제외: {p} ({why})")
    if not chosen["contours"] and not chosen["spots"]:
        print("경고: 요청 영역과 겹치는 등고선(N3L_F0010000)·표고점(N3P_F0020000) 도엽이 없습니다. "
              "해당 지역 수치지형도 도엽을 추가로 받아야 할 수 있습니다.")
    if not any(chosen.values()):
        raise SystemExit("요청 영역과 겹치는 파일이 하나도 없습니다 — 도엽 번호와 영역(--boundary/--bbox)을 확인하세요. "
                         f"탐색한 파일 {sum(len(v) for v in found.values())}개 모두 겹치지 않거나 읽을 수 없었습니다.")
    if chosen["contours"] or chosen["spots"]:
        if not chosen["contours"]:
            print("경고: 겹치는 등고선 없이 표고점만 있습니다 — 결과가 거칠 수 있습니다.")
        a.contours = [str(p) for p in chosen["contours"]]
        a.spots = [str(p) for p in chosen["spots"]]
        a.fallback_raster = [str(p) for p in chosen["rasters"]] or None
        cmd_contours_core(a, label="NGII ngii-dir TIN")
    else:
        print("note: 겹치는 등고선·표고점이 없어 공개 DEM(래스터)만 사용합니다(해상도가 거침).")
        a.src = [str(p) for p in chosen["rasters"]]
        cmd_raster(a)


# ------------------------------------------------------------------ #
# 출력: COG + campo-grid
# ------------------------------------------------------------------ #

def write_cog(path: Path, data: np.ndarray, transform, crs: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    arr = np.where(np.isfinite(data), data, NODATA).astype("float32")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "tmp.tif"
        with rasterio.open(tmp, "w", driver="GTiff", width=arr.shape[1], height=arr.shape[0], count=1,
                           dtype="float32", crs=crs, transform=transform, nodata=NODATA) as ds:
            ds.write(arr, 1)
            ds.update_tags(VERTICAL_DATUM="KVD_INCHEON_MSL (orthometric)", UNITS="metre")
        rasterio.shutil.copy(tmp, path, driver="COG", COMPRESS="DEFLATE", PREDICTOR="YES",
                             BLOCKSIZE=256, OVERVIEWS="AUTO", RESAMPLING="BILINEAR")


def finish(a, dst, tr, w, h, geom, source: str):
    outside = boundary_mask(geom, tr, w, h, a.buffer, a.res)
    dst = np.where(outside, np.nan, dst)
    valid = np.isfinite(dst)
    if not valid.any():
        raise SystemExit("결과가 전부 결측입니다 — 입력 도엽이 캠퍼스 영역을 덮는지, 좌표계가 맞는지 확인하세요")
    out = Path(a.out)
    write_cog(out.with_suffix(".tif"), dst, tr, a.dst_crs)
    g = Grid(dst, tr.c, tr.f, a.res, a.dst_crs)
    jp, bp = g.save(out, dtype=a.grid_dtype, source=source)
    print(f"grid {w}×{h} @ {a.res} m, valid {valid.mean() * 100:.1f}%, "
          f"h=[{np.nanmin(dst):.2f}, {np.nanmax(dst):.2f}] m")
    print(f"wrote {out.with_suffix('.tif')} (COG), {jp}, {bp} ({bp.stat().st_size / 1e6:.2f} MB)")
    warn_low_coverage(dst, outside, tr, a.dst_crs)


def warn_low_coverage(dst, outside, tr, dst_crs: str, min_ratio: float = MIN_VALID_RATIO):
    """경계(+버퍼) 안쪽 셀 중 값이 있는 비율이 낮으면, 빈 곳이 어디인지 알려 준다."""
    from pyproj import Transformer
    inside = ~outside
    n_in = int(inside.sum())
    if n_in == 0:
        return
    holes = inside & ~np.isfinite(dst)
    ratio = 1.0 - holes.sum() / n_in
    if ratio >= min_ratio:
        return
    rows, cols = np.where(holes)
    res = tr.a
    hx0, hx1 = tr.c + cols.min() * res, tr.c + (cols.max() + 1) * res
    hy1, hy0 = tr.f - rows.min() * res, tr.f - (rows.max() + 1) * res
    tf = Transformer.from_crs(dst_crs, "EPSG:4326", always_xy=True)
    lon0, lat0 = tf.transform(hx0, hy0)
    lon1, lat1 = tf.transform(hx1, hy1)
    h, w = dst.shape
    cy, cx = rows.mean() / h, cols.mean() / w
    where = ("북" if cy < 0.33 else "남" if cy > 0.67 else "") + ("서" if cx < 0.33 else "동" if cx > 0.67 else "")
    print(f"경고: 경계 안쪽 유효 셀 비율 {ratio * 100:.1f}% (95% 미만) — 값이 없는 셀 {int(holes.sum()):,}개. "
          f"빈 곳은 대체로 영역의 {where or '가운데'}쪽, 경도 {lon0:.5f}~{lon1:.5f}, 위도 {lat0:.5f}~{lat1:.5f} 부근입니다. "
          "그 구역을 덮는 수치지형도 도엽 또는 DEM 도엽이 빠졌을 수 있습니다(인접 도엽을 추가로 받으세요).")


# ------------------------------------------------------------------ #
# sample
# ------------------------------------------------------------------ #

def cmd_sample(a):
    from pyproj import Transformer

    g = Grid.load(a.grid)
    tf = Transformer.from_crs("EPSG:4326", g.crs, always_xy=True)
    x, y = tf.transform(a.lonlat[0], a.lonlat[1])
    v = g.sample_bilinear(x, y)[0]
    print(json.dumps({"lon": a.lonlat[0], "lat": a.lonlat[1], "x": x, "y": y,
                      "h_m": None if not np.isfinite(v) else round(float(v), 3),
                      "vertical_datum": g.vertical_datum}, ensure_ascii=False))


# ------------------------------------------------------------------ #

def build_parser():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--boundary", help="캠퍼스 경계 GeoJSON(EPSG:4326 기본)")
        p.add_argument("--bbox", nargs=4, type=float, metavar=("LON0", "LAT0", "LON1", "LAT1"))
        p.add_argument("--buffer", type=float, default=20.0, help="경계 바깥 여유(m)")
        p.add_argument("--res", type=float, default=1.0, help="출력 해상도(m) 0.5~1 권장")
        p.add_argument("--dst-crs", default=DST_CRS_DEFAULT,
                       help=f"출력 좌표계(미터 단위 투영 좌표계, 기본 {DST_CRS_DEFAULT}; 편집기 지형 3D는 {DST_CRS_DEFAULT}만 읽음)")
        p.add_argument("--src-crs", help="입력 래스터에 좌표계가 없거나 틀릴 때 강제")
        p.add_argument("--grid-dtype", choices=["float32", "uint16"], default="float32",
                       help="uint16 = 1 cm 양자화(용량 절반)")
        p.add_argument("--out", required=True, help="출력 경로(확장자 없이)")

    r = sub.add_parser("raster", help="NGII DEM(.img/.tif) 클립·재투영·리샘플")
    r.add_argument("--src", nargs="+", required=True)
    r.add_argument("--resampling", default="bilinear", choices=["bilinear", "cubic", "nearest"])
    common(r)
    r.set_defaults(fn=cmd_raster)

    c = sub.add_parser("contours", help="1:5000 수치지형도 등고선/표고점 → TIN 격자")
    c.add_argument("--contours", nargs="+", required=True, help="N3L_F0010000.shp 등")
    c.add_argument("--spots", nargs="*", help="N3P_F0020000.shp 등")
    c.add_argument("--z-field", help="높이 속성명(자동 탐지 실패 시)")
    c.add_argument("--encoding", default="cp949", help="DBF 인코딩(.cpg 없으면 cp949)")
    c.add_argument("--densify", type=float, default=2.0, help="등고선 정점 보강 간격(m)")
    c.add_argument("--keep-zero", action="store_true", help="높이 0 m 등고선·표고점도 쓰기(기본: 빈 값으로 보고 뺌)")
    c.add_argument("--fallback-raster", nargs="*", help="TIN 바깥(값이 없는 칸)을 채울 DEM")
    common(c)
    c.set_defaults(fn=cmd_contours)

    n = sub.add_parser("ngii", help="폴더 하나로: 등고선·표고점·DEM을 재귀 탐색, 영역과 겹치는 도엽만 자동 선택")
    n.add_argument("--ngii-dir", required=True, help="수치지형도/DEM 압축 해제 폴더(하위 폴더 재귀 탐색)")
    n.add_argument("--z-field", help="높이 속성명(자동 탐지 실패 시)")
    n.add_argument("--encoding", default="cp949", help="DBF 인코딩(.cpg 없으면 cp949)")
    n.add_argument("--densify", type=float, default=2.0, help="등고선 정점 보강 간격(m)")
    n.add_argument("--keep-zero", action="store_true", help="높이 0 m 등고선·표고점도 쓰기(기본: 빈 값으로 보고 뺌)")
    n.add_argument("--resampling", default="bilinear", choices=["bilinear", "cubic", "nearest"])
    common(n)
    n.set_defaults(fn=cmd_ngii)

    s = sub.add_parser("sample", help="격자에서 위경도 지점 높이 조회")
    s.add_argument("--grid", required=True)
    s.add_argument("--lonlat", nargs=2, type=float, required=True)
    s.set_defaults(fn=cmd_sample)
    return ap


def main(argv=None):
    a = build_parser().parse_args(argv)
    if getattr(a, "dst_crs", None):
        check_dst_crs(a.dst_crs)
    a.fn(a)


if __name__ == "__main__":
    main()
