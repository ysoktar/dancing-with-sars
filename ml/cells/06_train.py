# %% [md]
# ## 6 · Training engine: losses, metrics, crash-safe checkpoints
# * `last.pt` is written to Drive every `CKPT_MINUTES` and at the end of every epoch. It holds the model, optimizer, scheduler, AMP scaler, RNG states, epoch, **position inside the epoch** and the best score, so a run that dies mid-epoch continues from the same batch.
# * `best.pt` is the best validation checkpoint; `metrics.csv` gets one row per epoch; `log.txt` keeps the console log.
# * To stop a run cleanly from another notebook or from Drive, create an empty file called `STOP` in the run folder.
# * Writes are atomic (temporary file, then rename), so a disconnect during a save cannot corrupt the previous checkpoint.

# %%
import csv, inspect, io, contextlib
CKPT_MINUTES = 10
NUM_WORKERS = 0 if SMOKE else min(8, os.cpu_count() or 2)

PASTIS_TASKS = {'sem': len(PASTIS_CLASSES), 'extent': 1, 'boundary': 1, 'dist': 1}
PASTIS_LOSS_W = {'sem': 1.0, 'extent': 0.5, 'boundary': 0.5, 'dist': 0.5}
YIELD_LOSS_W = {'yld': 1.0, 'crop': 0.5, 'extent': 0.25}


def task_losses(out, batch, weights):
    L = {}
    if 'sem' in weights and 'sem' in out:
        L['sem'] = F.cross_entropy(out['sem'].float(), batch['sem'], ignore_index=255)
    if 'crop' in weights and 'crop' in out:
        L['crop'] = F.cross_entropy(out['crop'].float(), batch['crop'], ignore_index=255)
    if 'extent' in weights and 'extent' in out:
        L['extent'] = F.binary_cross_entropy_with_logits(out['extent'][:, 0].float(), batch['extent'])
    if 'boundary' in weights and 'boundary' in out:
        L['boundary'] = F.binary_cross_entropy_with_logits(out['boundary'][:, 0].float(), batch['boundary'],
                                                           pos_weight=torch.tensor(5.0, device=batch['boundary'].device))
    if 'dist' in weights and 'dist' in out:
        m = batch['extent']
        L['dist'] = (torch.abs(torch.sigmoid(out['dist'][:, 0].float()) - batch['dist']) * m).sum() / (m.sum() + 1e-6)
    if 'yld' in weights and 'yld' in out:
        m = batch['ymask'].float()
        L['yld'] = (F.huber_loss(out['yld'][:, 0].float(), batch['yld'], reduction='none', delta=1.0) * m).sum() / (m.sum() + 1e-6)
    total = sum(weights[k] * v for k, v in L.items())
    return total, L


