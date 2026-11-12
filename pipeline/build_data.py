#!/usr/bin/env python3
"""
Dancing with the SARs: NISAR data pipeline (no login required)
===============================================================

Pulls *real* NISAR L-band Level-2 GCOV (Geocoded Polarimetric Covariance)
acquisitions for every study site from the Alaska Satellite Facility (ASF)
search API and turns them into small web-ready assets:

  web/public/data/catalog.json            site list + every acquisition + stats
  web/public/data/sites/<id>/<date>.png   256x256 AOI crop (R=HH, G=HV, B=valid)
  web/public/data/sites/<id>/f_<date>.webp  whole radar frame, transparent, for the 3D globe
  web/public/data/coverage.json           monthly global NISAR GCOV acquisition density

The source imagery is the public, geocoded browse product that ASF publishes
next to each GCOV HDF5 granule (`*_LATLON.png` + its `*_LATLON.kml`
ground-overlay bounds). In those dual-pol browse images R = HH, G = HV and
B = HH. Values are 8-bit display brightness, not calibrated gamma-naught;
`fetch_hdf5.py` swaps in calibrated values if you have an Earthdata login.

Usage:
    python pipeline/build_data.py                 # all sites
    python pipeline/build_data.py --sites konya   # one site
    python pipeline/build_data.py --max-dates 30 --workers 8
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data"
CACHE = ROOT / "pipeline" / ".cache"
SEARCH = "https://api.daac.asf.alaska.edu/services/search/param"
CROP = 256          # AOI crop size (pixels)
FRAME_MAX = 640     # longest side of globe frame overlays
UA = {"User-Agent": "dancing-with-sars-pipeline/1.0"}


# --------------------------------------------------------------------------- http
def http_get(url: str, retries: int = 4, timeout: int = 120) -> bytes:
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 ** i)
    raise RuntimeError(f"GET failed after {retries} tries: {url}: {last}")


def search(params: dict) -> bytes:
    q = {"dataset": "NISAR", **params}
    return http_get(SEARCH + "?" + urllib.parse.urlencode(q))


def cached(url: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    name = re.sub(r"[^A-Za-z0-9_.-]", "_", url.rsplit("/", 1)[-1])
    p = CACHE / name
    if p.exists() and p.stat().st_size > 0:
        return p.read_bytes()
    b = http_get(url)
    p.write_bytes(b)
    return b


# --------------------------------------------------------------------------- geo
def parse_kml_bounds(kml: bytes) -> tuple[float, float, float, float]:
    """Return (west, south, east, north) from a LatLonQuad / LatLonBox overlay."""
    txt = kml.decode("utf-8", "replace")
    m = re.search(r"<coordinates>\s*([^<]+)</coordinates>", txt)
    if m:
        pts = [tuple(map(float, p.split(",")[:2])) for p in m.group(1).split()]
        lons = [p[0] for p in pts]
        lats = [p[1] for p in pts]
        return min(lons), min(lats), max(lons), max(lats)
    box = {k: float(re.search(fr"<{k}>([^<]+)</{k}>", txt).group(1)) for k in ("north", "south", "east", "west")}
    return box["west"], box["south"], box["east"], box["north"]


def wkt_contains_box(wkt: str, w: float, s: float, e: float, n: float) -> bool:
    """True when all four AOI corners fall inside the footprint polygon."""
    nums = list(map(float, re.findall(r"-?\d+\.?\d*", wkt)))
    poly = list(zip(nums[0::2], nums[1::2]))

    def inside(x, y):
        c = False
        for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
            if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1:
                c = not c
        return c

    return all(inside(x, y) for x, y in ((w, s), (w, n), (e, s), (e, n)))


def bounds_from_footprint(im: Image.Image, wkt: str):
    """Recover the LATLON browse image bounds without its KML.

    The footprint polygon's west/east/north/south-most vertices coincide with
    the left/right/top/bottom-most valid pixels of the geocoded browse image
    (verified against products that do ship a KML), so a per-axis linear fit
    gives the geographic bounds of the full image.
    """
    a = np.asarray(im.reduce(2)).astype(int).sum(axis=2) > 6
    if not a.any():
        return None
    ys, xs = np.nonzero(a)
    f = 2.0
    x_l, x_r = xs.min() * f, (xs.max() + 1) * f
    y_t, y_b = ys.min() * f, (ys.max() + 1) * f
    nums = list(map(float, re.findall(r"-?\d+\.?\d*", wkt)))
    lons, lats = nums[0::2], nums[1::2]
    if max(lons) - min(lons) > 180:  # antimeridian: skip
        return None
    sx = (max(lons) - min(lons)) / max(x_r - x_l, 1)
    sy = (max(lats) - min(lats)) / max(y_b - y_t, 1)
    w_px, h_px = im.size
    W = min(lons) - x_l * sx
    N = max(lats) + y_t * sy
    return W, N - h_px * sy, W + w_px * sx, N


# --------------------------------------------------------------------------- image ops
def otsu(values: np.ndarray) -> float:
    hist, edges = np.histogram(values, bins=256, range=(0, 256))
    p = hist.astype(float) / max(hist.sum(), 1)
    omega = np.cumsum(p)
    mu = np.cumsum(p * np.arange(256))
    mu_t = mu[-1]
    sigma_b = (mu_t * omega - mu) ** 2 / (omega * (1 - omega) + 1e-12)
    return float(np.argmax(sigma_b))


def wkt_bbox(wkt: str):
    nums = list(map(float, re.findall(r"-?\d+\.?\d*", wkt)))
    return min(nums[0::2]), min(nums[1::2]), max(nums[0::2]), max(nums[1::2])


def aoi_box(site: dict, scale: float = 1.0):
    lat, lon, half = site["lat"], site["lon"], site["half_deg"] * scale
    hl = half / max(math.cos(math.radians(lat)), 0.05)
    return lon - hl, lat - half, lon + hl, lat + half


def sample(im: Image.Image, bounds, box, size: int) -> np.ndarray:
    """Resample the geographic window `box` of a LATLON browse image to size x size (RGB float)."""
    W, S, E, N = bounds
    w_px, h_px = im.size
    x0 = (box[0] - W) / (E - W) * w_px
    x1 = (box[2] - W) / (E - W) * w_px
    y0 = (N - box[3]) / (N - S) * h_px
    y1 = (N - box[1]) / (N - S) * h_px
    ix0, iy0, ix1, iy1 = math.floor(x0), math.floor(y0), math.ceil(x1), math.ceil(y1)
    c = im.crop((ix0, iy0, ix1, iy1))  # out-of-frame area is filled with 0 (= no data)
    out = c.resize((size, size), Image.BOX, box=(x0 - ix0, y0 - iy0, x1 - ix0, y1 - iy0))
    return np.asarray(out).astype(np.float32)


def phase_shift(a: np.ndarray, b: np.ndarray):
    """Integer-pixel translation between two images by phase correlation (peak, confidence)."""
    a = a - a.mean()
    b = b - b.mean()
    win = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))
    F = np.fft.fft2(a * win) * np.conj(np.fft.fft2(b * win))
    F /= np.abs(F) + 1e-9
    r = np.fft.ifft2(F).real
    y, x = np.unravel_index(int(r.argmax()), r.shape)
    if y > a.shape[0] // 2:
        y -= a.shape[0]
    if x > a.shape[1] // 2:
        x -= a.shape[1]
    conf = float(r.max() / (r.std() + 1e-9))
    return int(y), int(x), conf


def load_granule(g: dict, ref_bounds=None):
    """Download a granule's LATLON browse image and work out first-guess geographic bounds."""
    png_url = next((b for b in g.get("browse") or [] if b.endswith("_LATLON.png")), None)
    if not png_url:
        return None
    try:
        im = Image.open(io.BytesIO(cached(png_url))).convert("RGB")
    except Exception as e:  # noqa: BLE001
        print(f"   ! {g['productID'][:60]}: {e}", file=sys.stderr)
        return None
    has_kml = True
    try:
        bounds = parse_kml_bounds(cached(png_url[:-4] + ".kml"))
    except Exception:  # noqa: BLE001  (provisional products ship without the KML)
        has_kml = False
        bounds = bounds_from_footprint(im, g["wkt"])
        if bounds is None:
            return None
    return {"g": g, "im": im, "bounds": list(bounds), "kml": has_kml, "png": png_url}


