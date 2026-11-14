#!/usr/bin/env python3
"""Brazil radar archetype library: the structural fingerprint of known land uses in NISAR L-band HH / HV.

For a few well-known Brazilian areas per land use (soybean, sugarcane, irrigated rice, coffee, centre-pivot irrigation,
pasture, intact forest, eucalyptus plantation, Pantanal wetland, cerrado savanna), every public NISAR GCOV browse pass of
one track is sampled over a ~9 km box (32 x 32 cells, ~280 m), and per cell a season-light feature vector is computed:

  mHH, mHV      mean HH / HV browse value          (roughness + moisture / canopy volume)
  sHH, sHV      temporal standard deviation        (how much the surface changes pass to pass)
  rHV           HV range p90 - p10 over the passes (crop growth / harvest amplitude)
  rvi           mean radar vegetation index 4 HV / (HH + HV)
  tHV           HV trend, browse units per 100 days (growing or being cleared over the window)

Only cells whose majority ESA WorldCover 2021 class fits the land use are kept (cropland for crops, tree cover for forest and\neucalyptus, grassland for pasture, ...). The archetype is the median of those cells; the typical within-archetype spread scales distances when a
region elsewhere (e.g. Turkey) is matched against the library in the browser (web/src/sarWorker.js, op "fingerprint").

NISAR public GCOV over Brazil starts on 2026-06-21, so the library covers Brazil's dry season and the start of the
soybean sowing (June-November); full-year curves (and a 6-month hemisphere shift) need data until mid-2027.
Writes web/public/data/archetypes.json.
"""
import io
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_data as bd  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data" / "archetypes.json"
HALF = 0.04
CELLS = 32

ARCHETYPES = [
    ("soy", "Soybean (– maize) farmland", "#e8b04a", [(-12.55, -55.75), (-13.05, -56.05), (-17.85, -50.95)]),
    ("cane", "Sugarcane", "#a3e635", [(-21.05, -48.25), (-21.75, -48.35), (-20.55, -48.55)]),
    ("rice", "Irrigated rice (paddies)", "#22d3ee", [(-29.75, -56.95), (-30.85, -51.85), (-29.95, -55.65)]),
    ("coffee", "Coffee", "#b45309", [(-21.55, -45.55), (-18.95, -46.95), (-21.25, -45.95)]),
    ("pivot", "Centre-pivot irrigation", "#3b82f6", [(-16.45, -47.55), (-17.25, -46.85), (-16.75, -47.35)]),
    ("pasture", "Pasture", "#d6d3a8", [(-20.45, -54.05), (-8.35, -49.55), (-21.25, -52.15)]),
    ("forest", "Intact tropical forest", "#15803d", [(-4.05, -63.45), (-10.05, -55.05), (-7.55, -61.05)]),
    ("eucalyptus", "Eucalyptus plantation", "#4d7c0f", [(-20.85, -51.95), (-18.15, -42.45), (-20.95, -52.45)]),
    ("wetland", "Seasonal wetland (Pantanal)", "#0ea5e9", [(-18.05, -57.05), (-19.05, -56.55), (-17.55, -56.95)]),
    ("cerrado", "Cerrado savanna", "#c2a35a", [(-10.45, -46.65), (-15.15, -47.85), (-13.85, -46.95)]),
]
FEATURES = ["mHH", "mHV", "sHH", "sHV", "rHV", "rvi", "tHV"]
# structural classes: the level the library can actually tell apart (leave-one-area-out self-test, see below)
GROUPS = [
    ("annual", "Annual cropland (sown + harvested)", "#e8b04a", ["soy", "pivot", "rice"]),
    ("perennial", "Semi-perennial crops (cane, coffee)", "#a3e635", ["cane", "coffee"]),
    ("open", "Open grass / savanna / wetland", "#d6d3a8", ["pasture", "cerrado", "wetland"]),
    ("canopy", "Closed canopy (forest, plantation)", "#15803d", ["forest", "eucalyptus"]),
]


