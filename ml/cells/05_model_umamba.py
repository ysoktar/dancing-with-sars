# %% [md]
# ## 5 · Model: U-Mamba for satellite image time series
# **U-Mamba** ([Ma, Li & Wang 2024, arXiv:2401.04722](https://arxiv.org/abs/2401.04722)) is a U-Net whose encoder stages combine residual convolution blocks with a **Mamba layer that scans all voxels of the stage as one long sequence**, to capture long-range dependencies (the "U-Mamba_Enc" variant). It was designed for 3-D medical volumes.
#
# Changes made for satellite time series:
# * **Time is the third axis**: the input is a (time × height × width) volume, so 3-D residual blocks mix space and time. Downsampling is spatial only, so every date is kept.
# * Mamba runs on the flattened (T·H·W) tokens of the deeper stages (`MAMBA_STAGES`); the shallow stages would be 400 k tokens long.
# * **Acquisition dates** are added as a sinusoidal encoding, because satellite dates are irregular.
# * Skip connections are collapsed over time with masked **attention pooling** (missing dates are ignored), and decoding is 2-D.
# * Band-aware input layer, a static-data branch and named multi-task heads (section 4).
#
# Note: arXiv 2604.00940, the link in the request, is the YieldSAT dataset paper. The U-Mamba architecture paper is 2401.04722.

# %%
MODEL_NAME = 'umamba'


class Res3d(nn.Module):
    def __init__(self, cin, cout, stride=1):
        super().__init__()
        s = (1, stride, stride)
        self.c1 = nn.Conv3d(cin, cout, 3, stride=s, padding=1, bias=False); self.n1 = nn.InstanceNorm3d(cout, affine=True)
        self.c2 = nn.Conv3d(cout, cout, 3, padding=1, bias=False); self.n2 = nn.InstanceNorm3d(cout, affine=True)
        self.skip = nn.Identity() if (cin == cout and stride == 1) else nn.Sequential(nn.Conv3d(cin, cout, 1, stride=s, bias=False), nn.InstanceNorm3d(cout, affine=True))
        self.act = nn.LeakyReLU(0.01, inplace=True)

    def forward(self, x):
        return self.act(self.n2(self.c2(self.act(self.n1(self.c1(x))))) + self.skip(x))


class Res2d(nn.Module):
    def __init__(self, cin, cout):
        super().__init__()
        self.c1 = nn.Conv2d(cin, cout, 3, padding=1, bias=False); self.n1 = nn.InstanceNorm2d(cout, affine=True)
        self.c2 = nn.Conv2d(cout, cout, 3, padding=1, bias=False); self.n2 = nn.InstanceNorm2d(cout, affine=True)
        self.skip = nn.Identity() if cin == cout else nn.Conv2d(cin, cout, 1, bias=False)
        self.act = nn.LeakyReLU(0.01, inplace=True)

    def forward(self, x):
        return self.act(self.n2(self.c2(self.act(self.n1(self.c1(x))))) + self.skip(x))


class MambaLayer3d(nn.Module):
    """U-Mamba's Mamba layer: LayerNorm + Mamba over all (T·H·W) tokens (residual added for stability)."""
    def __init__(self, c, d_state=16):
        super().__init__()
        self.norm = nn.LayerNorm(c)
        self.mamba = make_mamba(c, d_state=d_state)

    def forward(self, x):
        b, c, t, h, w = x.shape
        tok = x.flatten(2).transpose(1, 2)                      # (B, T·H·W, C)
        out = self.mamba(self.norm(tok))
        return x + out.transpose(1, 2).reshape(b, c, t, h, w)


