#!/usr/bin/env python3
"""Run a notebook end-to-end on tiny synthetic data (CPU), then run it again to test resuming.

    python ml/smoke_test.py ml/notebooks/01_UMamba_PASTIS-R_to_YieldSAT.ipynb [workdir]
"""
import os
import sys
import time
from pathlib import Path

import nbformat
from nbclient import NotebookClient

nb_path = Path(sys.argv[1])
work = Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/sarcrop_smoke').resolve()
work.mkdir(parents=True, exist_ok=True)
os.environ.update(SARCROP_SMOKE='1', SARCROP_ROOT=str(work / 'drive'), SARCROP_LOCAL=str(work / 'local'))
for attempt in (1, 2):
    nb = nbformat.read(nb_path, as_version=4)
    t0 = time.time()
    NotebookClient(nb, timeout=3600, kernel_name='python3', resources={'metadata': {'path': str(work)}}).execute()
    print(f'run {attempt}: OK in {time.time() - t0:.0f}s')
    for c in nb.cells:
        if c.cell_type == 'code':
            for o in c.get('outputs', []):
                txt = o.get('text', '') or ''.join(o.get('data', {}).get('text/plain', ''))
                for line in txt.splitlines():
                    if any(k in line for k in ('test:', 'resuming', 'already finished', 'loaded PASTIS', 'input layer', 'head ', 'static branch', 'parameters', 'check passed', 'Mamba backend')):
                        print('   ', line[:220])
