# %% [md]
# ## 3 · Dataset 2: YieldSAT (yield, crop type, fields: Argentina, Brazil, Uruguay, Germany)
# [YieldSAT](https://yieldsat.github.io/) (CVPR 2026) provides 10 m combine-harvester yield maps for 2,173 fields, with Sentinel-2 (12 bands), weather, soil and topography.
#
# **Getting the data**: access is granted through the form on the project page. Put the *preprocessed (ML-ready)* release in Drive at
# `sar_crop_ml/data/raw/yieldsat/preprocessed-24-ts/<Country>/…/merge_s2-soil-dem-weather-coords.nc`. Any folder depth works; every `*.nc` file below `data/raw/yieldsat/` is picked up.
#
# The NetCDF files are pixel tables (`index × 24 time steps × 120 bands`). Fields are rebuilt as images from `row`/`col`. Bands are split by type:
# * **dynamic**: 12 Sentinel-2 bands, plus 4 weather series (field-level, repeated per pixel)
# * **static**: soil, topography and coordinates, stored once per pixel instead of 24 times (≈10× smaller cache)
#
# **Targets**: `yield` (t/ha per pixel = "efficiency"), `crop` (crop type), `extent` (pixels belonging to the field).
# YieldSAT has **no SAR**. Models trained on PASTIS-R learned to work without it, because the SAR channels are randomly dropped during training.

# %%
S2_YIELDSAT = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B11', 'B12', 'B8A']
WEATHER = ['temp_mean', 'temp_max', 'temp_min', 'total_prec']
YS_CROP_PATCH = 64                 # training crop size (fields are padded / cropped to this)
YS_SPLIT_BY = 'field'              # 'field' (paper default), 'farm' or 'year' — leakage-free grouped folds
CACHE_YIELDSAT_ON_DRIVE = True     # the field cache is ~10–15 GB; keeping it on Drive avoids rebuilding it


