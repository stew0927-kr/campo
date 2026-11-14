"""
실행:  cd tools/elevation && python -m pytest -q test_core_contract.py

TS ↔ Python 계약: packages/core 의 campus-basic fixture 로 솔버 CLI(--campus --derived-out)를 돌려,
packages/core/test/fixtures/elevation/campus-basic.derived.json 과 같은지 본다. TS 쪽
packages/core/test/elevation/derived-contract.test.ts 가 같은 파일을 readDerivedElevation → applyDerivedElevation 으로
읽고 스키마 검사·길찾기를 돌린다. 솔버를 바꿔 값이 달라지면 CAMPO_UPDATE_FIXTURES=1 로 다시 만든다.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
REPO = HERE.parent.parent
CAMPUS = REPO / "packages" / "core" / "test" / "fixtures" / "campus-basic"
FIXTURE = REPO / "packages" / "core" / "test" / "fixtures" / "elevation" / "campus-basic.derived.json"
sys.path.insert(0, str(HERE))
from campo_grid import Grid  # noqa: E402


def test_derived_output_for_the_core_fixture_matches_the_committed_file(tmp_path):
    from pyproj import Transformer
    gx, gy = Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True).transform(127.0, 37.0)
    # A DEM that rises 2 % to the north-east over the whole fixture (about 200 m × 200 m), 1 m cells.
    xs = gx - 100 + (np.arange(400) + 0.5)
    ys = gy + 300 - (np.arange(400) + 0.5)
    X, Y = np.meshgrid(xs, ys)
    Grid(30.0 + 0.02 * (Y - gy) + 0.005 * (X - gx), gx - 100, gy + 300, 1.0).save(tmp_path / "dem")
    store = {"schemaVersion": 1, "positionCrs": "EPSG:4326", "verticalDatum": "KVD_INCHEON_MSL", "nodes": [], "sessions": [], "edges": []}
    (tmp_path / "store.json").write_text(json.dumps(store), encoding="utf-8")
    out = tmp_path / "derived.json"
    r = subprocess.run([sys.executable, str(HERE / "campo_height_solver.py"), "--store", str(tmp_path / "store.json"),
                        "--dem", str(tmp_path / "dem.json"), "--campus", str(CAMPUS), "--out", str(tmp_path / "out"),
                        "--derived-out", str(out)], capture_output=True, text=True, encoding="utf-8",
                       env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    assert r.returncode == 0, r.stderr
    got = json.loads(out.read_text(encoding="utf-8"))
    got.update(runId="fixture", solvedAt=0)
    text = json.dumps(got, ensure_ascii=False, indent=2) + "\n"
    if os.environ.get("CAMPO_UPDATE_FIXTURES") == "1":
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(text, encoding="utf-8")
    assert FIXTURE.exists(), "run once with CAMPO_UPDATE_FIXTURES=1 to create the fixture"
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == got, "solver output changed: CAMPO_UPDATE_FIXTURES=1 to update"
    assert got["format"] == "campo-derived-elevation/1" and got["edges"]
