// The site page: opens in front of the globe, one tab at a time.
import Chart from 'chart.js/auto';
import { app, sheetHead, setDate, drawTimeline } from '../main.js';
import { STORIES, themeOf } from '../sites.js';
import { $, $$, DAY, tOf, fmtDate, fmtShort, esc, pct } from '../util.js';
import { drawTo, SIZE, CLUSTER_COLORS, loadDem, renderElevation } from '../sar.js';
import { call, renderImage } from '../sarClient.js';
import { Terrain3D } from '../terrain3d.js';
import { describeCluster } from '../ml.js';
import { forecast, FORECASTABILITY, MIN_POINTS } from '../forecast.js';

const TABS = [
  ['overview', 'Overview'],
  ['images', 'Radar images'],
  ['motion', 'Ground motion'],
  ['analysis', 'Change & ML'],
  ['forecast', 'Forecast'],
  ['events', 'Events & news'],
];

const stacks = new Map();
const dems = new Map();
function getDem() {
  const id = S.site.id;
  if (!app.dem?.[id]) return Promise.resolve(null);
  if (!dems.has(id)) dems.set(id, loadDem(`${app.base}data/dem/${id}.png`).catch(() => null));
  return dems.get(id);
}
function drop3d() { if (S.t3d) { S.t3d.dispose(); S.t3d = null; } }
const S = { site: null, tab: null, t: 0, cmpT: 0, mode: 'rgb', filtered: true, swipe: false, pixel: null, charts: {}, ml: {}, tool: 'change' };

// ------------------------------------------------------------------ helpers
function destroyCharts() { Object.values(S.charts).forEach((c) => c?.destroy()); S.charts = {}; drop3d(); }
function chart(id, cfg) { S.charts[id]?.destroy(); S.charts[id] = new Chart($('#' + id), cfg); return S.charts[id]; }
const acqs = () => S.site.acquisitions;
const times = () => acqs().map((a) => tOf(a.date));
const timeAxis = () => ({ type: 'linear', ticks: { callback: (v) => fmtShort(v), maxTicksLimit: 6 }, grid: { color: 'rgba(138,148,163,0.08)' } });
const nowLine = {
  id: 'nowLine',
  afterDatasetsDraw(c) {
    if (!S.site || !c.options.plugins.nowLine?.on) return;
    const x = c.scales.x.getPixelForValue(times()[S.t]);
    const { top, bottom } = c.chartArea;
    c.ctx.save(); c.ctx.strokeStyle = '#e8b04a'; c.ctx.setLineDash([3, 3]);
    c.ctx.beginPath(); c.ctx.moveTo(x, top); c.ctx.lineTo(x, bottom); c.ctx.stroke(); c.ctx.restore();
  },
};
/** Radar stacks live in a Web Worker (sarWorker.js): every filter / date / tool change is computed off the main thread. */
function getStack() {
  const site = S.site, id = site.id;
  if (!stacks.has(id)) {
    const urls = site.acquisitions.map((a) => new URL(app.base + 'data/' + a.crop, location.href).href);
    stacks.set(id, call('load', { id, urls, half_deg: site.half_deg }).then((info) => ({ id, ...info })));
  }
  return stacks.get(id);
}
let viewToken = 0;
function nearestIndex(t) {
  let k = 0;
  times().forEach((x, i) => { if (x <= t + DAY / 2) k = i; });
  return k;
}
function siteEvents() {
  return (app.events.sites?.[S.site.id] || []).filter((e) => e.date);
}
function aoiBounds() {
  const { lat, lon, half_deg: h } = S.site;
  const hl = h / Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
  return { S: lat - h, N: lat + h, W: lon - hl, E: lon + hl };
}

const onTimeline = (date) => {
  if (!S.site) return;
  const k = nearestIndex(date.getTime());
  if (k !== S.t) { S.t = k; refreshDate(); }
};

// ------------------------------------------------------------------ open / close
export function openSitePage(sheet, site, tab) {
  const fresh = S.site !== site;
  if (fresh) {
    destroyCharts();
    Object.assign(S, { site, cmpT: 0, pixel: null, ml: {}, swipe: false, stack: null });
    S.t = nearestIndex(app.tl.start + app.tl.day * DAY);
    app.selected = site.id;
    drawTimeline();
    app.listeners.add(onTimeline);
    const th = themeOf(site);
    const a0 = site.acquisitions[0], a1 = site.acquisitions[site.acquisitions.length - 1];
    const mo = app.motion.sites?.[site.id] || {};
    const nMotion = (mo.GUNW?.length || 0) + (mo.GOFF?.length || 0);
    const nEv = siteEvents().length;
    sheet.innerHTML = sheetHead(
      `${esc(site.name)} <span class="muted" style="font-weight:400">· ${esc(site.country)}</span>`,
      `<span class="tag" style="--c:${th.color}"><i></i>${th.label}</span>&nbsp; NISAR track ${site.track.path} · frame ${site.track.frame} · ${site.track.dir.toLowerCase()} &nbsp;·&nbsp; ${site.acquisitions.length} passes, ${fmtDate(tOf(a0.date))} – ${fmtDate(tOf(a1.date))}`,
    ) + `<nav class="tabs">${TABS.map(([k, l]) => `<a href="#/site/${site.id}/${k}" data-tab="${k}">${l}${k === 'motion' && nMotion ? `<span class="count">${nMotion}</span>` : ''}${k === 'events' && nEv ? `<span class="count">${nEv}</span>` : ''}</a>`).join('')}</nav>
      <div class="sheet-body"><div class="page" id="tabBody"></div></div>`;
  }
  if (fresh || S.tab !== tab) {
    destroyCharts();
    S.tab = tab;
    $$('.tabs a', sheet).forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    const body = $('#tabBody', sheet);
    body.scrollTop = 0;
    ({ overview, images, motion, analysis, forecast: forecastTab, events }[tab] || overview)(body);
  }
}

export function closeSitePage() {
  if (!S.site) return;
  destroyCharts();
  app.listeners.delete(onTimeline);
  S.site = null; S.tab = null;
  app.selected = null;
  drawTimeline();
}

function refreshDate() {
  if (S.tab === 'images') { renderViewer(); updateMeta(); markDates(); Object.values(S.charts).forEach((c) => c.update('none')); }
}

