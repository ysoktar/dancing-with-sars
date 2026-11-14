// Deep-learning crop-type segmentation in the browser (Web Worker).
// Model: U-TAE pretrained on PASTIS (Garnot & Landrieu, ICCV 2021), exported to ONNX by ml/export_utae_onnx.py.
// Input: a Sentinel-2 L2A time series (10 bands, 10 m, 128 x 128 = 1.28 km) read straight from the public
// Cloud-Optimized GeoTIFFs on AWS (Element 84 Earth Search STAC, CORS-enabled) with HTTP range requests.
import * as ort from 'onnxruntime-web';
import { fromUrl } from 'geotiff';

ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
ort.env.wasm.numThreads = 1;

const STAC = 'https://earth-search.aws.element84.com/v1/search';
const ASSET = { B02: 'blue', B03: 'green', B04: 'red', B05: 'rededge1', B06: 'rededge2', B07: 'rededge3', B08: 'nir', B8A: 'nir08', B11: 'swir16', B12: 'swir22' };
let session = null, meta = null;

// WGS84 -> UTM (Snyder), enough for a 1.28 km window
function toUTM(lat, lon, zone) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180, lam = (lon * Math.PI) / 180, lam0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lam0);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let y = k0 * (M + N * Math.tan(phi) * (A * A / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (lat < 0) y += 10000000;
  return [x, y];
}

async function loadModel(base) {
  if (!session) {
    meta = await (await fetch(base + 'models/utae_pastis.json')).json();
    session = await ort.InferenceSession.create(base + 'models/utae_pastis.onnx', { executionProviders: ['wasm'] });
  }
  return meta;
}

/** Pick dates over one PASTIS-like season (1 Sept -> 31 Oct of the next year). */
async function searchItems(lon, lat, season, maxDates) {
  const d = 0.006;
  const body = { collections: ['sentinel-2-l2a'], bbox: [lon - d, lat - d, lon + d, lat + d], datetime: `${season}-09-01T00:00:00Z/${season + 1}-10-31T23:59:59Z`,
    query: { 'eo:cloud_cover': { lt: 30 } }, limit: 200 };
  const r = await fetch(STAC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const feats = (await r.json()).features || [];
  const byDate = new Map();
  for (const f of feats.sort((a, b) => a.properties['eo:cloud_cover'] - b.properties['eo:cloud_cover'])) {
    const day = f.properties.datetime.slice(0, 10);
    if (!byDate.has(day)) byDate.set(day, f);
  }
  const days = [...byDate.keys()].sort();
  // spread the chosen dates evenly over the season (the model was trained on irregular series)
  const pick = [];
  for (let k = 0; k < Math.min(maxDates, days.length); k++) pick.push(days[Math.round((k * (days.length - 1)) / Math.max(1, Math.min(maxDates, days.length) - 1))]);
  return [...new Set(pick)].map((day) => byDate.get(day));
}

async function readWindow(href, x0, y1, size, px) {
  const tif = await fromUrl(href, { allowFullFile: false });
  const img = await tif.getImage();
  const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution();
  const win = [Math.floor((x0 - ox) / rx), Math.floor((y1 - oy) / ry), Math.ceil((x0 + size - ox) / rx), Math.ceil((y1 - size - oy) / ry)];
  const r = await img.readRasters({ window: win, width: px, height: px, resampleMethod: 'bilinear', samples: [0], interleave: true });
  return r;
}

async function run({ lon, lat, season, maxDates = 16, base }, progress) {
  progress('Loading the U-TAE model', 0, 1);
  const M = await loadModel(base);
  progress('Searching Sentinel-2 scenes (Earth Search)', 0, 1);
  const items = await searchItems(lon, lat, season, maxDates);
  if (items.length < 4) throw new Error(`Only ${items.length} Sentinel-2 scenes with < 30 % cloud in this season.`);
  const P = M.tile, B = M.bands.length;
  const X = [], pos = [], used = [], rgb = [];
  const t0 = Date.UTC(season, 8, 1);
  let done = 0;
  for (const it of items) {
    const code = it.properties['proj:code'] || `EPSG:${it.properties['proj:epsg']}`;
    const epsg = +String(code).split(':')[1];
    const zone = epsg % 100, [cx, cy] = toUTM(lat, lon, zone);
    const half = (P * M.gsd_m) / 2;
    const baseline = it.properties['s2:processing_baseline'] || '0';
    const off = it.properties['earthsearch:boa_offset_applied'] ? 0 : (baseline >= '04.00' ? -1000 : 0);
    try {
      const bands = await Promise.all(M.bands.map((b) => readWindow(it.assets[ASSET[b]].href, cx - half, cy + half, half * 2, P)));
      const frame = new Float32Array(B * P * P);
      let zero = 0;
      bands.forEach((arr, b) => { for (let i = 0; i < P * P; i++) { const v = arr[i] + off; if (b === 0 && arr[i] === 0) zero++; frame[b * P * P + i] = (v - M.mean[b]) / M.std[b]; } });
      if (zero / (P * P) > 0.1) continue;             // outside the tile footprint
      X.push(frame); pos.push((Date.parse(it.properties.datetime) - t0) / 86400000); used.push(it.properties.datetime.slice(0, 10));
      rgb.push([bands[2], bands[1], bands[0]].map((a) => Float32Array.from(a, (v) => v + off)));
    } catch (e) { /* skip a scene that cannot be read */ }
    progress('Reading Sentinel-2 bands (10 m, 1.28 km window)', ++done, items.length);
  }
  if (X.length < 4) throw new Error('Too few readable Sentinel-2 scenes for this window.');
  progress('Running U-TAE', 0, 1);
  const T = X.length, x = new Float32Array(T * B * P * P);
  X.forEach((f, t) => x.set(f, t * B * P * P));
  const out = await session.run({ x: new ort.Tensor('float32', x, [1, T, B, P, P]), pos: new ort.Tensor('float32', Float32Array.from(pos), [1, T]) });
  const lg = out.logits.data, K = M.classes.length, N = P * P;
  const cls = new Uint8Array(N), conf = new Float32Array(N), counts = new Array(K).fill(0), confSum = new Array(K).fill(0);
  for (let i = 0; i < N; i++) {
    let best = 0, bv = -Infinity, sum = 0;
    for (let k = 0; k < K - 1; k++) { const v = lg[k * N + i]; if (v > bv) { bv = v; best = k; } }   // never predict "void"
    for (let k = 0; k < K - 1; k++) sum += Math.exp(lg[k * N + i] - bv);
    cls[i] = best; conf[i] = 1 / sum; counts[best]++; confSum[best] += conf[i];
  }
  // true-colour image of the median date, for context
  const mid = rgb[Math.floor(rgb.length / 2)], img = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) { for (let c = 0; c < 3; c++) img[i * 4 + c] = Math.min(255, (mid[c][i] / 2800) * 255); img[i * 4 + 3] = 255; }
  return { cls, conf, counts, meanConf: confSum.map((s, k) => (counts[k] ? s / counts[k] : 0)), dates: used, rgb: img, size: P, classes: M.classes, model: M,
    transfer: [cls.buffer, conf.buffer, img.buffer] };
}

self.onmessage = async (e) => {
  const { rid, args } = e.data;
  const progress = (stage, done, total) => self.postMessage({ rid, progress: { stage, done, total } });
  try {
    const out = await run(args, progress);
    const transfer = out.transfer; delete out.transfer;
    self.postMessage({ rid, ok: true, out }, transfer);
  } catch (err) {
    self.postMessage({ rid, ok: false, error: String(err && err.message || err) });
  }
};
