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


# ---- read_merged: nodata per sheet, coordinate systems (QA 2026-11) ----

def _sheet(path: Path, left: float, top: float, vals: np.ndarray, nodata, crs="EPSG:5186", res=10.0):
    kw = {} if nodata is None else {"nodata": nodata}
    with rasterio.open(path, "w", driver="GTiff", width=vals.shape[1], height=vals.shape[0], count=1, dtype="float32",
                       crs=crs, transform=from_origin(left, top, res, res), **kw) as ds:
        ds.write(vals.astype("float32"), 1)


@pytest.mark.parametrize("order", ["a_first", "b_first"])
def test_read_merged_masks_every_sheets_own_nodata(tmp_path, order):
    """Each sheet's nodata becomes NaN whatever the first sheet says (no 0 m or -32767 m cells in the merge).
    rasterio.merge reads every source masked by its own nodata, so this held before the QA too; the test pins it."""
    from dem_prep import read_merged
    a = np.full((4, 4), 30.0)
    a[:, 3] = -9999.0                       # sheet A: nodata -9999, its east column void
    b = np.full((4, 4), 50.0)
    b[0, 1] = 0.0                            # sheet B: nodata 0
    c = np.full((4, 4), 40.0)
    c[2, 2] = -32767.0                       # sheet C: nodata -32767
    _sheet(tmp_path / "A.tif", 0, 1000, a, -9999.0)
    _sheet(tmp_path / "B.tif", 30, 1000, b, 0.0)
    _sheet(tmp_path / "C.tif", 0, 960, c, -32767.0)
    srcs = [tmp_path / n for n in (["A.tif", "B.tif", "C.tif"] if order == "a_first" else ["B.tif", "C.tif", "A.tif"])]
    arr, _, _, _ = read_merged([str(s) for s in srcs], None)
    vals = arr[np.isfinite(arr)]
    assert set(np.unique(vals)) <= {30.0, 40.0, 50.0}
    # B's void cell, C's void cell, and the 4×3 south-east corner no sheet covers; A's void column is filled from B.
    assert np.isnan(arr).sum() == 2 + 12


def test_read_merged_forced_src_crs_with_differing_sheets_warns_and_merges(tmp_path, capsys):
    """--src-crs over sheets that say other things: every sheet is read in the forced CRS (no rasterio traceback), and each
    sheet whose own CRS was overridden is named."""
    from dem_prep import read_merged
    _sheet(tmp_path / "A.tif", 0, 1000, np.full((4, 4), 30.0), -9999.0, crs="EPSG:5186")
    _sheet(tmp_path / "B.tif", 40, 1000, np.full((4, 4), 50.0), -9999.0, crs="EPSG:5174")
    _sheet(tmp_path / "C.tif", 80, 1000, np.full((4, 4), 60.0), -9999.0, crs=None)
    arr, tr, crs, _ = read_merged([str(tmp_path / n) for n in ("A.tif", "B.tif", "C.tif")], "EPSG:5186")
    assert crs.to_epsg() == 5186
    assert arr.shape == (4, 12) and np.isfinite(arr).all()
    out = capsys.readouterr().out
    assert "B.tif" in out and "EPSG:5174" in out and "A.tif" not in out


def test_read_merged_sheets_with_different_crs_fail_clearly(tmp_path):
    from dem_prep import read_merged
    _sheet(tmp_path / "A.tif", 0, 1000, np.full((4, 4), 30.0), -9999.0, crs="EPSG:5186")
    _sheet(tmp_path / "B.tif", 40, 1000, np.full((4, 4), 50.0), -9999.0, crs="EPSG:5174")
    with pytest.raises(SystemExit, match="B.tif"):
        read_merged([str(tmp_path / "A.tif"), str(tmp_path / "B.tif")], None)


def test_dst_crs_must_be_projected_metres_and_non_5186_is_flagged(tmp_path, campus):
    img = tmp_path / "s.img"
    make_img(img)
    r = run("raster", "--src", img, "--boundary", campus, "--res", "1", "--dst-crs", "EPSG:4326", "--out", tmp_path / "geo")
    assert r.returncode != 0 and "미터" in r.stderr
    r = run("raster", "--src", img, "--boundary", campus, "--res", "5", "--dst-crs", "EPSG:5179", "--out", tmp_path / "utmk")
    assert r.returncode == 0, r.stderr
    assert "EPSG:5186" in r.stdout and "지형 3D" in r.stdout
    assert Grid.load(tmp_path / "utmk.json").crs == "EPSG:5179"
    r = run("raster", "--src", img, "--boundary", campus, "--res", "5", "--out", tmp_path / "tm")
    assert "지형 3D" not in r.stdout


# ---- contours: height field, z = 0 (QA 2026-11) ----

def _plane_contours(levels=np.arange(10, 45, 5.0)):
    from shapely.geometry import LineString
    lines, hs = [], []
    for h in levels:
        pts = [(X0 + (h - 25.0 - 0.01 * (y - Y0)) / 0.02, y) for y in np.linspace(Y0 - 500, Y0 + 500, 11)]
        lines.append(LineString(pts)); hs.append(float(h))
    return lines, hs


