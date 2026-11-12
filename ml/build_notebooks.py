#!/usr/bin/env python3
"""Assemble the Colab notebooks from the shared cell sources in ml/cells/.

Every notebook is built from the same data, training and transfer cells, so the
comparison between models is fair: only the model cell differs.

    python ml/build_notebooks.py            # writes ml/notebooks/*.ipynb
"""
import re
from pathlib import Path

import nbformat as nbf

HERE = Path(__file__).resolve().parent
CELLS = HERE / 'cells'
OUT = HERE / 'notebooks'

INTRO = {
    'umamba': """# U-Mamba · SAR + optical time series → plantation locations, crop type, yield
**Notebook 1 of 2 in the U-Mamba vs SITSMamba comparison** (plus an optional pretrained U-TAE baseline and a comparison notebook).

| Stage | Dataset | Inputs | Predicts |
|---|---|---|---|
| 1 | **PASTIS-R** (France, 2,433 patches) | Sentinel-1 SAR (asc + desc) + Sentinel-2 time series | crop type (18 classes), field extent, boundaries → individual fields |
| 2 | **YieldSAT** (4 countries, 2,173 fields) | Sentinel-2 + weather + soil + terrain | **yield (t/ha)**, crop type, field extent |

Stage 2 starts from the stage-1 weights (band-by-band input transfer, new static and yield branches).
Run the cells from top to bottom. Everything is saved to `MyDrive/sar_crop_ml/`, and re-running after a disconnect resumes where training stopped.
Recommended runtime: **A100 / H100 / L4 GPU, High-RAM**.""",
    'sitsmamba': """# SITSMamba · SAR + optical time series → plantation locations, crop type, yield
**Notebook 2 of 2 in the U-Mamba vs SITSMamba comparison**. Same data, splits, tasks, losses and metrics as notebook 1; only the model differs.

| Stage | Dataset | Inputs | Predicts |
|---|---|---|---|
| 1 | **PASTIS-R** (France, 2,433 patches) | Sentinel-1 SAR (asc + desc) + Sentinel-2 time series | crop type (18 classes), field extent, boundaries → individual fields |
| 2 | **YieldSAT** (4 countries, 2,173 fields) | Sentinel-2 + weather + soil + terrain | **yield (t/ha)**, crop type, field extent |

Stage 2 starts from the stage-1 weights. Everything is saved to `MyDrive/sar_crop_ml/`, and re-running resumes.
Recommended runtime: **A100 / H100 / L4 GPU, High-RAM**.""",
    'utae': """# Pretrained baseline · U-TAE (weights published for PASTIS) → fine-tune with SAR, then transfer to YieldSAT
[U-TAE](https://github.com/VSainteuf/utae-paps) (Sainte Fare Garnot & Landrieu, ICCV 2021) is the reference model of the PASTIS benchmark; its authors publish trained weights for all 5 folds (Sentinel-2 only, 20 classes, mIoU 63.1 %).
This notebook **starts from those weights** instead of from scratch:
1. **PASTIS-R**: the pretrained optical U-TAE is kept, and a parallel SAR U-TAE branch (fresh) is fused into it through a zero-initialised layer, with heads for field extent, boundary and distance. Everything is fine-tuned.
2. **YieldSAT**: the same transfer as the Mamba notebooks (band remap 10 → 12 S2 bands + weather, static branch, crop and yield heads).

It uses the same data cells, splits, metrics and Drive layout as the two Mamba notebooks, so its results drop straight into the comparison.""",
    'compare': """# Comparison · U-Mamba vs SITSMamba (vs pretrained U-TAE)
Reads every finished run from `MyDrive/sar_crop_ml/runs/` and writes a comparison table, learning curves and per-class scores to `MyDrive/sar_crop_ml/reports/`. Safe to run at any time, including while runs are still going (it uses whatever is saved).""",
}

SUMMARY = """# %% [md]
# ## 9 · Where everything is saved

# %%
for stage in ('pastis', 'yieldsat'):
    for d in sorted((P['runs'] / MODEL_NAME / stage).glob('*')):
        files = sorted(p.relative_to(d).as_posix() for p in d.rglob('*') if p.is_file())
        print(f'{d}:'); [print('   ', f) for f in files[:20]]
"""

NOTEBOOKS = {
    '01_UMamba_PASTIS-R_to_YieldSAT.ipynb': ('umamba', ['00_setup', '01_mamba', '02_data_pastis', '03_data_yieldsat', '04_model_common', '05_model_umamba', '06_train', '07_stage_pastis', '08_stage_yieldsat', SUMMARY]),
    '02_SITSMamba_PASTIS-R_to_YieldSAT.ipynb': ('sitsmamba', ['00_setup', '01_mamba', '02_data_pastis', '03_data_yieldsat', '04_model_common', '05_model_sitsmamba', '06_train', '07_stage_pastis', '08_stage_yieldsat', SUMMARY]),
    '03_UTAE_pretrained_PASTIS-R_to_YieldSAT.ipynb': ('utae', ['00_setup', '02_data_pastis', '03_data_yieldsat', '04_model_common', '05_model_utae', '06_train', '07_stage_pastis', '08_stage_yieldsat', SUMMARY]),
    '04_Compare_models.ipynb': ('compare', ['00_setup', '02_data_pastis', '10_compare']),
}


def split_cells(src: str):
    """Split '# %%' / '# %% [md]' delimited source into (kind, text) cells."""
    cells, kind, buf = [], None, []
    for line in src.splitlines():
        m = re.match(r'^# %%( \[md\])?\s*$', line)
        if m:
            if kind is not None: cells.append((kind, '\n'.join(buf).strip('\n')))
            kind, buf = ('md' if m.group(1) else 'code'), []
        else:
            buf.append(line)
    if kind is not None: cells.append((kind, '\n'.join(buf).strip('\n')))
    out = []
    for k, t in cells:
        if k == 'md':
            t = '\n'.join(l[2:] if l.startswith('# ') else ('' if l == '#' else l) for l in t.splitlines())
        out.append((k, t))
    return out


def build():
    OUT.mkdir(exist_ok=True)
    for name, (intro, parts) in NOTEBOOKS.items():
        nb = nbf.v4.new_notebook()
        nb.metadata = {'accelerator': 'GPU', 'colab': {'gpuType': 'A100', 'machine_shape': 'hm', 'provenance': []},
                       'kernelspec': {'display_name': 'Python 3', 'name': 'python3'}, 'language_info': {'name': 'python'}}
        nb.cells.append(nbf.v4.new_markdown_cell(INTRO[intro]))
        for part in parts:
            src = part if '\n' in part else (CELLS / f'{part}.py').read_text()
            for kind, text in split_cells(src):
                if text.strip():
                    nb.cells.append(nbf.v4.new_markdown_cell(text) if kind == 'md' else nbf.v4.new_code_cell(text))
        nbf.write(nb, OUT / name)
        print('wrote', OUT / name, f'({len(nb.cells)} cells)')


if __name__ == '__main__':
    build()