// ================================================================== OVERVIEW
const CAPS = {
  flood: [['Open-water extent on each pass', 'Flooded vegetation (double bounce)'], ['Flood depth (with a terrain model)', 'Where the flood goes next (with rainfall and hydrology)'], ['Number of people affected', 'Rainfall amount']],
  wetland: [['Water vs. marsh boundary', 'Flooded vegetation', 'Seasonal flood pulse'], ['Land-loss rate (with historical maps)', 'Subsidence (with GUNW time series)'], ['Water quality or salinity']],
  deforestation: [['Loss of forest canopy (HV drop)', 'Clearing date to within 12 days'], ['Biomass and carbon loss (with field plots)', 'Who cleared it and why'], ['Tree species']],
  glacier: [['Melt onset and refreeze', 'Ice motion (GOFF offsets, GUNW fringes)', 'Calving front position'], ['Ice discharge and sea-level contribution (with ice thickness)'], ['Air temperature', 'Snow chemistry']],
  agriculture: [['Planting, growth and harvest timing', 'Irrigation and flooding of paddies'], ['Crop type (with training labels)', 'Yield (with weather and harvest records)'], ['Crop prices', 'Farm income']],
  groundwater: [['Irrigated vs. bare fields', 'Ground sinking along the line of sight (GUNW)'], ['Groundwater loss (with wells or GRACE)', 'Sinkhole risk (with geology)'], ['Water quality', 'Aquifer volume directly']],
  volcano: [['New lava flows (roughness change)', 'Inflation / deflation (GUNW)'], ['Magma volume change (with models)', 'Lava flow hazard maps (with terrain)'], ['Exact eruption time', 'Gas emissions (SO₂)']],
  wildfire: [['Burn scar extent (HV loss)', 'Regrowth over years', 'Snow onset'], ['Burn severity (with optical dNBR)', 'Carbon released'], ['Smoke and air quality']],
};

const STORYMAPS = 'https://nisar.jpl.nasa.gov/applications/arcgis-storymaps/';
const LEARN = {
  flood: [['NISAR StoryMap: floods', STORYMAPS]],
  wetland: [['NISAR StoryMap: floods and wetlands', STORYMAPS]],
  wildfire: [['NISAR StoryMap: wildfires', STORYMAPS]],
  groundwater: [['NISAR StoryMap: land subsidence', STORYMAPS]],
  agriculture: [['NISAR StoryMap: land subsidence', STORYMAPS], ['UAVSAR postcards: crops in L-band false colour', 'https://uavsar.jpl.nasa.gov/education/postcards.html']],
  volcano: [['NISAR StoryMap: land deformation', STORYMAPS]],
  glacier: [['NISAR StoryMap: glacier motion', STORYMAPS]],
  deforestation: [['UAVSAR postcards: forests in L-band false colour', 'https://uavsar.jpl.nasa.gov/education/postcards.html']],
};

