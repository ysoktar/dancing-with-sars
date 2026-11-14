// Live NISAR time series for any point on Earth, built inside the Web Worker.
// Same steps as pipeline/build_data.py, in the browser:
//   1. ASF search API: every L2 GCOV granule over the point (CORS-enabled, no login)
//   2. keep the track (path / frame / direction) that fully covers the window most often
//   3. download each date's public LATLON browse image (R = HH, G = HV)
//   4. geographic bounds: KML for validated products, footprint fit for provisional ones
//   5. co-register every date to a reference by FFT phase correlation
//   6. crop a 256 x 256 window (+ footprint-based validity mask)
import { SIZE } from './sar.js';

const SEARCH = 'https://api.daac.asf.alaska.edu/services/search/param';
const COREG = 256;          // co-registration window (power of two for the FFT)

export function aoiBox(lon, lat, half) {
  const hl = half / Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
  return [lon - hl, lat - half, lon + hl, lat + half];
}

const nums = (wkt) => (wkt.match(/-?\d+\.?\d*(e-?\d+)?/gi) || []).map(Number);
function polygon(wkt) { const n = nums(wkt); const p = []; for (let i = 0; i + 1 < n.length; i += 2) p.push([n[i], n[i + 1]]); return p; }
function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[j];
    if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1 + 1e-12) + x1) c = !c;
  }
  return c;
}

/** Search ASF and pick the track + one granule per date. */
export async function planRegion(lon, lat, box, maxDates = 24) {
  const q = new URLSearchParams({ dataset: 'NISAR', processingLevel: 'GCOV', intersectsWith: `POINT(${lon.toFixed(4)} ${lat.toFixed(4)})`, output: 'jsonlite', maxResults: '2000' });
  const r = await fetch(`${SEARCH}?${q}`);
  if (!r.ok) throw new Error(`ASF search failed (${r.status})`);
  const all = (await r.json()).results || [];
  const gs = all.filter((g) => (g.browse || []).some((b) => b.endsWith('_LATLON.png')) && g.wkt);
  if (!gs.length) return { granules: [], total: all.length };
  const full = gs.filter((g) => { const p = polygon(g.wkt); return [[box[0], box[1]], [box[0], box[3]], [box[2], box[1]], [box[2], box[3]]].every(([x, y]) => inside(p, x, y)); });
  const pool = full.length ? full : gs;
  const key = (g) => `${g.path}|${g.frame}|${g.flightDirection}`;
  const cnt = {};
  pool.forEach((g) => { cnt[key(g)] = (cnt[key(g)] || 0) + 1; });
  const track = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
  const byDate = {};
  for (const g of pool) {
    if (key(g) !== track) continue;
    const d = g.startTime.slice(0, 10);
    const score = [!(g.collectionName || '').includes('PROVISIONAL') ? 1 : 0, g.crid || ''];
    const prev = byDate[d];
    if (!prev || score[0] > prev.s[0] || (score[0] === prev.s[0] && score[1] > prev.s[1])) byDate[d] = { g, s: score };
  }
  const dates = Object.keys(byDate).sort().slice(-maxDates);
  const [path, frame, dir] = track.split('|');
  return { granules: dates.map((d) => byDate[d].g), track: { path: +path, frame: +frame, dir }, fullCover: full.length, total: all.length };
}

async function loadBrowse(g) {
  const png = g.browse.find((b) => b.endsWith('_LATLON.png'));
  const blob = await (await fetch(png)).blob();
  const bmp = await createImageBitmap(blob);
  let bounds = null, kml = false;
  if (!(g.collectionName || '').includes('PROVISIONAL')) {
    try {
      const t = await (await fetch(png.slice(0, -4) + '.kml')).text();
      const m = t.match(/<coordinates>\s*([^<]+)<\/coordinates>/);
      if (m) {
        const pts = m[1].trim().split(/\s+/).map((p) => p.split(',').map(Number));
        const lo = pts.map((p) => p[0]), la = pts.map((p) => p[1]);
        bounds = [Math.min(...lo), Math.min(...la), Math.max(...lo), Math.max(...la)]; kml = true;
      }
    } catch (e) { /* fall back to the footprint fit */ }
  }
  if (!bounds) bounds = boundsFromFootprint(bmp, g.wkt);
  return bounds ? { g, bmp, bounds, bounds0: bounds.slice(), kml, png } : null;
}

