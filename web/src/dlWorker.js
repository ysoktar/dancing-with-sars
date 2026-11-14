// Deep-learning crop-type segmentation in the browser (Web Worker).
// Model: U-TAE pretrained on PASTIS (Garnot & Landrieu, ICCV 2021), exported to ONNX by ml/export_utae_onnx.py.
// Input: a Sentinel-2 L2A time series (10 bands, 10 m, 128 x 128 = 1.28 km) read straight from the public
// Cloud-Optimized GeoTIFFs on AWS (Element 84 Earth Search STAC, CORS-enabled) with HTTP range requests.
import * as ort from 'onnxruntime-web';
import { fromUrl } from 'geotiff';
import { readWorldCover } from './worldcover.js';
import { classWeights, PASTIS_TO_SPAM, spamOfName } from './cropPrior.js';

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

async function run({ lon, lat, season, maxDates = 16, base, mix }, progress) {
  progress('Loading the U-TAE model', 0, 1);
  const M = await loadModel(base);
  progress('Searching Sentinel-2 scenes (Earth Search)', 0, 1);
  const items = await searchItems(lon, lat, season, maxDates);
  if (items.length < 4) throw new Error(`Only ${items.length} Sentinel-2 scenes with < 30 % cloud in this season.`);
  const P = M.tile, B = M.bands.length;
  const X = [], pos = [], used = [], rgb = [];
  const ndviMax = new Float32Array(M.tile * M.tile).fill(-1), ndviMin = new Float32Array(M.tile * M.tile).fill(2);
  const ndviSeries = [];          // per date, per pixel (for the crop calendar of the model's fields)
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
      // greenest NDVI over the season (B08 = index 6, B04 = index 2): land that never greens up is not a field
      const nd = new Float32Array(P * P);
      for (let i = 0; i < P * P; i++) { const r = bands[2][i] + off, nir = bands[6][i] + off; const v = (nir - r) / (nir + r + 1e-6); nd[i] = v; if (v > ndviMax[i]) ndviMax[i] = v; if (v < ndviMin[i]) ndviMin[i] = v; }
      ndviSeries.push(nd);
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
  // softmax probabilities (void class excluded)
  const prob = new Float32Array((K - 1) * N);
  for (let i = 0; i < N; i++) {
    let mx = -Infinity; for (let k = 0; k < K - 1; k++) mx = Math.max(mx, lg[k * N + i]);
    let sum = 0; for (let k = 0; k < K - 1; k++) { const e = Math.exp(lg[k * N + i] - mx); prob[k * N + i] = e; sum += e; }
    for (let k = 0; k < K - 1; k++) prob[k * N + i] /= sum;
  }
  // regional crop-mix prior (SPAM 2010): classes not grown in this region are suppressed before any decision
  const W = mix ? classWeights(mix, PASTIS_TO_SPAM.slice(0, K - 1)) : null;
  const suppressed = new Set();
  if (W) for (let i = 0; i < N; i++) {
    let b0 = 0, bv0 = -1; for (let k = 0; k < K - 1; k++) if (prob[k * N + i] > bv0) { bv0 = prob[k * N + i]; b0 = k; }
    if (W[b0] < 1) suppressed.add(b0);
    let sum = 0; for (let k = 0; k < K - 1; k++) { prob[k * N + i] *= W[k]; sum += prob[k * N + i]; }
    for (let k = 0; k < K - 1; k++) prob[k * N + i] /= sum;
  }
  const raw = new Uint8Array(N);
  for (let i = 0; i < N; i++) { let b = 0, bv = -1; for (let k = 0; k < K - 1; k++) if (prob[k * N + i] > bv) { bv = prob[k * N + i]; b = k; } raw[i] = b; }

  // ---- post-processing (the network only knows French farmland) ----
  progress('Post-processing: land-cover prior, greenness, minimum field size', 0, 1);
  const d = (P * M.gsd_m) / 2 / 111320, dl = d / Math.cos((lat * Math.PI) / 180);
  let wc = null;
  try { wc = await readWorldCover([lon - dl, lat - d, lon + dl, lat + d], P, P); if (!wc.some((v) => v)) wc = null; } catch (e) { wc = null; }
  const cls = raw.slice();
  let maskedWc = 0, maskedGreen = 0;
  const UNREC = K - 1;          // index 19: reused for "cropland, crop type not recognised"
  let unrec = 0;
  for (let i = 0; i < N; i++) {
    const w = wc ? wc[i] : 40;
    if (cls[i] === 0) {
      // the network says background, but WorldCover maps cropland (or the season is clearly crop-like) and it greens up:
      // keep it as a field whose crop the network did not recognise, instead of losing it
      const hardBg = w === 60 || w === 50 || w === 70 || w === 80 || w === 100;
      if (!hardBg && ndviMax[i] >= 0.3 && (w === 40 || ndviMax[i] - ndviMin[i] > 0.35)) { cls[i] = UNREC; unrec++; }
      continue;
    }
    // never fields: bare / desert, built-up, snow, water (WorldCover). Tree / shrub / grass cover can hold fields
    // (field mosaics with tree rows are often mapped as trees), so there a crop-like season is required:
    // NDVI must swing by > 0.3 (sown, grown, harvested), except for orchards / vineyards and meadows.
    const hard = w === 60 || w === 50 || w === 70 || w === 80 || w === 100;
    const perennialOk = (cls[i] === 8 || cls[i] === 16) && w === 10, meadowOk = (cls[i] === 1 || cls[i] === 14) && (w === 30 || w === 90);
    const seasonal = ndviMax[i] - ndviMin[i] > 0.3;
    if (hard || (w && w !== 40 && !perennialOk && !meadowOk && !seasonal)) { cls[i] = 0; maskedWc++; continue; }
    if (ndviMax[i] < 0.3) { cls[i] = 0; maskedGreen++; }                              // never green this season
  }
  // 3x3 mode filter, then patches below the minimum field size (0.3 ha = 30 px) join their main neighbour
  const sm = cls.slice();
  for (let y = 1; y < P - 1; y++) for (let x = 1; x < P - 1; x++) {
    const i = y * P + x, cnt = new Uint16Array(K);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cnt[cls[i + dy * P + dx]]++;
    let b = cls[i]; for (let k = 0; k < K; k++) if (cnt[k] > cnt[b]) b = k;
    sm[i] = b;
  }
  cls.set(sm);
  const MMU = 30, seen = new Uint8Array(N), stack = new Int32Array(N);
  let merged = 0;
  for (let s0 = 0; s0 < N; s0++) {
    if (seen[s0] || cls[s0] === 0) continue;
    const c = cls[s0], px = [], nb = new Uint32Array(K);
    let top = 0; stack[top++] = s0; seen[s0] = 1;
    while (top) {
      const i = stack[--top]; px.push(i);
      const x = i % P, y = (i / P) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < P - 1 ? i + 1 : -1, y > 0 ? i - P : -1, y < P - 1 ? i + P : -1]) {
        if (j < 0) continue;
        if (cls[j] === c) { if (!seen[j]) { seen[j] = 1; stack[top++] = j; } } else nb[cls[j]]++;
      }
    }
    if (px.length >= MMU) {
      // one crop per field: soft vote of the class probabilities over the patch
      const vote = new Float64Array(K - 1);
      for (const i of px) for (let k = 0; k < K - 1; k++) vote[k] += prob[k * N + i];
      if (c !== UNREC) {
        let b = c, bv = -1; for (let k = 1; k < K - 1; k++) if (vote[k] > bv) { bv = vote[k]; b = k; }
        for (const i of px) cls[i] = b;
      }
      continue;
    }
    let b = 0, bn = 0; for (let k = 0; k < K; k++) if (nb[k] > bn) { bn = nb[k]; b = k; }
    for (const i of px) cls[i] = b;
    merged += px.length;
  }
  const conf = new Float32Array(N), counts = new Array(K).fill(0), confSum = new Array(K).fill(0);
  for (let i = 0; i < N; i++) { const c = cls[i]; conf[i] = c < K - 1 ? prob[c * N + i] : 1 - prob[i]; counts[c]++; confSum[c] += conf[i]; }
  const inDomain = lat >= 36 && lat <= 60 && lon >= -10 && lon <= 25;      // Western / Central Europe, like PASTIS
  const post = { prior: W ? { suppressed: [...suppressed].map((k) => M.classes[k]), source: mix.source, top: mix.list.slice(0, 6).map((c) => `${c.name} ${Math.round(c.share * 100)} %`) } : null, unrecognisedPx: unrec, worldcover: !!wc, maskedWcPx: maskedWc, maskedGreenPx: maskedGreen, mergedPx: merged, mmuHa: MMU * 0.01, inDomain };
  // true-colour image of the median date, for context
  const mid = rgb[Math.floor(rgb.length / 2)], img = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) { for (let c = 0; c < 3; c++) img[i * 4 + c] = Math.min(255, (mid[c][i] / 2800) * 255); img[i * 4 + 3] = 255; }
  const classes = M.classes.slice(); classes[UNREC] = 'Cropland, crop not recognised';
  const calendar = cropCalendar(cls, ndviSeries, used, [0], N);
  return { calendar, cls, conf, counts, meanConf: confSum.map((s2, k) => (counts[k] ? s2 / counts[k] : 0)), dates: used, rgb: img, size: P, classes, model: M, post,
    transfer: [cls.buffer, conf.buffer, img.buffer] };
}