class Metrics:
    """Streaming metrics for every task present in the batch."""
    def __init__(self, n_sem=None, n_crop=None, yield_norm=None, ignore_sem=()):
        self.cm = np.zeros((n_sem, n_sem), np.int64) if n_sem else None
        self.cc = np.zeros((n_crop, n_crop), np.int64) if n_crop else None
        self.ignore_sem = set(ignore_sem)
        self.bin = {k: np.zeros(3) for k in ('extent', 'boundary')}   # tp, fp, fn
        self.dist = [0.0, 0]
        self.yn = yield_norm
        self.y = [0.0, 0.0, 0.0, 0.0, 0.0, 0]     # sum err², sum |err|, sum y, sum y², n... for R²
        self.fields = []                          # (true mean, pred mean, crop true, crop pred) per field

    @staticmethod
    def _cm(cm, pred, tgt):
        k = tgt != 255
        n = cm.shape[0]
        cm += np.bincount(n * tgt[k] + pred[k], minlength=n * n).reshape(n, n)

    def update(self, out, batch):
        if self.cm is not None and 'sem' in out:
            self._cm(self.cm, out['sem'].argmax(1).cpu().numpy().ravel(), batch['sem'].cpu().numpy().ravel())
        for k in self.bin:
            if k in out and k in batch:
                p = (out[k][:, 0] > 0).cpu().numpy(); t = batch[k].cpu().numpy() > 0.5
                self.bin[k] += [(p & t).sum(), (p & ~t).sum(), (~p & t).sum()]
        if 'dist' in out and 'dist' in batch:
            m = batch['extent'].cpu().numpy() > 0.5
            self.dist[0] += np.abs(torch.sigmoid(out['dist'][:, 0].float()).cpu().numpy() - batch['dist'].cpu().numpy())[m].sum(); self.dist[1] += m.sum()
        if 'yld' in out and 'ymask' in batch:
            ym, ys = self.yn
            pr = out['yld'][:, 0].float().cpu().numpy() * ys + ym
            tr = batch['yld'].cpu().numpy() * ys + ym
            msk = batch['ymask'].cpu().numpy()
            e = (pr - tr)[msk]
            self.y[0] += (e ** 2).sum(); self.y[1] += np.abs(e).sum(); self.y[2] += tr[msk].sum(); self.y[3] += (tr[msk] ** 2).sum(); self.y[5] += msk.sum()
            cp = out['crop'].argmax(1).cpu().numpy() if 'crop' in out else None
            for b in range(pr.shape[0]):
                mb = msk[b]
                if mb.sum() == 0: continue
                ct = int(batch['crop'][b].cpu().numpy()[mb][0]) if 'crop' in batch else -1
                cpb = int(np.bincount(cp[b][mb]).argmax()) if cp is not None else -1
                self.fields.append((float(tr[b][mb].mean()), float(pr[b][mb].mean()), ct, cpb))
        if self.cc is not None and 'crop' in out:
            self._cm(self.cc, out['crop'].argmax(1).cpu().numpy().ravel(), batch['crop'].cpu().numpy().ravel())

    @staticmethod
    def _iou(cm, ignore=()):
        inter = np.diag(cm).astype(float); union = cm.sum(0) + cm.sum(1) - np.diag(cm)
        iou = np.where(union > 0, inter / np.maximum(union, 1), np.nan)
        keep = [i for i in range(len(iou)) if i not in ignore]
        return iou, float(np.nanmean(iou[keep])), float(inter.sum() / max(cm.sum(), 1))

    def result(self):
        r = {}
        if self.cm is not None and self.cm.sum():
            iou, miou, oa = self._iou(self.cm, self.ignore_sem)
            r.update(mIoU=miou, OA=oa, per_class_IoU=[None if np.isnan(v) else float(v) for v in iou])
        if self.cc is not None and self.cc.sum():
            iou, miou, oa = self._iou(self.cc)
            r.update(crop_pixel_acc=oa, crop_mIoU=miou)
        for k, (tp, fp, fn) in self.bin.items():
            if tp + fp + fn > 0:
                r[f'{k}_IoU'] = float(tp / max(tp + fp + fn, 1)); r[f'{k}_F1'] = float(2 * tp / max(2 * tp + fp + fn, 1))
        if self.dist[1]: r['dist_MAE'] = float(self.dist[0] / self.dist[1])
        if self.y[5]:
            n = self.y[5]; var = self.y[3] / n - (self.y[2] / n) ** 2
            r.update(pixel_RMSE=float(math.sqrt(self.y[0] / n)), pixel_MAE=float(self.y[1] / n), pixel_R2=float(1 - (self.y[0] / n) / max(var, 1e-9)))
        if self.fields:
            a = np.array([f[:2] for f in self.fields]); t, p = a[:, 0], a[:, 1]
            r.update(field_RMSE=float(np.sqrt(((p - t) ** 2).mean())), field_MAE=float(np.abs(p - t).mean()),
                     field_R2=float(1 - ((p - t) ** 2).sum() / max(((t - t.mean()) ** 2).sum(), 1e-9)), n_fields=len(self.fields))
            c = np.array([f[2:] for f in self.fields])
            if (c[:, 0] >= 0).any(): r['crop_field_acc'] = float((c[:, 0] == c[:, 1]).mean())
        return r


