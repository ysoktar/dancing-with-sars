// Agricultural products from a NISAR HH/HV time series, per pixel.
// Runs inside the SAR Web Worker. All values come from browse-image brightness,
// so indices are relative (good for timing and patterns, not absolute biomass).
import { SIZE, lut, otsu } from './sar.js';

const N = SIZE * SIZE;
// Otsu on HH splits a scene into its two dominant brightness groups. In scenes with little water
// (forest vs pasture, desert) that split is not a water threshold, so it is capped: open water in the
// browse images sits well below this brightness.
export const WATER_MAX = 90;
export const PATTERNS = [
  { name: 'Open water', color: '#2563eb', why: 'Dark in HH on most passes (calm water reflects the pulse away).' },
  { name: 'Paddy rice', color: '#22d3ee', why: 'Flooded (dark HH) for a short period, then the canopy grows: the transplanting signature.' },
  { name: 'Double / multiple crop', color: '#f59e0b', why: 'Two or more clear growth peaks in the radar vegetation index within the series.' },
  { name: 'Single crop', color: '#facc15', why: 'One clear growth peak followed by a drop (harvest).' },
  { name: 'Perennial / trees', color: '#16a34a', why: 'High and steady vegetation index: orchards, plantations, forest, permanent grassland.' },
  { name: 'Bare / built / fallow', color: '#a8a29e', why: 'Low vegetation index with little seasonal change: towns, roads, bare or fallow land.' },
];

/** Radar Vegetation Index for dual-pol data: RVI = 4·HV / (HH + HV) (relative here: browse brightness). */
export function rviStack(st) {
  if (st._rvi) return st._rvi;
  st._rvi = st.hhF.map((H, t) => {
    const V = st.hvF[t], R = new Float32Array(N);
    for (let i = 0; i < N; i++) R[i] = (4 * V[i]) / (H[i] + V[i] + 1);
    return R;
  });
  return st._rvi;
}

function pct(arr, mask, p) {
  const v = [];
  for (let i = 0; i < arr.length; i += 3) if ((!mask || mask[i]) && Number.isFinite(arr[i])) v.push(arr[i]);
  if (!v.length) return NaN;
  v.sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(v.length * p))];
}

/**
 * Compute every agricultural product for a stack.
 * days: acquisition day numbers (days since the first pass).
 */
