// SAR image-stack utilities: loading the co-registered AOI crops, speckle
// filtering, colour maps, thresholds and change metrics. Pure JS, no deps.

export const SIZE = 256;
const N = SIZE * SIZE;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Load all AOI crops of a site into Float32 HH / HV stacks + validity mask. */
export async function loadStack(site, base, onProgress) {
  const acqs = site.acquisitions;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const hh = [], hv = [];
  const valid = new Uint8Array(N).fill(1);
  let done = 0;
  const imgs = await Promise.all(acqs.map(async (a) => {
    const img = await loadImage(base + a.crop);
    onProgress && onProgress(++done / acqs.length);
    return img;
  }));
  for (const img of imgs) {
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const d = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const H = new Float32Array(N), V = new Float32Array(N);
    for (let i = 0, j = 0; i < N; i++, j += 4) {
      H[i] = d[j]; V[i] = d[j + 1];
      if (d[j + 2] < 128) valid[i] = 0;
    }
    hh.push(H); hv.push(V);
  }
  erode(valid, 3); // drop resampling halo along no-data edges
  const stack = { site, T: acqs.length, hh, hv, valid, dates: acqs.map((a) => a.date) };
  stack.hhF = hh.map((x) => leeFilter(x, 5));
  stack.hvF = hv.map((x) => leeFilter(x, 5));
  // pixel footprint in km² (AOI is 2*half_deg tall, longitude span corrected by cos(lat))
  const side = 2 * site.half_deg * 111.32;
  stack.pixelKm2 = (side * side) / N;
  stack.aoiKm = side;
  return stack;
}

function erode(mask, r) {
  for (let pass = 0; pass < r; pass++) {
    const src = mask.slice();
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      if (!src[i]) continue;
      if (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1) continue;
      if (!src[i - 1] || !src[i + 1] || !src[i - SIZE] || !src[i + SIZE]) mask[i] = 0;
    }
  }
}

// ---------------------------------------------------------------- filters
function boxMean(src, r) {
  // separable running mean with edge clamping
  const tmp = new Float32Array(N), out = new Float32Array(N);
  const w = 2 * r + 1;
  for (let y = 0; y < SIZE; y++) {
    const row = y * SIZE;
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[row + Math.min(SIZE - 1, Math.max(0, k))];
    for (let x = 0; x < SIZE; x++) {
      tmp[row + x] = s / w;
      const add = Math.min(SIZE - 1, x + r + 1), sub = Math.max(0, x - r);
      s += src[row + add] - src[row + sub];
    }
  }
  for (let x = 0; x < SIZE; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(SIZE - 1, Math.max(0, k)) * SIZE + x];
    for (let y = 0; y < SIZE; y++) {
      out[y * SIZE + x] = s / w;
      const add = Math.min(SIZE - 1, y + r + 1), sub = Math.max(0, y - r);
      s += tmp[add * SIZE + x] - tmp[sub * SIZE + x];
    }
  }
  return out;
}

/** Lee adaptive speckle filter (window = size x size). */
export function leeFilter(img, size = 5) {
  const r = (size - 1) >> 1;
  const mean = boxMean(img, r);
  const sq = new Float32Array(N);
  for (let i = 0; i < N; i++) sq[i] = img[i] * img[i];
  const meanSq = boxMean(sq, r);
  const variance = new Float32Array(N);
  let noise = 0;
  for (let i = 0; i < N; i++) { variance[i] = Math.max(0, meanSq[i] - mean[i] * mean[i]); noise += variance[i]; }
  noise /= N;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const k = variance[i] / (variance[i] + noise + 1e-6);
    out[i] = mean[i] + k * (img[i] - mean[i]);
  }
  return out;
}

// ---------------------------------------------------------------- stats
export function otsu(values, mask, lo = 0, hi = 255, bins = 256) {
  const hist = new Float64Array(bins);
  const scale = (bins - 1) / (hi - lo);
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    if (mask && !mask[i]) continue;
    const b = Math.max(0, Math.min(bins - 1, Math.round((values[i] - lo) * scale)));
    hist[b]++; n++;
  }
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = i; }
  }
  return lo + thr / scale;
}

export function maskedMean(a, mask) {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (mask[i]) { s += a[i]; n++; }
  return n ? s / n : 0;
}

