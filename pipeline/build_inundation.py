#!/usr/bin/env python3
"""Google Flood Forecasting inundation history -> per-site overlay.

Source: gs://flood-forecasting/inundation_history (Google Research floods team, CC-BY-4.0).
How often each 128 m pixel was wet between 1999 and 2020, derived from the GLAD
surface-water dataset, as three polygon layers:
    High_risk   wet >= 5 % of the time
    Medium_risk wet >= 1 %
    Low_risk    wet >= 0.5 %
Permanent water is removed. Coverage: latitude -39..43, longitude -125..170.

For every site the overlapping ~83k km² cells are downloaded once (cached), clipped
to the site's AOI and rasterised to the 256 x 256 grid of the radar crops, so the
web app can lay the 20-year flood frequency over NISAR's water detections.

Writes web/public/data/inundation/<id>.png (R = level 0..3 * 85) and inundation.json.
"""
import argparse
import json
import math
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data"
CACHE = ROOT / "pipeline" / ".cache" / "inundation"
BUCKET = "flood-forecasting"
PREFIX = "inundation_history/data/"
SIZE = 256
LEVELS = [("Low_risk", 1), ("Medium_risk", 2), ("High_risk", 3)]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import aoi_box  # noqa: E402


def list_cells():
    f = CACHE / "_cells.json"
    if f.exists():
        return json.loads(f.read_text())
    names, token = [], None
    while True:
        q = {"prefix": PREFIX, "fields": "items(name),nextPageToken", "maxResults": "1000"}
        if token:
            q["pageToken"] = token
        url = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o?" + urllib.parse.urlencode(q)
        d = json.load(urllib.request.urlopen(url, timeout=60))
        names += [i["name"] for i in d.get("items", []) if i["name"].endswith(".geojson")]
        token = d.get("nextPageToken")
        if not token:
            break
    cells = []
    for n in names:
        s, w, nn, e = map(float, Path(n).stem.replace("inundation_history_", "").split("_"))
        cells.append({"name": n, "bbox": [w, s, e, nn]})
    CACHE.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(cells))
    return cells


def fetch(name):
    p = CACHE / Path(name).name
    if not p.exists():
        url = f"https://storage.googleapis.com/{BUCKET}/" + urllib.parse.quote(name)
        p.write_bytes(urllib.request.urlopen(url, timeout=300).read())
    return json.loads(p.read_text())


def polygons(geom):
    t = geom["type"]
    if t == "Polygon":
        yield geom["coordinates"]
    elif t == "MultiPolygon":
        yield from geom["coordinates"]
    elif t == "GeometryCollection":
        for g in geom["geometries"]:
            yield from polygons(g)


def rasterise(fc, box, levels):
    W, S, E, N = box
    sx, sy = SIZE / (E - W), SIZE / (N - S)
    px = lambda ring: [((x - W) * sx, (N - y) * sy) for x, y in ring]
    for feat in fc["features"]:
        lvl = dict(LEVELS).get(feat["properties"].get("name"))
        if not lvl:
            continue
        m = Image.new("L", (SIZE, SIZE), 0)
        dr = ImageDraw.Draw(m)
        for poly in polygons(feat["geometry"]):
            xs = [p[0] for p in poly[0]]; ys = [p[1] for p in poly[0]]
            if max(xs) < W or min(xs) > E or max(ys) < S or min(ys) > N:
                continue
            dr.polygon(px(poly[0]), fill=1)
            for hole in poly[1:]:
                dr.polygon(px(hole), fill=0)
        a = np.asarray(m, dtype=bool)
        levels[a] = np.maximum(levels[a], lvl)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", nargs="*")
    args = ap.parse_args()
    sites = json.loads((ROOT / "pipeline" / "sites.json").read_text())
    if args.sites:
        sites = [s for s in sites if s["id"] in args.sites]
    cells = list_cells()
    print(f"{len(cells)} inundation-history cells in gs://{BUCKET}/{PREFIX}")
    (OUT / "inundation").mkdir(parents=True, exist_ok=True)
    idx_path = OUT / "inundation.json"
    index = json.loads(idx_path.read_text()) if idx_path.exists() else {}
    for s in sites:
        box = aoi_box(s)
        hit = [c for c in cells if c["bbox"][0] < box[2] and c["bbox"][2] > box[0] and c["bbox"][1] < box[3] and c["bbox"][3] > box[1]]
        if not hit:
            print(f"{s['id']:12s} outside the dataset (lat -39..43, lon -125..170)")
            index.pop(s["id"], None)
            continue
        levels = np.zeros((SIZE, SIZE), np.uint8)
        for c in hit:
            rasterise(fetch(c["name"]), box, levels)
        img = np.zeros((SIZE, SIZE, 4), np.uint8)
        img[..., 0] = levels * 85
        img[..., 3] = 255
        Image.fromarray(img, "RGBA").save(OUT / "inundation" / f"{s['id']}.png", optimize=True)
        side = 2 * s["half_deg"] * 111.32
        px_km2 = side * side / SIZE / SIZE
        pct = {k: round(float((levels >= v).mean() * 100), 2) for k, v in (("low", 1), ("medium", 2), ("high", 3))}
        index[s["id"]] = {
            "img": f"inundation/{s['id']}.png", "pct": pct,
            "km2": {k: round(v / 100 * SIZE * SIZE * px_km2, 1) for k, v in pct.items()},
            "period": "1999–2020", "source": "Google Flood Forecasting inundation history (GLAD-derived), CC-BY-4.0",
            "url": "https://console.cloud.google.com/storage/browser/flood-forecasting/inundation_history",
        }
        print(f"{s['id']:12s} cells {len(hit)}  wet ≥0.5% {pct['low']:5.1f}%  ≥1% {pct['medium']:5.1f}%  ≥5% {pct['high']:5.1f}%")
    idx_path.write_text(json.dumps(index, indent=1))
    print("wrote", idx_path)


if __name__ == "__main__":
    main()
