#!/usr/bin/env python3
"""Which crops COULD grow where: crop suitability from FAO / IIASA GAEZ v4, for the crop suggestions of a parcel.

Source: FAO & IIASA (2021), Global Agro-Ecological Zones v4 (GAEZ v4), theme 4 "Suitability and attainable yield",
served by https://gaez-services.fao.org/server/rest/services/res05/ImageServer (CC BY-NC-SA 3.0 IGO).
Variable: "Suitability index range (0-10000); current cropland in grid cell", baseline climate 1981-2010 (CRU TS 3.2),
high input level, 5-arc-minute grid. Two water supplies per crop:
  rain   rain-fed
  irr    irrigated: the best of the gravity, sprinkler, drip and generic irrigation layers that exist for the crop

Aggregated to the 0.25-degree cells of the SPAM crop prior (mean of the valid 5' cells), stored as 0..100 (index / 100)
in 10-degree PNG tiles web/public/data/suitability/<lat0>_<lon0>.png (lat0 = southern edge): 8-bit grey, 40 x 40 cells
per layer, the layers stacked vertically in the order of crops.json "layers" ("<crop>|rain", "<crop>|irr"),
255 = no data; plus web/public/data/suitability/crops.json (layers, crop names, tile list, classes).
Downloads are cached in pipeline/.cache/gaez/.
"""
import json
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "pipeline" / ".cache" / "gaez"
OUT = ROOT / "web" / "public" / "data" / "suitability"
SVC = "https://gaez-services.fao.org/server/rest/services/res05/ImageServer"
UA = {"User-Agent": "Mozilla/5.0 (dancing-with-sars pipeline)"}
AGG, TILE, MIN_KEEP = 3, 10, 10


def get(url, raw=False):
    for i in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
                b = r.read()
            return b if raw else json.loads(b)
        except Exception as e:  # noqa: BLE001
            print("   retry", i + 1, e)
            time.sleep(3 * (i + 1))
    raise RuntimeError(url)


def catalog():
    where = ("variable like 'Suitability index  range%current cropland%' and year='1981-2010' "
             "and model='CRUTS32' and input_level='High'")
    q = urllib.parse.urlencode(dict(where=where, outFields="objectid,name,crop,water_supply", returnGeometry="false", f="json"))
    return [f["attributes"] for f in get(f"{SVC}/query?{q}")["features"]]


def export(item):
    path = CACHE / f"{item['name']}.tif"
    if not path.exists():
        rule = json.dumps({"mosaicMethod": "esriMosaicLockRaster", "lockRasterIds": [item["objectid"]]})
        q = urllib.parse.urlencode(dict(bbox="-180,-90,180,90", bboxSR=4326, imageSR=4326, size="4320,2160", format="tiff",
                                        pixelType="S16", interpolation="RSP_NearestNeighbor", mosaicRule=rule, f="image"))
        b = get(f"{SVC}/exportImage?{q}", raw=True)
        path.write_bytes(b)
    a = np.asarray(Image.open(path)).astype(np.float32)
    a[(a < 0) | (a > 10000)] = np.nan
    return a


def agg(a):
    h, w = a.shape
    b = a.reshape(h // AGG, AGG, w // AGG, AGG)
    with np.errstate(invalid="ignore"):
        return np.nanmean(b, axis=(1, 3))


def code_of(crop):
    return crop.lower().replace(" ", "_").replace("-", "_")


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    items = catalog()
    rain = {i["crop"]: i for i in items if i["water_supply"] == "Rainfed"}
    irr = {}
    for i in items:
        if "rrigation" in i["water_supply"]:
            irr.setdefault(i["crop"], []).append(i)
    crops = sorted(set(rain) | set(irr))
    codes = {c: code_of(c) for c in crops}
    assert len(set(codes.values())) == len(codes), codes
    print(f"{len(crops)} crops, {len(rain)} rain-fed layers, {sum(map(len, irr.values()))} irrigated layers", flush=True)

    todo = [i for i in items if i["water_supply"] == "Rainfed" or "rrigation" in i["water_supply"]]
    done = [0]

    def fetch(i):
        export(i)
        done[0] += 1
        if done[0] % 10 == 0 or done[0] == len(todo):
            print(f"   downloaded {done[0]}/{len(todo)}", flush=True)

    with ThreadPoolExecutor(4) as ex:
        list(ex.map(fetch, todo))

    npz = CACHE / "grids_025.npz"
    if npz.exists():
        G = dict(np.load(npz))
    else:
        G = {}
        for n, c in enumerate(crops):
            if c in rain:
                G[f"{codes[c]}|rain"] = agg(export(rain[c]))
            ir = None
            for i in irr.get(c, []):
                g = agg(export(i))
                ir = g if ir is None else np.fmax(ir, g)
            if ir is not None:
                G[f"{codes[c]}|irr"] = ir
            print(f"   aggregated {n + 1}/{len(crops)} {c}", flush=True)
        np.savez_compressed(npz, **G)

    # one PNG per 10-degree tile: layer k occupies rows [40k, 40k+40); value 0..100 = index / 100, 255 = no data
    layers = sorted(G)
    stack = np.stack([np.where(np.isfinite(G[k]), np.clip(np.round(G[k] / 100), 0, 100), 255).astype(np.uint8) for k in layers])
    best = np.where(stack == 255, 0, stack).max(0)
    for f in OUT.glob("*"):
        f.unlink()
    n_t, total, keys = 0, 0, []
    C = TILE * 4
    for ty in range(0, 720, C):
        for tx in range(0, 1440, C):
            if best[ty:ty + C, tx:tx + C].max() < MIN_KEEP:
                continue
            img = stack[:, ty:ty + C, tx:tx + C].reshape(len(layers) * C, C)
            lat0, lon0 = 90 - (ty + C) * 0.25, -180 + tx * 0.25
            key = f"{int(lat0)}_{int(lon0)}"
            path = OUT / f"{key}.png"
            Image.fromarray(img, "L").save(path, optimize=True)
            total += path.stat().st_size
            n_t += 1
            keys.append(key)
    (OUT / "crops.json").write_text(json.dumps({
        "source": "FAO & IIASA GAEZ v4, suitability index on current cropland, 1981-2010 climate (CRU TS 3.2), high inputs; "
                  "0.25-degree mean of the 5' grid; 0..100 = index / 100; irrigated = best irrigation system",
        "license": "CC BY-NC-SA 3.0 IGO",
        "classes": [[85, "very high"], [70, "high"], [55, "good"], [40, "medium"], [25, "moderate"], [10, "marginal"], [0, "very marginal or not suitable"]],
        "crops": {codes[c]: c for c in crops},
        "res": 0.25, "tile": TILE, "cells": C, "layers": layers, "tiles": sorted(keys),
    }, indent=1))
    print(f"{n_t} tiles, {total / 1e6:.1f} MB, SUITDONE", flush=True)


if __name__ == "__main__":
    main()