/** Valid-pixel extent of the browse image <-> footprint extremes, as in the pipeline. */
function boundsFromFootprint(bmp, wkt) {
  const f = 4, w = Math.ceil(bmp.width / f), h = Math.ceil(bmp.height / f);
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const j = (yy * w + xx) * 4;
    if (d[j] + d[j + 1] + d[j + 2] > 6) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
  }
  if (x1 < 0) return null;
  const n = nums(wkt), lons = n.filter((_, i) => i % 2 === 0), lats = n.filter((_, i) => i % 2 === 1);
  const lo0 = Math.min(...lons), lo1 = Math.max(...lons), la0 = Math.min(...lats), la1 = Math.max(...lats);
  if (lo1 - lo0 > 180) return null;
  const sx = (lo1 - lo0) / Math.max((x1 + 1 - x0) * f, 1) * 1, sy = (la1 - la0) / Math.max((y1 + 1 - y0) * f, 1);
  const W = lo0 - x0 * f * sx, N = la1 + y0 * f * sy;
  return [W, N - bmp.height * sy, W + bmp.width * sx, N];
}

/** Resample the geographic window `box` of a browse image to size x size RGBA. */
function sample(it, box, size) {
  const [W, S, E, N] = it.bounds, bw = it.bmp.width, bh = it.bmp.height;
  const sx = ((box[0] - W) / (E - W)) * bw, ex = ((box[2] - W) / (E - W)) * bw;
  const sy = ((N - box[3]) / (N - S)) * bh, ey = ((N - box[1]) / (N - S)) * bh;
  const c = new OffscreenCanvas(size, size), x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(it.bmp, sx, sy, ex - sx, ey - sy, 0, 0, size, size);
  return x.getImageData(0, 0, size, size).data;
}