class UMambaSITS(nn.Module):
    def __init__(self, dyn_bands, static_bands, tasks, widths=(32, 64, 128, 256), blocks=2, mamba_stages=(2, 3), d_state=16):
        super().__init__()
        self.cfg = dict(widths=list(widths), blocks=blocks, mamba_stages=list(mamba_stages), d_state=d_state)
        w0 = widths[0]
        self.stem = BandLinear(dyn_bands, w0)
        self.day = nn.Linear(w0, w0)
        self.enc = nn.ModuleList(); self.mamba = nn.ModuleList(); self.pool = nn.ModuleList()
        cin = w0
        for i, w in enumerate(widths):
            layers = [Res3d(cin, w, stride=2 if i > 0 else 1)] + [Res3d(w, w) for _ in range(blocks - 1)]
            self.enc.append(nn.Sequential(*layers))
            self.mamba.append(MambaLayer3d(w, d_state) if i in mamba_stages else nn.Identity())
            self.pool.append(TemporalPool(w))
            cin = w
        self.up = nn.ModuleList([nn.ConvTranspose2d(widths[i + 1], widths[i], 2, stride=2) for i in range(len(widths) - 1)])
        self.dec = nn.ModuleList([Res2d(2 * widths[i], widths[i]) for i in range(len(widths) - 1)])
        self.static = StaticBranch(static_bands, w0) if static_bands else None
        self.static_deep = self._zero_conv(w0, widths[-1]) if static_bands else None
        self.heads = Heads(w0, tasks)

    @staticmethod
    def _zero_conv(cin, cout):
        c = nn.Conv2d(cin, cout, 1); nn.init.zeros_(c.weight); nn.init.zeros_(c.bias); return c

    def forward(self, batch):
        x, days, tmask = batch['x'], batch['days'], batch['tmask']           # x (B,T,C,H,W)
        b, t, c, h, w = x.shape
        z = self.stem(x.permute(0, 1, 3, 4, 2))                             # (B,T,H,W,E)
        z = z + self.day(day_encoding(days, z.shape[-1]))[:, :, None, None, :]
        z = z.permute(0, 4, 1, 2, 3).contiguous()                           # (B,E,T,H,W)
        skips = []
        for enc, mam, pool in zip(self.enc, self.mamba, self.pool):
            z = mam(enc(z))
            skips.append(pool(z, tmask))
        f = skips[-1]
        s = None
        if self.static is not None and batch.get('static') is not None:
            s = self.static(batch['static'])
            f = f + self.static_deep(F.adaptive_avg_pool2d(s, f.shape[-2:]))
        for i in reversed(range(len(self.up))):
            f = self.dec[i](torch.cat([self.up[i](f), skips[i]], 1))
        if s is not None:
            f = f + s
        return self.heads(f)

    def adapt(self, dyn_bands, static_bands, tasks, class_map=None):
        """Transfer to a new dataset: remap input bands, add a static branch, re-head."""
        w0 = self.cfg['widths'][0]
        self.stem = self.stem.adapted(dyn_bands)
        if static_bands:
            self.static = StaticBranch(static_bands, w0).to(self.day.weight.device)
            self.static_deep = self._zero_conv(w0, self.cfg['widths'][-1]).to(self.day.weight.device)
            print(f'  static branch: new, {len(static_bands)} bands (zero-initialised output)')
        else:
            self.static = self.static_deep = None
        self.heads = self.heads.adapted(tasks, class_map)
        return self

    def backbone_parameters(self):
        skip = set(map(id, list(self.stem.parameters()) + list(self.heads.parameters()) +
                       (list(self.static.parameters()) + list(self.static_deep.parameters()) if self.static is not None else [])))
        return [p for p in self.parameters() if id(p) not in skip]


def build_model(dyn_bands, static_bands, tasks, smoke=SMOKE):
    if smoke:
        return UMambaSITS(dyn_bands, static_bands, tasks, widths=(8, 16, 32), blocks=1, mamba_stages=(1, 2), d_state=4)
    return UMambaSITS(dyn_bands, static_bands, tasks, widths=(32, 64, 128, 256), blocks=2, mamba_stages=(2, 3), d_state=16)

def MODEL_EXTRA_LOSSES_FN(dyn_bands):
    return {}   # U-Mamba is trained with the task losses only

DEFAULT_EPOCHS = {'pastis': 100, 'yieldsat': (10, 60)}
DEFAULT_BATCH = {'pastis': 4 if GPU_MEM_GB < 60 else 8, 'yieldsat': 16 if GPU_MEM_GB < 60 else 32}
DEFAULT_LR = {'pastis': 1e-3, 'yieldsat': 1e-3}