def site_plan(lat, lon):
    """Pick the track (path + direction) with the most dates whose footprint holds the whole box."""
    w, s, e, n = lon - HALF, lat - HALF, lon + HALF, lat + HALF
    poly = f"POLYGON(({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))"
    res = json.loads(bd.search(dict(processingLevel="GCOV", intersectsWith=poly, output="jsonlite", maxResults=3000)))["results"]
    tracks = {}
    for g in res:
        if not any(b.endswith("_LATLON.png") for b in (g.get("browse") or [])) or not g.get("wkt"):
            continue
        if not bd.wkt_contains_box(g["wkt"], w, s, e, n):
            continue
        tracks.setdefault((g["path"], g["flightDirection"]), {})[g["startTime"][:10]] = g
    if not tracks:
        return None
    key, by_date = max(tracks.items(), key=lambda kv: len(kv[1]))
    return {"box": (w, s, e, n), "track": f"{key[0]}{key[1][0]}", "by_date": by_date}


WC_OK = {"soy": {40}, "cane": {40}, "rice": {40}, "coffee": {40, 10, 20}, "pivot": {40}, "pasture": {30}, "forest": {10},
         "eucalyptus": {10}, "wetland": {90, 30}, "cerrado": {20, 30}}
_sas = {}


def worldcover(box):
    """Majority ESA WorldCover 2021 class on the CELLS x CELLS grid of box (Planetary Computer COG)."""
    import math
    import urllib.request as ur
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import from_bounds
    if "t" not in _sas:
        _sas["t"] = json.loads(ur.urlopen("https://planetarycomputer.microsoft.com/api/sas/v1/token/esa-worldcover", timeout=60).read())["token"]
    w, s, e, n = box
    la0, lo0 = int(math.floor(s / 3) * 3), int(math.floor(w / 3) * 3)
    name = f"{'S' if la0 < 0 else 'N'}{abs(la0):02d}{'W' if lo0 < 0 else 'E'}{abs(lo0):03d}"
    url = f"https://ai4edataeuwest.blob.core.windows.net/esa-worldcover/v200/2021/map/ESA_WorldCover_10m_2021_v200_{name}_Map.tif?{_sas['t']}"
    with rasterio.open(url) as src:
        return src.read(1, window=from_bounds(w, s, e, n, src.transform), out_shape=(CELLS, CELLS), resampling=Resampling.mode)


def sample_granule(png, wkt, boxes):
    """Download one browse image once and sample every site box that lies in it."""
    im = Image.open(io.BytesIO(bd.http_get(png))).convert("RGB")
    try:
        bounds = bd.parse_kml_bounds(bd.http_get(png[:-4] + ".kml"))
    except Exception:  # noqa: BLE001
        bounds = bd.bounds_from_footprint(im, wkt)
    if bounds is None:
        return {}
    out = {}
    for sid, box in boxes:
        a = bd.sample(im, bounds, box, CELLS)
        if (a.sum(2) > 6).mean() >= 0.9:
            out[sid] = (a[..., 0], a[..., 1])
    return out


def box3(a):
    p = np.pad(a, ((0, 0), (1, 1), (1, 1)), mode="edge")
    return sum(p[:, dy:dy + a.shape[1], dx:dx + a.shape[2]] for dy in range(3) for dx in range(3)) / 9


def features(ser, mask=None):
    hh, hv = box3(ser["hh"]), box3(ser["hv"])        # a light spatial filter, like the browser's speckle filter
    t = np.array([(date.fromisoformat(d) - date.fromisoformat(ser["dates"][0])).days for d in ser["dates"]], float)
    rvi = 4 * hv / (hh + hv + 1)
    tc = t - t.mean()
    slope = (tc[:, None, None] * (hv - hv.mean(0))).sum(0) / max((tc ** 2).sum(), 1) * 100
    f = {"mHH": hh.mean(0), "mHV": hv.mean(0), "sHH": hh.std(0), "sHV": hv.std(0),
         "rHV": np.percentile(hv, 90, axis=0) - np.percentile(hv, 10, axis=0), "rvi": rvi.mean(0), "tHV": slope}
    X = np.stack([f[k].ravel() for k in FEATURES], 1)
    return X if mask is None else X[mask.ravel()]


