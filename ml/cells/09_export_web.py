# %% [md]
# ## 9 · Export for the website
# Turns the best checkpoints of this notebook into ONNX models the website runs in the browser
# (Crops & yield → Crop types). For every finished run (PASTIS-R and YieldSAT stages) it writes
# `<model>_<stage>.onnx` + `<model>_<stage>.json` (bands, normalisation, time grid, classes, yield scaling)
# to `MyDrive/sar_crop_ml/exports/web/`. Copy that folder's files to `web/public/models/` in the repository
# (or send them): the site lists them automatically.

# %%
import glob, subprocess
EXPORT_DIR = P['root'] / 'exports' / 'web' if 'root' in P else P['runs'].parent / 'exports' / 'web'
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
# the exporter and the model cells are embedded in this notebook when it is built (no download needed)
EMBEDDED = __EMBEDDED_FILES__
(P['local'] / 'cells').mkdir(parents=True, exist_ok=True)
for rel, text in EMBEDDED.items():
    (P['local'] / rel).write_text(text)
pip_install('onnx onnxruntime')
norm_pastis = next(iter(glob.glob(str(P['local'] / 'cache' / 'pastis_T*' / 'norm.json')) + glob.glob(str(P['cache'] / 'pastis_T*' / 'norm.json'))), None)
norm_ys = next(iter(glob.glob(str(P['local'] / 'cache' / 'yieldsat' / 'meta.json')) + glob.glob(str(P['cache'] / 'yieldsat' / 'meta.json'))), None)
for stage, norm in (('pastis', norm_pastis), ('yieldsat', norm_ys)):
    runs = sorted((P['runs'] / MODEL_NAME / stage).glob('*/checkpoints/best.pt'))
    if not runs or not norm:
        print(f'{stage}: no finished run or no normalisation file yet'); continue
    best = runs[0]   # first fold; change the index to export another run
    print(f'exporting {best}')
    sh(f'cd "{P["local"]}" && python export_mamba_onnx.py --ckpt "{best}" --norm "{norm}" --out "{EXPORT_DIR}" --tile {64 if MODEL_NAME == "umamba" else 32}')
print('files for the website:', sorted(p.name for p in EXPORT_DIR.iterdir()))
