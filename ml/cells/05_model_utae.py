# %% [md]
# ## 5 · Model: pretrained U-TAE (+ SAR branch)
# The official code is cloned from [VSainteuf/utae-paps](https://github.com/VSainteuf/utae-paps), and the published PASTIS weights are downloaded from Zenodo ([record 5172293](https://zenodo.org/record/5172293)) into `weights/pretrained/utae/`.
# **Fold numbering differs from the folder names.** In the official code, `Fold_1` was trained on folds 1–3, validated on 4 and **tested on fold 5**; in general `Fold_j` is tested on fold `j−1` (`Fold_1` → 5). To avoid test leakage the notebook loads `Fold_{k % 5 + 1}` for test fold `k`, i.e. `Fold_2` for test fold 1 (published test mIoU on fold 1: 65.0 %).
# Caveat: this notebook's validation fold (`k+1`) was part of that model's training data, so validation scores (used for early stopping) are optimistic. The **test** score is clean.
#
# Architecture used here:
# * **optical branch** = the pretrained U-TAE (Sentinel-2, 10 bands), unchanged;
# * **SAR branch** = a second U-TAE (6 channels: S1 asc + desc), trained from scratch, added to the optical decoder features through a zero-initialised 1×1 layer, so training starts exactly from the published model;
# * the published 20-class head is kept for crop type; new heads predict field extent, boundary and distance.
#
# For YieldSAT the optical input layer is remapped by band name (10 → 12 S2 bands + 4 weather series), the SAR branch is removed, a static branch is added, and the crop head rows are copied from the matching PASTIS classes.
#
# Note on safety: the published weights are a pickled PyTorch file, so loading them runs code from that file. They come from the authors' Zenodo record; only load files you trust.

# %%
MODEL_NAME = 'utae_pretrained'
MambaCUDA = None
UTAE_REPO = P['local'] / 'utae-paps'
if not (UTAE_REPO / 'src').exists():
    sh(f'git clone https://github.com/VSainteuf/utae-paps "{UTAE_REPO}"')
sys.path.insert(0, str(UTAE_REPO))
from src.backbones.utae import UTAE  # noqa: E402

UTAE_WEIGHTS_URL = 'https://zenodo.org/api/records/5172293/files/UTAE_SemanticSeg_weights.zip/content'


def utae_pretrained_dir():
    d = P['weights'] / 'pretrained' / 'utae'
    if not list(d.rglob('conf.json')):
        d.mkdir(parents=True, exist_ok=True)
        sh(f'wget --progress=dot:mega -O "{d}/w.zip" "{UTAE_WEIGHTS_URL}" && unzip -o "{d}/w.zip" -d "{d}" && rm "{d}/w.zip"')
    return next(d.rglob('conf.json')).parent


def _utae(input_dim, conf):
    return UTAE(input_dim=input_dim, encoder_widths=conf['encoder_widths'], decoder_widths=conf['decoder_widths'], out_conv=conf['out_conv'],
                str_conv_k=conf['str_conv_k'], str_conv_s=conf['str_conv_s'], str_conv_p=conf['str_conv_p'], agg_mode=conf['agg_mode'],
                encoder_norm=conf['encoder_norm'], n_head=conf['n_head'], d_model=conf['d_model'], d_k=conf['d_k'], encoder=True,
                pad_value=0, padding_mode=conf.get('padding_mode', 'reflect'))


def _first_conv_key(sd, in_dim):
    return next(k for k, v in sd.items() if v.ndim == 4 and v.shape[1] == in_dim)


