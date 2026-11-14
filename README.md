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

### Summary (≈190 words, under 1,500 characters)

```
We built an interactive 3-D globe that turns real NISAR L-band radar data into a map of a changing Earth. A timeline drives worldwide NISAR mosaics, one per 12-day cycle from the first beta products in October 2025 to November 2026, built from about 115,000 radar frames, with the live satellite orbit and swath on top. Seventeen study sites (floods, deforestation, glaciers, volcanoes, subsidence and nine farming regions) open as pages in front of the globe. Each site shows the radar time series, interferograms, change detection with per-pixel confidence, unsupervised surface classes, forecasts with stated assumptions, and news and natural events matched to each pass. A dedicated agriculture lab maps crop calendars, harvest and paddy flooding, cropping patterns, field segments, and cropland versus forest. These are compared with NASA MODIS NDVI, NASA POWER weather and Google's 20-year flood-history maps. All pixel work runs in the browser in a Web Worker. The data pipeline needs no login and refreshes weekly through GitHub Actions. Radar sees through cloud and darkness, so these changes can be followed when optical satellites are blind. Every page explains what SAR measures directly, what it only estimates, and what it cannot see.
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
Dancing with the SARs is a website for exploring how Earth's surface changes, using real data from the NASA–ISRO NISAR radar satellite.

• Globe and timeline. Worldwide NISAR mosaics, one per 12-day cycle from October 2025 to November 2026, are draped on a 3-D globe. A single scrollable timeline switches between cycles. Zooming in loads 1 km tiles. Layers show individual radar frames, monthly acquisition density, frame footprints, natural events (NASA EONET), the night side, and NISAR itself: its live position, ground track and radar swath, computed from the current orbit.

• Site pages. Seventeen study sites open as pages in front of the globe:
  – Radar images: HH, HV, colour composite, radar vegetation index (RVI), variability, a swipe comparison, 30 m elevation and a 3-D radar-on-terrain view.
  – Ground motion: real NISAR interferograms (GUNW) and offset maps (GOFF).
  – Change & ML: log-ratio change detection with an automatic threshold and per-pixel confidence; k-means surface types with a physical reading of each group; cropland vs forest; flood history.
  – Forecast: a damped trend with 80/95 % ranges, a backtest, stated assumptions and a verdict on whether the series can be forecast at all.
  – Events & news: earthquakes, natural events and headlines matched in space and time to each radar pass.

• Agriculture lab, computed per pixel from the HH/HV time series:
  – start, peak and end of season;
  – harvest date and paddy-flooding date, with harvest-progress and flooded-area curves;
  – cropping patterns (paddy rice, double crop, single crop, perennial, water, bare);
  – field-like segments with their own calendars;
  – cropland vs forest, with a separability plot and the forest–field edge;
  – the radar crop signal next to NASA MODIS NDVI and NASA POWER rain and temperature;
  – an overview page comparing nine farming regions month by month.

• Flood context. NISAR water on each pass is compared with Google's 1999–2020 flood-frequency maps (derived from Landsat/GLAD), to separate the known flood regime from unusual water.

HOW IT WORKS
A Python pipeline needs no login. It searches the ASF DAAC and NASA CMR catalogues, downloads NISAR browse products, co-registers each site's dates by FFT phase correlation, and builds the global mosaics: about 16,000 frames per cycle, blended with feathered weights and per-frame gain matching. It also fetches elevation, weather, NDVI, events and the satellite orbit. GitHub Actions rebuilds and publishes the site every week. In the browser, all pixel work (speckle filtering, change detection, clustering, crop products) runs in a Web Worker, so the page stays responsive while filters change.

BENEFITS AND IMPACT
Radar works through cloud and at night, exactly when floods happen and when monsoon crops grow. The site makes those changes visible to non-specialists, and explains for every result whether SAR measures it directly, estimates it with other data, or cannot see it. Farmers' organisations, disaster responders and teachers can see when fields were planted, harvested or flooded, and where forest is being cleared, without installing anything.

TOOLS
JavaScript (Vite, globe.gl / three.js, Chart.js, satellite.js, Web Workers), Python (numpy, Pillow, scipy), GitHub Actions and Pages, Google Colab and PyTorch for the deep-learning notebooks (U-Mamba, SITSMamba, U-TAE; Google's Flood Hub LSTM).

WHAT MAKES IT CREATIVE
One timeline drives worldwide radar, the live satellite and local analysis together. Agricultural products are computed live in the browser from the radar series. Every page carries an explicit honesty layer: confidence scores, forecast ranges with their assumptions, and the limits of what radar can see.

WHAT WE CONSIDERED
Data volume: the full NISAR archive is petabytes, so we use browse products and document the route to calibrated data. Products are labelled beta or provisional, and we say so. Browse brightness is relative, not calibrated backscatter. Machine-learning results are unsupervised and labelled as interpretations. Models are not trained on their own test periods. Performance on phones matters, hence Web Workers, level-of-detail tiles and pausing the globe when it is hidden.
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
| NASA Blue Marble base map | https://visibleearth.nasa.gov/collection/1484/blue-marble |
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
| **Globe** | World mosaics per 12-day cycle (8k texture, 1 km tiles when zoomed in), individual radar frames on their acquisition date, monthly acquisition density, frame footprints, NASA EONET events, night side, and **NISAR itself**: SGP4-propagated position from the current TLE, the ground track, and the ~242 km left-looking radar swath. |
| **Timeline** | One thin, scrollable line under the globe. Amber segments are mosaic cycles; white ticks are the selected site's passes. Play steps two days at a time. |
| **Sites** | 17 study sites. Each opens as a sheet in front of the globe with tabs: *Overview · Radar images · Ground motion · Change & ML · Agriculture · Forecast · Events & news*. |
| **Agriculture** | Per-site crop lab (calendar, harvest & flooding, patterns, fields, cropland vs forest, weather & NDVI) and a cross-site page comparing the farming regions month by month. |
| **What radar can tell** | A capability matrix: what L-band SAR measures directly, what it estimates with other data, what it cannot see, and which band to use. |
| **Data & methods** | Sources, challenge resources, partner missions and the route to the full archive. |

The UI uses a hash router (`#/site/<id>/<tab>`), so every view has a shareable link. The globe pauses rendering while a page covers it or the tab is hidden.