def test_contours_without_a_named_height_field_fail_instead_of_guessing(tmp_path, campus):
    """The only numeric column is a feature number 1…7 (in −50…2000): it used to become the height (a TIN of row numbers)."""
    import geopandas as gpd
    lines, _ = _plane_contours()
    gpd.GeoDataFrame({"OBJECTID": list(range(1, len(lines) + 1)), "KIND": ["주곡선"] * len(lines)}, geometry=lines,
                     crs="EPSG:5186").to_file(tmp_path / "c.shp", encoding="cp949")
    r = run("contours", "--contours", tmp_path / "c.shp", "--boundary", campus, "--res", 5.0, "--out", tmp_path / "o")
    assert r.returncode != 0
    assert "OBJECTID" in r.stderr and "--z-field" in r.stderr
    assert not (tmp_path / "o.json").exists()
    # Named on the command line it is used as asked.
    hs = _plane_contours()[1]
    gpd.GeoDataFrame({"ALT": hs}, geometry=lines, crs="EPSG:5186").to_file(tmp_path / "d.shp", encoding="cp949")
    r = run("contours", "--contours", tmp_path / "d.shp", "--z-field", "ALT", "--boundary", campus, "--res", 5.0,
            "--out", tmp_path / "d")
    assert r.returncode == 0, r.stderr


def test_contours_with_zero_height_are_left_out(tmp_path, campus):
    """등고수치 0 on an inland sheet is an unfilled attribute: as a 0 m contour it digs a 25 m trench across the campus."""
    import geopandas as gpd
    from shapely.geometry import LineString
    lines, hs = _plane_contours()
    lines.append(LineString([(X0 - 300, Y0 + 40), (X0 + 300, Y0 + 40)])); hs.append(0.0)
    gpd.GeoDataFrame({"등고수치": hs}, geometry=lines, crs="EPSG:5186").to_file(tmp_path / "N3L_F0010000.shp", encoding="cp949")
    r = run("contours", "--contours", tmp_path / "N3L_F0010000.shp", "--boundary", campus, "--res", 2.0, "--out", tmp_path / "o")
    assert r.returncode == 0, r.stderr
    assert "0 m" in r.stdout and "--keep-zero" in r.stdout
    g = Grid.load(tmp_path / "o.json")
    for dx, dy in ((0, 40), (100, 40), (-100, 30)):
        v = g.sample_bilinear(X0 + dx, Y0 + dy)[0]
        assert abs(v - plane(X0 + dx, Y0 + dy)) < 0.1, (dx, dy, v)
    # --keep-zero: a coastal campus whose 0 m contour is real.
    r = run("contours", "--contours", tmp_path / "N3L_F0010000.shp", "--boundary", campus, "--res", 2.0, "--keep-zero",
            "--out", tmp_path / "k")
    assert r.returncode == 0, r.stderr
    assert Grid.load(tmp_path / "k.json").sample_bilinear(X0, Y0 + 40)[0] < 1.0


def test_contours_whose_geometry_z_is_all_zero_are_not_heights(tmp_path, campus):
    """A PolylineZ file with Z = 0 everywhere and no height column: the grid used to come out 0 m everywhere."""
    import geopandas as gpd
    from shapely.geometry import LineString
    lines, _ = _plane_contours()
    lines_z = [LineString([(x, y, 0.0) for x, y in l.coords]) for l in lines]
    gpd.GeoDataFrame({"NAME": ["c"] * len(lines_z)}, geometry=lines_z, crs="EPSG:5186").to_file(tmp_path / "z.shp", encoding="cp949")
    r = run("contours", "--contours", tmp_path / "z.shp", "--boundary", campus, "--res", 5.0, "--out", tmp_path / "o")
    assert r.returncode != 0
    assert "--z-field" in r.stderr
    # A real geometry Z is still read.
    lines_h = [LineString([(x, y, h) for x, y in l.coords]) for l, h in zip(lines, _plane_contours()[1])]
    gpd.GeoDataFrame({"NAME": ["c"] * len(lines_h)}, geometry=lines_h, crs="EPSG:5186").to_file(tmp_path / "h.shp", encoding="cp949")
    r = run("contours", "--contours", tmp_path / "h.shp", "--boundary", campus, "--res", 5.0, "--out", tmp_path / "h")
    assert r.returncode == 0, r.stderr
    assert abs(Grid.load(tmp_path / "h.json").sample_bilinear(X0, Y0)[0] - plane(X0, Y0)) < 0.1


def test_fallback_raster_fills_outside_the_tin_and_reports_what_is_left(tmp_path, campus):
    """Contours only west of X0+50: the TIN ends there, the 90 m DEM fills the rest. Cells neither covers are counted."""
    import geopandas as gpd
    lines, hs = _plane_contours(levels=np.arange(10, 27, 5.0))  # x ≤ X0 + 50 (h = 26: none; h = 25 at x = X0)
    gpd.GeoDataFrame({"등고수치": hs}, geometry=lines, crs="EPSG:5186").to_file(tmp_path / "N3L_F0010000.shp", encoding="cp949")
    img = tmp_path / "fb.img"
    make_img(img)
    r = run("contours", "--contours", tmp_path / "N3L_F0010000.shp", "--fallback-raster", img, "--boundary", campus,
            "--res", 2.0, "--out", tmp_path / "o")
    assert r.returncode == 0, r.stderr
    assert "fallback raster filled" in r.stdout and "남은 빈 칸" not in r.stdout
    g = Grid.load(tmp_path / "o.json")
    for dx in (-150, 150):  # TIN side, fallback side (the 90 m DEM of the same plane, bilinear)
        assert abs(g.sample_bilinear(X0 + dx, Y0)[0] - plane(X0 + dx, Y0)) < 0.2, dx
    # Without a fallback the east half stays empty, and the log says how much.
    r = run("contours", "--contours", tmp_path / "N3L_F0010000.shp", "--boundary", campus, "--res", 2.0, "--out", tmp_path / "n")
    assert r.returncode == 0, r.stderr
    assert "남은 빈 칸" in r.stdout and "--fallback-raster" in r.stdout
