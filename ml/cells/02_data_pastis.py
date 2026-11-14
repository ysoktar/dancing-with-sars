# %% [md]
# ## 2 · Dataset 1: PASTIS-R (Sentinel-1 SAR + Sentinel-2, France)
# [PASTIS-R](https://github.com/VSainteuf/pastis-benchmark) has 2,433 patches of 128×128 px (10 m) over one season (Sep 2018 – Nov 2019):
# Sentinel-2 (10 bands, 38–61 dates), Sentinel-1 ascending and descending (VV, VH, VV/VH; ~70 dates each), semantic crop labels (18 crops + background + void) and parcel instances. There are five official folds.
#
# **Targets used here**
# * `sem`: crop type per pixel (20 classes, void ignored)
# * `extent`, `boundary`, `dist`: where the plantations / fields are (parcel mask, parcel edges, distance to the edge). Watershed on these gives individual fields.
#
# **Time handling**: every series is put on one fixed grid (default 24 steps of 18 days). Each step stores the mean of the observations falling in it (median when there are 3 or more), or the nearest observation plus an `OBS_*` flag of 0 when the step is empty. The same grid length is used for YieldSAT, which comes with 24 steps.

# %%
PASTIS_CLASSES = ['Background', 'Meadow', 'Soft winter wheat', 'Corn', 'Winter barley', 'Winter rapeseed', 'Spring barley',
                  'Sunflower', 'Grapevine', 'Beet', 'Winter triticale', 'Winter durum wheat', 'Fruits, vegetables, flowers',
                  'Potatoes', 'Leguminous fodder', 'Soybeans', 'Orchard', 'Mixed cereal', 'Sorghum', 'Void label']
PASTIS_VOID = 19
S2_PASTIS = ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12']
S1_NAMES = ['S1A_VV', 'S1A_VH', 'S1A_RATIO', 'S1D_VV', 'S1D_VH', 'S1D_RATIO']
PASTIS_DYN = S2_PASTIS + S1_NAMES + ['OBS_S2', 'OBS_S1']
PASTIS_URL = 'https://zenodo.org/api/records/5735646/files/PASTIS-R.zip/content'   # 53.7 GB
PASTIS_GRID = dict(start='2018-09-01', steps=24, step_days=18)
KEEP_RAW_ZIP_ON_DRIVE = True        # keeps the 54 GB zip in Drive so later sessions skip the download
CACHE_PASTIS_ON_DRIVE = False       # also keep the preprocessed tensors (~34 GB) on Drive (faster restarts, uses space)


def get_pastis_root():
    """Extract PASTIS-R to the local SSD, downloading the zip only once (kept on Drive)."""
    root = P['local'] / 'PASTIS-R'
    if (root / 'metadata.geojson').exists():
        return root
    if SMOKE:
        make_fake_pastis(root); return root
    drive_zip = P['raw'] / 'PASTIS-R.zip'
    local_zip = P['local'] / 'PASTIS-R.zip'
    src = drive_zip if drive_zip.exists() and drive_zip.stat().st_size > 5e10 else None
    if src is None:
        sh(f'wget -c --progress=dot:giga -O "{local_zip}" "{PASTIS_URL}"', timeout=6 * 3600)
        src = local_zip
        if KEEP_RAW_ZIP_ON_DRIVE:
            sh(f'cp "{local_zip}" "{drive_zip}.part" && mv "{drive_zip}.part" "{drive_zip}"', check=False)
    print('extracting', src)
    ulog = P['local'] / 'unzip.log'     # ~12,000 file names: written to a log, last lines shown (keeps unzip's exit code)
    sh(f'unzip -o "{src}" -d "{P["local"]}" > "{ulog}" && wc -l < "{ulog}" && tail -n 3 "{ulog}"', timeout=3 * 3600)
    if local_zip.exists():
        local_zip.unlink()          # free local disk; the Drive copy (if kept) is the cache
    cand = [p.parent for p in P['local'].rglob('metadata.geojson')]
    if cand and cand[0] != root:
        cand[0].rename(root)
    return root


