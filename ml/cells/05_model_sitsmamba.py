# %% [md]
# ## 5 · Model: SITSMamba
# **SITSMamba** ([Qin et al. 2024, arXiv:2409.09673](https://arxiv.org/abs/2409.09673); code: [XiaoleiQinn/SITSMamba](https://github.com/XiaoleiQinn/SITSMamba)) combines
# * a **CNN spatial encoder** applied to every date,
# * a **Mamba temporal encoder** that reads each pixel's time series,
# * two decoder branches: a **classification branch** (ConvBlock → crop map) and a **reconstruction branch** (Linear layer that rebuilds the input time series). The reconstruction loss is an extra self-supervised signal that makes the model use the whole temporal profile, not just the label.
#
# Implemented here from the paper description. No pretrained weights are published.
#
# Changes for this project:
# * The classification branch feeds **several heads** (crop type plus field extent, boundary and distance on PASTIS; crop, extent and **yield** on YieldSAT).
# * Masked attention pooling over time handles missing dates (clouds, out-of-season steps).
# * Band-aware input layer, a static-data branch, and a band-named reconstruction head, so the reconstruction target can change between datasets.

# %%
MODEL_NAME = 'sitsmamba'
RECON_WEIGHT = 0.1          # weight of the reconstruction loss (paper: auxiliary branch)


class BandHead(nn.Module):
    """Linear output layer whose outputs are named bands (used for reconstruction)."""
    def __init__(self, d, bands):
        super().__init__()
        self.bands = list(bands)
        self.lin = nn.Linear(d, len(self.bands))

    def forward(self, x):
        return self.lin(x)

    @torch.no_grad()
    def adapted(self, new_bands):
        new = BandHead(self.lin.in_features, new_bands).to(self.lin.weight.device)
        for j, b in enumerate(new_bands):
            if b in self.bands:
                new.lin.weight[j] = self.lin.weight[self.bands.index(b)]; new.lin.bias[j] = self.lin.bias[self.bands.index(b)]
        return new


class MambaBlock(nn.Module):
    def __init__(self, d, d_state=16):
        super().__init__()
        self.norm = nn.LayerNorm(d); self.mamba = make_mamba(d, d_state=d_state)

    def forward(self, x):
        return x + self.mamba(self.norm(x))