function overview(el) {
  const st = STORIES[S.site.id] || {};
  const th = themeOf(S.site);
  const a = acqs();
  const first = a[0], last = a[a.length - 1];
  const caps = CAPS[st.theme] || CAPS.wetland;
  const d = (k) => last[k] - first[k];
  const sign = (v, f = (x) => x.toFixed(1)) => `${v > 0 ? '+' : ''}${f(v)}`;
  el.innerHTML = `
  <div class="grid g-2">
    <div class="stack">
      <div>
        <h3 style="font-size:20px;margin-bottom:8px">${esc(st.headline || '')}</h3>
        <p class="lead">${st.story || ''}</p>
      </div>
      <div class="panel">
        <h3>Why the radar signal changes: our hypotheses</h3>
        <ul class="plain">${(st.drivers || []).map((x) => `<li>${x}</li>`).join('')}</ul>
      </div>
      <div class="grid g-2">
        <div class="panel"><h3>Which polarization</h3><p class="muted" style="margin:0">${st.pol || ''}</p></div>
        <div class="panel"><h3>What to look for</h3><p class="muted" style="margin:0">${st.lookFor || ''}</p></div>
      </div>
    </div>
    <div class="stack">
      <div class="stats">
        <div class="stat"><b>${a.length}</b><span>NISAR passes</span></div>
        <div class="stat"><b>${Math.round((tOf(last.date) - tOf(first.date)) / DAY)}</b><span>days covered</span></div>
        <div class="stat"><b class="${d('hh') >= 0 ? 'up' : 'down'}">${sign(d('hh'))}</b><span>HH brightness change</span></div>
        <div class="stat"><b class="${d('hv') >= 0 ? 'up' : 'down'}">${sign(d('hv'))}</b><span>HV brightness change</span></div>
        <div class="stat"><b>${sign(d('dark') * 100)}<small style="font-size:12px"> pt</small></b><span>dark-surface share</span></div>
        ${app.dem?.[S.site.id] ? `<div class="stat"><b>${Math.round(app.dem[S.site.id].min)}–${Math.round(app.dem[S.site.id].max)}<small style="font-size:12px"> m</small></b><span>elevation range</span></div>` : ''}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>First vs. latest pass</h3><a href="#/site/${S.site.id}/images">Open radar images →</a></div>
        <div class="grid g-2" style="gap:8px">
          <figure style="margin:0"><img src="${app.base}data/${first.crop}" alt="" class="rgbthumb" data-i="0" style="width:100%;aspect-ratio:1;border-radius:6px;background:#07090b"><figcaption class="small muted mono">${first.date}</figcaption></figure>
          <figure style="margin:0"><img src="${app.base}data/${last.crop}" alt="" class="rgbthumb" data-i="${a.length - 1}" style="width:100%;aspect-ratio:1;border-radius:6px;background:#07090b"><figcaption class="small muted mono">${last.date}</figcaption></figure>
        </div>
        <p class="note">Magenta = strong HH (surfaces, double bounce), green = strong HV (vegetation or snow volume), dark = smooth surfaces such as calm water.</p>
      </div>
      <div class="panel">
        <h3>What radar can tell us here</h3>
        <div class="grid g-3" style="gap:12px">
          <div><div class="small" style="color:var(--ok);margin-bottom:4px">Measured directly</div><ul class="plain small">${caps[0].map((x) => `<li>${x}</li>`).join('')}</ul></div>
          <div><div class="small" style="color:var(--warn);margin-bottom:4px">With other data</div><ul class="plain small">${caps[1].map((x) => `<li>${x}</li>`).join('')}</ul></div>
          <div><div class="small" style="color:var(--no);margin-bottom:4px">Not from radar</div><ul class="plain small">${caps[2].map((x) => `<li>${x}</li>`).join('')}</ul></div>
        </div>
      </div>
      <div class="panel" style="border-left:3px solid ${th.color}"><h3>Next for NISAR</h3><p class="muted" style="margin:0">${st.future || ''}</p></div>
      <div class="panel"><h3>Learn more</h3><ul class="plain small">${(LEARN[st.theme] || []).map(([t, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${t}</a></li>`).join('')}
        <li><a href="https://nisar.jpl.nasa.gov/applications/societal-benefit/" target="_blank" rel="noopener">NISAR applications white papers</a></li>
        <li><a href="https://appliedsciences.nasa.gov/get-involved/training" target="_blank" rel="noopener">NASA ARSET trainings on SAR and NISAR</a></li></ul></div>
    </div>
  </div>`;
  // render the thumbnails as proper colour composites (the PNGs store HH/HV in R/G)
  getStack().then((stack) => {
    if (S.tab !== 'overview') return;
    $$('.rgbthumb', el).forEach((img) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = SIZE;
      cv.style.cssText = img.style.cssText;
      renderImage(stack.id, +img.dataset.i, 'rgb', { filtered: true }).then((im) => { drawTo(cv, im); img.replaceWith(cv); });
    });
  });
}

// ================================================================== IMAGES
const MODES = [['rgb', 'Colour'], ['hh', 'HH'], ['hv', 'HV'], ['ratio', 'HV/HH'], ['tstd', 'Variability'], ['optical', 'Optical'], ['elev', 'Elevation'], ['3d', '3-D']];

function viewerHTML(id = 'v') {
  return `<div class="viewer" id="${id}">
    <canvas class="a" width="768" height="768"></canvas>
    <canvas class="b" width="768" height="768"></canvas>
    <img class="opt" alt="" style="display:none">
    <div class="t3d" style="position:absolute;inset:0;display:none"></div>
    <div class="handle"></div>
    <span class="label l"></span><span class="label r"></span>
    <div class="xh"></div>
    <div class="scale"><i></i><span></span></div>
    <div class="busy on">Loading radar images…</div>
  </div>`;
}

function images(el) {
  el.innerHTML = `
  <div class="grid g-img">
    <div>
      <div class="controls">
        <div class="seg" id="modeSeg">${MODES.map(([k, l]) => `<button data-m="${k}" class="${S.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      ${viewerHTML()}
      <div class="dates" id="dates"></div>
      <div class="controls" style="margin-top:10px">
        <label><input type="checkbox" id="lee" ${S.filtered ? 'checked' : ''}> Reduce speckle (Lee filter)</label>
        <label><input type="checkbox" id="swipe" ${S.swipe ? 'checked' : ''}> Compare with</label>
        <select id="cmp">${acqs().map((a, i) => `<option value="${i}">${a.date}</option>`).join('')}</select>
      </div>
      <p class="note" id="modeNote"></p>
    </div>
    <div class="stack">
      <div class="panel">
        <div class="panel-head"><h3>Whole scene over time</h3><span class="small muted">click a point to jump to that pass</span></div>
        <div class="chart"><canvas id="cScene"></canvas></div>
        <p class="note">Mean brightness of HH and HV, and the share of dark, water-like surface (one Otsu threshold for the whole series).</p>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Single location</h3><span class="small muted" id="pxLabel">click the image to pick a spot</span></div>
        <div class="chart sm"><canvas id="cPixel"></canvas></div>
      </div>
      <div class="panel"><h3>This pass</h3><dl class="kv" id="meta"></dl></div>
    </div>
  </div>`;
  $('#cmp').value = S.cmpT;
  $$('#modeSeg button').forEach((b) => b.addEventListener('click', () => {
    S.mode = b.dataset.m;
    $$('#modeSeg button').forEach((x) => x.classList.toggle('on', x === b));
    renderViewer();
  }));
  $('#lee').addEventListener('change', (e) => { S.filtered = e.target.checked; renderViewer(); });
  $('#swipe').addEventListener('change', (e) => { S.swipe = e.target.checked; renderViewer(); markDates(); });
  $('#cmp').addEventListener('change', (e) => { S.cmpT = +e.target.value; if (!S.swipe) { S.swipe = true; $('#swipe').checked = true; } renderViewer(); markDates(); });
  bindViewer($('#v'), (x, y) => { S.pixel = [x, y]; renderViewer(); pixelChart(); });

  const evs = siteEvents();
  $('#dates').innerHTML = acqs().map((a, i) => {
    const near = evs.find((e) => Math.abs(tOf(e.date) - tOf(a.date)) <= 6 * DAY && (e.distKm ?? 0) < 200);
    return `<button data-i="${i}" class="${near ? 'ev' : ''}" title="${near ? esc(near.title) : a.granule}">${fmtShort(tOf(a.date))}</button>`;
  }).join('');
  $$('#dates button').forEach((b) => b.addEventListener('click', () => { S.t = +b.dataset.i; setDate(times()[S.t]); refreshDate(); }));
  const km = 2 * S.site.half_deg * 111.32;
  const bar = niceKm(km / 4);
  $('#v .scale i').style.width = (bar / km) * 100 + '%';
  $('#v .scale span').textContent = `${bar} km`;

  getStack().then((stack) => {
    if (S.tab !== 'images') return;
    S.stack = stack;
    $('#v .busy').classList.remove('on');
    renderViewer(); updateMeta(); markDates(); sceneChart(); pixelChart();
  });
}

function niceKm(v) { const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 5, 10].map((m) => m * p).reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)); }

function bindViewer(v, onPick) {
  let drag = false;
  const handle = $('.handle', v);
  handle.addEventListener('pointerdown', (e) => { drag = true; e.preventDefault(); e.stopPropagation(); });
  window.addEventListener('pointerup', () => (drag = false));
  v.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = v.getBoundingClientRect();
    v.style.setProperty('--x', Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)) + '%');
  });
  v.addEventListener('click', (e) => {
    if (e.target === handle || S.mode === '3d') return;
    const r = v.getBoundingClientRect();
    onPick(Math.floor(((e.clientX - r.left) / r.width) * SIZE), Math.floor(((e.clientY - r.top) / r.height) * SIZE));
  });
}

