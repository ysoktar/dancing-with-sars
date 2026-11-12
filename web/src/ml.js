// Machine-learning lab: unsupervised k-means scattering classes and a
// TensorFlow.js deep autoencoder that learns "normal" temporal radar behaviour
// so that unusual change shows up as reconstruction error.

import { SIZE, temporalStd } from './sar.js';

const N = SIZE * SIZE;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Per-pixel feature matrix (standardized). Returns {X: Float32Array N*F, F, names, valid}. */
export function pixelFeatures(stack, t) {
  const ts = stack._tstd || (stack._tstd = temporalStd(stack));
  const H = stack.hhF[t], V = stack.hvF[t];
  const cols = [
    ['HH (this date)', H],
    ['HV (this date)', V],
    ['HV−HH contrast', Float32Array.from(H, (h, i) => V[i] - h)],
    ['mean HH', ts.mH],
    ['mean HV', ts.mV],
    ['temporal variability', Float32Array.from(ts.sH, (s, i) => s + ts.sV[i])],
  ];
  const F = cols.length;
  const X = new Float32Array(N * F);
  const stats = cols.map(([, a]) => {
    let s = 0, s2 = 0, n = 0;
    for (let i = 0; i < N; i++) if (stack.valid[i]) { s += a[i]; s2 += a[i] * a[i]; n++; }
    const m = s / n; return [m, Math.sqrt(Math.max(1e-6, s2 / n - m * m))];
  });
  for (let i = 0; i < N; i++) for (let f = 0; f < F; f++) X[i * F + f] = (cols[f][1][i] - stats[f][0]) / stats[f][1];
  return { X, F, names: cols.map((c) => c[0]), raw: cols.map((c) => c[1]) };
}

/** k-means++ on a random subsample, then assign every pixel. */
export function kmeans(feat, valid, k = 5, iters = 25, sample = 9000, seed = 42) {
  const { X, F } = feat;
  const rnd = mulberry32(seed);
  const idx = [];
  for (let i = 0; i < N; i++) if (valid[i]) idx.push(i);
  const S = [];
  for (let s = 0; s < Math.min(sample, idx.length); s++) S.push(idx[Math.floor(rnd() * idx.length)]);
  const dist = (i, c, C) => { let d = 0; for (let f = 0; f < F; f++) { const u = X[i * F + f] - C[c * F + f]; d += u * u; } return d; };
  // k-means++ init
  const C = new Float32Array(k * F);
  const first = S[Math.floor(rnd() * S.length)];
  for (let f = 0; f < F; f++) C[f] = X[first * F + f];
  const D = new Float64Array(S.length).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let tot = 0;
    for (let s = 0; s < S.length; s++) { D[s] = Math.min(D[s], dist(S[s], c - 1, C)); tot += D[s]; }
    let r = rnd() * tot, pick = S[0];
    for (let s = 0; s < S.length; s++) { r -= D[s]; if (r <= 0) { pick = S[s]; break; } }
    for (let f = 0; f < F; f++) C[c * F + f] = X[pick * F + f];
  }
  const lab = new Int32Array(S.length);
  let inertia = 0;
  for (let it = 0; it < iters; it++) {
    inertia = 0;
    for (let s = 0; s < S.length; s++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = dist(S[s], c, C); if (d < bd) { bd = d; best = c; } }
      lab[s] = best; inertia += bd;
    }
    const sum = new Float64Array(k * F), cnt = new Float64Array(k);
    for (let s = 0; s < S.length; s++) { cnt[lab[s]]++; for (let f = 0; f < F; f++) sum[lab[s] * F + f] += X[S[s] * F + f]; }
    for (let c = 0; c < k; c++) if (cnt[c]) for (let f = 0; f < F; f++) C[c * F + f] = sum[c * F + f] / cnt[c];
  }
  const labels = new Uint8Array(N);
  const conf = new Float32Array(N); // 1 − d(nearest)/d(second nearest): 0 = on a boundary, 1 = at a centre
  const counts = new Array(k).fill(0);
  for (let i = 0; i < N; i++) {
    if (!valid[i]) { labels[i] = 255; continue; }
    let best = 0, bd = Infinity, sd = Infinity;
    for (let c = 0; c < k; c++) {
      const d = dist(i, c, C);
      if (d < bd) { sd = bd; bd = d; best = c; } else if (d < sd) sd = d;
    }
    labels[i] = best; counts[best]++;
    conf[i] = 1 - Math.sqrt(bd) / Math.sqrt(sd + 1e-9);
  }
  // order clusters by brightness so colours are stable between runs
  const bright = Array.from({ length: k }, (_, c) => C[c * F + 0] + C[c * F + 1]);
  const order = bright.map((b, c) => [b, c]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const remap = new Uint8Array(k); order.forEach((c, r) => (remap[c] = r));
  for (let i = 0; i < N; i++) if (labels[i] !== 255) labels[i] = remap[labels[i]];
  const centroids = order.map((c) => Array.from(C.slice(c * F, c * F + F)));
  const confSum = new Float64Array(k);
  for (let i = 0; i < N; i++) if (labels[i] !== 255) confSum[labels[i]] += conf[i];
  const cnt = order.map((c) => counts[c]);
  return { labels, conf, centroids, counts: cnt, meanConf: cnt.map((n, r) => (n ? confSum[r] / n : 0)), inertia: inertia / S.length, k };
}

