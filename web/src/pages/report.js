// "Parcel report": the four views of the team's parcel analyzer (Nasa.py), for any selected region.
//   1. parcel geometry and elevation range (vs. three landscape benchmarks)
//   2. radar vegetation index signatures of crop types and forest
//   3. monthly crop / forest calendar matrix
//   4. NASA POWER weather (temperature band, frost line, daily rain)
// Differences from the desktop script: the "your parcel" row is the REAL NISAR RVI of the window's
// cropland (not a curve modelled from climate); elevation is sampled over the whole window from
// Terrarium tiles (AWS Open Data) instead of 9 points; weather covers the last 12 months.
import Chart from 'chart.js/auto';
import { esc } from '../util.js';

export const SAR_REFERENCES = [
  ['Kristenson et al. (2026). NISAR Data User Guide. NASA/ISRO & ASF DAAC. doi:10.5281/ZENODO.20075813', 'https://nisar-docs.asf.alaska.edu/'],
  ['NASA Earthdata (2026). SAR Earth Observation Data Basics: Polarization & Scattering', 'https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar'],
  ['NASA JPL UAVSAR Education (2017). Polarimetric L-band SAR (HH, HV, HH+HV) landscape structure & flooded vegetation postcards', 'https://uavsar.jpl.nasa.gov/education/postcards.html'],
  ['NASA JPL NISAR Project. Societal Benefit White Papers: Food Security, Forest Resources & Soil Moisture', 'https://nisar.jpl.nasa.gov/applications/societal-benefit/'],
  ['Canadian Space Agency. RADARSAT Constellation Mission (RCM) ecosystem monitoring: agriculture, wetlands & forestry', 'https://donnees-data.asc-csa.gc.ca/en/dataset/rcm'],
  ['CONAE Argentina (2023). SAOCOM 1A/1B L-band dual-pol (HH-HV) archive & surface soil moisture mapping', 'https://www.argentina.gob.ar/noticias/la-informacion-saocom-cada-vez-mas-accesible'],
  ['Canadian Space Agency. Synthetic Aperture Radar Python & Matplotlib visualization workflow', 'https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial'],
];

const MONTH_DAYS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = Array.from({ length: 365 }, (_, i) => i + 1);
const clip = (v, a, b) => Math.max(a, Math.min(b, v));
const gauss = (d, c, w) => Math.exp(-(((((d - c + 182) % 365 + 365) % 365 - 182) / w) ** 2));

