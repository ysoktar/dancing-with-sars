#!/usr/bin/env python3
"""NASA Global Landslide Catalog (GLC, Kirschbaum et al. 2010, 2015) as a compact JSON for the landslide tool.

Source: NASA Goddard, "Global Landslide Catalog Export", https://data.nasa.gov (public domain), rainfall-triggered
landslides reported in news, scientific papers and disaster databases, 1988-2016. Download the CSV export into
pipeline/.cache/glc/glc.csv first.

Writes web/public/data/landslides.json:
  {"source": ..., "fields": [...], "events": [[lat, lon, "YYYY-MM-DD", category, trigger, size, fatalities, accuracy, title], ...]}
"""
import csv
import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "pipeline" / ".cache" / "glc" / "glc.csv"
OUT = ROOT / "web" / "public" / "data" / "landslides.json"


def main():
    ev = []
    for r in csv.DictReader(open(SRC, encoding="utf-8", errors="replace")):
        try:
            lat, lon = round(float(r["latitude"]), 4), round(float(r["longitude"]), 4)
            d = datetime.strptime(r["event_date"].strip(), "%m/%d/%Y %I:%M:%S %p").strftime("%Y-%m-%d")
        except (ValueError, KeyError):
            continue
        fat = r.get("fatality_count") or ""
        ev.append([lat, lon, d, r.get("landslide_category") or "", r.get("landslide_trigger") or "", r.get("landslide_size") or "",
                   int(float(fat)) if fat.strip() else None, r.get("location_accuracy") or "", (r.get("event_title") or "")[:80]])
    ev.sort(key=lambda e: e[2])
    OUT.write_text(json.dumps({
        "source": "NASA Global Landslide Catalog (Kirschbaum et al. 2010, 2015), data.nasa.gov, public domain",
        "fields": ["lat", "lon", "date", "category", "trigger", "size", "fatalities", "location_accuracy", "title"],
        "events": ev}, separators=(",", ":"), ensure_ascii=False))
    print(len(ev), "events", ev[0][2], "-", ev[-1][2], f"{OUT.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
