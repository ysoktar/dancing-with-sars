import { T } from './ux.js';
// Soil moisture of a region, fetched live in the browser (both APIs are public and CORS-enabled):
//  - ERA5-Land (ECMWF / Copernicus, ~9 km) volumetric soil water in four layers, daily, via the Open-Meteo archive API
//  - NASA POWER (MERRA-2 based, ~0.5 x 0.625 deg) soil wetness: surface (GWETTOP), root zone (GWETROOT), profile (GWETPROF)
// The daily ERA5-Land values of 2019 onwards give a day-of-year normal, so the recent season can be shown as an anomaly.

export const ERA5_LAYERS = [
  ['soil_moisture_0_to_7cm_mean', '0–7 cm', '#3fb8ff'],
  ['soil_moisture_7_to_28cm_mean', '7–28 cm', '#2dd4bf'],
  ['soil_moisture_28_to_100cm_mean', '28–100 cm', '#a3e635'],
  ['soil_moisture_100_to_255cm_mean', '100–255 cm', '#e8b04a'],
];
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const cache = new Map();

/** ERA5-Land daily soil moisture (m³/m³) at a point from 2019-01-01 to ~6 days ago. */
export async function era5Soil(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (cache.has(key)) return cache.get(key);
  const end = iso(Date.now() - 6 * 864e5);
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
    + `&start_date=2019-01-01&end_date=${end}&daily=${ERA5_LAYERS.map((l) => l[0]).join(',')}&timezone=GMT`;
  const p = fetch(url).then((r) => { if (!r.ok) throw new Error(r.status === 429 ? T('the free Open-Meteo API is rate-limited right now; try again in a minute', 'ücretsiz Open-Meteo API\'si şu an istek sınırında; bir dakika sonra tekrar deneyin') : `Open-Meteo ${r.status}`); return r.json(); }).then((j) => {
    const d = j.daily, dates = d.time;
    const layers = ERA5_LAYERS.map(([k, label, color]) => {
      const v = d[k];
      // day-of-year normal (mean of all years, 15-day window) for the anomaly
      const sum = new Float64Array(367), n = new Float64Array(367);
      dates.forEach((s, i) => {
        if (v[i] == null) return;
        const doy = dayOfYear(s);
        for (let k2 = -7; k2 <= 7; k2++) { const q = ((doy + k2 + 365) % 366) + 1; sum[q] += v[i]; n[q]++; }
      });
      const normal = dates.map((s) => { const q = dayOfYear(s); return n[q] ? sum[q] / n[q] : null; });
      return { key: k, label, color, values: v, normal };
    });
    return { dates, layers, elevation: j.elevation, gridLat: j.latitude, gridLon: j.longitude,
      source: 'ERA5-Land reanalysis (ECMWF / Copernicus C3S, ~9 km) via the Open-Meteo archive API' };
  });
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

function dayOfYear(s) {
  const t = Date.parse(s + 'T00:00:00Z'), y0 = Date.UTC(new Date(t).getUTCFullYear(), 0, 1);
  return Math.floor((t - y0) / 864e5) + 1;
}

/** NASA POWER monthly soil wetness (0 = dry, 1 = saturated) at a point, 2016 to the last complete year. */
export async function powerWetness(lat, lon) {
  const y1 = new Date().getUTCFullYear() - 1;
  const url = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=GWETTOP,GWETROOT,GWETPROF&community=AG`
    + `&longitude=${lon.toFixed(3)}&latitude=${lat.toFixed(3)}&start=2016&end=${y1}&format=JSON`;
  const j = await (await fetch(url)).json();
  const P = j.properties.parameter;
  const months = Object.keys(P.GWETTOP).filter((k) => !k.endsWith('13')).sort();
  const get = (k) => months.map((m) => (P[k][m] < 0 ? null : P[k][m]));
  return { months: months.map((m) => `${m.slice(0, 4)}-${m.slice(4)}-15`), top: get('GWETTOP'), root: get('GWETROOT'), prof: get('GWETPROF'),
    source: 'NASA POWER (MERRA-2), monthly soil wetness' };
}

/** Mean of a layer over [t0, t1] and the same days' normal: {mean, normal, pct} (pct = mean / normal - 1). */
export function windowAnomaly(soil, layerIdx, t0, t1) {
  const L = soil.layers[layerIdx];
  let a = 0, b = 0, n = 0;
  soil.dates.forEach((d, i) => {
    const t = Date.parse(d + 'T12:00:00Z');
    if (t < t0 || t > t1 || L.values[i] == null || L.normal[i] == null) return;
    a += L.values[i]; b += L.normal[i]; n++;
  });
  return n ? { mean: a / n, normal: b / n, pct: a / b - 1, days: n } : null;
}