export function computeAgri(st, days, t0 = 0) {
  const T = st.T, valid = st.valid, rvi = rviStack(st);
  // one dark-water threshold for the whole stack (Otsu on filtered HH)
  const all = new Float32Array(N * T), m = new Uint8Array(N * T);
  st.hhF.forEach((x, t) => { all.set(x, t * N); m.set(valid, t * N); });
  const thr = Math.min(otsu(all, m), WATER_MAX);

  const sos = new Float32Array(N).fill(NaN), pos = new Float32Array(N).fill(NaN), eos = new Float32Array(N).fill(NaN);
  const harvest = new Float32Array(N).fill(NaN), flood = new Float32Array(N).fill(NaN);
  const amp = new Float32Array(N), mean = new Float32Array(N), peaks = new Uint8Array(N), waterFrac = new Float32Array(N);
  const r = new Float32Array(T), rs = new Float32Array(T);
  const interp = (t0, t1, v0, v1, target) => (v1 === v0 ? days[t1] : days[t0] + ((target - v0) / (v1 - v0)) * (days[t1] - days[t0]));

  for (let i = 0; i < N; i++) {
    if (!valid[i]) continue;
    let wet = 0;
    for (let t = 0; t < T; t++) { r[t] = rvi[t][i]; if (st.hhF[t][i] < thr) wet++; }
    waterFrac[i] = wet / T;
    for (let t = 0; t < T; t++) {                       // light temporal smoothing (1-2-1)
      const a = r[Math.max(0, t - 1)], b = r[t], c = r[Math.min(T - 1, t + 1)];
      rs[t] = (a + 2 * b + c) / 4;
    }
    let mn = Infinity, mx = -Infinity, tp = 0, sum = 0;
    for (let t = 0; t < T; t++) { sum += rs[t]; if (rs[t] < mn) mn = rs[t]; if (rs[t] > mx) { mx = rs[t]; tp = t; } }
    amp[i] = mx - mn; mean[i] = sum / T;
    pos[i] = days[tp];
    // start / end of season: 50 % of the rise before and of the fall after the peak
    let bmin = Infinity; for (let t = 0; t <= tp; t++) bmin = Math.min(bmin, rs[t]);
    const up = bmin + 0.5 * (mx - bmin);
    for (let t = tp; t > 0; t--) if (rs[t - 1] <= up && rs[t] >= up) { sos[i] = interp(t - 1, t, rs[t - 1], rs[t], up); break; }
    let amin = Infinity; for (let t = tp; t < T; t++) amin = Math.min(amin, rs[t]);
    const dn = amin + 0.5 * (mx - amin);
    for (let t = tp; t < T - 1; t++) if (rs[t] >= dn && rs[t + 1] <= dn) { eos[i] = interp(t, t + 1, rs[t], rs[t + 1], dn); break; }
    // harvest = sharpest drop of the raw index from an above-average level
    let best = 0, bt = -1;
    for (let t = 1; t < T; t++) { const d = r[t - 1] - r[t]; if (d > best && r[t - 1] > mean[i]) { best = d; bt = t; } }
    if (bt > 0 && best > Math.max(0.06, 0.35 * amp[i])) harvest[i] = days[bt];
    // growth peaks with enough prominence
    let np = 0;
    for (let t = 1; t < T - 1; t++) {
      if (!(rs[t] >= rs[t - 1] && rs[t] > rs[t + 1])) continue;
      let lmin = rs[t], rmin = rs[t];
      for (let k = t - 1; k >= 0; k--) lmin = Math.min(lmin, rs[k]);
      for (let k = t + 1; k < T; k++) rmin = Math.min(rmin, rs[k]);
      if (rs[t] - Math.max(lmin, rmin) > Math.max(0.04, 0.3 * amp[i])) np++;
    }
    peaks[i] = np;
    // paddy flooding: dark (water) on a pass, then clearly brighter again within ~2 months
    if (waterFrac[i] < 0.5) {
      for (let t = 0; t < T - 1 && Number.isNaN(flood[i]); t++) {
        if (st.hhF[t][i] >= thr) continue;
        for (let k = t + 1; k < T && days[k] - days[t] <= 70; k++) if (st.hhF[k][i] > thr * 1.15) { flood[i] = days[t]; break; }
      }
    }
  }

  // cropland: pixels with a clear seasonal cycle (relative to the scene)
  const ampThr = Math.max(0.05, 0.6 * pct(amp, valid, 0.75));
  const meanHi = pct(mean, valid, 0.6);
  const cls = new Uint8Array(N).fill(255);
  for (let i = 0; i < N; i++) {
    if (!valid[i]) continue;
    const crop = amp[i] > ampThr;
    if (waterFrac[i] >= 0.6) cls[i] = 0;
    else if (crop && !Number.isNaN(flood[i])) cls[i] = 1;
    else if (crop && peaks[i] >= 2) cls[i] = 2;
    else if (crop) cls[i] = 3;
    else if (mean[i] > meanHi) cls[i] = 4;
    else cls[i] = 5;
  }
  const isCrop = (c) => c >= 1 && c <= 3;

  // per-pass curves
  const nValid = valid.reduce((a, b) => a + b, 0);
  let nCrop = 0; for (let i = 0; i < N; i++) if (isCrop(cls[i])) nCrop++;
  const floodKm2 = [], harvestCum = [], rviCrop = [];
  for (let t = 0; t < T; t++) {
    let f = 0, h = 0, s = 0;
    for (let i = 0; i < N; i++) {
      if (!valid[i]) continue;
      if (st.hhF[t][i] < thr && waterFrac[i] < 0.5) f++;
      if (isCrop(cls[i])) { s += rvi[t][i]; if (harvest[i] <= days[t]) h++; }
    }
    floodKm2.push(f * st.pixelKm2); harvestCum.push(nCrop ? (h / nCrop) * 100 : 0); rviCrop.push(nCrop ? s / nCrop : 0);
  }
  // pattern areas and mean RVI profile per pattern
  const patterns = PATTERNS.map((p, k) => {
    let n = 0; const prof = new Float64Array(T);
    for (let i = 0; i < N; i++) if (cls[i] === k) { n++; for (let t = 0; t < T; t++) prof[t] += rvi[t][i]; }
    return { ...p, km2: n * st.pixelKm2, pct: n / nValid, profile: Array.from(prof, (v) => (n ? v / n : null)) };
  });

  const seg = segments(st, cls, harvest, sos, pos, rvi, days, isCrop);
  // area by calendar month of each event (km²)
  const hist = {};
  for (const k of ['sos', 'pos', 'eos', 'harvest', 'flood']) {
    const arr = { sos, pos, eos, harvest, flood }[k], h = {};
    for (let i = 0; i < N; i++) {
      if (Number.isNaN(arr[i]) || (k !== 'flood' && !isCrop(cls[i]))) continue;
      const mk = new Date(t0 + arr[i] * 86400000).toISOString().slice(0, 7);
      h[mk] = (h[mk] || 0) + st.pixelKm2;
    }
    hist[k] = h;
  }
  const peakMonthHist = hist.pos;
  return {
    arrays: { sos, pos, eos, harvest, flood, cls, label: seg.label, rvi },
    summary: {
      days, thr, croplandPct: nCrop / nValid, croplandKm2: nCrop * st.pixelKm2,
      floodKm2, harvestCum, rviCrop, patterns, segments: seg.list, peakMonthHist, hist,
      rviRange: [pct(rvi[0], valid, 0.02), pct(rvi[Math.floor(T / 2)], valid, 0.98)],
    },
  };
}