def to_device(batch):
    return {k: (v.to(DEVICE, non_blocking=True) if torch.is_tensor(v) else v) for k, v in batch.items()}


def amp_ctx():
    if DEVICE != 'cuda': return contextlib.nullcontext()
    return torch.autocast('cuda', dtype=torch.bfloat16 if BF16 else torch.float16)


class EpochSampler(torch.utils.data.Sampler):
    """Deterministic shuffle per (seed, epoch) that can start in the middle: makes mid-epoch resume exact."""
    def __init__(self, n, seed, epoch, start=0):
        self.idx = np.random.default_rng(seed * 1000 + epoch).permutation(n)[start:].tolist()
    def __iter__(self): return iter(self.idx)
    def __len__(self): return len(self.idx)


class Run:
    def __init__(self, stage, name, cfg):
        self.dir = P['runs'] / MODEL_NAME / stage / name
        (self.dir / 'checkpoints').mkdir(parents=True, exist_ok=True)
        (self.dir / 'samples').mkdir(exist_ok=True)
        self.cfg = cfg
        old = self.dir / 'config.json'
        if old.exists():
            prev = json.load(open(old))
            diff = {k: (prev.get(k), v) for k, v in cfg.items() if prev.get(k) != v}
            if diff: self.log(f'config differs from the saved run (saved, now): {diff}')
        json.dump(cfg, open(old, 'w'), indent=1, default=str)
        env = dict(torch=torch.__version__, gpu=GPU, cuda=torch.version.cuda, python=sys.version.split()[0],
                   mamba='cuda' if MambaCUDA else 'pytorch', time=dt.datetime.now(dt.timezone.utc).isoformat())
        json.dump(env, open(self.dir / 'env.json', 'w'), indent=1)

    def log(self, msg):
        line = f'[{dt.datetime.now():%Y-%m-%d %H:%M:%S}] {msg}'
        print(line, flush=True)
        with open(self.dir / 'log.txt', 'a') as f: f.write(line + '\n')

    def save(self, state, name):
        p = self.dir / 'checkpoints' / name
        buf = io.BytesIO(); torch.save(state, buf)
        tmp = p.with_suffix('.tmp'); tmp.write_bytes(buf.getvalue()); os.replace(tmp, p)

    def load(self, name):
        p = self.dir / 'checkpoints' / name
        return torch.load(p, map_location='cpu', weights_only=False) if p.exists() else None

    def append_metrics(self, row):
        p = self.dir / 'metrics.csv'
        rows = list(csv.DictReader(open(p))) if p.exists() else []
        rows = [r for r in rows if int(r['epoch']) < row['epoch']] + [{k: v for k, v in row.items()}]
        keys = list(dict.fromkeys(k for r in rows for k in r))
        with open(p.with_suffix('.tmp'), 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=keys); w.writeheader(); w.writerows(rows)
        os.replace(p.with_suffix('.tmp'), p)

    def stop_requested(self):
        return (self.dir / 'STOP').exists()


def rng_state():
    return dict(py=random.getstate(), np=np.random.get_state(), torch=torch.get_rng_state(),
                cuda=torch.cuda.get_rng_state_all() if DEVICE == 'cuda' else None)

def set_rng_state(s):
    random.setstate(s['py']); np.random.set_state(s['np']); torch.set_rng_state(s['torch'])
    if s.get('cuda') is not None and DEVICE == 'cuda': torch.cuda.set_rng_state_all(s['cuda'])


def make_optimizer(model, phase):
    if phase.get('freeze_backbone'):
        bb = set(map(id, model.backbone_parameters()))
        for p in model.parameters(): p.requires_grad = id(p) not in bb
        groups = [{'params': [p for p in model.parameters() if p.requires_grad], 'lr': phase['lr']}]
    else:
        for p in model.parameters(): p.requires_grad = True
        bb = model.backbone_parameters(); bbi = set(map(id, bb))
        head = [p for p in model.parameters() if id(p) not in bbi]
        groups = [{'params': bb, 'lr': phase['lr'] * phase.get('backbone_lr_mult', 1.0)}, {'params': head, 'lr': phase['lr']}]
    return torch.optim.AdamW(groups, weight_decay=phase.get('wd', 1e-4))