COREG = 384  # co-registration window size (pixels)


def coregister(items: list[dict], site: dict) -> None:
    """Align every acquisition of the stack to one reference by phase correlation.

    Geocoded browse frames of the same track can disagree by several km when the
    exact overlay bounds are not published (provisional products), so each
    frame's bounds are nudged until its AOI window matches the reference.
    """
    if len(items) < 2:
        return
    kml_items = [it for it in items if it["kml"]]
    ref = kml_items[-1] if kml_items else items[len(items) // 2]
    box = aoi_box(site, 2.2)
    wdx = (box[2] - box[0]) / COREG
    wdy = (box[3] - box[1]) / COREG

    def feat(it):
        a = sample(it["im"], it["bounds"], box, COREG)
        v = a.sum(axis=2) > 3
        f = np.log1p(a[..., 0] + a[..., 1])
        f[~v] = f[v].mean() if v.any() else 0
        return f

    ref_f = feat(ref)
    for it in items:
        if it is ref:
            it["shift"] = [0, 0]
            continue
        total = [0.0, 0.0]
        for _ in range(4):
            dy, dx, conf = phase_shift(ref_f, feat(it))
            if conf < 6 or (abs(dy) > COREG // 3 or abs(dx) > COREG // 3):
                break
            if dx == 0 and dy == 0:
                break
            it["bounds"][0] += dx * wdx
            it["bounds"][2] += dx * wdx
            it["bounds"][1] -= dy * wdy
            it["bounds"][3] -= dy * wdy
            total[0] += dy
            total[1] += dx
        res = phase_shift(ref_f, feat(it))
        it["ok"] = res[0] == 0 and res[1] == 0
        it["delta"] = total
        it["shift"] = [round(total[0] * wdy * 111.32, 2), round(total[1] * wdx * 111.32 * math.cos(math.radians(site["lat"])), 2)]
        it["residual"] = res[:2]
    # frames that would not lock on (e.g. a flood changed the whole scene) take the median offset of the rest
    good = [it["delta"] for it in items if it is not ref and it.get("ok") and not it["kml"]]
    if good:
        my, mx = float(np.median([d[0] for d in good])), float(np.median([d[1] for d in good]))
        for it in items:
            if it is ref or it.get("ok") or it["kml"]:
                continue
            it["bounds"][0] += (mx - it["delta"][1]) * wdx
            it["bounds"][2] += (mx - it["delta"][1]) * wdx
            it["bounds"][1] -= (my - it["delta"][0]) * wdy
            it["bounds"][3] -= (my - it["delta"][0]) * wdy
            it["shift"] = [round(my * wdy * 111.32, 2), round(mx * wdx * 111.32 * math.cos(math.radians(site["lat"])), 2)]
            it["residual"] = ("median", "fallback")


def nodata_free(a: np.ndarray, win: int = 11, frac: float = 0.8) -> np.ndarray:
    """Valid-data mask. Real dark pixels (calm water) are 0 too, so a pixel only
    counts as no-data when most of its neighbourhood is 0 as well (frame edge)."""
    zero = (a[..., 0] + a[..., 1] <= 3).astype(np.float32)
    r = win // 2
    p = np.pad(zero, r, mode="edge")
    c = p.cumsum(0).cumsum(1)
    c = np.pad(c, ((1, 0), (1, 0)))
    box = c[win:, win:] - c[:-win, win:] - c[win:, :-win] + c[:-win, :-win]
    return ~((box / (win * win) > frac) & (zero > 0))


def finalize(it: dict, site: dict, out_dir: Path) -> dict | None:
    g, im, bounds = it["g"], it["im"], it["bounds"]
    a = sample(im, bounds, aoi_box(site), CROP)
    valid = nodata_free(a)
    vf = float(valid.mean())
    if vf < 0.85:
        return None

    hh, hv = a[..., 0], a[..., 1]
    d = g["startTime"][:10]
    rgb = np.zeros((CROP, CROP, 3), np.uint8)
    rgb[..., 0] = np.clip(hh, 0, 255)
    rgb[..., 1] = np.clip(hv, 0, 255)
    rgb[..., 2] = valid * 255
    Image.fromarray(rgb).save(out_dir / f"{d}.png", optimize=True)

    # Whole frame for the globe, black -> transparent
    fr = im.copy()
    fr.thumbnail((FRAME_MAX, FRAME_MAX), Image.BOX)
    fa = np.asarray(fr)
    alpha = ((fa.astype(int).sum(axis=2) > 6) * 255).astype(np.uint8)
    Image.fromarray(np.dstack([fa, alpha]), "RGBA").save(out_dir / f"f_{d}.webp", quality=72, method=6)

    v_hh, v_hv = hh[valid], hv[valid]
    return {
        "date": d,
        "time": g["startTime"],
        "granule": g["productID"],
        "collection": g.get("collectionName"),
        "path": g.get("path"),
        "frame": g.get("frame"),
        "dir": g.get("flightDirection"),
        "crid": g.get("crid"),
        "pols": g.get("mainBandPolarization"),
        "h5": g.get("downloadUrl"),
        "browse": it["png"],
        "frameBounds": [round(v, 5) for v in bounds],
        "coregShiftKm": it.get("shift", [0, 0]),
        "crop": f"sites/{site['id']}/{d}.png",
        "frameImg": f"sites/{site['id']}/f_{d}.webp",
        "valid": round(vf, 3),
        "hh": round(float(v_hh.mean()), 2),
        "hv": round(float(v_hv.mean()), 2),
        "hh_sd": round(float(v_hh.std()), 2),
        "hv_sd": round(float(v_hv.std()), 2),
        "ratio": round(float((v_hv + 1).mean() / (v_hh + 1).mean()), 4),
        "_hh_vals": v_hh,  # removed before writing
    }


# --------------------------------------------------------------------------- sites
def choose_track(granules: list[dict], site: dict) -> tuple:
    lat, lon, half = site["lat"], site["lon"], site["half_deg"]
    hl = half / max(math.cos(math.radians(lat)), 0.05)
    box = (lon - hl, lat - half, lon + hl, lat + half)
    granules = [g for g in granules if any(b.endswith("_LATLON.png") for b in g.get("browse") or [])]
    ok = [g for g in granules if g.get("wkt") and wkt_contains_box(g["wkt"], *box)]
    pool = ok or granules
    cnt = Counter((g.get("path"), g.get("frame"), g.get("flightDirection")) for g in pool)
    return cnt.most_common(1)[0][0], len(ok)


def build_site(site: dict, max_dates: int, workers: int) -> dict:
    print(f"\n== {site['id']}: {site['name']}")
    raw = search({
        "processingLevel": "GCOV",
        "intersectsWith": f"POINT({site['lon']} {site['lat']})",
        "output": "jsonlite",
        "maxResults": 2000,
    })
    granules = json.loads(raw)["results"]
    if not granules:
        print("   no granules")
        return {**site, "acquisitions": [], "allAcquisitions": 0}
    track, n_full = choose_track(granules, site)
    print(f"   {len(granules)} GCOV granules, {n_full} fully cover AOI; using path/frame/dir = {track}")

    # one product per date on the chosen track (keep latest processing / validated over provisional)
    by_date: dict[str, dict] = {}
    for g in granules:
        if (g.get("path"), g.get("frame"), g.get("flightDirection")) != track:
            continue
        d = g["startTime"][:10]
        prev = by_date.get(d)
        score = ("PROVISIONAL" not in g.get("collectionName", ""), g.get("crid", ""))
        if prev is None or score > prev[0]:
            by_date[d] = (score, g)
    chosen = [v[1] for _, v in sorted(by_date.items())]
    if max_dates and len(chosen) > max_dates:
        idx = np.unique(np.linspace(0, len(chosen) - 1, max_dates).round().astype(int))
        chosen = [chosen[i] for i in idx]

    out_dir = OUT / "sites" / site["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    for f in out_dir.glob("*"):
        f.unlink()

    with ThreadPoolExecutor(workers) as ex:
        items = [it for it in ex.map(load_granule, chosen) if it]
    print(f"   loaded {len(items)} browse frames ({sum(it['kml'] for it in items)} with published KML bounds)")
    coregister(items, site)
    for it in items:
        if it.get("residual"):
            print(f"     {it['g']['startTime'][:10]}  shift {it['shift']} km   residual px {it['residual']}")
    with ThreadPoolExecutor(workers) as ex:
        results = list(ex.map(lambda it: finalize(it, site, out_dir), items))
    del items
    acqs = [r for r in results if r]

    # site-level water/dark threshold from the whole stack (Otsu on HH)
    if acqs:
        allv = np.concatenate([a["_hh_vals"] for a in acqs])
        thr = otsu(allv)
        for a in acqs:
            a["dark"] = round(float((a["_hh_vals"] < thr).mean()), 4)
    else:
        thr = None
    for a in acqs:
        a.pop("_hh_vals")
    print(f"   kept {len(acqs)} dates  ({acqs[0]['date'] if acqs else '-'} → {acqs[-1]['date'] if acqs else '-'}), Otsu HH thr = {thr}")

    all_dates = sorted({g["startTime"][:10] for g in granules})
    return {
        **site,
        "track": {"path": track[0], "frame": track[1], "dir": track[2]},
        "otsuHH": thr,
        "allAcquisitions": len(granules),
        "allDates": all_dates,
        "acquisitions": acqs,
    }


# --------------------------------------------------------------------------- coverage
def month_iter(start: date, end: date):
    d = date(start.year, start.month, 1)
    while d <= end:
        nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
        yield d, nxt
        d = nxt


CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"


def cmr_granules(t0: str, t1: str, page_size: int = 2000):
    """All NISAR GCOV collections (beta / provisional / validated) via NASA CMR. Returns (hits, entries)."""
    q = urllib.parse.urlencode({
        "short_name": "NISAR_L2_GCOV*", "options[short_name][pattern]": "true", "provider": "ASF",
        "temporal": f"{t0},{t1}", "page_size": page_size,
    })
    req = urllib.request.Request(f"{CMR}?{q}", headers=UA)
    for i in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                hits = int(r.headers.get("CMR-Hits", 0))
                return hits, json.load(r)["feed"]["entry"]
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(2 ** i)
    raise RuntimeError(err)


def build_coverage(start: date, end: date, grid: float = 3.0, footprints: int = 500) -> dict:
    """Monthly global NISAR GCOV acquisition density + a sample of real frame footprints."""
    print("\n== global coverage (NASA CMR)")
    rng = np.random.default_rng(7)
    months = []
    for m0, m1 in month_iter(start, end):
        total, _ = cmr_granules(f"{m0}T00:00:00Z", f"{m1}T00:00:00Z", page_size=1)
        bins: Counter = Counter()
        polys = []
        sampled = 0
        if total:
            for k in range(4):  # four 1-day windows spread through the month
                d0 = m0 + timedelta(days=1 + 7 * k)
                if d0 >= m1:
                    break
                try:
                    _, entries = cmr_granules(f"{d0}T00:00:00Z", f"{d0 + timedelta(days=1)}T00:00:00Z")
                except Exception as e:  # noqa: BLE001
                    print(f"   ! {d0}: {e}")
                    continue
                for e in entries:
                    try:
                        nums = list(map(float, e["polygons"][0][0].split()))
                    except (KeyError, IndexError, TypeError, ValueError):
                        continue
                    lats, lons = nums[0::2], nums[1::2]
                    if max(lons) - min(lons) > 180:
                        continue
                    la, lo = sum(lats[:-1]) / (len(lats) - 1), sum(lons[:-1]) / (len(lons) - 1)
                    bins[(math.floor(la / grid) * grid + grid / 2, math.floor(lo / grid) * grid + grid / 2)] += 1
                    sampled += 1
                    polys.append([[round(x, 2), round(y, 2)] for y, x in zip(lats, lons)])
        if len(polys) > footprints:
            polys = [polys[i] for i in sorted(rng.choice(len(polys), footprints, replace=False))]
        scale = total / sampled if sampled else 0
        months.append({
            "month": m0.strftime("%Y-%m"),
            "total": total,
            "sampled": sampled,
            "bins": [[round(la, 2), round(lo, 2), round(c * scale, 1)] for (la, lo), c in bins.items()],
            "footprints": polys,
        })
        print(f"   {m0:%Y-%m}: {total:6d} granules, sampled {sampled}")
    return {"grid": grid, "product": "GCOV", "source": "NASA CMR", "months": months}


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", nargs="*", help="site ids (default: all)")
    ap.add_argument("--max-dates", type=int, default=30)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--skip-coverage", action="store_true")
    args = ap.parse_args()

    sites = json.loads((ROOT / "pipeline" / "sites.json").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    cat_path = OUT / "catalog.json"
    old = {s["id"]: s for s in json.loads(cat_path.read_text())["sites"]} if cat_path.exists() else {}

    out_sites = []
    for s in sites:
        if args.sites and s["id"] not in args.sites:
            if s["id"] in old:
                out_sites.append(old[s["id"]])
            continue
        out_sites.append(build_site(s, args.max_dates, args.workers))

    catalog = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "ASF DAAC — NISAR L2 GCOV browse (geocoded LATLON), https://search.asf.alaska.edu",
        "channels": {"R": "HH", "G": "HV", "B": "valid mask"},
        "sites": out_sites,
    }
    cat_path.write_text(json.dumps(catalog, separators=(",", ":")))
    print(f"\nwrote {cat_path}")

    if not args.skip_coverage:
        dates = [a["date"] for s in out_sites for a in s.get("acquisitions", [])]
        start = date(2025, 10, 1)
        end = datetime.now(timezone.utc).date()
        cov = build_coverage(start, end)
        (OUT / "coverage.json").write_text(json.dumps(cov, separators=(",", ":")))
        print(f"wrote {OUT / 'coverage.json'}")


if __name__ == "__main__":
    main()
