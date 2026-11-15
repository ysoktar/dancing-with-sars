# ∿ Dancing with the SARs

**A planetary surface fingerprint explorer for real NISAR L-band radar data: 3-D globe, timeline and in-browser analysis lab.**
NASA Space Apps Challenge 2026 · challenge *“Dancing with the SARs”*.

* **Live site:** <https://ysoktar.github.io/dancing-with-sars/>
* **Code:** <https://github.com/ysoktar/dancing-with-sars>

Earth's surface keeps changing under human hands. Fields are ploughed, sown, irrigated and harvested; forests are cleared; rivers flood; slopes fail; mines spill. The NASA–ISRO **NISAR** satellite images all of it every 12 days, day and night, through cloud. L-band radar does not see colour: it records how rough and wet the ground is (HH) and how much plant volume stands on it (HV). The rise and fall of those two numbers through a season is a **structural fingerprint** of what is happening on the ground. This project turns NISAR's public Level-2 products into a website where anyone can read those fingerprints, anywhere on Earth, and it is honest about what radar can and cannot tell you.

---

## Contents

1. [Space Apps submission](#1-space-apps-submission)
2. [What the website does](#2-what-the-website-does)
3. [Regions](#3-regions)
4. [Data sources](#4-data-sources)
5. [Methodology](#5-methodology)
6. [Machine learning](#6-machine-learning)
7. [Validation, uncertainty and limitations](#7-validation-uncertainty-and-limitations)
8. [Run, rebuild and deploy](#8-run-rebuild-and-deploy)
9. [Repository layout](#9-repository-layout)
10. [Credits and licences](#10-credits-and-licences)

---

## 1. Space Apps submission

Each block below answers one field of the Space Apps project form. A detailed, non-technical walk through the whole system is in [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).

### Project Name

```
Dancing with the SARs: a planetary surface fingerprint explorer
```

### Summary (under 1,500 characters)

```
How does Earth's surface physically transform under human land use, in different hemispheres? Our 3-D globe reads real NISAR L-band radar as a structural fingerprint: HH tracks roughness and soil moisture, HV tracks plant volume, and their rise and fall reveals what happens on the ground. Worldwide NISAR mosaics for every 12-day cycle since October 2025 cover the globe, with distilled layers for change, water, seasonal variability, snow melt, main crop and landslide history. Draw any area: every NISAR pass is fetched live from NASA's ASF archive and analysed in the browser. Compare two places, e.g. a Brazilian soybean belt and a Turkish plain, on radar behaviour, land cover, crops, climate, soil water and terrain, with seasons lined up across hemispheres. For farmland: deep-learning crop maps with per-crop NISAR curves and NASA Harvest ground labels, crop suggestions from FAO GAEZ, soil moisture in four depths and drought against each place's 25-year record. For ice and hazards: glacier melt, landslide detection and a rain-triggered outlook, and the spread of mine spills and the farmland they reach. Light or dark, English or Turkish, every term explained on hover, every result with its confidence and what SAR can and cannot measure.
```

### Project Demonstration (slides ≤ 7 or video ≤ 30 s)

Suggested 7-slide deck. Each line is one slide, using screenshots from the live site:

1. **Title.** "Dancing with the SARs: a planetary surface fingerprint explorer", the globe in HH · HV · HH/HV (forest green, fields blue).
2. **The idea.** L-band radar = roughness, moisture and plant volume. Their rhythm over a season is a fingerprint of land use, visible through cloud and darkness.
3. **Globe and timeline.** World mosaics per cycle, multi-date composite (colour = change), 48 years of radar missions on one timeline, live satellite and swath.
4. **Brazil ↔ Turkey.** Two areas compared by their radar fingerprint: similarity, the map of where they look alike, and season curves lined up across hemispheres.
5. **Farmland, water, ice.** Crop map with per-crop NISAR curves and NASA Harvest ground labels, crop suggestions (GAEZ), soil moisture, drought percentiles, glacier melt.
6. **Hazards.** Landslide scars and the rain-triggered outlook; mine-spill extent and the farmland it reached, without pretending to measure contamination.
7. **Honest and open.** What SAR can and cannot tell; confidence on every map; open code, no-login pipeline, everything computed in the browser.

The deck (PDF) or a 30-second screen recording goes on a public host; the form takes its link.

### Project (public link)

```
https://ysoktar.github.io/dancing-with-sars/
```

### Project Details

Headings are plain capitals so they survive the form's rich-text editor.

```
WHAT IT DOES
Dancing with the SARs is a planetary surface fingerprint explorer built on the NASA–ISRO NISAR L-band radar, for any place on Earth.

• The globe. Worldwide NISAR mosaics for every 12-day cycle since the first products (12 Oct 2025), shown as R = HH, G = HV, B = HH/HV (the L-band convention of the JAXA PALSAR mosaics: forest green, fields and bare soil blue, water black) or as a multi-date composite (three cycles in R, G, B: grey = stable, colour = change). Full-resolution NISAR frames stream from ASF when you zoom in. A modular legend explains every active layer. The timeline runs from Seasat (1978) to today.

• Any region, live. Draw a rectangle anywhere (3–200 km). The browser searches NASA's ASF archive, downloads every NISAR pass, mosaics frames, aligns the dates by phase correlation and filters speckle. Nothing is precomputed or installed.

• Compare two areas. Not pixel by pixel but place by place: radar behaviour, land cover, crop mix, climate, soil water regime and terrain are each scored and shown on a radar chart. Area B (coordinates, a recent area, or one of ten Brazilian reference landscapes: soybean, sugarcane, irrigated rice, coffee, centre pivots, pasture, rainforest, eucalyptus, Pantanal, cerrado) is fetched live like A. Both get the same fingerprint per ~300 m block (mean HH and HV, their pass-to-pass variability, HV range, RVI). The site reports the overlap of the two fingerprints, maps which parts of A behave like B, and lines up the season curves, optionally shifted by six months for the other hemisphere.

• Farmland. Crop types from a deep network in the browser (U-TAE on Sentinel-2, with the team's U-Mamba / SITSMamba when their weights are loaded), cleaned with ESA WorldCover and the SPAM crop mix, with a crop calendar and the NISAR L-band curve of each crop; crop suggestions (FAO GAEZ v4 suitability of 50 crops, rain-fed and irrigated, against the crops grown now and the current root-zone moisture); soil moisture in four depths (ERA5-Land), NASA POWER soil wetness and a NISAR bare-soil wetness index.

• Drought and ice. Drought: rain over 30 / 90 / 180 days and root-zone soil moisture as percentiles of the same weeks in every year on record (SPI), heat, US Drought Monitor classes D0–D4. Glaciers and snow: wet-snow mapping (melting snow swallows L-band), melt season and the wet-snow line from elevation.

• Globe layers. Change since the previous cycle and water / wet surfaces computed on the GPU; seasonal variability (fields vs steady land), snow and ice melt, main crop (SPAM) and NASA landslide history precomputed.

• Easy to read. Light / dark mode, English / Turkish, plain wording, technical terms underlined with a definition on hover, a legend for every layer.

• Hazards. Landslides: scars detected as a lasting HV drop on steep slopes, a rain-triggered hazard nowcast and 7-day outlook (terrain susceptibility × rainfall against the local 25-year record), and the NASA Global Landslide Catalog nearby. Mine spill / mudflow: the physical spread between two passes and the farmland it reached. Change detection, flood history, archive back to 1978 and a parcel report complete the lab.

HOW IT WORKS
Region analysis happens entirely in the browser: the ASF search API, NISAR browse images, NASA POWER, NASA GIBS, Sentinel-2 Cloud-Optimized GeoTIFFs, ESA WorldCover, ERA5-Land (Open-Meteo) and elevation tiles are all public and CORS-enabled, so Web Workers download, co-register, filter and analyse the radar series and run the deep network with ONNX Runtime (WebAssembly). A Python pipeline without login builds the world mosaics (about 16,000 frames per 12-day cycle, raw browse values, feathered blending, temporal gap filling, polar caps), the Brazilian reference library, the GAEZ suitability tiles, the crop-mix prior and the landslide catalog; GitHub Actions publishes the site.

BENEFITS AND IMPACT
Radar works through cloud and at night. Scientists get a way to read unlabelled surface change against known land uses; farmers and agencies can see which crops a district grows, which it could grow, how wet its soil is, and which slopes are primed by rain; responders can map a spill's spread and the fields it reached. Every result states its confidence and whether SAR measures it directly, estimates it with other data, or cannot see it.

TOOLS
JavaScript (Vite, globe.gl / three.js, Chart.js, satellite.js, geotiff.js, ONNX Runtime Web, Web Workers), Python (numpy, Pillow, scipy, PyTorch for the ONNX export), GitHub Actions and Pages, Google Colab and PyTorch for the deep-learning notebooks (U-Mamba, SITSMamba, U-TAE; Google's Flood Hub LSTM).

WHAT MAKES IT CREATIVE
Radar as a fingerprint, not a picture: two places on different continents compared by how their surfaces behave. Any region on Earth, analysed live from the public archive in the browser. One timeline spans 48 years of spaceborne radar. Every page carries an explicit honesty layer: confidence, look-alikes, and the limits of what radar can see.

WHAT WE CONSIDERED
Data volume: the full NISAR archive is petabytes, so we use browse products (8-bit, ~165 m) and document the route to calibrated data. Values are never altered for looks: the mosaics are raw browse values, display stretches are fixed and the same everywhere. We tried automatic matching to a library of Brazilian landscapes: in a leave-one-area-out test it found the right structural class for only 48 % of cells (25 % by chance), and public NISAR data over Brazil only starts in June 2026 (Brazil's dry season, when its crops are bare), so we show a transparent two-area comparison instead; a full-year library becomes possible in 2027. Radar does not measure crop species, yield or soil chemistry directly: crop types come from a trained optical network, suitability from FAO GAEZ, and the spill tool maps physical spread, not contamination. The deep model was trained in France and says so elsewhere.
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
| NISAR L2 GCOV, GUNW, GOFF products via ASF Data Search Vertex | https://search.asf.alaska.edu/ |
| NISAR Data User Guide (ASF) | https://nisar-docs.asf.alaska.edu/ |
| ASF DAAC Search API | https://docs.asf.alaska.edu/api/basics/ |
| NASA Earthdata Search | https://search.earthdata.nasa.gov/search |
| NASA Common Metadata Repository (CMR) | https://cmr.earthdata.nasa.gov/search |
| NASA POWER: daily rain, temperature, soil wetness (GWETTOP / GWETROOT / GWETPROF) | https://power.larc.nasa.gov/ |
| NISAR L2 GCOV HDF5 (calibrated γ⁰) via ASF, Earthdata Login | https://nisar-docs.asf.alaska.edu/ |
| NASA Global Landslide Catalog | https://data.nasa.gov/ |
| NASA Harvest CropHarvest field labels (Zenodo) | https://doi.org/10.5281/zenodo.7257688 |
| NASA LHASA landslide model (method followed by the hazard outlook) | https://landslides.nasa.gov/ |
| NASA GIBS (MODIS Terra NDVI 16-day, true colour) | https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api |
| NASA EONET natural events | https://eonet.gsfc.nasa.gov/ |
| NASA Blue Marble base map (GIBS shaded relief + bathymetry tiles) | https://visibleearth.nasa.gov/collection/1484/blue-marble |
| Seasat SAR (1978, NASA/JPL) via ASF | https://asf.alaska.edu/data-sets/sar-data-sets/seasat/ |
| UAVSAR airborne L-band (NASA/JPL) and UAVSAR Postcards | https://uavsar.jpl.nasa.gov/education/postcards.html |
| NASA IMERG precipitation (behind NASA POWER rain; flood model input) | https://gpm.nasa.gov/data/imerg |
| Intro to Remote Sensing (NASA Earthdata) | https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/remote-sensing |
| Intro to SAR (NASA Earthdata) | https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar |
| NASA ARSET trainings | https://appliedsciences.nasa.gov/get-involved/training |
| NISAR StoryMaps | https://nisar.jpl.nasa.gov/applications/arcgis-storymaps/ |
| NISAR Applications White Papers | https://nisar.jpl.nasa.gov/applications/societal-benefit/ |
| NASA Earthdata Login (optional calibrated HDF5 route) | https://urs.earthdata.nasa.gov/ |

### Space Agency Partner & Other Data (Link Text → Link URL)

| Link Text | Link URL |
|---|---|
| ISRO: NISAR partner agency | https://www.isro.gov.in/ |
| CSA RADARSAT Constellation Mission (data) | https://donnees-data.asc-csa.gc.ca/en/dataset/rcm |
| CSA RADARSAT-1 (data) | https://donnees-data.asc-csa.gc.ca/en/dataset/radarsat1 |
| CSA Synthetic Aperture Radar Python tutorial | https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial |
| CONAE SAOCOM catalogue (L-band, a future second library source) | https://catalogos.conae.gov.ar/catalogo/catalogoSatSaocomInfo.html |
| ESA WorldCover 10 m 2021 (via Microsoft Planetary Computer) | https://esa-worldcover.org/ |
| Copernicus DEM GLO-30 (ESA / Airbus), AWS Open Data | https://registry.opendata.aws/copernicus-dem/ |
| Sentinel-2 L2A Cloud-Optimized GeoTIFFs (ESA Copernicus) via Element 84 Earth Search | https://earth-search.aws.element84.com/v1 |
| ERA5-Land soil moisture (ECMWF / Copernicus C3S) via Open-Meteo | https://open-meteo.com/en/docs/historical-weather-api |
| Open-Meteo precipitation forecast | https://open-meteo.com/ |
| FAO / IIASA GAEZ v4 crop suitability | https://gaez.fao.org/ |
| SPAM 2010 crop production (IFPRI, MapSPAM) | https://doi.org/10.7910/DVN/PRFF8V |
| Sentinel-1, ERS-1/2 (ESA), JERS-1, ALOS PALSAR (JAXA), RADARSAT-1 (CSA) archives via ASF | https://search.asf.alaska.edu/ |
| ESA WorldCover Sentinel-1 yearly median backscatter composites 2020 / 2021 (CC BY 4.0, contains modified Copernicus Sentinel data) | https://esa-worldcover.org |
| Google Flood Forecasting (Flood Hub) | https://sites.research.google/gr/floodforecasting/ |
| Google inundation history 1999–2020 (CC-BY-4.0) | https://console.cloud.google.com/storage/browser/flood-forecasting/inundation_history |
| Google OpenHydroNet code and pretrained weights (Apache-2.0) | https://github.com/google-research/flood-forecasting |
| Caravan hydrology dataset (Zenodo) | https://doi.org/10.5281/zenodo.6522634 |
| USGS earthquake catalogue API | https://earthquake.usgs.gov/fdsnws/event/1/ |
| GDELT news API | https://www.gdeltproject.org/ |
| CelesTrak orbital elements (NISAR, NORAD 65053) | https://celestrak.org/ |
| Sentinel-2 cloudless 2024 base map by EOX (CC BY-NC-SA 4.0) | https://s2maps.eu/ |
| Terrarium elevation tiles (Mapzen / Tilezen, AWS Open Data) | https://registry.opendata.aws/terrain-tiles/ |
| OpenStreetMap Nominatim (place search) | https://nominatim.org/ |
| U-TAE pretrained PASTIS weights (Zenodo 5172293) | https://zenodo.org/records/5172293 |
| PASTIS normalisation statistics (Zenodo 5012942) | https://zenodo.org/records/5012942 |
| PASTIS-R crop benchmark | https://github.com/VSainteuf/pastis-benchmark |
| U-TAE code (utae-paps) | https://github.com/VSainteuf/utae-paps |
| Mamba selective-scan kernels (state-spaces/mamba) | https://github.com/state-spaces/mamba |
| U-Mamba paper | https://arxiv.org/abs/2604.00940 |
| SITSMamba paper | https://arxiv.org/abs/2409.09673 |
| ONNX Runtime Web | https://onnxruntime.ai/ |
| geotiff.js | https://geotiffjs.github.io/ |
| Natural Earth land polygons | https://www.naturalearthdata.com/ |
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
| **Globe** | World NISAR mosaics per 12-day cycle (8k texture; 1 km tiles; full-resolution NISAR frames streamed live from ASF when zoomed in). Display: **R = HH, G = HV, B = HH/HV** with fixed per-channel ranges (as the JAXA PALSAR mosaics), or the **multi-date composite** (HH of three cycles in R, G, B). Raw browse values everywhere, never gain- or colour-matched. Polar caps beyond NISAR's reach closed by a smooth fill, flagged in the data. Base map: NASA GIBS Blue Marble relief + bathymetry, Sentinel-2 cloudless when zoomed in, relief shading from a global normal map. Layers, grouped: *radar* (multi-date composite, mosaic, native frames); *what the radar shows* (change since the previous cycle, water & wet surfaces, seasonal variability, snow & ice melt); *context* (main crop, landslide history, acquisitions, EONET events, night lights, NISAR's position, track and swath). A **legend** (bottom right) shows a colour ramp for every active layer. |
| **Timeline** | One line from Seasat (1978) to today. The archive years take the first quarter (L-band missions light blue, C-band grey), NISAR's era the rest (amber = world mosaic cycles, white = the open region's passes). |
| **Select region** | Drag a rectangle on the globe (3–200 km), or search a place first. Recent areas are remembered; every view has a shareable link (`#/region/<w>/<s>/<e>/<n>/<tab>`). |
| **Region page** | *Summary · Crops · Parcel report · Archive 1978→ · Radar images · Change & ML · Forecast*. |
| **Crops** | Crop types & calendar (U-TAE, or the team's U-Mamba / SITSMamba) with per-crop NISAR curves · **What could grow here** (GAEZ suitability vs crops grown) · **Soil moisture** (ERA5-Land 4 layers, NASA POWER, NISAR wetness) · **Drought** (SPI, soil-moisture percentile, D0–D4) · Weather & NDVI. The Summary tab lists the crops grown (SPAM) and NASA Harvest field labels nearby. |
| **Change & ML** | **Compare two areas** (six aspects, where they look alike, season curves) · **Glaciers & snow** (melt map, melt season, wet-snow line) · Change between two dates · **Landslides** (detection + hazard outlook) · **Mine spill / mudflow** (spread + farmland reached). |
| **Parcel report** | The team's parcel analyzer on the web: geometry and elevation, RVI signatures (reference crops vs the region's real NISAR curve), monthly calendar matrix, a year of NASA POWER weather, references. |
| **Archive 1978→** | Every radar acquisition ASF holds over the area, per mission and year, browse samples, and ALOS PALSAR (L-band, 2006–11) next to NISAR. |
| **What radar can tell** | What L-band SAR measures directly, what it estimates with other data, what it cannot see. |
| **Data & methods** | Sources, challenge resources, partner missions, the route to the full archive. |

Light / dark theme and English / Turkish are switched in the top bar (remembered in the browser). Technical terms (HH, HV, RVI, L-band, SPI, GAEZ, …) have a dashed underline and a plain definition on hover or tap. Heavy work runs in Web Workers; the globe pauses while a page covers it.

## 3. Regions

There are no predefined places: any area covered by NISAR can be analysed. The two-area comparison offers 30 fixed Brazilian reference areas (§5.10). The pipeline still contains 17 benchmark regions (`pipeline/sites.json`: Punjab, Nile Delta, Iowa, Mato Grosso, Poltava, Mekong, Phu Prao/Sirindhorn, Konya, Tulare, Sylhet, Rondônia, …) used to develop and test the methods; their precomputed data (crops, DEM, weather, flood history) remain in `web/public/data/` and are used by the README figures and the cross-checks below.

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
| PASTIS-R | academic dataset | notebooks 01–04 | public download |
| ESA WorldCover 10 m 2021 | ESA, Microsoft Planetary Computer | crop-map clean-up, structural shifts, spill land cover | public COG (SAS token) |
| SPAM 2010 v2r0 crop areas | IFPRI (CC BY 4.0) | crops grown here, crop-map prior | public download |
| GAEZ v4 crop suitability | FAO & IIASA (CC BY-NC-SA 3.0 IGO) | crop suggestions | public image service |
| ERA5-Land soil moisture, 4 layers | ECMWF / Copernicus C3S via Open-Meteo | soil moisture, crop suggestions | public API |
| NASA POWER soil wetness | NASA | soil moisture | public API |
| Global Landslide Catalog | NASA Goddard (public domain) | landslide history | public download |
| Daily precipitation forecast | Open-Meteo (ECMWF / GFS / ICON) | 7-day landslide outlook | public API |
| Sentinel-2 L2A COGs | ESA Copernicus, Element 84 Earth Search | crop types (U-TAE) | public STAC / COG |
| CropHarvest field labels (95k points) | NASA Harvest (CC BY-SA 4.0) | ground labels near each area | Zenodo download |
| NASA POWER climatology (T2M, rain, root-zone wetness) | NASA | two-area comparison | public API |
| Terrarium elevation z5 | Mapzen / AWS Open Data | melt layer mask, relief | public tiles |

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
3. **Raw values.** Frames are blended with their browse values unchanged: no gain, offset or colour matching (`--match` exists but is off). The swath rim gets a near-zero weight and seams of ≤ 6 px are filled from the nearest good pixel.
4. **Mask.** Land and ice shelves (Natural Earth 1:50m), plus everything poleward of 55°, where sea ice is real NISAR signal. Open ocean nearer the equator is masked.
5. **Gap filling.** Pixels without data in a period are filled from the period nearest in time (`--fill-gaps`). The filled share is recorded per period.
6. **Display.** On the globe: R = HH, G = HV, B = HH/HV (the difference of the dB-like browse values) with fixed per-channel ranges, HH 140–255 (γ 1.5), HV 60–230, HH−HV −20…+60, the same everywhere; or the multi-date composite (HH of three cycles, stretch 90–240, γ 1.4, date differences × 2). The data are not changed.
7. **Outputs.** 8k and 4k equirectangular WebP per period. The globe shows 4k while moving and 8k at rest. For the latest full cycle, 10° × 10° tiles at 0.01° (~1 km) are loaded when zoomed in.

### 5.4 Change detection
* Lee speckle filter (5 × 5).
* Log-ratio of two dates. Otsu's method picks the threshold.
* Per-pixel confidence = distance beyond the threshold relative to the spread of unchanged pixels.
* Areas are given in km².

### 5.5 Radar vegetation index
* **RVI** = 4·HV / (HH + HV), from browse brightness, so it is *relative*. Crop *types* come from the trained networks (§5.11). The earlier rule-based crop patterns, the relative yield index and the cropland-vs-forest classifier were removed: none could be validated well enough.

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

### 5.9b Calibrated NISAR: GCOV γ⁰ instead of browse images
* **Why.** Comparing the browse PNGs with the calibrated GCOV HDF5 of the same granules (`pipeline/browse_vs_gcov.py`) shows that every browse image is stretched on its own and non-linearly: −12 dB HH became 120, 99 and 122 in three granules. Browse brightness is therefore not comparable between images or tracks (this also explains the seams of browse mosaics).
* **Reading.** GCOV products (γ⁰, 20 m UTM, 512 × 512 gzip chunks, ~2 GB each) are read over HTTPS **range requests**: only the chunks over an area are fetched (~25–35 MB per pass for a 9 km area). An Earthdata Login token is needed.
* **Fixed scale.** HH and HV are averaged in linear power onto the area's 256 × 256 grid, converted to dB and mapped to one byte scale for every pass and product: HH −25…0 dB, HV −32…−7 dB. All tools then work on comparable values.
* **Two ways onto the site.**
  1. *Ready areas* (`pipeline/build_calibrated_regions.py`, `pipeline/cal_regions.json`): precomputed stacks of the latest 12 passes, ~1.5 MB per area, refreshed weekly by `.github/workflows/calibrated.yml` with the repository secret `EARTHDATA_TOKEN`. They open in about 3 seconds from the *Ready areas* list.
  2. *Any area, live* (`worker/`): a free Cloudflare Worker keeps the token and forwards byte ranges; the browser decodes the HDF5 itself with h5wasm (`web/src/calWorker.js`). *Use calibrated data* on a region's Summary rebuilds its stack (about 2 minutes for 11 passes of a 9 km area).
* **Two-area comparison** with one calibrated and one browse area compares only the change features (variability, range), not brightness levels.

### 5.10 Comparing two areas (op `compare` in `sarWorker.js`), and why not an automatic library
* **Features.** For both areas the filtered NISAR series is averaged into ~300 m blocks and each block gets: mean HH, mean HV, temporal standard deviation of HH and of HV, HV range (p90 − p10 over the passes) and mean RVI.
* **Similarity.** For each feature, the overlap of the two areas' value distributions (histogram intersection, 0–100 %); the overall similarity is their mean. The map colours each block of A by its distance to B's median block, in units of the robust spread of the two areas together (< 0.7 like B, < 1.4 somewhat, otherwise unlike).
* **Seasons.** The mean HH, HV and RVI curves of both areas are drawn on a day-of-year axis; B can be shifted by six months for the other hemisphere, and the RVI curves' correlation on the shared days is reported.
* **Landscape aspects.** Beyond radar, five more views of the two places as a whole, each 0–100 %: land cover (shared share of ESA WorldCover classes), crop mix (shared share of SPAM crops), climate (monthly temperature and log-rain of NASA POWER long-term means; B shifted 6 months if asked; exp(−RMS ΔT / 4 °C) · exp(−RMS Δlog P / 0.6)), soil water regime (monthly root-zone wetness, exp(−RMS / 0.12)) and terrain (slope p90 and share ≥ 15°). They are shown on a radar chart; the overall value is their plain mean.
* **Brazilian reference areas.** Ten land uses (soybean, sugarcane, irrigated rice, coffee, centre pivots, pasture, intact forest, eucalyptus, Pantanal, cerrado), three well-known areas each, are offered as one-click areas B.
* **Why not automatic matching.** `pipeline/build_archetypes.py` builds a library from those areas (WorldCover-filtered cells, 7 features) and tests it leave-one-area-out: the right one of 10 land uses for 19 % of cells (chance 10 %), the right one of 4 structural classes for 48 % (chance 25 %; annual cropland and closed canopy 68 %, grass / wetland 21 %). On the Harran Plain (irrigated summer cotton, Turkey) it answered "forest / sugarcane", because public NISAR data over Brazil start in June 2026: in Brazil's dry season its annual crops are bare, while Turkey's are in full canopy. The library stays in the repository for a full-year rebuild in 2027.

### 5.11 Deep learning in the browser (`web/src/dlWorker.js`, `ml/export_utae_onnx.py`, `ml/export_mamba_onnx.py`)
* **Models and results** (PASTIS official folds, test fold 1, validation fold 2, train 3–5; best checkpoint on validation, test once):

  | Model | mIoU | OA | extent IoU | boundary F1 | parameters |
  |---|---|---|---|---|---|
  | **SITSMamba** (team, default on the site) | **0.660** | **0.846** | **0.813** | **0.570** | 0.29 M |
  | U-TAE (published Fold_2 weights fine-tuned; Fold_2 never saw test fold 1) | 0.651 | 0.843 | 0.809 | 0.539 | 2.18 M |
  | U-Mamba (team) | 0.639 | 0.840 | 0.809 | 0.557 | 9.65 M |

  An earlier U-TAE run (0.664) loaded `Fold_1` weights, which were trained on fold 1: that was test leakage and the run was repeated (`_w` runs). All three models share the normalisation of the PASTIS `NORM_S2_patch.json` averaged over its five folds, a negligible bias that is the same for all.
* **Model.** U-TAE (Garnot & Landrieu, ICCV 2021): a U-Net whose skip connections are aggregated over time by a lightweight temporal attention encoder (L-TAE). Published PASTIS weights, fold 2 (test mIoU 65.0 %, OA 84.1 %). The team's U-Mamba and SITSMamba (notebooks 01, 02) are exported with `ml/export_mamba_onnx.py` and appear in the model list when their weights are added.
* **Export.** A compact re-implementation with identical parameter names loads all 158 tensors strictly, is exported to ONNX (opset 17, dynamic number of dates, 4.5 MB) and checked against PyTorch (max |Δ| 4e-5).
* **Input.** Sentinel-2 L2A scenes (< 30 % cloud) for one season through the Earth Search STAC API; ten bands read straight from the Cloud-Optimized GeoTIFFs with HTTP range requests, normalised with the PASTIS statistics.
* **Post-processing.** (1) SPAM 2010 crop-mix prior around the window: classes of crops grown here weigh 1, marginal 0.3, not grown 0.02; (2) ESA WorldCover 10 m: bare, built, snow, water and moss pixels become background, and tree / shrub / grass pixels need an NDVI swing > 0.3 to stay a crop; NDVI max < 0.3 → background; (3) 3 × 3 mode filter, minimum mapping unit of 30 pixels, one crop per field by soft vote; (4) a "cropland, crop not recognised" class instead of forcing a French class.
* **Crop calendar.** For each predicted crop, its mean Sentinel-2 NDVI curve gives green-up, peak, senescence and harvest dates.
* **NISAR per crop.** The crop map is laid over the region's NISAR grid; radar pixels that are ≥ 60 % one crop give that crop's L-band RVI through the season, its radar peak, harvest (sharpest RVI drop) and paddy flooding dates. Radar does not need clear skies, so these dates fill the cloudy months.
* **Domain shift.** Outside Western Europe the classes are the nearest French equivalent (and crop groups are offered); the page says so.

### 5.12 Crop suggestions (`pipeline/build_suitability.py`, `web/src/suitability.js`)
* **Suitability.** FAO / IIASA GAEZ v4, theme 4: suitability index (0–10,000) on current cropland, 1981–2010 climate (CRU TS 3.2), high input level, 5′ grid, for 50 crops; rain-fed and irrigated (the best of gravity, sprinkler, drip and generic irrigation). The 172 layers are exported once from the GAEZ image service, averaged to 0.25° and packed as 533 PNG tiles (6 MB, value = index / 100).
* **Grown now.** SPAM 2010 share of each crop in the area's crop land (crops sharing a SPAM class, e.g. carrot / cabbage / onion / tomato → vegetables, are one row).
* **Output.** *Options*: rated medium or better (≥ 40) but not grown here; *grown here* with their rating; "needs irrigation" when irrigated beats rain-fed by ≥ 20 points; the current topsoil and root-zone moisture against normal (ERA5-Land) and a warning for rain-fed options when the root zone is > 15 % drier than normal. Energy grasses are left out.

### 5.13 Soil moisture (`web/src/soil.js`, op `wetness`)
* **ERA5-Land** (ECMWF / Copernicus, ~9 km) daily volumetric soil water in 0–7, 7–28, 28–100 and 100–255 cm, 2019–now, via the Open-Meteo archive API; normal = mean of the same days of the year (± 7 days); anomaly over the last 3 weeks.
* **NASA POWER** monthly soil wetness: surface (GWETTOP), root zone (GWETROOT), profile (GWETPROF).
* **NISAR relative surface wetness.** Change detection (Wagner et al. 1999) on HH: per pixel, 0 = its driest pass, 1 = its wettest, using only the passes on which the pixel is bare (HV below the 30th percentile of all pixels and passes), where L-band HH mostly follows the top few centimetres of soil. Its correlation with ERA5-Land 0–7 cm on the pass dates is reported.

### 5.14 Landslides (`web/src/landslide.js`, op `landslide`, `pipeline/build_landslides.py`)
* **Detection.** Between the passes before and from the chosen date, pixels on slopes ≥ 15° (Terrarium elevation, resampled to the radar grid) whose HV dropped more than 2.5 × the robust spread of the same change on flat ground (slope < 5°, where no landslide can happen) and stayed low on later passes; a simultaneous HH change marks new bare surface or debris. Water and radar shadow are excluded; connected patches ≥ 3 pixels are listed with area, slope and location.
* **Hazard (LHASA-style).** Terrain susceptibility from the slope distribution (p90 slope classes, raised one class when ≥ 3 catalogued landslides lie nearby) × a 7-day antecedent rainfall index (weights 1/(k+1)²) compared with its own 90th / 95th / 99th percentiles over 2001–now (NASA POWER daily rain). Rain above those percentiles gives moderate / high / very high on high-susceptibility terrain, one level lower on moderate terrain. The Open-Meteo forecast extends the index seven days ahead.
* **History.** NASA Global Landslide Catalog (11,033 events, 1988–2017) within the area.

### 5.15 Mine spill / mudflow (op `spill`)
* Mud burying the ground changes both channels: HV drops (vegetation buried or stripped) and HH changes (new smooth wet surface, or dark ponded water). A pixel counts when (1) the change between the mean of up to three passes before and the pass after exceeds k σ, σ being the larger of the window's robust spread and the pixel's own pass-to-pass variability before the event; (2) HV and HH change together, or HH turns water-dark; (3) the change persists on the next pass. Patches ≥ 6 pixels with mean change ≥ k + 0.5 σ. Each pixel is counted against its ESA WorldCover class (hectares of cropland reached). The page reports what each filter removed and states that contamination needs samples and laboratory analysis.
* **Test.** A mining district in Minas Gerais with no event: 0 km² flagged (before the per-pixel and persistence tests: 3.94 km², mostly forest). A clearing front in Pará: one persistent 0.49 km² patch.

### 5.16 Drought (`web/src/drought.js`)
* **Rain.** NASA POWER daily precipitation 2001–now; totals over the last 30, 90 and 180 days, each as a percentile of the same window (± 5 days) in every other year; SPI = the percentile as a standard normal value.
* **Soil.** ERA5-Land root zone (28–100 cm), 30-day mean, percentile against the same window of 2019–now.
* **Heat.** Mean temperature of the last 30 days against the same days of other years.
* **Level.** Mean of the 90-day rain and root-zone percentiles, classed as the US Drought Monitor: D0 ≤ 30th, D1 ≤ 20th, D2 ≤ 10th, D3 ≤ 5th, D4 ≤ 2nd. The NISAR bare-soil wetness of the latest pass is shown beside it.

### 5.17 Glaciers and snow (op `glacier`)
* Ice = ESA WorldCover snow / ice (above 3,000 m if WorldCover is unavailable). Wet snow and melting ice absorb L-band (Nagler & Rott 2000): a pixel is wet on a pass when HH is more than 2 robust σ below its own dry reference (80th percentile over the passes), σ from the glacier's pass-to-pass spread.
* Per pass: wet share of the ice; melt season = passes with ≥ 30 % wet; wet-snow line = the highest 100 m band (Terrarium elevation) in which at least half the ice is wet. Test (Aletsch, Swiss Alps): melt 24 Jun → 23 Aug 2026, peak 53 % wet, wet-snow line up to ~4,100 m.

### 5.18 Globe metric layers (`pipeline/build_metrics.py`, `globe.js`)
19 candidates were weighed (each radar channel alone, ratio, change, water, variability, melt, crop map, best crop, susceptibility, drought, soil moisture, flood frequency, landslide points, …); six were added where they say something the existing layers do not and can be computed honestly worldwide:
* **Change since the previous cycle** (GPU): mean of the HH and HV change between the timeline's full cycle and the one before; |Δ| < 20 browse units hidden.
* **Water & wet surfaces** (GPU): HH < 70 and HH + HV < 140 on the timeline's cycle.
* **Seasonal variability**: robust spread (MAD × 1.4826) of HV − HH over the 12 full cycles; the ratio cancels most differences between tracks, the MAD ignores single odd passes. Land only, |lat| ≤ 78°.
* **Snow & ice melt**: in cold land (|lat| ≥ 60°, or above 2,000 m, or above 1,200 m beyond 45°), the deepest HH drop below the pixel's 80th percentile over all periods (≥ 20 browse units shown).
* **Main crop**: the dominant SPAM 2010 crop per 0.25° cell, opacity by cropland share.
* **Landslide history**: the NASA Global Landslide Catalog as dots sized by fatalities.
Rejected: single channels (already in the mosaic display), a "best crop" map (misleading without the crop in question), global susceptibility (meaningless at 5 km), global drought / soil moisture (no global grid readable live), flood frequency (precomputed sites only).

### 5.19 Interface (`web/src/ux.js`)
* Theme: CSS variables for light and dark, default from the system, remembered.
* Language: English / Turkish. Short interface strings are translated in place by exact match (a MutationObserver keeps new content translated); explanations with live values are written in both languages (`T(en, tr)`) and the open view is redrawn on a switch, without reloading data.
* Glossary: 25 terms are underlined (first occurrence per paragraph) and explained in a tooltip, in the current language.

### 5.20 Parcel report (`web/src/pages/report.js`)
A port of the team's desktop analyzer (`Nasa.py`):
* **Elevation.** Terrarium tiles over the whole window (thousands of samples, 1st–99th percentile) instead of 9 points.
* **Weather.** NASA POWER daily T2M_MIN, T2M_MAX and PRECTOTCORR for the last 12 months; frost days and annual rain.
* **Reference curves.** Winter grain, summer crop, double crop, rice, orchard and forest RVI curves adapted to the local climate (warmest period, frost, altitude).
* **Real data.** The region's NISAR RVI (whole window), rescaled to the reference range, is plotted on top and used for row 1 of the calendar matrix.

### 5.21 Archive 1978→ (`web/src/archive.js`)
* ASF search over the point for Seasat, ERS-1/2, JERS-1, RADARSAT-1, ALOS PALSAR, UAVSAR, Sentinel-1 and NISAR.
* Sentinel-1 and NISAR are counted per year with `output=count`; the others are listed per acquisition date.
* The ALOS PALSAR radiometrically terrain-corrected browse closest to July is shown next to NISAR's latest HH.
* Archive browse images are displayed, not analysed: the browse server sends no CORS header.

### 5.22 Globe rendering
* **Relief.** A tangent-space normal map is computed from global elevation (`build_normalmap.py`: Terrarium z5 → 8192 × 4096 equirectangular, true ground spacing, 12× vertical exaggeration). It lights the base globe only; the radar layers are drawn unlit, so their values are not shaded.
* **Native frames.** When zoomed in, the 12 NISAR frames of the current cycle nearest the view centre are fetched from ASF, their dim swath rim is dropped and they are feathered over the mosaic, without any colour matching.
* **Sentinel-1 C-band 2020 · 2021.** A layer from the ESA WorldCover Sentinel-1 composites (`pipeline/build_s1_mosaic.py`: ~17,400 1° tiles per year, averaged to 4320 × 2160; R = VV −22…0 dB, G = VH −28…−8 dB, B = VV − VH 2…14 dB). The year follows the timeline (2020 up to the end of 2020, 2021 after). Drawn under the NISAR layers, so it fills what NISAR has not imaged and is the radar view before NISAR's launch. C-band (5.6 cm) mainly sees leaves and the top of the canopy, L-band goes deeper.
* **Legend.** One section per active layer, with colour ramps (not classes) for the radar layers and the fixed display ranges written out.
* **Polar caps.** Poleward of 60° the globe draws separate caps in a pole-centred azimuthal-equidistant projection (`pipeline/build_polar.py`), so meridians do not converge into streaks. Beyond NISAR's reach (~77.7° N; ~86° S, where the source mosaic is also distorted) the cap is a plain disc: a ~1.5° soft transition from the observed rim, then the rim's mean value. Recorded as `polarCaps` in each period's JSON.

### 5.23 Earthquakes and building damage
* **Nearby earthquakes**: USGS catalogue, M ≥ 4.5 within 300 km since the first pass, with a button per event that picks the first pass after it.
* **Damage proxy**: intact buildings give a strong HH double bounce (wall + ground); a collapse removes it, so HH drops. Over built-up land (ESA WorldCover class 50) the mean of up to two passes before is compared with the mean of the first two after; the change is divided by the noise of the same buildings between two passes before the event, and drops beyond 2.5σ that at least two neighbours share are flagged. Brightening (rubble, new structures) is counted apart. A screening map: construction, wet roofs and viewing geometry can look alike; ground deformation needs NISAR interferograms (GUNW), not computed here.

### 5.24 Radar indices
Per pass, from calibrated γ⁰ only (browse brightness is stretched per image): RVI = 4·HV/(HH+HV), RFDI = (HH−HV)/(HH+HV), HV−HH in dB and span, computed per pixel in linear power, median over land pixels. Indices that need VV or quad-pol, interferometric coherence, and biomass / LAI formulas with site-specific coefficients are left out on purpose.

## 6. Machine learning

**In the browser (Web Worker, no server).**
* Change detection, the structural fingerprint, landslide and spill detection above.

**Notebooks (`ml/`, Google Colab, Drive-cached, resumable).**

| Notebook | What it does |
|---|---|
| `01_UMamba_PASTIS-R_to_YieldSAT` | U-Mamba (CNN encoder–decoder with Mamba blocks) trained on PASTIS-R (Sentinel-1 + 2 crop parcels). A second stage on YieldSAT (yield) is in the notebook but skipped: access to the YieldSAT data was not available. The 'Export for the website' cell writes the trained model as ONNX for the Crop types tool. |
| `02_SITSMamba_PASTIS-R_to_YieldSAT` | SITSMamba (CNN spatial encoder + Mamba temporal encoder + reconstruction branch), same PASTIS-R stage and export; the YieldSAT stage is skipped likewise. |
| `03_UTAE_pretrained_PASTIS-R_to_YieldSAT` | Published U-TAE weights, fine-tuned. The fold-k weights are tested on a fold they were not trained on, so there is no leakage. |
| `04_Compare_models` | One table and plots for all runs; old runs are cleaned up. |
| `05_Google_FloodHub_LSTM` | Google's open-sourced Flood Hub river model (Mean-Embedding Forecast LSTM, pretrained 110 epochs). It runs on the Caravan gauges nearest to each site, **only after the model's training window** (from Oct 2023), and exports hydrographs and NSE/KGE as `flood_lstm.json`. |

**Implementation notes.**
* A pure-PyTorch Mamba fallback, parameter-compatible with `mamba_ssm`, is used when the CUDA kernels cannot be built.
* For satellite time series (L ≤ 64) the fallback uses a sequential selective scan with a hand-written backward pass. It recomputes hidden states in batch chunks, so memory stays bounded (the CUDA kernel does the same). Its gradient is checked against autograd at start-up.
* Checkpoints (`last.pt`) are written mid-epoch, so a Colab disconnect resumes where it stopped.

Details: [ml/README.md](ml/README.md).

## 7. Validation, uncertainty and limitations

* **Browse images.** Live areas start from 8-bit browse images (~165 m), each stretched on its own, so their brightness is relative and not comparable between images. Ready areas and areas switched to *calibrated data* use GCOV γ⁰ in dB on one fixed scale (§5.9b).
* **Product maturity.** Products are labelled *beta* (before Jan 2026) or *provisional* (until 25 Oct 2026) by the NISAR project and may be reprocessed.
* **What radar does not measure.** Crop species, yield and soil chemistry are not read from radar here: crop types come from a trained optical network, suitability from FAO GAEZ, and the spill tool maps physical spread, not contamination.
* **Two-area comparison.** Browse brightness can differ slightly between tracks, so levels are compared more loosely than changes; similar radar behaviour does not prove the same land use; areas with little calendar overlap give no curve match.
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
* **Suitability and soil moisture.** GAEZ is 1981–2010 climate at 0.25° (area, not parcel) and knows nothing of a field's own soil, water rights or markets. ERA5-Land is a ~9 km reanalysis and does not see one field's irrigation. The NISAR wetness index is relative and only works on bare or low vegetation.
* **Drought.** Area-wide reanalysis and gridded rain (~10–50 km): irrigated fields can stay green in a drought; ERA5-Land requests can be rate-limited (the page says so).
* **Glaciers.** Fresh dry snow, crevasse fields and radar shadow on steep faces can mimic or hide melt; ice speed and thickness are not computed.
* **Globe layers.** Built from 8-bit browse mosaics at ~5–10 km; change patches with straight edges follow satellite swaths (the change happened between two passes).
* **Translation.** The interface, tool explanations, legend and static pages are in English and Turkish; the README and code comments are in English.
* **Landslide outlook.** A LHASA-style indicator from slope and rainfall percentiles, not an official warning; detection candidates also come from logging, fire or terrace harvest, and steep slopes facing away from the radar can be in shadow.
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
python3 pipeline/build_polar.py                     # polar caps (azimuthal projection) for every mosaic period
```

```bash
python3 pipeline/build_normalmap.py                  # relief normal map from Terrarium elevation
```

```bash
python3 pipeline/build_crop_prior.py                 # SPAM 2010 crop mix tiles (download the SPAM zips first)
```

```bash
python3 pipeline/build_suitability.py                # FAO GAEZ v4 suitability tiles (172 layers, ~10 min)
```

```bash
python3 pipeline/build_archetypes.py                 # Brazil reference library + self-test (~10 min)
```

```bash
python3 pipeline/build_landslides.py                 # NASA Global Landslide Catalog -> landslides.json
```

```bash
python3 pipeline/build_metrics.py                    # globe metric layers (variability, melt, main crop, landslides)
```

```bash
python3 pipeline/build_cropharvest.py                # NASA Harvest field labels -> 10-degree tiles
```

```bash
EARTHDATA_TOKEN=... python3 pipeline/build_calibrated_regions.py   # calibrated ready areas (or run the 'Calibrated NISAR areas' workflow)
```

```bash
python ml/export_mamba_onnx.py --ckpt best.pt --norm norm.json --tile 32   # team model -> web/public/models/
```

**Calibrated data.** Add the repository secret `EARTHDATA_TOKEN` (Settings → Secrets and variables → Actions) and run the *Calibrated NISAR areas* workflow; for any area, deploy the Worker in `worker/` (see worker/README.md) and set `nisarProxy` in `web/public/config.json`.

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
  src/sarWorker.js   Web Worker: all pixel work (live regions, filters, two-area comparison, landslides, spills, wetness)
  src/regionFetch.js live NISAR series for any point (ASF search, browse, FFT co-registration)
  src/dlWorker.js    U-TAE in the browser (Sentinel-2 COGs + ONNX Runtime)
  src/liveContext.js NASA POWER + MODIS NDVI for any region
  src/archive.js     radar archive 1978 -> today over a point
  src/legend.js      map legend, one section per active layer
  src/calWorker.js   calibrated GCOV HDF5 in the browser (h5wasm, range requests via the proxy)
  src/ux.js          light / dark theme, English / Turkish, glossary tooltips
  src/drought.js     rain and soil-moisture percentiles, SPI, drought classes
  src/cropHarvest.js NASA Harvest field labels near an area
  src/cropPrior.js   SPAM crop mix of an area
  src/suitability.js GAEZ crop suitability of an area
  src/soil.js        ERA5-Land + NASA POWER soil moisture
  src/landslide.js   terrain, landslide catalog, rainfall trigger, hazard
  src/worldcover.js  ESA WorldCover on the radar grid
  src/pages/report.js parcel report (team analyzer)
  public/models/     utae_pastis.onnx + metadata
  src/sar.js         speckle filter, render modes, change detection
  src/ml.js          k-means, cluster interpretation
  src/pages/         site page, static pages
  public/data/       generated data (mosaics, archetypes, suitability, cropprior, landslides, …)
ml/                  model code cells and exporters (notebooks are kept outside the repository)
worker/              Cloudflare Worker: authenticated byte-range proxy for NISAR HDF5
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
* **Land and crops:** ESA WorldCover 2021 (CC BY 4.0); SPAM 2010 (IFPRI, CC BY 4.0); GAEZ v4 (FAO & IIASA, CC BY-NC-SA 3.0 IGO, used non-commercially).
* **Soil moisture and rain:** ERA5-Land (Copernicus C3S, via Open-Meteo, CC BY 4.0); NASA POWER.
* **Landslides:** NASA Global Landslide Catalog (public domain).
* **Field labels:** NASA Harvest CropHarvest (CC BY-SA 4.0).
* **Other open data:** Caravan; USGS; GDELT; CelesTrak; Natural Earth (public domain).
* **Datasets and model code used by the notebooks:** PASTIS-R, utae-paps, state-spaces/mamba, each under its own licence.
* **Code of this project:** MIT licence.
* **SI disclosure:** the code and documentation were written with help from an AI coding assistant; see §1.

---

### 🇹🇷 Kısaca

Bu proje NISAR uydusunun **gerçek** L-band radar verisini bir "gezegen yüzeyi parmak izi" olarak okuyan bir 3B küre sitesidir. HH yüzeyin pürüzlülüğünü ve nemini, HV bitki hacmini gösterir; ikisinin sezon boyunca inip çıkışı arazide ne olduğunun parmak izidir. Dünyanın herhangi bir yerinde bir dikdörtgen çizilir, bütün NISAR geçişleri ASF arşivinden tarayıcıda canlı çekilir ve analiz edilir:

* **İki alan karşılaştırma:** iki yerin (ör. Brezilya soya kuşağı ve Harran) radar parmak izinin ne kadar benzediği, A'nın hangi kısımlarının B'ye benzediği ve yarım küreler arası 6 ay kaydırmalı sezon eğrileri;
* **Tarım:** U-TAE (ve takımın U-Mamba / SITSMamba modelleri) ile ürün türü haritası, ürün başına NISAR eğrisi, FAO GAEZ'e göre ürün önerileri, 4 derinlikte toprak nemi ve NISAR yüzey ıslaklığı;
* **Afetler:** heyelan izi tespiti ve yağışa bağlı heyelan tehlikesi (7 günlük tahmin), maden atığı / çamur yayılımı ve ulaştığı tarım alanı (kirlilik değil, fiziksel yayılım);
* **Kuraklık ve buzullar:** yağış ve toprak neminin 25 yıllık kayda göre yüzdeliği (SPI, D0–D4); buzulların ne zaman ve nerede eridiği, ıslak kar çizgisi;
* **Kürede katmanlar:** değişim, su, mevsimsel değişkenlik, kar/buz erimesi, ana ürün, heyelan geçmişi;
* açık/koyu tema, Türkçe/İngilizce arayüz, kesik çizgili terimler ve üzerine gelince açıklamaları; NASA Harvest arazi etiketleri;
* değişim tespiti, sel geçmişi, parsel raporu ve 1978'e uzanan radar arşivi.

Kürede 12 Ekim 2025'ten beri her döngünün dünya mozaiği (HH · HV · HH/HV ya da çok tarihli kompozit), yakınlaşınca tam çözünürlüklü NISAR çerçeveleri, katman başına renk rampalı lejant ve uydunun canlı konumu var. Değerler görsellik için değiştirilmez.

Form alanları için §1'e, ayrıntılı açıklama için docs/HOW_IT_WORKS.md'ye bakın.