def make_scheduler(opt, total_steps, warmup=0.03):
    w = max(1, int(total_steps * warmup))
    return torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / w) * 0.5 * (1 + math.cos(math.pi * min(1.0, s / max(1, total_steps)))))


def fit(model, run, ds_train, ds_val, phases, batch_size, loss_w, metrics_fn, monitor, mode='max', patience=None,
        extra_losses=None, sample_fn=None, seed=0, val_batch_size=None):
    """phases: list of dicts {epochs, lr, freeze_backbone?, backbone_lr_mult?}. Resumes automatically."""
    extra_losses = extra_losses or {}
    model.to(DEVICE)
    scaler = torch.amp.GradScaler('cuda', enabled=(DEVICE == 'cuda' and not BF16))
    ck = run.load('last.pt')
    st = dict(phase=0, epoch=0, batch=0, step=0, best=None, bad=0, done=False)
    if ck is not None:
        model.load_state_dict(ck['model']); st.update(ck['state'])
        run.log(f"resuming: phase {st['phase']} epoch {st['epoch']} batch {st['batch']} (best {monitor} = {st['best']})")
    if st['done']:
        run.log('run already finished'); return st
    total_epochs = sum(p['epochs'] for p in phases)
    while st['phase'] < len(phases):
        ph = phases[st['phase']]
        opt = make_optimizer(model, ph)
        steps_per_epoch = math.ceil(len(ds_train) / batch_size)
        sched = make_scheduler(opt, ph['epochs'] * steps_per_epoch)
        if ck is not None and ck['state']['phase'] == st['phase']:
            opt.load_state_dict(ck['opt']); sched.load_state_dict(ck['sched']); scaler.load_state_dict(ck['scaler'])
            if ck.get('rng'): set_rng_state(ck['rng'])
        ck = None
        ep0 = sum(p['epochs'] for p in phases[:st['phase']])
        while st['epoch'] < ep0 + ph['epochs']:
            model.train()
            sampler = EpochSampler(len(ds_train), seed, st['epoch'], start=st['batch'] * batch_size)
            dl = torch.utils.data.DataLoader(ds_train, batch_size=batch_size, sampler=sampler, num_workers=NUM_WORKERS,
                                             pin_memory=DEVICE == 'cuda', drop_last=False, persistent_workers=False)
            t0, last_save, sums, n = time.time(), time.time(), {}, 0
            for batch in dl:
                batch = to_device(batch)
                with amp_ctx():
                    out = model(batch)
                    loss, parts = task_losses(out, batch, loss_w)
                    for k, (w, fn) in extra_losses.items():
                        parts[k] = fn(out, batch); loss = loss + w * parts[k]
                opt.zero_grad(set_to_none=True)
                scaler.scale(loss).backward()
                scaler.unscale_(opt); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(opt); scaler.update(); sched.step()
                st['batch'] += 1; st['step'] += 1; n += 1
                for k, v in parts.items(): sums[k] = sums.get(k, 0) + float(v.detach())
                sums['loss'] = sums.get('loss', 0) + float(loss.detach())
                if n % 50 == 0:
                    run.log(f"ep {st['epoch'] + 1}/{total_epochs} it {st['batch']}/{steps_per_epoch} loss {sums['loss'] / n:.4f} lr {sched.get_last_lr()[-1]:.2e}")
                stop = run.stop_requested()
                if time.time() - last_save > CKPT_MINUTES * 60 or stop:
                    run.save(dict(model=model.state_dict(), opt=opt.state_dict(), sched=sched.state_dict(), scaler=scaler.state_dict(),
                                  state=dict(st), rng=rng_state(), cfg=run.cfg), 'last.pt')
                    last_save = time.time()
                    if stop:
                        run.log('STOP file found: checkpoint saved, stopping'); return st
            # ---- end of epoch: validate
            val = evaluate(model, ds_val, metrics_fn, batch_size=val_batch_size or batch_size)
            score = val.get(monitor)
            improved = score is not None and (st['best'] is None or (score > st['best'] if mode == 'max' else score < st['best']))
            st['epoch'] += 1; st['batch'] = 0
            if improved:
                st['best'] = score; st['bad'] = 0
                run.save(dict(model=model.state_dict(), state=dict(st), metrics=val, cfg=run.cfg), 'best.pt')
            else:
                st['bad'] += 1
            row = dict(epoch=st['epoch'], phase=st['phase'], time_s=round(time.time() - t0, 1), lr=sched.get_last_lr()[-1],
                       **{f'train_{k}': v / max(n, 1) for k, v in sums.items()}, **{f'val_{k}': v for k, v in val.items() if not isinstance(v, list)})
            run.append_metrics(row)
            run.log(f"epoch {st['epoch']}/{total_epochs} · val {monitor} {score:.4f} {'(best)' if improved else ''} · " +
                    ' '.join(f'{k}={v:.4f}' for k, v in val.items() if isinstance(v, float) and k != monitor))
            if sample_fn and (st['epoch'] % 5 == 0 or st['epoch'] == 1 or improved):
                try: sample_fn(model, ds_val, run.dir / 'samples' / f"epoch_{st['epoch']:03d}.png")
                except Exception as e: run.log(f'sample plot failed: {e}')
            stop = patience is not None and st['bad'] >= patience and st['phase'] == len(phases) - 1
            run.save(dict(model=model.state_dict(), opt=opt.state_dict(), sched=sched.state_dict(), scaler=scaler.state_dict(),
                          state=dict(st), rng=rng_state(), cfg=run.cfg), 'last.pt')
            if stop:
                run.log(f'early stopping ({patience} epochs without improvement)'); st['epoch'] = ep0 + ph['epochs']; break
            if run.stop_requested():
                run.log('STOP file found, stopping'); return st
        st['phase'] += 1
    st['done'] = True
    run.save(dict(model=model.state_dict(), state=dict(st), cfg=run.cfg), 'last.pt')
    run.log(f"finished · best {monitor} = {st['best']}")
    return st