## 3. Study sites

| Site | Theme | Why it is here |
|---|---|---|
| Konya Closed Basin, Türkiye | subsidence / groundwater | irrigation and land subsidence |
| Sylhet Haor Wetlands, Bangladesh | flood | monsoon flooding of the haor basins |
| Rondônia, Brazil | deforestation | the "fishbone" clearing frontier |
| Jakobshavn Isbræ, Greenland | glacier | melt and refreeze, fast ice flow |
| Tulare Basin, California | subsidence / agriculture | crops and groundwater-driven sinking |
| Okavango Delta, Botswana | wetland | the annual flood pulse |
| Punjab, India | agriculture | rice–wheat double cropping |
| Mississippi Delta, USA | wetland | coastal wetland loss |
| Kīlauea, Hawaiʻi | volcano | eruptions and deformation |
| Jasper, Canada | wildfire | burn scar recovery |
| Thwaites Glacier, Antarctica | glacier | ice shelf and sea ice |
| Nile Delta, Egypt | agriculture | irrigated multi-cropping |
| Iowa, USA | agriculture | maize and soybean |
| Mato Grosso, Brazil | agriculture | soybean–maize double crop |
| Poltava, Ukraine | agriculture | winter wheat, sunflower |
| Mekong Delta, Vietnam | agriculture | up to three rice crops a year |
| Phu Prao Temple · Sirindhorn, Thailand | agriculture | rain-fed rice, reservoir, forest ridges on the Mekong |

The exact track, frame and dates of each site are in `web/public/data/catalog.json`; they change whenever the pipeline runs.

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
python3 pipeline/build_mosaic.py --fill-gaps
```

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
  src/sarWorker.js   Web Worker: all pixel work
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

Bu proje NISAR uydusunun **gerçek** L-band radar verisini (ASF DAAC üzerinden, giriş gerektirmeden) zaman çizelgeli bir 3B küre üzerinde gösterir. Ekim 2025'ten bugüne her 12 günlük döngü için dünya mozaiği vardır. Küre üzerinde uydunun canlı konumu ve tarama şeridi de görünür. 17 çalışma alanında sel, ormansızlaşma, buzul, volkan, çökme ve tarım değişimleri incelenebilir. Tarım laboratuvarı şunları içerir:

* ekim, tepe ve hasat takvimi;
* çeltik su basma tarihi;
* ekim desenleri;
* parseller;
* tarım–orman ayrımı;
* MODIS NDVI ve NASA POWER hava verisiyle karşılaştırma.

Google'ın 1999–2020 taşkın geçmişi haritası NISAR'ın gördüğü suyla karşılaştırılır. Tüm piksel hesapları tarayıcıda, bir Web Worker içinde çalışır. Site GitHub Actions ile her hafta güncellenir. Form alanlarının doldurulmuş hali için §1'e bakın.
