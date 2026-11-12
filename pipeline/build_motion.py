#!/usr/bin/env python3
"""
NISAR surface-motion products for every study site (no login required).

  GUNW  geocoded unwrapped/wrapped interferograms: line-of-sight ground motion
        between two passes 12 (or 24, 36...) days apart
  GOFF  geocoded pixel offsets: feature-tracking displacement (glaciers,
        large deformation), browse shows magnitude + direction arrows

For each site we take the most frequent track that covers the site window,
download the public `*_LATLON.png` browse (RGBA), recover its geographic
bounds from the granule footprint, crop the site window and write

  web/public/data/motion/<id>/<product>_<ref>_<sec>.png
  web/public/data/motion.json

Usage:  python pipeline/build_motion.py [--sites konya ...] [--max-pairs 10]
"""
from __future__ import annotations

import argparse
import io
import json
import math
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np
from PIL import Image

from build_data import OUT, ROOT, aoi_box, cached, search, wkt_contains_box

CROP = 320


def bounds_from_alpha(im: Image.Image, wkt: str):
    a = np.asarray(im.getchannel("A").reduce(2)) > 0
    if not a.any():
        return None
    ys, xs = np.nonzero(a)
    f = 2.0
    x_l, x_r = xs.min() * f, (xs.max() + 1) * f
    y_t, y_b = ys.min() * f, (ys.max() + 1) * f
    nums = list(map(float, re.findall(r"-?\d+\.?\d*", wkt)))
    lons, lats = nums[0::2], nums[1::2]
    if max(lons) - min(lons) > 180:
        return None
    sx = (max(lons) - min(lons)) / max(x_r - x_l, 1)
    sy = (max(lats) - min(lats)) / max(y_b - y_t, 1)
    w_px, h_px = im.size
    W = min(lons) - x_l * sx
    N = max(lats) + y_t * sy
    return W, N - h_px * sy, W + w_px * sx, N


def crop_rgba(im: Image.Image, bounds, box, size: int) -> Image.Image:
    W, S, E, N = bounds
    w_px, h_px = im.size
    x0 = (box[0] - W) / (E - W) * w_px
    x1 = (box[2] - W) / (E - W) * w_px
    y0 = (N - box[3]) / (N - S) * h_px
    y1 = (N - box[1]) / (N - S) * h_px
    ix0, iy0, ix1, iy1 = math.floor(x0), math.floor(y0), math.ceil(x1), math.ceil(y1)
    c = im.crop((ix0, iy0, ix1, iy1))
    return c.resize((size, size), Image.BICUBIC, box=(x0 - ix0, y0 - iy0, x1 - ix0, y1 - iy0))


def pair_dates(pid: str):
    ts = re.findall(r"_(\d{8})T\d{6}", pid)
    return (ts[0], ts[2]) if len(ts) >= 4 else (ts[0], ts[-1])


def process(g, site, product, out_dir):
    png = next((b for b in g.get("browse") or [] if b.endswith("_LATLON.png")), None)
    if not png:
        return None
    try:
        im = Image.open(io.BytesIO(cached(png))).convert("RGBA")
    except Exception as e:  # noqa: BLE001
        print("   !", e)
        return None
    bounds = bounds_from_alpha(im, g["wkt"])
    if not bounds:
        return None
    c = crop_rgba(im, bounds, aoi_box(site), CROP)
    alpha = np.asarray(c.getchannel("A"))
    cover = float((alpha > 0).mean())
    if cover < 0.6:
        return None
    r, s = pair_dates(g["productID"])
    ref = f"{r[:4]}-{r[4:6]}-{r[6:]}"
    sec = f"{s[:4]}-{s[4:6]}-{s[6:]}"
    name = f"{product.lower()}_{r}_{s}.webp"
    c.save(out_dir / name, quality=82, method=6)
    return {
        "ref": ref, "sec": sec,
        "days": (datetime.fromisoformat(sec) - datetime.fromisoformat(ref)).days,
        "granule": g["productID"], "collection": g.get("collectionName"),
        "path": g.get("path"), "frame": g.get("frame"), "dir": g.get("flightDirection"),
        "img": f"motion/{site['id']}/{name}", "browse": png, "h5": g.get("downloadUrl"),
        "cover": round(cover, 3),
    }


def build_site(site, max_pairs, workers):
    out_dir = OUT / "motion" / site["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    for f in out_dir.glob("*"):
        f.unlink()
    box = aoi_box(site)
    res = {}
    for product in ("GUNW", "GOFF"):
        gs = json.loads(search({"processingLevel": product, "intersectsWith": f"POINT({site['lon']} {site['lat']})",
                                "output": "jsonlite", "maxResults": 1000}))["results"]
        gs = [g for g in gs if any(b.endswith("_LATLON.png") for b in g.get("browse") or [])]
        full = [g for g in gs if g.get("wkt") and wkt_contains_box(g["wkt"], *box)] or gs
        if not full:
            res[product] = []
            continue
        pref = (site.get("track") or {})
        key = lambda g: (g.get("path"), g.get("frame"), g.get("flightDirection"))
        cnt = Counter(key(g) for g in full)
        gcov_track = (pref.get("path"), pref.get("frame"), pref.get("dir"))
        track = gcov_track if cnt.get(gcov_track, 0) >= 2 else cnt.most_common(1)[0][0]
        chosen = sorted((g for g in full if key(g) == track), key=lambda g: g["startTime"])
        # one product per pair (latest processing), most recent pairs first
        uniq = {}
        for g in chosen:
            uniq[pair_dates(g["productID"])] = g
        chosen = list(uniq.values())[-max_pairs:]
        with ThreadPoolExecutor(workers) as ex:
            items = [r for r in ex.map(lambda g: process(g, site, product, out_dir), chosen) if r]
        res[product] = sorted(items, key=lambda x: x["ref"])
        print(f"   {product}: {len(gs)} granules, track {track}, kept {len(res[product])} pairs")
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", nargs="*")
    ap.add_argument("--max-pairs", type=int, default=10)
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    cat = json.loads((OUT / "catalog.json").read_text())
    path = OUT / "motion.json"
    old = json.loads(path.read_text())["sites"] if path.exists() else {}
    sites = {}
    for s in cat["sites"]:
        if args.sites and s["id"] not in args.sites:
            if s["id"] in old:
                sites[s["id"]] = old[s["id"]]
            continue
        print(f"== {s['id']}")
        sites[s["id"]] = build_site(s, args.max_pairs, args.workers)
    path.write_text(json.dumps({"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "sites": sites},
                               separators=(",", ":")))
    print("wrote", path)


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(ROOT / "pipeline"))
    main()
