#!/usr/bin/env python3
"""Distilled global metric layers for the globe (equirectangular, transparent where there is nothing to show).

  variability_4k.webp  Seasonal variability: robust temporal spread (MAD) of NISAR HV - HH (the polarisation ratio
                       of the dB-like browse values) over the full 12-day cycles; geometry changes between tracks cancel. Fields that are sown and harvested change a lot; forest, desert, ice little.
  melt_4k.webp         Snow and ice melt: in cold regions (|lat| >= 60 deg, or above 2,000 m; above 1,200 m beyond
                       45 deg), the largest drop of HH below the pixel's own dry level (80th percentile over all
                       periods). Wet snow and melting ice absorb L-band, so a deep drop marks melt.
  maincrop.png         Main crop: the crop with the largest share of the crop area in each 0.25 deg cell (SPAM 2010),
                       opacity by how much of the cell is cropland.
  landslides.png       NASA Global Landslide Catalog events (1988-2017) as dots, larger with more fatalities.
  metrics.json         legend information for the web page.

Values are only summarised, never altered: the inputs are the raw browse mosaics (pipeline/build_mosaic.py),
SPAM 2010 (build_crop_prior.py) and the landslide catalog (build_landslides.py).
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import build_normalmap as nm

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
OUT = DATA / "metrics"
W, H = 4096, 2048


def ramp(v, stops):
    """v in 0..1 -> RGB along colour stops [(pos, (r, g, b)), ...]."""
    v = np.clip(v, 0, 1)
    out = np.zeros(v.shape + (3,), np.float32)
    for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
        m = (v >= p0) & (v <= p1)
        t = ((v - p0) / max(p1 - p0, 1e-6))[m][:, None]
        out[m] = np.array(c0) * (1 - t) + np.array(c1) * t
    return out


VAR_STOPS = [(0, (20, 30, 70)), (0.35, (30, 120, 160)), (0.65, (120, 200, 90)), (1, (250, 220, 60))]
MELT_STOPS = [(0, (150, 210, 255)), (0.5, (40, 130, 255)), (1, (90, 20, 200))]


def load_cycles():
    cyc = json.loads((DATA / "mosaic.json").read_text())["cycles"]
    out = []
    for c in cyc:
        a = np.asarray(Image.open(DATA / c["img4k"]).convert("RGBA").resize((W, H), Image.BILINEAR))
        out.append((c, a))
    return out


def elevation():
    n = 2 ** nm.Z
    merc = np.zeros((n * 256, n * 256), np.float32)
    for y in range(n):
        for x in range(n):
            merc[y * 256:(y + 1) * 256, x * 256:(x + 1) * 256] = nm.tile(x, y)
    lat = 90 - (np.arange(H) + 0.5) * 180 / H
    M = merc.shape[0]
    latc = np.clip(lat, -85.0511, 85.0511)
    ym = (1 - np.log(np.tan(np.radians(latc)) + 1 / np.cos(np.radians(latc))) / math.pi) / 2 * M
    return merc[np.clip(ym.astype(int), 0, M - 1)][:, (np.arange(W) * M / W).astype(int)], lat


def save_rgba(rgb, alpha, path, lossless=False):
    img = np.dstack([np.clip(rgb, 0, 255), np.clip(alpha, 0, 255)]).astype(np.uint8)
    Image.fromarray(img, "RGBA").save(path, **({"lossless": True} if lossless else {"quality": 88}))
    print("  ", path.name, f"{path.stat().st_size / 1e6:.1f} MB", flush=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {}
    cycles = load_cycles()
    elev, lat = elevation()
    land = (elev > 0) & (np.abs(lat)[:, None] <= 78)       # land only; beyond ~78 deg the caps are filled, not observed
    full = [(c, a) for c, a in cycles if (np.datetime64(c["end"]) - np.datetime64(c["start"])).astype(int) <= 26]
    print(len(cycles), "periods,", len(full), "full cycles", flush=True)

    # seasonal variability of HV over the full cycles
    # HV - HH (the dB-like ratio): a change of viewing geometry between passes moves both channels together and
    # largely cancels, while plant growth and harvest change HV much more than HH
    hv = np.stack([a[..., 1].astype(np.float32) - a[..., 0].astype(np.float32) for c, a in full])
    ok = np.stack([a[..., 3] > 0 for c, a in full])
    n = ok.sum(0)
    hvm = np.where(ok, hv, np.nan)
    # robust spread (median absolute deviation x 1.4826): one odd pass (a single-pol frame, a bad gain) does not count
    med = np.nanmedian(hvm, axis=0)
    sd = 1.4826 * np.nanmedian(np.abs(hvm - med[None]), axis=0)
    valid = (n >= max(6, len(full) * 2 // 3)) & land
    hi = float(np.nanpercentile(sd[valid], 98))
    save_rgba(ramp(np.nan_to_num(sd / hi), VAR_STOPS), np.where(valid, 225, 0), OUT / "variability_4k.webp")
    meta["variability"] = {"max": round(hi, 1), "cycles": len(full), "from": full[0][0]["start"], "to": full[-1][0]["end"], "stops": VAR_STOPS}

    # snow and ice melt
    L = np.abs(lat)[:, None]
    cold = (L >= 60) | (elev >= 2000) | ((L >= 45) & (elev >= 1200))
    hh = np.stack([a[..., 0].astype(np.float32) for c, a in cycles])
    okh = np.stack([a[..., 3] > 0 for c, a in cycles])
    hhm = np.where(okh, hh, np.nan)
    ref = np.nanpercentile(hhm, 80, axis=0)
    low = np.nanmin(hhm, axis=0)
    drop = ref - low
    when = np.nanargmin(np.where(np.isnan(hhm), np.inf, hhm), axis=0)
    mv = cold & land & (okh.sum(0) >= 6) & (drop >= 20)
    save_rgba(ramp(np.nan_to_num((drop - 20) / 80), MELT_STOPS), np.where(mv, 230, 0), OUT / "melt_4k.webp")
    months = [c["start"][:7] for c, a in cycles]
    hist = {}
    for k, m in zip(*np.unique(when[mv], return_counts=True)):
        hist[months[int(k)]] = hist.get(months[int(k)], 0) + int(m)
    meta["melt"] = {"min": 20, "max": 100, "stops": MELT_STOPS, "deepestDropPeriod": hist}

    # main crop (SPAM 2010) on 0.25 deg cells
    cmeta = json.loads((DATA / "cropprior" / "crops.json").read_text())
    PAL = {"WHEA": (230, 190, 70), "RICE": (40, 200, 220), "MAIZ": (250, 120, 40), "SOYB": (180, 90, 200), "SUGC": (130, 220, 60),
           "BARL": (200, 160, 110), "COTT": (240, 240, 240), "SORG": (200, 80, 80), "PMIL": (150, 110, 60), "SMIL": (150, 110, 60),
           "CASS": (110, 70, 40), "POTA": (220, 200, 160), "OILP": (20, 120, 50), "ACOF": (120, 60, 30), "RCOF": (120, 60, 30),
           "COCO": (90, 50, 30), "RAPE": (250, 240, 60), "SUNF": (255, 200, 0), "GROU": (210, 140, 90), "BEAN": (160, 60, 120),
           "VEGE": (60, 160, 90), "BANA": (255, 230, 120), "TEMF": (230, 90, 160), "TROF": (255, 140, 120), "SUGB": (150, 230, 200)}
    other = (150, 150, 150)
    img = np.zeros((720, 1440, 4), np.uint8)
    counts = {}
    for tf in (DATA / "cropprior").glob("*_*.json"):
        T = json.loads(tf.read_text())
        for rc, (tot, lst) in T["cells"].items():
            r, c = map(int, rc.split("_"))
            if not lst:
                continue
            code = lst[0][0]
            lat_c = 90 - (r + 0.5) * 0.25
            cell_ha = (0.25 * 111.32) ** 2 * math.cos(math.radians(lat_c)) * 100
            dens = min(1.0, tot / max(cell_ha, 1) / 0.5)
            if dens < 0.03:
                continue
            col = PAL.get(code, other)
            img[r, c] = (*col, int(60 + 195 * dens))
            counts[code] = counts.get(code, 0) + 1
    Image.fromarray(img, "RGBA").save(OUT / "maincrop.png", optimize=True)
    print("   maincrop.png", f"{(OUT / 'maincrop.png').stat().st_size / 1e6:.1f} MB", flush=True)
    top = sorted(counts, key=lambda k: -counts[k])
    meta["maincrop"] = {"source": cmeta.get("source", "SPAM 2010"), "legend": [[k, cmeta["crops"].get(k, k), "#%02x%02x%02x" % PAL.get(k, other)] for k in top if k in PAL][:16]}

    # landslide catalog dots
    ev = json.loads((DATA / "landslides.json").read_text())["events"]
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    for e in ev:
        x, y = (e[1] + 180) / 360 * W, (90 - e[0]) / 180 * H
        f = e[6] or 0
        rad = 1.6 if f == 0 else 2.4 if f < 10 else 3.6 if f < 100 else 5
        col = (255, 120, 60, 210) if f == 0 else (255, 60, 40, 230) if f < 10 else (220, 20, 60, 240)
        dr.ellipse([x - rad, y - rad, x + rad, y + rad], fill=col)
    im.save(OUT / "landslides.png", optimize=True)
    print("   landslides.png", f"{(OUT / 'landslides.png').stat().st_size / 1e6:.1f} MB", flush=True)
    meta["landslides"] = {"events": len(ev), "from": ev[0][2], "to": ev[-1][2]}

    (OUT / "metrics.json").write_text(json.dumps(meta, indent=1))
    print("METRICSDONE", flush=True)


if __name__ == "__main__":
    main()
