# ∿ Dancing with the SARs

**An interactive 3-D globe, timeline and in-browser machine-learning lab for real NISAR L-band radar data.**
Built for the NASA Space Apps Challenge *“Dancing with the SARs”*.

Earth’s surface is always moving: monsoon floods spread and recede, forests are cleared, crops are planted and harvested, glaciers melt and refreeze. The NASA–ISRO **NISAR** satellite images all of it every 12 days, day or night, through clouds. This project turns NISAR’s Level-2 **GCOV** backscatter into something anyone can explore.

| | |
|---|---|
| 🌍 **3-D globe + timeline** | Real NISAR radar frames draped on the globe at their true date and location; monthly global acquisition density from NASA CMR; an animated NISAR orbit; play/scrub through Oct 2025 → today. |
| 🔍 **Site explorer** | 11 study sites (floods, deforestation, glaciers, crops, wetlands, volcano, wildfire, groundwater). Dual-pol RGB, HH, HV, HV/HH and temporal-variability views; Lee speckle filter; swipe comparison; scene and per-pixel time series with robust trend and anomaly flags. |
| 🤖 **ML lab (TensorFlow.js)** | ① k-means++ scattering classes with physical interpretation · ② log-ratio + Otsu change detection with km² estimates · ③ a deep **autoencoder** trained live in the browser on each pixel’s temporal signature: reconstruction error = anomaly map, 2-D latent space = learned behaviours. |
| 📡 **Radar 101** | Interactive wavelength/penetration diagram (X, C, S, L), scattering mechanisms, polarization. |
| 🔁 **Living data** | A GitHub Actions workflow re-downloads the newest NISAR passes every week and redeploys to GitHub Pages. |

## Study sites

| Site | Change type | NISAR track | Dates |
|---|---|---|---|
| Konya Closed Basin, Türkiye | irrigation & groundwater | P7 F70 desc | Jun–Oct 2026 |
| Sylhet Haor Wetlands, Bangladesh | monsoon flood | P91 F76 desc | Jun–Nov 2026 |
| Rondônia, Brazil | deforestation | P161 F173 asc | Jun–Oct 2026 |
| Jakobshavn Isbræ, Greenland | glacier melt / freeze | P131 F37 asc | Jun–Nov 2026 |
| Tulare Basin, California | crops, subsidence | P34 F20 asc | Nov 2025–Oct 2026 |
| Okavango Delta, Botswana | flood pulse | P172 F168 asc | Jun–Oct 2026 |
| Punjab, India | rice–wheat cycle | P156 F17 asc | Dec 2025–Nov 2026 |
| Mississippi Delta, USA | wetland loss | P105 F16 asc | Jun–Oct 2026 |
| Kīlauea, Hawaiʻi | volcanism | P151 F11 asc | Dec 2025–Nov 2026 |
| Jasper, Canada | wildfire recovery | P48 F28 asc | Jun–Nov 2026 |
| Thwaites Glacier, Antarctica | ice / sea ice | P106 F140 asc | Jan–Oct 2026 |

(Exact values are in `web/public/data/catalog.json` and change when the pipeline is re-run.)

## How the data pipeline works

`pipeline/build_data.py` needs **no login**:

1. **Search:** the [ASF DAAC search API](https://docs.asf.alaska.edu/api/basics/) lists every NISAR L2 GCOV granule intersecting each site.
2. **Track lock:** keep the one path/frame/direction that fully covers the site window most often, so the viewing geometry is the same on every date.
3. **Imagery:** download the geocoded browse image ASF publishes with each granule (`*_LATLON.png`; R = HH, G = HV, B = HH) and crop a 256 × 256 window.
4. **Co-registration:** provisional products ship without overlay bounds, so each date is aligned to a reference by **FFT phase correlation** (residual ≤ 1–2 px). Frames that won’t lock on fall back to the median offset.
5. **Globe frames:** the whole radar frame is saved as a transparent WebP and draped on the globe.
6. **Global density:** [NASA CMR](https://cmr.earthdata.nasa.gov) footprints of all NISAR GCOV collections, sampled four days per month and binned on a 3° grid.

Output: `web/public/data/{catalog.json, coverage.json, sites/<id>/*.png|webp}` (~20 MB).

### Calibrated backscatter (optional)

Browse PNGs are display products: brightness, not calibrated γ⁰. With a free [NASA Earthdata](https://urs.earthdata.nasa.gov) account you can swap in real gamma-naught values. The script streams only the needed chunks of each HDF5:

```bash
pip install earthaccess h5py pyproj numpy pillow
python pipeline/fetch_hdf5.py --site konya sylhet
```

## Run locally

```bash
pip install -r pipeline/requirements.txt
python pipeline/build_data.py          # optional: refresh data (~10 min)
```

```bash
cd web
npm ci
npm run dev                            # http://localhost:5173
```

Add `?tf=cpu` to the URL to force the TensorFlow.js CPU backend (useful on machines without WebGL).

## Deploy (GitHub Pages via GitHub Actions)

1. Push to `main`.
2. In the repository, open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. The workflow `.github/workflows/deploy.yml` builds `web/` and publishes it to `https://<user>.github.io/<repo>/`. It also runs every Monday to fetch new NISAR passes, and you can start it by hand from the Actions tab (“Run workflow”).

## Limitations

* Brightness values come from 8-bit browse images (≈150 m pixels), not calibrated 10–20 m GCOV. Use `fetch_hdf5.py` for science-grade numbers.
* Many products are labelled *beta* or *provisional* by the NISAR project and may be reprocessed.
* Ground deformation (subsidence, volcanic inflation) needs interferometric GUNW products. It is discussed as a hypothesis, not measured here.
* The ML models are unsupervised and exploratory: they show where to look, not validated land-cover maps.

## Tech

Vite · globe.gl / three.js · Chart.js · TensorFlow.js · Python (numpy, Pillow). MIT licence.

Data: NASA/JPL-Caltech & ISRO, NISAR mission, distributed by the ASF DAAC. Base map: NASA Blue Marble.

---

### 🇹🇷 Kısaca

Bu proje NISAR uydusunun **gerçek** L-band radar verisini (ASF DAAC üzerinden, giriş gerektirmeden) indirip zaman çizelgeli bir 3B küre üzerinde gösterir. Konya Kapalı Havzası dahil 11 çalışma alanında sel, ormansızlaşma, buzul, tarım ve sulak alan değişimlerini izleyebilirsiniz. Tarayıcıda çalışan makine öğrenmesi modülleri şunlardır: k-means sınıflandırma, log-oran + Otsu değişim tespiti ve TensorFlow.js ile eğitilen derin otokodlayıcı. Site GitHub Actions ile her hafta güncellenip GitHub Pages’e yayınlanır.