def main():
    jobs = [(a, i, lat, lon) for a in ARCHETYPES for i, (lat, lon) in enumerate(a[3])]
    cache = ROOT / "pipeline" / ".cache" / "archetype_series.npz"
    if cache.exists():
        z = dict(np.load(cache, allow_pickle=True))
        results = [(job, z[f"s{sid}"].item() if f"s{sid}" in z else None) for sid, job in enumerate(jobs)]
        return finish(jobs, results)
    with ThreadPoolExecutor(8) as ex:
        plans = list(ex.map(lambda j: site_plan(j[2], j[3]), jobs))
    # every granule needed, with the site boxes it serves
    need = {}
    for sid, (job, pl) in enumerate(zip(jobs, plans)):
        if not pl:
            print(f"   ! no full-cover track for {job[0][0]} site {job[1] + 1}", flush=True)
            continue
        for d, g in pl["by_date"].items():
            png = next(b for b in g["browse"] if b.endswith("_LATLON.png"))
            need.setdefault(png, {"wkt": g["wkt"], "sites": []})["sites"].append((sid, d, pl["box"]))
    print(f"{len(jobs)} sites, {len(need)} browse images to download", flush=True)
    got = {}
    done = [0]

    def fetch(item):
        png, v = item
        try:
            r = sample_granule(png, v["wkt"], [(sid, box) for sid, d, box in v["sites"]])
        except Exception as ex:  # noqa: BLE001
            print("   !", png[-60:], ex, flush=True)
            r = {}
        for sid, d, box in v["sites"]:
            if sid in r:
                got.setdefault(sid, {})[d] = r[sid]
        done[0] += 1
        if done[0] % 20 == 0 or done[0] == len(need):
            print(f"   downloaded {done[0]}/{len(need)}", flush=True)

    with ThreadPoolExecutor(8) as ex:
        list(ex.map(fetch, need.items()))
    results = []
    for sid, (job, pl) in enumerate(zip(jobs, plans)):
        g = got.get(sid, {})
        ds = sorted(g)
        ser = {"track": pl["track"] if pl else "", "dates": ds, "hh": np.stack([g[d][0] for d in ds]) if ds else None,
               "hv": np.stack([g[d][1] for d in ds]) if ds else None} if pl else None
        print(f"   {job[0][0]:<10} site {job[1] + 1}: {len(ds)} passes" + (f" (track {ser['track']}, {ds[0]}..{ds[-1]})" if ds else ""), flush=True)
        results.append((job, ser))
    np.savez_compressed(cache, **{f"s{sid}": np.array(ser, dtype=object) for sid, (job, ser) in enumerate(results) if ser})
    finish(jobs, results)


