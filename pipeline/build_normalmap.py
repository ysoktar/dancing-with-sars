#!/usr/bin/env python3
"""Global tangent-space normal map for relief shading of the globe.

Elevation: Terrarium tiles on AWS Open Data (Mapzen / Tilezen joerd: SRTM, GMTED, ETOPO1 and
others, public), zoom 5 (8192 x 8192 Web-Mercator pixels), reprojected to an 8192 x 4096
equirectangular grid. Beyond ±85° (outside Web Mercator) the 20 km topology texture fills in.

Normal per pixel from the true ground spacing (dx = R·cosφ·Δλ, dy = R·Δφ), with vertical
exaggeration so relief reads at globe scale; encoded as RGB = (n + 1) / 2 with x = east,
y = north, z = up (OpenGL convention, which three.js expects).

Writes web/public/textures/earth-normal-8k.webp and earth-normal-4k.webp.
"""
import io
import math
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TEX = ROOT / "web" / "public" / "textures"
CACHE = ROOT / "pipeline" / ".cache" / "terrarium5"
Z = 5
W, H = 8192, 4096
EXAGGERATION = 12.0
R = 6371000.0


def tile(x, y):
    p = CACHE / f"{x}_{y}.png"
    if not p.exists():
        url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png"
        for i in range(4):
            try:
                p.write_bytes(urllib.request.urlopen(url, timeout=60).read()); break
            except Exception:  # noqa: BLE001
                if i == 3: raise
    a = np.asarray(Image.open(p).convert("RGB")).astype(np.float32)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    n = 2 ** Z
    merc = np.zeros((n * 256, n * 256), np.float32)
    jobs = [(x, y) for y in range(n) for x in range(n)]
    with ThreadPoolExecutor(16) as ex:
        for (x, y), t in zip(jobs, ex.map(lambda j: tile(*j), jobs)):
            merc[y * 256:(y + 1) * 256, x * 256:(x + 1) * 256] = t
    print("mercator elevation", merc.shape, float(merc.min()), float(merc.max()))
    # reproject Web Mercator -> equirectangular (nearest row, columns line up)
    lat = 90 - (np.arange(H) + 0.5) * 180 / H
    M = merc.shape[0]
    latc = np.clip(lat, -85.0511, 85.0511)
    ym = (1 - np.log(np.tan(np.radians(latc)) + 1 / np.cos(np.radians(latc))) / math.pi) / 2 * M
    rows = np.clip(ym.astype(int), 0, M - 1)
    cols = (np.arange(W) * M / W).astype(int)
    elev = merc[rows][:, cols]
    # polar caps from the coarse topology texture (grey = relative height; scale to ~0..4.5 km)
    topo = np.asarray(Image.open(TEX / "earth-topology.png").convert("L").resize((W, H), Image.BILINEAR)).astype(np.float32) / 255 * 4500
    polar = np.abs(lat) > 85
    elev[polar] = topo[polar]
    elev = np.maximum(elev, 0)          # oceans flat: the relief is for land
    # gradients in metres
    dlam = 2 * math.pi / W; dphi = math.pi / H
    coslat = np.maximum(np.cos(np.radians(lat)), 0.02)[:, None]
    gx = (np.roll(elev, -1, 1) - np.roll(elev, 1, 1)) / (2 * R * coslat * dlam)
    gy = np.zeros_like(elev)
    gy[1:-1] = (elev[:-2] - elev[2:]) / (2 * R * dphi)          # row 0 is north: north minus south
    gx *= EXAGGERATION; gy *= EXAGGERATION
    nz = 1 / np.sqrt(1 + gx * gx + gy * gy)
    nx, ny = -gx * nz, -gy * nz
    rgb = np.stack([(nx + 1) * 127.5, (ny + 1) * 127.5, (nz + 1) * 127.5], -1).clip(0, 255).astype(np.uint8)
    Image.fromarray(rgb).save(TEX / "earth-normal-8k.webp", quality=90, method=6)
    Image.fromarray(rgb).resize((4096, 2048), Image.BOX).save(TEX / "earth-normal-4k.webp", quality=90, method=6)
    print("wrote", TEX / "earth-normal-8k.webp")


if __name__ == "__main__":
    main()
