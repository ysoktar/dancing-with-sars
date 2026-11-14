# U-Mamba vs SITSMamba for SAR + optical crop mapping and yield (Colab)

Four notebooks that train and compare two Mamba-based architectures on **where crops are planted, what crop it is, and how much it yields**:

| # | Notebook | What it does |
|---|---|---|
| 1 | [`01_UMamba_PASTIS-R_to_YieldSAT.ipynb`](notebooks/01_UMamba_PASTIS-R_to_YieldSAT.ipynb) | U-Mamba ([arXiv:2401.04722](https://arxiv.org/abs/2401.04722)) adapted to satellite image time series |
| 2 | [`02_SITSMamba_PASTIS-R_to_YieldSAT.ipynb`](notebooks/02_SITSMamba_PASTIS-R_to_YieldSAT.ipynb) | SITSMamba ([arXiv:2409.09673](https://arxiv.org/abs/2409.09673)) |
| 3 | [`03_UTAE_pretrained_PASTIS-R_to_YieldSAT.ipynb`](notebooks/03_UTAE_pretrained_PASTIS-R_to_YieldSAT.ipynb) | Baseline that **starts from published weights** (U-TAE, PASTIS, 5 folds) |
| 4 | [`04_Compare_models.ipynb`](notebooks/04_Compare_models.ipynb) | Tables, learning curves, per-class IoU and a report for every finished run |

> Note: arXiv **2604.00940** is the *YieldSAT* dataset paper (CVPR 2026), not U-Mamba. U-Mamba is arXiv 2401.04722. YieldSAT is used here as the second dataset.

Open a notebook in Colab with *File → Open notebook → GitHub* and the repository URL, or upload the `.ipynb`. Choose an **A100 / H100 (High-RAM)** runtime and run the cells top to bottom.

## Pipeline

```
Stage 1  PASTIS-R  (France · 2,433 patches · 128×128 px · 10 m)
         inputs : Sentinel-1 SAR asc + desc (VV, VH, VV/VH) + Sentinel-2 (10 bands), one season
         targets: crop type (18 crops + background) · field extent · field boundaries · distance-to-edge
                  → individual fields ("plantation locations") via watershed
              │  best checkpoint
              ▼  weight transfer (band-by-name input remap, new static branch, crop head from matching classes)
Stage 2  YieldSAT  (Argentina, Brazil, Uruguay, Germany · 2,173 fields · 10 m)
         inputs : Sentinel-2 (12 bands) + weather + soil + terrain
         targets: yield t/ha per pixel ("efficiency") · crop type · field extent
```

* The same data cells, splits, losses, metrics and Drive layout are used by every notebook; only the model cell differs. All notebooks are generated from `cells/` by `build_notebooks.py`.
* PASTIS-R time series are placed on one 24-step grid (18-day bins, mean or median of observations, with observation flags). YieldSAT already provides 24 steps.
* SAR and optical channels are randomly dropped during PASTIS training, so the models also work when SAR is missing, as in YieldSAT.
* YieldSAT uses grouped folds (no field in two folds; `YS_SPLIT_BY = 'farm'` or `'year'` for harder shifts). Folds are saved once and shared by every model.

## Model adaptations

**U-Mamba** (designed for 3-D medical volumes) treats the time series as a (time × height × width) volume. Residual 3-D convolutions are followed by Mamba layers that scan all T·H·W tokens of the deeper stages (U-Mamba_Enc). Downsampling is spatial only. Acquisition dates are added as a sinusoidal encoding, skip connections are pooled over time with masked attention, and decoding is 2-D.

**SITSMamba**: a per-date CNN spatial encoder, a Mamba temporal encoder per pixel, a classification branch (ConvBlock) and a reconstruction branch (Linear → input time series, loss weight 0.1), as in the paper. The classification branch feeds the multi-task heads. No official weights are published.

**U-TAE (pretrained)**: the published optical model is kept intact. A new SAR U-TAE branch is fused through a zero-initialised layer, so fine-tuning starts exactly from the published model. Careful: the official `Fold_j` weights were *tested on fold j−1* (`Fold_1` was trained on folds 1–3 and tested on 5). For test fold k the notebook therefore loads `Fold_{k%5+1}`, which never saw fold k.

**Transfer PASTIS-R → YieldSAT** (all models):

| Part | What happens |
|---|---|
| Input layer | columns copied for the 10 shared S2 bands; `B01`, `B09`, weather and flags new (zero-init); SAR dropped |
| Static data | new branch for soil, DEM and coordinates, zero-initialised output |
| Crop head | rows copied from PASTIS classes: Corn→corn, Winter rapeseed→rapeseed, Soybeans→soybean, Soft winter wheat→wheat |
| Extent head | transferred unchanged |
| Yield head | new |
| Training | phase 1: backbone frozen; phase 2: all layers, backbone LR × 0.3 |

Set `TRANSFER_FROM_PASTIS = False` to train from scratch and measure what the transfer is worth.

## Google Drive layout (identical in every notebook)

```
MyDrive/sar_crop_ml/
├── data/raw/PASTIS-R.zip                   downloaded once (53.7 GB)
├── data/raw/yieldsat/…/*.nc                put the YieldSAT preprocessed release here
├── data/cache/yieldsat/                    rebuilt field tensors (reused by every notebook)
├── data/splits/                            pastis_folds.json, yieldsat_field_k5.json
├── weights/pretrained/utae/                published U-TAE weights
├── runs/<model>/<pastis|yieldsat>/<run>/
│   ├── config.json  env.json  log.txt  metrics.csv  test_metrics.json  model_architecture.txt
│   ├── checkpoints/last.pt                 model, optimizer, scheduler, AMP scaler, RNG, epoch AND batch position
│   ├── checkpoints/best.pt                 best validation checkpoint
│   └── samples/epoch_XXX.png, test.png     prediction figures
└── reports/latest/                         written by notebook 4
```

**Stopping and resuming**: `last.pt` is saved every 10 minutes and at the end of every epoch, with atomic writes. Re-running the same cell continues from the exact batch where training stopped. This was tested by interrupting mid-epoch and checking that the step count after resuming matched an uninterrupted run. To stop on purpose, create an empty file named `STOP` in the run folder.

## Data access

* **PASTIS-R**: downloaded automatically from Zenodo ([5735646](https://zenodo.org/record/5735646)).
* **YieldSAT**: request access with the form on [yieldsat.github.io](https://yieldsat.github.io/), then copy the *preprocessed* release (`preprocessed-24-ts/<Country>/…/merge_s2-soil-dem-weather-coords.nc`) to `MyDrive/sar_crop_ml/data/raw/yieldsat/`.

## What was tested

* Notebooks 1, 2 and 4 were executed end-to-end on CPU with synthetic data that has the same file formats as PASTIS-R and YieldSAT (`SARCROP_SMOKE=1`, see `smoke_test.py`). This covered preprocessing, training, transfer, testing, plots, the report, resuming a finished run, and resuming in the middle of an epoch.
* The PyTorch Mamba fallback is checked against a sequential reference at start-up (error ~2e-6).
* **Not tested**: notebook 3 (it runs the official U-TAE code, which could not be executed in this environment; it was checked against that code instead), real GPU runs, `mamba_ssm` installation on the current Colab image, and real-data accuracy. Batch sizes and epochs are starting points, not tuned.

## Rebuild the notebooks / run the smoke test

```bash
pip install nbformat nbclient ipykernel torch xarray netCDF4 scipy scikit-image matplotlib pandas
python ml/build_notebooks.py
python ml/smoke_test.py ml/notebooks/01_UMamba_PASTIS-R_to_YieldSAT.ipynb /tmp/smoke
```

## References
* Ma, Li, Wang. *U-Mamba: Enhancing Long-range Dependency for Biomedical Image Segmentation.* arXiv:2401.04722 (2024).
* Qin et al. *SITSMamba for Crop Classification based on Satellite Image Time Series.* arXiv:2409.09673 (2024).
* Sainte Fare Garnot, Landrieu. *Panoptic Segmentation of Satellite Image Time Series with Convolutional Temporal Attention Networks.* ICCV 2021 (PASTIS, U-TAE).
* Sainte Fare Garnot et al. *Multi-modal temporal attention models for crop mapping from satellite time series.* ISPRS J. 2022 (PASTIS-R).
* Miranda et al. *YieldSAT: A Multimodal Benchmark Dataset for High-Resolution Crop Yield Prediction.* CVPR 2026, arXiv:2604.00940.
