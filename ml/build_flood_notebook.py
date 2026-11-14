#!/usr/bin/env python3
"""Build notebooks/05_Google_FloodHub_LSTM.ipynb (Colab).

Runs Google's open-sourced Flood Hub river model (OpenHydroNet / googlehydrology,
Mean-Embedding Forecast LSTM, pretrained weights in google-research/flood-forecasting)
on the Caravan gauges nearest to this project's sites, for the period AFTER the
model's training window (training: 1982-01-01 .. 2023-09-30), so the skill shown is
out-of-sample in time. Output: flood_lstm.json for web/public/data/.
"""
import nbformat as nbf
from pathlib import Path

C = []
md = lambda s: C.append(nbf.v4.new_markdown_cell(s.strip()))
code = lambda s: C.append(nbf.v4.new_code_cell(s.strip()))

md(r"""
# 05 · Google Flood Hub river model (pretrained) on the project sites

**Model**: Google Research's operational Flood Hub architecture, a *Mean-Embedding Forecast LSTM* with a
CMAL (mixture) head, open-sourced in June 2026 as **OpenHydroNet** (`googlehydrology`, Apache-2.0):
<https://github.com/google-research/flood-forecasting>. The repository ships the trained run
`pretrained-models/google-floodhub-settings-110-epochs` (weights `model_epoch110.pt`, scalers, config).

**Inputs** (MultiMet Caravan extension, public bucket `gs://caravan-multimet/v1.1`):
ECMWF HRES and GraphCast forecasts, NASA IMERG and NOAA CPC precipitation (hindcast), plus
static catchment attributes from Caravan / HydroATLAS. Targets are daily streamflow from Caravan.

**Why only after September 2023?** The released weights were trained on **all of 1982–2023-09-30, with no
held-out years** (see the repository's *Pretrained-Models-README*). Scoring them inside that window would be
in-sample. We therefore run the model only from **2023-10-01 to the end of the MultiMet record (late 2024)**,
which is a genuine out-of-sample test in time.

**What the notebook does**
1. installs `googlehydrology` with uv and clones the pretrained run (cached on Drive);
2. downloads Caravan (NetCDF, Zenodo) once to Drive for the static attributes and observed streamflow;
3. picks, for each project site, the nearest gauged basins from the model's basin list;
4. runs `run infer` for those basins over the out-of-sample window (7-day lead forecasts);
5. computes NSE / KGE / peak timing per gauge and exports `flood_lstm.json` (hydrographs + skill).

Everything lives in `MyDrive/sar_crop_ml/flood_lstm/` and every step is skipped when its output exists,
so the notebook can be re-run after a disconnect.

> NISAR (2025–26) and this model's input data (to 2024) do not overlap yet. The export is shown on the site as
> the river context of each area: how floods there behave and how well a state-of-the-art model predicts them.
""")

code(r"""
# ---------------------------------------------------------------- settings
SITES = {   # id: (lon, lat)  — same coordinates as pipeline/sites.json
    'sylhet': (91.2, 24.7), 'mississippi': (-91.25, 29.7), 'tulare': (-119.6, 36.05), 'punjab': (75.6, 30.6),
    'okavango': (22.6, -19.3), 'konya': (32.75, 37.45), 'rondonia': (-63.4, -9.4), 'nile': (31.1, 30.85),
    'iowa': (-93.6, 42.05), 'matogrosso': (-55.7, -12.55), 'ukraine': (34.4, 49.4), 'mekong': (105.45, 10.35),
    'phuprao': (105.485, 15.2),
}
MAX_KM = 400            # search radius around a site
PER_SITE = 3            # gauges per site
START, END = '01/10/2023', None   # END=None -> last day of the MultiMet record
EPOCH = 110
SMOKE = False           # True: one site, one gauge (quick test)

import os, sys, json, math, shutil, subprocess, time, glob
from pathlib import Path
IN_COLAB = 'google.colab' in sys.modules
if IN_COLAB:
    from google.colab import drive
    drive.mount('/content/drive')
ROOT = Path(os.environ.get('FLOOD_ROOT', '/content/drive/MyDrive/sar_crop_ml/flood_lstm'))
LOCAL = Path(os.environ.get('FLOOD_LOCAL', '/content/flood_local'))
for p in (ROOT, LOCAL):
    p.mkdir(parents=True, exist_ok=True)
print('Drive folder:', ROOT)

def sh(cmd, cwd=None):
    # stream output, fail loudly
    print('$', cmd, flush=True)
    p = subprocess.Popen(cmd, shell=True, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in p.stdout:
        print(line, end='')
    if p.wait():
        raise RuntimeError(f'command failed ({p.returncode}): {cmd}')
""")

