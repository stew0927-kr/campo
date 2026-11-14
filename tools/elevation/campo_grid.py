"""
CAMPO 경량 격자 포맷 (dem_prep.py 출력 ↔ campo_height_solver.py 입력 ↔ 앱/백엔드 샘플링)

파일 2개:
  <name>.json  메타데이터
  <name>.bin   row-major, 북쪽(위) 행부터, little-endian (float32 또는 uint16 양자화)

메타 예시:
{
  "format": "campo-grid/1",
  "crs": "EPSG:5186",               # 평면 좌표계(미터)
  "vertical_datum": "KVD_INCHEON_MSL",  # 정표고(인천만 평균해면) — DEM과 앱 높이 기준을 같게
  "origin_x": 202000.0,             # 왼쪽 경계 x (셀 가장자리)
  "origin_y": 553000.0,             # 위쪽 경계 y (셀 가장자리)
  "res": 1.0, "width": 800, "height": 700,
  "dtype": "float32" | "uint16",
  "scale": 0.01, "offset": 12.3,    # uint16일 때 h = raw*scale + offset
  "nodata": -9999.0 (float32) / 65535 (uint16),
  "source": "...", "created_at": "..."
}
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

FORMAT = "campo-grid/1"


@dataclass
class Grid:
    data: np.ndarray  # (height, width) float64, NaN = nodata
    origin_x: float
    origin_y: float
    res: float
    crs: str = "EPSG:5186"
    vertical_datum: str = "KVD_INCHEON_MSL"
    meta: dict = field(default_factory=dict)

    @property
    def height(self) -> int:
        return self.data.shape[0]

    @property
    def width(self) -> int:
        return self.data.shape[1]

    # ---- 좌표 변환 (셀 중심 기준) ----
    def cell_centers(self):
        xs = self.origin_x + (np.arange(self.width) + 0.5) * self.res
        ys = self.origin_y - (np.arange(self.height) + 0.5) * self.res
        return xs, ys

    def xy_to_colrow(self, x, y):
        col = (np.asarray(x, float) - self.origin_x) / self.res - 0.5
        row = (self.origin_y - np.asarray(y, float)) / self.res - 0.5
        return col, row

    def sample_bilinear(self, x, y) -> np.ndarray:
        """쌍선형 샘플링. 격자 밖/결측 주변은 NaN."""
        col, row = self.xy_to_colrow(x, y)
        col = np.atleast_1d(col)
        row = np.atleast_1d(row)
        c0 = np.floor(col).astype(int)
        r0 = np.floor(row).astype(int)
        fc = col - c0
        fr = row - r0
        out = np.full(col.shape, np.nan)
        ok = (c0 >= 0) & (r0 >= 0) & (c0 + 1 < self.width) & (r0 + 1 < self.height)
        if ok.any():
            c, r, a, b = c0[ok], r0[ok], fc[ok], fr[ok]
            d = self.data
            v = (d[r, c] * (1 - a) * (1 - b) + d[r, c + 1] * a * (1 - b)
                 + d[r + 1, c] * (1 - a) * b + d[r + 1, c + 1] * a * b)
            out[ok] = v
        return out

    # ---- 입출력 ----
    def save(self, path_no_ext: str | Path, dtype: str = "float32", source: str = "") -> tuple[Path, Path]:
        p = Path(path_no_ext)
        p.parent.mkdir(parents=True, exist_ok=True)
        meta = {
            "format": FORMAT,
            "crs": self.crs,
            "vertical_datum": self.vertical_datum,
            "origin_x": float(self.origin_x),
            "origin_y": float(self.origin_y),
            "res": float(self.res),
            "width": int(self.width),
            "height": int(self.height),
            "dtype": dtype,
            "source": source or self.meta.get("source", ""),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        valid = np.isfinite(self.data)
        if dtype == "float32":
            arr = np.where(valid, self.data, -9999.0).astype("<f4")
            meta["nodata"] = -9999.0
        elif dtype == "uint16":
            lo = float(np.nanmin(self.data)) if valid.any() else 0.0
            scale = 0.01  # 1 cm 해상도, 범위 655 m
            raw = np.round((self.data - lo) / scale)
            if valid.any() and raw[valid].max() >= 65535:
                raise ValueError("elevation range too large for uint16 @1cm")
            arr = np.where(valid, raw, 65535).astype("<u2")
            meta.update(scale=scale, offset=lo, nodata=65535)
        else:
            raise ValueError(dtype)
        bin_path = p.with_suffix(".bin")
        json_path = p.with_suffix(".json")
        arr.tofile(bin_path)
        meta["bin"] = bin_path.name
        json_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        return json_path, bin_path

    @classmethod
    def load(cls, json_path: str | Path) -> "Grid":
        jp = Path(json_path)
        m = json.loads(jp.read_text(encoding="utf-8"))
        if m.get("format") != FORMAT:
            raise ValueError(f"not a {FORMAT} file")
        binp = jp.with_name(m["bin"])
        shape = (m["height"], m["width"])
        if m["dtype"] == "float32":
            raw = np.fromfile(binp, dtype="<f4").reshape(shape).astype(float)
            data = np.where(raw == m["nodata"], np.nan, raw)
        else:
            raw = np.fromfile(binp, dtype="<u2").reshape(shape)
            data = np.where(raw == m["nodata"], np.nan, raw * m["scale"] + m["offset"])
        return cls(data=data, origin_x=m["origin_x"], origin_y=m["origin_y"], res=m["res"],
                   crs=m["crs"], vertical_datum=m.get("vertical_datum", ""), meta=m)