/** Field-like segments: connected regions with the same cropping pattern and harvest month. */
function segments(st, cls, harvest, sos, pos, rvi, days, isCrop) {
  const T = st.T;
  // 3x3 majority filter on the pattern classes to remove speckle
  const sm = new Uint8Array(N).fill(255);
  for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) {
    const i = y * SIZE + x;
    if (cls[i] === 255) continue;
    const cnt = new Uint8Array(6);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const c = cls[i + dy * SIZE + dx]; if (c < 6) cnt[c]++; }
    let b = cls[i]; for (let c = 0; c < 6; c++) if (cnt[c] > cnt[b]) b = c;
    sm[i] = b;
  }
  const key = (i) => (isCrop(sm[i]) ? sm[i] * 100 + (Number.isNaN(harvest[i]) ? 99 : Math.floor(harvest[i] / 30)) : -1);
  const label = new Int32Array(N).fill(-1);
  const list = [];
  const stack = new Int32Array(N);
  let next = 0;
  for (let s = 0; s < N; s++) {
    if (label[s] !== -1) continue;
    const k = key(s);
    if (k < 0) continue;
    let top = 0, n = 0; stack[top++] = s; label[s] = next;
    const px = [];
    while (top) {
      const i = stack[--top]; px.push(i); n++;
      const x = i % SIZE, y = (i / SIZE) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < SIZE - 1 ? i + 1 : -1, y > 0 ? i - SIZE : -1, y < SIZE - 1 ? i + SIZE : -1]) {
        if (j >= 0 && label[j] === -1 && key(j) === k) { label[j] = next; stack[top++] = j; }
      }
    }
    if (n < 6) { for (const i of px) label[i] = -2; continue; }
    const med = (arr) => { const v = px.map((i) => arr[i]).filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : null; };
    const prof = new Array(T).fill(0);
    for (const i of px) for (let t = 0; t < T; t++) prof[t] += rvi[t][i];
    let cx = 0, cy = 0; for (const i of px) { cx += i % SIZE; cy += (i / SIZE) | 0; }
    list.push({ id: next, cls: sm[s], n, km2: n * st.pixelKm2, sos: med(sos), peak: med(pos), harvest: med(harvest),
      profile: prof.map((v) => v / n), cx: cx / n, cy: cy / n });
    next++;
  }
  for (let i = 0; i < N; i++) if (label[i] === -2) label[i] = -1;
  list.sort((a, b) => b.n - a.n);
  return { label, list: list.slice(0, 120) };
}