code(r"""
# ---------------------------------------------------------------- install (uv)
REPO = LOCAL / 'flood-forecasting'
if not REPO.exists():
    sh(f'git clone --depth 1 https://github.com/google-research/flood-forecasting {REPO}')
sh('pip install uv')
sh(f'uv pip install --system -e {REPO}')
sh('uv pip install --system gcsfs zarr xarray netCDF4 pandas')
import importlib; importlib.invalidate_caches()
import googlehydrology
print('googlehydrology', getattr(googlehydrology, '__version__', '?'))

PRE = REPO / 'pretrained-models' / 'google-floodhub-settings-110-epochs'
assert (PRE / f'model_epoch{EPOCH:03d}.pt').exists() or (PRE / f'model_epoch{EPOCH}.pt').exists(), 'pretrained weights missing'
RUN = ROOT / 'run_floodhub_110'          # our copy of the run (config is rewritten below)
if not RUN.exists():
    shutil.copytree(PRE, RUN)
print('pretrained run ->', RUN)
""")

code(r"""
# ---------------------------------------------------------------- Caravan (static attributes + observed streamflow)
import urllib.request
CARAVAN = ROOT / 'Caravan'
if not (CARAVAN / 'attributes').exists():
    rec = json.load(urllib.request.urlopen('https://zenodo.org/api/records/6522634'))
    latest = json.load(urllib.request.urlopen(rec['links']['latest']))
    files = {f['key']: f['links']['self'] for f in latest['files']}
    print('Zenodo files:', list(files))
    key = next(k for k in files if k.lower().startswith('caravan') and (k.endswith('.tar.gz') or k.endswith('.zip')) and 'csv' not in k.lower())
    arc = ROOT / key
    if not arc.exists():
        sh(f'wget -c -O "{arc}" "{files[key]}"')
    sh(f'mkdir -p "{LOCAL}/caravan_x" && ' + (f'tar -xzf "{arc}" -C "{LOCAL}/caravan_x"' if key.endswith('.tar.gz') else f'unzip -o "{arc}" -d "{LOCAL}/caravan_x"'))
    top = next(p for p in (LOCAL / 'caravan_x').rglob('attributes') if p.is_dir()).parent
    shutil.copytree(top, CARAVAN)
print('Caravan at', CARAVAN, sorted(p.name for p in CARAVAN.iterdir()))
""")

code(r"""
# ---------------------------------------------------------------- pick gauges near each site
import pandas as pd
other = pd.concat([pd.read_csv(f) for f in glob.glob(str(CARAVAN / 'attributes' / '*' / 'attributes_other_*.csv'))])
other = other.set_index('gauge_id')
allowed = set((REPO / 'example-configs' / 'multimet-basins-list-without-chirps.txt').read_text().split())
other = other[other.index.isin(allowed)]
def km(lon1, lat1, lon2, lat2):
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))
picked = {}
for sid, (lon, lat) in SITES.items():
    d = other.apply(lambda r: km(lon, lat, r.gauge_lon, r.gauge_lat), axis=1).sort_values()
    d = d[d <= MAX_KM].head(PER_SITE)
    picked[sid] = [(g, round(float(v), 1)) for g, v in d.items()]
    print(f'{sid:12s}', picked[sid] if picked[sid] else f'no Caravan gauge within {MAX_KM} km')
if SMOKE:
    first = next(s for s in picked if picked[s]); picked = {first: picked[first][:1]}
basins = sorted({g for v in picked.values() for g, _ in v})
(ROOT / 'site_basins.txt').write_text('\n'.join(basins) + '\n')
print(len(basins), 'gauges')
""")

code(r"""
# ---------------------------------------------------------------- inference config (out-of-sample window)
import yaml, xarray as xr
cfg = yaml.safe_load((RUN / 'config.yml').read_text())
if END is None:   # last date every hindcast product has
    ends = []
    for prod in ('HRES', 'GRAPHCAST', 'IMERG', 'CPC'):
        ds = xr.open_zarr(f'gs://caravan-multimet/v1.1/{prod}/timeseries.zarr', storage_options={'token': 'anon'})
        ends.append(pd.Timestamp(ds['date'].values[-1]))
    END = (min(ends) - pd.Timedelta(days=8)).strftime('%d/%m/%Y')   # leave room for the 7-day lead
print('out-of-sample window:', START, '->', END)
cfg.update({
    'run_dir': str(RUN), 'img_log_dir': str(RUN / 'img_log'), 'train_dir': str(RUN / 'train_data'),
    'statics_data_dir': str(CARAVAN), 'targets_data_dir': str(CARAVAN),
    'test_basin_file': str(ROOT / 'site_basins.txt'),
    'test_start_date': START, 'test_end_date': END,
    'device': 'cuda:0' if __import__('torch').cuda.is_available() else 'cpu',
    'num_workers': 2,
})
INF = ROOT / 'infer_config.yml'
INF.write_text(yaml.safe_dump(cfg))
""")

