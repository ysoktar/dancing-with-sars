#!/usr/bin/env python3
"""Change twins for the globe, from the outputs of the Change-Twin notebook (NISAR GCOV + Mamba VAE).

Input: the notebook's output folder (changetwin_out/: scored_fields.parquet, fingerprints.npy, nisar_calendar.npz).
For every field with a valid season series: its 32-D fingerprint is mean-centred over all fields and L2-normalised
(as in the notebook), and its three most similar fields in OTHER regions are found by cosine similarity. The season
curves (HH and HV - HH on 30 calendar slots, southern hemisphere shifted by half a year) are kept for the small
charts. Writes web/public/data/twins.json.

Usage: python3 pipeline/build_twins.py path/to/changetwin_out
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1] if len(sys.argv) > 1 else 'changetwin_out')

f = pd.read_parquet(src / 'scored_fields.parquet')
fp = np.load(src / 'fingerprints.npy').astype(np.float64)
cal = np.load(src / 'nisar_calendar.npz', allow_pickle=True)
X, ch = cal['X'], list(cal['channels'])
ico, irt, iob = ch.index('copol_db'), ch.index('ratio_db'), ch.index('obs_mask')

keep = f['valid_series'].fillna(False).to_numpy() & np.isfinite(fp).all(1)
idx = np.where(keep)[0]
Z = fp[idx] - fp[idx].mean(0, keepdims=True)
Z /= np.linalg.norm(Z, axis=1, keepdims=True) + 1e-12
S = Z @ Z.T
reg = f['region'].to_numpy()[idx]

out = []
for a, i in enumerate(idx):
    r = f.iloc[i]
    sims = S[a].copy()
    sims[reg == reg[a]] = -2                      # twins must come from another region
    top = np.argsort(-sims)[:3]
    out.append({
        'id': str(r['field_id']), 'region': str(r['region']), 'lat': round(float(r['lat']), 5), 'lon': round(float(r['lon']), 5),
        'ha': round(float(r['area_ha']), 1), 'label': None if pd.isna(r['label']) else str(r['label']),
        'labelled': bool(r['labelled']), 'active': bool(r['active']) if not pd.isna(r['active']) else False,
        'z': None if pd.isna(r['anomaly_z']) else round(float(r['anomaly_z']), 2),
        'pct': None if pd.isna(r['anomaly_pct']) else round(float(r['anomaly_pct']), 3),
        'hh': [round(float(v), 1) for v in X[i, :, ico]], 'rt': [round(float(v), 1) for v in X[i, :, irt]],
        'obs': [int(v) for v in X[i, :, iob]],
        'twins': [[int(t), round(float(sims[t]), 3)] for t in top],
    })
regions = sorted(set(reg))
doc = {
    'source': 'Change-Twin notebook: NISAR L2 GCOV field means (linear power -> dB), 30-slot season calendar, SAR Mamba VAE 32-D fingerprints',
    'method': 'twins = highest cosine similarity of mean-centred, L2-normalised fingerprints, other regions only',
    'slots': int(X.shape[1]), 'regions': regions, 'fields': out,
}
dst = ROOT / 'web' / 'public' / 'data' / 'twins.json'
dst.write_text(json.dumps(doc, separators=(',', ':')))
print(len(out), 'fields,', len(regions), 'regions ->', dst, f'{dst.stat().st_size / 1e6:.2f} MB')