const MODE_NOTES = {
  rgb: 'Red = HH, green = HV, blue = how much HH exceeds HV. Magenta areas reflect strongly in HH: buildings, flooded vegetation, rough ground. Green areas scatter strongly in HV, typical of vegetation or dry snow. Dark areas are smooth: calm water, wet snow, smooth fields.',
  hh: 'HH (sent horizontal, received horizontal) is sensitive to surface roughness, soil moisture and corner reflections.',
  hv: 'HV (sent horizontal, received vertical) only appears when the wave is scattered many times, as inside a canopy or dry snowpack. It works as a proxy for vegetation volume.',
  ratio: 'HV ÷ HH, log scale. High values (yellow) mean volume scattering such as vegetation. Low values (purple) mean surface or double-bounce scattering.',
  tstd: 'How much each pixel changed across all passes. Bright = active surfaces (crops, water, ice). Dark = stable surfaces.',
  optical: 'Optical image from NASA MODIS Terra (250 m) on the same day, via NASA GIBS. Clouds block it, radar sees through them. Compare this pass with the radar view.',
  elev: 'Elevation from the Copernicus DEM (30 m), shaded from the north-west. Terrain matters for radar: slopes facing the satellite look brighter, and low flat ground is where floodwater collects.',
  '3d': 'The radar image of the selected pass draped over 30 m elevation. Drag to rotate, scroll to zoom. The vertical scale is exaggerated so flat sites still show relief.',
};

