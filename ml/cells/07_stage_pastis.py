# %% [md]
# ## 7 · Stage 1: train on PASTIS-R (crop type + field delineation, SAR + optical)
# Official 5-fold protocol: test fold `k`, validation fold `k+1`, train on the other three. Set `PASTIS_FOLDS = [1, 2, 3, 4, 5]` for the full cross-validation (each fold is its own resumable run).
#
# Downloading and preprocessing happen once. The 54 GB zip is kept in Drive, and the preprocessed patches stay on the local SSD (or on Drive with `CACHE_PASTIS_ON_DRIVE`).

# %%
PASTIS_FOLDS = [1]
PASTIS_EPOCHS = 2 if SMOKE else DEFAULT_EPOCHS['pastis']
PASTIS_BATCH = 2 if SMOKE else DEFAULT_BATCH['pastis']
PASTIS_LR = DEFAULT_LR['pastis']

pastis_cache, pastis_folds = prepare_pastis()
print(len(pastis_folds), 'patches cached in', pastis_cache)


def rgb_from(x, bands, names=('B04', 'B03', 'B02')):
    idx = [bands.index(n) for n in names]
    t = x.shape[0] // 2
    img = x[t, idx].transpose(1, 2, 0)
    return np.clip((img - np.percentile(img, 2)) / (np.percentile(img, 98) - np.percentile(img, 2) + 1e-6), 0, 1)


@torch.no_grad()
def pastis_samples(model, ds, path, n=4):
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    model.eval()
    n = max(1, min(n, len(ds)))
    cmap = plt.get_cmap('tab20', 20)
    fig, ax = plt.subplots(n, 5, figsize=(15, 3 * n), squeeze=False)
    for r in range(n):
        b = ds[r * len(ds) // n]
        bb = to_device({k: (v[None] if torch.is_tensor(v) else v) for k, v in b.items()})
        with amp_ctx():
            o = {k: v.float() for k, v in model(bb).items()}
        x = b['x'].numpy()
        panels = [(rgb_from(x, PASTIS_DYN), None, 'Sentinel-2 RGB (mid-season)'),
                  (np.where(b['sem'].numpy() == 255, 19, b['sem'].numpy()), cmap, 'crop type: truth'),
                  (o['sem'][0].argmax(0).cpu().numpy(), cmap, 'crop type: predicted'),
                  (torch.sigmoid(o['extent'][0, 0]).cpu().numpy(), 'viridis', 'field extent'),
                  (torch.sigmoid(o['boundary'][0, 0]).cpu().numpy(), 'magma', 'field boundaries')]
        for c, (img, cm, title) in enumerate(panels):
            ax[r, c].imshow(img, cmap=cm, vmin=0 if cm is cmap else None, vmax=19 if cm is cmap else None, interpolation='nearest')
            ax[r, c].set_axis_off()
            if r == 0: ax[r, c].set_title(title, fontsize=10)
    plt.tight_layout(); fig.savefig(path, dpi=90); plt.close(fig)


def fields_from_prediction(out, thr=0.5):
    """Plantation locations as individual fields: watershed on the distance map inside the predicted extent."""
    from skimage.segmentation import watershed
    from skimage.measure import label
    ext = torch.sigmoid(out['extent'][0, 0]).cpu().numpy() > thr
    dist = torch.sigmoid(out['dist'][0, 0]).cpu().numpy()
    markers = label((dist > 0.5) & ext)
    return watershed(-dist, markers, mask=ext)


pastis_results = {}
for fold in PASTIS_FOLDS:
    tr, va, te = pastis_fold_split(pastis_folds, fold)
    cfg = dict(model=MODEL_NAME, stage='pastis', fold=fold, epochs=PASTIS_EPOCHS, batch=PASTIS_BATCH, lr=PASTIS_LR,
               grid=PASTIS_GRID, bands=PASTIS_DYN, tasks=PASTIS_TASKS, loss_w=PASTIS_LOSS_W, n_train=len(tr), n_val=len(va), n_test=len(te))
    run = Run('pastis', f'fold{fold}', cfg)
    model = build_model(PASTIS_DYN, [], PASTIS_TASKS)
    run.log(f'{MODEL_NAME}: {count_params(model) / 1e6:.2f} M parameters · train {len(tr)} / val {len(va)} / test {len(te)} patches')
    mfn = lambda: Metrics(n_sem=len(PASTIS_CLASSES), ignore_sem=(PASTIS_VOID,))
    fit(model, run, PastisDS(pastis_cache, tr, train=True, seed=fold), PastisDS(pastis_cache, va),
        phases=[dict(epochs=PASTIS_EPOCHS, lr=PASTIS_LR)], batch_size=PASTIS_BATCH, loss_w=PASTIS_LOSS_W,
        metrics_fn=mfn, monitor='mIoU', mode='max', patience=None if SMOKE else 25,
        extra_losses=MODEL_EXTRA_LOSSES_FN(PASTIS_DYN), sample_fn=pastis_samples, seed=fold)
    pastis_results[fold] = test_run(model, run, PastisDS(pastis_cache, te), mfn, PASTIS_BATCH, sample_fn=pastis_samples)
print(json.dumps({k: {m: v[m] for m in ('mIoU', 'OA', 'extent_IoU', 'boundary_F1') if m in v} for k, v in pastis_results.items()}, indent=1))
