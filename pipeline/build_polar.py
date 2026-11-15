#!/usr/bin/env python3
"""Polar caps of the world mosaics in a polar projection, so the globe needs no stretched equirectangular rows there.

An equirectangular texture squeezes all 8192 columns into one point at each pole: on a sphere every meridian then
converges and any per-column difference shows as radial streaks. Here, for every mosaic period, the area poleward of
60 degrees is resampled (bilinear, from the 8k mosaic) onto a polar azimuthal-equidistant grid centred on the pole:
pixel (x, y) in [-1, 1]^2 -> distance from the pole rho = r * 30 deg, longitude = atan2(y, x).

Beyond NISAR's last imaged latitude (polarFill in each period's json: ~77.7 N, ~88 S) there are no observations. The
earlier per-meridian fill is dropped and the hole is filled by normalized convolution (masked Gaussian smoothing at
growing scales) in this polar grid, which has no preferred direction: a smooth, honest "no data here" surface instead
of spokes. The fill is marked in the json (polarCaps.filledFrom).

Writes web/public/data/mosaic/<period>_pn.webp and _ps.webp (2048 x 2048 RGBA) and adds them to mosaic.json.
The globe draws them on sphere caps |lat| > 60 (web/src/globe.js); the main sphere stops at +-60 deg.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
N, RADIUS = 2048, 30.0


def polar_grid(side):
    c = (np.arange(N) + 0.5) / N * 2 - 1
    X, Y = np.meshgrid(c, -c)                      # row 0 = top (y = +1)
    rho = np.hypot(X, Y) * RADIUS
    lon = np.degrees(np.arctan2(Y, X))
    lat = 90 - rho if side == "n" else -90 + rho
    inside = np.hypot(X, Y) <= 1.0
    return lat, lon, inside


def fill_holes(rgb, ok):
    """Normalized convolution at growing scales: each hole pixel takes the masked Gaussian mean of the nearest data."""
    out = rgb.copy(); have = ok.astype(np.float32)
    w = have.copy()
    for sigma in (2, 4, 8, 16, 32, 64, 128):
        if w.min() > 0.999:
            break
        num = np.stack([gaussian_filter(out[..., k] * w, sigma) for k in range(3)], -1)
        den = gaussian_filter(w, sigma)
        fill = (den > 1e-3) & (w < 0.999)
        out[fill] = num[fill] / den[fill, None]
        w = np.maximum(w, (den > 1e-3).astype(np.float32))
    return out


def main():
    idx = json.loads((DATA / "mosaic.json").read_text())
    for c in idx["cycles"]:
        meta = json.loads((DATA / "mosaic" / f"{c['id']}.json").read_text())
        pf = meta.get("polarFill") or {"north": 90, "south": -90}
        src = np.asarray(Image.open(DATA / c["img8k"]).convert("RGBA")).astype(np.float32)
        Hs, Ws = src.shape[:2]
        caps = {}
        for side in ("n", "s"):
            lat, lon, inside = polar_grid(side)
            rows = (90 - lat) / 180 * Hs - 0.5
            cols = (lon + 180) / 360 * Ws - 0.5
            samp = np.stack([map_coordinates(src[..., k], [rows, cols], order=1, mode="wrap") for k in range(4)], -1)
            # south of ~86 S the equirectangular source itself is distorted (frames squeezed towards the pole)
            limit = pf["north"] if side == "n" else max(pf["south"], -86.0)
            observed = np.abs(lat) <= abs(limit)
            ok = inside & observed & (samp[..., 3] > 200)
            rgb = fill_holes(samp[..., :3], ok)
            # a long diffusion from a coloured edge draws spokes towards the pole: keep only a short transition
            # (~1.5 deg) and blend the rest of the unobserved cap into one value, the mean of the observed rim
            d = distance_transform_edt(~ok & inside)
            rim = ok & (distance_transform_edt(~(~ok & inside)) <= 1.0 * N / (2 * RADIUS))
            mean = samp[..., :3][rim].mean(0) if rim.any() else rgb[ok].mean(0)
            w = np.clip(1 - d / (1.5 * N / (2 * RADIUS)), 0, 1)[..., None]
            rgb = np.where((~ok & inside)[..., None], w * rgb + (1 - w) * mean, rgb)
            # beyond NISAR's reach: fade to transparent over ~1.5 deg (the base map shows through), no invented colour
            alpha = np.where(inside, np.where(ok, 255, np.clip(255 * w[..., 0], 0, 255)), 0)
            img = np.dstack([np.clip(rgb, 0, 255), alpha]).astype(np.uint8)
            name = f"mosaic/{c['id']}_p{side}.webp"
            Image.fromarray(img, "RGBA").save(DATA / name, quality=90)
            caps["north" if side == "n" else "south"] = name
        c["polar"] = caps
        meta["polarCaps"] = {"projection": "azimuthal equidistant, pole-centred, radius 30 deg", "filledFrom": pf, **caps}
        (DATA / "mosaic" / f"{c['id']}.json").write_text(json.dumps(meta, indent=1))
        print(c["id"], "caps written", flush=True)
    (DATA / "mosaic.json").write_text(json.dumps(idx, indent=1))
    print("POLARDONE")


if __name__ == "__main__":
    main()
