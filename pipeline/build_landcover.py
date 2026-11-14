#!/usr/bin/env python3
"""Global cropland / forest layer from the NISAR world mosaics.

Uses every full 12-day cycle mosaic (4k equirectangular, R = HH, G = HV) of the growing
season available (from 15 June 2026 on) and applies, per ~10 km pixel, the same two-axis
rule as the in-browser "Cropland vs forest" tool:
    swing  = seasonal swing of the radar vegetation index RVI = 4·HV / (HH + HV)
    meanHV = mean HV over the cycles
    forest   : high meanHV, small swing   (woody canopy, volume scattering all year)
    cropland : large swing                (sown, grown, harvested within the season)
    mixed    : high meanHV, moderate swing (tree crops, agroforestry, mosaics)
    other    : low meanHV, small swing    (grass, bare, built)
Thresholds are found globally over land (Otsu on mean HV, upper-quartile rule on the swing),
then the swing threshold is relaxed in the tropics' evergreen belt is NOT applied: the rule
is the same everywhere. Ice (|lat| > 60 with very high HH) and gap-filled pixels are left out.

Writes web/public/data/landcover_4k.webp (RGBA, transparent where not classified) and
landcover.json (class shares, cycles used, thresholds).
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data"
COLORS = {1: (232, 176, 74), 2: (21, 128, 61), 3: (132, 204, 22), 4: (168, 162, 158)}
NAMES = {1: "cropland", 2: "forest", 3: "tree crops / mixed", 4: "grass / bare / built"}


def otsu(v):
    h, _ = np.histogram(v, bins=256, range=(0, 256))
    p = h / max(1, h.sum()); w = np.cumsum(p); m = np.cumsum(p * np.arange(256))
    sb = (m[-1] * w - m) ** 2 / (w * (1 - w) + 1e-12)
    return float(np.argmax(sb))


def main():
    idx = json.loads((OUT / "mosaic.json").read_text())["cycles"]
    cyc = [c for c in idx if c["start"] >= "2026-06-15" and (np.datetime64(c["end"]) - np.datetime64(c["start"])).astype(int) <= 14]
    print(f"{len(cyc)} full cycles:", [c["id"] for c in cyc])
    imgs = [np.asarray(Image.open(OUT / "mosaic" / f"{c['id']}_4k.webp").convert("RGBA")) for c in cyc]   # uint8, small
    H, W = imgs[0].shape[:2]
    n = np.zeros((H, W), np.int16)
    swing = np.full((H, W), np.nan, np.float32); mhv = swing.copy(); mhh = swing.copy()
    for r0 in range(0, H, 128):                         # row bands keep memory low
        sl = slice(r0, r0 + 128)
        OK = np.stack([a[sl, :, 3] > 0 for a in imgs])
        HH = np.stack([a[sl, :, 0] for a in imgs]).astype(np.float32)
        HV = np.stack([a[sl, :, 1] for a in imgs]).astype(np.float32)
        n[sl] = OK.sum(0)
        rvi = np.where(OK, 4 * HV / (HH + HV + 1), np.nan)
        with np.errstate(all="ignore"):
            import warnings; warnings.simplefilter("ignore")
            swing[sl] = np.nanpercentile(rvi, 90, axis=0) - np.nanpercentile(rvi, 10, axis=0)
            mhv[sl] = np.nanmean(np.where(OK, HV, np.nan), axis=0)
            mhh[sl] = np.nanmean(np.where(OK, HH, np.nan), axis=0)
    lat = 90 - (np.arange(H) + 0.5) * 180 / H
    land = (n >= max(3, len(cyc) // 2)) & np.isfinite(swing)
    ice = (np.abs(lat)[:, None] > 58) & (mhh > 150) | (np.abs(lat)[:, None] > 72)
    dark = mhh < 40                                     # water / very smooth surfaces
    use = land & ~ice & ~dark
    hv_thr = otsu(mhv[use])
    sw_thr = max(0.08, 0.6 * float(np.percentile(swing[use], 75)))
    sw_hi = max(sw_thr * 1.6, float(np.percentile(swing[use], 90)))
    cls = np.zeros((H, W), np.uint8)
    hi = mhv >= hv_thr
    cls[use & hi & (swing <= sw_thr)] = 2
    cls[use & (swing > sw_thr) & (~hi | (swing > sw_hi))] = 1
    cls[use & hi & (swing > sw_thr) & (swing <= sw_hi)] = 3
    cls[use & ~hi & (swing <= sw_thr)] = 4
    img = np.zeros((H, W, 4), np.uint8)
    for k, col in COLORS.items():
        m = cls == k
        img[m, :3] = col
        img[m, 3] = 210 if k != 4 else 110
    Image.fromarray(img, "RGBA").save(OUT / "landcover_4k.webp", quality=85, method=6)
    tot = max(1, int((cls > 0).sum()))
    shares = {NAMES[k]: round(float((cls == k).sum()) / tot * 100, 1) for k in COLORS}
    meta = {"cycles": [c["id"] for c in cyc], "hvThreshold": hv_thr, "swingThreshold": round(sw_thr, 3), "sharesPct": shares,
            "method": "two-axis rule on the NISAR world mosaics: seasonal swing of RVI vs mean HV", "img": "landcover_4k.webp"}
    (OUT / "landcover.json").write_text(json.dumps(meta, indent=1))
    print("thresholds: HV", hv_thr, "swing", round(sw_thr, 3), "| shares", shares)


if __name__ == "__main__":
    main()
