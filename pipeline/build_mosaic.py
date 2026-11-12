#!/usr/bin/env python3
"""
Worldwide NISAR L-band mosaic for one 12-day repeat cycle (no login required).

Every NISAR L2 GCOV granule acquired in the window is listed through NASA CMR.
Its public geocoded browse image (*_LATLON.png, R = HH, G = HV) is downloaded,
georeferenced from the granule footprint, shrunk to the mosaic resolution and
painted into one global equirectangular canvas. The full-size PNG is discarded
right away, so disk use stays small even though ~60 GB is streamed.

Painting order (later wins): other polarization modes first, then dual-pol
HH/HV ("DH..."), each in acquisition-time order, so the mosaic shows the most
recent dual-pol view wherever one exists.

Outputs
  web/public/data/mosaic/<id>_8k.webp   8192 x 4096 RGBA, transparent where no data
  web/public/data/mosaic/<id>_4k.webp   4096 x 2048 (mobile)
  web/public/data/mosaic.json           list of cycles with stats

Usage
  python pipeline/build_mosaic.py --start 2026-10-01 --days 12
  python pipeline/build_mosaic.py --start 2026-10-01 --days 12 --dry-run   # list + size only
Resumable: shrunk frames are cached in pipeline/.cache/mosaic/.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data"
CACHE = ROOT / "pipeline" / ".cache" / "mosaic"
UA = {"User-Agent": "dancing-with-sars-pipeline/1.0"}
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
RES = 0.025  # degrees per mosaic pixel (~2.8 km at the equator)
W, H = int(360 / RES), int(180 / RES)


def get(url: str, timeout: int = 120, retries: int = 4, headers=None):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={**UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read(), r.headers
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"{url[:90]}: {last}")


def list_granules(t0: str, t1: str):
    q = urllib.parse.urlencode({"short_name": "NISAR_L2_GCOV*", "options[short_name][pattern]": "true",
                                "provider": "ASF", "temporal": f"{t0},{t1}", "page_size": 2000, "sort_key": "start_date"})
    out, after = [], None
    while True:
        body, hdr = get(f"{CMR}?{q}", headers={"CMR-Search-After": after} if after else None)
        entries = json.loads(body)["feed"]["entry"]
        out += entries
        after = hdr.get("CMR-Search-After")
        if not entries or not after:
            break
    gs = []
    for e in out:
        png = next((l["href"] for l in e.get("links", []) if l["href"].startswith("https") and l["href"].endswith("_LATLON.png")), None)
        try:
            nums = list(map(float, e["polygons"][0][0].split()))
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        lats, lons = nums[0::2], nums[1::2]
        if not png or max(lons) - min(lons) > 180:
            continue  # no browse, or crosses the antimeridian
        parts = e["title"].split("_")
        mode = parts[9] if len(parts) > 9 else ""
        gs.append({"id": e["title"], "png": png, "lats": lats, "lons": lons, "time": e["time_start"],
                   "mode": mode, "dir": parts[6] if len(parts) > 6 else "", "size": float(e.get("granule_size") or 0)})
    # one product per scene (keep the latest processing)
    uniq = {}
    for g in gs:
        uniq[re.sub(r"_P\d{5}_.*$", "", g["id"])] = g
    return list(uniq.values())


def priority(g):
    return (1 if g["mode"].startswith("DH") or g["mode"].startswith("QP") else 0, g["time"])


def bounds_from_footprint(a: np.ndarray, lats, lons):
    """Geographic bounds of the whole browse image from its valid-pixel extent + footprint."""
    m = a.sum(axis=2) > 6
    if m.sum() < 100:
        return None
    ys, xs = np.nonzero(m)
    x_l, x_r, y_t, y_b = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    sx = (max(lons) - min(lons)) / max(x_r - x_l, 1)
    sy = (max(lats) - min(lats)) / max(y_b - y_t, 1)
    h, w = m.shape
    west = min(lons) - x_l * sx
    north = max(lats) + y_t * sy
    return west, north - h * sy, west + w * sx, north


def shrink(g):
    """Download one browse image, return (x0, y0, rgba patch at mosaic resolution)."""
    cp = CACHE / (g["id"] + ".png")
    meta = CACHE / (g["id"] + ".json")
    if cp.exists() and meta.exists():
        x0, y0 = json.loads(meta.read_text())
        return g, x0, y0, np.asarray(Image.open(cp))
    body, _ = get(g["png"])
    im = Image.open(io.BytesIO(body)).convert("RGB")
    small = im.reduce(4)  # quick 4x box reduction for the extent fit
    b = bounds_from_footprint(np.asarray(small).astype(np.int32), g["lats"], g["lons"])
    if not b:
        return g, None, None, None
    west, south, east, north = b
    x0 = (west + 180) / RES
    y0 = (90 - north) / RES
    pw = max(1, round((east - west) / RES))
    ph = max(1, round((north - south) / RES))
    patch = np.asarray(im.resize((pw, ph), Image.BOX)).astype(np.uint8)
    valid = np.asarray(Image.fromarray((np.asarray(im).astype(np.int32).sum(axis=2) > 6).astype(np.uint8) * 255)
                       .resize((pw, ph), Image.BOX)) > 110  # trim the dark resampling halo, keep neighbours touching
    rgba = np.dstack([patch, valid.astype(np.uint8) * 255])
    Image.fromarray(rgba, "RGBA").save(cp)
    meta.write_text(json.dumps([round(x0), round(y0)]))
    return g, round(x0), round(y0), rgba


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2026-10-01")
    ap.add_argument("--days", type=int, default=12)
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    d0 = date.fromisoformat(args.start)
    d1 = d0 + timedelta(days=args.days)
    cid = f"{d0:%Y%m%d}_{d1:%Y%m%d}"
    print(f"== NISAR GCOV mosaic {d0} → {d1}")
    gs = list_granules(f"{d0}T00:00:00Z", f"{d1}T00:00:00Z")
    gs.sort(key=priority)
    total_mb = sum(g["size"] for g in gs)
    print(f"   {len(gs)} granules with browse · HDF5 total would be {total_mb / 1e6:.1f} TB · browse download ≈ {len(gs) * 3.6 / 1000:.0f} GB")
    if args.dry_run:
        return
    CACHE.mkdir(parents=True, exist_ok=True)
    canvas = np.zeros((H, W, 4), np.uint8)
    done = fails = 0
    t0 = time.time()
    # download in parallel, paint strictly in priority order
    results = {}
    with ThreadPoolExecutor(args.workers) as ex:
        futs = {ex.submit(shrink, g): i for i, g in enumerate(gs)}
        nxt = 0
        for f in as_completed(futs):
            i = futs[f]
            try:
                results[i] = f.result()
            except Exception as e:  # noqa: BLE001
                results[i] = (gs[i], None, None, None)
                print(f"   ! {gs[i]['id'][:60]}: {e}", file=sys.stderr)
            while nxt in results:
                g, x0, y0, rgba = results.pop(nxt)
                nxt += 1
                if rgba is None:
                    fails += 1
                    continue
                ph, pw = rgba.shape[:2]
                ys0, xs0 = max(0, y0), max(0, x0)
                ys1, xs1 = min(H, y0 + ph), min(W, x0 + pw)
                if ys1 <= ys0 or xs1 <= xs0:
                    continue
                sub = rgba[ys0 - y0:ys1 - y0, xs0 - x0:xs1 - x0]
                m = sub[..., 3] > 0
                canvas[ys0:ys1, xs0:xs1][m] = sub[m]
                done += 1
                if done % 250 == 0:
                    el = time.time() - t0
                    print(f"   {done}/{len(gs)} painted · {el / 60:.1f} min · eta {el / done * (len(gs) - done) / 60:.0f} min", flush=True)

    # open ocean is mostly noise in L-band browse images: keep land (+~50 km coast) and polar seas (sea ice)
    wm = ROOT / "web" / "public" / "textures" / "earth-water.png"
    if wm.exists():
        water = np.asarray(Image.open(wm).convert("L")) > 128
        landm = ~water
        for _ in range(2):  # dilate the coarse land mask
            landm = landm | np.roll(landm, 1, 0) | np.roll(landm, -1, 0) | np.roll(landm, 1, 1) | np.roll(landm, -1, 1)
        keep = np.asarray(Image.fromarray(landm.astype(np.uint8) * 255).resize((W, H), Image.NEAREST)) > 0
        lat = 90 - (np.arange(H) + 0.5) * RES
        keep |= (np.abs(lat) > 60)[:, None]
        canvas[..., 3] = np.where(keep, canvas[..., 3], 0)
    land = canvas[..., 3] > 0
    print(f"   painted {done}, failed {fails}, covered {land.mean() * 100:.1f}% of the globe grid")
    out = OUT / "mosaic"
    out.mkdir(parents=True, exist_ok=True)
    img = Image.fromarray(canvas, "RGBA")
    for name, size in (("8k", (8192, 4096)), ("4k", (4096, 2048))):
        img.resize(size, Image.BOX).save(out / f"{cid}_{name}.webp", quality=80, method=6)
    from collections import Counter
    entry = {
        "id": cid, "start": str(d0), "end": str(d1 - timedelta(days=1)), "granules": done, "failed": fails,
        "modes": dict(Counter(g["mode"] for g in gs).most_common(6)),
        "coverage": round(float(land.mean()), 4), "resolutionDeg": RES,
        "img8k": f"mosaic/{cid}_8k.webp", "img4k": f"mosaic/{cid}_4k.webp",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    (out / f"{cid}.json").write_text(json.dumps(entry, indent=1))
    # rebuild the index from every cycle's own file (safe when several builds run in parallel)
    cycles = sorted((json.loads(f.read_text()) for f in out.glob("*.json")), key=lambda c: c["start"])
    (OUT / "mosaic.json").write_text(json.dumps({"cycles": cycles}, indent=1))
    print("wrote", out, f"({(time.time() - t0) / 60:.0f} min)")


if __name__ == "__main__":
    main()