// ---------------------------------------------------------------- FFT phase correlation
function fft1(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
function fft2(re, im, n, inv) {
  const r = new Float64Array(n), i2 = new Float64Array(n);
  for (let y = 0; y < n; y++) { for (let x = 0; x < n; x++) { r[x] = re[y * n + x]; i2[x] = im[y * n + x]; } fft1(r, i2, inv); for (let x = 0; x < n; x++) { re[y * n + x] = r[x]; im[y * n + x] = i2[x]; } }
  for (let x = 0; x < n; x++) { for (let y = 0; y < n; y++) { r[y] = re[y * n + x]; i2[y] = im[y * n + x]; } fft1(r, i2, inv); for (let y = 0; y < n; y++) { re[y * n + x] = r[y]; im[y * n + x] = i2[y]; } }
}
function feature(rgba, n) {
  const f = new Float64Array(n * n);
  let s = 0, k = 0;
  for (let i = 0; i < n * n; i++) { const a = rgba[i * 4], b = rgba[i * 4 + 1]; if (a + b > 3) { f[i] = Math.log1p(a + b); s += f[i]; k++; } else f[i] = NaN; }
  const m = k ? s / k : 0;
  for (let i = 0; i < n * n; i++) if (Number.isNaN(f[i])) f[i] = m;
  return f;
}
function phaseShift(a, b, n) {
  const win = (i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  const ma = a.reduce((p, v) => p + v, 0) / a.length, mb = b.reduce((p, v) => p + v, 0) / b.length;
  const ar = new Float64Array(n * n), ai = new Float64Array(n * n), br = new Float64Array(n * n), bi = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const w = win(y) * win(x), i = y * n + x; ar[i] = (a[i] - ma) * w; br[i] = (b[i] - mb) * w; }
  fft2(ar, ai, n, false); fft2(br, bi, n, false);
  for (let i = 0; i < n * n; i++) {
    const r = ar[i] * br[i] + ai[i] * bi[i], im = ai[i] * br[i] - ar[i] * bi[i], m = Math.hypot(r, im) + 1e-9;
    ar[i] = r / m; ai[i] = im / m;
  }
  fft2(ar, ai, n, true);
  let best = -Infinity, by = 0, bx = 0, s = 0, s2 = 0;
  for (let i = 0; i < n * n; i++) { const v = ar[i]; s += v; s2 += v * v; if (v > best) { best = v; by = (i / n) | 0; bx = i % n; } }
  const sd = Math.sqrt(Math.max(1e-12, s2 / (n * n) - (s / (n * n)) ** 2));
  if (by > n / 2) by -= n; if (bx > n / 2) bx -= n;
  return { dy: by, dx: bx, conf: best / sd };
}

function coregister(items, lon, lat, aoi) {
  if (items.length < 2) return;
  const kmlItems = items.filter((it) => it.kml);
  const ref = kmlItems.length ? kmlItems[kmlItems.length - 1] : items[items.length >> 1];
  // co-registration window: 2.2x the drawn area around its centre, square on the ground
  const halfLat = Math.max(aoi[3] - aoi[1], (aoi[2] - aoi[0]) * Math.cos((lat * Math.PI) / 180)) * 1.1;
  const box = aoiBox(lon, lat, halfLat);
  const wdx = (box[2] - box[0]) / COREG, wdy = (box[3] - box[1]) / COREG;
  const refF = feature(sample(ref, box, COREG), COREG);
  const good = [];
  for (const it of items) {
    it.shift = [0, 0];
    if (it === ref) continue;
    let ty = 0, tx = 0, ok = false;
    for (let k = 0; k < 4; k++) {
      const r = phaseShift(refF, feature(sample(it, box, COREG), COREG), COREG);
      if (r.conf < 6 || Math.abs(r.dy) > COREG / 3 || Math.abs(r.dx) > COREG / 3) break;
      if (!r.dx && !r.dy) { ok = true; break; }
      it.bounds[0] += r.dx * wdx; it.bounds[2] += r.dx * wdx; it.bounds[1] -= r.dy * wdy; it.bounds[3] -= r.dy * wdy;
      ty += r.dy; tx += r.dx;
    }
    it.delta = [ty, tx]; it.ok = ok;
    if (ok && !it.kml) good.push(it.delta);
  }
  if (good.length) {
    const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
    const my = med(good.map((d) => d[0])), mx = med(good.map((d) => d[1]));
    for (const it of items) {
      if (it === ref || it.ok || it.kml) continue;
      it.bounds[0] += (mx - it.delta[1]) * wdx; it.bounds[2] += (mx - it.delta[1]) * wdx;
      it.bounds[1] -= (my - it.delta[0]) * wdy; it.bounds[3] -= (my - it.delta[0]) * wdy;
    }
  }
  for (const it of items) it.shiftKm = [((it.bounds[3] - it.bounds0[3]) * 111.32).toFixed(2), ((it.bounds[0] - it.bounds0[0]) * 111.32 * Math.cos((lat * Math.PI) / 180)).toFixed(2)];
}

/** Footprint mask (shifted with the image, shrunk ~1.5 km) and no-data at the crop border. */
function validMask(it, box, rgba) {
  const N = SIZE * SIZE, v = new Uint8Array(N);
  const dx = it.bounds[0] - it.bounds0[0], dy = it.bounds[3] - it.bounds0[3];
  const poly = polygon(it.g.wkt).map(([x, y]) => [x + dx, y + dy]);
  const sh = 0.015;
  for (let y = 0; y < SIZE; y++) {
    const la = box[3] - ((y + 0.5) / SIZE) * (box[3] - box[1]);
    for (let x = 0; x < SIZE; x++) {
      const lo = box[0] + ((x + 0.5) / SIZE) * (box[2] - box[0]);
      v[y * SIZE + x] = inside(poly, lo, la) && inside(poly, lo + sh, la) && inside(poly, lo - sh, la) && inside(poly, lo, la + sh) && inside(poly, lo, la - sh) ? 1 : 0;
    }
  }
  // zero regions connected to the border = swath edge
  const zero = (i) => rgba[i * 4] + rgba[i * 4 + 1] <= 3;
  const seen = new Uint8Array(N), st = [];
  for (let k = 0; k < SIZE; k++) for (const i of [k, (SIZE - 1) * SIZE + k, k * SIZE, k * SIZE + SIZE - 1]) if (zero(i)) st.push(i);
  while (st.length) {
    const i = st.pop();
    if (seen[i] || !zero(i)) continue;
    seen[i] = 1; v[i] = 0;
    const x = i % SIZE, y = (i / SIZE) | 0;
    if (x > 0) st.push(i - 1); if (x < SIZE - 1) st.push(i + 1); if (y > 0) st.push(i - SIZE); if (y < SIZE - 1) st.push(i + SIZE);
  }
  return v;
}

/**
 * Full live build. progress(stage, done, total) is called as it goes.
 * Returns { hh[], hv[], valid, acquisitions[], track }.
 */
export async function buildRegion({ box, maxDates = 24 }, progress = () => {}) {
  const lon = (box[0] + box[2]) / 2, lat = (box[1] + box[3]) / 2;
  progress('Searching the ASF archive', 0, 1);
  const plan = await planRegion(lon, lat, box, maxDates);
  if (!plan.granules.length) throw new Error(plan.total ? 'NISAR has passes here, but none with a geocoded browse image yet.' : 'No NISAR GCOV acquisitions cover this point yet.');
  const items = [];
  let done = 0;
  const queue = plan.granules.slice();
  const worker = async () => {
    while (queue.length) {
      const g = queue.shift();
      try { const it = await loadBrowse(g); if (it) items.push(it); } catch (e) { /* skip a failed date */ }
      progress('Downloading radar images', ++done, plan.granules.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  items.sort((a, b) => a.g.startTime.localeCompare(b.g.startTime));
  if (!items.length) throw new Error('The radar images could not be downloaded.');
  progress('Aligning the dates (phase correlation)', 0, 1);
  coregister(items, lon, lat, box);
  const N = SIZE * SIZE, hh = [], hv = [], acqs = [];
  const validAll = new Uint8Array(N).fill(1);
  for (const it of items) {
    const rgba = sample(it, box, SIZE);
    const v = validMask(it, box, rgba);
    let vf = 0; for (let i = 0; i < N; i++) vf += v[i];
    vf /= N;
    if (vf < 0.6) { it.bmp.close(); continue; }
    const H = new Float32Array(N), V = new Float32Array(N);
    let sh = 0, sv = 0, n = 0;
    for (let i = 0; i < N; i++) { H[i] = rgba[i * 4]; V[i] = rgba[i * 4 + 1]; if (v[i]) { sh += H[i]; sv += V[i]; n++; } else validAll[i] = 0; }
    hh.push(H); hv.push(V);
    acqs.push({ date: it.g.startTime.slice(0, 10), time: it.g.startTime, granule: it.g.productID || it.g.granuleName, collection: it.g.collectionName,
      browse: it.png, h5: it.g.downloadUrl, valid: +vf.toFixed(3), hh: +(sh / n).toFixed(2), hv: +(sv / n).toFixed(2), coregShiftKm: it.shiftKm, kml: it.kml });
    it.bmp.close();
  }
  if (hh.length < 2) throw new Error(`Only ${hh.length} usable pass(es) cover this window. Try a point nearer the middle of a NISAR swath.`);
  return { hh, hv, valid: validAll, acquisitions: acqs, track: plan.track, box, fullCover: plan.fullCover };
}

/** One whole browse frame for the globe: bounds + a canvas with no-data made transparent (max 2048 px). */
export async function loadFrame(g, reference = null) {
  const it = await loadBrowse(g);
  if (!it) return null;
  const k = Math.min(1, 2048 / Math.max(it.bmp.width, it.bmp.height));
  const w = Math.round(it.bmp.width * k), h = Math.round(it.bmp.height * k);
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(it.bmp, 0, 0, w, h);
  it.bmp.close();
  const im = x.getImageData(0, 0, w, h), d = im.data, n = w * h;
  // distance to the nearest no-data pixel (two-pass chamfer) -> soft edges, and the dim swath rim is dropped
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] <= 6 ? 0 : 1e9;
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) { const i = y * w + xx; if (!dist[i]) continue; let v = dist[i]; if (xx) v = Math.min(v, dist[i - 1] + 1); if (y) v = Math.min(v, dist[i - w] + 1); if (xx && y) v = Math.min(v, dist[i - w - 1] + 1.414); if (y && xx < w - 1) v = Math.min(v, dist[i - w + 1] + 1.414); dist[i] = v; }
  for (let y = h - 1; y >= 0; y--) for (let xx = w - 1; xx >= 0; xx--) { const i = y * w + xx; if (!dist[i]) continue; let v = dist[i]; if (xx < w - 1) v = Math.min(v, dist[i + 1] + 1); if (y < h - 1) v = Math.min(v, dist[i + w] + 1); if (xx < w - 1 && y < h - 1) v = Math.min(v, dist[i + w + 1] + 1.414); if (y < h - 1 && xx) v = Math.min(v, dist[i + w - 1] + 1.414); dist[i] = v; }
  const rim = 4, ramp = Math.max(24, Math.round(Math.max(w, h) * 0.04));
  // brightness / colour matched to the mosaic underneath (same consensus the world mosaic uses)
  let gain = null;
  if (reference) {
    const st = [0, 1, 2].map(() => ({ s: 0, s2: 0, n: 0 }));
    for (let i = 0; i < n; i += 7) if (dist[i] > ramp) for (let ch = 0; ch < 3; ch++) { const v = d[i * 4 + ch]; st[ch].s += v; st[ch].s2 += v * v; st[ch].n++; }
    const ref = reference(it.bounds);
    if (ref && st[0].n > 100) gain = st.map((q, ch) => { const m = q.s / q.n, sd = Math.sqrt(Math.max(1, q.s2 / q.n - m * m)); const g2 = Math.max(0.5, Math.min(1.8, ref[ch].sd / sd)); return [g2, ref[ch].m - g2 * m]; });
  }
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (dist[i] <= rim) { d[j + 3] = 0; continue; }
    if (gain) for (let ch = 0; ch < 3; ch++) d[j + ch] = Math.max(0, Math.min(255, d[j + ch] * gain[ch][0] + gain[ch][1]));
    d[j + 3] = Math.round(255 * Math.min(1, (dist[i] - rim) / ramp));
  }
  x.putImageData(im, 0, 0);
  const bmp = await createImageBitmap(c, { imageOrientation: 'flipY' });   // flipped here: WebGL cannot flip an ImageBitmap
  return { bounds: it.bounds, canvas: bmp, matched: !!gain };
}
