# %% [md]
# ## 8 · Stage 2: transfer to YieldSAT (yield = efficiency, crop type, field extent)
# The best PASTIS-R checkpoint of this model is loaded and **adapted**:
# 1. input layer: 10 shared Sentinel-2 bands copied by name; `B01`, `B09`, weather and the observation flag added (zero-initialised); SAR columns dropped;
# 2. new static branch for soil and terrain (zero-initialised, so it starts neutral);
# 3. heads: `extent` transferred as is; `crop` initialised from the matching PASTIS crop rows; `yld` (yield regression) is new.
#
# Training then has two phases: **(a)** backbone frozen, so only the new parts learn; **(b)** everything unfrozen, with a lower learning rate on the backbone.
# Set `TRANSFER_FROM_PASTIS = False` to train the same architecture from scratch and measure what the transfer is worth.

# %%
TRANSFER_FROM_PASTIS = True
YS_FOLDS = [1]
YS_EPOCHS = (1, 1) if SMOKE else DEFAULT_EPOCHS['yieldsat']      # (frozen, unfrozen) when transferring
YS_BATCH = 4 if SMOKE else DEFAULT_BATCH['yieldsat']
YS_LR = DEFAULT_LR['yieldsat']
SOURCE_PASTIS_FOLD = PASTIS_FOLDS[0] if 'PASTIS_FOLDS' in globals() else 1

ys_cache, ys_meta = prepare_yieldsat()
ys_folds = yieldsat_folds(ys_meta)
YS_DYN, YS_STATIC = yieldsat_dyn_bands(ys_meta), list(ys_meta['static'])
YS_TASKS = {'crop': len(ys_meta['crops']), 'extent': 1, 'yld': 1}
print(f"{len(ys_meta['fields'])} fields · crops {ys_meta['crops']} · {len(YS_DYN)} dynamic + {len(YS_STATIC)} static bands")


@torch.no_grad()
def yield_samples(model, ds, path, n=4):
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    model.eval()
    n = max(1, min(n, len(ds)))
    fig, ax = plt.subplots(n, 4, figsize=(13, 3.2 * n), squeeze=False)
    ym, ys = ds.ym, ds.ys
    for r in range(n):
        b = ds[r * len(ds) // n]
        bb = to_device({k: (v[None] if torch.is_tensor(v) else v) for k, v in b.items()})
        with amp_ctx():
            o = {k: v.float() for k, v in model(bb).items()}
        msk = b['ymask'].numpy()
        tru = np.where(msk, b['yld'].numpy() * ys + ym, np.nan)
        pre = np.where(b['extent'].numpy() > 0, o['yld'][0, 0].cpu().numpy() * ys + ym, np.nan)
        vmin, vmax = np.nanpercentile(tru, 2), np.nanpercentile(tru, 98)
        x = b['x'].numpy()
        panels = [(rgb_from(x, YS_DYN), None, 'Sentinel-2 RGB'), (tru, 'RdYlGn', 'yield t/ha: truth'),
                  (pre, 'RdYlGn', 'yield t/ha: predicted'), (o['crop'][0].argmax(0).cpu().numpy() * (b['extent'].numpy() > 0), 'tab10', 'crop type: predicted')]
        for c, (img, cm, title) in enumerate(panels):
            im = ax[r, c].imshow(img, cmap=cm, vmin=vmin if 'yield' in title else None, vmax=vmax if 'yield' in title else None, interpolation='nearest')
            ax[r, c].set_axis_off()
            if 'yield' in title: plt.colorbar(im, ax=ax[r, c], fraction=0.046)
            if r == 0: ax[r, c].set_title(title, fontsize=10)
        ax[r, 0].text(2, 6, f"{b['id'][:40]} · {ys_meta['crops'][int(b['crop'][msk][0])] if msk.any() else ''}", color='w', fontsize=7)
    plt.tight_layout(); fig.savefig(path, dpi=90); plt.close(fig)


ys_results = {}
for fold in YS_FOLDS:
    tr, va, te = yieldsat_split(ys_meta, ys_folds, fold)
    name = f"{'transfer' if TRANSFER_FROM_PASTIS else 'scratch'}_fold{fold}"
    if TRANSFER_FROM_PASTIS:
        phases = [dict(epochs=YS_EPOCHS[0], lr=YS_LR, freeze_backbone=True), dict(epochs=YS_EPOCHS[1], lr=YS_LR * 0.3, backbone_lr_mult=0.3)]
    else:
        phases = [dict(epochs=sum(YS_EPOCHS), lr=YS_LR)]
    cfg = dict(model=MODEL_NAME, stage='yieldsat', fold=fold, transfer=TRANSFER_FROM_PASTIS, source_pastis_fold=SOURCE_PASTIS_FOLD,
               phases=phases, batch=YS_BATCH, crop_size=YS_CROP_PATCH, split_by=YS_SPLIT_BY, dyn=YS_DYN, static=YS_STATIC,
               tasks=YS_TASKS, crops=ys_meta['crops'], loss_w=YIELD_LOSS_W, n_train=len(tr), n_val=len(va), n_test=len(te))
    run = Run('yieldsat', name, cfg)
    if TRANSFER_FROM_PASTIS:
        model = build_model(PASTIS_DYN, [], PASTIS_TASKS)
        src = P['runs'] / MODEL_NAME / 'pastis' / f'fold{SOURCE_PASTIS_FOLD}' / 'checkpoints' / 'best.pt'
        if (run.dir / 'checkpoints' / 'last.pt').exists():
            run.log('resuming: architecture adapted without reloading PASTIS weights (they are inside last.pt)')
        else:
            if not src.exists():
                raise FileNotFoundError(f'{src} not found: run stage 1 first, or set TRANSFER_FROM_PASTIS = False')
            model.load_state_dict(torch.load(src, map_location='cpu', weights_only=False)['model'])
            run.log(f'loaded PASTIS weights from {src}')
        model.adapt(YS_DYN, YS_STATIC, YS_TASKS, class_map={'crop': crop_class_map(ys_meta['crops'])})
    else:
        model = build_model(YS_DYN, YS_STATIC, YS_TASKS)
    model.to(DEVICE)
    run.log(f'{MODEL_NAME}: {count_params(model) / 1e6:.2f} M parameters · train {len(tr)} / val {len(va)} / test {len(te)} fields')
    norm = tuple(ys_meta['norm']['__yield__'])
    mfn = lambda: Metrics(n_crop=len(ys_meta['crops']), yield_norm=norm)
    fit(model, run, YieldDS(ys_cache, ys_meta, tr, train=True, seed=fold), YieldDS(ys_cache, ys_meta, va),
        phases=phases, batch_size=YS_BATCH, val_batch_size=1, loss_w=YIELD_LOSS_W, metrics_fn=mfn,
        monitor='pixel_RMSE', mode='min', patience=None if SMOKE else 15,
        extra_losses=MODEL_EXTRA_LOSSES_FN(YS_DYN), sample_fn=yield_samples, seed=fold)
    ys_results[fold] = test_run(model, run, YieldDS(ys_cache, ys_meta, te), mfn, 1, sample_fn=yield_samples)
print(json.dumps({k: {m: v.get(m) for m in ('pixel_RMSE', 'pixel_R2', 'field_RMSE', 'field_R2', 'crop_field_acc', 'extent_IoU')} for k, v in ys_results.items()}, indent=1))