async function renderViewer() {
  const v = $('#v');
  if (!v || !S.stack) return;
  const st = S.stack;
  const tok = ++viewToken;
  const opt = $('.opt', v);
  $('#modeNote').textContent = MODE_NOTES[S.mode] || '';
  const flat = ['optical', 'elev', '3d'].includes(S.mode);
  v.classList.toggle('swipe', S.swipe && !flat);
  const t3 = $('.t3d', v);
  if (S.mode !== '3d') { drop3d(); t3.style.display = 'none'; }
  $('canvas.a', v).style.display = S.mode === '3d' ? 'none' : '';
  if (S.mode === 'elev' || S.mode === '3d') {
    opt.style.display = 'none';
    getDem().then(async (dem) => {
      if (!dem) { $('#modeNote').textContent = 'No elevation data for this site. Run pipeline/build_dem.py.'; return; }
      const meta = app.dem[S.site.id];
      if (S.mode === 'elev') {
        drawTo($('canvas.a', v), renderElevation(dem, (2 * S.site.half_deg * 111320) / SIZE));
        $('.label.l', v).textContent = `elevation ${Math.round(meta.min)}–${Math.round(meta.max)} m`;
      } else {
        t3.style.display = 'block';
        if (!S.t3d) S.t3d = new Terrain3D(t3, dem, 2 * S.site.half_deg * 111.32);
        const im = await renderImage(st.id, S.t, 'rgb', { filtered: S.filtered });
        if (tok !== viewToken || !S.t3d) return;
        S.t3d.setImage(im);
        $('.label.l', v).textContent = `${acqs()[S.t].date} · vertical ×${S.t3d.exaggeration}`;
      }
    });
  } else if (S.mode === 'optical') {
    const b = aoiBounds();
    const date = acqs()[S.t].date;
    opt.style.display = 'block';
    opt.onerror = () => { $('#modeNote').textContent = 'No MODIS image could be loaded for this date.'; };
    opt.src = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Terra_CorrectedReflectance_TrueColor&CRS=EPSG:4326&BBOX=${b.S},${b.W},${b.N},${b.E}&WIDTH=512&HEIGHT=512&FORMAT=image/jpeg&TIME=${date}`;
    $('.label.l', v).textContent = `${date} · MODIS optical`;
  } else {
    opt.style.display = 'none';
    const opts = { filtered: S.filtered };
    $('.label.l', v).textContent = acqs()[S.t].date;
    $('.label.r', v).textContent = acqs()[S.cmpT].date;
    const [ia, ib] = await Promise.all([renderImage(st.id, S.t, S.mode, opts), S.swipe ? renderImage(st.id, S.cmpT, S.mode, opts) : null]);
    if (tok !== viewToken || !$('#v')) return;      // a newer request has already been issued
    drawTo($('canvas.a', v), ia);
    if (ib) drawTo($('canvas.b', v), ib);
  }
  const xh = $('.xh', v);
  if (S.pixel) { xh.style.display = 'block'; xh.style.left = ((S.pixel[0] + 0.5) / SIZE) * 100 + '%'; xh.style.top = ((S.pixel[1] + 0.5) / SIZE) * 100 + '%'; } else xh.style.display = 'none';
}

function markDates() {
  $$('#dates button').forEach((b, i) => { b.classList.toggle('on', i === S.t); b.classList.toggle('cmp', S.swipe && i === S.cmpT); });
  const on = $('#dates button.on');
  if (on) { const box = $('#dates'); box.scrollLeft = on.offsetLeft - box.clientWidth / 2; }
}

function updateMeta() {
  const a = acqs()[S.t];
  const rows = [
    ['Acquired (UTC)', a.time.replace('T', ' ').replace('Z', '')],
    ['Product', `${a.collection?.replace('NISAR_', '').replace(/_/g, ' ') || 'L2 GCOV'}`],
    ['Polarizations', (a.pols || ['HH', 'HV']).join(', ')],
    ['Alignment shift', `${a.coregShiftKm?.[0] ?? 0} km N–S, ${a.coregShiftKm?.[1] ?? 0} km E–W`],
    ['Granule', `<span class="mono">${esc(a.granule)}</span>`],
    ['Files', `<a href="${a.browse}" target="_blank" rel="noopener">browse image</a> · <a href="${a.h5}" target="_blank" rel="noopener">full HDF5</a> <span class="muted">(Earthdata login)</span>`],
  ];
  $('#meta').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

function sceneChart() {
  const st = S.stack, ts = times();
  const hh = st.hh, hv = st.hv;
  const dark = acqs().map((a) => (a.dark ?? 0) * 100);
  chart('cScene', {
    type: 'line',
    data: { datasets: [
      { label: 'HH', data: ts.map((x, i) => ({ x, y: hh[i] })), borderColor: '#ff5bd6', backgroundColor: '#ff5bd6', pointRadius: 3, tension: 0.25, yAxisID: 'y' },
      { label: 'HV', data: ts.map((x, i) => ({ x, y: hv[i] })), borderColor: '#44e07a', backgroundColor: '#44e07a', pointRadius: 3, tension: 0.25, yAxisID: 'y' },
      { label: 'Dark surface %', data: ts.map((x, i) => ({ x, y: dark[i] })), borderColor: '#3fb8ff', backgroundColor: 'rgba(63,184,255,0.10)', fill: true, pointRadius: 2, tension: 0.25, yAxisID: 'y1' },
    ] },
    options: {
      maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'nearest', intersect: false },
      onClick: (_e, els) => { if (els.length) { S.t = els[0].index; setDate(ts[S.t]); refreshDate(); } },
      scales: { x: timeAxis(), y: { title: { display: true, text: 'brightness' } }, y1: { position: 'right', min: 0, grid: { display: false }, title: { display: true, text: 'dark %' } } },
      plugins: { nowLine: { on: true }, legend: { labels: { boxWidth: 10 } }, tooltip: { callbacks: { title: (it) => fmtDate(it[0].raw.x) } } },
    },
    plugins: [nowLine],
  });
}

async function pixelChart() {
  const st = S.stack, ts = times();
  let hh = [], hv = [];
  if (S.pixel) {
    const r = await call('pixel', { id: st.id, x: S.pixel[0], y: S.pixel[1] });
    if (S.tab !== 'images') return;
    hh = r.hh; hv = r.hv; $('#pxLabel').textContent = `pixel ${S.pixel[0]}, ${S.pixel[1]} (3×3 average)`;
  }
  chart('cPixel', {
    type: 'line',
    data: { datasets: [
      { label: 'HH', data: ts.map((x, i) => ({ x, y: hh[i] })), borderColor: '#ff5bd6', backgroundColor: '#ff5bd6', pointRadius: 2, tension: 0.25 },
      { label: 'HV', data: ts.map((x, i) => ({ x, y: hv[i] })), borderColor: '#44e07a', backgroundColor: '#44e07a', pointRadius: 2, tension: 0.25 },
    ] },
    options: { maintainAspectRatio: false, animation: false, parsing: false, scales: { x: timeAxis(), y: { suggestedMin: 0, suggestedMax: 255 } }, plugins: { nowLine: { on: true }, legend: { labels: { boxWidth: 10 } } } },
    plugins: [nowLine],
  });
}

// ================================================================== MOTION
function motion(el) {
  const mo = app.motion.sites?.[S.site.id] || {};
  const has = { GUNW: mo.GUNW?.length > 0, GOFF: mo.GOFF?.length > 0 };
  if (!has.GUNW && !has.GOFF) {
    el.innerHTML = `<div class="empty">NISAR has not yet published interferograms or offset maps covering this site.</div>`;
    return;
  }
  let prod = has.GUNW ? 'GUNW' : 'GOFF';
  let idx = (mo[prod] || []).length - 1;
  el.innerHTML = `
  <div class="grid g-img">
    <div>
      <div class="controls">
        <div class="seg" id="prodSeg">
          <button data-p="GUNW" ${has.GUNW ? '' : 'disabled'}>Interferogram (GUNW)</button>
          <button data-p="GOFF" ${has.GOFF ? '' : 'disabled'}>Pixel offsets (GOFF)</button>
        </div>
      </div>
      <div class="viewer" id="mv" style="cursor:default"><img alt="" id="mImg" style="object-fit:contain"><span class="label l" id="mLbl"></span><div class="scale"><i></i><span></span></div></div>
      <p class="note" id="mNote"></p>
    </div>
    <div class="stack">
      <div class="panel">
        <h3>Image pairs</h3>
        <div class="pairs" id="pairs"></div>
      </div>
      <div class="panel" id="mExplain"></div>
      <div class="panel"><h3>This pair</h3><dl class="kv" id="mMeta"></dl></div>
    </div>
  </div>`;
  const km = 2 * S.site.half_deg * 111.32, bar = niceKm(km / 4);
  $('#mv .scale i').style.width = (bar / km) * 100 + '%';
  $('#mv .scale span').textContent = `${bar} km`;
  const EXPLAIN = {
    GUNW: `<h3>Reading an interferogram</h3>
      <p class="muted">Two radar passes from the same orbit position, 12 or more days apart, are compared by the phase of their echoes. If the ground moved towards or away from the satellite, the phase shifts. Each repeating colour cycle (a <b>fringe</b>) marks a fixed step of motion. For L-band wrapped phase, one fringe is half the 24 cm wavelength, about <b>12 cm</b> along the radar's line of sight.</p>
      <ul class="plain small"><li><b>Smooth bands</b> mean coherent motion: a sinking basin, an inflating volcano, flowing ice.</li><li><b>Grainy noise</b> means the surface changed too much between passes (water, dense crops, melt). This is called decorrelation.</li><li>The motion is measured <b>along the line of sight only</b>. Separating vertical from horizontal motion needs ascending and descending passes together.</li></ul>`,
    GOFF: `<h3>Reading an offset map</h3>
      <p class="muted">GOFF tracks how image patches shifted between two passes, the way you would follow a pattern in two photos. It catches displacements too large for interferometry, such as fast glaciers. In this rendering colour shows displacement magnitude and arrows show its direction.</p>
      <ul class="plain small"><li>Over glaciers the brightest colours mark the fastest ice, usually near the calving front.</li><li>Divide the displacement by the days between passes to get a speed.</li><li>Over stable ground the map should be uniform; any pattern there is noise.</li></ul>`,
  };
  const draw = () => {
    const list = mo[prod] || [];
    $$('#prodSeg button').forEach((b) => b.classList.toggle('on', b.dataset.p === prod));
    $('#pairs').innerHTML = list.map((p, i) => `<button data-i="${i}" class="${i === idx ? 'on' : ''}">${fmtShort(tOf(p.ref))} → ${fmtShort(tOf(p.sec))}<span>${p.days} d</span></button>`).join('');
    $$('#pairs button').forEach((b) => b.addEventListener('click', () => { idx = +b.dataset.i; draw(); }));
    const p = list[idx];
    $('#mImg').src = app.base + 'data/' + p.img;
    $('#mLbl').textContent = `${p.ref} → ${p.sec}`;
    $('#mExplain').innerHTML = EXPLAIN[prod];
    $('#mNote').textContent = 'Browse rendering published by the NISAR project, cropped to the site window. It is a picture of the measurement, not the measurement values; use the HDF5 file for numbers.';
    $('#mMeta').innerHTML = [
      ['Reference', p.ref], ['Secondary', p.sec], ['Interval', `${p.days} days`],
      ['Track', `${p.path} · frame ${p.frame} · ${(p.dir || '').toLowerCase()}`],
      ['Granule', `<span class="mono">${esc(p.granule)}</span>`],
      ['Files', `<a href="${p.browse}" target="_blank" rel="noopener">browse image</a> · <a href="${p.h5}" target="_blank" rel="noopener">full HDF5</a>`],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  };
  $$('#prodSeg button').forEach((b) => b.addEventListener('click', () => { if (b.disabled) return; prod = b.dataset.p; idx = mo[prod].length - 1; draw(); }));
  draw();
}

// ================================================================== ANALYSIS
const TOOLS = [
  ['change', 'Change between two dates', 'Log-ratio + automatic threshold'],
  ['classes', 'Surface types', 'Unsupervised k-means clustering'],
];

function analysis(el) {
  el.innerHTML = `
  <div class="grid g-side">
    <div class="subnav" id="tools">${TOOLS.map(([k, t, d]) => `<button data-k="${k}" class="${S.tool === k ? 'on' : ''}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>
    <div id="tool"><div class="empty">Loading radar images…</div></div>
  </div>`;
  $$('#tools button').forEach((b) => b.addEventListener('click', () => {
    S.tool = b.dataset.k;
    $$('#tools button').forEach((x) => x.classList.toggle('on', x === b));
    showTool();
  }));
  getStack().then((stack) => { if (S.tab !== 'analysis') return; S.stack = stack; showTool(); });
}

function showTool() {
  destroyCharts();
  ({ change: toolChange, classes: toolClasses }[S.tool] || toolChange)($('#tool'));
}

function toolChange(el) {
  const opts = acqs().map((a, i) => `<option value="${i}">${a.date}</option>`).join('');
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:820px">The brightness ratio between two passes is taken on a log scale, which turns radar speckle into roughly even noise. Otsu's method then picks the threshold that best separates "changed" from "unchanged" pixels. Each changed pixel gets a confidence score: how far beyond the threshold it lies, relative to the noise of unchanged pixels.</p>
      <div class="controls">
        <label>From <select id="cFrom">${opts}</select></label>
        <label>To <select id="cTo">${opts}</select></label>
        <label>Channel <select id="cCh"><option value="span">HH + HV</option><option value="hh">HH</option><option value="hv">HV</option></select></label>
        <div class="seg" id="cShow"><button data-s="change" class="on">Change</button><button data-s="conf">Confidence</button></div>
      </div>
      <div class="result">
        <canvas class="map" id="cMap" width="512" height="512"></canvas>
        <div id="cLegend"></div>
      </div>
    </div>`;
  const prev = S.ml.change;
  $('#cFrom').value = prev?.a ?? 0;
  $('#cTo').value = prev?.b ?? acqs().length - 1;
  let show = 'change';
  const run = async () => {
    const a = +$('#cFrom').value, b = +$('#cTo').value, ch = $('#cCh').value;
    const tok = ++viewToken;
    const r = await call('change', { id: S.stack.id, a, b, ch });
    const im = await renderImage(S.stack.id, b, show === 'conf' ? 'confidence' : 'change', { src: 'change' });
    if (tok !== viewToken || !$('#cMap')) return;
    S.ml.change = { a, b, r };
    drawTo($('#cMap'), im);
    const days = Math.round((times()[b] - times()[a]) / DAY);
    $('#cLegend').innerHTML = `
      <div class="stats" style="margin-bottom:12px">
        <div class="stat"><b class="up">${pct(r.inc)}</b><span>brighter · ${r.incKm2.toFixed(0)} km²</span></div>
        <div class="stat"><b class="down">${pct(r.dec)}</b><span>darker · ${r.decKm2.toFixed(0)} km²</span></div>
        <div class="stat"><b>${pct(r.meanConf, 0)}</b><span>mean confidence of changed pixels</span></div>
      </div>
      <div class="legend" style="margin-bottom:10px">${show === 'conf'
        ? '<span><i style="background:#440154"></i>low</span><span><i style="background:#21918c"></i>medium</span><span><i style="background:#fde725"></i>high confidence</span>'
        : '<span><i style="background:#28d2ff"></i>brighter</span><span><i style="background:#ff5a3c"></i>darker</span><span><i style="background:#555"></i>no significant change</span>'}</div>
      <table class="t"><tr><th>Brighter usually means</th><th>Darker usually means</th></tr>
      <tr><td class="small">vegetation growth, flooding under a canopy (double bounce), refreezing snow, wetter soil, new structures</td>
      <td class="small">open water, clearing or burning, harvest, melting (wet) snow, smoother ground</td></tr></table>
      <p class="note">${acqs()[a].date} → ${acqs()[b].date} (${days} days). Threshold |log-ratio| = ${r.thr.toFixed(3)}, about a ${(Math.exp(r.thr) * 100 - 100).toFixed(0)}% brightness change.</p>`;
  };
  ['cFrom', 'cTo', 'cCh'].forEach((id) => $('#' + id).addEventListener('change', run));
  $$('#cShow button').forEach((b) => b.addEventListener('click', () => { show = b.dataset.s; $$('#cShow button').forEach((x) => x.classList.toggle('on', x === b)); run(); }));
  run();
}

function toolClasses(el) {
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:820px">Every pixel is described by six numbers: HH and HV on the selected date, their difference, their averages over all passes, and how much they vary. k-means groups similar pixels without any labels, and each group is then read physically. A pixel's confidence measures how much closer it is to its own group centre than to the next one.</p>
      <div class="controls">
        <label>Date <select id="kDate">${acqs().map((a, i) => `<option value="${i}">${a.date}</option>`).join('')}</select></label>
        <label>Groups <input type="range" id="kK" min="3" max="8" value="${S.ml.k || 5}"> <span class="mono" id="kKv">${S.ml.k || 5}</span></label>
        <div class="seg" id="kShow"><button data-s="cls" class="on">Groups</button><button data-s="conf">Confidence</button></div>
      </div>
      <div class="result">
        <canvas class="map" id="kMap" width="512" height="512"></canvas>
        <div class="classes" id="kLegend"></div>
      </div>
    </div>`;
  $('#kDate').value = S.t;
  let show = 'cls';
  const run = async () => {
    const k = +$('#kK').value, t = +$('#kDate').value;
    const tok = ++viewToken;
    const res = await call('kmeans', { id: S.stack.id, t, k });
    const im = await renderImage(S.stack.id, t, show === 'conf' ? 'confidence' : 'clusters', { src: 'kmeans' });
    if (tok !== viewToken || !$('#kMap')) return;
    S.ml.k = k; S.ml.km = res;
    drawTo($('#kMap'), im);
    const theme = (STORIES[S.site.id] || {}).theme;
    const names = res.centroids.map((c) => describeCluster(c, theme));
    const count = {};
    names.forEach((n) => (count[n.name] = (count[n.name] || 0) + 1));
    const seen = {};
    names.forEach((n) => { if (count[n.name] > 1) { seen[n.name] = (seen[n.name] || 0) + 1; n.name += ` (${seen[n.name] === 1 ? 'darker' : seen[n.name] === count[n.name] ? 'brighter' : 'mid'})`; } });
    const total = res.counts.reduce((a, b) => a + b, 0);
    $('#kLegend').innerHTML = names.map((n, i) => `<div class="row"><i style="background:${CLUSTER_COLORS[i]}"></i><div><b>${n.name}</b><span>${n.why}</span><div class="bar-conf" title="mean confidence"><i style="width:${(res.meanConf[i] * 100).toFixed(0)}%"></i></div></div><div class="v">${pct(res.counts[i] / total)}<br><span class="muted">conf ${pct(res.meanConf[i], 0)}</span></div></div>`).join('')
      + `<p class="note">Group names come from simple physical rules on the group averages. They are interpretations, not validated land-cover classes.</p>`;
  };
  $('#kK').addEventListener('input', (e) => ($('#kKv').textContent = e.target.value));
  $('#kK').addEventListener('change', run);
  $('#kDate').addEventListener('change', run);
  $$('#kShow button').forEach((b) => b.addEventListener('click', () => { show = b.dataset.s; $$('#kShow button').forEach((x) => x.classList.toggle('on', x === b)); run(); }));
  run();
}

// ================================================================== FORECAST
const VARS = [
  ['dark', 'Water-like dark surface', (a) => a.dark * 100, '%', 0, 100],
  ['hh', 'HH brightness', (a) => a.hh, '', 0, 255],
  ['hv', 'HV brightness', (a) => a.hv, '', 0, 255],
];

function forecastTab(el) {
  const theme = (STORIES[S.site.id] || {}).theme;
  const fc = FORECASTABILITY[theme] || FORECASTABILITY.wetland;
  const col = { none: 'var(--no)', limited: 'var(--warn)', moderate: 'var(--ok)' }[fc.level];
  const label = { none: 'Not forecastable from radar alone', limited: 'Limited: short-range trend only', moderate: 'Short-range forecast can work' }[fc.level];
  el.innerHTML = `
  <div class="grid g-img" style="grid-template-columns:minmax(0,1fr) 380px">
    <div class="stack">
      <div class="verdict" style="--c:${col}"><b>${label}</b>${fc.text}</div>
      <div class="panel">
        <div class="panel-head"><h3>Next three passes</h3><div class="seg" id="fVar">${VARS.map(([k, l], i) => `<button data-k="${k}" class="${i === 0 ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="chart lg"><canvas id="fChart"></canvas></div>
        <div class="legend" style="margin-top:8px"><span><i style="background:#8cc4ff"></i>observed</span><span><i style="background:#e8b04a"></i>expected</span><span><i style="background:rgba(232,176,74,0.35)"></i>80% range</span><span><i style="background:rgba(232,176,74,0.14)"></i>95% range</span></div>
      </div>
    </div>
    <div class="stack">
      <div class="panel" id="fTable"></div>
      <div class="panel" id="fSkill"></div>
      <div class="panel">
        <h3>Assumptions</h3>
        <ul class="plain small">
          <li>The recent level and trend carry on, fading gradually (damped trend). No new event such as a storm, harvest, eruption or melt onset interrupts them.</li>
          <li>Future pass-to-pass surprises look like past ones: one-step errors are resampled 600 times through the model, so the range widens with time.</li>
          <li>No seasonal term: with under a year of NISAR data a seasonal cycle cannot be estimated. Longer records (Sentinel-1 since 2014) would fix this.</li>
          <li>Values are browse-image brightness, so the forecast is relative, not calibrated backscatter.</li>
        </ul>
      </div>
    </div>
  </div>`;
  const draw = (key) => {
    const [, name, get, unit, lo, hi] = VARS.find((v) => v[0] === key);
    const ts = times(), ys = acqs().map(get);
    const f = forecast(ts, ys, { lo, hi });
    if (!f) {
      S.charts.fChart?.destroy();
      $('#fChart').parentElement.innerHTML = `<div class="empty">This site has ${ts.length} passes. A forecast needs at least ${MIN_POINTS}.</div>`;
      $('#fTable').innerHTML = ''; $('#fSkill').innerHTML = '';
      return;
    }
    const F = f.future, last = { x: ts[ts.length - 1], y: ys[ys.length - 1] };
    const band = (k1, k2) => [last, ...F.map((p) => ({ x: p.t, y: p[k1] }))].concat([...F].reverse().map((p) => ({ x: p.t, y: p[k2] })), [last]);
    chart('fChart', {
      type: 'line',
      data: { datasets: [
        { label: '95%', data: band('p975', 'p025'), fill: 'shape', backgroundColor: 'rgba(232,176,74,0.14)', borderWidth: 0, pointRadius: 0, tension: 0 },
        { label: '80%', data: band('p90', 'p10'), fill: 'shape', backgroundColor: 'rgba(232,176,74,0.32)', borderWidth: 0, pointRadius: 0, tension: 0 },
        { label: 'observed', data: ts.map((x, i) => ({ x, y: ys[i] })), borderColor: '#8cc4ff', backgroundColor: '#8cc4ff', pointRadius: 3, tension: 0.2 },
        { label: 'expected', data: [last, ...F.map((p) => ({ x: p.t, y: p.mid }))], borderColor: '#e8b04a', backgroundColor: '#e8b04a', pointRadius: 3, borderDash: [2, 2] },
      ] },
      options: { maintainAspectRatio: false, animation: false, parsing: false, scales: { x: timeAxis(), y: { title: { display: true, text: name + (unit ? ` (${unit})` : '') } } },
        plugins: { legend: { display: false }, tooltip: { filter: (it) => it.dataset.label === 'observed' || it.dataset.label === 'expected', callbacks: { title: (it) => fmtDate(it[0].raw.x) } } } },
    });
    const fmt = (v) => v.toFixed(1) + unit;
    $('#fTable').innerHTML = `<h3>Expected values</h3>
      <table class="t"><tr><th>Date</th><th style="text-align:right">Expected</th><th style="text-align:right">80% range</th></tr>
      ${F.map((p) => `<tr><td>${fmtDate(p.t)}</td><td class="num">${fmt(p.mid)}</td><td class="num">${fmt(p.p10)} – ${fmt(p.p90)}</td></tr>`).join('')}</table>
      <p class="note">Current trend: ${f.trendPerMonth >= 0 ? '+' : ''}${f.trendPerMonth.toFixed(2)}${unit} per month, damped towards flat (φ = ${f.model.phi}).</p>`;
    const b = f.backtest;
    const better = b.skill > 0.05;
    $('#fSkill').innerHTML = `<h3>How good is it? (backtest)</h3>
      <p class="small muted">Each of the last ${b.n} passes was predicted using only the passes before it, then compared with simply repeating the previous value.</p>
      <dl class="kv"><dt>Error, trend model</dt><dd class="mono">${b.maeTrend.toFixed(2)}${unit}</dd>
      <dt>Error, "same as last pass"</dt><dd class="mono">${b.maePersist.toFixed(2)}${unit}</dd>
      <dt>Skill</dt><dd class="mono" style="color:${better ? 'var(--ok)' : 'var(--no)'}">${(b.skill * 100).toFixed(0)}%</dd>
      <dt>Inside 80% range</dt><dd class="mono">${Math.round(b.coverage80 * b.n)} of ${b.n}</dd></dl>
      <p class="note">${better ? 'The trend beats the naive guess here.' : 'The trend does <b>not</b> beat the naive guess here. Treat the forecast as a scenario, not a prediction.'}</p>`;
  };
  $$('#fVar button').forEach((b) => b.addEventListener('click', () => { $$('#fVar button').forEach((x) => x.classList.toggle('on', x === b)); draw(b.dataset.k); }));
  draw('dark');
}

// ================================================================== EVENTS
function events(el) {
  const list = siteEvents();
  const src = app.events.sources || {};
  const kinds = [['all', 'All'], ['event', 'Natural events'], ['quake', 'Earthquakes'], ['news', 'News']];
  el.innerHTML = `
  <div class="page-narrow">
    <p class="lead">Things that happened in or near this site, from sources independent of NISAR. They help explain what the radar shows, but a match in place and time is <b>context, not proof</b>.</p>
    <div class="panel" style="margin-bottom:16px">
      <div class="panel-head"><h3>Timeline</h3><span class="legend"><span><i style="background:#8cc4ff"></i>NISAR pass</span><span><i style="background:#ff6a4d"></i>natural event</span><span><i style="background:#b48cff"></i>earthquake</span><span><i style="background:#e6e9ee"></i>news</span></span></div>
      <canvas id="evStrip" style="width:100%;height:86px;display:block"></canvas>
    </div>
    <div class="controls"><div class="seg filters" id="evF">${kinds.map(([k, l], i) => `<button data-k="${k}" class="${i ? '' : 'on'}">${l} <span class="muted">${k === 'all' ? list.length : list.filter((e) => e.kind === k).length}</span></button>`).join('')}</div></div>
    <div class="events" id="evList"></div>
    <p class="note">Sources: NASA EONET (natural events, linking to GDACS, InciWeb and others) ${src.eonet === 'ok' ? '' : '(unavailable at last build)'} · USGS earthquake catalogue, M ≥ 4 within 250 km ${src.usgs === 'ok' ? '' : '(unavailable at last build)'} · GDELT news search, filtered to headlines naming both the place and the process ${src.gdelt === 'ok' ? '' : '(not reachable at the last data build; filled by the weekly GitHub Actions run)'}.</p>
  </div>`;
  const ts = times();
  const nearestPass = (d) => { let best = null; ts.forEach((t, i) => { const dd = (t - tOf(d)) / DAY; if (best === null || Math.abs(dd) < Math.abs(best.dd)) best = { i, dd }; }); return best; };
  const render = (k) => {
    const rows = list.filter((e) => k === 'all' || e.kind === k);
    $('#evList').innerHTML = rows.length ? rows.map((e) => {
      const np = nearestPass(e.date);
      const kind = e.kind === 'quake' ? `Earthquake${e.mag ? ' M' + e.mag.toFixed(1) : ''}` : e.kind === 'news' ? `News · ${esc(e.source || '')}` : esc(e.category || 'Event');
      return `<div class="ev-row"><span class="d">${e.date}</span><span class="k">${kind}</span><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>
        <span class="near">${e.distKm != null ? e.distKm + ' km · ' : ''}${np ? `<a href="#/site/${S.site.id}/images" data-i="${np.i}" class="jump">pass ${np.dd === 0 ? 'same day' : (np.dd > 0 ? '+' : '') + Math.round(np.dd) + ' d'}</a>` : ''}</span></div>`;
    }).join('') : '<div class="empty">Nothing recorded for this filter.</div>';
    $$('#evList .jump').forEach((a) => a.addEventListener('click', () => { S.t = +a.dataset.i; setDate(ts[S.t]); }));
  };
  $$('#evF button').forEach((b) => b.addEventListener('click', () => { $$('#evF button').forEach((x) => x.classList.toggle('on', x === b)); render(b.dataset.k); }));
  render('all');
  // strip
  const cv = $('#evStrip'), w = cv.clientWidth, h = 86, dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  const all = [...ts, ...list.map((e) => tOf(e.date))];
  const t0 = Math.min(...all) - 5 * DAY, t1 = Math.max(...all) + 5 * DAY;
  const X = (t) => 8 + ((t - t0) / (t1 - t0)) * (w - 16);
  ctx.strokeStyle = '#333b47'; ctx.beginPath(); ctx.moveTo(8, 34); ctx.lineTo(w - 8, 34); ctx.stroke();
  ctx.fillStyle = '#8cc4ff';
  ts.forEach((t) => ctx.fillRect(X(t) - 1, 24, 2, 20));
  const lane = { event: 12, quake: 54, news: 64 };
  list.forEach((e) => {
    ctx.fillStyle = e.kind === 'quake' ? '#b48cff' : e.kind === 'news' ? '#e6e9ee' : eventColorLocal(e.category);
    ctx.beginPath(); ctx.arc(X(tOf(e.date)), lane[e.kind] || 12, 3.5, 0, 7); ctx.fill();
  });
  ctx.fillStyle = '#8a94a3'; ctx.font = '11px Inter';
  ctx.fillText(fmtShort(t0 + 5 * DAY), 8, 82); const lbl = fmtShort(t1 - 5 * DAY); ctx.fillText(lbl, w - 8 - ctx.measureText(lbl).width, 82);
}

function eventColorLocal(cat = '') {
  if (/flood/i.test(cat)) return '#3fb8ff';
  if (/fire/i.test(cat)) return '#ff6a4d';
  if (/volcan/i.test(cat)) return '#ff3d6e';
  return '#e8b04a';
}