def finish(jobs, results):
    lib, all_feats, per_site = [], [], []
    for a in ARCHETYPES:
        feats, sites = [], []
        for (aa, i, lat, lon), ser in results:
            if aa is not a or not ser or ser["hh"] is None or len(ser["dates"]) < 6:
                continue
            try:
                wc = worldcover((lon - HALF, lat - HALF, lon + HALF, lat + HALF))
                mask = np.isin(wc, list(WC_OK[a[0]]))
            except Exception as ex:  # noqa: BLE001
                print("   ! WorldCover", a[0], i + 1, ex, flush=True)
                mask = np.ones((CELLS, CELLS), bool)
            print(f"   {a[0]:<10} site {i + 1}: {mask.mean() * 100:.0f} % of cells are {sorted(WC_OK[a[0]])} in WorldCover", flush=True)
            if mask.sum() < 30:
                continue
            F = features(ser, mask)
            feats.append(F)
            per_site.append((a[0], len(sites), F))
            sites.append({"lat": lat, "lon": lon, "track": ser["track"], "passes": len(ser["dates"]), "from": ser["dates"][0], "to": ser["dates"][-1],
                          "cells": int(mask.sum())})
        if not feats:
            print("   ! no data for", a[0])
            continue
        F = np.concatenate(feats)
        all_feats.append(F)
        q25, med, q75 = np.percentile(F, [25, 50, 75], axis=0)
        lib.append({"id": a[0], "name": a[1], "color": a[2], "sites": sites, "median": np.round(med, 3).tolist(),
                    "iqr": np.round(q75 - q25, 3).tolist(), "cells": int(len(F))})
    # distance scale: the typical spread of each feature WITHIN an archetype (median IQR / 1.349 = robust sigma),
    # as in a discriminant analysis, so that differences between archetypes are measured against their own noise
    scale = np.maximum(np.median(np.array([x["iqr"] for x in lib]), axis=0) / 1.349, 1e-3)
    # structural classes: pooled cells of their member archetypes
    groups = []
    for gid, gname, gcol, members in GROUPS:
        P = np.concatenate([F for (aid, k, F) in per_site if aid in members])
        q25, med, q75 = np.percentile(P, [25, 50, 75], axis=0)
        groups.append({"id": gid, "name": gname, "color": gcol, "members": members, "median": np.round(med, 3).tolist(),
                       "iqr": np.round(q75 - q25, 3).tolist(), "cells": int(len(P))})
    gscale = np.maximum(np.median(np.array([g["iqr"] for g in groups]), axis=0) / 1.349, 1e-3)
    g_of = {m: g["id"] for g in groups for m in g["members"]}
    gsel = {}
    for aid, k, F in per_site:
        M = []
        for g in groups:
            pool = [G for (b, kk, G) in per_site if b in g["members"] and not (b == aid and kk == k)]
            M.append(np.median(np.concatenate(pool), axis=0))
        pick = ((((F[:, None, :] - np.stack(M)[None]) / gscale) ** 2).mean(2)).argmin(1)
        r = gsel.setdefault(g_of[aid], {"n": 0, "ok": 0})
        r["n"] += len(F)
        r["ok"] += int((pick == [g["id"] for g in groups].index(g_of[aid])).sum())
    for gid, r in gsel.items():
        r["acc"] = round(r["ok"] / r["n"], 3)
        print(f"   self-test group {gid:<10} {r['acc'] * 100:4.0f} % correct", flush=True)
    g_overall = sum(r["ok"] for r in gsel.values()) / max(sum(r["n"] for r in gsel.values()), 1)
    print(f"   self-test groups overall {g_overall * 100:.0f} % (chance {100 / len(groups):.0f} %)", flush=True)

    # leave-one-area-out self-test: each area's cells against a library whose own archetype is rebuilt without that area
    ids = [x["id"] for x in lib]
    meds = {x["id"]: np.array(x["median"]) for x in lib}
    selftest = {}
    for aid, k, F in per_site:
        others = [G for (b, kk, G) in per_site if b == aid and kk != k]
        if not others:
            continue
        m = dict(meds)
        m[aid] = np.median(np.concatenate(others), axis=0)
        M = np.stack([m[i] for i in ids])
        d = (((F[:, None, :] - M[None]) / scale) ** 2).mean(2)
        pick = d.argmin(1)
        r = selftest.setdefault(aid, {"n": 0, "ok": 0, "to": {}})
        r["n"] += len(F)
        r["ok"] += int((pick == ids.index(aid)).sum())
        for j in pick:
            r["to"][ids[j]] = r["to"].get(ids[j], 0) + 1
    for aid, r in selftest.items():
        r["acc"] = round(r["ok"] / r["n"], 3)
        r["confused"] = sorted(((v / r["n"], kk) for kk, v in r["to"].items() if kk != aid), reverse=True)[:2]
        r["confused"] = [[kk, round(v, 3)] for v, kk in r["confused"]]
        print(f"   self-test {aid:<11} {r['acc'] * 100:4.0f} % correct; most confused with {r['confused']}", flush=True)
        del r["to"]
    tot = sum(r["n"] for r in selftest.values())
    overall = sum(r["ok"] for r in selftest.values()) / max(tot, 1)
    print(f"   self-test overall {overall * 100:.0f} % of {tot} cells (chance {100 / len(lib):.0f} %)", flush=True)
    OUT.write_text(json.dumps({
        "source": "NISAR L2 GCOV browse (ASF), public passes over Brazil; areas chosen from well-known land-use regions",
        "features": FEATURES, "scale": np.round(scale, 3).tolist(), "half_deg": HALF, "cells": CELLS,
        "window": [min(s["from"] for x in lib for s in x["sites"]), max(s["to"] for x in lib for s in x["sites"])],
        "hemisphere": "S", "selftest": {"overall": round(overall, 3), "cells": tot, "per": selftest, "groups": {"overall": round(g_overall, 3), "per": gsel}},
        "groups": groups, "groupScale": np.round(gscale, 3).tolist(), "archetypes": lib}, indent=1))
    print(f"{len(lib)} archetypes -> {OUT}, ARCHDONE", flush=True)


if __name__ == "__main__":
    main()
