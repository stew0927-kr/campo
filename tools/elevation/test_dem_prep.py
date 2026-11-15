"""
실행: cd tools/elevation && python -m pytest -q test_dem_prep.py
가상 NGII 자료(한양대 서울캠퍼스 부근, EPSG:5186)로 dem_prep 의 좌표·클립·COG·TIN 경로를 검증한다.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from campo_grid import Grid  # noqa: E402

LON, LAT = 127.0450, 37.5570  # 한양대 서울캠퍼스 부근(예시)
TF = Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True)
X0, Y0 = TF.transform(LON, LAT)


def plane(x, y):  # 동쪽으로 2 %, 북쪽으로 1 % 오르는 평면
    return 25.0 + 0.02 * (x - X0) + 0.01 * (y - Y0)


def run(*args):
    # UTF-8 both ways: the scripts print Korean, and Windows would otherwise decode the pipe with the locale (cp949).
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    return subprocess.run([sys.executable, str(HERE / "dem_prep.py"), *map(str, args)], capture_output=True, text=True,
                          encoding="utf-8", env=env)


@pytest.fixture()
def campus(tmp_path):
    d = 300 / 111_000  # 약 ±300 m
    ring = [[LON - d, LAT - d * 0.8], [LON + d, LAT - d * 0.8], [LON + d, LAT + d * 0.8], [LON - d, LAT + d * 0.8], [LON - d, LAT - d * 0.8]]
    gj = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"name": "campus"},
                                                       "geometry": {"type": "Polygon", "coordinates": [ring]}}]}
    p = tmp_path / "campus.geojson"
    p.write_text(json.dumps(gj), encoding="utf-8")
    return p


def make_img(path: Path, crs="EPSG:5186", res=90.0):
    n = 30
    left, top = X0 - n / 2 * res, Y0 + n / 2 * res
    xs = left + (np.arange(n) + 0.5) * res
    ys = top - (np.arange(n) + 0.5) * res
    X, Y = np.meshgrid(xs, ys)
    with rasterio.open(path, "w", driver="HFA", width=n, height=n, count=1, dtype="float32",
                       crs=crs, transform=from_origin(left, top, res, res), nodata=-9999) as ds:
        ds.write(plane(X, Y).astype("float32"), 1)


def test_raster_mode_clip_cog_and_georeference(tmp_path, campus):
    img = tmp_path / "37612.img"
    make_img(img)
    out = tmp_path / "out" / "hy_dem"
    r = run("raster", "--src", img, "--boundary", campus, "--res", 1.0, "--out", out)
    assert r.returncode == 0, r.stderr
    with rasterio.open(out.with_suffix(".tif")) as ds:
        assert ds.crs.to_epsg() == 5186
        assert ds.profile["tiled"] and ds.overviews(1)
        assert ds.tags(ns="IMAGE_STRUCTURE").get("LAYOUT") == "COG"
    g = Grid.load(out.with_suffix(".json"))
    assert g.res == 1.0 and g.crs == "EPSG:5186"
    # 평면은 쌍선형이 정확히 재현 → 지오레퍼런싱(원점/뒤집힘) 오류가 있으면 여기서 깨짐
    for dx, dy in ((0, 0), (120, -80), (-200, 150)):
        v = g.sample_bilinear(X0 + dx, Y0 + dy)[0]
        assert abs(v - plane(X0 + dx, Y0 + dy)) < 0.05, (dx, dy, v)
    # 경계 밖(버퍼 20 m 너머)은 결측
    assert np.isnan(g.sample_bilinear(X0 + 400, Y0)[0])
    s = run("sample", "--grid", out.with_suffix(".json"), "--lonlat", LON, LAT)
    assert abs(json.loads(s.stdout)["h_m"] - 25.0) < 0.05


def test_raster_without_crs_requires_src_crs(tmp_path, campus):
    img = tmp_path / "nocrs.tif"
    n, res = 20, 90.0
    with rasterio.open(img, "w", driver="GTiff", width=n, height=n, count=1, dtype="float32",
                       transform=from_origin(X0 - 900, Y0 + 900, res, res)) as ds:
        ds.write(np.full((n, n), 30, "float32"), 1)
    r = run("raster", "--src", img, "--boundary", campus, "--out", tmp_path / "x")
    assert r.returncode != 0 and "--src-crs" in (r.stderr + r.stdout)
    r = run("raster", "--src", img, "--src-crs", "EPSG:5186", "--boundary", campus, "--res", 2, "--out", tmp_path / "x")
    assert r.returncode == 0, r.stderr


def test_contours_mode_tin_with_korean_field(tmp_path, campus):
    import geopandas as gpd
    from shapely.geometry import LineString, Point

    # 평면의 5 m 등고선: 25 + 0.02(x−X0) + 0.01(y−Y0) = h  →  직선
    lines, hs = [], []
    for h in np.arange(10, 45, 5.0):
        pts = []
        for y in np.linspace(Y0 - 500, Y0 + 500, 11):
            x = X0 + (h - 25.0 - 0.01 * (y - Y0)) / 0.02
            pts.append((x, y))
        lines.append(LineString(pts)); hs.append(h)
    gpd.GeoDataFrame({"등고수치": hs}, geometry=lines, crs="EPSG:5186").to_file(
        tmp_path / "N3L_F0010000.shp", encoding="cp949")
    spots = [Point(X0 + 10, Y0 - 5)]
    gpd.GeoDataFrame({"표고수치": [plane(X0 + 10, Y0 - 5)]}, geometry=spots, crs="EPSG:5186").to_file(
        tmp_path / "N3P_F0020000.shp", encoding="cp949")
    out = tmp_path / "tin"
    r = run("contours", "--contours", tmp_path / "N3L_F0010000.shp", "--spots", tmp_path / "N3P_F0020000.shp",
            "--boundary", campus, "--res", 1.0, "--out", out)
    assert r.returncode == 0, r.stderr
    g = Grid.load(out.with_suffix(".json"))
    for dx, dy in ((0, 0), (90, 60), (-150, -100)):
        v = g.sample_bilinear(X0 + dx, Y0 + dy)[0]
        assert abs(v - plane(X0 + dx, Y0 + dy)) < 0.05, (dx, dy, v)


# ------------------------------------------------------------------ #
# ngii 폴더 자동 선택 (--ngii-dir)
# ------------------------------------------------------------------ #

def _write_contours(folder: Path, x_off: float, y_off: float, with_spot=True):
    """x_off/y_off(m)만큼 떨어진 곳의 평면 등고선을 도엽 폴더로 쓴다. 한 도엽 = 한 폴더."""
    import geopandas as gpd
    from shapely.geometry import LineString, Point

    folder.mkdir(parents=True, exist_ok=True)
    cx, cy = X0 + x_off, Y0 + y_off
    lines, hs = [], []
    base = plane(cx, cy)
    for h in np.arange(round(base / 5) * 5 - 20, round(base / 5) * 5 + 25, 5.0):
        # 같은 평면의 등고선을 도엽 중심(cx, cy) 둘레 ±500 m 에만 그린다
        pts = [(X0 + (h - 25.0 - 0.01 * (y - Y0)) / 0.02, y) for y in np.linspace(cy - 500, cy + 500, 11)]
        lines.append(LineString(pts)); hs.append(h)
    gpd.GeoDataFrame({"등고수치": hs}, geometry=lines, crs="EPSG:5186").to_file(folder / "N3L_F0010000.shp", encoding="cp949")
    if with_spot:
        gpd.GeoDataFrame({"표고수치": [plane(cx + 10, cy)]}, geometry=[Point(cx + 10, cy)], crs="EPSG:5186").to_file(
            folder / "N3P_F0020000.shp", encoding="cp949")


def test_ngii_dir_selects_only_overlapping_sheets(tmp_path, campus):
    root = tmp_path / "ngii"
    _write_contours(root / "sheet_a", 0, 0)            # 캠퍼스를 덮음
    _write_contours(root / "nested" / "sheet_b", 100, 0)  # 캠퍼스와 겹침(두 번째 도엽)
    _write_contours(root / "far_away", 30_000, 0)      # 30 km 떨어진 도엽 → 제외
    out = tmp_path / "out" / "ngii_dem"
    r = run("ngii", "--ngii-dir", root, "--boundary", campus, "--res", 1.0, "--out", out)
    assert r.returncode == 0, r.stderr
    log = r.stdout
    assert "sheet_a" in log and "sheet_b" in log
    assert "far_away" in log and "제외" in log
    selected = [l for l in log.splitlines() if l.startswith("selected")]
    assert all("far_away" not in l for l in selected), log
    g = Grid.load(out.with_suffix(".json"))
    for dx, dy in ((0, 0), (90, 60), (-150, -100)):
        v = g.sample_bilinear(X0 + dx, Y0 + dy)[0]
        assert abs(v - plane(X0 + dx, Y0 + dy)) < 0.1, (dx, dy, v)


def test_ngii_dir_no_overlap_fails_with_clear_message(tmp_path, campus):
    root = tmp_path / "ngii"
    _write_contours(root / "far_away", 30_000, 0)
    r = run("ngii", "--ngii-dir", root, "--boundary", campus, "--out", tmp_path / "x")
    assert r.returncode != 0
    msg = r.stderr + r.stdout
    assert "겹치" in msg and "far_away" in msg


def test_ngii_dir_raster_only_and_low_valid_warning(tmp_path, campus):
    root = tmp_path / "ngii"
    (root / "dem").mkdir(parents=True)
    # 캠퍼스 동쪽 절반만 덮는 DEM → valid < 95 % 경고
    n, res = 30, 90.0
    left, top = X0, Y0 + n / 2 * res
    xs = left + (np.arange(n) + 0.5) * res
    ys = top - (np.arange(n) + 0.5) * res
    X, Y = np.meshgrid(xs, ys)
    with rasterio.open(root / "dem" / "part.img", "w", driver="HFA", width=n, height=n, count=1, dtype="float32",
                       crs="EPSG:5186", transform=from_origin(left, top, res, res), nodata=-9999) as ds:
        ds.write(plane(X, Y).astype("float32"), 1)
    r = run("ngii", "--ngii-dir", root, "--boundary", campus, "--res", 2.0, "--out", tmp_path / "o")
    assert r.returncode == 0, r.stderr
    assert "경고" in r.stdout and "95%" in r.stdout
