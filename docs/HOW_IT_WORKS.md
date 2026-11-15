# How Dancing with the SARs works

A detailed walk through the website: what radar measures, where every number comes from, how each tool computes its
result, how far each result can be trusted, and what was tried and dropped. The README is the short reference; this
document explains.

---

## 1. What NISAR measures

NISAR (NASA–ISRO, launched 30 July 2025) carries an **L-band radar** (24 cm wavelength). It sends microwave pulses
and records the echo, day and night, through cloud. Every place on Earth's land and ice is imaged about every 12 days,
from two directions (ascending and descending passes).

The echo strength is called **backscatter**. Two numbers matter on this site:

| Channel | Sent / received | Mostly tells | Example |
|---|---|---|---|
| **HH** | horizontal / horizontal | roughness and wetness of the ground | smooth water is dark; ploughed wet soil is bright; buildings are very bright |
| **HV** | horizontal / vertical | how much plant volume there is: leaves, stems and branches scramble the polarization | forest is bright; bare fields are dark; a growing crop gets brighter week by week |

Over a season, the **rise and fall** of HH and HV is a fingerprint of what happens on the ground: a field is sown
(HV low), grows (HV rises), is harvested (HV drops at once); a paddy is flooded (HH very dark) then planted; a slope
fails (HV drops and stays low); snow melts (HH drops sharply).

What radar does **not** measure directly: the crop species, the yield in tonnes, soil chemistry, rainfall. Where the
site shows those, they come from other data, and the page says so.

---

## 2. Where the radar data come from

### 2.1 Two NISAR products

| | Browse images | Calibrated GCOV |
|---|---|---|
| What | quick-look PNG published with every product | the science product: γ⁰ backscatter, HDF5 |
| Pixel | ~165 m, 8-bit | 20 m, 32-bit floating point |
| Values | **stretched separately for every image** | physical units (γ⁰), converted to dB here |
| Access | public, no login | NASA Earthdata Login token |
| Size | ~4 MB per frame | ~2 GB per frame (only the needed parts are read) |

**Why the difference matters.** Comparing both products for the same frames showed that every browse image is
enhanced on its own and non-linearly: −12 dB in HH became 120 in one image, 99 in another and 122 in a third
(`pipeline/browse_vs_gcov.py`). Browse brightness can show patterns inside one image, but it cannot be compared
between images, dates or tracks. Calibrated values can.

### 2.2 How the site uses them

* **Globe mosaics** (`pipeline/build_mosaic.py`): about 16,000 browse frames per 12-day cycle are placed on a world
  grid with soft edges, values unchanged. Gaps are filled from the nearest cycle in time.
* **Any area you draw** (`web/src/regionFetch.js`): the browser asks NASA's ASF archive for every pass over the area,
  downloads the browse images, puts the frames of each date together and aligns the dates by **phase correlation**
  (the shift that makes two images match best, found with a Fourier transform).
* **Ready areas** (`pipeline/build_calibrated_regions.py`): for a list of areas, the latest 12 calibrated passes are
  precomputed every week by GitHub Actions and open in about 3 seconds.
* **Calibrated data for any area** (`worker/`, `web/src/calWorker.js`): a small free server (Cloudflare Worker) holds
  the Earthdata token and passes byte ranges of the HDF5 files to the browser, which decodes them itself (h5wasm,
  HDF5 compiled to WebAssembly). Only the 512 × 512 blocks over the area are downloaded: about 25–35 MB per pass for a
  9 km area instead of 2 GB.

### 2.3 One fixed scale for calibrated data

Calibrated γ⁰ is averaged in linear power onto the area's 256 × 256 grid, converted to decibels and mapped to the same
byte scale for every pass and product:

* HH: −25 dB → 0, 0 dB → 254
* HV: −32 dB → 0, −7 dB → 254

So a value of 150 means the same backscatter everywhere, and every tool works unchanged on comparable numbers.

### 2.4 Speckle

Radar images are grainy (speckle). The site uses the **multi-temporal Quegan filter**: each date is multiplied by the
ratio of the local mean over all dates to the local mean of that date, which keeps detail while averaging out grain,
followed by a light 3 × 3 Lee filter.

---

## 3. The globe

### 3.1 Display of the mosaics

* **HH · HV · HH/HV** (the convention of JAXA's L-band PALSAR mosaics): red = HH, green = HV, blue = HH − HV (the ratio
  in decibel-like units). Each channel has a fixed range, the same everywhere. Forest looks green, fields and bare soil
  blue, towns and flooded vegetation bright, water black.
* **Multi-date composite**: red, green and blue are HH of three cycles. Where nothing changed the colours add up to
  grey; a colour means the surface changed between those dates.