/** Render an agricultural product as an image. */
export function renderAgri(st, mode, A, opts = {}) {
  const img = new ImageData(SIZE, SIZE), d = img.data, valid = st.valid;
  const put = (i, c, a = 255) => { const j = i * 4; d[j] = c[0]; d[j + 1] = c[1]; d[j + 2] = c[2]; d[j + 3] = valid[i] ? a : 0; };
  const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const grey = (i) => { const g = Math.min(255, st.hhF[opts.t ?? 0][i] * 0.5); return [g, g, g]; };
  if (mode === 'rvi') {
    const L = lut('viridis'), R = A.arrays.rvi[opts.t ?? 0], [lo, hi] = A.summary.rviRange;
    for (let i = 0; i < N; i++) { const k = Math.round(255 * Math.max(0, Math.min(1, (R[i] - lo) / (hi - lo)))) * 3; put(i, [L[k], L[k + 1], L[k + 2]]); }
  } else if (['sos', 'pos', 'eos', 'harvest', 'flood'].includes(mode)) {
    const L = lut('turbo'), arr = A.arrays[mode], days = A.summary.days;
    const lo = days[0], hi = days[days.length - 1];
    for (let i = 0; i < N; i++) {
      if (Number.isNaN(arr[i]) || (mode !== 'flood' && A.arrays.cls[i] > 3) || (mode !== 'flood' && A.arrays.cls[i] === 0)) { put(i, grey(i)); continue; }
      const k = Math.round(255 * Math.max(0, Math.min(1, (arr[i] - lo) / Math.max(1, hi - lo)))) * 3;
      put(i, [L[k], L[k + 1], L[k + 2]]);
    }
  } else if (mode === 'pattern') {
    const cols = PATTERNS.map((p) => hex(p.color));
    for (let i = 0; i < N; i++) put(i, A.arrays.cls[i] < 6 ? cols[A.arrays.cls[i]] : [0, 0, 0]);
  } else if (mode === 'segments') {
    const lab = A.arrays.label, sel = opts.seg ?? -1;
    const colOf = (id) => [80 + ((id * 97) % 160), 80 + ((id * 57) % 160), 80 + ((id * 151) % 160)];
    for (let i = 0; i < N; i++) {
      const id = lab[i];
      if (id < 0) { put(i, grey(i)); continue; }
      const x = i % SIZE, y = (i / SIZE) | 0;
      const edge = (x > 0 && lab[i - 1] !== id) || (x < SIZE - 1 && lab[i + 1] !== id) || (y > 0 && lab[i - SIZE] !== id) || (y < SIZE - 1 && lab[i + SIZE] !== id);
      if (id === sel) put(i, edge ? [255, 255, 255] : [232, 176, 74]);
      else put(i, edge ? [20, 20, 20] : colOf(id).map((v) => (sel >= 0 ? v * 0.55 : v)));
    }
  }
  return img;
}

/**
 * Cropland vs forest separation from two physical axes:
 *   x = seasonal amplitude of the radar vegetation index (crops are sown and harvested -> large swing)
 *   y = mean HV over all passes (forest canopies depolarise L-band all year -> high, steady HV)
 * Thresholds are found per scene (Otsu on mean HV of non-water pixels, upper-quartile rule on amplitude),
 * so the classes are relative to the site. Confidence = distance from the nearest threshold, in units of
 * that axis' spread (0 = on a boundary, 1 = far inside a class).
 */
export const LANDCOVER = [
  { name: 'Forest / tree cover', color: '#15803d', why: 'High HV on every pass and little seasonal change: L-band scatters many times inside a woody canopy.' },
  { name: 'Cropland', color: '#e8b04a', why: 'Large seasonal swing of the vegetation index: fields are sown, grow and are harvested within the series.' },
  { name: 'Tree crops / mixed', color: '#84cc16', why: 'High HV and a moderate seasonal swing: orchards, plantations, agroforestry, or forest with crops mixed in a pixel.' },
  { name: 'Open water', color: '#2563eb', why: 'Dark in HH on most passes.' },
  { name: 'Grass / bare / built', color: '#a8a29e', why: 'Low HV and little seasonal swing: pasture, bare soil, towns and roads.' },
];

