#!/usr/bin/env python3
"""Export a trained U-Mamba or SITSMamba checkpoint (notebooks 01 / 02) to ONNX for the website.

    python ml/export_mamba_onnx.py --ckpt <run>/best.pt --norm <cache>/norm.json  [--out web/public/models] [--tile 64]

* --ckpt  best.pt (or last.pt) written by the notebooks: {'model': state_dict, 'cfg': {...}}. The cfg holds the
          model name, stage (pastis / yieldsat), bands, static bands, tasks, grid and crop names.
* --norm  the normalisation the data were prepared with:
          PASTIS stage   -> <local or Drive cache>/pastis_T24x18/norm.json   ({"S2": [mean[10], std[10]], "S1A": …, "S1D": …})
          YieldSAT stage -> <cache>/yieldsat/meta.json                        ({"norm": {band: [mean, std]}, …, "__yield__": [mean, std]})

The models are rebuilt from the notebook cells (ml/cells/01_mamba, 04_model_common, 05_model_<name>), so the
parameter names always match; the pure-PyTorch Mamba (same parameters as mamba_ssm) is used for the export.
Outputs <name>_<stage>.onnx and <name>_<stage>.json (inputs, bands, normalisation, grid, tasks and class names),
and adds the model to <out>/index.json so the website lists it.
"""
import argparse
import json
import math
import os
import re
import sys
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F

ML = Path(__file__).resolve().parent
PASTIS_CLASSES = ['Background', 'Meadow', 'Soft winter wheat', 'Corn', 'Winter barley', 'Winter rapeseed', 'Spring barley',
                  'Sunflower', 'Grapevine', 'Beet', 'Winter triticale', 'Winter durum wheat', 'Fruits, vegetables, flowers',
                  'Potatoes', 'Leguminous fodder', 'Soybeans', 'Orchard', 'Mixed cereal', 'Sorghum', 'Void label']


def cell_source(name):
    """Code of a notebook cell file without the markdown blocks."""
    out = []
    for block in re.split(r'^# %%', (ML / 'cells' / name).read_text(), flags=re.M):
        if block.startswith(' [md]'):
            continue
        out.append(block)
    return '\n'.join(out)


def load_models(model_name):
    ns = dict(torch=torch, nn=nn, F=F, math=math, os=os, sys=sys, re=re, SMOKE=False, DEVICE='cpu', GPU_MEM_GB=0,
              P={'local': Path('/tmp'), 'weights': Path('/tmp')}, pip_install=lambda *a, **k: 1, sh=lambda *a, **k: 1, print=lambda *a, **k: None)
    for f in ('01_mamba.py', '04_model_common.py', f'05_model_{model_name}.py'):
        exec(compile(cell_source(f), f, 'exec'), ns)
    # export with a scripted step-by-step scan: one ONNX Loop node, any sequence length (same maths as training)
    ns['_scan_lean'] = scan_loop
    ns['_scan'] = scan_loop
    return ns


@torch.jit.script
def scan_loop(u: torch.Tensor, delta: torch.Tensor, A: torch.Tensor, B: torch.Tensor, C: torch.Tensor, D: torch.Tensor) -> torch.Tensor:
    b, l, d = u.shape[0], u.shape[1], u.shape[2]
    h = torch.zeros(b, d, A.shape[1], dtype=u.dtype, device=u.device)
    ys = []
    for t in range(l):
        h = torch.exp(delta[:, t, :].unsqueeze(-1) * A) * h + (delta[:, t] * u[:, t]).unsqueeze(-1) * B[:, t].unsqueeze(1)
        ys.append((h * C[:, t].unsqueeze(1)).sum(-1))
    return torch.stack(ys, 1) + u * D