class UTAEMulti(nn.Module):
    def __init__(self, dyn_bands, static_bands, tasks, conf, opt_bands, sar_bands):
        super().__init__()
        self.conf, self.dyn_bands = conf, list(dyn_bands)
        self.opt_bands, self.sar_bands = list(opt_bands), list(sar_bands)
        self.opt = _utae(len(self.opt_bands), conf)
        self.sar = _utae(len(self.sar_bands), conf) if self.sar_bands else None
        c = conf['decoder_widths'][0]
        self.sar_fuse = nn.Conv2d(c, c, 1) if self.sar is not None else None
        if self.sar_fuse is not None: nn.init.zeros_(self.sar_fuse.weight); nn.init.zeros_(self.sar_fuse.bias)
        self.static = StaticBranch(static_bands, c) if static_bands else None
        self.cls_task = 'sem' if 'sem' in tasks else 'crop'
        self.cls_head = self.opt.out_conv          # published head (20 classes), reused for crop type
        self.heads = Heads(c, {k: v for k, v in tasks.items() if k not in ('sem', 'crop')})

    def _sel(self, x, names):
        return x[:, :, [self.dyn_bands.index(b) for b in names]]

    def forward(self, batch):
        x, days = batch['x'], batch['days']
        f, _ = self.opt(self._sel(x, self.opt_bands), batch_positions=days)
        if self.sar is not None:
            fs, _ = self.sar(self._sel(x, self.sar_bands), batch_positions=days)
            f = f + self.sar_fuse(fs)
        if self.static is not None and batch.get('static') is not None:
            f = f + self.static(batch['static'])
        out = self.heads(f)
        out[self.cls_task] = self.cls_head(f)
        return out

    def adapt(self, dyn_bands, static_bands, tasks, class_map=None):
        dev = next(self.parameters()).device
        new_opt_bands = [b for b in dyn_bands if not b.startswith('OBS_') and not b.startswith('S1')]
        sd = self.opt.state_dict()
        k = _first_conv_key(sd, len(self.opt_bands))
        w = sd[k]
        neww = torch.zeros(w.shape[0], len(new_opt_bands), *w.shape[2:])
        copied = []
        for j, b in enumerate(new_opt_bands):
            if b in self.opt_bands: neww[:, j] = w[:, self.opt_bands.index(b)]; copied.append(b)
        sd[k] = neww
        new_opt = _utae(len(new_opt_bands), self.conf).to(dev)
        new_opt.load_state_dict(sd)
        print(f'  optical input conv: copied {len(copied)}/{len(new_opt_bands)} bands; new (zero-init): {[b for b in new_opt_bands if b not in copied]}')
        # crop head: copy of the published head with the class rows remapped
        old_head = self.cls_head
        new_head = _utae(len(new_opt_bands), {**self.conf, 'out_conv': self.conf['out_conv'][:-1] + [tasks['crop']]}).out_conv.to(dev)
        hsd, osd = new_head.state_dict(), old_head.state_dict()
        n_old, n_new = self.conf['out_conv'][-1], tasks['crop']
        cmap = (class_map or {}).get('crop', {})
        for kk in hsd:
            if kk not in osd: continue
            if hsd[kk].shape == osd[kk].shape:
                hsd[kk] = osd[kk].clone()
            elif osd[kk].ndim >= 1 and osd[kk].shape[0] == n_old and hsd[kk].shape[0] == n_new:
                for j, i in cmap.items():          # last conv + its BatchNorm: copy the matching class rows
                    hsd[kk][j] = osd[kk][i]
        new_head.load_state_dict(hsd)
        print(f"  crop head: published head, rows initialised from PASTIS classes {(class_map or {}).get('crop')}")
        self.opt, self.cls_head, self.cls_task = new_opt, new_head, 'crop'
        self.opt_bands, self.dyn_bands = new_opt_bands, list(dyn_bands)
        self.sar = self.sar_fuse = None; self.sar_bands = []
        c = self.conf['decoder_widths'][0]
        self.static = StaticBranch(static_bands, c).to(dev) if static_bands else None
        self.heads = self.heads.adapted({k: v for k, v in tasks.items() if k != 'crop'})
        return self

    def backbone_parameters(self):
        first = _first_conv_key(dict(self.opt.named_parameters()), len(self.opt_bands))
        skip = {id(p) for n, p in self.opt.named_parameters() if n == first}
        skip |= set(map(id, list(self.cls_head.parameters()) + list(self.heads.parameters()) +
                        (list(self.static.parameters()) if self.static is not None else []) +
                        (list(self.sar.parameters()) + list(self.sar_fuse.parameters()) if self.sar is not None else [])))
        return [p for p in self.parameters() if id(p) not in skip]


RUN_SUFFIX = '_w'   # new run folders: an earlier version loaded the wrong published fold (test leakage)
UTAE_WEIGHT_FOLD = lambda test_fold: test_fold % 5 + 1   # official Fold_j was tested on fold j-1


def build_model(dyn_bands, static_bands, tasks, smoke=SMOKE, pretrained=True):
    fold = UTAE_WEIGHT_FOLD(PASTIS_FOLDS[0] if 'PASTIS_FOLDS' in globals() else 1)
    if smoke:
        conf = dict(encoder_widths=[8, 8, 16], decoder_widths=[8, 8, 16], out_conv=[8, 20], str_conv_k=4, str_conv_s=2, str_conv_p=1,
                    agg_mode='att_group', encoder_norm='group', n_head=4, d_model=16, d_k=4)
    else:
        wdir = utae_pretrained_dir()
        conf = json.load(open(wdir / 'conf.json'))
    opt_bands = [b for b in dyn_bands if not b.startswith('OBS_') and not b.startswith('S1')]
    sar_bands = [b for b in dyn_bands if b.startswith('S1')]
    m = UTAEMulti(dyn_bands, static_bands, tasks, conf, opt_bands, sar_bands)
    if pretrained and not smoke and opt_bands == S2_PASTIS:
        ck = torch.load(wdir / f'Fold_{fold}' / 'model.pth.tar', map_location='cpu', weights_only=False)
        sd = {k.replace('module.', ''): v for k, v in ck.get('state_dict', ck).items()}
        missing, unexpected = m.opt.load_state_dict(sd, strict=False)
        print(f'loaded published U-TAE weights Fold_{fold} (its test fold = {(fold - 2) % 5 + 1}); missing {len(missing)}, unexpected {len(unexpected)} keys')
    return m


def MODEL_EXTRA_LOSSES_FN(dyn_bands):
    return {}

DEFAULT_EPOCHS = {'pastis': 40, 'yieldsat': (10, 60)}
DEFAULT_BATCH = {'pastis': 4 if GPU_MEM_GB < 60 else 8, 'yieldsat': 16 if GPU_MEM_GB < 60 else 32}
DEFAULT_LR = {'pastis': 3e-4, 'yieldsat': 1e-3}     # lower LR on PASTIS: starts from trained weights