/** Fraction of dark (water-like) pixels per date using one Otsu threshold for the whole stack. */
export function darkSeries(stack) {
  const all = new Float32Array(N * stack.T);
  stack.hhF.forEach((x, t) => all.set(x, t * N));
  const m = new Uint8Array(N * stack.T);
  for (let t = 0; t < stack.T; t++) m.set(stack.valid, t * N);
  const thr = otsu(all, m);
  const nValid = stack.valid.reduce((a, b) => a + b, 0);
  return {
    thr,
    frac: stack.hhF.map((x) => {
      let c = 0;
      for (let i = 0; i < N; i++) if (stack.valid[i] && x[i] < thr) c++;
      return c / nValid;
    }),
  };
}

/** Log-ratio change between two dates on a channel; returns {lr, thr, inc, dec}. */
export function logRatio(stack, t0, t1, channel = 'span') {
  const get = (t) => {
    if (channel === 'hh') return stack.hhF[t];
    if (channel === 'hv') return stack.hvF[t];
    const a = stack.hhF[t], b = stack.hvF[t], o = new Float32Array(N);
    for (let i = 0; i < N; i++) o[i] = 0.5 * (a[i] + b[i]);
    return o;
  };
  const A = get(t0), B = get(t1);
  const lr = new Float32Array(N), mag = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    lr[i] = Math.log((B[i] + 4) / (A[i] + 4));
    mag[i] = Math.abs(lr[i]);
  }
  const thr = Math.max(0.12, otsu(mag, stack.valid, 0, 1.5, 300));
  // confidence that a pixel really changed: how far |log-ratio| lies beyond the threshold,
  // in units of the spread of unchanged pixels (logistic squashing to 0..1)
  let s = 0, s2 = 0, m = 0;
  for (let i = 0; i < N; i++) if (stack.valid[i] && mag[i] <= thr) { s += mag[i]; s2 += mag[i] * mag[i]; m++; }
  const sd = Math.sqrt(Math.max(1e-6, s2 / m - (s / m) ** 2));
  const conf = new Float32Array(N);
  let inc = 0, dec = 0, n = 0, cSum = 0;
  for (let i = 0; i < N; i++) {
    if (!stack.valid[i]) continue;
    n++;
    conf[i] = 1 / (1 + Math.exp(-(mag[i] - thr) / sd));
    if (lr[i] > thr) { inc++; cSum += conf[i]; } else if (lr[i] < -thr) { dec++; cSum += conf[i]; }
  }
  return { lr, thr, conf, meanConf: inc + dec ? cSum / (inc + dec) : 0, inc: inc / n, dec: dec / n, incKm2: inc * stack.pixelKm2, decKm2: dec * stack.pixelKm2 };
}

/** Per-pixel temporal standard deviation of (filtered) HH and HV. */
export function temporalStd(stack) {
  const sH = new Float32Array(N), sV = new Float32Array(N);
  const mH = new Float32Array(N), mV = new Float32Array(N);
  for (let t = 0; t < stack.T; t++) {
    const a = stack.hhF[t], b = stack.hvF[t];
    for (let i = 0; i < N; i++) { mH[i] += a[i]; mV[i] += b[i]; }
  }
  for (let i = 0; i < N; i++) { mH[i] /= stack.T; mV[i] /= stack.T; }
  for (let t = 0; t < stack.T; t++) {
    const a = stack.hhF[t], b = stack.hvF[t];
    for (let i = 0; i < N; i++) { sH[i] += (a[i] - mH[i]) ** 2; sV[i] += (b[i] - mV[i]) ** 2; }
  }
  for (let i = 0; i < N; i++) { sH[i] = Math.sqrt(sH[i] / stack.T); sV[i] = Math.sqrt(sV[i] / stack.T); }
  return { mH, mV, sH, sV };
}

// ---------------------------------------------------------------- colour maps
const stops = {
  inferno: ['#000004', '#320a5e', '#781c6d', '#bc3754', '#ed6925', '#fbb61a', '#fcffa4'],
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  diverge: ['#b2182b', '#ef8a62', '#fddbc7', '#f7f7f7', '#d1e5f0', '#67a9cf', '#2166ac'],
  ice: ['#020617', '#0c4a6e', '#0ea5e9', '#a5f3fc', '#ffffff'],
  terrain: ['#1d4f60', '#3b7d5a', '#8fae6b', '#d8c98f', '#b48a63', '#8c6e5d', '#f2f2f2'],
};
const lutCache = {};
export function lut(name) {
  if (lutCache[name]) return lutCache[name];
  const s = stops[name].map((h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)));
  const out = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const f = (i / 255) * (s.length - 1), k = Math.min(s.length - 2, Math.floor(f)), u = f - k;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(s[k][c] * (1 - u) + s[k + 1][c] * u);
  }
  return (lutCache[name] = out);
}

