#!/usr/bin/env python3
"""Which crops grow where: a crop-mix prior from SPAM 2010 v2r0 (IFPRI, MapSPAM), 42 crops.

Source: IFPRI (2019), "Global Spatially-Disaggregated Crop Production Statistics Data for 2010 Version 2.0",
Harvard Dataverse, doi:10.7910/DVN/PRFF8V (CC BY 4.0). Physical area (ha) and yield (kg/ha) per crop on a
5-arc-minute grid, all farming technologies together (*_A.tif).

Aggregated to 0.25° (~28 km) cells; for every cell with crops, the crops covering at least 1 % of its crop area
are stored with their share of the crop area and their area-weighted mean yield (t/ha). Written as 10° JSON
tiles web/public/data/cropprior/<lat0>_<lon0>.json: {"cells": {"<row>_<col>": [[code, share, t_ha], ...]}, ...}
plus web/public/data/cropprior/crops.json (codes -> names, groups).

Download first (no registration needed for 2010):
  https://dataverse.harvard.edu/api/access/datafile/3985010   (phys_area geotiff zip)
  https://dataverse.harvard.edu/api/access/datafile/3985012   (yield geotiff zip)
into pipeline/.cache/spam/.
"""
import io
import json
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "pipeline" / ".cache" / "spam"
OUT = ROOT / "web" / "public" / "data" / "cropprior"
AGG = 3                       # 3 x 5' = 0.25°
CROPS = {
    "WHEA": "Wheat", "RICE": "Rice", "MAIZ": "Maize", "BARL": "Barley", "PMIL": "Pearl millet", "SMIL": "Small millet",
    "SORG": "Sorghum", "OCER": "Other cereals", "POTA": "Potato", "SWPO": "Sweet potato", "YAMS": "Yams", "CASS": "Cassava",
    "ORTS": "Other roots", "BEAN": "Bean", "CHIC": "Chickpea", "COWP": "Cowpea", "PIGE": "Pigeon pea", "LENT": "Lentil",
    "OPUL": "Other pulses", "SOYB": "Soybean", "GROU": "Groundnut", "CNUT": "Coconut", "OILP": "Oil palm", "SUNF": "Sunflower",
    "RAPE": "Rapeseed", "SESA": "Sesame", "OOIL": "Other oil crops", "SUGC": "Sugar cane", "SUGB": "Sugar beet",
    "COTT": "Cotton", "OFIB": "Other fibre crops", "ACOF": "Arabica coffee", "RCOF": "Robusta coffee", "COCO": "Cocoa",
    "TEAS": "Tea", "TOBA": "Tobacco", "BANA": "Banana", "PLNT": "Plantain", "TROF": "Tropical fruit", "TEMF": "Temperate fruit",
    "VEGE": "Vegetables", "REST": "Other crops",
}
GROUPS = {
    "Cereals": ["WHEA", "BARL", "OCER", "RICE", "PMIL", "SMIL"], "Maize & sorghum": ["MAIZ", "SORG"],
    "Oilseeds & legumes": ["SOYB", "RAPE", "SUNF", "GROU", "SESA", "OOIL", "BEAN", "CHIC", "COWP", "PIGE", "LENT", "OPUL"],
    "Root crops": ["POTA", "SUGB", "SWPO", "YAMS", "CASS", "ORTS"], "Vineyards & orchards": ["TEMF", "TROF", "BANA", "PLNT", "CNUT", "OILP", "ACOF", "RCOF", "COCO", "TEAS"],
    "Vegetables & flowers": ["VEGE"], "Industrial crops": ["COTT", "OFIB", "SUGC", "TOBA", "REST"],
}


def read_tif(z, name):
    a = np.asarray(Image.open(io.BytesIO(z.read(name)))).astype(np.float32)
    a[~np.isfinite(a) | (a < 0)] = 0
    return a


def agg(a):
    h, w = a.shape
    return a[: h - h % AGG, : w - w % AGG].reshape(h // AGG, AGG, w // AGG, AGG).sum((1, 3))


def main():
    za, zy = zipfile.ZipFile(CACHE / "3985010"), zipfile.ZipFile(CACHE / "3985012")
    na = {n.split("_")[-2]: n for n in za.namelist() if n.endswith("_A.tif")}
    ny = {n.split("_")[-2]: n for n in zy.namelist() if n.endswith("_A.tif")}
    codes = [c for c in CROPS if c in na]
    area, yld = {}, {}
    for c in codes:
        a = read_tif(za, na[c])
        y = read_tif(zy, ny[c]) if c in ny else np.zeros_like(a)
        area[c] = agg(a)
        yld[c] = agg(a * y)                    # area-weighted yield sum (kg)
        print(f"  {c}: {area[c].sum() / 1e6:.1f} Mha", flush=True)
    total = sum(area.values())
    H, W = total.shape                       # 720 x 1440 at 0.25°
    OUT.mkdir(parents=True, exist_ok=True)
    tiles = {}
    rows, cols = np.nonzero(total > 50)       # cells with > 50 ha of crops
    for r, c in zip(rows, cols):
        tot = total[r, c]
        lst = []
        for code in codes:
            a = area[code][r, c]
            if a / tot >= 0.01:
                lst.append([code, round(float(a / tot), 3), round(float(yld[code][r, c] / a / 1000), 2) if a > 0 else None])
        lst.sort(key=lambda x: -x[1])
        lat0 = 90 - (r + 1) * 0.25; lon0 = -180 + c * 0.25
        key = f"{int(np.floor(lat0 / 10) * 10)}_{int(np.floor(lon0 / 10) * 10)}"
        tiles.setdefault(key, {})[f"{r}_{c}"] = [round(float(tot)), lst]
    for k, cells in tiles.items():
        (OUT / f"{k}.json").write_text(json.dumps({"res": 0.25, "cells": cells}, separators=(",", ":")))
    (OUT / "crops.json").write_text(json.dumps({"source": "SPAM 2010 v2r0 (IFPRI, MapSPAM), physical area and yield, CC BY 4.0, doi:10.7910/DVN/PRFF8V",
                                                "res": 0.25, "crops": CROPS, "groups": GROUPS, "tiles": sorted(tiles)}, indent=1))
    size = sum(f.stat().st_size for f in OUT.glob("*.json")) / 1e6
    print(f"{len(rows)} cells with crops, {len(tiles)} tiles, {size:.1f} MB")


if __name__ == "__main__":
    main()