// ---------------------------------------------------------------- the team's models (U-Mamba / SITSMamba, ml/export_mamba_onnx.py)
// They take a fixed time grid (e.g. 24 steps of 18 days from 1 Sept for PASTIS-R, 24 x 30 days for YieldSAT):
// each step gets the least cloudy Sentinel-2 scene inside it (OBS_S2 = 1) or stays empty (OBS_S2 = 0);
// Sentinel-1 channels are left empty (OBS_S1 = 0; the models were trained with random S1 drop-out);
// weather bands come from NASA POWER, static layers are set to their training mean.
const ASSET_ALL = { ...ASSET, B01: 'coastal', B09: 'nir09' };
const sessions = new Map();
async function loadAny(base, id) {
  if (!sessions.has(id)) {
    const idx = await (await fetch(base + 'models/index.json')).json().catch(() => ({ models: [] }));
    const entry = (idx.models || []).find((m) => m.id === id) || { meta: `${id}.json` };
    const M = await (await fetch(base + 'models/' + entry.meta)).json();
    const S = await ort.InferenceSession.create(base + 'models/' + (M.id || id) + '.onnx', { executionProviders: ['wasm'] });
    sessions.set(id, { M, S });
  }
  return sessions.get(id);
}

async function powerSteps(lon, lat, t0, steps, stepDays) {
  const f = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
  const t1 = Math.min(Date.now() - 3 * 86400000, t0 + steps * stepDays * 86400000);
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR&community=AG&longitude=${lon.toFixed(3)}&latitude=${lat.toFixed(3)}&start=${f(t0)}&end=${f(t1)}&format=JSON`;
  const p = (await (await fetch(url)).json()).properties.parameter;
  const out = Array.from({ length: steps }, () => ({ temp_mean: [], temp_max: [], temp_min: [], total_prec: [] }));
  for (const k of Object.keys(p.T2M)) {
    const t = Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6));
    const s = Math.floor((t - t0) / (stepDays * 86400000));
    if (s < 0 || s >= steps) continue;
    const add = (key, v) => { if (v != null && v > -900) out[s][key].push(v); };
    add('temp_mean', p.T2M[k]); add('temp_max', p.T2M_MAX[k]); add('temp_min', p.T2M_MIN[k]); add('total_prec', p.PRECTOTCORR[k]);
  }
  return out.map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.length ? (k === 'total_prec' ? v.reduce((a, b) => a + b, 0) : v.reduce((a, b) => a + b, 0) / v.length) : null])));
}

async function runGrid({ lon, lat, season, base, model, mix }, progress) {
  progress('Loading the model', 0, 1);
  const { M, S } = await loadAny(base, model);
  const P = 128, N = P * P, steps = M.grid.steps, sd = M.grid.step_days;
  const md = (M.grid.start || '2018-09-01').slice(5);
  const t0 = Date.parse(`${season}-${md}T00:00:00Z`);
  const B = M.bands.length;
  // scenes for the whole grid span
  progress('Searching Sentinel-2 scenes (Earth Search)', 0, 1);
  const d = 0.006, end = new Date(t0 + steps * sd * 86400000).toISOString();
  const body = { collections: ['sentinel-2-l2a'], bbox: [lon - d, lat - d, lon + d, lat + d], datetime: `${new Date(t0).toISOString()}/${end}`, query: { 'eo:cloud_cover': { lt: 40 } }, limit: 300 };
  const feats = ((await (await fetch(STAC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()).features) || [];
  const perStep = Array.from({ length: steps }, () => null);
  for (const f of feats) {
    const s = Math.floor((Date.parse(f.properties.datetime) - t0) / (sd * 86400000));
    if (s >= 0 && s < steps && (!perStep[s] || f.properties['eo:cloud_cover'] < perStep[s].properties['eo:cloud_cover'])) perStep[s] = f;
  }
  const wx = M.bands.some((b) => b.startsWith('temp_') || b === 'total_prec') ? await powerSteps(lon, lat, t0, steps, sd).catch(() => null) : null;
  const x = new Float32Array(steps * B * N), tmask = new Float32Array(steps), days = new Float32Array(steps);
  const ndviMax = new Float32Array(N).fill(-1), ndviMin = new Float32Array(N).fill(2);
  const norm = (b, v) => (v - (M.mean[b] ?? 0)) / ((M.std[b] ?? 1) || 1);
  let done = 0, rgb = null, used = [];
  const ndviSeries = [];
  for (let s = 0; s < steps; s++) {
    days[s] = s * sd + sd / 2;
    const it = perStep[s];
    const set = (b, arr) => { const c = M.bands.indexOf(b); if (c >= 0) for (let i = 0; i < N; i++) x[(s * B + c) * N + i] = arr ? arr[i] : 0; };
    if (it) {
      const code = it.properties['proj:code'] || `EPSG:${it.properties['proj:epsg']}`, zone = +String(code).split(':')[1] % 100;
      const [cx, cy] = toUTM(lat, lon, zone), half = (P * 10) / 2;
      const off = it.properties['earthsearch:boa_offset_applied'] ? 0 : ((it.properties['s2:processing_baseline'] || '0') >= '04.00' ? -1000 : 0);
      try {
        const s2 = M.bands.filter((b) => ASSET_ALL[b]);
        const arrs = await Promise.all(s2.map((b) => readWindow(it.assets[ASSET_ALL[b]].href, cx - half, cy + half, half * 2, P)));
        s2.forEach((b, k) => set(b, Float32Array.from(arrs[k], (v) => norm(b, v + off))));
        set('OBS_S2', new Float32Array(N).fill(1)); tmask[s] = 1; used.push(it.properties.datetime.slice(0, 10));
        const r = arrs[s2.indexOf('B04')], n8 = arrs[s2.indexOf('B08')];
        if (r && n8) { const nd = new Float32Array(N); for (let i = 0; i < N; i++) { const v = (n8[i] - r[i]) / (n8[i] + r[i] + 1e-6); nd[i] = v; if (v > ndviMax[i]) ndviMax[i] = v; if (v < ndviMin[i]) ndviMin[i] = v; } ndviSeries.push(nd); }
        if (!rgb || Math.abs(s - steps / 2) < Math.abs(rgb.s - steps / 2)) rgb = { s, r: arrs[s2.indexOf('B04')], g: arrs[s2.indexOf('B03')], b: arrs[s2.indexOf('B02')], off };
      } catch (e) { /* scene unreadable: step stays empty */ }
    }
    if (wx && wx[s]) for (const k of ['temp_mean', 'temp_max', 'temp_min', 'total_prec']) if (wx[s][k] != null) set(k, new Float32Array(N).fill(norm(k, wx[s][k])));
    progress('Reading Sentinel-2 bands for each time step', ++done, steps);
  }
  if (tmask.reduce((a, b) => a + b, 0) < 4) throw new Error('Fewer than 4 time steps with a usable Sentinel-2 scene.');
  // static layers: training mean (0 after normalisation)
  const Sn = (M.static || []).length;
  // run in tiles of M.tile pixels
  progress('Running the network', 0, 1);
  const T = M.tile || 64, heads = Object.keys(M.tasks), outs = Object.fromEntries(heads.map((h) => [h, new Float32Array(M.tasks[h] * N)]));
  for (let ty = 0; ty < P; ty += T) for (let tx = 0; tx < P; tx += T) {
    const xt = new Float32Array(steps * B * T * T);
    for (let s = 0; s < steps; s++) for (let c = 0; c < B; c++) for (let y = 0; y < T; y++) xt.set(x.subarray((s * B + c) * N + (ty + y) * P + tx, (s * B + c) * N + (ty + y) * P + tx + T), ((s * B + c) * T + y) * T);
    const feeds = { x: new ort.Tensor('float32', xt, [1, steps, B, T, T]), days: new ort.Tensor('float32', days, [1, steps]), tmask: new ort.Tensor('float32', tmask, [1, steps]) };
    if (M.inputs.includes('static')) feeds.static = new ort.Tensor('float32', new Float32Array(Math.max(1, Sn) * T * T), [1, Math.max(1, Sn), T, T]);
    const o = await S.run(feeds);
    for (const h of heads) { const k = M.tasks[h], src = o[h].data; for (let c = 0; c < k; c++) for (let y = 0; y < T; y++) for (let xx = 0; xx < T; xx++) outs[h][c * N + (ty + y) * P + tx + xx] = src[(c * T + y) * T + xx]; }
  }
  // classes: 'sem' (PASTIS) or 'crop' (YieldSAT); field mask from 'extent' when present
  const head = M.tasks.sem ? 'sem' : 'crop', K = M.tasks[head], names = (M.classes[head] || []).slice(0, K);
  const cls = new Uint8Array(N), conf = new Float32Array(N), field = new Uint8Array(N).fill(1);
  const lg = outs[head];
  const Wc = mix ? classWeights(mix, head === 'sem' ? PASTIS_TO_SPAM.slice(0, K) : names.map(spamOfName)) : null;
  const pr = new Float32Array(K);
  for (let i = 0; i < N; i++) {
    let mx = -Infinity; for (let k = 0; k < K; k++) mx = Math.max(mx, lg[k * N + i]);
    let sum = 0; for (let k = 0; k < K; k++) { pr[k] = Math.exp(lg[k * N + i] - mx) * (Wc ? Wc[k] : 1); sum += pr[k]; }
    let b = 0; for (let k = 1; k < K; k++) if (pr[k] > pr[b]) b = k;
    cls[i] = b; conf[i] = pr[b] / sum;
    if (outs.extent) field[i] = 1 / (1 + Math.exp(-outs.extent[i])) > 0.5 ? 1 : 0;
  }
  // post-processing: land-cover prior + greenness (as for U-TAE); YieldSAT crops have no background class -> use the field mask
  let wc = null;
  const dd = (P * 10) / 2 / 111320, dl = dd / Math.cos((lat * Math.PI) / 180);
  try { wc = await readWorldCover([lon - dl, lat - dd, lon + dl, lat + dd], P, P); if (!wc.some((v) => v)) wc = null; } catch (e) { wc = null; }
  const BG = head === 'sem' ? 0 : K;            // index K = "not a field" for YieldSAT models
  let masked = 0;
  for (let i = 0; i < N; i++) {
    const w = wc ? wc[i] : 40, hard = w === 60 || w === 50 || w === 70 || w === 80 || w === 100;
    if (!field[i] || hard || ndviMax[i] < 0.3) { if (cls[i] !== BG) masked++; cls[i] = BG; }
  }
  const yieldMap = null;   // yield heads are not used (no harvest data to validate them)
  const counts = new Array(K + 1).fill(0), confSum = new Array(K + 1).fill(0);
  for (let i = 0; i < N; i++) { counts[cls[i]]++; confSum[cls[i]] += conf[i]; }
  const img = new Uint8ClampedArray(N * 4);
  if (rgb) for (let i = 0; i < N; i++) { img[i * 4] = Math.min(255, ((rgb.r[i] + rgb.off) / 2800) * 255); img[i * 4 + 1] = Math.min(255, ((rgb.g[i] + rgb.off) / 2800) * 255); img[i * 4 + 2] = Math.min(255, ((rgb.b[i] + rgb.off) / 2800) * 255); img[i * 4 + 3] = 255; }
  const classes = head === 'sem' ? names : [...names, 'Not a field'];
  const calendar = cropCalendar(cls, ndviSeries, used, [BG], N);
  return { calendar, generic: true, head, cls, conf, counts, meanConf: confSum.map((s2, k) => (counts[k] ? s2 / counts[k] : 0)), dates: used, rgb: img, size: P, classes, model: M, yieldMap,
    post: { worldcover: !!wc, maskedWcPx: masked, maskedGreenPx: 0, mergedPx: 0, mmuHa: 0, unrecognisedPx: 0, inDomain: true, grid: `${steps} × ${sd} days`, stepsObserved: used.length },
    transfer: [cls.buffer, conf.buffer, img.buffer].concat(yieldMap ? [yieldMap.buffer] : []) };
}

/**
 * Crop calendar of the model's fields: for every predicted crop class, the mean Sentinel-2 NDVI of its pixels on
 * each date, then (on the 1-2-1 smoothed curve) green-up = half-way up to the peak, peak, senescence = half-way down,
 * harvest = sharpest drop after the peak. Classes in `skip` (background) are left out.
 */
function cropCalendar(cls, series, dates, skip, N) {
  const T = series.length, byClass = new Map();
  if (T < 4 || dates.length !== T) return [];
  for (let i = 0; i < N; i++) {
    const c = cls[i];
    if (skip.includes(c)) continue;
    let g = byClass.get(c);
    if (!g) { g = { n: 0, sum: new Float64Array(T) }; byClass.set(c, g); }
    g.n++; for (let t = 0; t < T; t++) g.sum[t] += series[t][i];
  }
  const day = (t) => dates[Math.max(0, Math.min(T - 1, t))];
  const out = [];
  for (const [c, g] of byClass) {
    if (g.n < 30) continue;
    const m = Array.from(g.sum, (v) => v / g.n);
    const s = m.map((v, t) => (m[Math.max(0, t - 1)] + 2 * v + m[Math.min(T - 1, t + 1)]) / 4);
    let tp = 0; for (let t = 1; t < T; t++) if (s[t] > s[tp]) tp = t;
    const lo1 = Math.min(...s.slice(0, tp + 1)), lo2 = Math.min(...s.slice(tp));
    let tu = 0; for (let t = tp; t > 0; t--) if (s[t - 1] <= lo1 + 0.5 * (s[tp] - lo1)) { tu = t; break; }
    let td = T - 1; for (let t = tp; t < T - 1; t++) if (s[t + 1] <= lo2 + 0.5 * (s[tp] - lo2)) { td = t + 1; break; }
    let th = -1, best = 0; for (let t = tp + 1; t < T; t++) { const d = m[t - 1] - m[t]; if (d > best) { best = d; th = t; } }
    out.push({ cls: c, px: g.n, ndvi: m, greenUp: day(tu), peak: day(tp), senescence: day(td), harvest: th > 0 && best > 0.1 ? day(th) : null, peakNdvi: s[tp] });
  }
  return out.sort((a, b) => b.px - a.px);
}

self.onmessage = async (e) => {
  const { rid, args } = e.data;
  const progress = (stage, done, total) => self.postMessage({ rid, progress: { stage, done, total } });
  try {
    const out = args.model && args.model !== 'utae_pastis' ? await runGrid(args, progress) : await run(args, progress);
    const transfer = out.transfer; delete out.transfer;
    self.postMessage({ rid, ok: true, out }, transfer);
  } catch (err) {
    self.postMessage({ rid, ok: false, error: String(err && err.message || err) });
  }
};
