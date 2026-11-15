#!/usr/bin/env python3
"""Precompute calibrated NISAR stacks (GCOV gamma-naught, dB) for a list of areas, so the website opens them instantly.

For every area in pipeline/cal_regions.json ({"id", "name", "box": [w, s, e, n]}):
  1. ASF search: GCOV granules over the box; the track (path + direction) with the most dates that fully cover it;
  2. the latest MAX_DATES dates; for each, the GCOV HDF5 is read over HTTPS range requests (pipeline/h5remote.py;
     an Earthdata token from EARTHDATA_TOKEN or a proxy that injects it), only the blocks over the box;
  3. HH and HV are averaged in linear power onto the website's 256 x 256 grid of the box, converted to dB and mapped
     to the same fixed byte scale as the browser (web/src/calWorker.js): HH -25..0 dB, HV -32..-7 dB -> 0..254,
     255 = no data.
Writes web/public/data/cal/<id>.bin (per date: HH then HV, 256*256 bytes each), <id>.json (dates, granules, track)
and index.json (the list the website shows). Run weekly by .github/workflows/calibrated.yml.
"""
import json
import math
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import h5py
import numpy as np
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_data as bd  # noqa: E402
from h5remote import RangeFile  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data" / "cal"
LIST = ROOT / "pipeline" / "cal_regions.json"
SIZE, MAX_DATES = 256, 12
CAL = {"hh": [-25, 0], "hv": [-32, -7]}
GRID = "/science/LSAR/GCOV/grids/frequencyA"


def plan(box):
    w, s, e, n = box
    poly = f"POLYGON(({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))"
    q = urllib.parse.urlencode(dict(dataset="NISAR", processingLevel="GCOV", intersectsWith=poly, output="jsonlite", maxResults=3000))
    res = json.load(urllib.request.urlopen(bd.SEARCH + "?" + q, timeout=120))["results"]
    tracks = {}
    for g in res:
        if not g.get("wkt") or not g.get("downloadUrl") or not bd.wkt_contains_box(g["wkt"], w, s, e, n):
            continue
        tracks.setdefault((g["path"], g["flightDirection"]), {})[g["startTime"][:10]] = g
    if not tracks:
        return None, []
    key, by_date = max(tracks.items(), key=lambda kv: len(kv[1]))
    dates = sorted(by_date)[-MAX_DATES:]
    return {"path": key[0], "dir": key[1]}, [(d, by_date[d]) for d in dates]