export function computeLandCover(st) {
  if (st._lc) return st._lc;
  const T = st.T, valid = st.valid, rvi = rviStack(st);
  const all = new Float32Array(N * T), m = new Uint8Array(N * T);
  st.hhF.forEach((x, t) => { all.set(x, t * N); m.set(valid, t * N); });
  // stricter than the flood threshold: dry, smooth pasture can be almost as dark as water in L-band HH
  const thrW = Math.min(otsu(all, m), 50);
  const amp = new Float32Array(N), hv = new Float32Array(N), water = new Uint8Array(N), rs = new Float32Array(T);
  for (let i = 0; i < N; i++) {
    if (!valid[i]) continue;
    let wet = 0, s = 0;
    for (let t = 0; t < T; t++) { if (st.hhF[t][i] < thrW) wet++; s += st.hvF[t][i]; }
    hv[i] = s / T;
    water[i] = wet / T >= 0.6 ? 1 : 0;
    for (let t = 0; t < T; t++) rs[t] = (rvi[Math.max(0, t - 1)][i] + 2 * rvi[t][i] + rvi[Math.min(T - 1, t + 1)][i]) / 4;
    let mn = Infinity, mx = -Infinity;
    for (let t = 0; t < T; t++) { if (rs[t] < mn) mn = rs[t]; if (rs[t] > mx) mx = rs[t]; }
    amp[i] = mx - mn;
  }
  const land = Uint8Array.from(valid, (v, i) => (v && !water[i] ? 1 : 0));
  const hvThr = otsu(hv, land);
  const ampThr = Math.max(0.05, 0.6 * pct(amp, land, 0.75));
  const ampHi = Math.max(ampThr * 1.6, pct(amp, land, 0.9));
  const sHv = Math.max(1, pct(hv, land, 0.9) - pct(hv, land, 0.1)), sAmp = Math.max(0.02, pct(amp, land, 0.9) - pct(amp, land, 0.1));
  const cls = new Uint8Array(N).fill(255), conf = new Float32Array(N);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  for (let i = 0; i < N; i++) {
    if (!valid[i]) continue;
    if (water[i]) { cls[i] = 3; conf[i] = 1; continue; }
    const dh = (hv[i] - hvThr) / sHv, da = (amp[i] - ampThr) / sAmp;
    if (hv[i] >= hvThr && amp[i] <= ampThr) { cls[i] = 0; conf[i] = clamp(2.5 * Math.min(dh, -da)); }
    else if (amp[i] > ampThr && (hv[i] < hvThr || amp[i] > ampHi)) { cls[i] = 1; conf[i] = clamp(2.5 * Math.max(Math.min(da, -dh), (amp[i] - ampHi) / sAmp)); }
    else if (hv[i] >= hvThr) { cls[i] = 2; conf[i] = clamp(2.5 * Math.min(dh, da, (ampHi - amp[i]) / sAmp)); }
    else { cls[i] = 4; conf[i] = clamp(2.5 * Math.min(-dh, -da)); }
  }
  // forest-cropland edges (4-neighbour) -> a proxy for the clearing frontier
  let edge = 0;
  const isEdge = new Uint8Array(N);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = y * SIZE + x;
    if (cls[i] !== 0) continue;
    for (const j of [x > 0 ? i - 1 : -1, x < SIZE - 1 ? i + 1 : -1, y > 0 ? i - SIZE : -1, y < SIZE - 1 ? i + SIZE : -1]) {
      if (j >= 0 && cls[j] === 1) { edge++; isEdge[i] = 1; isEdge[j] = 1; }
    }
  }
  const nValid = valid.reduce((a, b) => a + b, 0);
  const classes = LANDCOVER.map((c, k) => {
    let n = 0, cs = 0;
    for (let i = 0; i < N; i++) if (cls[i] === k) { n++; cs += conf[i]; }
    return { ...c, km2: n * st.pixelKm2, pct: n / nValid, meanConf: n ? cs / n : 0 };
  });
  // scatter sample (deterministic stride), for the separability plot
  const sample = [];
  const step = Math.max(1, Math.floor(nValid / 2500));
  for (let i = 0, k = 0; i < N; i++) if (valid[i] && (k++ % step === 0)) sample.push([+amp[i].toFixed(3), +hv[i].toFixed(1), cls[i]]);
  st._lc = {
    arrays: { cls, conf, isEdge },
    summary: { classes, hvThr, ampThr, ampHi, edgeKm: edge * Math.sqrt(st.pixelKm2), sample },
  };
  return st._lc;
}

export function renderLandCover(st, opts = {}) {
  const A = computeLandCover(st), img = new ImageData(SIZE, SIZE), d = img.data, valid = st.valid;
  const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const cols = LANDCOVER.map((c) => hex(c.color));
  const show = opts.show || 'classes';
  for (let i = 0; i < N; i++) {
    const j = i * 4, c = A.arrays.cls[i];
    const g = Math.min(255, st.hvF[opts.t ?? 0][i] * 0.6);
    let rgb = [g, g, g];
    if (c < 5) {
      if (show === 'classes') rgb = cols[c];
      else if (show === 'confidence') { const a = 0.25 + 0.75 * A.arrays.conf[i]; rgb = cols[c].map((v, k) => v * a + [g, g, g][k] * (1 - a)); }
      else if (show === 'edges') rgb = A.arrays.isEdge[i] ? [255, 64, 64] : c === 0 ? [21, 90, 50] : c === 1 ? [150, 115, 50] : [g * 0.5, g * 0.5, g * 0.5];
    }
    d[j] = rgb[0]; d[j + 1] = rgb[1]; d[j + 2] = rgb[2]; d[j + 3] = valid[i] ? 255 : 0;
  }
  return img;
}
