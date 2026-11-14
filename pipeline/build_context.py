#!/usr/bin/env python3
"""
Agricultural context for the crop sites (no login required).

  NASA POWER   daily precipitation (PRECTOTCORR, mm/day) and air temperature (T2M, °C)
  NASA GIBS    MODIS Terra 16-day NDVI (MOD13Q1) over the same window as the radar crops.
               GIBS serves the NDVI as a palette image; its published colour map
               (MODIS_L3_NDVI.xml) maps every colour back to an NDVI interval.

  web/public/data/context/<site>.json

Usage: python pipeline/build_context.py [--sites punjab nile ...]
"""
from __future__ import annotations

import argparse
import io
import json
import math
import re
import time
import urllib.request
from datetime import date, timedelta, datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data" / "context"
UA = {"User-Agent": "dancing-with-sars-pipeline/1.0"}
START = date(2025, 10, 1)
AG_THEMES = {"agriculture", "groundwater", "subsidence", "flood"}
GIBS = ("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
        "&LAYERS=MODIS_Terra_L3_NDVI_16Day&CRS=EPSG:4326&BBOX={s},{w},{n},{e}&WIDTH=128&HEIGHT=128&FORMAT=image/png&TIME={t}")
COLORMAP = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_L3_NDVI.xml"


def get(url, timeout=90, retries=3):
    for i in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            err = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"{url[:80]}: {err}")


def ndvi_palette():
    xml = get(COLORMAP).decode()
    pal = {}
    for m in re.finditer(r'<ColorMapEntry([^>]*)/>', xml):
        a = m.group(1)
        rgb = re.search(r'rgb="([^"]+)"', a).group(1)
        v = re.search(r'value="\[([-\d.]+),([-\d.]+)\)"', a)
        if not v or 'nodata="true"' in a or 'transparent="true"' in a:
            continue
        lo, hi = float(v.group(1)), float(v.group(2))
        pal[tuple(map(int, rgb.split(",")))] = (lo + hi) / 2
    return pal


def modis_dates(end):
    out = []
    for y in range(START.year, end.year + 1):
        d = date(y, 1, 1)
        while d.year == y and d <= end:
            if d >= START: out.append(d)
            d += timedelta(days=16)
    return out


def ndvi_series(site, pal):
    lat, lon, h = site["lat"], site["lon"], site["half_deg"]
    hl = h / max(math.cos(math.radians(lat)), 0.05)
    keys = np.array(list(pal.keys()), np.int32); vals = np.array(list(pal.values()), np.float32)
    lut = {tuple(k): v for k, v in zip(keys.tolist(), vals.tolist())}
    dates, means, p90, cover = [], [], [], []
    for d in modis_dates(date.today() - timedelta(days=20)):
        try:
            img = Image.open(io.BytesIO(get(GIBS.format(s=lat - h, w=lon - hl, n=lat + h, e=lon + hl, t=d.isoformat())))).convert("RGBA")
        except Exception as e:  # noqa: BLE001
            print("   ! NDVI", d, e); continue
        a = np.asarray(img).reshape(-1, 4)
        v = np.array([lut.get(tuple(px[:3]), np.nan) if px[3] > 0 else np.nan for px in a], np.float32)
        ok = np.isfinite(v)
        if ok.mean() < 0.2: continue
        dates.append(d.isoformat()); means.append(round(float(np.nanmean(v)), 4))
        p90.append(round(float(np.nanpercentile(v, 90)), 4)); cover.append(round(float(ok.mean()), 3))
    return dict(source="MODIS Terra MOD13Q1 16-day NDVI via NASA GIBS", dates=dates, mean=means, p90=p90, valid=cover)


def power_series(site):
    end = date.today() - timedelta(days=2)
    url = (f"https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,T2M&community=AG"
           f"&longitude={site['lon']}&latitude={site['lat']}&start={START:%Y%m%d}&end={end:%Y%m%d}&format=JSON")
    p = json.loads(get(url))["properties"]["parameter"]
    days = sorted(p["PRECTOTCORR"])
    clean = lambda x: None if x is None or x <= -998 else round(x, 2)
    return dict(source="NASA POWER (MERRA-2 / IMERG based), daily", dates=[f"{d[:4]}-{d[4:6]}-{d[6:]}" for d in days],
                precip_mm=[clean(p["PRECTOTCORR"][d]) for d in days], t2m_c=[clean(p["T2M"][d]) for d in days])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", nargs="*")
    args = ap.parse_args()
    sites = json.loads((ROOT / "pipeline" / "sites.json").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    pal = ndvi_palette()
    print(f"NDVI palette: {len(pal)} colours")
    for s in sites:
        if args.sites and s["id"] not in args.sites: continue
        if not args.sites and s["theme"] not in AG_THEMES: continue
        rec = dict(site=s["id"], generated=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        try: rec["weather"] = power_series(s)
        except Exception as e: print("   ! POWER", s["id"], e)   # noqa: E701
        rec["ndvi"] = ndvi_series(s, pal)
        (OUT / f"{s['id']}.json").write_text(json.dumps(rec, separators=(",", ":")))
        print(f"{s['id']:12s} weather {len(rec.get('weather', {}).get('dates', []))} days · NDVI {len(rec['ndvi']['dates'])} composites")


if __name__ == "__main__":
    main()