* The data are never altered for looks: only the display mapping is chosen, and it is the same everywhere.

### 3.2 The poles

A flat world map (equirectangular) squeezes every longitude into one point at each pole. Drawn on a sphere, that makes
radial streaks. And NISAR never images beyond about 77.7° N and 88° S, so there is a gap.

The site therefore draws everything poleward of 60° on separate **polar caps** in a pole-centred **azimuthal
equidistant** projection (distance from the pole is true, every direction is equal; `pipeline/build_polar.py`). The
gap beyond NISAR's reach is filled by **normalized convolution**: masked Gaussian smoothing at growing scales, which has
no preferred direction, so there are no spokes. The filled area is recorded in each period's metadata.

### 3.3 Distilled layers

Six layers summarise what the radar shows, plus a Sentinel-1 context layer; 19 candidates were considered and 13 rejected (single channels, a "best
crop" map, global drought or soil moisture without a live global grid…):

| Layer | How it is computed | Read it as |
|---|---|---|
| Change since the previous cycle | mean HH and HV difference between two cycles on the graphics card; under 20 units hidden | cyan brighter (growth, new structures), red darker (clearing, harvest, flood, melt) |
| Water and wet surfaces | HH < 70 and HH + HV < 140 | open water, floods, wet paddies (dry sand and radar shadow can look the same) |
| Seasonal variability | robust spread (median absolute deviation) of HV − HH over 12 cycles | fields change a lot, forest, desert and ice little |
| Snow and ice melt | deepest HH drop below each pixel's own 80th percentile, cold land only | where snow and ice got wet |
| Main crop | dominant crop of each 0.25° cell, SPAM 2010 | which crop is grown where |
| Landslide history | NASA Global Landslide Catalog, 11,033 events | where slopes have failed before |
| Sentinel-1 C-band 2020 · 2021 | ESA WorldCover yearly median VV and VH (Sentinel-1), year follows the timeline | radar context before NISAR; C-band sees mostly leaves, L-band goes deeper |

---

## 4. The tools of a region

### 4.1 Crop types (deep learning)

* **Input**: a Sentinel-2 optical time series of a 1.28 × 1.28 km window, read straight from cloud-optimized files.
* **Models**: the team's **SITSMamba** (default) and the published **U-TAE**, both trained on PASTIS (French
  farmland, 18 crop types), run in the browser with ONNX Runtime.
* **Results on the PASTIS test fold** (folds kept apart; the best checkpoint chosen on a separate validation fold):

  | Model | mIoU | Overall accuracy | Parameters |
  |---|---|---|---|
  | SITSMamba | 0.660 | 0.846 | 0.29 M |
  | U-TAE | 0.651 | 0.843 | 2.18 M |
  | U-Mamba | 0.639 | 0.840 | 9.65 M |

  mIoU (mean intersection over union) averages, over the crop types, how well the predicted and true fields overlap.
* **Clean-up**: ESA WorldCover removes desert, towns and water; pixels that never turn green (NDVI below 0.3) are not
  fields; small patches are merged; one crop per field by a vote of the probabilities; the regional crop mix (SPAM)
  down-weights crops not grown there.
* **Limits**: outside Western Europe the classes are the nearest French equivalent; the page then shows crop groups.
* **NISAR per crop**: the crop map is laid over the radar grid; radar pixels that are mostly one crop give that crop's
  radar curve through the season, with peak, harvest and paddy-flooding dates that do not need clear skies.

### 4.2 What could grow here

FAO GAEZ v4 suitability (0–100) for 50 crops, rain-fed and irrigated, on today's cropland, compared with the crops that
are grown (SPAM 2010). Options = suitable but not grown; "needs irrigation" = irrigated beats rain-fed by 20 points.
GAEZ uses 1981–2010 climate at ~28 km: it describes the area, not one field.

### 4.3 Soil moisture

* ERA5-Land reanalysis: soil water in four depths (0–7, 7–28, 28–100, 100–255 cm), with the normal for the time of year.
* NASA POWER: monthly soil wetness (surface, root zone, profile).
* NISAR wetness: on the passes on which a pixel is bare, HH between its driest and wettest pass (0 to 1). It needs bare
  or low vegetation; under a canopy HH follows the plants.

### 4.4 Drought

Rainfall over the last 30, 90 and 180 days and root-zone soil moisture, each compared with the same weeks of every
year on record, as **percentiles** (10th = only one year in ten was drier). The level follows the US Drought Monitor:
D0 ≤ 30th, D1 ≤ 20th, D2 ≤ 10th, D3 ≤ 5th, D4 ≤ 2nd percentile. SPI expresses the percentile as standard deviations.

### 4.5 Compare two areas

Not a pixel-by-pixel match. Two places are compared as wholes on six aspects:

