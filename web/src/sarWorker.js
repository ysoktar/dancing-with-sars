// Web Worker: owns the radar image stacks and does all heavy pixel work
// (speckle filtering, render modes, change detection, k-means, pixel series)
// off the main thread, so switching filters and dates never freezes the page.
import { SIZE, leeFilter, render, logRatio, maskedMean, darkSeries, otsu } from './sar.js';
import { pixelFeatures, kmeans } from './ml.js';
import { buildRegion } from './regionFetch.js';
import { readWorldCover } from './worldcover.js';
import { computeAgri, renderAgri, rviStack, computeLandCover, renderLandCover, WATER_MAX } from './agri.js';

const N = SIZE * SIZE;
const N2 = () => SIZE * SIZE;
const stacks = new Map();      // site id -> stack
const results = new Map();     // site id -> { change, km }

async function decode(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(SIZE, SIZE);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
  bmp.close();
  return ctx.getImageData(0, 0, SIZE, SIZE).data;
}

function erode(mask, r) {
  for (let pass = 0; pass < r; pass++) {
    const src = mask.slice();
    for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) {
      const i = y * SIZE + x;
      if (src[i] && (!src[i - 1] || !src[i + 1] || !src[i - SIZE] || !src[i + SIZE])) mask[i] = 0;
    }
  }
}

