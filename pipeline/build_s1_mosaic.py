#!/usr/bin/env python3
"""Sentinel-1 annual radar mosaics 2020 and 2021 for the globe, before NISAR existed.

Source: ESA WorldCover Sentinel-1 median gamma0 backscatter composites (VV, VH, VH/VV), 10 m, one 1-degree COG per tile,
public on AWS (s3://esa-worldcover-s1, CC BY 4.0, contains modified Copernicus Sentinel data). Values are dB:
value * 0.001 - 45.

Each tile is read at 12 x 12 cells (average of the COG overview), so the world becomes 4320 x 2160. Written as
web/public/data/s1/s1_<year>_4k.webp in the C-band convention R = VV, G = VH, B = VV - VH (fixed ranges, the same
everywhere: VV -22..0 dB, VH -28..-8 dB, VV-VH 2..14 dB) and web/public/data/s1/s1.json (years, ranges, source).
"""
import json
import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data" / "s1"
BUCKET = "https://esa-worldcover-s1.s3.eu-central-1.amazonaws.com"
C = 12
W, H = 360 * C, 180 * C
RANGES = {"VV": (-22, 0), "VH": (-28, -8), "VVminusVH": (2, 14)}
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")


def keys(year):
    out, marker = [], ""
    while True:
        x = urllib.request.urlopen(f"{BUCKET}/?prefix=vvvhratio/{year}/&marker={marker}", timeout=120).read().decode()
        ks = re.findall(r"<Key>([^<]+\.tif)</Key>", x)
        out += ks
        if "<IsTruncated>true</IsTruncated>" not in x or not ks:
            return out
        marker = ks[-1]


def tile(key):
    m = re.search(r"_([NS])(\d\d)([EW])(\d\d\d)_", key)
    lat = int(m.group(2)) * (1 if m.group(1) == "N" else -1)
    lon = int(m.group(4)) * (1 if m.group(3) == "E" else -1)
    for k in range(3):
        try:
            with rasterio.open(f"{BUCKET}/{key}") as s:
                a = s.read(out_shape=(3, C, C), resampling=Resampling.average, masked=True)
            return lat, lon, np.where(a.mask, np.nan, a.data * 0.001 - 45).astype(np.float32)
        except Exception:  # noqa: BLE001
            if k == 2:
                return lat, lon, None


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"source": "ESA WorldCover Sentinel-1 median backscatter composites (CC BY 4.0, contains modified Copernicus Sentinel data)",
            "ranges": RANGES, "years": []}
    for year in (2020, 2021):
        ks = keys(year)
        print(year, len(ks), "tiles", flush=True)
        grid = np.full((3, H, W), np.nan, np.float32)
        done = [0]

        def put(r):
            lat, lon, a = r
            done[0] += 1
            if done[0] % 1000 == 0:
                print(f"   {year}: {done[0]}/{len(ks)}", flush=True)
            if a is None:
                return
            y0 = (90 - (lat + 1)) * C
            x0 = (lon + 180) * C
            grid[:, y0:y0 + C, x0:x0 + C] = a

        with ThreadPoolExecutor(24) as ex:
            for r in ex.map(tile, ks):
                put(r)
        vv, vh = grid[0], grid[1]
        ok = np.isfinite(vv) & np.isfinite(vh) & (vv > -44)
        st = lambda v, lo, hi: np.clip((v - lo) / (hi - lo), 0, 1)  # noqa: E731
        rgb = np.dstack([st(vv, *RANGES["VV"]), st(vh, *RANGES["VH"]), st(vv - vh, *RANGES["VVminusVH"])]) * 255
        img = np.dstack([np.nan_to_num(rgb), np.where(ok, 255, 0)]).astype(np.uint8)
        path = OUT / f"s1_{year}_4k.webp"
        Image.fromarray(img, "RGBA").save(path, quality=88)
        print("  ", path.name, f"{path.stat().st_size / 1e6:.1f} MB", flush=True)
        meta["years"].append({"year": year, "img4k": f"s1/s1_{year}_4k.webp", "tiles": len(ks)})
    (OUT / "s1.json").write_text(json.dumps(meta, indent=1))
    print("S1DONE", flush=True)


if __name__ == "__main__":
    main()