def make_fake_pastis(root, n=12, H=32):
    """Tiny synthetic PASTIS-R with the same file layout (smoke tests only)."""
    rng = np.random.default_rng(0)
    for d in ['DATA_S2', 'DATA_S1A', 'DATA_S1D', 'ANNOTATIONS', 'INSTANCE_ANNOTATIONS']:
        (root / d).mkdir(parents=True, exist_ok=True)
    feats = []
    for i in range(n):
        pid = 10000 + i
        def dates(k):
            ds = sorted(rng.choice(np.arange(0, 420), k, replace=False))
            return {str(j): int((dt.date(2018, 9, 1) + dt.timedelta(days=int(x))).strftime('%Y%m%d')) for j, x in enumerate(ds)}
        d2, da, dd = dates(int(rng.integers(10, 16))), dates(int(rng.integers(12, 18))), dates(int(rng.integers(12, 18)))
        inst = np.zeros((H, H), np.int32); sem = np.zeros((H, H), np.int32)
        k = 1
        for y0 in range(0, H, 8):
            for x0 in range(0, H, 8):
                if rng.random() < 0.8:
                    inst[y0:y0 + 7, x0:x0 + 7] = k; sem[y0:y0 + 7, x0:x0 + 7] = rng.integers(1, 20); k += 1
        base = sem[None, None].astype(np.float32)
        np.save(root / f'DATA_S2/S2_{pid}.npy', (rng.normal(1000, 200, (len(d2), 10, H, H)) + 30 * base).astype(np.int16))
        np.save(root / f'DATA_S1A/S1A_{pid}.npy', (rng.normal(-12, 2, (len(da), 3, H, H)) + 0.2 * base).astype(np.float32))
        np.save(root / f'DATA_S1D/S1D_{pid}.npy', (rng.normal(-12, 2, (len(dd), 3, H, H)) + 0.2 * base).astype(np.float32))
        np.save(root / f'ANNOTATIONS/TARGET_{pid}.npy', np.stack([sem, sem, sem]))
        np.save(root / f'INSTANCE_ANNOTATIONS/INSTANCES_{pid}.npy', inst)
        feats.append({'type': 'Feature', 'geometry': None, 'properties': {
            'ID_PATCH': pid, 'Fold': i % 5 + 1, 'dates-S2': json.dumps(d2), 'dates-S1A': json.dumps(da), 'dates-S1D': json.dumps(dd)}})
    (root / 'metadata.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': feats}))


def _read_meta(root):
    feats = json.loads((root / 'metadata.geojson').read_text())['features']
    meta = {}
    for f in feats:
        p = f['properties']
        d = {}
        for s in ('S2', 'S1A', 'S1D'):
            v = p.get(f'dates-{s}')
            v = json.loads(v) if isinstance(v, str) else (v or {})
            d[s] = np.array([(dt.date(int(str(x)[:4]), int(str(x)[4:6]), int(str(x)[6:8])) - dt.date.fromisoformat(PASTIS_GRID['start'])).days
                             for _, x in sorted(v.items(), key=lambda kv: int(kv[0]))])
        meta[int(p['ID_PATCH'])] = dict(fold=int(p['Fold']), dates=d)
    return meta