1. **Radar behaviour**: overlap of the distributions of six features of ~300 m blocks (mean HH, mean HV, their
   variability, HV range, RVI).
2. **Land cover**: shared share of ESA WorldCover classes.
3. **Crop mix**: shared share of SPAM crops.
4. **Climate**: monthly temperature and rain (NASA POWER), optionally shifted by six months for the other hemisphere.
5. **Soil water regime**: monthly root-zone wetness.
6. **Terrain**: slope distribution.

When one area is calibrated and the other is not, brightness levels are not compared (only variability and range).

*Tried and dropped*: automatic matching to a library of 30 Brazilian landscapes. In a leave-one-area-out test it found
the right structural class for 48 % of cells (chance 25 %), and NISAR data over Brazil only start in its dry season, so
it called irrigated cotton in Türkiye "forest". The transparent comparison replaced it.

### 4.6 Landslides

* **Detection**: on slopes of at least 15°, HV dropped (vegetation stripped) more than 2.5 times the change seen on
  flat ground between the passes before and after a date, and stayed low.
* **Hazard**: steep terrain plus a 7-day rainfall index compared with its own 90th, 95th and 99th percentiles over 25
  years, as in NASA's LHASA model; the rain forecast extends it 7 days. An indicator, not an official warning.

### 4.7 Mine spill or mudflow

Mud burying the ground lowers HV and changes HH, and stays. A pixel counts when both channels change by more than
3 times its own normal variability and the change persists on the next pass; the land cover it reached (cropland in
hectares) is listed. Radar cannot measure contamination: the result says where to take soil and water samples.

### 4.8 Glaciers and snow

Melting snow and ice hold liquid water, which absorbs L-band: a pixel is wet when HH is more than 2 robust standard
deviations below its own dry level. Per pass: the wet share of the ice, the melt season, and the wet-snow line from
elevation. On the Aletsch Glacier: melt from late June to late August, the wet-snow line up to ~4,100 m.

### 4.9 Earthquakes and building damage

An intact building reflects the radar twice, off a wall and then the ground, straight back to the satellite (a strong HH
"double bounce"). When it collapses, that corner disappears and HH drops. The tool lists USGS earthquakes of magnitude
4.5 or more within 300 km since the first pass. For a chosen event it compares the mean of up to two passes before with
the first two after, over built-up land only (ESA WorldCover). The change is divided by the noise of the same buildings
between two passes before the event, so their normal variation is calibrated out. Drops beyond 2.5σ that at least two
neighbouring pixels share are flagged; brightening (rubble, new structures) is counted separately. It is a screening map:
construction, wet roofs and viewing geometry can look alike, and fault displacement needs NISAR interferograms (GUNW).

### 4.10 Radar indices

From calibrated γ⁰ only, per pixel in linear power, the median over land per pass: RVI = 4·HV/(HH+HV) (0 for bare soil
to about 1 for a dense canopy; it can exceed 1 when HV comes close to HH), RFDI = (HH−HV)/(HH+HV), HV−HH in dB and the
span. RVI and RFDI depend on the same HV/HH ratio. Left out on purpose: indices that need VV or quad-pol (NISAR images
farmland in HH/HV), coherence (needs complex SLC products), and biomass, LAI or vegetation-water formulas whose
coefficients are site-specific.

### 4.11 Other tools

Change between two dates (log-ratio, Otsu threshold), flood history (Google's 1999–2020 inundation record against NISAR
water), parcel report (elevation, reference crop curves, weather), and the radar archive back to Seasat (1978).

---

## 5. How far to trust each result

| Result | Basis | Main limit |
|---|---|---|
| Change, water, melt, landslide candidates | NISAR directly | look-alikes: harvest vs clearing, dry sand vs water |
| Crop types | trained optical network | trained in France; one fold tested |
| Suitability, crops grown | FAO GAEZ, SPAM | ~10–28 km cells, 2010 statistics |
| Soil moisture, drought | ERA5-Land, NASA POWER, NISAR | ~9–50 km grids; irrigated fields not seen |
| Comparison | six independent aspects | similar behaviour is not proof of the same land use |
| Browse-based numbers | browse images | stretched per image: relative only |
| Calibrated numbers | GCOV γ⁰ | provisional products until validation |

---

## 6. Interface

Light or dark theme and English or Turkish are switched in the top bar. Technical terms have a dashed underline; hovering
or tapping shows a plain definition. Each globe layer has a legend entry with colour ramps and the fixed ranges.

## 7. Running it

The data pipeline is in `pipeline/` (Python), the website in `web/` (Vite), the proxy in `worker/`. The README lists the
commands; GitHub Actions rebuilds and deploys the site on every push and refreshes the calibrated ready areas weekly.
