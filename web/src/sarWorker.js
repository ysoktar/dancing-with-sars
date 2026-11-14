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

/**
 * Structural features of ~blockM blocks of a stack: mean HH, mean HV, temporal spread of HH and HV, HV range
 * (p90 - p10 over the passes), mean RVI. Water blocks and blocks with < 50 % valid pixels are skipped.
 */
const FEAT_NAMES = ['mean HH', 'mean HV', 'HH variability', 'HV variability', 'HV range', 'RVI'];
function blockFeatures(st, blockM = 280) {
  const T = st.T, pxM = Math.sqrt(st.pixelKm2) * 1000, B = Math.max(1, Math.round(blockM / pxM)), G = Math.floor(SIZE / B), F = 6;
  const out = new Float32Array(G * G * F), ok = new Uint8Array(G * G);
  const hh = new Float64Array(T), hv = new Float64Array(T);
  const curveH = new Float64Array(T), curveV = new Float64Array(T);
  let nb = 0;
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    hh.fill(0); hv.fill(0);
    let n = 0;
    for (let yy = gy * B; yy < (gy + 1) * B; yy++) for (let xx = gx * B; xx < (gx + 1) * B; xx++) {
      const i = yy * SIZE + xx;
      if (!st.valid[i]) continue;
      n++;
      for (let t = 0; t < T; t++) { hh[t] += st.hhF[t][i]; hv[t] += st.hvF[t][i]; }
    }
    if (n < (B * B) / 2) continue;
    let mH = 0, mV = 0, rv = 0;
    for (let t = 0; t < T; t++) { hh[t] /= n; hv[t] /= n; mH += hh[t]; mV += hv[t]; rv += (4 * hv[t]) / (hh[t] + hv[t] + 1); }
    mH /= T; mV /= T; rv /= T;
    if (mH < 25 && mV < 25) continue;
    let sH = 0, sV = 0;
    for (let t = 0; t < T; t++) { sH += (hh[t] - mH) ** 2; sV += (hv[t] - mV) ** 2; curveH[t] += hh[t]; curveV[t] += hv[t]; }
    const sorted = Array.from(hv).sort((x, y) => x - y);
    const g = gy * G + gx, o = g * F;
    out[o] = mH; out[o + 1] = mV; out[o + 2] = Math.sqrt(sH / T); out[o + 3] = Math.sqrt(sV / T);
    out[o + 4] = sorted[Math.floor(0.9 * (T - 1))] - sorted[Math.floor(0.1 * (T - 1))]; out[o + 5] = rv;
    ok[g] = 1; nb++;
  }
  const hhC = Array.from(curveH, (v) => (nb ? v / nb : null)), hvC = Array.from(curveV, (v) => (nb ? v / nb : null));
  return { G, B, F, out, ok, nb, blockM: B * pxM, hh: hhC, hv: hvC, rvi: hhC.map((h, t) => (h == null ? null : (4 * hvC[t]) / (h + hvC[t] + 1))) };
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

  /**
   * Landslide candidates at pass t: on slopes >= minSlope, a strong HV drop (vegetation stripped) between the passes
   * before t and the passes from t on, that persists. The threshold is k times the spread of the same difference on
   * flat ground (slope < 5 degrees), where landslides cannot happen, so it adapts to the speckle and the season.
   * Water / radar shadow (dark HH) is excluded. Patches of >= minPx connected pixels are returned with their size.
   */
  landslide({ id, t, slope, minSlope = 15, k = 2.5, minPx = 3 }) {
    const st = stacks.get(id), T = st.T;
    const S = new Float32Array(slope);
    const b0 = Math.max(0, t - 3), b1 = t - 1, a0 = t, a1 = Math.min(T - 1, t + 2), p0 = t + 3;
    if (b1 < b0) return { error: 'Pick a later date: there must be at least one pass before it.' };
    const mean = (arr, i, x0, x1) => { let v = 0; for (let q = x0; q <= x1; q++) v += arr[q][i]; return v / (x1 - x0 + 1); };
    const dHV = new Float32Array(N), dHH = new Float32Array(N), keep = new Uint8Array(N);
    const flatHV = [], flatHH = [];
    for (let i = 0; i < N; i++) {
      if (!st.valid[i]) continue;
      const hvB = mean(st.hvF, i, b0, b1), hvA = mean(st.hvF, i, a0, a1);
      const hhB = mean(st.hhF, i, b0, b1), hhA = mean(st.hhF, i, a0, a1);
      if (hhB < 60 && hhA < 60) continue;          // water or radar shadow
      dHV[i] = hvA - hvB; dHH[i] = hhA - hhB; keep[i] = 1;
      if (S[i] < 5) { flatHV.push(dHV[i]); flatHH.push(dHH[i]); }
    }
    const robust = (v) => {   // median absolute deviation -> sigma
      if (v.length < 50) return null;
      const m = v.slice().sort((x, y) => x - y)[v.length >> 1];
      const d = v.map((x) => Math.abs(x - m)).sort((x, y) => x - y)[v.length >> 1];
      return { m, s: Math.max(2, 1.4826 * d) };
    };
    // fall back to all pixels when the window has no flat ground
    let nHV = robust(flatHV), nHH = robust(flatHH), noiseFrom = 'flat ground (slope < 5°)';
    if (!nHV) {
      const all = [], allH = [];
      for (let i = 0; i < N; i += 3) if (keep[i]) { all.push(dHV[i]); allH.push(dHH[i]); }
      nHV = robust(all); nHH = robust(allH); noiseFrom = 'the whole window (no flat ground)';
    }
    if (!nHV) return { error: 'Too few valid radar pixels.' };
    const cand = new Uint8Array(N);
    let steep = 0;
    for (let i = 0; i < N; i++) {
      if (!keep[i] || S[i] < minSlope) continue;
      steep++;
      const zHV = (dHV[i] - nHV.m) / nHV.s, zHH = (dHH[i] - nHH.m) / nHH.s;
      if (zHV > -k) continue;
      if (p0 < T) {   // persistence: HV still low on the later passes
        const later = mean(st.hvF, i, p0, T - 1), before = mean(st.hvF, i, b0, b1);
        if (later - before > -nHV.s) continue;
      }
      cand[i] = 1 + (Math.abs(zHH) > k ? 1 : 0);   // 2 = HH changed as well (new bare surface / debris)
    }
    // connected patches (8-neighbour)
    const lab = new Int32Array(N), patches = [];
    const stack = [];
    for (let i = 0; i < N; i++) {
      if (!cand[i] || lab[i]) continue;
      const id2 = patches.length + 1;
      let n = 0, sx = 0, sy = 0, ss = 0, sz = 0, both = 0;
      stack.push(i); lab[i] = id2;
      const members = [];
      while (stack.length) {
        const j = stack.pop(), x = j % SIZE, y = (j / SIZE) | 0;
        members.push(j); n++; sx += x; sy += y; ss += S[j]; sz += (dHV[j] - nHV.m) / nHV.s; if (cand[j] === 2) both++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= SIZE || yy >= SIZE) continue;
          const q = yy * SIZE + xx;
          if (cand[q] && !lab[q]) { lab[q] = id2; stack.push(q); }
        }
      }
      if (n < minPx) { for (const j of members) { lab[j] = -1; cand[j] = 0; } patches.push(null); continue; }
      patches.push({ id: id2, px: n, km2: n * st.pixelKm2, x: sx / n, y: sy / n, slope: ss / n, z: sz / n, hhChanged: both / n });
    }
    const list = patches.filter(Boolean).sort((p, q) => q.km2 - p.km2);
    // overlay: red = candidate (HV drop), yellow = HV drop + HH change, faint white = steep enough to slide
    const img = new Uint8ClampedArray(N * 4);
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      if (cand[i] === 2) { img[o] = 255; img[o + 1] = 214; img[o + 2] = 10; img[o + 3] = 255; }
      else if (cand[i] === 1) { img[o] = 255; img[o + 1] = 60; img[o + 2] = 40; img[o + 3] = 255; }
      else if (keep[i] && S[i] >= minSlope) { img[o] = 255; img[o + 1] = 255; img[o + 2] = 255; img[o + 3] = 38; }
    }
    return { patches: list.slice(0, 50), n: list.length, km2: list.reduce((a, p) => a + p.km2, 0), steepKm2: steep * st.pixelKm2,
      sigma: nHV.s, noiseFrom, before: [b0, b1], after: [a0, a1], persist: p0 < T,
      data: img.buffer, w: SIZE, h: SIZE, transfer: [img.buffer] };
  },

  /**
   * Mine-tailings spill / mudflow extent between passes a (before) and b (after).
   * Mud burying the ground changes both channels: HV drops (vegetation buried / stripped) and HH changes (new smooth
   * wet surface, or dark ponded water). Seasonal forest change, harvest and soil moisture mostly move one channel, vary
   * from pass to pass, and come back. So a pixel counts when
   *   1. its change exceeds k sigmas, sigma = max(window-wide robust spread, the pixel's own pass-to-pass variability
   *      before the event): pixels that always fluctuate (forest, irrigated fields) need a larger change;
   *   2. both channels agree: HV drop with an HH change >= 1 sigma, or HH darkening to water-like values;
   *   3. it persists: on the pass after b (when there is one) the change is still at least half as large;
   * and patches must have >= minPx pixels with a mean change of >= k + 0.5 sigmas.
   * Pixels that were already water are excluded; each pixel is counted against its ESA WorldCover class.
   */
  spill({ id, a, b, k = 3, minPx = 6 }) {
    const st = stacks.get(id), T = st.T;
    if (!(a < b) || b >= T) return { error: 'Pick a "before" date earlier than the "after" date.' };
    const a0 = Math.max(0, a - 2), nb = a - a0 + 1;
    const pre = (arr, i) => { let v = 0; for (let t = a0; t <= a; t++) v += arr[t][i]; return v / nb; };
    // the pixel's own pass-to-pass variability before the event (consecutive differences, robust: mean absolute diff)
    const own = (arr, i) => {
      if (a < 2) return 0;
      let v = 0;
      for (let t = 1; t <= a; t++) v += Math.abs(arr[t][i] - arr[t - 1][i]);
      return 1.2533 * (v / a) / Math.SQRT2;   // mean |diff| -> sigma of one pass
    };
    const dHV = new Float32Array(N), dHH = new Float32Array(N), sV = new Float32Array(N), sH = new Float32Array(N), keep = new Uint8Array(N);
    const sv = [], sh = [];
    for (let i = 0; i < N; i++) {
      if (!st.valid[i]) continue;
      const hhB = pre(st.hhF, i);
      if (hhB < 60 || (st.wc && st.wc[i] === 80)) continue;   // already water / shadow
      dHV[i] = st.hvF[b][i] - pre(st.hvF, i); dHH[i] = st.hhF[b][i] - hhB; keep[i] = 1;
      sV[i] = own(st.hvF, i); sH[i] = own(st.hhF, i);
      if (i % 3 === 0) { sv.push(dHV[i]); sh.push(dHH[i]); }
    }
    const robust = (v) => {
      const m = v.slice().sort((x, y) => x - y)[v.length >> 1];
      const d = v.map((x) => Math.abs(x - m)).sort((x, y) => x - y)[v.length >> 1];
      return { m, s: Math.max(2, 1.4826 * d) };
    };
    if (sv.length < 100) return { error: 'Too few valid radar pixels.' };
    const nV = robust(sv), nH = robust(sh);
    const cand = new Uint8Array(N), zAbs = new Float32Array(N);
    const drop = { single: 0, transient: 0, small: 0 };
    const hasNext = b + 1 < T;
    for (let i = 0; i < N; i++) {
      if (!keep[i]) continue;
      const sigV = Math.max(nV.s, sV[i]), sigH = Math.max(nH.s, sH[i]);
      const zV = (dHV[i] - nV.m) / sigV, zH = (dHH[i] - nH.m) / sigH;
      let c = 0;
      if (zH < -k && st.hhF[b][i] < 70) c = 2;                        // dark after: water / smooth wet mud
      else if (zV < -k) { if (Math.abs(zH) >= 1) c = 1; else { drop.single += st.pixelKm2; continue; } }
      if (!c) continue;
      if (hasNext) {                                                   // persistence on the next pass
        const nV2 = (st.hvF[b + 1][i] - pre(st.hvF, i) - nV.m) / sigV, nH2 = (st.hhF[b + 1][i] - pre(st.hhF, i) - nH.m) / sigH;
        const still = c === 2 ? nH2 < -k / 2 : nV2 < -k / 2;
        if (!still) { drop.transient += st.pixelKm2; continue; }
      }
      cand[i] = c; zAbs[i] = c === 2 ? -zH : -zV;
    }
    const lab = new Int32Array(N), patches = [], stack = [];
    for (let i = 0; i < N; i++) {
      if (!cand[i] || lab[i]) continue;
      const pid = patches.length + 1, members = [];
      stack.push(i); lab[i] = pid;
      while (stack.length) {
        const j = stack.pop(), x = j % SIZE, y = (j / SIZE) | 0;
        members.push(j);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= SIZE || yy >= SIZE) continue;
          const q = yy * SIZE + xx;
          if (cand[q] && !lab[q]) { lab[q] = pid; stack.push(q); }
        }
      }
      let zs = 0; for (const j of members) zs += zAbs[j];
      if (members.length < minPx || zs / members.length < k + 0.5) { for (const j of members) cand[j] = 0; drop.small += members.length * st.pixelKm2; patches.push(null); continue; }
      let sx = 0, sy = 0, wet = 0, crop = 0;
      for (const j of members) { sx += j % SIZE; sy += (j / SIZE) | 0; if (cand[j] === 2) wet++; if (st.wc && st.wc[j] === 40) crop++; }
      const n = members.length;
      patches.push({ px: n, km2: n * st.pixelKm2, x: sx / n, y: sy / n, wet: wet / n, cropKm2: crop * st.pixelKm2 });
    }
    const list = patches.filter(Boolean).sort((p, q) => q.km2 - p.km2);
    const WC = { 10: 'tree cover', 20: 'shrubland', 30: 'grassland', 40: 'cropland', 50: 'built-up', 60: 'bare / sparse', 70: 'snow / ice', 90: 'wetland', 95: 'mangroves', 100: 'moss / lichen' };
    const byClass = {};
    const img = new Uint8ClampedArray(N * 4);
    for (let i = 0; i < N; i++) {
      if (!cand[i]) continue;
      const o = i * 4;
      if (cand[i] === 2) { img[o] = 40; img[o + 1] = 200; img[o + 2] = 255; } else { img[o] = 255; img[o + 1] = 120; img[o + 2] = 30; }
      img[o + 3] = 255;
      const c = st.wc ? WC[st.wc[i]] || 'other' : 'unknown';
      byClass[c] = (byClass[c] || 0) + st.pixelKm2;
      if (st.wc && st.wc[i] === 40) { img[o] = 255; img[o + 1] = 40; img[o + 2] = 160; }   // on cropland: magenta
    }
    const total = list.reduce((s2, p) => s2 + p.km2, 0);
    return { patches: list.slice(0, 30), n: list.length, km2: total, cropKm2: list.reduce((s2, p) => s2 + p.cropKm2, 0),
      byClass: Object.entries(byClass).sort((p, q) => q[1] - p[1]), worldcover: !!st.wc, sigmaHV: nV.s, sigmaHH: nH.s, drop, hasNext, before: [a0, a],
      data: img.buffer, w: SIZE, h: SIZE, transfer: [img.buffer] };
  },

  /**
   * Structural fingerprint: every ~280 m block of the region gets the same season-light feature vector as the Brazil
   * archetype library (pipeline/build_archetypes.py): mean HH / HV, temporal spread, HV range, RVI and HV trend.
   * Primary output: the nearest structural class (annual cropland, semi-perennial crops, open grass / wetland, closed
   * canopy), distance in within-class spread units, p = softmax(-d^2 / 2). Secondary: the nearest specific Brazilian
   * archetype (weaker, see the library self-test). "Unlike the library": farther than maxD from every class.
   * "Structural shift": WorldCover 2021 said >= 60 % bare / shrub / grass, NISAR now behaves like annual cropland.
   */
  fingerprint({ id, days, lib, blockM = 280, maxD = 2.5 }) {
    const st = stacks.get(id), T = st.T;
    if (T < 6) return { error: 'At least 6 passes are needed.' };
    const pxM = Math.sqrt(st.pixelKm2) * 1000, B = Math.max(1, Math.round(blockM / pxM)), G = Math.floor(SIZE / B);
    const Gs = lib.groups, K = Gs.length, A = lib.archetypes, KA = A.length, F = lib.features.length;
    const nearest = (f, list, scale, d2) => {
      let bk = 0;
      for (let k = 0; k < list.length; k++) {
        const m = list[k].median;
        let d = 0;
        for (let j = 0; j < F; j++) d += ((f[j] - m[j]) / scale[j]) ** 2;
        d2[k] = d / F;
        if (d2[k] < d2[bk]) bk = k;
      }
      let sum = 0;
      for (let k = 0; k < list.length; k++) sum += Math.exp(-(d2[k] - d2[bk]) / 2);
      return { k: bk, p: 1 / sum, d: Math.sqrt(d2[bk]) };
    };
    const tm = days.reduce((x, y) => x + y, 0) / T, tden = Math.max(days.reduce((x, d) => x + (d - tm) ** 2, 0), 1);
    const best = new Int16Array(G * G).fill(-1), conf = new Float32Array(G * G), arch = new Int16Array(G * G).fill(-1), shift = new Uint8Array(G * G);
    const area = new Float64Array(K + 1), confSum = new Float64Array(K + 1), archArea = new Float64Array(KA);
    const hh = new Float64Array(T), hv = new Float64Array(T), f = new Float64Array(F), d2 = new Float64Array(Math.max(K, KA));
    const blockKm2 = B * B * st.pixelKm2, annual = Gs.findIndex((g) => g.id === 'annual');
    let shiftTotal = 0;
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
      hh.fill(0); hv.fill(0);
      let n = 0;
      const wcCount = {};
      for (let yy = gy * B; yy < (gy + 1) * B; yy++) for (let xx = gx * B; xx < (gx + 1) * B; xx++) {
        const i = yy * SIZE + xx;
        if (!st.valid[i]) continue;
        n++;
        for (let t = 0; t < T; t++) { hh[t] += st.hhF[t][i]; hv[t] += st.hvF[t][i]; }
        if (st.wc) wcCount[st.wc[i]] = (wcCount[st.wc[i]] || 0) + 1;
      }
      if (n < (B * B) / 2) continue;
      let mH = 0, mV = 0, rv = 0;
      for (let t = 0; t < T; t++) { hh[t] /= n; hv[t] /= n; mH += hh[t]; mV += hv[t]; rv += (4 * hv[t]) / (hh[t] + hv[t] + 1); }
      mH /= T; mV /= T; rv /= T;
      if (mH < 25 && mV < 25) continue;                          // water
      let sH = 0, sV = 0, tr = 0;
      for (let t = 0; t < T; t++) { sH += (hh[t] - mH) ** 2; sV += (hv[t] - mV) ** 2; tr += (days[t] - tm) * (hv[t] - mV); }
      const sorted = Array.from(hv).sort((x, y) => x - y);
      f[0] = mH; f[1] = mV; f[2] = Math.sqrt(sH / T); f[3] = Math.sqrt(sV / T);
      f[4] = sorted[Math.floor(0.9 * (T - 1))] - sorted[Math.floor(0.1 * (T - 1))]; f[5] = rv; f[6] = (tr / tden) * 100;
      const g = gy * G + gx;
      const ng = nearest(f, Gs, lib.groupScale, d2);
      if (ng.d > maxD) { best[g] = K; area[K] += blockKm2; continue; }
      best[g] = ng.k; conf[g] = ng.p; area[ng.k] += blockKm2; confSum[ng.k] += ng.p * blockKm2;
      const na = nearest(f, A, lib.scale, d2);
      arch[g] = na.k; archArea[na.k] += blockKm2;
      if (st.wc && ng.k === annual && ng.p >= 0.4) {
        const tot = Object.values(wcCount).reduce((x, y) => x + y, 0);
        const open = ((wcCount[60] || 0) + (wcCount[20] || 0) + (wcCount[30] || 0)) / Math.max(tot, 1);
        if (open >= 0.6) { shift[g] = 1; shiftTotal += blockKm2; }
      }
    }
    return { G, B, blockM: B * pxM, best: best.buffer, conf: conf.buffer, arch: arch.buffer, shift: shift.buffer, worldcover: !!st.wc,
      groups: Gs.map((x, k) => ({ id: x.id, km2: area[k], conf: area[k] ? confSum[k] / area[k] : 0 })),
      archetypes: A.map((x, k) => ({ id: x.id, km2: archArea[k] })),
      unlikeKm2: area[K], shiftKm2: shiftTotal, transfer: [best.buffer, conf.buffer, arch.buffer, shift.buffer] };
  },

  /**
   * Two-area similarity. Both areas get the same block features. Each feature is scaled by its robust spread over the
   * two areas together. Overall similarity = mean over features of the overlap of the two value distributions
   * (histogram intersection, 0..1). Map: each block of A coloured by its distance to B's typical (median) block.
   */
  compare({ idA, idB }) {
    const A = blockFeatures(stacks.get(idA)), Bf = blockFeatures(stacks.get(idB)), F = A.F;
    if (A.nb < 10 || Bf.nb < 10) return { error: 'Too few valid land blocks in one of the areas.' };
    const col = (X, j) => { const v = []; for (let g = 0; g < X.ok.length; g++) if (X.ok[g]) v.push(X.out[g * F + j]); return v; };
    const med = (v) => { const s2 = v.slice().sort((x, y) => x - y); return s2[s2.length >> 1]; };
    const feats = [], scale = [], mB = [];
    let overlapSum = 0;
    for (let j = 0; j < F; j++) {
      const a = col(A, j), b = col(Bf, j), all = a.concat(b);
      const m = med(all), sd = Math.max(1e-3, 1.4826 * med(all.map((x) => Math.abs(x - m))));
      const lo = Math.min(...all), hi = Math.max(...all), nbins = 24, w = (hi - lo) / nbins || 1;
      const ha = new Float64Array(nbins), hb = new Float64Array(nbins);
      for (const x of a) ha[Math.min(nbins - 1, Math.floor((x - lo) / w))] += 1 / a.length;
      for (const x of b) hb[Math.min(nbins - 1, Math.floor((x - lo) / w))] += 1 / b.length;
      let ov = 0;
      for (let k = 0; k < nbins; k++) ov += Math.min(ha[k], hb[k]);
      overlapSum += ov;
      const ma = med(a), mb = med(b);
      scale.push(sd); mB.push(mb);
      feats.push({ name: FEAT_NAMES[j], a: ma, b: mb, diffSigma: (ma - mb) / sd, overlap: ov, histA: Array.from(ha), histB: Array.from(hb), lo, hi });
    }
    const dist = new Float32Array(A.G * A.G).fill(-1);
    let close = 0;
    for (let g = 0; g < A.ok.length; g++) {
      if (!A.ok[g]) continue;
      let d = 0;
      for (let j = 0; j < F; j++) d += ((A.out[g * F + j] - mB[j]) / scale[j]) ** 2;
      dist[g] = Math.sqrt(d / F);
      if (dist[g] < 1) close++;
    }
    const wcShares = (st) => { if (!st.wc) return null; const c = {}; let n = 0; for (let i = 0; i < N; i++) if (st.valid[i] && st.wc[i]) { c[st.wc[i]] = (c[st.wc[i]] || 0) + 1; n++; } for (const k in c) c[k] /= n; return n ? c : null; };
    return { similarity: overlapSum / F, feats, G: A.G, dist: dist.buffer, wcA: wcShares(stacks.get(idA)), wcB: wcShares(stacks.get(idB)), closeShare: close / A.nb, blockM: A.blockM,
      curves: { a: { hh: A.hh, hv: A.hv, rvi: A.rvi }, b: { hh: Bf.hh, hv: Bf.hv, rvi: Bf.rvi } }, transfer: [dist.buffer] };
  },

  /**
   * Glaciers and snow: wet-snow / melt mapping in the spirit of Nagler & Rott (2000). Liquid water in snow and firn
   * absorbs L-band, so HH drops sharply below the pixel's dry reference (here: its 80th percentile over the passes).
   * Ice pixels = ESA WorldCover snow / ice (class 70); without WorldCover, bright high pixels are used. A pixel is wet
   * on a pass when its HH is more than k robust sigmas below its reference (sigma from the pass-to-pass spread of the
   * glacier pixels). Per pass: wet share of the ice area and, with elevation, the wet-snow line (the elevation below
   * which most ice pixels are wet).
   */
  glacier({ id, t, elev, k = 2 }) {
    const st = stacks.get(id), T = st.T;
    const E = elev ? new Float32Array(elev) : null;
    const ice = new Uint8Array(N);
    let nIce = 0;
    for (let i = 0; i < N; i++) {
      if (!st.valid[i]) continue;
      if (st.wc ? st.wc[i] === 70 : (E && E[i] > 3000)) { ice[i] = 1; nIce++; }
    }
    if (nIce < 50) return { nIce, iceKm2: nIce * st.pixelKm2, none: true };
    const ref = new Float32Array(N), diffs = [];
    const tmp = new Float32Array(T);
    for (let i = 0; i < N; i++) {
      if (!ice[i]) continue;
      for (let q = 0; q < T; q++) tmp[q] = st.hhF[q][i];
      const srt = Array.from(tmp).sort((x, y) => x - y);
      ref[i] = srt[Math.floor(0.8 * (T - 1))];
      if (i % 5 === 0) for (let q = 1; q < T; q++) diffs.push(Math.abs(st.hhF[q][i] - st.hhF[q - 1][i]));
    }
    diffs.sort((x, y) => x - y);
    const sigma = Math.max(3, 1.2533 * (diffs.reduce((a2, b2) => a2 + b2, 0) / Math.max(diffs.length, 1)) / Math.SQRT2);
    const wetShare = [], snowLine = [];
    for (let q = 0; q < T; q++) {
      let w = 0;
      const bands = new Map();
      for (let i = 0; i < N; i++) {
        if (!ice[i]) continue;
        const wet = st.hhF[q][i] < ref[i] - k * sigma;
        if (wet) w++;
        if (E) { const b = Math.floor(E[i] / 100); const o = bands.get(b) || [0, 0]; o[0]++; if (wet) o[1]++; bands.set(b, o); }
      }
      wetShare.push(w / nIce);
      if (E) {
        let line = null;
        for (const [b, [n, wv]] of [...bands.entries()].sort((x, y) => x[0] - y[0])) if (n >= 20 && wv / n >= 0.5) line = (b + 1) * 100;
        snowLine.push(line);
      }
    }
    // map of pass t: white = dry snow / ice, blue = wet (melting), faint = not ice
    const img = new Uint8ClampedArray(N * 4);
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      if (!st.valid[i]) { img[o + 3] = 255; continue; }
      if (!ice[i]) { const v = st.hhF[t][i] * 0.35; img[o] = v; img[o + 1] = v; img[o + 2] = v; img[o + 3] = 255; continue; }
      const wet = st.hhF[t][i] < ref[i] - k * sigma;
      if (wet) { img[o] = 30; img[o + 1] = 140; img[o + 2] = 255; } else { img[o] = 235; img[o + 1] = 242; img[o + 2] = 250; }
      img[o + 3] = 255;
    }
    return { nIce, iceKm2: nIce * st.pixelKm2, sigma, wetShare, snowLine: E ? snowLine : null, worldcover: !!st.wc,
      data: img.buffer, w: SIZE, h: SIZE, transfer: [img.buffer] };
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