/** Physically motivated description of a cluster centroid (standardized feature space). */
export function describeCluster(c, theme) {
  const [hh, hv, contrast, , , dyn] = c;
  const icy = theme === 'glacier';
  if (dyn > 0.9) return { name: 'Highly dynamic', why: 'Backscatter swings a lot between dates: flooding and drying, planting and harvest, melt and refreeze, or new disturbance.' };
  if (hh < -0.9 && hv < -0.9) return icy
    ? { name: 'Wet snow / smooth ice', why: 'Very low return. Liquid water in the snowpack absorbs L-band, or a smooth surface reflects it away.' }
    : { name: 'Open water / smooth surface', why: 'Specular reflection: the pulse bounces away from the sensor, so the return is very low in both channels.' };
  if (hv > 0.6 && contrast > 0.3) return icy
    ? { name: 'Deep firn volume', why: 'L-band penetrates dry snow and scatters many times inside it, which depolarizes the signal (high HV).' }
    : { name: 'Vegetation volume', why: 'Canopy branches and leaves scatter many times, which depolarizes the signal (high HV relative to HH). Typical of forests and leafy crops.' };
  if (hh > 0.8 && contrast < -0.3) return { name: 'Double-bounce / built-up', why: 'Strong HH from dihedral corners: walls and ground, or stems and water (flooded vegetation).' };
  if (hh > 0.6 && hv > 0.6) return icy
    ? { name: 'Rough ice / crevasses', why: 'Rough, broken ice scatters strongly in both channels.' }
    : { name: 'Bright rough surface', why: 'Rough terrain, dense structures or tall vegetation scatter strongly in both channels.' };
  if (hh < -0.3 && hv < -0.3) return { name: 'Low-return land', why: 'Dry, smooth soil, sparse vegetation or bare fields.' };
  return { name: 'Moderate mixed', why: 'Intermediate scattering: mixed land cover, moderate roughness and moisture.' };
}

// ---------------------------------------------------------------- deep autoencoder
let tfPromise = null;
export function loadTF() {
  if (!tfPromise) tfPromise = import('@tensorflow/tfjs');
  return tfPromise;
}

/** Build per-pixel temporal signature vectors [HH_1..HH_T, HV_1..HV_T] / 255. */
export function temporalSignatures(stack) {
  const T = stack.T, D = 2 * T;
  const X = new Float32Array(N * D);
  for (let t = 0; t < T; t++) {
    const a = stack.hhF[t], b = stack.hvF[t];
    for (let i = 0; i < N; i++) { X[i * D + t] = a[i] / 255; X[i * D + T + t] = b[i] / 255; }
  }
  return { X, D };
}

/**
 * Train a dense autoencoder D → 48 → 16 → 2 → 16 → 48 → D in the browser.
 * Calls onEpoch({epoch, loss, valLoss}) after every epoch.
 */
export async function trainAutoencoder(stack, { epochs = 40, samples = 8000, latent = 2, onEpoch, signal } = {}) {
  const tf = await loadTF();
  const want = new URLSearchParams(location.search).get('tf');
  if (want) await tf.setBackend(want);
  await tf.ready();
  const { X, D } = temporalSignatures(stack);
  const rnd = mulberry32(7);
  const idx = [];
  for (let i = 0; i < N; i++) if (stack.valid[i]) idx.push(i);
  const pick = Array.from({ length: Math.min(samples, idx.length) }, () => idx[Math.floor(rnd() * idx.length)]);
  const train = new Float32Array(pick.length * D);
  pick.forEach((p, r) => train.set(X.subarray(p * D, p * D + D), r * D));

  const input = tf.input({ shape: [D] });
  const e1 = tf.layers.dense({ units: 48, activation: 'relu' }).apply(input);
  const e2 = tf.layers.dense({ units: 16, activation: 'relu' }).apply(e1);
  const z = tf.layers.dense({ units: latent, activation: 'linear', name: 'latent' }).apply(e2);
  const d1 = tf.layers.dense({ units: 16, activation: 'relu' }).apply(z);
  const d2 = tf.layers.dense({ units: 48, activation: 'relu' }).apply(d1);
  const out = tf.layers.dense({ units: D, activation: 'sigmoid' }).apply(d2);
  const model = tf.model({ inputs: input, outputs: out });
  const encoder = tf.model({ inputs: input, outputs: z });
  model.compile({ optimizer: tf.train.adam(0.004), loss: 'meanSquaredError' });

  const xs = tf.tensor2d(train, [pick.length, D]);
  await model.fit(xs, xs, {
    epochs, batchSize: 256, shuffle: true, validationSplit: 0.15, verbose: 0,
    callbacks: {
      onEpochEnd: async (epoch, logs) => {
        onEpoch && onEpoch({ epoch: epoch + 1, loss: logs.loss, valLoss: logs.val_loss });
        if (signal && signal.aborted) model.stopTraining = true;
        await tf.nextFrame();
      },
    },
  });
  xs.dispose();

  // Inference over all pixels in chunks
  const err = new Float32Array(N);
  const lat = new Float32Array(N * latent);
  const recon = new Float32Array(N * D);
  const chunk = 8192;
  for (let s = 0; s < N; s += chunk) {
    const n = Math.min(chunk, N - s);
    const xb = tf.tensor2d(X.subarray(s * D, (s + n) * D), [n, D]);
    const [yb, zb] = tf.tidy(() => [model.predict(xb), encoder.predict(xb)]);
    const y = await yb.data(), zz = await zb.data();
    recon.set(y, s * D);
    lat.set(zz, s * latent);
    for (let i = 0; i < n; i++) {
      let e = 0;
      for (let d = 0; d < D; d++) { const u = y[i * D + d] - X[(s + i) * D + d]; e += u * u; }
      err[s + i] = stack.valid[s + i] ? Math.sqrt(e / D) : 0;
    }
    xb.dispose(); yb.dispose(); zb.dispose();
    await tf.nextFrame();
  }
  const params = model.countParams();
  model.dispose();
  return { err, latent: lat, latentDim: latent, recon, X, D, params, backend: tf.getBackend() };
}
