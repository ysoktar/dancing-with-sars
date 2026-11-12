#!/usr/bin/env python3
"""
Optional: replace browse-image crops with CALIBRATED NISAR GCOV backscatter.

The public pipeline (build_data.py) uses 8-bit browse PNGs. This script opens
the real GCOV HDF5 granules listed in catalog.json (streamed over HTTPS, so
only the AOI chunks are downloaded, not the 1–2 GB file), extracts gamma-naught
HH and HV for each site's window, and writes:

  web/public/data/sites/<id>/<date>.png   R/G = gamma0 dB mapped linearly
                                           from [-30, 0] dB to [0, 255]
  catalog.json  acquisitions[*].hh_db / hv_db, site.calibrated = true

Requirements:
  pip install earthaccess h5py pyproj numpy pillow
  A free NASA Earthdata account: https://urs.earthdata.nasa.gov
  (earthaccess reads EARTHDATA_USERNAME / EARTHDATA_PASSWORD or ~/.netrc,
   or prompts interactively.)

Usage:
  python pipeline/fetch_hdf5.py --site konya
  python pipeline/fetch_hdf5.py --site konya sylhet --freq A

NOTE: written against the NISAR L2 GCOV product specification
(/science/LSAR/GCOV/grids/frequencyA/{HHHH,HVHV,xCoordinates,yCoordinates,projection}).
The script looks datasets up by name, so small layout changes between
product versions are tolerated.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"
CROP = 256
DB_MIN, DB_MAX = -30.0, 0.0


def find(h5, name: str, freq: str):
    """Locate a dataset under the GCOV grids for the requested frequency."""
    hits = []

    def visit(path, obj):
        if path.endswith("/" + name) and f"frequency{freq}" in path:
            hits.append(path)

    h5.visititems(visit)
    if not hits:
        raise KeyError(f"{name} (frequency{freq}) not found")
    return h5[sorted(hits, key=len)[0]]


def epsg_of(h5, freq: str) -> int:
    proj = find(h5, "projection", freq)
    for key in ("epsg_code", "epsg", "EPSG"):
        if key in proj.attrs:
            return int(np.asarray(proj.attrs[key]).ravel()[0])
    return int(np.asarray(proj[()]).ravel()[0])


def to_db(x):
    with np.errstate(divide="ignore", invalid="ignore"):
        return 10 * np.log10(np.where(x > 0, x, np.nan))


def crop_granule(fobj, site: dict, freq: str):
    import h5py
    from pyproj import Transformer

    with h5py.File(fobj, "r") as h5:
        xs = find(h5, "xCoordinates", freq)[()]
        ys = find(h5, "yCoordinates", freq)[()]
        epsg = epsg_of(h5, freq)
        tr = Transformer.from_crs(4326, epsg, always_xy=True)
        lat, lon, half = site["lat"], site["lon"], site["half_deg"]
        hl = half / max(math.cos(math.radians(lat)), 0.05)
        corners = [tr.transform(lon + dx, lat + dy) for dx in (-hl, hl) for dy in (-half, half)]
        cx = [c[0] for c in corners]
        cy = [c[1] for c in corners]

        def idx(coords, lo, hi):
            asc = coords[1] > coords[0]
            a = np.searchsorted(coords if asc else -coords, lo if asc else -hi)
            b = np.searchsorted(coords if asc else -coords, hi if asc else -lo)
            return max(0, int(a)), min(len(coords), int(b))

        x0, x1 = idx(xs, min(cx), max(cx))
        y0, y1 = idx(ys, min(cy), max(cy))
        if x1 - x0 < 8 or y1 - y0 < 8:
            return None
        out = {}
        for pol in ("HHHH", "HVHV"):
            try:
                arr = find(h5, pol, freq)[y0:y1, x0:x1].astype(np.float32)
            except KeyError:
                arr = None
            out[pol] = arr
        return out


def to_png(hh, hv, path: Path):
    def scale(a):
        db = to_db(a)
        img = Image.fromarray(np.nan_to_num((db - DB_MIN) / (DB_MAX - DB_MIN) * 255, nan=0).clip(0, 255).astype(np.uint8))
        return np.asarray(img.resize((CROP, CROP), Image.BOX)), db

    h8, hdb = scale(hh)
    v8, vdb = scale(hv if hv is not None else hh)
    valid = (h8 > 0).astype(np.uint8) * 255
    Image.fromarray(np.dstack([h8, v8, valid])).save(path, optimize=True)
    return float(np.nanmean(hdb)), float(np.nanmean(vdb))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", nargs="+", required=True)
    ap.add_argument("--freq", default="A", help="A (main band) or B (side band)")
    args = ap.parse_args()

    import earthaccess

    earthaccess.login()
    cat_path = DATA / "catalog.json"
    cat = json.loads(cat_path.read_text())
    for site in cat["sites"]:
        if site["id"] not in args.site:
            continue
        print(f"== {site['id']}")
        urls = [a["h5"] for a in site["acquisitions"]]
        files = earthaccess.open(urls)
        for a, f in zip(site["acquisitions"], files):
            try:
                res = crop_granule(f, site, args.freq)
            except Exception as e:  # noqa: BLE001
                print(f"   ! {a['date']}: {e}")
                continue
            if not res or res.get("HHHH") is None:
                print(f"   ! {a['date']}: AOI not in grid")
                continue
            hh_db, hv_db = to_png(res["HHHH"], res.get("HVHV"), DATA / a["crop"])
            a["hh_db"], a["hv_db"] = round(hh_db, 2), round(hv_db, 2)
            print(f"   {a['date']}: HH {hh_db:.1f} dB, HV {hv_db:.1f} dB")
        site["calibrated"] = {"freq": args.freq, "dbRange": [DB_MIN, DB_MAX]}
    cat_path.write_text(json.dumps(cat, separators=(",", ":")))
    print("updated", cat_path)


if __name__ == "__main__":
    main()