export const CLUSTER_COLORS = ['#38bdf8', '#22c55e', '#f43f5e', '#facc15', '#a78bfa', '#fb923c', '#e2e8f0', '#14b8a6'];

function stretch(a, mask, pLo = 0.02, pHi = 0.98) {
  const v = [];
  for (let i = 0; i < a.length; i += 7) if (!mask || mask[i]) v.push(a[i]);
  v.sort((x, y) => x - y);
  return [v[Math.floor(v.length * pLo)] ?? 0, v[Math.floor(v.length * pHi)] ?? 255];
}

/** Render a frame into ImageData. mode: rgb | hh | hv | ratio | change | clusters | anomaly */
export function render(stack, t, mode, extra = {}) {
  const img = new ImageData(SIZE, SIZE);
  const d = img.data;
  const filt = extra.filtered;
  const H = filt ? stack.hhF[t] : stack.hh[t];
  const V = filt ? stack.hvF[t] : stack.hv[t];
  const valid = stack.valid;
  const put = (i, r, g, b) => { const j = i * 4; d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = valid[i] ? 255 : 0; };

  if (mode === 'rgb') {
    // Pauli-like dual-pol composite: R = HH, G = HV, B = HH/HV contrast
    const [h0, h1] = stack._hhRange || (stack._hhRange = stretch(stack.hh[0], valid));
    const [v0, v1] = stack._hvRange || (stack._hvRange = stretch(stack.hv[0], valid));
    for (let i = 0; i < N; i++) {
      const r = (H[i] - h0) / (h1 - h0), g = (V[i] - v0) / (v1 - v0);
      const b = Math.max(0, Math.min(1, 0.5 + (r - g) * 0.9));
      put(i, 255 * Math.max(0, Math.min(1, r)), 255 * Math.max(0, Math.min(1, g)), 255 * b);
    }
  } else if (mode === 'hh' || mode === 'hv') {
    const A = mode === 'hh' ? H : V;
    const [lo, hi] = mode === 'hh' ? (stack._hhRange || stretch(stack.hh[0], valid)) : (stack._hvRange || stretch(stack.hv[0], valid));
    for (let i = 0; i < N; i++) { const g = 255 * Math.max(0, Math.min(1, (A[i] - lo) / (hi - lo))); put(i, g, g, g); }
  } else if (mode === 'ratio') {
    const L = lut('viridis');
    for (let i = 0; i < N; i++) {
      const r = Math.log((V[i] + 4) / (H[i] + 4));
      const k = Math.round(255 * Math.max(0, Math.min(1, (r + 1.2) / 1.6)));
      put(i, L[k * 3], L[k * 3 + 1], L[k * 3 + 2]);
    }
  } else if (mode === 'change' && extra.change) {
    const { lr, thr } = extra.change;
    for (let i = 0; i < N; i++) {
      const g = 0.35 * (stack.hhF[t][i]);
      if (lr[i] > thr) put(i, 40, 190 + 40 * Math.min(1, lr[i]), 255);
      else if (lr[i] < -thr) put(i, 255, 70 + 60 * Math.max(0, 1 + lr[i]), 60);
      else put(i, g, g, g);
    }
  } else if (mode === 'confidence' && extra.conf) {
    const L = lut('viridis');
    for (let i = 0; i < N; i++) { const k = Math.round(255 * Math.max(0, Math.min(1, extra.conf[i]))); put(i, L[k * 3], L[k * 3 + 1], L[k * 3 + 2]); }
  } else if (mode === 'clusters' && extra.labels) {
    const cols = CLUSTER_COLORS.map((h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)));
    for (let i = 0; i < N; i++) { const c = cols[extra.labels[i] % cols.length]; put(i, c[0], c[1], c[2]); }
  } else if (mode === 'anomaly' && extra.anomaly) {
    const L = lut('inferno');
    const [lo, hi] = stretch(extra.anomaly, valid, 0.02, 0.995);
    for (let i = 0; i < N; i++) {
      const k = Math.round(255 * Math.max(0, Math.min(1, (extra.anomaly[i] - lo) / (hi - lo))));
      put(i, L[k * 3], L[k * 3 + 1], L[k * 3 + 2]);
    }
  } else if (mode === 'tstd') {
    const ts = stack._tstd || (stack._tstd = temporalStd(stack));
    const L = lut('inferno');
    const sum = new Float32Array(N);
    for (let i = 0; i < N; i++) sum[i] = ts.sH[i] + ts.sV[i];
    const [lo, hi] = stretch(sum, valid, 0.02, 0.99);
    for (let i = 0; i < N; i++) {
      const k = Math.round(255 * Math.max(0, Math.min(1, (sum[i] - lo) / (hi - lo))));
      put(i, L[k * 3], L[k * 3 + 1], L[k * 3 + 2]);
    }
  } else {
    return render(stack, t, 'rgb', extra);
  }
  return img;
}

