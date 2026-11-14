# %% [md]
# ## 4 · Shared model parts and weight transfer
# Every model starts with a **band-aware input layer**: a per-pixel linear map whose input columns are tied to band *names* (`B04`, `S1A_VV`, `temp_mean`, …), not positions. That makes transfer between datasets mechanical:
# * columns for bands present in both datasets are copied (the 10 shared Sentinel-2 bands);
# * new bands (`B01`, `B09`, weather) start at zero, so the transferred model initially behaves exactly as before and learns to use them;
# * bands that disappear (SAR in YieldSAT) are dropped.
#
# Static layers (soil, terrain) enter through a separate zero-initialised branch. Output heads are named, and the PASTIS crop head initialises the YieldSAT crop head (Corn → corn, Winter rapeseed → rapeseed, Soybeans → soybean, Soft winter wheat → wheat).

# %%
def day_encoding(days, d, period=1000.0):
    """Sinusoidal encoding of acquisition day (days since season start). days (B,T) -> (B,T,d)."""
    i = torch.arange(d // 2, device=days.device, dtype=torch.float32)
    freq = period ** (-2 * i / d)
    a = days.float()[..., None] * freq
    return torch.cat([torch.sin(a), torch.cos(a)], -1)


class BandLinear(nn.Module):
    """Per-pixel linear layer over named input bands: (…, C_in) -> (…, C_out)."""
    def __init__(self, bands, out_dim):
        super().__init__()
        self.bands = list(bands)
        self.lin = nn.Linear(len(self.bands), out_dim)

    def forward(self, x):
        return self.lin(x)

    @torch.no_grad()
    def adapted(self, new_bands):
        new = BandLinear(new_bands, self.lin.out_features).to(self.lin.weight.device)
        new.lin.weight.zero_(); new.lin.bias.copy_(self.lin.bias)
        copied = []
        for j, b in enumerate(new_bands):
            if b in self.bands:
                new.lin.weight[:, j] = self.lin.weight[:, self.bands.index(b)]; copied.append(b)
        print(f'  input layer: copied {len(copied)}/{len(new_bands)} bands {copied}; new (zero-init): {[b for b in new_bands if b not in copied]}')
        return new


class StaticBranch(nn.Module):
    """Static per-pixel layers (soil, DEM, coordinates) -> feature map; output layer zero-initialised."""
    def __init__(self, bands, dim):
        super().__init__()
        self.bands = list(bands)
        self.net = nn.Sequential(nn.Conv2d(len(bands), dim, 1), nn.GELU(), nn.Conv2d(dim, dim, 1))
        nn.init.zeros_(self.net[2].weight); nn.init.zeros_(self.net[2].bias)

    def forward(self, s):
        return self.net(s)


class Heads(nn.Module):
    """Named task heads on a shared feature map."""
    def __init__(self, c, tasks):
        super().__init__()
        self.tasks = dict(tasks)
        self.trunk = nn.Sequential(nn.Conv2d(c, c, 3, padding=1), nn.GroupNorm(min(8, c), c), nn.GELU())
        self.out = nn.ModuleDict({k: nn.Conv2d(c, n, 1) for k, n in self.tasks.items()})

    def forward(self, f):
        f = self.trunk(f)
        return {k: m(f) for k, m in self.out.items()}

    @torch.no_grad()
    def adapted(self, new_tasks, class_map=None):
        """class_map: {'crop': {new_class_index: old_class_index}} copies classifier rows from 'sem'."""
        c = self.trunk[0].in_channels
        new = Heads(c, new_tasks).to(self.trunk[0].weight.device)
        new.trunk.load_state_dict(self.trunk.state_dict())
        for k, n in new_tasks.items():
            if k in self.out and self.out[k].out_channels == n:
                new.out[k].load_state_dict(self.out[k].state_dict()); print(f'  head {k}: transferred')
            elif class_map and k in class_map and 'sem' in self.out:
                for j, i in class_map[k].items():
                    new.out[k].weight[j] = self.out['sem'].weight[i]; new.out[k].bias[j] = self.out['sem'].bias[i]
                print(f'  head {k}: rows initialised from sem classes {class_map[k]}')
            else:
                print(f'  head {k}: new')
        return new


PASTIS_TO_CROP = {'corn': 3, 'maize': 3, 'rapeseed': 5, 'canola': 5, 'soy': 15, 'wheat': 2, 'barley': 4, 'sunflower': 7, 'sorghum': 18, 'potato': 13, 'beet': 9}

def crop_class_map(crop_names):
    m = {}
    for j, c in enumerate(crop_names):
        for k, i in PASTIS_TO_CROP.items():
            if k in c.lower(): m[j] = i; break
    return m


class TemporalPool(nn.Module):
    """Attention pooling over time with a validity mask. x (B,C,T,H,W), mask (B,T) -> (B,C,H,W)."""
    def __init__(self, c):
        super().__init__()
        self.score = nn.Conv3d(c, 1, 1)

    def forward(self, x, mask):
        s = self.score(x).float().masked_fill(~mask[:, None, :, None, None], -1e4)
        w = torch.softmax(s, dim=2).to(x.dtype)
        return (x * w).sum(2)


def count_params(m):
    return sum(p.numel() for p in m.parameters())
