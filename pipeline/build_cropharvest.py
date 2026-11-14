#!/usr/bin/env python3
"""NASA Harvest CropHarvest field labels (Tseng et al. 2021, NeurIPS Datasets & Benchmarks) as 10-degree JSON tiles.

Source: CropHarvest dataset, labels.geojson, Zenodo doi:10.5281/zenodo.7257688 (CC BY-SA 4.0): ~95,000 geo-referenced
points from 25 national and global campaigns, each labelled crop / non-crop, many with a crop group or crop type and a
collection date. Download into pipeline/.cache/cropharvest/labels.geojson first:
  https://zenodo.org/records/7257688/files/labels.geojson

Writes web/public/data/cropharvest/<lat0>_<lon0>.json: {"p": [[lat, lon, is_crop, group, label, year, dataset], ...]}
and web/public/data/cropharvest/index.json (tile list, datasets, licence).
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "pipeline" / ".cache" / "cropharvest" / "labels.geojson"
OUT = ROOT / "web" / "public" / "data" / "cropharvest"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    d = json.loads(SRC.read_text())
    tiles, datasets = {}, {}
    for f in d["features"]:
        p = f["properties"]
        lat, lon = p.get("lat"), p.get("lon")
        if lat is None or lon is None:
            continue
        ds = p.get("dataset") or ""
        k = datasets.setdefault(ds, len(datasets))
        year = (p.get("collection_date") or p.get("export_end_date") or "")[:4]
        rec = [round(lat, 4), round(lon, 4), int(p.get("is_crop") or 0), p.get("classification_label") or "", (p.get("label") or "")[:40], int(year) if year.isdigit() else None, k]
        key = f"{int(lat // 10 * 10)}_{int(lon // 10 * 10)}"
        tiles.setdefault(key, []).append(rec)
    for f in OUT.glob("*.json"):
        f.unlink()
    size = 0
    for key, pts in tiles.items():
        s = json.dumps({"p": pts}, separators=(",", ":"))
        (OUT / f"{key}.json").write_text(s)
        size += len(s)
    (OUT / "index.json").write_text(json.dumps({
        "source": "NASA Harvest CropHarvest (Tseng et al. 2021), Zenodo 10.5281/zenodo.7257688", "license": "CC BY-SA 4.0",
        "tiles": sorted(tiles), "datasets": [k for k, v in sorted(datasets.items(), key=lambda kv: kv[1])],
        "fields": ["lat", "lon", "is_crop", "group", "label", "year", "dataset"]}, indent=1))
    print(len(tiles), "tiles", sum(map(len, tiles.values())), "points", f"{size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
