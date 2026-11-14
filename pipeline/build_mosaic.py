#!/usr/bin/env python3
"""
Worldwide NISAR L-band mosaic for one 12-day repeat cycle (no login required).

Every NISAR L2 GCOV granule acquired in the window is listed through NASA CMR.
Its public geocoded browse image (*_LATLON.png, R = HH, G = HV) is downloaded,
georeferenced from the granule footprint, shrunk to the mosaic resolution and
painted into one global equirectangular canvas. The full-size PNG is discarded
right away, so disk use stays small even though ~60 GB is streamed.

Open ocean and sea ice are masked with Natural Earth land + ice-shelf polygons.
Frames that cross the antimeridian are wrapped around.

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
        links = [l["href"] for l in e.get("links", []) if l["href"].startswith("https") and "/BROWSE/" in l["href"]]
        png = next((h for h in links if h.endswith("_LATLON.png")), None)
        beta = png is None
        if beta:   # beta products: geocoded browse named <granule>.png (map projection, not a lat/lon grid)
            png = next((h for h in links if h.endswith(e["title"] + ".png")), None)
        try:
            nums = list(map(float, e["polygons"][0][0].split()))
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        lats, lons = nums[0::2], nums[1::2]
        if not png:
            continue
        if beta and abs(sum(lats) / len(lats)) > 60:
            continue   # beta browse near the poles is polar-stereographic: a lat/lon fit would misplace it
        if max(lons) - min(lons) > 180:   # crosses the antimeridian: unwrap to one side (> 180°)
            lons = [x + 360 if x < 0 else x for x in lons]
        parts = e["title"].split("_")
        mode = parts[9] if len(parts) > 9 else ""
        gs.append({"id": e["title"], "png": png, "lats": lats, "lons": lons, "time": e["time_start"],
                   "mode": mode, "dir": parts[6] if len(parts) > 6 else "", "size": float(e.get("granule_size") or 0), "beta": beta})
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


def shrink(g, res=None, cache=None, lazy=False):
    """Download one browse image, return (x0, y0, rgba patch at `res` degrees per pixel).
    With lazy=True the cached file path is returned instead of the pixels (loaded later, saves RAM)."""
    res = res or RES
    cache = cache or CACHE
    cp = cache / (g["id"] + ".png")
    meta = cache / (g["id"] + ".json")
    if cp.exists() and meta.exists():
        x0, y0 = json.loads(meta.read_text())
        return g, x0, y0, (cp if lazy else np.asarray(Image.open(cp)))
    body, _ = get(g["png"])
    im = Image.open(io.BytesIO(body)).convert("RGB")
    small = im.reduce(4)  # quick 4x box reduction for the extent fit
    b = bounds_from_footprint(np.asarray(small).astype(np.int32), g["lats"], g["lons"])
    if not b:
        return g, None, None, None
    west, south, east, north = b
    x0 = (west + 180) / res
    y0 = (90 - north) / res
    pw = max(1, round((east - west) / res))
    ph = max(1, round((north - south) / res))
    patch = np.asarray(im.resize((pw, ph), Image.BOX)).astype(np.uint8)
    valid = np.asarray(Image.fromarray((np.asarray(im).astype(np.int32).sum(axis=2) > 6).astype(np.uint8) * 255)
                       .resize((pw, ph), Image.BOX)) > 110  # trim the dark resampling halo, keep neighbours touching
    rgba = np.dstack([patch, valid.astype(np.uint8) * 255])
    Image.fromarray(rgba, "RGBA").save(cp)
    meta.write_text(json.dumps([round(x0), round(y0)]))
    return g, round(x0), round(y0), (cp if lazy else rgba)


def paint(canvas, rgba, x0, y0):
    """Paste a patch, wrapping around the antimeridian (x is periodic)."""
    ph, pw = rgba.shape[:2]
    ys0, ys1 = max(0, y0), min(H, y0 + ph)
    if ys1 <= ys0:
        return
    for shift in (0, -W, W):
        xa = x0 + shift
        xs0, xs1 = max(0, xa), min(W, xa + pw)
        if xs1 <= xs0:
            continue
        sub = rgba[ys0 - y0:ys1 - y0, xs0 - xa:xs1 - xa]
        m = sub[..., 3] > 0
        canvas[ys0:ys1, xs0:xs1][m] = sub[m]


NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'


def land_mask(dilate_px=3):
    """Land + Antarctic ice shelves (Natural Earth 1:50m) rasterised on the mosaic grid, cached."""
    from PIL import ImageDraw, ImageFilter
    path = ROOT / 'pipeline' / '.cache' / f'landmask_{RES}_{dilate_px}.png'
    if path.exists():
        return np.asarray(Image.open(path)) > 0
    img = Image.new('L', (W, H), 0)
    draw = ImageDraw.Draw(img)
    for name in ('ne_50m_land.geojson', 'ne_50m_antarctic_ice_shelves_polys.geojson'):
        gj = json.loads(get(NE + name)[0])
        for f in gj['features']:
            g = f['geometry']
            polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
            for poly in polys:
                for k, ring in enumerate(poly):
                    pts = [((lo + 180) / RES, (90 - la) / RES) for lo, la in ring]
                    draw.polygon(pts, fill=255 if k == 0 else 0)
    if dilate_px:
        img = img.filter(ImageFilter.MaxFilter(2 * dilate_px + 1))
    img.save(path)
    return np.asarray(img) > 0


TILE_RES = 0.01      # ~1.1 km per pixel
TILE_DEG = 10        # 10° x 10° tiles of 1000 x 1000 px


def fetch_all(gs, workers, res, cache, lazy=False):
    """Download/shrink every frame in parallel. Returns [(g, x0, y0, rgba)] in painting priority order."""
    cache.mkdir(parents=True, exist_ok=True)
    res_list = [None] * len(gs)
    fails = 0
    t0 = time.time()
    with ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(shrink, g, res, cache, lazy): i for i, g in enumerate(gs)}
        for k, f in enumerate(as_completed(futs)):
            i = futs[f]
            try:
                r = f.result()
                if r[3] is not None: res_list[i] = r
                else: fails += 1
            except Exception as e:  # noqa: BLE001
                fails += 1
                print(f"   ! {gs[i]['id'][:60]}: {e}", file=sys.stderr)
            if (k + 1) % 1000 == 0:
                el = time.time() - t0
                print(f"   {k + 1}/{len(gs)} frames · {el / 60:.1f} min · eta {el / (k + 1) * (len(gs) - k - 1) / 60:.0f} min", flush=True)
    return [r for r in res_list if r is not None], fails


def _ix(y0, x0, ph, pw, Hc, Wc, row0=0):
    """Row/column index arrays of a patch on a (band of the) global grid, with longitude wrap-around."""
    rows = np.arange(y0, y0 + ph) - row0
    keep = (rows >= 0) & (rows < Hc)
    cols = (np.arange(x0, x0 + pw)) % Wc
    return rows[keep], keep, cols


def _load(p):
    return p if isinstance(p, np.ndarray) else np.asarray(Image.open(p))


def _height(p):
    return p.shape[0] if isinstance(p, np.ndarray) else Image.open(p).size[1]


def _weight(alpha, mode, feather_px):
    from scipy import ndimage
    m = alpha > 0
    d = ndimage.distance_transform_edt(np.pad(m, 1))[1:-1, 1:-1]
    w = np.clip(d / feather_px, 0, 1) ** 1.5
    dual = mode.startswith("DH") or mode.startswith("QP")
    return (w * (1.0 if dual else 0.03)).astype(np.float32)


def blend(patches, Hc, Wc, row0, land, feather_px, gains=None):
    """Seamless mosaic: feathered weighted mean of all frames, then every frame's brightness is matched
    (per channel gain/offset) to the consensus of its neighbours and the frames are blended again.
    If `gains` is given (from a coarser pass) the matching step is skipped and those gains are applied."""
    def accumulate(gain_of):
        acc = np.zeros((Hc, Wc, 3), np.float32)
        wsum = np.zeros((Hc, Wc), np.float32)
        for g, x0, y0, rgba in patches:
            rgba = _load(rgba)
            ph, pw = rgba.shape[:2]
            rows, keep, cols = _ix(y0, x0, ph, pw, Hc, Wc, row0)
            if not len(rows): continue
            w = _weight(rgba[..., 3], g["mode"], feather_px)[keep]
            px = rgba[keep, :, :3].astype(np.float32)
            gn = gain_of(g)
            if gn is not None:
                px = np.clip(px * gn[0] + gn[1], 0, 255)
            ix = np.ix_(rows, cols)
            acc[ix] += px * w[..., None]
            wsum[ix] += w
        return acc, wsum

    if gains is None:
        acc, wsum = accumulate(lambda g: None)
        ref = (acc / np.maximum(wsum, 1e-6)[..., None]).astype(np.uint8)
        del acc
        gains = {}
        for g, x0, y0, rgba in patches:
            rgba = _load(rgba)
            ph, pw = rgba.shape[:2]
            rows, keep, cols = _ix(y0, x0, ph, pw, Hc, Wc, row0)
            m = (rgba[keep, :, 3] > 0) & (wsum[np.ix_(rows, cols)] > 0)
            if m.sum() < 50: continue
            pv = rgba[keep, :, :3][m].astype(np.float32); rv = ref[np.ix_(rows, cols)][m].astype(np.float32)
            gn, of = [], []
            for c in range(3):
                p20, p50, p80 = np.percentile(pv[:, c], (20, 50, 80))
                r20, r50, r80 = np.percentile(rv[:, c], (20, 50, 80))
                k = float(np.clip((r80 - r20) / max(p80 - p20, 1.0), 0.6, 1.6))
                gn.append(k); of.append(float(r50 - k * p50))
            gains[g["id"]] = (np.array(gn, np.float32), np.array(of, np.float32))
        del ref, wsum
    acc, wsum = accumulate(lambda g: gains.get(g["id"]))
    out = np.zeros((Hc, Wc, 4), np.uint8)
    out[..., :3] = np.clip(acc / np.maximum(wsum, 1e-6)[..., None], 0, 255).astype(np.uint8)
    del acc
    out[..., 3] = ((wsum > 1e-4) & land).astype(np.uint8) * 255
    return out, gains


def build_tiles(gs, gains, cid, workers, out):
    """High-resolution 10° tiles (1000 x 1000 px, ~1.1 km) for zooming in; land tiles only."""
    tcache = ROOT / "pipeline" / ".cache" / f"mosaic_{TILE_RES}"
    print(f"   tiles: fetching frames at {TILE_RES}°/px", flush=True)
    patches, _ = fetch_all(gs, workers, TILE_RES, tcache, lazy=True)
    heights = {id(p): _height(p[3]) for p in patches}
    Wt, Ht = int(360 / TILE_RES), int(180 / TILE_RES)
    n = int(TILE_DEG / TILE_RES)
    land_lo = land_mask()
    tdir = out / "tiles" / cid
    tdir.mkdir(parents=True, exist_ok=True)
    tiles = []
    for r in range(Ht // n):
        band_rows = (r * n, (r + 1) * n)
        sel = [p for p in patches if p[2] < band_rows[1] and p[2] + heights[id(p)] > band_rows[0]]
        if not sel: continue
        land = np.asarray(Image.fromarray(land_lo[int(band_rows[0] * TILE_RES / RES):int(band_rows[1] * TILE_RES / RES)].astype(np.uint8) * 255)
                          .resize((Wt, n), Image.NEAREST)) > 0
        band, _ = blend(sel, n, Wt, band_rows[0], land, feather_px=40, gains=gains)
        for c in range(Wt // n):
            t = band[:, c * n:(c + 1) * n]
            if t[..., 3].any():
                Image.fromarray(t, "RGBA").save(tdir / f"{r}_{c}.webp", quality=82, method=4)
                tiles.append([r, c])
        print(f"   tiles: band {r + 1}/{Ht // n} done ({len(tiles)} tiles so far)", flush=True)
        del band
    return {"deg": TILE_DEG, "px": n, "path": f"mosaic/tiles/{cid}", "list": tiles}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2026-10-01")
    ap.add_argument("--days", type=int, default=12)
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--tiles", action="store_true", help=f"also write {TILE_DEG}° tiles at {TILE_RES}° per pixel for zoomed-in viewing")
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
    t0 = time.time()
    patches, fails = fetch_all(gs, args.workers, RES, CACHE)
    print(f"   {len(patches)} frames ready, {fails} failed · {(time.time() - t0) / 60:.1f} min", flush=True)
    land = land_mask()
    canvas, gains = blend(patches, H, W, 0, land, feather_px=16)
    done = len(patches)
    covered = canvas[..., 3] > 0
    print(f"   blended {done} frames, covered {covered.mean() * 100:.1f}% of the globe grid")
    out = OUT / "mosaic"
    out.mkdir(parents=True, exist_ok=True)
    img = Image.fromarray(canvas, "RGBA")
    for name, size in (("8k", (8192, 4096)), ("4k", (4096, 2048))):
        img.resize(size, Image.BOX).save(out / f"{cid}_{name}.webp", quality=80, method=6)
    from collections import Counter
    entry = {
        "id": cid, "start": str(d0), "end": str(d1 - timedelta(days=1)), "granules": done, "failed": fails,
        "modes": dict(Counter(g["mode"] for g in gs).most_common(6)),
        "coverage": round(float(covered.mean()), 4), "resolutionDeg": RES, "betaFrames": sum(g["beta"] for g in gs),
        "img8k": f"mosaic/{cid}_8k.webp", "img4k": f"mosaic/{cid}_4k.webp",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if args.tiles:
        entry["tiles"] = build_tiles(gs, gains, cid, args.workers, out)
    (out / f"{cid}.json").write_text(json.dumps(entry, indent=1))
    # rebuild the index from every cycle's own file (safe when several builds run in parallel)
    cycles = sorted((json.loads(f.read_text()) for f in out.glob("*.json")), key=lambda c: c["start"])
    (OUT / "mosaic.json").write_text(json.dumps({"cycles": cycles}, indent=1))
    print("wrote", out, f"({(time.time() - t0) / 60:.0f} min)")


if __name__ == "__main__":
    main()