class Wrapper(nn.Module):
    """Flat inputs for ONNX: x (1,T,C,H,W) float, days (1,T) float, tmask (1,T) float (1 = observed), static (1,S,H,W)."""
    def __init__(self, model, tasks, has_static):
        super().__init__()
        self.m, self.tasks, self.has_static = model, list(tasks), has_static

    def forward(self, x, days, tmask, static=None):
        batch = {'x': x, 'days': days, 'tmask': tmask > 0.5}
        if self.has_static:
            batch['static'] = static
        out = self.m(batch)
        return tuple(out[k] for k in self.tasks)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ckpt', required=True)
    ap.add_argument('--norm', required=True)
    ap.add_argument('--out', default=str(ML.parent / 'web' / 'public' / 'models'))
    ap.add_argument('--tile', type=int, default=64, help='spatial tile the browser runs (multiple of 16)')
    a = ap.parse_args()
    try:
        ck = torch.load(a.ckpt, map_location='cpu', weights_only=True)
    except Exception:
        ck = torch.load(a.ckpt, map_location='cpu', weights_only=False)   # your own checkpoint (it also stores RNG states)
    cfg = ck.get('cfg') or {}
    name, stage = cfg.get('model'), cfg.get('stage')
    assert name in ('umamba', 'sitsmamba'), f'unknown model in cfg: {name}'
    tasks = dict(cfg['tasks'])
    norm_js = json.loads(Path(a.norm).read_text())
    if stage == 'pastis':
        dyn, static = list(cfg['bands']), []
        S2 = ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12']
        mean = {b: norm_js['S2'][0][i] for i, b in enumerate(S2)}; std = {b: norm_js['S2'][1][i] for i, b in enumerate(S2)}
        grid = cfg.get('grid', {'start': '2018-09-01', 'steps': 24, 'step_days': 18})
        classes = {'sem': PASTIS_CLASSES}
        target = None
    else:
        dyn, static = list(cfg.get('dyn') or cfg.get('bands')), list(cfg.get('static') or [])
        nm = norm_js.get('norm', norm_js)
        mean = {b: v[0] for b, v in nm.items()}; std = {b: v[1] for b, v in nm.items()}
        grid = cfg.get('grid', {'start': None, 'steps': 24, 'step_days': 30})
        classes = {'crop': list(cfg.get('crops') or norm_js.get('crops') or [])}
        target = {'yld': {'mean': nm.get('__yield__', [0, 1])[0], 'std': nm.get('__yield__', [0, 1])[1], 'unit': 't/ha'}}
    ns = load_models(name)
    model = ns['build_model'](dyn, static, tasks).eval()
    sd = ck['model']
    missing, unexpected = model.load_state_dict(sd, strict=False)
    print(f'{name} / {stage}: {len(sd)} tensors · missing {list(missing)[:8]} · unexpected {list(unexpected)[:8]}')
    assert not missing, 'checkpoint does not match the model built from the notebook cells'
    T, C, S, H = int(grid['steps']), len(dyn), len(static), a.tile
    w = Wrapper(model, tasks, bool(static)).eval()
    x, days = torch.randn(1, T, C, H, H), torch.arange(T, dtype=torch.float32)[None] * float(grid['step_days']) + grid['step_days'] / 2
    tm, st = torch.ones(1, T), torch.randn(1, max(S, 1), H, H)
    args = (x, days, tm, st) if static else (x, days, tm)
    with torch.no_grad():
        ref = w(*args)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    base = f'{name}_{stage}'
    names_in = ['x', 'days', 'tmask'] + (['static'] if static else [])
    dyn_ax = {'x': {3: 'H', 4: 'W'}, **({'static': {2: 'H', 3: 'W'}} if static else {})}
    for k in tasks: dyn_ax[k] = {2: 'H', 3: 'W'}
    torch.onnx.export(w, args, out / f'{base}.onnx', input_names=names_in, output_names=list(tasks), opset_version=17, dynamic_axes=dyn_ax, dynamo=False)
    try:
        import numpy as np
        import onnxruntime as ort
        sess = ort.InferenceSession(str(out / f'{base}.onnx'))
        got = sess.run(None, {n: v.numpy() for n, v in zip(names_in, args)})
        print('onnx vs torch max |diff|:', max(float(np.abs(g - r.numpy()).max()) for g, r in zip(got, ref)))
    except ImportError:
        print('onnxruntime not installed: skipped the check')
    meta = {'id': base, 'model': name, 'stage': stage, 'label': f"{'U-Mamba' if name == 'umamba' else 'SITSMamba'} ({'PASTIS-R' if stage == 'pastis' else 'YieldSAT'}, your weights)",
            'inputs': names_in, 'bands': dyn, 'static': static, 'mean': mean, 'std': std, 'grid': grid, 'tile': H, 'gsd_m': 10,
            'tasks': tasks, 'classes': classes, 'target': target, 'metrics': ck.get('metrics'), 'fold': cfg.get('fold')}
    (out / f'{base}.json').write_text(json.dumps(meta, indent=1))
    idx_p = out / 'index.json'
    idx = json.loads(idx_p.read_text()) if idx_p.exists() else {'models': [{'id': 'utae_pastis', 'label': 'U-TAE (PASTIS, published weights)', 'meta': 'utae_pastis.json'}]}
    idx['models'] = [m for m in idx['models'] if m['id'] != base] + [{'id': base, 'label': meta['label'], 'meta': f'{base}.json'}]
    idx_p.write_text(json.dumps(idx, indent=1))
    print('wrote', out / f'{base}.onnx', f'{(out / f"{base}.onnx").stat().st_size / 1e6:.1f} MB', '+ meta + index.json')


if __name__ == '__main__':
    main()
