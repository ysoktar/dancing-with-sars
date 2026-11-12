#!/usr/bin/env python3
"""
Elevation for every study site (no login required).

Source: Copernicus DEM GLO-30 (30 m), public on AWS Open Data
        s3://copernicus-dem-30m  (https://registry.opendata.aws/copernicus-dem/)

For each site the 1°x1° tiles covering the site window are downloaded, mosaicked,
cropped to the same window as the radar crops and resampled to 256 x 256.
Elevation is stored as a "terrarium"-encoded PNG (lossless):
    height_m = R * 256 + G + B / 256 - 32768

  web/public/data/dem/<id>.png
  web/public/data/dem.json          min / max / mean elevation per site

Optional NASA alternative: NASADEM (30 m, 60°N–56°S) from LP DAAC needs a free
Earthdata login; see docs/GLOBAL_DATA.md.

Requires: numpy, pillow, tifffile, imagecodecs
"""
from __future__ import annotations

import io
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
from build_data import OUT, aoi_box, cached  # noqa: E402

SIZE = 256
BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"


def tile_name(lat: int, lon: int) -> str:
    ns = f"N{lat:02d}" if lat >= 0 else f"S{-lat:02d}"
    ew = f"E{lon:03d}" if lon >= 0 else f"W{-lon:03d}"
    return f"Copernicus_DSM_COG_10_{ns}_00_{ew}_00_DEM"


def read_tile(lat: int, lon: int):
    import tifffile
    name = tile_name(lat, lon)
    try:
        b = cached(f"{BUCKET}/{name}/{name}.tif")
    except Exception:  # noqa: BLE001  (ocean tiles do not exist)
        return None
    return tifffile.imread(io.BytesIO(b)).astype(np.float32)


def site_dem(site):
    W, S, E, N = aoi_box(site)
    lats = range(math.floor(S), math.floor(N) + 1)
    lons = range(math.floor(W), math.floor(E) + 1)
    out = np.zeros((SIZE, SIZE), np.float32)
    ys = np.linspace(N, S, SIZE)
    xs = np.linspace(W, E, SIZE)
    filled = np.zeros((SIZE, SIZE), bool)
    for la in lats:
        for lo in lons:
            t = read_tile(la, lo)
            if t is None:
                continue
            h, w = t.shape  # tiles are 1° with pixel centres; width shrinks at high latitude
            rows = ((la + 1 - ys) * h).astype(int)
            cols = ((xs - lo) * w).astype(int)
            mr = (rows >= 0) & (rows < h)
            mc = (cols >= 0) & (cols < w)
            if not mr.any() or not mc.any():
                continue
            rr, cc = np.meshgrid(np.where(mr)[0], np.where(mc)[0], indexing="ij")
            out[rr, cc] = t[rows[rr], cols[cc]]
            filled[rr, cc] = True
    return out, filled


def encode(h: np.ndarray) -> Image.Image:
    v = np.clip(h + 32768, 0, 65535.99)
    r = np.floor(v / 256)
    g = np.floor(v - r * 256)
    b = np.floor((v - r * 256 - g) * 256)
    return Image.fromarray(np.dstack([r, g, b]).astype(np.uint8), "RGB")


def main():
    cat = json.loads((OUT / "catalog.json").read_text())
    (OUT / "dem").mkdir(parents=True, exist_ok=True)
    meta = {}
    for s in cat["sites"]:
        h, filled = site_dem(s)
        if not filled.any():
            print(f"{s['id']:12s} no DEM tiles")
            continue
        encode(h).save(OUT / "dem" / f"{s['id']}.png", optimize=True)
        v = h[filled]
        meta[s["id"]] = {"min": round(float(v.min()), 1), "max": round(float(v.max()), 1), "mean": round(float(v.mean()), 1),
                         "coverage": round(float(filled.mean()), 3), "source": "Copernicus DEM GLO-30"}
        print(f"{s['id']:12s} {v.min():7.0f} – {v.max():6.0f} m  coverage {filled.mean():.0%}")
    (OUT / "dem.json").write_text(json.dumps(meta, separators=(",", ":")))


if __name__ == "__main__":
    main()
