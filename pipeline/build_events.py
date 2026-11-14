#!/usr/bin/env python3
"""
Context events for every study site: what happened there, according to
sources independent of NISAR.

  NASA EONET   natural events (floods, wildfires, volcanoes, storms, sea/lake ice)
               with links to the originating report (GDACS, InciWeb, ...)
  USGS FDSN    earthquakes, M >= 4 within 250 km
  GDELT 2.0    news articles matching the site + its change theme (best effort;
               the API is rate-limited and sometimes unreachable)

Matches are context only: a news story at the same place and time is not a
validation of what the radar shows.

  web/public/data/events.json

Usage: python pipeline/build_events.py
"""
from __future__ import annotations

import json
import math
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data"
UA = {"User-Agent": "dancing-with-sars-pipeline/1.0"}
START = "2025-10-01"

NEWS_QUERY = {
    "konya": '(Konya) (sinkhole OR drought OR groundwater OR obruk OR subsidence)',
    "sylhet": '(Sylhet OR Sunamganj) (flood OR flooding OR haor)',
    "rondonia": '(Rondonia OR Rondônia) (deforestation OR fire OR desmatamento OR queimadas)',
    "jakobshavn": '(Jakobshavn OR Ilulissat OR "Sermeq Kujalleq") (glacier OR ice OR melt)',
    "tulare": '("Tulare Lake" OR "Tulare County" OR "San Joaquin Valley") (subsidence OR groundwater OR flood OR drought)',
    "okavango": '(Okavango) (flood OR delta OR water)',
    "punjab": '(Punjab) (paddy OR stubble OR flood OR harvest OR wheat)',
    "mississippi": '("Mississippi River Delta" OR "coastal Louisiana" OR Plaquemines) (wetland OR land loss OR hurricane OR flood)',
    "kilauea": '(Kilauea OR Kīlauea) (eruption OR lava OR volcano)',
    "jasper": '(Jasper) (wildfire OR fire OR burn)',
    "thwaites": '(Thwaites) (glacier OR ice shelf OR Antarctica)',
    "nile": '("Nile Delta" OR Gharbia OR Kafr) (wheat OR rice OR cotton OR irrigation OR harvest)',
    "iowa": '(Iowa) (corn OR soybean OR harvest OR planting OR drought)',
    "matogrosso": '("Mato Grosso" OR Sorriso) (soy OR soja OR corn OR milho OR harvest OR safra)',
    "ukraine": '(Poltava OR Ukraine) (wheat OR harvest OR grain OR sowing)',
    "mekong": '("Mekong Delta" OR "Can Tho") (rice OR salinity OR flood OR harvest)',
    "phuprao": '("Ubon Ratchathani" OR "Sirindhorn dam") (rice OR drought OR flood OR harvest)',
}


# A headline must name the place AND the process, otherwise it is dropped.
RELEVANCE = {
    "konya": (["konya", "karapınar", "karapinar", "çumra", "cumra"], ["sinkhole", "obruk", "drought", "groundwater", "subsid", "kurak", "water", "su "]),
    "sylhet": (["sylhet", "sunamganj", "haor", "moulvibazar", "habiganj"], ["flood", "water", "rain", "monsoon"]),
    "rondonia": (["rondônia", "rondonia", "porto velho"], ["deforest", "fire", "burn", "desmat", "queimad", "amazon"]),
    "jakobshavn": (["jakobshavn", "ilulissat", "sermeq", "greenland"], ["glacier", "ice", "melt", "iceberg"]),
    "tulare": (["tulare", "san joaquin", "central valley", "kings county", "corcoran"], ["subsid", "groundwater", "flood", "drought", "aquifer", "sinking", "lake"]),
    "okavango": (["okavango", "maun", "botswana"], ["flood", "delta", "water", "drought"]),
    "punjab": (["punjab", "ludhiana", "patiala", "sangrur", "bathinda"], ["paddy", "stubble", "flood", "harvest", "wheat", "rice", "farm", "crop"]),
    "mississippi": (["louisiana", "plaquemines", "mississippi river delta", "barataria", "terrebonne"], ["wetland", "land loss", "coast", "hurricane", "flood", "marsh", "sediment"]),
    "kilauea": (["kilauea", "kīlauea", "halemaumau", "halemaʻumaʻu"], ["erupt", "lava", "volcan", "fountain", "quake"]),
    "jasper": (["jasper"], ["fire", "wildfire", "burn", "forest"]),
    "thwaites": (["thwaites"], ["glacier", "ice", "antarctic", "melt"]),
    "nile": (["nile delta", "gharbia", "kafr el", "egypt"], ["wheat", "rice", "cotton", "irrigation", "harvest", "crop"]),
    "iowa": (["iowa"], ["corn", "soybean", "harvest", "planting", "crop", "drought"]),
    "matogrosso": (["mato grosso", "sorriso"], ["soy", "soja", "corn", "milho", "harvest", "safra", "crop"]),
    "ukraine": (["poltava", "ukrain"], ["wheat", "harvest", "grain", "sowing", "crop"]),
    "mekong": (["mekong", "can tho"], ["rice", "salinity", "flood", "harvest", "crop"]),
    "phuprao": (["ubon", "sirindhorn"], ["rice", "drought", "flood", "harvest", "crop", "dam", "reservoir"]),
}


def relevant(site_id: str, title: str) -> bool:
    places, themes = RELEVANCE.get(site_id, ([], []))
    t = title.lower()
    return any(p in t for p in places) and any(k in t for k in themes)


def get_json(url: str, timeout: int = 90, retries: int = 3):
    last = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace") or "{}")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"{url[:80]}…: {last}")