def _norm_stats(root, meta, sat, nch):
    f = root / f'NORM_{sat}_patch.json'
    if f.exists():
        js = json.loads(f.read_text())
        m = np.mean([js[k]['mean'] for k in js], 0); s = np.mean([js[k]['std'] for k in js], 0)
        return np.array(m, np.float32), np.array(s, np.float32)
    ids = list(meta)[:: max(1, len(meta) // 80)]
    xs = [np.load(root / f'DATA_{sat}/{sat}_{i}.npy', mmap_mode='r')[:, :, ::8, ::8].astype(np.float32) for i in ids]
    x = np.concatenate([a.transpose(1, 0, 2, 3).reshape(nch, -1) for a in xs], 1)
    return np.nanmean(x, 1).astype(np.float32), (np.nanstd(x, 1) + 1e-6).astype(np.float32)


def _to_grid(arr, days, grid):
    half = (grid[1] - grid[0]) / 2 if len(grid) > 1 else 1e9
    out = np.zeros((len(grid),) + arr.shape[1:], np.float32); obs = np.zeros(len(grid), np.float32)
    for g, gd in enumerate(grid):
        sel = np.abs(days - gd) <= half
        if sel.sum() >= 3: out[g] = np.median(arr[sel], 0); obs[g] = 1
        elif sel.any(): out[g] = arr[sel].mean(0); obs[g] = 1
        else: out[g] = arr[int(np.argmin(np.abs(days - gd)))]
    return out, obs


def parcel_targets(inst, sem):
    """extent (field vs background), boundary (parcel edges) and distance-to-edge (0..1 per parcel)."""
    from scipy import ndimage
    extent = (sem > 0).astype(np.uint8)
    pad = np.pad(inst, 1, mode='edge')
    edge = np.zeros_like(inst, bool)
    for dy, dx in ((0, 1), (1, 0), (2, 1), (1, 2)):
        edge |= pad[dy:dy + inst.shape[0], dx:dx + inst.shape[1]] != inst
    boundary = (edge & (inst > 0)).astype(np.uint8)
    dist = np.zeros(inst.shape, np.float32)
    for k in np.unique(inst):
        if k == 0: continue
        m = inst == k
        d = ndimage.distance_transform_edt(np.pad(m, 1))[1:-1, 1:-1]
        dist[m] = d[m] / max(d.max(), 1)
    return extent, boundary, dist


def _prep_one(args):
    root, out, pid, info, grid, norms = args
    f = out / f'{pid}.npz'
    if f.exists(): return pid
    parts, obs = [], {}
    for sat, nch in (('S2', 10), ('S1A', 3), ('S1D', 3)):
        a = np.load(root / f'DATA_{sat}/{sat}_{pid}.npy').astype(np.float32)
        a = (a - norms[sat][0][None, :, None, None]) / norms[sat][1][None, :, None, None]
        a = np.nan_to_num(a)
        g, o = _to_grid(a, info['dates'][sat], grid)
        parts.append(g); obs[sat] = o
    T, _, H, W = parts[0].shape
    flags = np.stack([np.broadcast_to(obs['S2'][:, None, None], (T, H, W)),
                      np.broadcast_to(np.maximum(obs['S1A'], obs['S1D'])[:, None, None], (T, H, W))], 1)
    x = np.concatenate(parts + [flags], 1).astype(np.float16)
    sem = np.load(root / f'ANNOTATIONS/TARGET_{pid}.npy')[0].astype(np.int64)
    inst = np.load(root / f'INSTANCE_ANNOTATIONS/INSTANCES_{pid}.npy').astype(np.int32)
    extent, boundary, dist = parcel_targets(inst, sem)
    sem_t = np.where(sem == PASTIS_VOID, 255, sem).astype(np.uint8)
    np.savez(f.with_suffix('.tmp.npz'), x=x, days=np.array(grid, np.int16), sem=sem_t, extent=extent, boundary=boundary,
             dist=dist.astype(np.float16), inst=inst)
    os.replace(f.with_suffix('.tmp.npz'), f)
    return pid


def prepare_pastis():
    """Returns (cache_dir, meta). Preprocessing is resumable (existing patches are skipped)."""
    tag = f"pastis_T{PASTIS_GRID['steps']}x{PASTIS_GRID['step_days']}"
    out = P['local'] / 'cache' / tag
    drive_out = P['cache'] / tag
    out.mkdir(parents=True, exist_ok=True)
    if CACHE_PASTIS_ON_DRIVE and (drive_out / 'DONE').exists() and not (out / 'DONE').exists():
        sh(f'cp -r "{drive_out}/." "{out}/"')
    root = get_pastis_root()
    meta = _read_meta(root)
    if not (out / 'DONE').exists():
        norms = {s: _norm_stats(root, meta, s, n) for s, n in (('S2', 10), ('S1A', 3), ('S1D', 3))}
        json.dump({s: [v[0].tolist(), v[1].tolist()] for s, v in norms.items()}, open(out / 'norm.json', 'w'))
        grid = [i * PASTIS_GRID['step_days'] + PASTIS_GRID['step_days'] / 2 for i in range(PASTIS_GRID['steps'])]
        jobs = [(root, out, pid, info, grid, norms) for pid, info in meta.items()]
        from concurrent.futures import ProcessPoolExecutor
        t0 = time.time()
        with ProcessPoolExecutor(max(1, min(16, os.cpu_count() or 2))) as ex:
            for k, _ in enumerate(ex.map(_prep_one, jobs, chunksize=4)):
                if k % 200 == 0: print(f'  preprocessed {k}/{len(jobs)} patches · {time.time() - t0:.0f}s', flush=True)
        (out / 'DONE').write_text(str(len(jobs)))
        if CACHE_PASTIS_ON_DRIVE:
            drive_out.mkdir(parents=True, exist_ok=True)
            sh(f'cp -r "{out}/." "{drive_out}/"', check=False)
    # official fold assignment, saved once and shared by every notebook
    sp = P['splits'] / 'pastis_folds.json'
    if not sp.exists():
        json.dump({str(k): v['fold'] for k, v in meta.items()}, open(sp, 'w'))
    folds = {int(k): v for k, v in json.load(open(sp)).items()}
    return out, folds


def pastis_fold_split(folds, test_fold):
    val_fold = test_fold % 5 + 1
    ids = sorted(folds)
    return ([i for i in ids if folds[i] not in (test_fold, val_fold)],
            [i for i in ids if folds[i] == val_fold],
            [i for i in ids if folds[i] == test_fold])


def augment_spatial(arrs, rng):
    k = int(rng.integers(4)); flip = rng.random() < 0.5
    out = []
    for a in arrs:
        if a is None: out.append(None); continue
        a = np.rot90(a, k, axes=(-2, -1))
        if flip: a = a[..., ::-1]
        out.append(np.ascontiguousarray(a))
    return out


class PastisDS(torch.utils.data.Dataset):
    def __init__(self, cache, ids, train=False, p_drop_s1=0.3, p_drop_s2=0.1, p_drop_t=0.15, seed=0):
        self.cache, self.ids, self.train = cache, list(ids), train
        self.p_drop_s1, self.p_drop_s2, self.p_drop_t = p_drop_s1, p_drop_s2, p_drop_t
        self.rng = np.random.default_rng(seed)
        self.i_s2 = [PASTIS_DYN.index(b) for b in S2_PASTIS + ['OBS_S2']]
        self.i_s1 = [PASTIS_DYN.index(b) for b in S1_NAMES + ['OBS_S1']]

    def __len__(self): return len(self.ids)

    def __getitem__(self, i):
        d = np.load(self.cache / f'{self.ids[i]}.npz')
        x = d['x'].astype(np.float32)
        tmask = np.ones(x.shape[0], bool)
        tg = [d['sem'], d['extent'], d['boundary'], d['dist']]
        if self.train:
            rng = self.rng
            x, *tg = augment_spatial([x] + tg, rng)
            r = rng.random()
            if r < self.p_drop_s1: x[:, self.i_s1] = 0                       # SAR missing (as in YieldSAT)
            elif r < self.p_drop_s1 + self.p_drop_s2: x[:, self.i_s2] = 0    # optical missing (clouds)
            drop = rng.random(x.shape[0]) < self.p_drop_t
            if drop.all(): drop[rng.integers(len(drop))] = False
            x[drop] = 0; tmask &= ~drop
        return dict(x=torch.from_numpy(x), days=torch.from_numpy(d['days'].astype(np.float32)), tmask=torch.from_numpy(tmask),
                    sem=torch.from_numpy(tg[0].astype(np.int64)), extent=torch.from_numpy(tg[1].astype(np.float32)),
                    boundary=torch.from_numpy(tg[2].astype(np.float32)), dist=torch.from_numpy(tg[3].astype(np.float32)),
                    id=self.ids[i])
