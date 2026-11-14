# %% [md]
# ## 0 · Setup
# Mounts Google Drive, creates the shared folder layout and installs the packages.
#
# **All notebooks use the same Drive layout** (`MyDrive/sar_crop_ml/`):
#
# | Folder | Contents |
# |---|---|
# | `data/raw/` | downloaded archives: `PASTIS-R.zip`; YieldSAT files go in `data/raw/yieldsat/` |
# | `data/cache/` | preprocessed tensors (reused by every notebook) |
# | `data/splits/` | fold assignments (identical for every model) |
# | `weights/pretrained/` | third-party weights (U-TAE) |
# | `runs/<model>/<dataset>/<run>/` | `config.json`, `checkpoints/last.pt` + `best.pt`, `metrics.csv`, `log.txt`, `test_metrics.json`, sample predictions, environment info |
#
# A run that stops (time-out, disconnect, or a `STOP` file you create in its folder) resumes from `last.pt` when you re-run the same cell, including in the middle of an epoch.

# %%
import os, sys, json, time, math, shutil, subprocess, glob, random, hashlib, platform, re, zipfile, datetime as dt
from pathlib import Path

SMOKE = os.environ.get('SARCROP_SMOKE') == '1'          # tiny synthetic run used to test these notebooks
IN_COLAB = 'google.colab' in sys.modules
if IN_COLAB and not SMOKE:
    from google.colab import drive
    drive.mount('/content/drive')

DRIVE_ROOT = Path(os.environ.get('SARCROP_ROOT', '/content/drive/MyDrive/sar_crop_ml' if IN_COLAB else './sar_crop_ml')).resolve()
LOCAL_ROOT = Path(os.environ.get('SARCROP_LOCAL', '/content/sar_crop_local' if IN_COLAB else './sar_crop_local')).resolve()
P = dict(
    raw=DRIVE_ROOT / 'data/raw', cache=DRIVE_ROOT / 'data/cache', splits=DRIVE_ROOT / 'data/splits',
    weights=DRIVE_ROOT / 'weights', runs=DRIVE_ROOT / 'runs', reports=DRIVE_ROOT / 'reports',
    local=LOCAL_ROOT,  # fast local SSD: extracted data and training cache live here during a session
)
for p in P.values():
    p.mkdir(parents=True, exist_ok=True)
print('Drive root :', DRIVE_ROOT)
print('Local root :', LOCAL_ROOT)

def sh(cmd, check=True, timeout=None, log=None):
    """Run a shell command, streaming its full output live (and to `log` if given)."""
    print('$', cmd, flush=True)
    t0 = time.time()
    lf = open(log, 'a') if log else None
    p = subprocess.Popen(cmd, shell=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=1)
    tail = []
    for line in p.stdout:
        print(line, end='', flush=True)
        if lf: lf.write(line)
        tail = (tail + [line])[-300:]
        if timeout and time.time() - t0 > timeout:
            p.kill(); print(f'[timeout after {timeout}s]'); break
    rc = p.wait()
    if lf: lf.close()
    if rc:
        print(f'[exit code {rc}]', flush=True)
        if check: raise RuntimeError(''.join(tail[-40:]))
    return rc


def pip_install(spec, extra='', timeout=None, log=None):
    """Install with uv; falls back to pip only if uv cannot be set up."""
    if shutil.which('uv') is None:
        sh('pip install uv', check=False)
    tool = 'uv pip install --system' if shutil.which('uv') else 'pip install'
    return sh(f'{tool} {spec} {extra}', check=False, timeout=timeout, log=log)

if not SMOKE:
    pip_install('xarray netCDF4 h5netcdf scikit-image einops pandas matplotlib')

# %%
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F, torch.utils.checkpoint
DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
GPU = torch.cuda.get_device_name(0) if DEVICE == 'cuda' else 'cpu'
BF16 = DEVICE == 'cuda' and torch.cuda.is_bf16_supported()
GPU_MEM_GB = torch.cuda.get_device_properties(0).total_memory / 1e9 if DEVICE == 'cuda' else 0
print(f'torch {torch.__version__} · device {GPU} · {GPU_MEM_GB:.0f} GB · bf16={BF16}')
torch.backends.cudnn.benchmark = True
if DEVICE == 'cuda':
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