code(r"""
# ---------------------------------------------------------------- run (skipped if results exist)
out_dir = RUN / 'test' / f'model_epoch{EPOCH:03d}'
res = list(out_dir.glob('test_results*.zarr')) if out_dir.exists() else []
if not res:
    sh(f'run infer --run-dir "{RUN}" --config-file "{INF}" --epoch {EPOCH} --period test')
    res = list(out_dir.glob('test_results*.zarr'))
print('results:', res)
""")

code(r"""
# ---------------------------------------------------------------- skill + export
import numpy as np
ds = xr.open_zarr(res[0], consolidated=False)
print(ds)
def nse(o, s):
    m = np.isfinite(o) & np.isfinite(s)
    return float(1 - ((o[m] - s[m]) ** 2).sum() / ((o[m] - o[m].mean()) ** 2).sum()) if m.sum() > 30 else None
def kge(o, s):
    m = np.isfinite(o) & np.isfinite(s)
    if m.sum() <= 30: return None
    o, s = o[m], s[m]; r = np.corrcoef(o, s)[0, 1]
    return float(1 - math.sqrt((r - 1) ** 2 + (s.std() / o.std() - 1) ** 2 + (s.mean() / o.mean() - 1) ** 2))
sel = ds.sel(freq=ds.freq.values[0]) if 'freq' in ds.dims else ds
out = {'model': 'Google Flood Hub Mean-Embedding Forecast LSTM (OpenHydroNet, pretrained 110 epochs)',
       'source': 'https://github.com/google-research/flood-forecasting', 'window': [START, END],
       'note': 'Out-of-sample in time: the released weights were trained on 1982-01-01..2023-09-30.', 'sites': {}}
for sid, gauges in picked.items():
    rows = []
    for g, dist in gauges:
        if g not in sel.basin.values: continue
        b = sel.sel(basin=g)
        obs = b['streamflow_obs'].values; sim = b['streamflow_sim'].values   # (date, time_step = lead)
        dates = pd.to_datetime(b['date'].values)
        lead1 = sim[:, 0] if sim.ndim == 2 else sim
        o1 = obs[:, 0] if obs.ndim == 2 else obs
        skill = {f'lead{k + 1}': {'nse': nse(o1 if k == 0 else obs[:, k], sim[:, k]), 'kge': kge(o1 if k == 0 else obs[:, k], sim[:, k])}
                 for k in range(sim.shape[1] if sim.ndim == 2 else 1)}
        r = other.loc[g]
        rows.append({'gauge': g, 'name': str(r.get('gauge_name', g)), 'lon': float(r.gauge_lon), 'lat': float(r.gauge_lat),
                     'distKm': dist, 'areaKm2': float(r.get('area', np.nan)) if 'area' in r else None,
                     'dates': [d.strftime('%Y-%m-%d') for d in dates],
                     'obs': [None if not np.isfinite(v) else round(float(v), 3) for v in o1],
                     'sim': [None if not np.isfinite(v) else round(float(v), 3) for v in lead1],
                     'skill': skill, 'unit': 'mm/day'})
        print(f'{sid:12s} {g:22s} {dist:6.1f} km  NSE(lead1) {skill["lead1"]["nse"]}')
    out['sites'][sid] = rows
(ROOT / 'flood_lstm.json').write_text(json.dumps(out))
print('wrote', ROOT / 'flood_lstm.json', '-> copy it to web/public/data/flood_lstm.json')
""")

nb = nbf.v4.new_notebook(cells=C, metadata={'accelerator': 'GPU', 'colab': {'gpuType': 'T4'}, 'kernelspec': {'name': 'python3', 'display_name': 'Python 3'}})
p = Path(__file__).resolve().parent / 'notebooks' / '05_Google_FloodHub_LSTM.ipynb'
nbf.write(nb, p)
print('wrote', p)