class SITSMamba(nn.Module):
    def __init__(self, dyn_bands, static_bands, tasks, d=64, spatial_layers=2, temporal_layers=3, d_state=16):
        super().__init__()
        self.cfg = dict(d=d, spatial_layers=spatial_layers, temporal_layers=temporal_layers, d_state=d_state)
        self.stem = BandLinear(dyn_bands, d)
        sp = []
        for _ in range(spatial_layers):
            sp += [nn.Conv2d(d, d, 3, padding=1), nn.GroupNorm(8 if d % 8 == 0 else 1, d), nn.GELU()]
        self.spatial = nn.Sequential(*sp)
        self.day = nn.Linear(d, d)
        self.temporal = nn.ModuleList([MambaBlock(d, d_state) for _ in range(temporal_layers)])
        self.norm = nn.LayerNorm(d)
        self.score = nn.Linear(d, 1)
        self.recon = BandHead(d, [b for b in dyn_bands if not b.startswith('OBS_')])
        self.cbranch = nn.Sequential(nn.Conv2d(d, d, 3, padding=1), nn.GroupNorm(8 if d % 8 == 0 else 1, d), nn.GELU(),
                                     nn.Conv2d(d, d, 3, padding=1), nn.GroupNorm(8 if d % 8 == 0 else 1, d), nn.GELU())
        self.static = StaticBranch(static_bands, d) if static_bands else None
        self.heads = Heads(d, tasks)

    def forward(self, batch):
        x, days, tmask = batch['x'], batch['days'], batch['tmask']
        b, t, c, h, w = x.shape
        z = self.stem(x.permute(0, 1, 3, 4, 2))                               # (B,T,H,W,d)
        d = z.shape[-1]
        z = self.spatial(z.reshape(b * t, h, w, d).permute(0, 3, 1, 2))       # CNN spatial encoder, every date
        z = z.reshape(b, t, d, h, w) + self.day(day_encoding(days, d))[:, :, :, None, None]
        seq = z.permute(0, 3, 4, 1, 2).reshape(b * h * w, t, d)               # one sequence per pixel
        for blk in self.temporal:
            seq = blk(seq)
        seq = self.norm(seq)
        recon = self.recon(seq).reshape(b, h, w, t, -1).permute(0, 3, 4, 1, 2)   # (B,T,Cr,H,W)
        m = tmask[:, None, None, :].expand(b, h, w, t).reshape(b * h * w, t)
        a = torch.softmax(self.score(seq).squeeze(-1).float().masked_fill(~m, -1e4), -1).to(seq.dtype)
        f = (seq * a.unsqueeze(-1)).sum(1).reshape(b, h, w, d).permute(0, 3, 1, 2)
        f = self.cbranch(f)
        if self.static is not None and batch.get('static') is not None:
            f = f + self.static(batch['static'])
        out = self.heads(f)
        out['recon'] = recon
        return out

    def adapt(self, dyn_bands, static_bands, tasks, class_map=None):
        d = self.cfg['d']
        self.stem = self.stem.adapted(dyn_bands)
        self.recon = self.recon.adapted([b for b in dyn_bands if not b.startswith('OBS_')])
        self.static = StaticBranch(static_bands, d).to(self.day.weight.device) if static_bands else None
        if static_bands: print(f'  static branch: new, {len(static_bands)} bands (zero-initialised output)')
        self.heads = self.heads.adapted(tasks, class_map)
        return self

    def backbone_parameters(self):
        skip = set(map(id, list(self.stem.parameters()) + list(self.heads.parameters()) + list(self.recon.parameters()) +
                       (list(self.static.parameters()) if self.static is not None else [])))
        return [p for p in self.parameters() if id(p) not in skip]


def build_model(dyn_bands, static_bands, tasks, smoke=SMOKE):
    if smoke:
        return SITSMamba(dyn_bands, static_bands, tasks, d=16, spatial_layers=1, temporal_layers=1, d_state=4)
    return SITSMamba(dyn_bands, static_bands, tasks, d=64, spatial_layers=2, temporal_layers=3, d_state=16)


def recon_loss(out, batch, dyn_bands):
    """Masked MSE between reconstructed and observed (normalised) input bands."""
    rb = [b for b in dyn_bands if not b.startswith('OBS_')]
    idx = [dyn_bands.index(b) for b in rb]
    tgt = batch['x'][:, :, idx].float()
    def flag(band):   # which observation flag covers this band (S1 bands -> OBS_S1, others -> OBS_S2)
        f = 'OBS_S1' if band.startswith('S1') else 'OBS_S2'
        return dyn_bands.index(f) if f in dyn_bands else None
    cols = [flag(b) for b in rb]
    obs = torch.stack([batch['x'][:, :, c] if c is not None else torch.ones_like(batch['x'][:, :, 0]) for c in cols], 2)
    m = (obs > 0).float() * batch['tmask'][:, :, None, None, None].float()
    return (((out['recon'].float() - tgt) ** 2) * m).sum() / (m.sum() + 1e-6)

def MODEL_EXTRA_LOSSES_FN(dyn_bands):
    return {'recon': (RECON_WEIGHT, lambda out, batch: recon_loss(out, batch, dyn_bands))}

DEFAULT_EPOCHS = {'pastis': 100, 'yieldsat': (10, 60)}
DEFAULT_BATCH = {'pastis': 4 if GPU_MEM_GB < 60 else 8, 'yieldsat': 16 if GPU_MEM_GB < 60 else 32}
DEFAULT_LR = {'pastis': 1e-3, 'yieldsat': 1e-3}
