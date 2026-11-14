// Drought of a region from public records, compared with the place's own history (percentiles), in the spirit of the
// US Drought Monitor: rainfall over 30 / 90 / 180 days (the logic of the Standardized Precipitation Index), root-zone
// soil moisture (ERA5-Land), and the heat of the last 30 days (NASA POWER).
import { era5Soil } from './soil.js';

const DAY = 864e5;
export const D_CLASSES = [
  { k: 4, label: 'D4 exceptional drought', max: 0.02, color: '#7f1d1d' },
  { k: 3, label: 'D3 extreme drought', max: 0.05, color: '#dc2626' },
  { k: 2, label: 'D2 severe drought', max: 0.1, color: '#f97316' },
  { k: 1, label: 'D1 moderate drought', max: 0.2, color: '#f6b73c' },
  { k: 0, label: 'D0 abnormally dry', max: 0.3, color: '#fde68a' },
];
export const dClass = (p) => D_CLASSES.find((c) => p <= c.max) || { k: -1, label: p >= 0.7 ? 'wetter than usual' : 'normal', color: p >= 0.7 ? '#38bdf8' : '#4b5563' };

// inverse normal CDF (Acklam), percentile -> standardised index (SPI-like)
export function probit(p) {
  p = Math.min(0.999, Math.max(0.001, p));
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155211918];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = p < 0.02425 ? Math.sqrt(-2 * Math.log(p)) : p > 0.97575 ? Math.sqrt(-2 * Math.log(1 - p)) : null;
  if (q != null) { const x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); return p < 0.5 ? x : -x; }
  const r = (p - 0.5) ** 2, s = p - 0.5;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * s / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Percentile of x within the values of the same calendar window in other years (ties count half). */
function pctOf(x, hist) { let lo = 0, eq = 0; for (const v of hist) { if (v < x) lo++; else if (v === x) eq++; } return hist.length ? (lo + eq / 2) / hist.length : 0.5; }

export async function droughtData(lat, lon) {
  const end = new Date(Date.now() - 2 * DAY), f = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const j = await (await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,T2M&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&start=20010101&end=${f(end)}&format=JSON`)).json();
  const P = j.properties.parameter, keys = Object.keys(P.PRECTOTCORR).sort();
  const rain = keys.map((k) => Math.max(0, P.PRECTOTCORR[k] ?? 0)), temp = keys.map((k) => (P.T2M[k] < -90 ? null : P.T2M[k]));
  const t = keys.map((k) => Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6)));
  const cum = [0]; rain.forEach((v, i) => cum.push(cum[i] + v));
  const sumTo = (i, n) => (i - n + 1 < 0 ? null : cum[i + 1] - cum[i - n + 1]);
  const doy = (ms) => Math.floor((ms - Date.UTC(new Date(ms).getUTCFullYear(), 0, 1)) / DAY);
  const byDoy = new Map();
  t.forEach((ms, i) => { const d = doy(ms); if (!byDoy.has(d)) byDoy.set(d, []); byDoy.get(d).push(i); });
  const sameWindow = (i) => { const d = doy(t[i]), out = []; for (let k = -5; k <= 5; k++) for (const j2 of byDoy.get((d + k + 366) % 366) || []) if (Math.abs(t[j2] - t[i]) > 200 * DAY) out.push(j2); return out; };
  const series = [];
  const n0 = Math.max(180, t.length - 365);
  for (let i = n0; i < t.length; i += 3) {
    const ref = sameWindow(i), o = { date: keys[i], t: t[i] };
    for (const n of [30, 90, 180]) { const x = sumTo(i, n); o[`r${n}`] = x; o[`p${n}`] = pctOf(x, ref.map((j2) => sumTo(j2, n)).filter((v) => v != null)); }
    series.push(o);
  }
  // heat: last 30 days vs the same days in other years
  const iL = t.length - 1, t30 = (i) => { let s = 0, n = 0; for (let k = i - 29; k <= i; k++) if (temp[k] != null) { s += temp[k]; n++; } return n ? s / n : null; };
  const refT = sameWindow(iL).map(t30).filter((v) => v != null), tNow = t30(iL);
  const heat = { now: tNow, normal: refT.reduce((a, b) => a + b, 0) / Math.max(refT.length, 1), pct: pctOf(tNow, refT) };
  // soil moisture: ERA5-Land root zone (28-100 cm), 30-day mean vs the same window of other years
  let soil = null;
  try {
    const S = await era5Soil(lat, lon), L = S.layers[2], ts = S.dates.map((d) => Date.parse(d + 'T00:00:00Z'));
    const m30 = (i) => { let s = 0, n = 0; for (let k = i - 29; k <= i; k++) if (L.values[k] != null) { s += L.values[k]; n++; } return n ? s / n : null; };
    const sd = new Map(); ts.forEach((ms, i) => { const d = doy(ms); if (!sd.has(d)) sd.set(d, []); sd.get(d).push(i); });
    const sref = (i) => { const d = doy(ts[i]), out = []; for (let k = -5; k <= 5; k++) for (const j2 of sd.get((d + k + 366) % 366) || []) if (Math.abs(ts[j2] - ts[i]) > 200 * DAY && j2 >= 29) out.push(m30(j2)); return out.filter((v) => v != null); };
    const pts = [];
    for (let i = Math.max(29, ts.length - 365); i < ts.length; i += 3) pts.push({ t: ts[i], v: m30(i), p: pctOf(m30(i), sref(i)) });
    soil = { pts, now: pts[pts.length - 1], years: Math.round(ts.length / 365) };
  } catch (e) { soil = { error: String(e.message || e) }; }
  return { series, heat, soil, years: Math.round(t.length / 365.25), source: 'NASA POWER daily rain and temperature (2001–now); ERA5-Land root-zone soil moisture via Open-Meteo (2019–now)' };
}