def make_fake_yieldsat(path, n_fields=14):
    import xarray as xr
    rng = np.random.default_rng(1)
    static = ['aspect', 'clay_0-5', 'dem', 'slope', 'twi', 'coord_x', 'coord_y', 'coord_z']
    bands = S2_YIELDSAT + static + WEATHER
    crops = ['corn', 'rapeseed', 'soybean', 'wheat']
    rows, cols, fid, crop, samples, target, times = [], [], [], [], [], [], []
    for f in range(n_fields):
        h, w = rng.integers(20, 50), rng.integers(20, 50)
        c = f % 4
        rr, cc = np.mgrid[0:h, 0:w]
        keep = rng.random((h, w)) < 0.9
        rr, cc = rr[keep], cc[keep]
        n = len(rr)
        s = np.zeros((n, 24, len(bands)), np.float32)
        s[:, :, :12] = rng.normal(0.2 + 0.05 * c, 0.05, (n, 24, 12))
        s[:, :, 12:12 + len(static)] = rng.normal(10, 2, (n, 1, len(static)))
        s[:, :, 12 + 5:12 + 8] = rng.normal(4e6, 10, (n, 1, 3))           # coordinates: large values
        s[:, :, -4:] = rng.normal(15, 5, (1, 24, 4))
        s[:, :4] = np.nan                                                  # outside growing season
        y = 3 + c + np.sin(rr / 7.0) + 0.1 * rng.normal(size=n) + 2 * s[:, 10, 7]
        rows += [rr]; cols += [cc]; fid += [np.full(n, f)]; crop += [np.full(n, c)]; samples += [s]; target += [y]
        t0 = np.datetime64('2018-09-01') + np.timedelta64(int(rng.integers(0, 30)), 'D')
        times += [np.broadcast_to(t0 + np.arange(24) * np.timedelta64(30, 'D'), (n, 24))]
    N = sum(len(r) for r in rows)
    ds = xr.Dataset(
        dict(sample=(('index', 'time_step', 'band'), np.concatenate(samples)), target=('index', np.concatenate(target).astype(np.float32)),
             row=('index', np.concatenate(rows).astype(np.uint8)), col=('index', np.concatenate(cols).astype(np.uint8)),
             field_shared_name=('index', np.concatenate(fid).astype(np.uint16)), crop=('index', np.concatenate(crop).astype(np.uint8)),
             farm_identifier=('index', (np.concatenate(fid) // 3).astype(np.uint8)), year=('index', np.full(N, 2019, np.uint16)),
             times=(('index', 'time_step'), np.concatenate(times))),
        coords=dict(index=np.arange(N), time_step=np.arange(24), band=bands))
    ds['field_shared_name'].attrs = {str(f): f'Fake_farm{f // 3}_field{f}_{crops[f % 4]}_2019' for f in range(n_fields)}
    ds['crop'].attrs = {str(i): c for i, c in enumerate(crops)}
    path.parent.mkdir(parents=True, exist_ok=True)
    ds.to_netcdf(path)


def _codes(da):
    return {int(k): str(v) for k, v in da.attrs.items() if str(k).lstrip('-').isdigit()}


def prepare_yieldsat(chunk=150_000):
    """Rebuild every field as an image tensor. Resumable: finished fields are skipped."""
    import xarray as xr
    src_dir = P['raw'] / 'yieldsat'
    if SMOKE and not list(src_dir.rglob('*.nc')):
        make_fake_yieldsat(src_dir / 'preprocessed-24-ts/Fakeland/merge_s2-soil-dem-weather-coords.nc')
    files = sorted(src_dir.rglob('*.nc'))
    if not files:
        raise FileNotFoundError(f'No YieldSAT .nc files under {src_dir}. Request access at https://yieldsat.github.io/ and copy the preprocessed release there.')
    out = P['local'] / 'cache' / 'yieldsat'
    drive_out = P['cache'] / 'yieldsat'
    out.mkdir(parents=True, exist_ok=True)
    if CACHE_YIELDSAT_ON_DRIVE and (drive_out / 'index.json').exists() and not (out / 'index.json').exists():
        sh(f'cp -r "{drive_out}/." "{out}/"')
    if (out / 'index.json').exists():
        return out, json.load(open(out / 'index.json'))

    index, stats = [], {}
    for fpath in files:
        parts = fpath.relative_to(src_dir).parts[:-1]
        country = next((p for p in reversed(parts) if p.lower() not in ('merged', 'preprocessed-24-ts', 'yieldsat')), fpath.stem)
        ds = xr.open_dataset(fpath, chunks={'index': chunk}) if _has_dask() else xr.open_dataset(fpath)
        bands = [str(b) for b in ds['band'].values]
        s2 = [b for b in S2_YIELDSAT if b in bands]
        wx = [b for b in WEATHER if b in bands]
        others = [b for b in bands if b not in s2 + wx]
        bi = {b: i for i, b in enumerate(bands)}
        # static = constant over time (checked on the first chunk); anything varying stays dynamic
        probe = ds['sample'].isel(index=slice(0, min(20000, ds.sizes['index']))).values
        def is_static(v):   # constant over time for every pixel (relative tolerance: coordinates are ~1e6)
            with np.errstate(all='ignore'):
                dev = np.nanmax(np.abs(v - np.nanmean(v, 1, keepdims=True)), initial=0)
                return dev <= 1e-5 * (np.nanmax(np.abs(v), initial=0) + 1)
        static = [b for b in others if is_static(probe[:, :, bi[b]])]
        dyn_extra = [b for b in others if b not in static]
        dyn = s2 + wx + dyn_extra
        names = _codes(ds['field_shared_name']); crops = _codes(ds['crop'])
        fid = ds['field_shared_name'].values.astype(np.int64)
        need = np.bincount(fid)
        buf = {}
        print(f'{fpath.name} [{country}]: {ds.sizes["index"]:,} pixels, {len(np.unique(fid))} fields, dyn={len(dyn)} static={len(static)}')
        for s0 in range(0, ds.sizes['index'], chunk):
            sl = slice(s0, min(ds.sizes['index'], s0 + chunk))
            part = ds.isel(index=sl)
            smp = part['sample'].values.astype(np.float32)
            cols = {k: part[k].values for k in ('row', 'col', 'field_shared_name', 'crop', 'target')}
            tim = part['times'].values if 'times' in part else None
            extra = {k: part[k].values for k in ('farm_identifier', 'year') if k in part}
            for f in np.unique(cols['field_shared_name']):
                m = cols['field_shared_name'] == f
                b = buf.setdefault(int(f), dict(rows=[], cols=[], dyn=[], st=[], y=[], crop=int(cols['crop'][m][0]),
                                                 times=None if tim is None else tim[m][0], extra={k: int(v[m][0]) for k, v in extra.items()}))
                b['rows'].append(cols['row'][m]); b['cols'].append(cols['col'][m])
                b['dyn'].append(smp[m][:, :, [bi[x] for x in dyn]]); b['st'].append(smp[m][:, 0, [bi[x] for x in static]])
                b['y'].append(cols['target'][m])
                if sum(len(r) for r in b['rows']) >= need[f]:
                    index.append(_write_field(out, country, names.get(int(f), f'{country}_field{f}'), crops.get(b['crop'], str(b['crop'])),
                                              buf.pop(int(f)), dyn, static, stats))
            print(f'  {sl.stop:,}/{ds.sizes["index"]:,} pixels', flush=True)
        for f, b in buf.items():   # fields whose pixel count was smaller than expected
            index.append(_write_field(out, country, names.get(f, f'{country}_field{f}'), crops.get(b['crop'], str(b['crop'])), b, dyn, static, stats))
    norm = {k: [v[1] / max(v[0], 1), math.sqrt(max(v[2] / max(v[0], 1) - (v[1] / max(v[0], 1)) ** 2, 1e-12))] for k, v in stats.items()}
    meta = dict(fields=index, norm=norm, dyn=dyn, static=static, crops=sorted({f['crop'] for f in index}))
    json.dump(meta, open(out / 'index.json', 'w'))
    if CACHE_YIELDSAT_ON_DRIVE:
        drive_out.mkdir(parents=True, exist_ok=True)
        sh(f'cp -r "{out}/." "{drive_out}/"', check=False)
    return out, meta


def _has_dask():
    try:
        import dask  # noqa
        return True
    except Exception:
        return False


def _acc(stats, name, v):
    v = v[np.isfinite(v)].astype(np.float64)
    s = stats.setdefault(name, [0, 0.0, 0.0])
    s[0] += v.size; s[1] += v.sum(); s[2] += (v ** 2).sum()


def _write_field(out, country, name, crop, b, dyn, static, stats):
    rows, cols = np.concatenate(b['rows']).astype(int), np.concatenate(b['cols']).astype(int)
    D, S, y = np.concatenate(b['dyn']), np.concatenate(b['st']), np.concatenate(b['y']).astype(np.float32)
    H, W = rows.max() + 1, cols.max() + 1
    T = D.shape[1]
    x = np.full((T, len(dyn), H, W), np.nan, np.float32); x[:, :, rows, cols] = D.transpose(1, 2, 0)
    st = np.full((len(static), H, W), np.nan, np.float32); st[:, rows, cols] = S.T
    ym = np.full((H, W), np.nan, np.float32); ym[rows, cols] = y
    mask = np.zeros((H, W), np.uint8); mask[rows, cols] = 1
    for i, n in enumerate(dyn): _acc(stats, n, D[:, :, i])
    for i, n in enumerate(static): _acc(stats, n, S[:, i])
    _acc(stats, '__yield__', y)
    if b['times'] is not None and not np.isnat(b['times'][0]):
        t = b['times']; t0 = t[~np.isnat(t)][0]
        days = np.array([(ti - t0) / np.timedelta64(1, 'D') if not np.isnat(ti) else i * 30 for i, ti in enumerate(t)], np.float32)
    else:
        days = np.arange(T, dtype=np.float32) * 30
    safe = re.sub(r'[^A-Za-z0-9_.-]', '_', name)
    (out / country).mkdir(exist_ok=True)
    np.savez(out / country / f'{safe}.npz', x=x.astype(np.float32 if np.nanmax(np.abs(D), initial=0) > 6e4 else np.float16),
             static=st, y=ym, mask=mask, days=days)
    rec = dict(file=f'{country}/{safe}.npz', name=name, country=country, crop=crop, H=int(H), W=int(W), n=int(mask.sum()),
               mean_yield=float(np.nanmean(y)), **b['extra'])
    rec['farm'] = f"{country}_{rec.get('farm_identifier', name.split('_field')[0])}"
    return rec


def yieldsat_folds(meta, k=5):
    """Grouped folds (no field/farm/year appears in two folds), saved once and shared by all notebooks."""
    sp = P['splits'] / f'yieldsat_{YS_SPLIT_BY}_k{k}.json'
    if sp.exists():
        return json.load(open(sp))
    key = {'field': lambda f: f['name'], 'farm': lambda f: f['farm'], 'year': lambda f: str(f.get('year', '0'))}[YS_SPLIT_BY]
    groups = sorted({key(f) for f in meta['fields']})
    rng = random.Random(42); rng.shuffle(groups)
    gfold = {g: i % k + 1 for i, g in enumerate(groups)}
    folds = {f['name']: gfold[key(f)] for f in meta['fields']}
    json.dump(folds, open(sp, 'w'))
    return folds


def yieldsat_split(meta, folds, test_fold):
    val_fold = test_fold % 5 + 1
    tr = [f for f in meta['fields'] if folds[f['name']] not in (test_fold, val_fold)]
    va = [f for f in meta['fields'] if folds[f['name']] == val_fold]
    te = [f for f in meta['fields'] if folds[f['name']] == test_fold]
    return tr, va, te


class YieldDS(torch.utils.data.Dataset):
    """train: random crops (YS_CROP_PATCH²) · eval: whole field padded to a multiple of 16."""
    def __init__(self, cache, meta, fields, train=False, crops_per_field=6, p_drop_t=0.1, seed=0):
        self.cache, self.meta, self.fields, self.train = cache, meta, fields, train
        self.cpf, self.p_drop_t = crops_per_field, p_drop_t
        self.rng = np.random.default_rng(seed)
        n = meta['norm']
        self.dm = np.array([n[b][0] for b in meta['dyn']], np.float32)[None, :, None, None]
        self.ds = np.array([n[b][1] for b in meta['dyn']], np.float32)[None, :, None, None] + 1e-6
        self.sm = np.array([n[b][0] for b in meta['static']], np.float32)[:, None, None]
        self.ss = np.array([n[b][1] for b in meta['static']], np.float32)[:, None, None] + 1e-6
        self.ym, self.ys = n['__yield__']
        self.crop_idx = {c: i for i, c in enumerate(meta['crops'])}
        self.i_s2 = [i for i, b in enumerate(meta['dyn']) if b in S2_YIELDSAT]

    def __len__(self): return len(self.fields) * (self.cpf if self.train else 1)

    def __getitem__(self, i):
        f = self.fields[i % len(self.fields)]
        d = np.load(self.cache / f['file'])
        x, st, y, mask, days = d['x'].astype(np.float32), d['static'], d['y'], d['mask'], d['days']
        obs = np.isfinite(x[:, self.i_s2]).any(1, keepdims=True).astype(np.float32)        # (T,1,H,W)
        x = np.nan_to_num((x - self.dm) / self.ds)
        st = np.nan_to_num((st - self.sm) / self.ss)
        x = np.concatenate([x, obs], 1)                                                        # + OBS_S2
        tmask = obs.reshape(obs.shape[0], -1).any(1)
        H, W = mask.shape
        s = YS_CROP_PATCH
        if self.train:
            ph, pw = max(0, s - H), max(0, s - W)
            pad = lambda a, v=0: np.pad(a, [(0, 0)] * (a.ndim - 2) + [(0, ph), (0, pw)], constant_values=v)
            x, st, y, mask = pad(x), pad(st), pad(y, np.nan), pad(mask)
            for _ in range(10):   # prefer crops that contain field pixels
                y0, x0 = self.rng.integers(0, x.shape[-2] - s + 1), self.rng.integers(0, x.shape[-1] - s + 1)
                if mask[y0:y0 + s, x0:x0 + s].mean() > 0.2: break
            x, st, y, mask = (a[..., y0:y0 + s, x0:x0 + s] for a in (x, st, y, mask))
            x, st, y, mask = augment_spatial([x, st, y, mask], self.rng)
            drop = (self.rng.random(len(tmask)) < self.p_drop_t) & tmask
            if drop.sum() < tmask.sum(): x[drop] = 0; tmask = tmask & ~drop
        else:
            Hp, Wp = (H + 15) // 16 * 16, (W + 15) // 16 * 16
            pad = lambda a, v=0: np.pad(a, [(0, 0)] * (a.ndim - 2) + [(0, Hp - H), (0, Wp - W)], constant_values=v)
            x, st, y, mask = pad(x), pad(st), pad(y, np.nan), pad(mask)
        valid_y = np.isfinite(y) & (mask > 0)
        crop = np.where(mask > 0, self.crop_idx[f['crop']], 255).astype(np.int64)
        return dict(x=torch.from_numpy(np.ascontiguousarray(x, np.float32)), static=torch.from_numpy(np.ascontiguousarray(st, np.float32)),
                    days=torch.from_numpy(days.astype(np.float32)), tmask=torch.from_numpy(tmask),
                    crop=torch.from_numpy(crop), extent=torch.from_numpy(mask.astype(np.float32)),
                    yld=torch.from_numpy(np.where(valid_y, (np.nan_to_num(y) - self.ym) / self.ys, 0).astype(np.float32)),
                    ymask=torch.from_numpy(valid_y), id=f['name'])


def yieldsat_dyn_bands(meta):
    return list(meta['dyn']) + ['OBS_S2']