def km(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    a = 0.5 - math.cos((lat2 - lat1) * p) / 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lon2 - lon1) * p)) / 2
    return 12742 * math.asin(math.sqrt(a))


def centroid(geom):
    c = geom.get("coordinates")
    if geom.get("type") == "Point":
        return c[1], c[0]
    pts = c[0] if geom.get("type") == "Polygon" else c
    # EONET polygons are sometimes [lat, lon]; detect by range
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    lon, lat = sum(xs) / len(xs), sum(ys) / len(ys)
    if abs(lat) > 90:
        lat, lon = lon, lat
    return lat, lon


def eonet(site, end):
    d = 2.0
    bbox = f"{site['lon'] - d},{site['lat'] + d},{site['lon'] + d},{site['lat'] - d}"
    url = "https://eonet.gsfc.nasa.gov/api/v3/events?" + urllib.parse.urlencode(
        {"start": START, "end": end, "bbox": bbox, "status": "all", "limit": 200})
    out = []
    for e in get_json(url).get("events", []):
        geo = e.get("geometry") or []
        if not geo:
            continue
        lat, lon = centroid(geo[0])
        src = (e.get("sources") or [{}])[0]
        out.append({
            "kind": "event", "source": "NASA EONET" + (f" / {src.get('id')}" if src.get("id") else ""),
            "category": ", ".join(c["title"] for c in e.get("categories", [])),
            "title": e.get("title"), "date": geo[0]["date"][:10],
            "end": (e.get("closed") or geo[-1]["date"])[:10],
            "url": src.get("url") or e.get("link"),
            "lat": round(lat, 3), "lon": round(lon, 3),
            "distKm": round(km(site["lat"], site["lon"], lat, lon)),
        })
    return out


def usgs(site, end):
    url = "https://earthquake.usgs.gov/fdsnws/event/1/query?" + urllib.parse.urlencode({
        "format": "geojson", "starttime": START, "endtime": end, "latitude": site["lat"], "longitude": site["lon"],
        "maxradiuskm": 250, "minmagnitude": 4, "orderby": "time"})
    out = []
    for f in get_json(url).get("features", [])[:40]:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"][:2]
        out.append({
            "kind": "quake", "source": "USGS", "category": "Earthquake",
            "title": p.get("title"), "date": datetime.fromtimestamp(p["time"] / 1000, timezone.utc).strftime("%Y-%m-%d"),
            "mag": p.get("mag"), "url": p.get("url"), "lat": round(lat, 3), "lon": round(lon, 3), "distKm": round(km(site["lat"], site["lon"], lat, lon)),
        })
    return out


def gdelt(site):
    q = NEWS_QUERY.get(site["id"])
    if not q:
        return []
    url = "https://api.gdeltproject.org/api/v2/doc/doc?" + urllib.parse.urlencode({
        "query": q, "mode": "artlist", "format": "json", "maxrecords": 25, "sort": "datedesc",
        "startdatetime": START.replace("-", "") + "000000"})
    data = get_json(url, timeout=60, retries=2)
    out = []
    seen = set()
    for a in data.get("articles", []):
        t = a.get("title", "").strip()
        if not t or t.lower() in seen or not relevant(site["id"], t):
            continue
        seen.add(t.lower())
        s = a.get("seendate", "")
        out.append({
            "kind": "news", "source": a.get("domain"), "category": "News",
            "title": t, "date": f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) >= 8 else None,
            "url": a.get("url"), "lang": a.get("language"),
        })
    return out[:15]


def fetch_tle():
    """Current NISAR orbital elements (NORAD 65053) from CelesTrak, used to place the satellite on the globe."""
    url = "https://celestrak.org/NORAD/elements/gp.php?CATNR=65053&FORMAT=TLE"
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        lines = [l.strip() for l in r.read().decode().splitlines() if l.strip()]
    l1 = next(l for l in lines if l.startswith("1 ")); l2 = next(l for l in lines if l.startswith("2 "))
    (OUT / "nisar_tle.json").write_text(json.dumps({"name": "NISAR", "norad": 65053, "line1": l1, "line2": l2,
                                                    "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}))
    print("TLE:", l1)


def main():
    try:
        fetch_tle()
    except Exception as e:  # noqa: BLE001
        print("   ! TLE refresh failed, keeping the saved one:", e)
    sites = json.loads((ROOT / "pipeline" / "sites.json").read_text())
    end = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = OUT / "events.json"
    old = json.loads(path.read_text())["sites"] if path.exists() else {}
    res = {}
    status = {}
    for s in sites:
        items = []
        for name, fn in (("eonet", lambda: eonet(s, end)), ("usgs", lambda: usgs(s, end)), ("gdelt", lambda: gdelt(s))):
            try:
                got = fn()
                items += got
                status[name] = status.get(name, "ok")
            except Exception as e:  # noqa: BLE001
                print(f"   ! {s['id']} {name}: {e}")
                status[name] = "unavailable"
                # keep previously fetched items from this source
                items += [x for x in old.get(s["id"], []) if x.get("kind") == {"eonet": "event", "usgs": "quake", "gdelt": "news"}[name]]
            if name == "gdelt":
                time.sleep(6)  # GDELT asks for <= 1 request / 5 s
        items.sort(key=lambda x: x.get("date") or "", reverse=True)
        res[s["id"]] = items
        print(f"{s['id']:12s} " + " ".join(f"{k}:{sum(1 for x in items if x['kind'] == k)}" for k in ("event", "quake", "news")))
    path.write_text(json.dumps({"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                "sources": status, "sites": res}, separators=(",", ":")))
    print("wrote", path)


if __name__ == "__main__":
    main()
