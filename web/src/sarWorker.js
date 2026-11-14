// Web Worker: owns the radar image stacks and does all heavy pixel work
// (speckle filtering, render modes, change detection, k-means, pixel series)
// off the main thread, so switching filters and dates never freezes the page.
import { SIZE, leeFilter, render, logRatio, maskedMean, darkSeries, otsu } from './sar.js';
import { pixelFeatures, kmeans } from './ml.js';
import { buildRegion } from './regionFetch.js';
import { computeAgri, renderAgri, rviStack, computeLandCover, renderLandCover, WATER_MAX, computeYield, renderYield } from './agri.js';

const N = SIZE * SIZE;
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
  yield({ id }) {
    const r = results.get(id);
    return computeYield(stacks.get(id), r.agri).summary;
  },
  yieldRender({ id, mode, t, seg }) {
    const img = renderYield(stacks.get(id), results.get(id).agri, { mode, t, seg });
    return { data: img.data.buffer, w: img.width, h: img.height, transfer: [img.data.buffer] };
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
