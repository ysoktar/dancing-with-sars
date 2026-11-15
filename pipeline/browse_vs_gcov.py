"""Compare NISAR browse brightness with calibrated GCOV gamma0 (dB) of the same granule.

Usage: python pipeline/browse_vs_gcov.py LON,LAT,K [...]   (K-th most recent granule over the point)
Reads 7 blocks of 512x512 of HHHH / HVHV over HTTPS range requests (~70 MB, needs an Earthdata token) and prints the
median browse value per 2 dB bin. Result (Nov 2026): the browse stretch is non-linear and differs per granule.
"""
import h5py, numpy as np, io, time, json, sys, urllib.request, urllib.parse
from PIL import Image
from pyproj import Transformer
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from h5remote import RangeFile
import build_data as bd

def sample_granule(g0, spots=((0.3,0.3),(0.3,0.7),(0.7,0.3),(0.7,0.7),(0.5,0.5),(0.5,0.2),(0.5,0.8))):
    f = RangeFile(g0['downloadUrl']); h = h5py.File(f, 'r'); g = h['/science/LSAR/GCOV/grids/frequencyA']
    ny, nx = g['HHHH'].shape; epsg = int(g['projection'][()]); x = g['xCoordinates'][:]; y = g['yCoordinates'][:]
    inv = Transformer.from_crs(epsg, 4326, always_xy=True)
    png = next(b for b in g0['browse'] if b.endswith('_LATLON.png'))
    im = Image.open(io.BytesIO(bd.http_get(png))).convert('RGB')
    try: bounds = bd.parse_kml_bounds(bd.http_get(png[:-4] + '.kml'))
    except Exception: bounds = bd.bounds_from_footprint(im, g0['wkt'])
    W, S, E, N = bounds; arr = np.asarray(im).astype(float)
    pts = []
    for fi, fj in spots:
        i0 = int(ny * fi) // 512 * 512; j0 = int(nx * fj) // 512 * 512
        hh = g['HHHH'][i0:i0 + 512, j0:j0 + 512]; hv = g['HVHV'][i0:i0 + 512, j0:j0 + 512]
        k = 8
        with np.errstate(all='ignore'):
            H = 10 * np.log10(np.nanmean(hh.reshape(64, k, 64, k), axis=(1, 3))); V = 10 * np.log10(np.nanmean(hv.reshape(64, k, 64, k), axis=(1, 3)))
        bb, aa = np.meshgrid(np.arange(64), np.arange(64))
        X = x[j0 + bb * k + k // 2]; Y = y[i0 + aa * k + k // 2]
        lo, la = inv.transform(X, Y)
        px = ((lo - W) / (E - W) * im.size[0]).astype(int); py = ((N - la) / (N - S) * im.size[1]).astype(int)
        ok = (px >= 0) & (px < im.size[0]) & (py >= 0) & (py < im.size[1]) & np.isfinite(H) & np.isfinite(V)
        rgb = arr[np.clip(py, 0, im.size[1] - 1), np.clip(px, 0, im.size[0] - 1)]
        ok &= rgb.sum(-1) > 6
        pts.append(np.stack([H[ok], V[ok], rgb[ok][:, 0], rgb[ok][:, 1]], 1))
    return np.concatenate(pts), f.fetched

if __name__ == '__main__':
    for spec in sys.argv[1:]:
        lon, lat, kk = spec.split(',')
        q = urllib.parse.urlencode(dict(dataset='NISAR', processingLevel='GCOV', intersectsWith=f'POINT({lon} {lat})', output='jsonlite', maxResults=20))
        gs = sorted([g for g in json.load(urllib.request.urlopen('https://api.daac.asf.alaska.edu/services/search/param?' + q, timeout=60))['results'] if any(b.endswith('_LATLON.png') for b in (g.get('browse') or []))], key=lambda g: g['startTime'], reverse=True)
        g0 = gs[int(kk)]
        P, mb = sample_granule(g0)
        line = [g0['productID'][17:40], g0['startTime'][:10], f'{mb/1e6:.0f}MB', len(P)]
        for nm, c, ch in (('HH', 0, 2), ('HV', 1, 3)):
            # binned median browse per dB bin: a direct look at the mapping
            bins = np.arange(-30, 6, 2.0); idx = np.digitize(P[:, c], bins)
            med = {f'{bins[i-1]:.0f}': int(np.median(P[idx == i, ch])) for i in range(1, len(bins)) if (idx == i).sum() > 50}
            line.append(nm + ' ' + json.dumps(med))
        print(' | '.join(map(str, line)), flush=True)