def read(url, box):
    f = RangeFile(url)
    with h5py.File(f, "r") as h:
        g = h[GRID]
        epsg = int(g["projection"][()])
        x = g["xCoordinates"][:]; y = g["yCoordinates"][:]
        dx, dy = x[1] - x[0], y[1] - y[0]
        tr = Transformer.from_crs(4326, epsg, always_xy=True)
        w, s, e, n = box
        # cell edges of the output grid (lat/lon), in the product's projection
        lons = np.linspace(w, e, SIZE + 1); lats = np.linspace(n, s, SIZE + 1)
        LO, LA = np.meshgrid(lons, lats)
        X, Y = tr.transform(LO, LA)
        C = (X - x[0]) / dx; R = (Y - y[0]) / dy
        c0, c1 = max(0, int(np.floor(C.min())) - 1), min(len(x), int(np.ceil(C.max())) + 2)
        r0, r1 = max(0, int(np.floor(R.min())) - 1), min(len(y), int(np.ceil(R.max())) + 2)
        if c1 - c0 < 4 or r1 - r0 < 4:
            return None, f.fetched
        hh = g["HHHH"][r0:r1, c0:c1].astype(np.float64); hv = g["HVHV"][r0:r1, c0:c1].astype(np.float64)
    ok = (hh > 0) & (hv > 0) & np.isfinite(hh) & np.isfinite(hv)
    hh[~ok] = 0; hv[~ok] = 0
    # integral images -> mean over each output cell's pixel rectangle
    def integ(a):
        return np.pad(a, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    Ih, Iv, In = integ(hh), integ(hv), integ(ok.astype(np.float64))
    Cc = np.clip(np.round(C - c0).astype(int), 0, c1 - c0); Rr = np.clip(np.round(R - r0).astype(int), 0, r1 - r0)
    ra, rb = np.minimum(Rr[:-1, :-1], Rr[1:, 1:]), np.maximum(Rr[:-1, :-1], Rr[1:, 1:]) + 1
    ca, cb = np.minimum(Cc[:-1, :-1], Cc[1:, 1:]), np.maximum(Cc[:-1, :-1], Cc[1:, 1:]) + 1
    rb = np.minimum(rb, r1 - r0); cb = np.minimum(cb, c1 - c0)
    box_sum = lambda I: I[rb, cb] - I[ra, cb] - I[rb, ca] + I[ra, ca]  # noqa: E731
    cnt = box_sum(In)
    with np.errstate(invalid="ignore", divide="ignore"):
        mh, mv = box_sum(Ih) / cnt, box_sum(Iv) / cnt
    mh[cnt == 0] = np.nan; mv[cnt == 0] = np.nan
    return (mh, mv, abs(dx)), f.fetched


def to_byte(p, rng):
    lo, hi = rng
    with np.errstate(invalid="ignore", divide="ignore"):
        v = np.clip((10 * np.log10(p) - lo) / (hi - lo) * 254, 0, 254)
    return np.where(np.isfinite(v), np.round(v), 255).astype(np.uint8)


def main(only=None):
    OUT.mkdir(parents=True, exist_ok=True)
    regions = json.loads(LIST.read_text())
    index = json.loads((OUT / "index.json").read_text()) if (OUT / "index.json").exists() else {"regions": []}
    keep = {r["id"]: r for r in index["regions"]}
    for reg in regions:
        if only and reg["id"] not in only:
            continue
        track, dates = plan(reg["box"])
        if not dates:
            print("  !", reg["id"], "no full-cover track"); continue
        blobs, acqs, mb = [], [], 0
        for d, g in dates:
            try:
                r, fetched = read(g["downloadUrl"], reg["box"])
            except Exception as ex:  # noqa: BLE001
                print("   !", reg["id"], d, ex, flush=True); continue
            mb += fetched / 1e6
            if r is None:
                continue
            mh, mv, px = r
            valid = float(np.isfinite(mh).mean())
            if valid < 0.5:
                continue
            blobs += [to_byte(mh, CAL["hh"]).tobytes(), to_byte(mv, CAL["hv"]).tobytes()]
            acqs.append({"date": d, "time": g["startTime"], "granule": g["productID"], "h5": g["downloadUrl"], "valid": round(valid, 3),
                         "collection": g.get("collectionName", ""), "frames": 1, "calibrated": True})
            print(f"   {reg['id']} {d}: valid {valid:.2f}, {fetched / 1e6:.0f} MB", flush=True)
        if len(acqs) < 2:
            print("  !", reg["id"], "fewer than 2 calibrated passes"); continue
        (OUT / f"{reg['id']}.bin").write_bytes(b"".join(blobs))
        meta = {"id": reg["id"], "name": reg["name"], "box": reg["box"], "size": SIZE, "cal": CAL, "pxM": 20, "track": track, "acquisitions": acqs,
                "source": "NISAR L2 GCOV (gamma-naught) via ASF, read over HTTPS range requests"}
        (OUT / f"{reg['id']}.json").write_text(json.dumps(meta, indent=1))
        keep[reg["id"]] = {"id": reg["id"], "name": reg["name"], "box": reg["box"], "passes": len(acqs), "last": acqs[-1]["date"]}
        print(f"  {reg['id']}: {len(acqs)} passes, {mb:.0f} MB read", flush=True)
    (OUT / "index.json").write_text(json.dumps({"regions": sorted(keep.values(), key=lambda r: r["name"]), "cal": CAL}, indent=1))
    print("CALDONE", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:] or None)