/** Box mean (2r+1)², via an integral image. */
function boxMean(a, r) {
  const W = SIZE, I = new Float64Array((W + 1) * (W + 1)), out = new Float32Array(N);
  for (let y = 0; y < W; y++) { let row = 0; for (let x = 0; x < W; x++) { row += a[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
  for (let y = 0; y < W; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(W, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      out[y * W + x] = (I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0]) / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/**
 * Multi-temporal speckle filter (Quegan & Yu 2001): J_t = E_t · (1/T) Σ_k I_k / E_k,
 * E = local 5x5 mean. Speckle drops by about √T while the spatial detail of every date
 * is kept, which a purely spatial filter cannot do. With fewer than 4 dates: Lee 5x5.
 */
function speckle(stack) {
  const T = stack.length;
  if (T < 4) return stack.map((x) => leeFilter(x, 5));
  const E = stack.map((x) => boxMean(x, 2));
  const R = new Float32Array(N);
  for (let t = 0; t < T; t++) { const I = stack[t], e = E[t]; for (let i = 0; i < N; i++) R[i] += I[i] / (e[i] + 1); }
  // a light 3x3 Lee pass afterwards removes the residual grain without blurring edges
  return E.map((e) => leeFilter(Float32Array.from(e, (v, i) => Math.min(255, (v + 1) * R[i] / T)), 3));
}

function makeStack(id, hh, hv, valid, half_deg, kmWH = null) {
  erode(valid, 3);
  const side = 2 * half_deg * 111.32;
  const [wKm, hKm] = kmWH || [side, side];          // drawn rectangles are resampled to the square grid
  const st = { T: hh.length, hh, hv, valid, pixelKm2: (wKm * hKm) / N, aoiKm: wKm, aoiKmH: hKm };
  st.hhF = speckle(hh);
  st.hvF = speckle(hv);
  stacks.set(id, st);
  results.set(id, {});
  return st;
}

function summary(st) {
  return {
    T: st.T, aoiKm: st.aoiKm, pixelKm2: st.pixelKm2,
    hh: st.hhF.map((x) => maskedMean(x, st.valid)), hv: st.hvF.map((x) => maskedMean(x, st.valid)),
    dark: darkSeries(st).frac,
  };
}

async function load({ id, urls, half_deg }) {
  if (!stacks.has(id)) {
    const datas = await Promise.all(urls.map(decode));
    const hh = [], hv = [];
    const valid = new Uint8Array(N).fill(1);
    for (const d of datas) {
      const H = new Float32Array(N), V = new Float32Array(N);
      for (let i = 0, j = 0; i < N; i++, j += 4) { H[i] = d[j]; V[i] = d[j + 1]; if (d[j + 2] < 128) valid[i] = 0; }
      hh.push(H); hv.push(V);
    }
    makeStack(id, hh, hv, valid, half_deg);
  }
  return summary(stacks.get(id));
}

/** Live region: search ASF, download, co-register and crop in the worker (see regionFetch.js). */
async function region({ id, box, maxDates }, progress) {
  if (!stacks.has(id)) {
    const r = await buildRegion({ box, maxDates }, progress);
    const lat = (box[1] + box[3]) / 2;
    const kmW = (box[2] - box[0]) * 111.32 * Math.cos((lat * Math.PI) / 180), kmH = (box[3] - box[1]) * 111.32;
    const st = makeStack(id, r.hh, r.hv, r.valid, (box[3] - box[1]) / 2, [kmW, kmH]);
    st.meta = { acquisitions: r.acquisitions, track: r.track, box: r.box, fullCover: r.fullCover };
    // land-cover prior (ESA WorldCover 10 m) on the same grid; the analyses run without it if it cannot be read
    progress('Reading ESA WorldCover (land-cover prior)', 0, 1);
    try { st.wc = await readWorldCover(box, SIZE, SIZE); if (!st.wc.some((v) => v)) st.wc = null; } catch (e) { st.wc = null; }
    st.meta.worldcover = !!st.wc;
  }
  const st = stacks.get(id);
  return { ...summary(st), ...st.meta };
}

const ops = {
  load,
  region,
  render({ id, t, mode, filtered, src }) {
    const st = stacks.get(id), r = results.get(id);
    const extra = { filtered };
    if (mode === 'change') extra.change = r.change;
    if (mode === 'clusters') extra.labels = r.km?.labels;
    if (mode === 'confidence') extra.conf = src === 'kmeans' ? r.km?.conf : r.change?.conf;
    const img = render(st, t, mode, extra);
    return { data: img.data.buffer, w: img.width, h: img.height, transfer: [img.data.buffer] };
  },
  change({ id, a, b, ch }) {
    const res = logRatio(stacks.get(id), a, b, ch);
    results.get(id).change = res;
    const { lr, conf, ...summary } = res;
    return summary;
  },
  kmeans({ id, t, k }) {
    const st = stacks.get(id);
    const res = kmeans(pixelFeatures(st, t), st.valid, k);
    results.get(id).km = res;
    return { centroids: res.centroids, counts: res.counts, meanConf: res.meanConf, k: res.k };
  },
  agri({ id, days, t0 }) {
    const st = stacks.get(id), r = results.get(id);
    if (!r.agri) r.agri = computeAgri(st, days, t0);
    return r.agri.summary;
  },
  agriRender({ id, mode, t, seg }) {
    const st = stacks.get(id), r = results.get(id);
    const img = renderAgri(st, mode, r.agri, { t, seg });
    return { data: img.data.buffer, w: img.width, h: img.height, transfer: [img.data.buffer] };
  },
  /**
   * NISAR time series per crop of a model's crop map. The map (P x P classes over `patch` = [w,s,e,n]) is laid over
   * the radar grid of region `id`; every radar pixel whose footprint is >= 60 % one crop counts for that crop.
   * Returns per class: mean RVI and HH per pass, peak, harvest (sharpest RVI drop after the peak) and flooding
   * (HH darker than the water threshold on a pass, then brighter again) dates as pass indices.
   */
  classSeries({ id, patch, cls, P, skip }) {
    const st = stacks.get(id), box = st.meta?.box;
    if (!st || !box) return { classes: [] };
    const [W, S, E, N] = box, cell = (E - W) / SIZE, cellY = (N - S) / SIZE;
    const x0 = Math.floor((patch[0] - W) / cell), x1 = Math.ceil((patch[2] - W) / cell);
    const y0 = Math.floor((N - patch[3]) / cellY), y1 = Math.ceil((N - patch[1]) / cellY);
    const lab = new Uint8Array(cls), T = st.T, groups = new Map();
    const all = new Float32Array(N2() * T), m = new Uint8Array(N2() * T);
    for (let gy = Math.max(0, y0); gy < Math.min(SIZE, y1); gy++) for (let gx = Math.max(0, x0); gx < Math.min(SIZE, x1); gx++) {
      const i = gy * SIZE + gx;
      if (!st.valid[i]) continue;
      // footprint of this radar pixel inside the crop map
      const lw = W + gx * cell, le = lw + cell, ln = N - gy * cellY, ls = ln - cellY;
      const px0 = Math.max(0, Math.floor(((lw - patch[0]) / (patch[2] - patch[0])) * P)), px1 = Math.min(P, Math.ceil(((le - patch[0]) / (patch[2] - patch[0])) * P));
      const py0 = Math.max(0, Math.floor(((patch[3] - ln) / (patch[3] - patch[1])) * P)), py1 = Math.min(P, Math.ceil(((patch[3] - ls) / (patch[3] - patch[1])) * P));
      if (px1 <= px0 || py1 <= py0) continue;
      const cnt = new Map(); let n = 0;
      for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) { const c = lab[y * P + x]; cnt.set(c, (cnt.get(c) || 0) + 1); n++; }
      let bc = -1, bn = 0; for (const [c, k] of cnt) if (k > bn) { bn = k; bc = c; }
      // footprints only partly inside the map count less; require a clear majority
      const cover = n / (((le - lw) / (patch[2] - patch[0])) * P * ((ln - ls) / (patch[3] - patch[1])) * P);
      if (bc < 0 || skip.includes(bc) || bn / n < 0.6 || cover < 0.5) continue;
      const g = groups.get(bc) || { px: 0, rvi: new Float64Array(T), hh: new Float64Array(T) };
      for (let t = 0; t < T; t++) { const h = st.hhF[t][i], v = st.hvF[t][i]; g.rvi[t] += (4 * v) / (h + v + 1); g.hh[t] += h; }
      g.px++; groups.set(bc, g);
    }
    st.hhF.forEach((x, k) => { all.set(x, k * N2()); m.set(st.valid, k * N2()); });
    const thr = st._wthr ?? (st._wthr = Math.min(otsu(all, m), WATER_MAX));
    const out = [];
    for (const [c, g] of groups) {
      const rvi = Array.from(g.rvi, (v) => v / g.px), hh = Array.from(g.hh, (v) => v / g.px);
      const sm = rvi.map((v, t) => (rvi[Math.max(0, t - 1)] + 2 * v + rvi[Math.min(T - 1, t + 1)]) / 4);
      let tp = 0; for (let t = 1; t < T; t++) if (sm[t] > sm[tp]) tp = t;
      let th = -1, best = 0; for (let t = tp + 1; t < T; t++) { const d = rvi[t - 1] - rvi[t]; if (d > best) { best = d; th = t; } }
      let tf = -1; for (let t = 0; t < T - 1 && tf < 0; t++) if (hh[t] < thr) for (let k = t + 1; k < T; k++) if (hh[k] > thr * 1.15) { tf = t; break; }
      out.push({ cls: c, radarPx: g.px, rvi, hh, peak: tp, harvest: th > 0 && best > 0.05 ? th : -1, flood: tf });
    }
    return { classes: out.sort((a, b) => b.radarPx - a.radarPx), radarPxM: Math.round(Math.sqrt(st.pixelKm2) * 1000) };
  },
  landcover({ id }) {
    return computeLandCover(stacks.get(id)).summary;
  },
  landcoverRender({ id, show, t }) {
    const img = renderLandCover(stacks.get(id), { show, t });
    return { data: img.data.buffer, w: img.width, h: img.height, transfer: [img.data.buffer] };
  },
  floodHistory({ id, levels, t }) {
    // compare NISAR water (dark HH on pass t, and ever-dark across the series) with the 1999–2020 flood frequency
    const st = stacks.get(id), N2 = SIZE * SIZE;
    const all = new Float32Array(N2 * st.T), m = new Uint8Array(N2 * st.T);
    st.hhF.forEach((x, k) => { all.set(x, k * N2); m.set(st.valid, k * N2); });
    const thr = st._wthr ?? (st._wthr = Math.min(otsu(all, m), WATER_MAX));
    const lv = new Uint8Array(levels);
    let wetNow = 0, wetNowIn = 0, ever = 0, everIn = 0, zone = 0, zoneWetEver = 0, perm = 0;
    const everDark = new Uint8Array(N2), img = new ImageData(SIZE, SIZE), d = img.data;
    for (let i = 0; i < N2; i++) {
      if (!st.valid[i]) continue;
      let k = 0; for (let tt = 0; tt < st.T; tt++) if (st.hhF[tt][i] < thr) k++;
      // water on (almost) every pass and outside the 1999–2020 flood zones = permanent water (GLAD removed it from the zones)
      const permanent = k / st.T >= 0.9 && lv[i] === 0;
      if (permanent) perm++;
      everDark[i] = k > 0 && !permanent ? 1 : 0;
      const now = st.hhF[t][i] < thr && !permanent;
      const z = lv[i] >= 1;
      if (now) { wetNow++; if (z) wetNowIn++; }
      if (everDark[i]) { ever++; if (z) everIn++; }
      if (z) { zone++; if (everDark[i]) zoneWetEver++; }
      const g = Math.min(255, st.hhF[t][i] * 0.55);
      let c = [g, g, g];
      const zc = [null, [120, 70, 160], [200, 90, 170], [255, 120, 60]][lv[i]];
      if (zc) c = c.map((v, q) => v * 0.45 + zc[q] * 0.55);
      if (permanent) c = [20, 40, 110];
      else if (now) c = z ? [64, 200, 255] : [255, 255, 255];
      const j = i * 4; d[j] = c[0]; d[j + 1] = c[1]; d[j + 2] = c[2]; d[j + 3] = 255;
    }
    const px = st.pixelKm2;
    return { stats: { wetNowKm2: wetNow * px, wetNowInZone: wetNow ? wetNowIn / wetNow : 0, everKm2: ever * px, everInZone: ever ? everIn / ever : 0,
      zoneKm2: zone * px, zoneSeenWet: zone ? zoneWetEver / zone : 0, permKm2: perm * px, thr },
      data: d.buffer, w: SIZE, h: SIZE, transfer: [d.buffer] };
  },
  segmentAt({ id, x, y }) {
    const r = results.get(id);
    return { seg: r.agri ? r.agri.arrays.label[y * SIZE + x] : -1 };
  },
  labels({ id }) {
    const km = results.get(id).km;
    const l = km ? km.labels.slice() : null;
    return { labels: l, transfer: l ? [l.buffer] : [] };
  },
  /**
   * Relative surface wetness from the NISAR series (change detection, Wagner et al. 1999, applied to L-band HH):
   * per pixel, m_t = (HH_t - HH_driest) / (HH_wettest - HH_driest) in the dB-like browse values. Only passes on which
   * the pixel is bare or nearly bare count (HV below the 30th percentile of all pixels and passes: little vegetation
   * volume at that date), because only then does L-band HH mostly follow the moisture of the top few centimetres of soil.
   * Driest / wettest are taken over the pixel's own bare passes; the mean over the bare pixels of each pass is returned.
   */
  wetness({ id }) {
    const st = stacks.get(id), T = st.T;
    if (T < 4) return { sm: [], px: 0 };
    const sample = [];
    for (let i = 0; i < N; i += 7) if (st.valid[i]) for (let t = 0; t < T; t++) sample.push(st.hvF[t][i]);
    sample.sort((a, b) => a - b);
    const cut = sample[Math.floor(sample.length * 0.3)] ?? 0;
    const sum = new Float64Array(T), cnt = new Float64Array(T);
    let used = 0;
    const bare = new Uint8Array(T);
    for (let i = 0; i < N; i++) {
      if (!st.valid[i]) continue;
      let lo = Infinity, hi = -Infinity, nb = 0, mh = 0;
      for (let t = 0; t < T; t++) {
        const h = st.hhF[t][i];
        mh += h;
        bare[t] = st.hvF[t][i] <= cut ? 1 : 0;
        if (!bare[t]) continue;
        nb++; if (h < lo) lo = h; if (h > hi) hi = h;
      }
      if (mh / T < 60 || nb < 3 || hi - lo < 6) continue;   // water / shadow, too few bare passes, no dynamic range
      used++;
      for (let t = 0; t < T; t++) if (bare[t]) { sum[t] += (st.hhF[t][i] - lo) / (hi - lo); cnt[t]++; }
    }
    const minPx = Math.max(30, used * 0.05);
    return { sm: Array.from(sum, (v, t) => (cnt[t] >= minPx ? v / cnt[t] : null)), px: used, km2: used * st.pixelKm2, cut };
  },

  pixel({ id, x, y }) {
    const st = stacks.get(id);
    const avg = (arr) => {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < SIZE && yy < SIZE) { s += arr[yy * SIZE + xx]; n++; }
      }
      return s / n;
    };
    return { hh: st.hhF.map(avg), hv: st.hvF.map(avg) };
  },


};

self.onmessage = async (e) => {
  const { rid, op, args } = e.data;
  try {
    const progress = (stage, done, total) => self.postMessage({ rid, progress: { stage, done, total } });
    const out = await ops[op](args, progress);
    const transfer = out.transfer || [];
    delete out.transfer;
    self.postMessage({ rid, ok: true, out }, transfer);
  } catch (err) {
    self.postMessage({ rid, ok: false, error: String(err && err.stack || err) });
  }
};
