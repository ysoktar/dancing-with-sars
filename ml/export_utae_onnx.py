#!/usr/bin/env python3
"""Export the pretrained U-TAE (PASTIS semantic segmentation) to ONNX for the website.

    python ml/export_utae_onnx.py <UTAE_SemanticSeg_weights.zip | Fold_k/model.pth.tar> <NORM_S2_patch.json> [fold]

Weights: Garnot & Landrieu 2021, "Panoptic Segmentation of Satellite Image Time Series with
Convolutional Temporal Attention Networks" (ICCV), github.com/VSainteuf/utae-paps, Zenodo 5172293.
The network below is a compact re-implementation with the SAME parameter names, written for
inference export (no temporal padding path: every date passed in is a real observation).
The checkpoint is read with torch.load(weights_only=True): tensors only, no code is executed.

To export YOUR fine-tuned checkpoint instead (notebook 03 saves best.pt / last.pt), pass that
file: a {'model': state_dict} or {'state_dict': ...} checkpoint, or a bare state_dict, works.

Writes web/public/models/utae_pastis.onnx and utae_pastis.json (classes, bands, normalisation,
reference date, fold, test mIoU).
"""
import io
import json
import sys
import zipfile
from pathlib import Path

import torch
import torch.nn as nn

OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "models"
CLASSES = ['Background', 'Meadow', 'Soft winter wheat', 'Corn', 'Winter barley', 'Winter rapeseed', 'Spring barley',
           'Sunflower', 'Grapevine', 'Beet', 'Winter triticale', 'Winter durum wheat', 'Fruits, vegetables, flowers',
           'Potatoes', 'Leguminous fodder', 'Soybeans', 'Orchard', 'Mixed cereal', 'Sorghum', 'Void label']
BANDS = ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12']


def conv_layer(nk, norm='batch', k=3, s=1, p=1, last_relu=True, groups=4):
    layers = []
    for i in range(len(nk) - 1):
        layers.append(nn.Conv2d(nk[i], nk[i + 1], k, s, p, padding_mode='reflect'))
        if norm == 'batch': layers.append(nn.BatchNorm2d(nk[i + 1]))
        elif norm == 'group': layers.append(nn.GroupNorm(groups, nk[i + 1]))
        if last_relu or i < len(nk) - 2: layers.append(nn.ReLU())
    return nn.Sequential(*layers)


class ConvLayer(nn.Module):
    def __init__(self, nk, **kw):
        super().__init__(); self.conv = conv_layer(nk, **kw)
    def forward(self, x): return self.conv(x)


class ConvBlock(nn.Module):
    def __init__(self, nk, norm='batch'):
        super().__init__(); self.conv = ConvLayer(nk, norm=norm)
    def forward(self, x): return self.conv(x)


class DownConvBlock(nn.Module):
    def __init__(self, d_in, d_out, norm):
        super().__init__()
        self.down = ConvLayer([d_in, d_in], norm=norm, k=4, s=2, p=1)
        self.conv1 = ConvLayer([d_in, d_out], norm=norm)
        self.conv2 = ConvLayer([d_out, d_out], norm=norm)
    def forward(self, x):
        x = self.conv1(self.down(x)); return x + self.conv2(x)


class UpConvBlock(nn.Module):
    def __init__(self, d_in, d_out, d_skip):
        super().__init__()
        self.skip_conv = nn.Sequential(nn.Conv2d(d_skip, d_skip, 1), nn.BatchNorm2d(d_skip), nn.ReLU())
        self.up = nn.Sequential(nn.ConvTranspose2d(d_in, d_out, 4, 2, 1), nn.BatchNorm2d(d_out), nn.ReLU())
        self.conv1 = ConvLayer([d_out + d_skip, d_out], norm='batch')
        self.conv2 = ConvLayer([d_out, d_out], norm='batch')
    def forward(self, x, skip):
        x = torch.cat([self.up(x), self.skip_conv(skip)], 1)
        x = self.conv1(x); return x + self.conv2(x)


