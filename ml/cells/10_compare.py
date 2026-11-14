# %% [md]
# ## Delete old runs
# Runs listed in `DELETE_RUNS` are removed from Drive, together with old reports:
# * `utae_pretrained/pastis/fold1`: loaded the wrong published fold, so its test score is leaked (replaced by `fold1_w`);
# * `sitsmamba/pastis/fold1` and `umamba/pastis/fold1`: started with the old, slow Mamba fallback.
#
# A run whose `last.pt` was written in the last 20 minutes is treated as still training and is skipped unless `FORCE_DELETE = True`.

# %%
DELETE_RUNS = ['utae_pretrained/pastis/fold1', 'sitsmamba/pastis/fold1', 'umamba/pastis/fold1']
DELETE_OLD_REPORTS = True
FORCE_DELETE = False


def last_write(run_dir):
    files = [p for p in run_dir.rglob('*') if p.is_file()]
    return max((p.stat().st_mtime for p in files), default=0)


for r in DELETE_RUNS:
    d = P['runs'] / r
    if not d.exists():
        print('already gone:', r); continue
    age_min = (time.time() - last_write(d)) / 60
    if age_min < 20 and not FORCE_DELETE:
        print(f'SKIPPED {r}: written {age_min:.0f} min ago, looks like it is still training (set FORCE_DELETE = True)'); continue
    shutil.rmtree(d); print('deleted', r)
if DELETE_OLD_REPORTS:
    for d in P['reports'].glob('*'):
        if d.is_dir(): shutil.rmtree(d)
    print('deleted old reports')

# %% [md]
# ## Compare all runs
# Collects `test_metrics.json` and `metrics.csv` from every model and stage, then writes:
# `reports/latest/summary_pastis.csv`, `summary_yieldsat.csv`, `learning_curves.png`, `per_class_iou.png` and `report.md` (with a timestamped copy).

# %%
import pandas as pd
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt

rows = {'pastis': [], 'yieldsat': []}
curves = {'pastis': {}, 'yieldsat': {}}
per_class = {}
for mdir in sorted(P['runs'].glob('*')):
    for stage in ('pastis', 'yieldsat'):
        for rdir in sorted((mdir / stage).glob('*')):
            tm = rdir / 'test_metrics.json'
            mc = rdir / 'metrics.csv'
            cfg = json.load(open(rdir / 'config.json')) if (rdir / 'config.json').exists() else {}
            age = (time.time() - max((p.stat().st_mtime for p in rdir.rglob('*') if p.is_file()), default=0)) / 60
            r = dict(model=mdir.name, run=rdir.name, status='done' if tm.exists() else ('running' if age < 20 else 'stopped'))
            if mc.exists():
                df = pd.read_csv(mc)
                curves[stage][f'{mdir.name}/{rdir.name}'] = df
                r.update(epochs=int(df['epoch'].max()), sec_per_epoch=round(float(df['time_s'].mean()), 1))
            if tm.exists():
                t = json.load(open(tm))
                r.update({k: v for k, v in t.items() if not isinstance(v, (list, dict))})
                if 'per_class_IoU' in t: per_class[f'{mdir.name}/{rdir.name}'] = t['per_class_IoU']
            rows[stage].append(r)

out = P['reports'] / 'latest'
out.mkdir(parents=True, exist_ok=True)
cols = {'pastis': ['model', 'run', 'status', 'mIoU', 'OA', 'extent_IoU', 'boundary_F1', 'dist_MAE', 'params', 'epochs', 'best_epoch', 'sec_per_epoch'],
        'yieldsat': ['model', 'run', 'status', 'pixel_RMSE', 'pixel_MAE', 'pixel_R2', 'field_RMSE', 'field_R2', 'crop_field_acc', 'crop_pixel_acc', 'extent_IoU', 'params', 'epochs', 'best_epoch', 'sec_per_epoch']}
tables = {}
for stage in rows:
    df = pd.DataFrame(rows[stage])
    if len(df):
        df = df[[c for c in cols[stage] if c in df.columns]]
        df.to_csv(out / f'summary_{stage}.csv', index=False)
    tables[stage] = df
    print(f'\n=== {stage} (test split)'); print(df.round(4).to_string(index=False) if len(df) else 'no runs yet')

fig, ax = plt.subplots(1, 2, figsize=(14, 4.5))
for name, df in curves['pastis'].items():
    if 'val_mIoU' in df: ax[0].plot(df['epoch'], df['val_mIoU'], label=name)
for name, df in curves['yieldsat'].items():
    if 'val_pixel_RMSE' in df: ax[1].plot(df['epoch'], df['val_pixel_RMSE'], label=name)
ax[0].set(title='PASTIS-R · validation mIoU', xlabel='epoch'); ax[1].set(title='YieldSAT · validation pixel RMSE (t/ha)', xlabel='epoch')
for a in ax:
    if a.get_legend_handles_labels()[0]: a.legend(fontsize=8)
    else: a.text(0.5, 0.5, 'no runs yet', ha='center', va='center', transform=a.transAxes, color='gray')
    a.grid(alpha=0.3)
plt.tight_layout(); fig.savefig(out / 'learning_curves.png', dpi=110); plt.close(fig)

if per_class:
    fig, ax = plt.subplots(figsize=(14, 4.5))
    w = 0.8 / len(per_class)
    for i, (name, v) in enumerate(per_class.items()):
        v = [x if x is not None else 0 for x in v[:19]]
        ax.bar(np.arange(len(v)) + i * w, v, w, label=name)
    ax.set_xticks(np.arange(19) + 0.4, PASTIS_CLASSES[:19], rotation=60, ha='right', fontsize=8)
    ax.set(ylabel='IoU', title='PASTIS-R · per-class IoU (test)'); ax.legend(fontsize=8)
    plt.tight_layout(); fig.savefig(out / 'per_class_iou.png', dpi=110); plt.close(fig)

md = ['# Model comparison', f'Generated {dt.datetime.now():%Y-%m-%d %H:%M}', '']
for stage, df in tables.items():
    try: tbl = df.round(4).to_markdown(index=False)
    except Exception: tbl = df.round(4).to_string(index=False)
    md += [f'## {stage}', '', tbl, '']
md += ['![learning curves](learning_curves.png)', '', '![per-class IoU](per_class_iou.png)']
(out / 'report.md').write_text('\n'.join(md))
stamp = P['reports'] / dt.datetime.now().strftime('%Y%m%d_%H%M')
shutil.copytree(out, stamp, dirs_exist_ok=True)
print('\nreport written to', out, 'and', stamp)