@torch.no_grad()
def evaluate(model, ds, metrics_fn, batch_size=4):
    model.eval()
    m = metrics_fn()
    dl = torch.utils.data.DataLoader(ds, batch_size=batch_size, shuffle=False, num_workers=NUM_WORKERS)
    for batch in dl:
        batch = to_device(batch)
        with amp_ctx():
            out = model(batch)
        m.update({k: v.float() for k, v in out.items()}, batch)
    return m.result()


def test_run(model, run, ds_test, metrics_fn, batch_size, sample_fn=None, extra=None):
    """Evaluate best.pt on the test split; writes test_metrics.json (+ a sample figure)."""
    ck = run.load('best.pt') or run.load('last.pt')
    model.load_state_dict(ck['model']); model.to(DEVICE)
    res = evaluate(model, ds_test, metrics_fn, batch_size)
    res.update(params=count_params(model), best_epoch=ck['state']['epoch'], **(extra or {}))
    json.dump(res, open(run.dir / 'test_metrics.json', 'w'), indent=1)
    try: src = inspect.getsource(type(model))
    except Exception: src = '# source unavailable in this kernel\n'
    (run.dir / 'model_architecture.txt').write_text(f'{type(model).__name__} {getattr(model, "cfg", {})}\n\n{model}\n\n{src}')
    if sample_fn: sample_fn(model, ds_test, run.dir / 'samples' / 'test.png')
    run.log('test: ' + ' '.join(f'{k}={v:.4f}' for k, v in res.items() if isinstance(v, float)))
    return res