export function drawTo(canvas, imageData) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  c.getContext('2d').putImageData(imageData, 0, 0);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(c, 0, 0, canvas.width, canvas.height);
}

// ---------------------------------------------------------------- regression
/** Robust linear trend with MAD-based anomaly flags for an irregular time series. */
export function robustTrend(times, values) {
  const n = times.length;
  if (n < 3) return null;
  const t0 = times[0], day = 86400000;
  const x = times.map((t) => (t - t0) / day);
  // Theil–Sen slope
  const slopes = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (x[j] !== x[i]) slopes.push((values[j] - values[i]) / (x[j] - x[i]));
  slopes.sort((a, b) => a - b);
  const slope = slopes[Math.floor(slopes.length / 2)];
  const icpts = x.map((xi, i) => values[i] - slope * xi).sort((a, b) => a - b);
  const icpt = icpts[Math.floor(n / 2)];
  const resid = x.map((xi, i) => values[i] - (icpt + slope * xi));
  const absr = resid.map(Math.abs).sort((a, b) => a - b);
  const mad = 1.4826 * absr[Math.floor(n / 2)] || 1e-6;
  return {
    slope, icpt, mad,
    fit: (t) => icpt + slope * ((t - t0) / day),
    z: resid.map((r) => r / mad),
  };
}

// ---------------------------------------------------------------- elevation
/** Decode a terrarium-encoded DEM PNG (height = R*256 + G + B/256 − 32768). */
export async function loadDem(url) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const d = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const h = new Float32Array(N);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, j = 0; i < N; i++, j += 4) { h[i] = d[j] * 256 + d[j + 1] + d[j + 2] / 256 - 32768; lo = Math.min(lo, h[i]); hi = Math.max(hi, h[i]); }
  return { h, lo, hi };
}

/** Hillshade blended with a hypsometric tint. pixelM = ground size of one pixel in metres. */
export function renderElevation(dem, pixelM) {
  const img = new ImageData(SIZE, SIZE), d = img.data, L = lut('terrain');
  const { h, lo, hi } = dem;
  const az = (315 * Math.PI) / 180, alt = (45 * Math.PI) / 180;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = y * SIZE + x;
    const xl = h[y * SIZE + Math.max(0, x - 1)], xr = h[y * SIZE + Math.min(SIZE - 1, x + 1)];
    const yu = h[Math.max(0, y - 1) * SIZE + x], yd = h[Math.min(SIZE - 1, y + 1) * SIZE + x];
    const dzdx = (xr - xl) / (2 * pixelM), dzdy = (yd - yu) / (2 * pixelM);
    const slope = Math.atan(Math.hypot(dzdx, dzdy)), aspect = Math.atan2(dzdy, -dzdx);
    const shade = Math.max(0, Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect));
    const k = Math.round(255 * Math.max(0, Math.min(1, (h[i] - lo) / Math.max(1, hi - lo)))) * 3;
    const s = 0.45 + 0.75 * shade;
    d[i * 4] = Math.min(255, L[k] * s); d[i * 4 + 1] = Math.min(255, L[k + 1] * s); d[i * 4 + 2] = Math.min(255, L[k + 2] * s); d[i * 4 + 3] = 255;
  }
  return img;
}