class MultiHeadAttention(nn.Module):
    def __init__(self, n_head, d_k, d_in):
        super().__init__()
        self.n_head, self.d_k, self.d_in = n_head, d_k, d_in
        self.Q = nn.Parameter(torch.zeros(n_head, d_k))
        self.fc1_k = nn.Linear(d_in, n_head * d_k)
    def forward(self, v):                                   # v: (N, T, d_in)
        n, t, _ = v.shape
        k = self.fc1_k(v).view(n, t, self.n_head, self.d_k).permute(2, 0, 1, 3)        # h,N,T,dk
        att = torch.einsum('hd,hntd->hnt', self.Q, k) / (self.d_k ** 0.5)
        att = torch.softmax(att, -1)                                                  # h,N,T
        vh = v.view(n, t, self.n_head, self.d_in // self.n_head).permute(2, 0, 1, 3)   # h,N,T,c
        out = torch.einsum('hnt,hntc->hnc', att, vh)
        return out, att


class LTAE2d(nn.Module):
    def __init__(self, in_channels=128, n_head=16, d_k=4, d_model=256, T=1000):
        super().__init__()
        self.n_head, self.d_model, self.T = n_head, d_model, T
        self.inconv = nn.Conv1d(in_channels, d_model, 1)
        self.attention_heads = MultiHeadAttention(n_head, d_k, d_model)
        self.in_norm = nn.GroupNorm(n_head, in_channels)
        self.out_norm = nn.GroupNorm(n_head, in_channels)
        self.mlp = nn.Sequential(nn.Linear(d_model, in_channels), nn.BatchNorm1d(in_channels), nn.ReLU())
        d = d_model // n_head
        self.register_buffer('denom', torch.pow(float(T), 2 * (torch.arange(d).float() // 2) / d), persistent=False)

    def forward(self, x, pos):                              # x: B,T,C,H,W  pos: B,T
        b, t, c, h, w = x.shape
        out = x.permute(0, 3, 4, 1, 2).reshape(b * h * w, t, c)
        out = self.in_norm(out.permute(0, 2, 1))
        out = self.inconv(out).permute(0, 2, 1)             # N,T,d_model
        s = pos[:, :, None] / self.denom[None, None, :]     # B,T,d
        pe = torch.stack([torch.sin(s[..., 0::2]), torch.cos(s[..., 1::2])], -1).reshape(b, t, -1)
        pe = pe.repeat(1, 1, self.n_head)                   # B,T,d_model
        pe = pe[:, None, None].expand(b, h, w, t, self.d_model).reshape(b * h * w, t, self.d_model)
        out, att = self.attention_heads(out + pe)
        out = out.permute(1, 0, 2).reshape(b * h * w, -1)
        out = self.out_norm(self.mlp(out))
        out = out.view(b, h, w, -1).permute(0, 3, 1, 2)
        att = att.view(self.n_head, b, h, w, t).permute(0, 1, 4, 2, 3)  # h,B,T,H,W
        return out, att


class UTAE(nn.Module):
    def __init__(self, input_dim=10, enc=(64, 64, 64, 128), dec=(32, 32, 64, 128), out_conv=(32, 20), n_head=16, d_model=256, d_k=4):
        super().__init__()
        self.n_stages, self.n_head = len(enc), n_head
        self.in_conv = ConvBlock([input_dim, enc[0], enc[0]], norm='group')
        self.down_blocks = nn.ModuleList(DownConvBlock(enc[i], enc[i + 1], 'group') for i in range(self.n_stages - 1))
        self.up_blocks = nn.ModuleList(UpConvBlock(dec[i], dec[i - 1], enc[i - 1]) for i in range(self.n_stages - 1, 0, -1))
        self.temporal_encoder = LTAE2d(enc[-1], n_head, d_k, d_model)
        self.out_conv = ConvBlock([dec[0], *out_conv], norm='batch')

    def shared(self, block, x):
        b, t = x.shape[:2]
        y = block(x.flatten(0, 1))
        return y.view(b, t, *y.shape[1:])

    def aggregate(self, x, att):                            # att_group
        hh, b, t, h, w = att.shape
        a = att.reshape(hh * b, t, h, w)
        if x.shape[-1] > w: a = nn.functional.interpolate(a, size=x.shape[-2:], mode='bilinear', align_corners=False)
        a = a.view(hh, b, t, *x.shape[-2:])
        g = torch.stack(x.chunk(hh, dim=2))                 # h,B,T,C/h,H,W
        out = (a[:, :, :, None] * g).sum(2)
        return torch.cat(list(out), 1)

    def forward(self, x, pos):
        maps = [self.shared(self.in_conv, x)]
        for blk in self.down_blocks: maps.append(self.shared(blk, maps[-1]))
        out, att = self.temporal_encoder(maps[-1], pos)
        for i in range(self.n_stages - 1):
            out = self.up_blocks[i](out, self.aggregate(maps[-(i + 2)], att))
        return self.out_conv(out)


def load_state(path, fold):
    p = Path(path)
    if p.suffix == '.zip':
        z = zipfile.ZipFile(p)
        name = next(n for n in z.namelist() if n.endswith(f'Fold_{fold}/model.pth.tar'))
        raw = io.BytesIO(z.read(name))
    else:
        raw = open(p, 'rb')
    ck = torch.load(raw, map_location='cpu', weights_only=True)
    for k in ('state_dict', 'model', 'model_state'):
        if isinstance(ck, dict) and k in ck and isinstance(ck[k], dict): ck = ck[k]
    return {k.replace('module.', ''): v for k, v in ck.items()}


def main():
    wpath, npath = sys.argv[1], sys.argv[2]
    fold = int(sys.argv[3]) if len(sys.argv) > 3 else 2
    m = UTAE().eval()
    sd = load_state(wpath, fold)
    missing, unexpected = m.load_state_dict(sd, strict=False)
    missing = [k for k in missing if not k.endswith('denom')]
    print(f'loaded {len(sd)} tensors · missing {missing} · unexpected {unexpected}')
    assert not missing and not unexpected, 'parameter names do not match'
    norm = json.loads(Path(npath).read_text())
    mean = [sum(norm[f]['mean'][i] for f in norm) / len(norm) for i in range(10)]
    std = [sum(norm[f]['std'][i] for f in norm) / len(norm) for i in range(10)]
    T = 12
    x, pos = torch.randn(1, T, 10, 128, 128), torch.linspace(0, 400, T)[None]
    with torch.no_grad():
        y = m(x, pos)
    print('test forward', tuple(y.shape))
    OUT.mkdir(parents=True, exist_ok=True)
    onnx = OUT / 'utae_pastis.onnx'
    torch.onnx.export(m, (x, pos), onnx, input_names=['x', 'pos'], output_names=['logits'], opset_version=17,
                      dynamic_axes={'x': {1: 'T'}, 'pos': {1: 'T'}}, dynamo=False)
    metrics = {}
    if Path(wpath).suffix == '.zip':
        z = zipfile.ZipFile(wpath)
        n = next((n for n in z.namelist() if n.endswith(f'Fold_{fold}/test_metrics.json')), None)
        if n: metrics = json.loads(z.read(n))
    meta = {'model': 'U-TAE (Garnot & Landrieu, ICCV 2021), pretrained on PASTIS', 'weights': 'Zenodo 5172293', 'fold': fold,
            'classes': CLASSES, 'bands': BANDS, 'mean': mean, 'std': std, 'refDate': '2018-09-01', 'tile': 128, 'gsd_m': 10,
            'testMetrics': metrics, 'note': 'Trained on Sentinel-2 time series over France (Sept 2018 - Nov 2019).'}
    (OUT / 'utae_pastis.json').write_text(json.dumps(meta, indent=1))
    print('wrote', onnx, f'{onnx.stat().st_size / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
