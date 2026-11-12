# Going global: the full NISAR archive and worldwide elevation

The website ships with **11 study sites** (~20 MB of web-ready imagery). This page covers how big the worldwide data really is and how to get it.

Sizes were measured on **12 Nov 2026** from NASA CMR granule counts × the mean file size of a 200-granule sample, so they are estimates. The archive grows every day.

## 1. NISAR: how big is "everything"?

| Product | What it is | Granules | Mean size | Total |
|---|---|---:|---:|---:|
| **GCOV** | backscatter (HH, HV, …), geocoded, what this site uses | 198,430 | 3.0 GB | **≈ 605 TB** |
| **GUNW** | interferograms (ground motion) | 104,367 | 1.5 GB | **≈ 155 TB** |
| **GOFF** | pixel offsets (glacier / large motion) | 31,383 | 0.9 GB | **≈ 29 TB** |
| GSLC | geocoded single-look complex | 198,198 | 11.0 GB | ≈ 2.2 PB |
| RSLC | radar-geometry single-look complex | 200,671 | 12.8 GB | ≈ 2.6 PB |
| **All L1/L2** | | | | **≈ 5.6 PB** |
| GCOV *browse PNGs* | the images used on this site | 198,430 | ~3.7 MB | **≈ 0.7 TB** |

Downloading all of it is not realistic: 605 TB of GCOV alone would take ~2 months on a dedicated 1 Gbit/s line. There are three practical routes, from easiest to most rigorous.

### Route A: global browse mosaic (what fits this website)

One 12-day repeat cycle covers all land and ice once, about 15–20 k GCOV frames, so roughly **60–75 GB of browse PNGs per cycle**. Each frame is warped into web map tiles and then deleted, so disk use stays small. A worldwide mosaic at ~150 m comes to **2–5 GB of tiles per cycle**.

1. Install the dependencies:
   ```bash
   pip install numpy pillow
   ```
2. Use `pipeline/build_data.py` as a template. Replace the per-site point search with a time-window search (all GCOV between two dates), and paste each frame into XYZ tiles (zoom 0–8) instead of cropping one site.
3. Expect 6–12 hours per cycle on a home connection. This is too long for a free GitHub Actions run (6 h limit, 14 GB disk), so run it on your own machine or a cloud VM, then host the tiles on object storage such as Cloudflare R2, S3 or GitHub Releases.

No login is needed: the browse images are public.

### Route B: science-grade values, processed in the cloud

The full HDF5 files sit in AWS **us-west-2**. Reading them from a machine in that region is fast and free of egress charges; downloading them elsewhere is slow.

1. Create a free NASA Earthdata account at https://urs.earthdata.nasa.gov.
2. Start a VM in AWS us-west-2, or use a free NASA-hosted JupyterHub such as openscapes or CryoCloud if you are eligible.
3. Install the Python stack:
   ```bash
   pip install earthaccess h5py xarray pyproj
   ```
4. Stream only the bands and windows you need. `pipeline/fetch_hdf5.py` already does this per site: it reads the HH and HV chunks over HTTPS without downloading the 3 GB file.
5. Write aggregated outputs, for example a monthly 1 km global mean γ⁰ (~2 GB per month), not raw files.

### Route C: download a region or a period

To download real files for one country, one season or one product, use ASF:

```bash
pip install asf_search
```

```python
import asf_search as asf
session = asf.ASFSession().auth_with_creds("EARTHDATA_USER", "EARTHDATA_PASS")
results = asf.search(dataset="NISAR", processingLevel="GCOV",
                     intersectsWith="POLYGON((26 36,45 36,45 42,26 42,26 36))",   # Türkiye
                     start="2026-10-21", end="2026-11-12")
print(len(results), "granules,", sum(r.properties["bytes"] for r in results) / 1e12, "TB")  # check first!
results.download(path="./nisar", session=session, processes=4)
```

Always print the count and size before downloading. Validated L-band products start on 21 Oct 2026; earlier ones are *provisional* or *beta*.

## 2. Worldwide elevation (height) data

| Dataset | Agency | Resolution | Coverage | Tiles | Total size | Login |
|---|---|---|---|---:|---:|---|
| **NASADEM_HGT** | NASA (SRTM reprocessed) | 30 m | 60° N – 56° S | 14,520 | **≈ 116 GB** (zipped) | Earthdata |
| SRTMGL1 v3 | NASA | 30 m | 60° N – 56° S | 14,297 | ≈ 116 GB | Earthdata |
| **Copernicus DEM GLO-30** | ESA / Airbus | 30 m | global, including poles | 26,450 | **≈ 535 GB** | none |
| Copernicus DEM GLO-90 | ESA / Airbus | 90 m | global | 26,475 | ≈ 67 GB | none |

This site already uses **Copernicus GLO-30** for each study site (`pipeline/build_dem.py`, no login). NASADEM does not cover Greenland or Antarctica, so it would miss Jakobshavn and Thwaites.

### NASA NASADEM, everywhere it exists (~116 GB)

1. Create a NASA Earthdata account and approve the **LP DAAC** application in your profile.
2. Download the tiles:
   ```bash
   pip install earthaccess
   ```
   ```python
   import earthaccess
   earthaccess.login()                                    # asks for your Earthdata login once
   granules = earthaccess.search_data(short_name="NASADEM_HGT", version="001")
   print(len(granules))                                   # 14,520 tiles
   earthaccess.download(granules, "./nasadem")            # ≈ 116 GB of .zip files
   ```
3. Each zip holds one 1°×1° `.hgt` tile: 16-bit big-endian, 3601×3601 pixels. To build a single mosaic, use GDAL:
   ```bash
   gdalbuildvrt nasadem.vrt nasadem/*.zip
   ```

### Copernicus GLO-30 or GLO-90, everywhere (no login)

1. Install the AWS CLI (`pip install awscli` or the official installer). No AWS account is needed.
2. For 90 m (≈ 67 GB):
   ```bash
   aws s3 sync --no-sign-request s3://copernicus-dem-90m/ ./cop90 --exclude "*" --include "*DEM.tif"
   ```
3. For 30 m (≈ 535 GB):
   ```bash
   aws s3 sync --no-sign-request s3://copernicus-dem-30m/ ./cop30 --exclude "*" --include "*DEM.tif"
   ```

### Elevation on the 3-D globe

The browser cannot use hundreds of GB, so the globe needs a downsampled product:

| Target | How | Size |
|---|---|---|
| Globe relief (displacement map) | `gdalwarp -tr 0.05 0.05 -r average cop90.vrt globe.tif`, then encode as a 16-bit PNG | ~25 MB |
| Zoomable terrain tiles | `rio rgbify` → terrarium XYZ tiles zoom 0–10 from GLO-90 | ~10–20 GB |

## 3. Summary

| Goal | Download | Login |
|---|---|---|
| This website (11 sites) | ~0.3 GB browse + ~0.2 GB DEM tiles | no |
| Global NISAR picture, one 12-day cycle | ~70 GB (→ 2–5 GB tiles) | no |
| All NISAR GCOV browse images to date | ~0.7 TB | no |
| All NISAR GCOV science files | ~605 TB, so process in AWS us-west-2 instead | yes |
| Entire NISAR archive | ~5.6 PB, not practical | yes |
| NASA NASADEM, global | ~116 GB | yes |
| Copernicus DEM 30 m / 90 m, global | ~535 GB / ~67 GB | no |
