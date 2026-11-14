// Web Worker: owns the radar image stacks and does all heavy pixel work
// (speckle filtering, render modes, change detection, k-means, pixel series)
// off the main thread, so switching filters and dates never freezes the page.
import { SIZE, leeFilter, render, logRatio, maskedMean, darkSeries } from './sar.js';
import { pixelFeatures, kmeans, temporalSignatures } from './ml.js';

const N = SIZE * SIZE;
const stacks = new Map();      // site id -> stack
const results = new Map();     // site id -> { change, km, anomaly }

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
    erode(valid, 3);
    const side = 2 * half_deg * 111.32;
    const st = { T: urls.length, hh, hv, valid, pixelKm2: (side * side) / N, aoiKm: side };
    st.hhF = hh.map((x) => leeFilter(x, 5));
    st.hvF = hv.map((x) => leeFilter(x, 5));
    stacks.set(id, st);
    results.set(id, {});
  }
  const st = stacks.get(id);
  return {
    T: st.T, aoiKm: st.aoiKm, pixelKm2: st.pixelKm2,
    hh: st.hhF.map((x) => maskedMean(x, st.valid)), hv: st.hvF.map((x) => maskedMean(x, st.valid)),
    dark: darkSeries(st).frac,
  };
}

const ops = {
  load,
  render({ id, t, mode, filtered, src }) {
    const st = stacks.get(id), r = results.get(id);
    const extra = { filtered };
    if (mode === 'change') extra.change = r.change;
    if (mode === 'clusters') extra.labels = r.km?.labels;
    if (mode === 'confidence') extra.conf = src === 'kmeans' ? r.km?.conf : r.change?.conf;
    if (mode === 'anomaly') extra.anomaly = r.anomaly;
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
  signatures({ id }) {
    const st = stacks.get(id);
    const { X, D } = temporalSignatures(st);
    const valid = st.valid.slice();
    return { X, D, T: st.T, valid, transfer: [X.buffer, valid.buffer] };
  },
  setAnomaly({ id, err }) {
    results.get(id).anomaly = err;
    return {};
  },
};

self.onmessage = async (e) => {
  const { rid, op, args } = e.data;
  try {
    const out = await ops[op](args);
    const transfer = out.transfer || [];
    delete out.transfer;
    self.postMessage({ rid, ok: true, out }, transfer);
  } catch (err) {
    self.postMessage({ rid, ok: false, error: String(err && err.stack || err) });
  }
};