/** Elevation over the window from Terrarium tiles (AWS Open Data). */
async function elevationStats(box) {
  const [w, s, e, n] = box;
  const span = Math.max(e - w, n - s);
  const z = clip(Math.round(Math.log2(360 / span)) + 2, 6, 12);
  const tx = (lon) => ((lon + 180) / 360) * 2 ** z;
  const ty = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z; };
  const x0 = Math.floor(tx(w)), x1 = Math.floor(tx(e)), y0 = Math.floor(ty(n)), y1 = Math.floor(ty(s));
  const vals = [];
  const cv = new OffscreenCanvas(256, 256), cx = cv.getContext('2d', { willReadFrequently: true });
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const bmp = await createImageBitmap(await (await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`)).blob());
    cx.drawImage(bmp, 0, 0); bmp.close();
    const d = cx.getImageData(0, 0, 256, 256).data;
    for (let py = 0; py < 256; py += 2) for (let px = 0; px < 256; px += 2) {
      const gx = x + px / 256, gy = y + py / 256;
      if (gx < tx(w) || gx > tx(e) || gy < ty(n) || gy > ty(s)) continue;
      const j = (py * 256 + px) * 4;
      vals.push(d[j] * 256 + d[j + 1] + d[j + 2] / 256 - 32768);
    }
  }
  vals.sort((a, b) => a - b);
  const q = (p) => Math.round(vals[Math.floor(p * (vals.length - 1))]);
  return { min: q(0.01), mean: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), max: q(0.99), n: vals.length, zoom: z };
}

async function weather(lon, lat) {
  const end = new Date(Date.now() - 3 * 86400000), start = new Date(end.getTime() - 364 * 86400000);
  const f = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M_MIN,T2M_MAX,PRECTOTCORR&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&start=${f(start)}&end=${f(end)}&format=JSON`;
  const p = (await (await fetch(url)).json()).properties.parameter;
  const keys = Object.keys(p.T2M_MIN).sort();
  const c = (v, d) => (v == null || v < -100 ? d : v);
  return { dates: keys.map((k) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6)}`), tmin: keys.map((k) => c(p.T2M_MIN[k], null)), tmax: keys.map((k) => c(p.T2M_MAX[k], null)), rain: keys.map((k) => Math.max(0, c(p.PRECTOTCORR[k], 0))) };
}

/** Reference RVI profiles adapted to the local climate (ported from Nasa.py). */
function referenceCurves(wx, alt, lat) {
  // day-of-year climatology from the last 12 months
  const tavg = new Array(365).fill(null), cnt = new Array(365).fill(0);
  wx.dates.forEach((d, i) => {
    if (wx.tmin[i] == null || wx.tmax[i] == null) return;
    const t = new Date(d + 'T00:00:00Z'), doy = Math.min(364, Math.floor((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000));
    tavg[doy] = (tavg[doy] || 0) + (wx.tmin[i] + wx.tmax[i]) / 2; cnt[doy]++;
  });
  for (let i = 0; i < 365; i++) tavg[i] = cnt[i] ? tavg[i] / cnt[i] : null;
  for (let i = 0; i < 365; i++) if (tavg[i] == null) tavg[i] = tavg[(i + 364) % 365] ?? 15;
  const smooth = DAYS.map((_, i) => { let s = 0; for (let k = -7; k <= 7; k++) s += tavg[(i + k + 365) % 365]; return s / 15; });
  const warmest = smooth.indexOf(Math.max(...smooth));
  const spring = (warmest - 65 + 365) % 365;
  const winterF = tavg.map((t) => clip((t + 2) / 18, 0.12, 1));
  const altP = clip(1 - alt / 3500, 0.65, 1);
  const winter = DAYS.map((d) => clip(0.16 + 0.7 * altP * gauss(d, spring, 38), 0.14, 0.9));
  const summer = DAYS.map((d, i) => clip(0.15 * winterF[i] + 0.74 * altP * gauss(d, warmest, 42), 0.14, 0.92));
  const double = DAYS.map((d) => clip(0.16 + 0.55 * gauss(d, spring, 28) + 0.62 * gauss(d, (warmest + 35) % 365, 32), 0.15, 0.92));
  const floodC = (warmest - 45 + 365) % 365;
  const rice = DAYS.map((d) => (Math.abs((((d - floodC + 182) % 365) + 365) % 365 - 182) <= 12 ? 0.08 : clip(0.18 + 0.72 * gauss(d, (warmest + 15) % 365, 35), 0.08, 0.92)));
  const orchard = winterF.map((f) => clip(0.45 * altP + 0.22 * f, 0.35, 0.75));
  const forest = winterF.map((f) => clip(0.82 * altP + 0.05 * f, 0.76, 0.92));
  return { winter, summer, double, rice, orchard, forest, warmest, southern: lat < 0 };
}
const monthly = (curve) => MONTH_DAYS.map((d0, i) => { const d1 = (MONTH_DAYS[i + 1] || 366) - 1; let s = 0, n = 0; for (let d = d0; d <= d1; d++) { s += curve[d - 1]; n++; } return s / n; });

/** Real NISAR cropland RVI on a day-of-year axis, rescaled to the 0.08-0.92 range of the reference curves. */
function nisarSeries(times, rvi) {
  const lo = Math.min(...rvi), hi = Math.max(...rvi);
  const pts = times.map((t, i) => { const d = new Date(t); return { doy: Math.floor((t - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1, v: 0.08 + 0.84 * ((rvi[i] - lo) / Math.max(1e-6, hi - lo)), raw: rvi[i], date: d.toISOString().slice(0, 10) }; });
  const byMonth = MONTHS.map((_, m) => { const v = pts.filter((p) => new Date(p.date).getUTCMonth() === m).map((p) => p.v); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; });
  return { pts, byMonth };
}

function stage(row, j, isForest, isOrchard) {
  const v = row[j];
  if (v == null) return ['–', '#8a94a3'];
  if (isForest) return ['Forest', '#fff'];
  if (isOrchard) return ['Orchard', v > 0.6 ? '#fff' : '#1b5e20'];
  if (v <= 0.13) return ['Flooded', '#01579b'];
  if (v >= 0.72) return ['Peak', '#fff'];
  if (v <= 0.24) return ['Bare / sow', '#555'];
  const prev = row[(j + 11) % 12];
  if (v <= 0.45 && prev != null && prev >= 0.65) return ['Harvest', '#6d4c41'];
  return ['Growing', v > 0.52 ? '#1b5e20' : '#33691e'];
}
const ylgn = (v) => {   // YlGn colour map, 0.08..0.95
  const t = clip((v - 0.08) / 0.87, 0, 1), st = [[255, 255, 229], [217, 240, 163], [120, 198, 121], [35, 132, 67], [0, 69, 41]];
  const x = t * 4, k = Math.min(3, Math.floor(x)), f = x - k;
  return `rgb(${st[k].map((c, i) => Math.round(c + (st[k + 1][i] - c) * f)).join(',')})`;
};

/**
 * Render the report into `el`. ctx: { site, box, times, agri, landcover, charts (object to register Chart instances) }.
 */
export async function renderReport(el, ctx) {
  const { site, box, times, agri } = ctx;
  const [w, s, e, n] = box;
  const cos = Math.cos((site.lat * Math.PI) / 180);
  const wKm = (e - w) * 111.32 * cos, hKm = (n - s) * 111.32, area = wKm * hKm;
  el.innerHTML = '<div class="empty">Sampling elevation and fetching NASA POWER weather…</div>';
  const [elev, wx] = await Promise.all([elevationStats(box).catch(() => null), weather(site.lon, site.lat).catch(() => null)]);
  if (!el.isConnected) return;
  const frost = wx ? wx.tmin.filter((t) => t != null && t < 0).length : null;
  const rain = wx ? Math.round(wx.rain.reduce((a, b) => a + b, 0)) : null;
  const ref = wx ? referenceCurves(wx, elev?.mean ?? 200, site.lat) : null;
  const ns = nisarSeries(times, agri.rviCrop);
  // dominant pattern from the real NISAR classification
  const dom = agri.patterns.filter((p) => p.km2 > 0).sort((a, b) => b.km2 - a.km2)[0];
  // climate-based expectation (the desktop script's rule)
  let expect = 'Rainfed single summer crop';
  if (elev && wx) {
    const slope = elev.max - elev.min;
    if (rain > 1200 || (slope > 300 && rain > 700)) expect = 'Forest / dense woodland';
    else if (elev.mean < 40 && rain > 900) expect = 'Flooded paddy rice basin';
    else if (frost > 25 || (elev.mean > 600 && rain < 550)) expect = 'Continental winter grain (wheat / barley)';
    else if (rain < 450 && frost <= 25) expect = 'Irrigated double cropping';
  }
  el.innerHTML = `
    <div class="stack">
      <div class="panel">
        <h3>1 · Parcel geometry and elevation range</h3>
        <p class="small" style="color:var(--accent);margin:4px 0 10px">Centre (${site.lat.toFixed(4)}°, ${site.lon.toFixed(4)}°) · box lat [${s.toFixed(3)}° … ${n.toFixed(3)}°], lon [${w.toFixed(3)}° … ${e.toFixed(3)}°]<br>
          Area ${wKm.toFixed(1)} × ${hKm.toFixed(1)} km = ${area.toFixed(0)} km² (${Math.round(area * 100).toLocaleString()} ha)${frost != null ? ` · frost days ${frost} /yr · rain ${rain} mm /yr` : ''}</p>
        <div class="chart sm"><canvas id="rp1"></canvas></div>
        <p class="note">${elev ? `Elevation sampled at ${elev.n.toLocaleString()} points over the window (Terrarium tiles, zoom ${elev.zoom}; 1st–99th percentile): lowest ${elev.min} m, mean ${elev.mean} m, highest ${elev.max} m.` : 'Elevation could not be fetched.'} Benchmarks are typical landscapes for comparison.</p>
      </div>
      <div class="panel">
        <h3>2 · Radar vegetation index signatures: crops and forest</h3>
        <p class="small muted" style="margin:4px 0 10px">L-band pulses interact with plant structure (HV volume scattering) and soil moisture [1, 2, 6]. Reference curves are adapted to this window's climate (${frost ?? '–'} frost days, ${rain ?? '–'} mm rain, elevation ${elev?.mean ?? '–'} m). <b>Black dots: this window's cropland, measured by NISAR</b> (rescaled to the reference range). NISAR's dominant pattern here: <b>${esc(dom ? dom.name : '–')}</b> · climate-based expectation: ${esc(expect)}.</p>
        <div class="chart lg"><canvas id="rp2"></canvas></div>
      </div>
      <div class="panel">
        <h3>3 · Multi-temporal SAR ecosystem calendar: crops vs forest</h3>
        <p class="small muted" style="margin:4px 0 10px">Repeat-pass SAR follows phenology across agriculture, wetlands and forestry [1, 4, 5]. Row 1 is this window (NISAR, months without a pass shown as –); the rows below are the climate-adapted reference profiles.</p>
        <div style="overflow-x:auto"><table class="t cal" id="rp3"></table></div>
      </div>
      <div class="panel">
        <h3>4 · Satellite weather data (NASA POWER), last 12 months</h3>
        <p class="small muted" style="margin:4px 0 10px">NASA POWER agroclimatology API at (${site.lat.toFixed(4)}°, ${site.lon.toFixed(4)}°) · annual rain ${rain ?? '–'} mm · freezing nights (&lt; 0 °C) ${frost ?? '–'}. Below the red frost line crops stop growing; with spring rain and temperatures above ~10 °C the radar vegetation index climbs.</p>
        <div class="chart lg"><canvas id="rp4"></canvas></div>
      </div>
      <div class="panel"><h3>References</h3><ol class="small">${SAR_REFERENCES.map(([t, u]) => `<li>${esc(t)} · <a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\//, '')}</a></li>`).join('')}</ol></div>
    </div>`;
  const C = (id, cfg) => { ctx.charts[id]?.destroy(); ctx.charts[id] = new Chart(el.querySelector('#' + id), cfg); };
  // 1. elevation ranges (floating bars)
  const rows = [['Flat coastal delta (rice / flooded farming)', 0, 8, 25], ['Lowland alluvial plain (irrigated row crops)', 50, 180, 320], ['High continental plateau (winter grains / steppe)', 600, 900, 1250]];
  if (elev) rows.push([`★ This window (${Math.round(area * 100).toLocaleString()} ha)`, elev.min, elev.mean, elev.max]);
  C('rp1', { type: 'bar', data: { labels: rows.map((r) => r[0]), datasets: [
    { label: 'min–max elevation (m)', data: rows.map((r) => [r[1], Math.max(r[3], r[1] + 10)]), backgroundColor: rows.map((r) => (r[0].startsWith('★') ? '#ff8f00' : '#64b5f6')), borderRadius: 4, barThickness: 14 },
    { type: 'scatter', label: 'mean (m)', data: rows.map((r) => ({ x: r[2], y: r[0] })), backgroundColor: rows.map((r) => (r[0].startsWith('★') ? '#d32f2f' : '#1565c0')), pointRadius: 6 },
  ] }, options: { indexAxis: 'y', maintainAspectRatio: false, animation: false, scales: { x: { title: { display: true, text: 'elevation above sea level (m)' } } }, plugins: { legend: { labels: { boxWidth: 10 } } } } });
  // 2. signatures
  if (ref) {
    const line = (label, data, color, dash = [], width = 2) => ({ label, data: DAYS.map((d, i) => ({ x: d, y: data[i] })), borderColor: color, backgroundColor: color, borderDash: dash, borderWidth: width, pointRadius: 0, tension: 0.2 });
    C('rp2', { type: 'line', data: { datasets: [
      { type: 'scatter', label: `★ This window (NISAR cropland RVI, ${ns.pts.length} passes)`, data: ns.pts.map((p) => ({ x: p.doy, y: p.v })), backgroundColor: '#f5f5f5', borderColor: '#111', pointRadius: 5, pointBorderWidth: 1.5 },
      line('Winter grain (wheat / barley) [4, 5]', ref.winter, '#fb8c00', [6, 4]),
      line('Single summer crop (maize / sunflower) [2, 4]', ref.summer, '#43a047', [8, 3, 2, 3]),
      line('Irrigated double crop [4]', ref.double, '#00897b', [2, 3]),
      line('Paddy rice (flood, then growth) [3]', ref.rice, '#0288d1'),
      line('Permanent forest (high HV all year) [3, 4]', ref.forest, '#1b5e20', [], 2.5),
    ] }, options: { maintainAspectRatio: false, animation: false, parsing: false,
      scales: { x: { type: 'linear', min: 1, max: 365, ticks: { callback: (v) => { const k = MONTH_DAYS.indexOf(v); return k >= 0 ? MONTHS[k] : ''; }, autoSkip: false, stepSize: 1 }, afterBuildTicks: (ax) => { ax.ticks = MONTH_DAYS.map((v) => ({ value: v })); } },
        y: { min: 0, max: 1.05, title: { display: true, text: 'RVI = 4·HV/(HH+HV) [2, 3]' } } }, plugins: { legend: { labels: { boxWidth: 10, font: { size: 10 } } } } } });
    // 3. calendar
    const cm = [
      [`★ This window (NISAR)`, ns.byMonth],
      ['Winter grain (wheat / barley)', monthly(ref.winter)],
      ['Single summer crop (maize / soy)', monthly(ref.summer)],
      ['Irrigated double cropping', monthly(ref.double)],
      ['Flooded paddy rice', monthly(ref.rice)],
      ['Perennial orchard / vineyard', monthly(ref.orchard)],
      ['Permanent forest / woodland', monthly(ref.forest)],
    ];
    el.querySelector('#rp3').innerHTML = `<tr><th></th>${MONTHS.map((m) => `<th>${m}</th>`).join('')}</tr>` + cm.map(([label, row], r) => {
      const v = row.filter((x) => x != null), span = v.length ? Math.max(...v) - Math.min(...v) : 0;
      const isForest = r > 0 && Math.min(...v) >= 0.72 && span < 0.18, isOrchard = r > 0 && !isForest && Math.min(...v) >= 0.35 && span < 0.28;
      return `<tr${r === 0 ? ' class="me"' : ''}><th class="small">${esc(label)}</th>${row.map((x, j) => { const [txt, col] = stage(row, j, isForest, isOrchard); return `<td style="background:${x == null ? 'transparent' : ylgn(x)};color:${col}"><b>${txt}</b><br><span>${x == null ? '' : x.toFixed(2)}</span></td>`; }).join('')}</tr>`;
    }).join('');
  }
  // 4. weather
  if (wx) {
    const t = wx.dates.map((d) => Date.parse(d + 'T12:00:00Z'));
    C('rp4', { data: { datasets: [
      { type: 'line', label: 'daily max °C', data: t.map((x, i) => ({ x, y: wx.tmax[i] })), borderColor: 'rgba(255,204,128,0.9)', backgroundColor: 'rgba(255,204,128,0.35)', pointRadius: 0, borderWidth: 1, fill: '+1', yAxisID: 'y' },
      { type: 'line', label: 'daily min °C', data: t.map((x, i) => ({ x, y: wx.tmin[i] })), borderColor: 'rgba(255,204,128,0.9)', pointRadius: 0, borderWidth: 1, yAxisID: 'y' },
      { type: 'line', label: 'daily mean °C', data: t.map((x, i) => ({ x, y: wx.tmin[i] == null ? null : (wx.tmin[i] + wx.tmax[i]) / 2 })), borderColor: '#e65100', pointRadius: 0, borderWidth: 1.6, yAxisID: 'y' },
      { type: 'line', label: '0 °C frost line', data: [{ x: t[0], y: 0 }, { x: t[t.length - 1], y: 0 }], borderColor: '#d32f2f', borderDash: [3, 3], pointRadius: 0, borderWidth: 1.2, yAxisID: 'y' },
      { type: 'bar', label: 'daily rain (mm)', data: t.map((x, i) => ({ x, y: wx.rain[i] })), backgroundColor: 'rgba(2,136,209,0.75)', barThickness: 2, yAxisID: 'y1' },
    ] }, options: { maintainAspectRatio: false, animation: false, parsing: false,
      scales: { x: { type: 'linear', ticks: { callback: (v) => new Date(v).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), maxTicksLimit: 12 } },
        y: { title: { display: true, text: 'temperature (°C)' } }, y1: { position: 'right', beginAtZero: true, grid: { display: false }, title: { display: true, text: 'rain (mm/day)' } } },
      plugins: { legend: { labels: { boxWidth: 10, font: { size: 10 } } } } } });
  }
}
