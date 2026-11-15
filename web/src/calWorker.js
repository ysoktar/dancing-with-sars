// Calibrated NISAR in the browser: reads NISAR L2 GCOV HDF5 products (gamma-naught, 20 m UTM grid) block by block
// through the NISAR proxy (worker/nisar-proxy.js holds the Earthdata token), and resamples HH and HV onto the region's
// SIZE x SIZE grid. Values are averaged in linear power, converted to dB and mapped to one fixed byte scale for every
// pass and every product (HH -25..0 dB, HV -32..-7 dB -> 0..255), so levels are comparable across dates and tracks,
// unlike the browse images, each of which is stretched on its own.
import h5wasm from 'h5wasm';
import { SIZE } from './sar.js';

export const CAL = { hh: [-25, 0], hv: [-32, -7] };
const GRID = '/science/LSAR/GCOV/grids/frequencyA';

// WGS84 geographic -> UTM (EPSG 326zz / 327zz), standard series (Snyder 1987)
function utm(lon, lat, zone, south) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180, lam = (lon * Math.PI) / 180, lam0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lam0);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let y = k0 * (M + N * Math.tan(phi) * (A * A / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (south) y += 10000000;
  return [x, y];
}

let mod = null;
async function lib() { if (!mod) mod = await h5wasm.ready; return mod; }

/** One product -> {hh, hv} power on the region grid (NaN outside), or null when it does not cover the box. */
async function readProduct(url, box, n) {
  const M = await lib();
  const name = `p${Math.random().toString(36).slice(2)}.h5`;
  M.FS.createLazyFile('/', name, url, true, false);
  const f = new h5wasm.File(`/${name}`, 'r');
  try {
    const g = f.get(GRID);
    const epsg = Number(f.get(`${GRID}/projection`).value);
    if (!((epsg > 32600 && epsg <= 32660) || (epsg > 32700 && epsg <= 32760))) return { skip: `projection EPSG:${epsg}` };
    const zone = epsg % 100, south = epsg > 32700;
    const xs = f.get(`${GRID}/xCoordinates`).value, ys = f.get(`${GRID}/yCoordinates`).value;
    const x0 = xs[0], dx = xs[1] - xs[0], y0 = ys[0], dy = ys[1] - ys[0];
    const [w, s, e, nn] = box;
    // corners of the box in the product grid -> pixel window
    const cs = [[w, s], [w, nn], [e, s], [e, nn]].map(([lo, la]) => utm(lo, la, zone, south));
    const cols = cs.map(([x]) => (x - x0) / dx), rows = cs.map(([, y]) => (y - y0) / dy);
    const c0 = Math.max(0, Math.floor(Math.min(...cols)) - 1), c1 = Math.min(xs.length, Math.ceil(Math.max(...cols)) + 2);
    const r0 = Math.max(0, Math.floor(Math.min(...rows)) - 1), r1 = Math.min(ys.length, Math.ceil(Math.max(...rows)) + 2);
    if (c1 - c0 < 4 || r1 - r0 < 4) return null;
    const W = c1 - c0;
    const HH = g.get('HHHH').slice([[r0, r1], [c0, c1]]), HV = g.get('HVHV').slice([[r0, r1], [c0, c1]]);
    // average the 20 m pixels that fall in each output cell (linear power)
    const out = { hh: new Float32Array(n * n).fill(NaN), hv: new Float32Array(n * n).fill(NaN), pxM: Math.abs(dx) };
    const cellLon = (e - w) / n, cellLat = (nn - s) / n;
    for (let oy = 0; oy < n; oy++) {
      const la0 = nn - oy * cellLat, la1 = la0 - cellLat;
      for (let ox = 0; ox < n; ox++) {
        const lo0 = w + ox * cellLon, lo1 = lo0 + cellLon;
        const [xa, ya] = utm(lo0, la0, zone, south), [xb, yb] = utm(lo1, la1, zone, south);
        const ca = Math.max(c0, Math.floor((Math.min(xa, xb) - x0) / dx)), cb = Math.min(c1 - 1, Math.ceil((Math.max(xa, xb) - x0) / dx));
        const ra = Math.max(r0, Math.floor((Math.max(ya, yb) - y0) / dy)), rb = Math.min(r1 - 1, Math.ceil((Math.min(ya, yb) - y0) / dy));
        let sh = 0, sv = 0, k = 0;
        for (let r = Math.min(ra, rb); r <= Math.max(ra, rb); r++) for (let c = ca; c <= cb; c++) {
          const i = (r - r0) * W + (c - c0), a = HH[i], b = HV[i];
          if (a > 0 && b > 0) { sh += a; sv += b; k++; }
        }
        if (k) { out.hh[oy * n + ox] = sh / k; out.hv[oy * n + ox] = sv / k; }
      }
    }
    return out;
  } finally {
    f.close();
    try { M.FS.unlink(`/${name}`); } catch (e2) { /* gone */ }
  }
}

const toByte = (p, [lo, hi]) => (Number.isNaN(p) ? NaN : Math.max(0, Math.min(255, ((10 * Math.log10(p) - lo) / (hi - lo)) * 255)));

self.onmessage = async (ev) => {
  const { rid, box, proxy, dates } = ev.data;
  const post = (m) => self.postMessage({ rid, ...m });
  try {
    const n = SIZE, hh = [], hv = [], used = [];
    let k = 0, pxM = 20;
    for (const d of dates) {
      k++;
      post({ progress: { stage: `Reading calibrated NISAR (γ⁰, 20 m), ${d.date}`, done: k - 1, total: dates.length } });
      const H = new Float32Array(n * n).fill(NaN), V = new Float32Array(n * n).fill(NaN);
      for (const url of d.urls) {
        let r = null;
        try { r = await readProduct(`${proxy.replace(/\/$/, '')}/h5?url=${encodeURIComponent(url)}`, box, n); } catch (e) { r = { skip: String(e.message || e) }; }
        if (!r || r.skip) continue;
        pxM = r.pxM;
        for (let i = 0; i < n * n; i++) if (Number.isNaN(H[i]) && !Number.isNaN(r.hh[i])) { H[i] = r.hh[i]; V[i] = r.hv[i]; }
      }
      let ok = 0;
      for (let i = 0; i < n * n; i++) if (!Number.isNaN(H[i])) ok++;
      if (ok < n * n * 0.5) continue;
      hh.push(Float32Array.from(H, (p) => toByte(p, CAL.hh)));
      hv.push(Float32Array.from(V, (p) => toByte(p, CAL.hv)));
      used.push({ ...d, valid: ok / (n * n) });
    }
    post({ progress: { stage: 'Calibrated passes read', done: dates.length, total: dates.length } });
    post({ done: true, hh: hh.map((a) => a.buffer), hv: hv.map((a) => a.buffer), used, pxM, cal: CAL }, );
  } catch (e) {
    post({ error: String(e.message || e) });
  }
};
