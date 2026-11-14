// Landslides: terrain, history and a rainfall-triggered hazard nowcast / 7-day outlook for a region, in the spirit of
// NASA's LHASA model (Kirschbaum & Stanley 2018): susceptible terrain x heavy recent rainfall compared with the local
// record. Everything is fetched live (Terrarium elevation tiles, NASA POWER daily rain, Open-Meteo forecast).
import { SIZE } from './sar.js';

const N = SIZE * SIZE;
const clip = (v, a, b) => Math.max(a, Math.min(b, v));

/** Elevation (m) on the region's SIZE x SIZE grid (box resampled to a square, like the radar stack) and slope (deg). */
export async function terrain(box) {
  const [w, s, e, n] = box;
  const latC = (s + n) / 2;
  const pxM = ((e - w) * 111320 * Math.cos((latC * Math.PI) / 180)) / SIZE;
  const z = clip(Math.round(Math.log2((156543 * Math.cos((latC * Math.PI) / 180)) / Math.max(pxM, 1))), 5, 13);
  const T = 2 ** z;
  const tx = (lon) => ((lon + 180) / 360) * T;
  const ty = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * T; };
  const x0 = Math.floor(tx(w)), x1 = Math.floor(tx(e)), y0 = Math.floor(ty(n)), y1 = Math.floor(ty(s));
  const tiles = new Map();
  const cv = new OffscreenCanvas(256, 256), cx = cv.getContext('2d', { willReadFrequently: true });
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const bmp = await createImageBitmap(await (await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`)).blob());
    cx.drawImage(bmp, 0, 0); bmp.close();
    const d = cx.getImageData(0, 0, 256, 256).data, h = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
    tiles.set(`${x}_${y}`, h);
  }
  const elev = new Float32Array(N);
  for (let py = 0; py < SIZE; py++) {
    const lat = n - ((py + 0.5) / SIZE) * (n - s), gy = ty(lat);
    for (let px = 0; px < SIZE; px++) {
      const lon = w + ((px + 0.5) / SIZE) * (e - w), gx = tx(lon);
      const t = tiles.get(`${Math.floor(gx)}_${Math.floor(gy)}`);
      elev[py * SIZE + px] = t ? t[clip(Math.floor((gy % 1) * 256), 0, 255) * 256 + clip(Math.floor((gx % 1) * 256), 0, 255)] : 0;
    }
  }
  const dxM = ((e - w) * 111320 * Math.cos((latC * Math.PI) / 180)) / SIZE, dyM = ((n - s) * 110574) / SIZE;
  const slope = new Float32Array(N);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const l = elev[y * SIZE + Math.max(0, x - 1)], r = elev[y * SIZE + Math.min(SIZE - 1, x + 1)];
    const u = elev[Math.max(0, y - 1) * SIZE + x], d = elev[Math.min(SIZE - 1, y + 1) * SIZE + x];
    slope[y * SIZE + x] = (Math.atan(Math.hypot((r - l) / (2 * dxM), (d - u) / (2 * dyM))) * 180) / Math.PI;
  }
  const sorted = Float32Array.from(slope).sort();
  const q = (p) => sorted[Math.floor(p * (N - 1))];
  let steep = 0;
  for (let i = 0; i < N; i++) if (slope[i] >= 15) steep++;
  return { elev, slope, zoom: z, p50: q(0.5), p90: q(0.9), max: q(0.995), steepFrac: steep / N, pxM: dxM };
}

/** Terrain susceptibility class from the slope distribution (slope is the strongest single factor in LHASA's map). */
export function susceptibility(t, nearbyEvents) {
  const s = t.p90;
  let k = s < 5 ? 0 : s < 12 ? 1 : s < 20 ? 2 : s < 30 ? 3 : 4;
  if (nearbyEvents >= 3 && k < 4 && k >= 1) k++;   // a landslide history nearby raises the class
  return { k, label: ['very low', 'low', 'moderate', 'high', 'very high'][k] };
}

let catalog = null;
/** NASA Global Landslide Catalog events within radiusKm of a point. */
export async function catalogNear(base, lat, lon, radiusKm = 50) {
  if (!catalog) catalog = fetch(`${base}data/landslides.json`).then((r) => r.json());
  const C = await catalog;
  const out = [];
  for (const e of C.events) {
    const dLat = (e[0] - lat) * 111.2, dLon = (e[1] - lon) * 111.2 * Math.cos((lat * Math.PI) / 180);
    const km = Math.hypot(dLat, dLon);
    if (km <= radiusKm) out.push({ lat: e[0], lon: e[1], date: e[2], category: e[3], trigger: e[4], size: e[5], fatalities: e[6], accuracy: e[7], title: e[8], km });
  }
  return { events: out.sort((a, b) => b.date.localeCompare(a.date)), source: C.source };
}

/**
 * Rainfall trigger: the antecedent rainfall index ARI = sum_k w_k P(t-k), w_k = 1/(k+1)^2 over 7 days (LHASA 1.0 used a
 * weighted 7-day IMERG index compared with its 95th percentile). Daily rain 2001..now from NASA POWER gives the local
 * percentiles; the Open-Meteo forecast extends the index 7 days ahead.
 */
export async function rainTrigger(lat, lon) {
  const end = new Date(Date.now() - 2 * 864e5), f = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const pw = await (await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&start=20010101&end=${f(end)}&format=JSON`)).json();
  const P = pw.properties.parameter.PRECTOTCORR;
  const days = Object.keys(P).sort(), rain = days.map((k) => (P[k] < 0 ? 0 : P[k]));
  const W = [1, 1 / 4, 1 / 9, 1 / 16, 1 / 25, 1 / 36, 1 / 49];
  const ari = (arr, i) => W.reduce((a, w, k) => a + w * (arr[i - k] ?? 0), 0);
  const hist = [];
  for (let i = 7; i < rain.length; i++) hist.push(ari(rain, i));
  const sorted = hist.slice().sort((a, b) => a - b);
  const pct = (v) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; } return lo / sorted.length; };
  const p90 = sorted[Math.floor(0.9 * sorted.length)], p95 = sorted[Math.floor(0.95 * sorted.length)], p99 = sorted[Math.floor(0.99 * sorted.length)];
  let fc = null;
  try {
    const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&daily=precipitation_sum&past_days=7&forecast_days=7&timezone=GMT`)).json();
    fc = { dates: j.daily.time, rain: j.daily.precipitation_sum.map((v) => v ?? 0) };
  } catch (e) { /* forecast optional */ }
  const iso = (k) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6)}`;
  // the last 60 days of observed index, then the forecast days
  const obs = [];
  for (let i = Math.max(7, rain.length - 60); i < rain.length; i++) obs.push({ date: iso(days[i]), rain: rain[i], ari: ari(rain, i), pct: pct(ari(rain, i)) });
  const out = [];
  if (fc) {
    const today = new Date().toISOString().slice(0, 10);
    fc.dates.forEach((d, i) => {
      if (i < 7) return;
      out.push({ date: d, rain: fc.rain[i], ari: ari(fc.rain, i), pct: pct(ari(fc.rain, i)), forecast: d >= today });
    });
  }
  return { obs, fc: out, p90, p95, p99, years: Math.round(rain.length / 365.25), source: 'NASA POWER daily precipitation (IMERG-based, 2001–now); forecast: Open-Meteo (ECMWF / GFS / ICON blend)' };
}

/** Hazard level of a day: susceptibility class x rainfall percentile (a LHASA-style decision table). */
export function hazard(suscK, ariPct) {
  if (suscK <= 0) return { k: 0, label: 'low' };
  const r = ariPct >= 0.99 ? 3 : ariPct >= 0.95 ? 2 : ariPct >= 0.9 ? 1 : 0;
  const k = r === 0 ? 0 : suscK >= 3 ? Math.min(3, r + 1) : suscK === 2 ? r : Math.max(0, r - 1);
  return { k, label: ['low', 'moderate', 'high', 'very high'][k] };
}
export const HAZARD_COLORS = ['#3a4a5a', '#e8b04a', '#f97316', '#ef4444'];
