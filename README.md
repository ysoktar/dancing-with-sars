# ∿ Dancing with the SARs

**A 3-D globe, timeline and in-browser analysis lab for real NISAR L-band radar data.**
NASA Space Apps Challenge 2026 · challenge *“Dancing with the SARs”*.

* **Live site:** <https://ysoktar.github.io/dancing-with-sars/>
* **Code:** <https://github.com/ysoktar/dancing-with-sars>

Earth's surface keeps changing. Monsoon floods spread and recede, forests are cleared, rice is flooded, grown and harvested, and glaciers melt and refreeze. The NASA–ISRO **NISAR** satellite images all of it every 12 days, day and night, through cloud. This project turns NISAR's public Level-2 products into a website anyone can explore. It is honest about what radar can and cannot tell you.

---

## Contents

1. [Space Apps submission: copy-paste fields](#1-space-apps-submission-copy-paste-fields)
2. [What the website does](#2-what-the-website-does)
3. [Study sites](#3-study-sites)
4. [Data sources](#4-data-sources)
5. [Methodology](#5-methodology)
6. [Machine learning](#6-machine-learning)
7. [Validation, uncertainty and limitations](#7-validation-uncertainty-and-limitations)
8. [Run, rebuild and deploy](#8-run-rebuild-and-deploy)
9. [Repository layout](#9-repository-layout)
10. [Credits and licences](#10-credits-and-licences)

---

## 1. Space Apps submission: copy-paste fields

Each block below matches one field of the Space Apps project form.

### Project Name

```
Dancing with the SARs: a NISAR change atlas
```

### Summary (under 1,500 characters)

```
We built an interactive 3-D globe for farmland, crop and yield segmentation with real NISAR L-band radar data. Click any farming region on Earth: every NISAR pass over it is fetched live from NASA's ASF archive, aligned and analysed in the browser. The site segments crops (paddy rice, double, single, perennial), delineates fields with their own calendars, ranks fields by relative yield potential with management zones inside fields, and separates cropland from forest. A pretrained deep network (U-TAE, trained on the PASTIS benchmark) runs in the browser on Sentinel-2 time series to name crop types. A parcel report adds elevation, NASA POWER weather and crop calendars, and an archive tab lists every radar pass back to Seasat (1978). The globe shows worldwide NISAR mosaics for every 12-day cycle since October 2025, a global cropland/forest layer, full-resolution radar frames when zoomed in, relief shading and the live satellite. Radar sees through clouds and darkness, so crops can be followed through the monsoon, when optical satellites are blind. Every result states its confidence and what SAR can and cannot measure.
```

### Project Demonstration (slides ≤ 7 or video ≤ 30 s)

Suggested 7-slide deck. Each line is one slide, using screenshots from the live site:

1. **Title.** "Dancing with the SARs: a NISAR change atlas", with the globe and a mosaic.
2. **The problem.** Clouds and darkness hide floods and harvests. NISAR L-band sees through both, every 12 days.
3. **Globe and timeline.** World mosaics per cycle, the satellite orbit and swath, density and events layers.
4. **Site page.** Radar images, interferograms, change detection with confidence (Sylhet flood, Rondônia clearing).
5. **Agriculture lab.** Crop calendar, harvest and flooding, cropping patterns, cropland vs forest (Punjab, Mekong, Phu Prao).
6. **Honesty layer.** What SAR can and cannot tell; forecasts with ranges and assumptions; Google flood history vs NISAR water.
7. **Open and automatic.** No-login pipeline, weekly GitHub Actions refresh, open code and the ML notebooks.

Upload the deck (PDF) or a 30-second screen recording to a public host and paste the link.

### Project (public link)

```
https://ysoktar.github.io/dancing-with-sars/
```

### Project Details

Paste the text below. Headings are written so they survive the form's rich-text editor.

```
WHAT IT DOES
Dancing with the SARs is a website for farmland, crop and yield segmentation from the NASA–ISRO NISAR radar satellite, for any place on Earth.

• Pick any region. Click the globe, type a place name or coordinates, and choose a window (5–120 km). The browser searches NASA's ASF archive, downloads every NISAR pass on the best track, aligns the dates by phase correlation and builds the radar time series. Nothing is precomputed or installed.

• Crops & yield, per pixel:
  – crop segmentation: paddy rice, double crop, single crop, perennial, water, bare;
  – fields: field-like segments, each with its own sowing, peak and harvest dates;
  – yield segmentation: fields ranked by relative yield potential (accumulated radar canopy and its peak), with management zones inside each field;
  – deep learning: the published U-TAE network (PASTIS benchmark, 63–65 % mIoU) runs in the browser on a Sentinel-2 time series of a 1.28 km window and names crop types;
  – cropland vs forest, crop calendar, harvest and paddy flooding, NASA POWER weather and MODIS NDVI.

• Parcel report: geometry and elevation range, radar vegetation-index signatures of crop types vs forest (with the region's real NISAR curve), a monthly crop/forest calendar matrix, a year of NASA POWER weather, and references.

• Archive 1978→: every radar acquisition the ASF archive holds over the region (Seasat, ERS, JERS-1, RADARSAT-1, ALOS PALSAR, UAVSAR, Sentinel-1, NISAR), and an L-band "then vs now" view (ALOS PALSAR 2006–2011 vs NISAR).

• Globe and timeline. Worldwide NISAR mosaics for every 12-day cycle since the first products (12 Oct 2025), a global cropland/forest layer, full-resolution NISAR frames streamed from ASF when zoomed in, relief shading from surface normals, polar caps closed, NISAR's live position and radar swath. The timeline runs from Seasat (1978) to today and marks each radar mission.

HOW IT WORKS
Region analysis happens entirely in the browser: the ASF search API, NISAR browse images, NASA POWER, NASA GIBS, Sentinel-2 Cloud-Optimized GeoTIFFs and elevation tiles are all public and CORS-enabled, so a Web Worker downloads, co-registers (FFT phase correlation), filters (multi-temporal Quegan speckle filter) and segments the radar series, and a second worker runs the U-TAE network with ONNX Runtime (WebAssembly). A Python pipeline without login builds the world mosaics (about 16,000 frames per 12-day cycle, feathered blending, per-frame gain matching, temporal gap filling, polar caps), the cropland/forest layer and the relief normal map; GitHub Actions publishes the site.

BENEFITS AND IMPACT
Radar works through cloud and at night, exactly when monsoon crops grow. Anyone can open their own district and see which fields were sown, flooded and harvested when, which fields lag behind their neighbours, and where cropland meets forest, without installing anything. Every result states its confidence and whether SAR measures it directly, estimates it with other data, or cannot see it.

TOOLS
JavaScript (Vite, globe.gl / three.js, Chart.js, satellite.js, geotiff.js, ONNX Runtime Web, Web Workers), Python (numpy, Pillow, scipy, PyTorch for the ONNX export), GitHub Actions and Pages, Google Colab and PyTorch for the deep-learning notebooks (U-Mamba, SITSMamba, U-TAE; Google's Flood Hub LSTM).

WHAT MAKES IT CREATIVE
Any region on Earth, analysed live from the public archive in the browser, with radar and a pretrained deep network side by side. One timeline spans 48 years of spaceborne radar. Every page carries an explicit honesty layer: confidence scores, domain-shift warnings for the deep model, and the limits of what radar can see.

WHAT WE CONSIDERED
Data volume: the full NISAR archive is petabytes, so we use browse products and document the route to calibrated data. Products are labelled beta or provisional, and we say so. Browse brightness is relative, not calibrated backscatter. Rule-based crop products are labelled as such; the yield index is relative, not t/ha; the deep model was trained in France and says so outside that domain; models are never evaluated on their own training period. Performance on phones matters, hence Web Workers, level-of-detail tiles and pausing the globe when it is hidden.
```

### Use of Super Intelligence (SI)

Select the options that apply. Suggested statement for the form and the site:

```
SI tools were used to help write code and documentation. An AI coding assistant (Anthropic Claude, via Claude Code) helped implement the data pipeline, the web application and the machine-learning notebooks, and draft explanatory text. The team directed the design, chose the data and methods, reviewed and tested the code, and checked the results. All radar images, maps and charts on the site are produced from NASA and partner data by our code; none are AI-generated images. No NASA logos, flags or mission identifiers were generated or modified.
```

### NASA Data (Link Text → Link URL)

| Link Text | Link URL |
|---|---|
| NISAR mission (NASA/JPL) | https://nisar.jpl.nasa.gov/ |
| NISAR L2 GCOV, GUNW, GOFF products via ASF DAAC Vertex | https://search.asf.alaska.edu/ |
| NISAR product documentation (ASF) | https://nisar-docs.asf.alaska.edu/ |
| ASF DAAC Search API | https://docs.asf.alaska.edu/api/basics/ |
| NASA Common Metadata Repository (CMR) | https://cmr.earthdata.nasa.gov/search |
| NASA Earthdata Search | https://search.earthdata.nasa.gov/search |
| NASA EONET natural events | https://eonet.gsfc.nasa.gov/ |
| NASA GIBS (MODIS Terra NDVI 16-day, true colour) | https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api |
| NASA POWER daily weather (precipitation, temperature) | https://power.larc.nasa.gov/ |
| NASA Blue Marble base map (GIBS shaded relief + bathymetry tiles) | https://visibleearth.nasa.gov/collection/1484/blue-marble |
| Seasat SAR (1978, NASA/JPL) via ASF | https://asf.alaska.edu/data-sets/sar-data-sets/seasat/ |
| UAVSAR airborne L-band (NASA/JPL) via ASF | https://uavsar.jpl.nasa.gov/ |
| NASA Earthdata Login (optional calibrated HDF5 route) | https://urs.earthdata.nasa.gov/ |
| NASA IMERG precipitation (input of the flood model, notebook 05) | https://gpm.nasa.gov/data/imerg |
| NASA Earthdata: SAR basics | https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar |
| NISAR societal benefit applications | https://nisar.jpl.nasa.gov/applications/societal-benefit/ |
| UAVSAR education resources | https://uavsar.jpl.nasa.gov/education/postcards.html |
| NASA Applied Sciences (ARSET) training | https://appliedsciences.nasa.gov/get-involved/training |

### Space Agency Partner & Other Data (Link Text → Link URL)

| Link Text | Link URL |
|---|---|
| ISRO: NISAR partner agency | https://www.isro.gov.in/ |
| Copernicus DEM GLO-30 (ESA / Airbus), AWS Open Data | https://registry.opendata.aws/copernicus-dem/ |
| CSA RADARSAT Constellation Mission (data page) | https://donnees-data.asc-csa.gc.ca/en/dataset/rcm |
| CSA RADARSAT-1 (data page) | https://donnees-data.asc-csa.gc.ca/en/dataset/radarsat1 |
| CSA SAR tutorial | https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial |
| CONAE SAOCOM catalogue | https://catalogos.conae.gov.ar/catalogo/catalogoSatSaocomInfo.html |
| Google Flood Forecasting (Flood Hub) | https://sites.research.google/gr/floodforecasting/ |
| Google inundation history 1999–2020 (CC-BY-4.0) | https://console.cloud.google.com/storage/browser/flood-forecasting/inundation_history |
| Google OpenHydroNet code and pretrained weights (Apache-2.0) | https://github.com/google-research/flood-forecasting |
| Caravan hydrology dataset (Zenodo) | https://doi.org/10.5281/zenodo.6522634 |
| MultiMet Caravan extension (HRES, GraphCast, IMERG, CPC) | https://console.cloud.google.com/storage/browser/caravan-multimet |
| USGS earthquake catalogue API | https://earthquake.usgs.gov/fdsnws/event/1/ |
| GDELT news API | https://www.gdeltproject.org/ |
| CelesTrak orbital elements (NISAR, NORAD 65053) | https://celestrak.org/ |
| Sentinel-2 L2A Cloud-Optimized GeoTIFFs (ESA Copernicus) via Element 84 Earth Search | https://earth-search.aws.element84.com/v1 |
| Sentinel-2 cloudless 2024 base map by EOX (CC BY-NC-SA 4.0) | https://s2maps.eu/ |
| Sentinel-1, ERS-1/2 (ESA), JERS-1, ALOS PALSAR (JAXA), RADARSAT-1 (CSA) archives via ASF | https://search.asf.alaska.edu/ |
| Terrarium elevation tiles (Mapzen / Tilezen, AWS Open Data) | https://registry.opendata.aws/terrain-tiles/ |
| OpenStreetMap Nominatim (place search) | https://nominatim.org/ |
| U-TAE pretrained PASTIS weights (Zenodo 5172293) | https://zenodo.org/records/5172293 |
| PASTIS normalisation statistics (Zenodo 5012942) | https://zenodo.org/records/5012942 |
| ONNX Runtime Web | https://onnxruntime.ai/ |
| geotiff.js | https://geotiffjs.github.io/ |
| Natural Earth land polygons | https://www.naturalearthdata.com/ |
| PASTIS-R crop benchmark | https://github.com/VSainteuf/pastis-benchmark |
| YieldSAT dataset | https://yieldsat.github.io/ |
| U-TAE pretrained weights (utae-paps) | https://github.com/VSainteuf/utae-paps |
| Mamba selective-scan kernels (state-spaces/mamba) | https://github.com/state-spaces/mamba |
| U-Mamba paper | https://arxiv.org/abs/2604.00940 |
| SITSMamba paper | https://arxiv.org/abs/2409.09673 |
| globe.gl | https://github.com/vasturiano/globe.gl |
| three.js | https://threejs.org/ |
| Chart.js | https://www.chartjs.org/ |
| satellite.js | https://github.com/shashwatak/satellite-js |
| Vite | https://vitejs.dev/ |
| PyTorch | https://pytorch.org/ |

---

## 2. What the website does

| Part | What you get |
|---|---|
| **Globe** | World NISAR mosaics per 12-day cycle (8k texture; 1 km tiles; **full-resolution NISAR frames streamed live from ASF** below ~3,000 km view altitude, colour-matched to the mosaic). Relief shading from a global normal map. Polar caps beyond NISAR's reach (> ~78° N, < ~87.5° S) closed by a smooth fill, flagged in the data. Base map: NASA GIBS Blue Marble relief + bathymetry, Sentinel-2 cloudless when zoomed in. Layers: global **cropland & forest** (from the mosaics), monthly acquisition density, NASA EONET events, night lights, NISAR's live position, track and swath. |
| **Timeline** | One line from Seasat (1978) to today. The archive years take the first quarter (L-band missions light blue, C-band grey), NISAR's era the rest (amber = world mosaic cycles, white = the open region's passes). Launch (30 Jul 2025) and first products (12 Oct 2025) are marked. |
| **Select region** | Pick a point on the globe, search a place or type "lat, lon", set the window (22 / 49 / 89 km or any 5–120 km). Recent regions are remembered in the browser. |
| **Region page** | *Summary · Crops & yield · Parcel report · Archive 1978→ · Radar images · Change & ML · Forecast*. |
| **Crops & yield** | Crop segmentation · Fields · Yield segmentation · Deep learning (U-TAE) · Cropland vs forest · Crop calendar · Harvest & flooding · Weather & NDVI. |
| **Parcel report** | The team's parcel analyzer on the web: geometry and elevation, RVI signatures (reference crops vs the region's real NISAR curve), monthly calendar matrix, a year of NASA POWER weather, references. |
| **Archive 1978→** | Every radar acquisition ASF holds over the point, per mission and year, browse samples, and ALOS PALSAR (L-band, 2006–11) next to NISAR. |
| **What radar can tell** | What L-band SAR measures directly, what it estimates with other data, what it cannot see. |
| **Data & methods** | Sources, challenge resources, partner missions, the route to the full archive. |

Every view has a shareable link (`#/region/<lon>/<lat>/<half-width°>/<tab>`). Heavy work runs in Web Workers; the globe pauses while a page covers it.

## 3. Regions

There are no predefined places: any point covered by NISAR can be analysed. The pipeline still contains 17 benchmark regions (`pipeline/sites.json`: Punjab, Nile Delta, Iowa, Mato Grosso, Poltava, Mekong, Phu Prao/Sirindhorn, Konya, Tulare, Sylhet, Rondônia, …) used to develop and test the methods; their precomputed data (crops, DEM, weather, flood history) remain in `web/public/data/` and are used by the README figures and the cross-checks below.

## 4. Data sources

| Data | Provider | Used for | Access |
|---|---|---|---|
| NISAR L2 **GCOV** (geocoded covariance, HH/HV) browse images | NASA/JPL & ISRO, ASF DAAC | site time series, world mosaics | public browse PNG, no login |
| NISAR L2 **GUNW** (unwrapped interferograms) and **GOFF** (offsets) | NASA/JPL & ISRO, ASF DAAC | ground-motion tab | public browse PNG |
| NISAR granule metadata | ASF Search API, NASA CMR | search, footprints, density | public API |
| NISAR orbit (TLE, NORAD 65053) | CelesTrak | satellite position, track and swath | public |
| Copernicus DEM GLO-30 | ESA / Airbus, AWS Open Data | elevation, 3-D terrain | public |
| MODIS Terra NDVI (16-day) and true colour | NASA GIBS | optical comparison | public WMS |
| Daily precipitation and 2 m temperature | NASA POWER | weather context | public API |
| Natural events | NASA EONET | events layer, site events | public API |
| Earthquakes | USGS | site events | public API |
| News headlines | GDELT | site news (context only) | public API |
| Inundation history 1999–2020 | Google Flood Forecasting (GLAD-derived), CC-BY-4.0 | flood-history tool | public bucket |
| Land polygons | Natural Earth 1:50m | mosaic land mask | public |
| Flood Hub LSTM weights, Caravan, MultiMet | Google Research, Caravan | notebook 05 | public |
| PASTIS-R, YieldSAT | academic datasets | notebooks 01–04 | public download |

**Data history.**

| Period | Products | Frames per cycle |
|---|---|---|
| Oct 2025 – Jan 2026 | beta products | ~3.5k |
| Jan – Jun 2026 | sparse | ~300 in total |
| From 15 Jun 2026 | full provisional | ~16k |
| From 25 Oct 2026 | validated | ~16k |

Earlier periods are merged into longer windows so that each world mosaic has enough frames.

**Size of the full archive.** See [docs/GLOBAL_DATA.md](docs/GLOBAL_DATA.md) for the per-product estimates and step-by-step download routes.

| Product | Approximate size |
|---|---|
| GCOV | ~605 TB |
| GUNW | ~155 TB |
| GOFF | ~29 TB |
| All NISAR products | ~5.6 PB |
| GCOV browse images (what this site uses) | ~0.7 TB |
| NASADEM | ~116 GB |
| Copernicus GLO-30 | ~535 GB |

## 5. Methodology

### 5.1 Site time series (`pipeline/build_data.py`)

1. **Search.** The ASF search API lists every NISAR L2 GCOV granule that intersects the site window (±0.22° in latitude, widened in longitude by 1/cos φ so the window is square on the ground, ~49 km).
2. **Track lock.** The path / frame / direction that fully covers the window most often is kept, so every date has the same viewing geometry.
3. **Imagery.** The geocoded browse image of each granule (`*_LATLON.png`: R = HH, G = HV, B = HH) is resampled to a 256 × 256 crop. Validated products carry KML bounds. For provisional ones the bounds are fitted from the granule footprint.
4. **Co-registration.** Every date is aligned to a reference date by FFT phase correlation (sub-pixel peak). Residual shifts are recorded per date (`coregShiftKm`).
5. **No-data handling.** Only the swath edge and true no-data are masked (footprint mask + edge zeroing), so large lakes and reservoirs are not removed as "no data".
6. **Statistics.** Per-date HH/HV means, spread, HV/HH ratio and the dark (water-like) fraction from a scene Otsu threshold.

### 5.2 Ground motion (`build_motion.py`)
GUNW and GOFF granules on the site's track are cropped the same way and paired by date. The UI explains fringes, line of sight and decorrelation. Deformation is shown, not inverted.

### 5.3 World mosaics (`build_mosaic.py`)
1. **Frames.** All GCOV browse frames of a period are listed from CMR and downloaded in parallel. Beta browse images (`<granule>.png`, map-projected) are accepted, except where |lat| > 60°, where their projection is unreliable. Longitudes are unwrapped across the antimeridian.
2. **Blending.** Each frame gets a feathered weight: distance to its own edge (Euclidean distance transform), raised to 1.5. Dual-pol frames get weight 1.0, single-pol ones 0.03, so they only fill gaps.
3. **Radiometric balancing.** A two-pass gain/offset match of every frame to the consensus of its neighbours (20/50/80 % percentiles, gain clipped to 0.6–1.6) removes the patchwork of different passes.
4. **Mask.** Land and ice shelves (Natural Earth 1:50m), plus everything poleward of 55°, where sea ice is real NISAR signal. Open ocean nearer the equator is masked.
5. **Gap filling.** Pixels without data in a period are filled from the period nearest in time (`--fill-gaps`). The filled share is recorded per period.
6. **Outputs.** 8k and 4k equirectangular WebP per period. The globe shows 4k while moving and 8k at rest. For the latest full cycle, 10° × 10° tiles at 0.01° (~1 km) are loaded when zoomed in.

### 5.4 Change detection
* Lee speckle filter (5 × 5).
* Log-ratio of two dates. Otsu's method picks the threshold.
* Per-pixel confidence = distance beyond the threshold relative to the spread of unchanged pixels.
* Areas are given in km².

### 5.5 Agriculture (`web/src/agri.js`, runs in the Web Worker)
* **RVI** = 4·HV / (HH + HV), from browse brightness, so it is *relative*.
* **Phenology.** On the 1-2-1 smoothed RVI series:
  * peak = maximum;
  * start of season = 50 % of the rise before the peak;
  * end of season = 50 % of the fall after it.
* **Harvest** = the sharpest drop from an above-average RVI level, accepted if it exceeds max(0.06, 35 % of the seasonal amplitude).
* **Paddy flooding** = a pass on which HH is below the water threshold, followed within 70 days by HH above 1.15 × the threshold.
* **Water threshold.** Scene Otsu on HH, capped at 90 (browse scale). Where a scene has little water, Otsu splits forest from pasture rather than land from water.
* **Cropping patterns.** Cropland = seasonal amplitude above max(0.05, 0.6 × the 75th percentile). Then, in order:
  * water: dark on ≥ 60 % of passes;
  * paddy: cropland with a flooding event;
  * double crop: cropland with ≥ 2 prominent peaks;
  * single crop: other cropland;
  * perennial: high mean RVI;
  * bare / built: the rest.
* **Fields.** 3 × 3 majority filter, then connected components keyed by pattern and harvest month (≥ 6 pixels, largest 120 listed).
* **Cropland vs forest.** Two physical axes:
  * x = seasonal swing of RVI (crops are sown and harvested);
  * y = mean HV (woody canopies depolarise L-band all year).

  Thresholds:
  * mean HV: Otsu on non-water pixels;
  * swing: the upper-quartile rule;
  * water: HH < 50 on ≥ 60 % of passes. This is stricter here because dry, smooth pasture is almost as dark as water.

  Classes: forest, cropland, tree crops / mixed, water, grass / bare / built. Each pixel gets a confidence = distance to the nearest threshold, scaled by the axis spread. The forest–cropland edge length is reported as a proxy for the clearing frontier.
* **Context.**
  * NASA POWER daily precipitation and temperature.
  * MODIS NDVI 16-day composites (GIBS WMS PNG, converted back to NDVI with the official colour map; scene mean of cloud-free pixels).

### 5.6 Flood history (`build_inundation.py`)
* Google's inundation-history polygons (wet ≥ 0.5 %, ≥ 1 % and ≥ 5 % of the time, 1999–2020, permanent water removed) are rasterised onto each site's 256 × 256 grid.
* In the browser, NISAR water on the chosen pass (HH below the capped threshold) is overlaid.
* Reported:
  * the share of NISAR water inside the historical zones;
  * the share of the flood-prone zone NISAR saw wet.
* Water on ≥ 90 % of passes *outside* the zones is shown as permanent water.

### 5.7 Forecast
* Damped linear trend on the per-pass series.
* Bootstrap residuals give 80 / 95 % ranges.
* Rolling backtest against "same as last pass".
* A forecastability verdict (some processes, such as flood onset, are not forecastable from the series alone).
* Assumptions are listed on the page.

### 5.8 Events & news
* NASA EONET events and USGS earthquakes within the site window and ±15 days of a pass.
* GDELT headlines filtered by place and topic keywords.
* Shown as context, never as validation.

### 5.9 Live regions (`web/src/regionFetch.js`, in the Web Worker)
1. **Search.** ASF search API, all GCOV granules over the point (`output=jsonlite`).
2. **Track.** The path / frame / direction that fully covers the window most often; one granule per date, validated before provisional, latest processing.
3. **Download.** Four parallel downloads of the public `*_LATLON.png` browse images (~4 MB each, R = HH, G = HV).
4. **Bounds.** KML for validated products; for provisional ones, the valid-pixel extent fitted to the footprint polygon (as in the pipeline).
5. **Co-registration.** Radix-2 FFT phase correlation on a 256 × 256 window 2.2× the region (Hann window, normalised cross-power, peak / σ ≥ 6), iterated up to 4 times; dates that do not lock take the median shift.
6. **Crop and mask.** 256 × 256 crop; valid = inside the footprint (shrunk ~1.5 km) and not border-connected no-data.
7. **Speckle.** Multi-temporal Quegan–Yu filter, J_t = E_t · (1/T) Σ_k I_k / E_k with 5 × 5 local means, then a light 3 × 3 Lee pass (Lee 5 × 5 when fewer than 4 dates).

### 5.10 Yield segmentation (`computeYield` in `agri.js`)
* For each cropland pixel: area under the smoothed RVI curve above its own minimum, between its start and end of season (accumulated canopy × duration), and the seasonal peak.
* Both are converted to percentile ranks within the window and combined (0.6 · area + 0.4 · peak) into an index from 0 (weakest crop in the window) to 1 (strongest), shown in five classes.
* Per field: mean index and spread over each field segment; fields are ranked.
* Management zones: pixels more than 0.2 below / above their own field's mean.
* It is **relative**: it ranks fields against their neighbours under the same season and similar crops, and does not give tonnes per hectare. Converting it needs harvest records (the YieldSAT models in `ml/`).

### 5.11 Deep learning in the browser (`web/src/dlWorker.js`, `ml/export_utae_onnx.py`)
* **Model.** U-TAE (Garnot & Landrieu, ICCV 2021): a U-Net whose skip connections are aggregated over time by a lightweight temporal attention encoder (L-TAE). Published PASTIS weights, fold 2 (test mIoU 65.0 %, OA 84.1 %).
* **Export.** A compact re-implementation with identical parameter names loads all 158 tensors strictly (`torch.load(weights_only=True)`), is exported to ONNX (opset 17, dynamic number of dates, 4.5 MB) and checked against PyTorch (max |Δ| 4e-5 for 7 and 20 dates).
* **Input.** For the chosen 1.28 × 1.28 km window, Sentinel-2 L2A scenes with < 30 % cloud are found through the Earth Search STAC API for one season (1 Sept → 31 Oct, as in PASTIS); up to 24 dates spread over the season. Ten bands (B2–B8A, B11, B12) are read straight from the Cloud-Optimized GeoTIFFs with HTTP range requests (geotiff.js), resampled to 10 m, the L2A offset removed where needed, and normalised with the PASTIS statistics (read from the PASTIS archive's `NORM_S2_patch.json`). Positions are days since 1 September.
* **Output.** Argmax over the 19 real classes (void excluded), softmax confidence per pixel, area and mean confidence per class.
* **Check.** In France (in-domain) the exported model returns 40 % soft winter wheat, 21 % rapeseed, 11 % winter barley in the Beauce, with crisp field boundaries, and "background" over woodland.
* **Domain shift.** Outside Western Europe the classes are the nearest French equivalent; the page warns, and the results are presented as field delineation plus a crop-group hint.

### 5.12 Parcel report (`web/src/pages/report.js`)
A port of the team's desktop analyzer (`Nasa.py`):
* **Elevation.** Terrarium tiles over the whole window (thousands of samples, 1st–99th percentile) instead of 9 points.
* **Weather.** NASA POWER daily T2M_MIN, T2M_MAX and PRECTOTCORR for the last 12 months; frost days and annual rain.
* **Reference curves.** Winter grain, summer crop, double crop, rice, orchard and forest RVI curves adapted to the local climate (warmest period, frost, altitude).
* **Real data.** The region's NISAR cropland RVI, rescaled to the reference range, is plotted on top and used for row 1 of the calendar matrix. Both NISAR's dominant crop pattern and the climate-based expectation are stated.

### 5.13 Archive 1978→ (`web/src/archive.js`)
* ASF search over the point for Seasat, ERS-1/2, JERS-1, RADARSAT-1, ALOS PALSAR, UAVSAR, Sentinel-1 and NISAR.
* Sentinel-1 and NISAR are counted per year with `output=count`; the others are listed per acquisition date.
* The ALOS PALSAR radiometrically terrain-corrected browse closest to July is shown next to NISAR's latest HH.
* Archive browse images are displayed, not analysed: the browse server sends no CORS header.

### 5.14 Globe rendering
* **Relief.** A tangent-space normal map is computed from global elevation (`build_normalmap.py`: Terrarium z5 → 8192 × 4096 equirectangular, true ground spacing, 12× vertical exaggeration). It lights the base globe, the mosaics and their tiles (Phong shading, sun fixed to the camera).
* **Native frames.** Below ~3,000 km altitude, the 12 NISAR frames of the current cycle nearest the view centre are fetched from ASF. Each is matched (gain/offset per channel) to the 4k mosaic underneath, its dim swath rim is dropped, and it is feathered into the mosaic.
* **Cropland & forest.** `build_landcover.py` applies the two-axis rule (seasonal RVI swing vs mean HV) to the eight full cycles since 15 June 2026.
* **Polar caps.** NISAR never images beyond ~78° N or ~87.5° S, so the cap past the last imaged latitude is filled from the mean of the last ~3° of data along each meridian. The fill is blended toward the cap mean at the pole and recorded as `polarFill` in each cycle's JSON.

## 6. Machine learning

**In the browser (Web Worker, no server).**
* k-means++ on six standardized per-pixel features: HH and HV on the date, their contrast, temporal means, and variability.
* Confidence = 1 − d₁/d₂ (distance to the nearest centre over distance to the second nearest).
* A rule-based physical reading of each cluster.
* Change detection and the agriculture products above.

**Notebooks (`ml/`, Google Colab, Drive-cached, resumable).**

| Notebook | What it does |
|---|---|
| `01_UMamba_PASTIS-R_to_YieldSAT` | U-Mamba (CNN encoder–decoder with Mamba blocks) trained on PASTIS-R (Sentinel-1 + 2 crop parcels), then transferred to YieldSAT. Transfer maps band names and re-initialises heads; a yield head is added. |
| `02_SITSMamba_PASTIS-R_to_YieldSAT` | SITSMamba (CNN spatial encoder + Mamba temporal encoder + reconstruction branch), same two stages. |
| `03_UTAE_pretrained_PASTIS-R_to_YieldSAT` | Published U-TAE weights, fine-tuned. The fold-k weights are tested on a fold they were not trained on, so there is no leakage. |
| `04_Compare_models` | One table and plots for all runs; old runs are cleaned up. |
| `05_Google_FloodHub_LSTM` | Google's open-sourced Flood Hub river model (Mean-Embedding Forecast LSTM, pretrained 110 epochs). It runs on the Caravan gauges nearest to each site, **only after the model's training window** (from Oct 2023), and exports hydrographs and NSE/KGE as `flood_lstm.json`. |

**Implementation notes.**
* A pure-PyTorch Mamba fallback, parameter-compatible with `mamba_ssm`, is used when the CUDA kernels cannot be built.
* For satellite time series (L ≤ 64) the fallback uses a sequential selective scan with a hand-written backward pass. It recomputes hidden states in batch chunks, so memory stays bounded (the CUDA kernel does the same). Its gradient is checked against autograd at start-up.
* Checkpoints (`last.pt`) are written mid-epoch, so a Colab disconnect resumes where it stopped.

Details: [ml/README.md](ml/README.md).

## 7. Validation, uncertainty and limitations

* **Browse images.** Brightness values come from 8-bit browse images (≈ 100–150 m effective pixels), not calibrated γ⁰ at 10–20 m. Indices are relative. `pipeline/fetch_hdf5.py` shows the calibrated route (NASA Earthdata login).
* **Product maturity.** Products are labelled *beta* (before Jan 2026) or *provisional* (until 25 Oct 2026) by the NISAR project and may be reprocessed.
* **Rule-based products.** Crop products and land cover are rules relative to each scene, not trained classifiers. They show timing and behaviour, not species or yield.
* **Short series.** With fewer than ~10 passes, or less than a full year, some seasons are invisible.
* **Wet-season-only series.** At Sylhet and the Mekong, wet-season flooding can look permanent.
* **Look-alikes.**
  * Smooth dry soil and wet snow can look like water.
  * Flooded forest and buildings appear bright (double bounce).
* **Ground motion.** Interferograms are shown as products. No time-series inversion is done.
* **Forecasts.** Short and statistical. The page says when a series is not forecastable.
* **Google flood history.** It ends in 2020, and irrigated paddies count as "wet".
* **Flood LSTM.** Its input data ends in late 2024, so it does not overlap NISAR yet.
* **Live regions.** Quality depends on the track: a window near a swath edge may have few full passes. ASF or Earth Search outages show as an error message, not as wrong data.
* **Yield index.** Relative within the window; different crops or sowing dates in one window rank differently for that reason alone.
* **U-TAE.** Trained on French farmland; outside that domain, read it as field delineation plus a crop-group hint.
* **Polar caps.** The filled caps beyond NISAR's reach are a smooth extrapolation, not observations.
* **News.** Headlines are matched by keywords and can be unrelated.

## 8. Run, rebuild and deploy

```bash
pip install -r pipeline/requirements.txt
```

```bash
cd web && npm ci && npm run dev        # http://localhost:5173
```

Rebuild data (no login needed):

```bash
python3 pipeline/build_data.py --workers 8            # GCOV site series + catalog.json + coverage
```

```bash
python3 pipeline/build_motion.py                     # GUNW / GOFF
```

```bash
python3 pipeline/build_dem.py                        # Copernicus DEM per site
```

```bash
python3 pipeline/build_context.py                    # NASA POWER weather + MODIS NDVI
```

```bash
python3 pipeline/build_inundation.py                 # Google flood history per site
```

```bash
python3 pipeline/build_events.py                     # EONET, USGS, GDELT, NISAR TLE
```

```bash
python3 pipeline/build_mosaic.py --start 2026-10-13 --days 12 --workers 16 --tiles
```

```bash
python3 pipeline/build_mosaic.py --fill-gaps          # temporal gap filling + polar caps, all cycles
```

```bash
python3 pipeline/build_landcover.py                  # global cropland / forest layer from the mosaics
```

```bash
python3 pipeline/build_normalmap.py                  # relief normal map from Terrarium elevation
```

```bash
python ml/export_utae_onnx.py UTAE_SemanticSeg_weights.zip NORM_S2_patch.json 2   # U-TAE -> web/public/models/
```

To use your own fine-tuned U-TAE (notebook 03), pass its checkpoint instead of the zip.

A world mosaic needs ~6–8 GB of RAM at 8k. Build periods one after another, not in parallel.

**Add a site.** Add a line to `pipeline/sites.json` (`id, name, country, lon, lat, half_deg, theme`) and a story in `web/src/sites.js`, then run the per-site scripts with `--sites <id>`.

**Deploy.** `.github/workflows/deploy.yml` builds `web/` and publishes it to GitHub Pages:
* **Triggers:** every push to `main`, weekly, and manual dispatch.
* **Refresh:** the weekly and manual runs refresh the site data.
* **Mosaic:** the manual run can also rebuild a mosaic (`mosaic_start`).
* **Setup:** set *Settings → Pages → Source* to *GitHub Actions*.

## 9. Repository layout

```
pipeline/            data pipeline (Python, no login)
  sites.json         study sites
  build_*.py         one script per data product
web/                 website (Vite)
  src/main.js        boot, router, timeline
  src/globe.js       globe, mosaics, LOD tiles, satellite + swath
  src/sarWorker.js   Web Worker: all pixel work (live regions, filters, crops, yield)
  src/regionFetch.js live NISAR series for any point (ASF search, browse, FFT co-registration)
  src/dlWorker.js    U-TAE in the browser (Sentinel-2 COGs + ONNX Runtime)
  src/liveContext.js NASA POWER + MODIS NDVI for any region
  src/archive.js     radar archive 1978 -> today over a point
  src/pages/report.js parcel report (team analyzer)
  public/models/     utae_pastis.onnx + metadata
  src/sar.js         speckle filter, render modes, change detection
  src/agri.js        crop products, cropland vs forest
  src/ml.js          k-means, cluster interpretation
  src/pages/         site page, static pages
  public/data/       generated data (catalog, mosaics, crops, context, inundation)
ml/                  Colab notebooks (U-Mamba, SITSMamba, U-TAE, Flood Hub LSTM)
docs/GLOBAL_DATA.md  archive sizes and download routes
```

## 10. Credits and licences

* **NISAR data:** NASA/JPL-Caltech and ISRO, distributed by the ASF DAAC.
* **NASA services:**
  * MODIS imagery via NASA GIBS;
  * weather from NASA POWER;
  * natural events from NASA EONET;
  * base map: NASA Blue Marble.
* **Copernicus DEM:** © DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA.
* **Google Flood Forecasting:**
  * inundation history (CC-BY-4.0);
  * OpenHydroNet code and weights (Apache-2.0).
* **Other open data:** Caravan; USGS; GDELT; CelesTrak; Natural Earth (public domain).
* **Datasets and model code used by the notebooks:** PASTIS-R, YieldSAT, utae-paps, state-spaces/mamba, each under its own licence.
* **Code of this project:** MIT licence.
* **SI disclosure:** the code and documentation were written with help from an AI coding assistant; see §1.

---

### 🇹🇷 Kısaca

Bu proje NISAR uydusunun **gerçek** L-band radar verisiyle tarım arazisi, ürün ve verim segmentasyonu yapan bir 3B küre sitesidir. Dünyanın herhangi bir bölgesi seçilebilir. Seçilen bölgenin bütün NISAR geçişleri ASF arşivinden tarayıcıda canlı çekilir, hizalanır ve analiz edilir:

* ürün segmentasyonu ve parseller;
* göreli verim potansiyeli ve parsel içi yönetim bölgeleri;
* tarım–orman ayrımı;
* PASTIS ile eğitilmiş U-TAE derin ağının Sentinel-2 ile ürün türü tahmini;
* parsel raporu ve 1978'e uzanan radar arşivi.

Kürede şunlar var:

* 12 Ekim 2025'ten beri her döngünün dünya mozaiği;
* küresel tarım/orman katmanı;
* yakınlaşınca tam çözünürlüklü NISAR çerçeveleri;
* normal vektörlerden rölyef gölgelemesi;
* kapatılmış kutuplar;
* uydunun canlı konumu.

Form alanlarının doldurulmuş hali için §1'e bakın.
