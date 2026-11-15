// The site page: opens in front of the globe, one tab at a time.
import Chart from 'chart.js/auto';
import { app, sheetHead, setDate, drawTimeline } from '../main.js';
import { T } from '../ux.js';
import { STORIES, themeOf } from '../sites.js';
import { $, $$, DAY, tOf, fmtDate, fmtShort, esc, pct } from '../util.js';
import { drawTo, SIZE, CLUSTER_COLORS, loadDem, renderElevation } from '../sar.js';
import { call, renderImage } from '../sarClient.js';
import { Terrain3D } from '../terrain3d.js';
import { describeCluster } from '../ml.js';
import { forecast, FORECASTABILITY, MIN_POINTS } from '../forecast.js';
import { liveContext } from '../liveContext.js';
import { renderReport } from './report.js';
import { fetchArchive, ARCHIVE_PLATFORMS } from '../archive.js';
import { cropMix } from '../cropPrior.js';
import { labelsNear } from '../cropHarvest.js';
import { suitability, suitClass, GAEZ_TO_SPAM, ENERGY } from '../suitability.js';
import { terrain, susceptibility, catalogNear, rainTrigger, hazard, HAZARD_COLORS } from '../landslide.js';
import { droughtData, dClass, probit } from '../drought.js';
import { era5Soil, powerWetness, windowAnomaly, ERA5_LAYERS } from '../soil.js';

const TABS = [
  ['overview', 'Overview'],
  ['images', 'Radar images'],
  ['motion', 'Ground motion'],
  ['analysis', 'Change & ML'],
  ['agri', 'Agriculture'],
  ['forecast', 'Forecast'],
  ['events', 'Events & news'],
];

const stacks = new Map();
export const hrefOf = (site) => (site.region ? `#/region/${site.box.map((v) => v.toFixed(4)).join('/')}` : `#/site/${site.id}`);
const REGION_TABS = [['overview', 'Summary'], ['agri', 'Crops'], ['report', 'Parcel report'], ['archive', 'Archive 1978→'], ['images', 'Radar images'], ['analysis', 'Change & ML'], ['forecast', 'Forecast']];
const dems = new Map();
function getDem() {
  const id = S.site.id;
  if (!app.dem?.[id]) return Promise.resolve(null);
  if (!dems.has(id)) dems.set(id, loadDem(`${app.base}data/dem/${id}.png`).catch(() => null));
  return dems.get(id);
}
function drop3d() { if (S.t3d) { S.t3d.dispose(); S.t3d = null; } }
const S = { site: null, tab: null, t: 0, cmpT: 0, mode: 'mtc', filtered: true, swipe: false, pixel: null, charts: {}, ml: {}, tool: 'change' };

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
  if (!stacks.has(id) && site.region) stacks.set(id, call('load', { id }).then((info) => ({ id, ...info })));
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
/** Width of the analysis window on the ground (km). */
export const windowKm = (site) => (site.box ? [(site.box[2] - site.box[0]) * 111.32 * Math.cos((site.lat * Math.PI) / 180), (site.box[3] - site.box[1]) * 111.32] : [2 * site.half_deg * 111.32, 2 * site.half_deg * 111.32]);
function aoiBounds() {
  if (S.site.box) { const [W, S0, E, N] = S.site.box; return { S: S0, N, W, E }; }
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
    Object.assign(S, { site, cmpT: 0, pixel: null, ml: {}, swipe: false, stack: null, agri: null, agTool: S.agToolNext || 'deep', agSeg: -1 });
    S.t = nearestIndex(app.tl.start + app.tl.day * DAY);
    app.selectedSite = site;
    drawTimeline();
    app.listeners.add(onTimeline);
    const th = site.region ? { color: '#e8b04a', label: 'Selected region' } : themeOf(site);
    const a0 = site.acquisitions[0], a1 = site.acquisitions[site.acquisitions.length - 1];
    const mo = app.motion.sites?.[site.id] || {};
    const nMotion = (mo.GUNW?.length || 0) + (mo.GOFF?.length || 0);
    const nEv = siteEvents().length;
    sheet.innerHTML = sheetHead(
      `${esc(site.name)}${site.country ? ` <span class="muted" style="font-weight:400">· ${esc(site.country)}</span>` : ''}`,
      `<span class="tag" style="--c:${th.color}"><i></i>${th.label}</span>&nbsp; NISAR track ${site.track.path} · frame ${site.track.frame} · ${site.track.dir.toLowerCase()} &nbsp;·&nbsp; ${site.acquisitions.length} passes, ${fmtDate(tOf(a0.date))} – ${fmtDate(tOf(a1.date))}`,
    ) + `<nav class="tabs">${(site.region ? REGION_TABS : TABS.filter(([k]) => k !== 'agri' || isAgSite(site))).map(([k, l]) => `<a href="${hrefOf(site)}/${k}" data-tab="${k}">${l}${k === 'motion' && nMotion ? `<span class="count">${nMotion}</span>` : ''}${k === 'events' && nEv ? `<span class="count">${nEv}</span>` : ''}</a>`).join('')}</nav>
      <div class="sheet-body"><div class="page" id="tabBody"></div></div>`;
  }
  if (fresh || S.tab !== tab) {
    destroyCharts();
    S.tab = tab;
    const [kw, kh] = windowKm(site);
    sheet.style.setProperty('--map-ar', (kw / kh).toFixed(3));
    $$('.tabs a', sheet).forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    const body = $('#tabBody', sheet);
    body.scrollTop = 0;
    ({ overview: site.region ? regionOverview : overview, images, motion, analysis, agri: agriTab, report: reportTab, archive: archiveTab, forecast: forecastTab, events }[tab] || overview)(body);
  }
}

/** Redraw the open tab (after a language switch); the radar stack and results stay in memory. */
export function rerenderSite() {
  if (!S.site) return;
  const body = $('#tabBody');
  if (!body) return;
  destroyCharts();
  ({ overview: S.site.region ? regionOverview : overview, images, motion, analysis, agri: agriTab, report: reportTab, archive: archiveTab, forecast: forecastTab, events }[S.tab] || overview)(body);
}

export function closeSitePage() {
  if (!S.site) return;
  destroyCharts();
  app.listeners.delete(onTimeline);
  S.site = null; S.tab = null;
  app.selectedSite = null;
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
        <div class="stat"><b>${a.length}</b><span>${T(`NISAR passes`, `NISAR geçişi`)}</span></div>
        <div class="stat"><b>${Math.round((tOf(last.date) - tOf(first.date)) / DAY)}</b><span>${T(`days covered`, `gün kapsandı`)}</span></div>
        <div class="stat"><b class="${d('hh') >= 0 ? 'up' : 'down'}">${sign(d('hh'))}</b><span>${T(`HH brightness change`, `HH parlaklık değişimi`)}</span></div>
        <div class="stat"><b class="${d('hv') >= 0 ? 'up' : 'down'}">${sign(d('hv'))}</b><span>${T(`HV brightness change`, `HV parlaklık değişimi`)}</span></div>
        <div class="stat"><b>${sign(d('dark') * 100)}<small style="font-size:12px"> pt</small></b><span>${T(`dark-surface share`, `koyu yüzey payı`)}</span></div>
        ${app.dem?.[S.site.id] ? `<div class="stat"><b>${Math.round(app.dem[S.site.id].min)}–${Math.round(app.dem[S.site.id].max)}<small style="font-size:12px"> m</small></b><span>${T(`elevation range`, `yükseklik aralığı`)}</span></div>` : ''}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>First vs. latest pass</h3><a href="${hrefOf(S.site)}/images">Open radar images →</a></div>
        <div class="grid g-2" style="gap:8px">
          <figure style="margin:0"><img src="${app.base}data/${first.crop}" alt="" class="rgbthumb" data-i="0" style="width:100%;aspect-ratio:1;border-radius:6px;background:#07090b"><figcaption class="small muted mono">${first.date}</figcaption></figure>
          <figure style="margin:0"><img src="${app.base}data/${last.crop}" alt="" class="rgbthumb" data-i="${a.length - 1}" style="width:100%;aspect-ratio:1;border-radius:6px;background:#07090b"><figcaption class="small muted mono">${last.date}</figcaption></figure>
        </div>
        <p class="note">${T(`Magenta = strong HH (surfaces, double bounce), green = strong HV (vegetation or snow volume), dark = smooth surfaces such as calm water.`, `Macenta = güçlü HH (yüzeyler, çift yansıma), yeşil = güçlü HV (bitki ya da kar hacmi), koyu = sakin su gibi düz yüzeyler.`)}</p>
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
const MODES = [['mtc', 'Multi-date'], ['rgb', 'Colour'], ['hh', 'HH'], ['hv', 'HV'], ['ratio', 'HV/HH'], ['rvi', 'RVI'], ['tstd', 'Variability'], ['optical', 'Optical'], ['elev', 'Elevation'], ['3d', '3-D']];

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
        <p class="note">${T(`Mean brightness of HH and HV, and the share of dark, water-like surface (one Otsu threshold for the whole series).`, `HH ve HV'nin ortalama parlaklığı ve koyu, su benzeri yüzeyin payı (tüm seri için tek bir Otsu eşiği).`)}</p>
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
  const km = windowKm(S.site)[0];
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
  mtc: 'Multi-date composite: red, green and blue are the HH brightness of three passes (an earlier one, one in between, and this one), with the raw NISAR values. Where nothing changed the colours add up to grey or white (towns, bare ground) or stay black (calm water). A colour means the field changed: blue = bright only on the latest pass (a crop that grew late), red = bright only early (harvested or flooded since), green = bright in between. Fields sown on different dates get different colours.',
  rgb: 'Red = HH, green = HV, blue = how much HH exceeds HV. Magenta areas reflect strongly in HH: buildings, flooded vegetation, rough ground. Green areas scatter strongly in HV, typical of vegetation or dry snow. Dark areas are smooth: calm water, wet snow, smooth fields.',
  hh: 'HH (sent horizontal, received horizontal) is sensitive to surface roughness, soil moisture and corner reflections.',
  hv: 'HV (sent horizontal, received vertical) only appears when the wave is scattered many times, as inside a canopy or dry snowpack. It works as a proxy for vegetation volume.',
  rvi: 'Radar Vegetation Index, RVI = 4·HV / (HH + HV): the radar counterpart of NDVI. High (yellow) where there is a lot of leafy, branching volume; low (purple) on bare soil, water and buildings. It works through cloud. Here it is computed from browse brightness, so it is relative.',
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
  const km = windowKm(S.site)[0], bar = niceKm(km / 4);
  $('#mv .scale i').style.width = (bar / km) * 100 + '%';
  $('#mv .scale span').textContent = `${bar} km`;
  const EXPLAIN = {
    GUNW: `<h3>Reading an interferogram</h3>
      <p class="muted">${T(`Two radar passes from the same orbit position, 12 or more days apart, are compared by the phase of their echoes. If the ground moved towards or away from the satellite, the phase shifts. Each repeating colour cycle (a <b>fringe</b>) marks a fixed step of motion. For L-band wrapped phase, one fringe is half the 24 cm wavelength, about <b>12 cm</b> along the radar's line of sight.`, `Aynı yörünge konumundan, en az 12 gün arayla yapılan iki radar geçişi, yankılarının fazıyla karşılaştırılır. Zemin uyduya yaklaştıysa ya da uzaklaştıysa faz kayar. Tekrarlanan her renk döngüsü (bir <b>saçak</b>) sabit bir hareket adımını gösterir. L-band sarılı fazda bir saçak, 24 cm dalga boyunun yarısı, yani radarın bakış doğrultusunda yaklaşık <b>12 cm</b>'dir.`)}</p>
      <ul class="plain small"><li><b>Smooth bands</b> mean coherent motion: a sinking basin, an inflating volcano, flowing ice.</li><li><b>Grainy noise</b> means the surface changed too much between passes (water, dense crops, melt). This is called decorrelation.</li><li>The motion is measured <b>along the line of sight only</b>. Separating vertical from horizontal motion needs ascending and descending passes together.</li></ul>`,
    GOFF: `<h3>Reading an offset map</h3>
      <p class="muted">${T(`GOFF tracks how image patches shifted between two passes, the way you would follow a pattern in two photos. It catches displacements too large for interferometry, such as fast glaciers. In this rendering colour shows displacement magnitude and arrows show its direction.`, `GOFF, görüntü parçalarının iki geçiş arasında ne kadar kaydığını izler; iki fotoğrafta bir deseni takip etmek gibi. Hızlı buzullar gibi interferometri için fazla büyük yer değiştirmeleri yakalar. Burada renk yer değiştirmenin büyüklüğünü, oklar yönünü gösterir.`)}</p>
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
  ['compare', 'Compare two areas', 'How alike two places behave'],
  ['change', 'Change between two dates', 'Log-ratio + automatic threshold'],
  ['floodhist', 'Flood history', 'NISAR water vs 20 years of floods'],
  ['landslide', 'Landslides', 'Detect slides + rain-triggered hazard'],
  ['spill', 'Mine spill / mudflow', 'Spread of tailings and farmland reached'],
  ['glacier', 'Glaciers & snow', 'When and where ice melts'],
];

function analysis(el) {
  el.innerHTML = `
  <div class="grid g-side">
    <div class="subnav" id="tools">${TOOLS.filter(([k]) => !(S.site.region && k === 'floodhist')).map(([k, t, d]) => `<button data-k="${k}" class="${S.tool === k ? 'on' : ''}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>
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
  ({ change: toolChange, classes: toolClasses, landcover: toolLandcover, floodhist: toolFloodHist, landslide: toolLandslide, spill: toolSpill, fingerprint: toolFingerprint, compare: toolCompare, glacier: toolGlacier }[S.tool] || toolChange)($('#tool'));
}

// ---------------------------------------------------------------- cropland vs forest
const LC_COLORS = ['#15803d', '#e8b04a', '#84cc16', '#2563eb', '#a8a29e'];
async function toolLandcover(el) {
  el.innerHTML = '<div class="empty">Separating cropland from forest…</div>';
  if (!S.stack) S.stack = await getStack();
  const tab = S.tab;
  const L = await call('landcover', { id: S.stack.id });
  if (S.tab !== tab || !el.isConnected) return;
  const crop = L.classes[1], forest = L.classes[0];
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:860px">${T(`Two physical axes separate fields from forest. <b>Forest</b> canopies depolarise L-band through volume scattering on every pass, so their HV stays high and steady. <b>Cropland</b> is sown, grows and is harvested, so its vegetation index swings strongly through the season. The thresholds are found for this scene (Otsu on mean HV, upper-quartile rule on the seasonal swing) and drawn as dashed lines in the plot.`, `Tarlayı ormandan iki fiziksel eksen ayırır. <b>Orman</b> örtüsü her geçişte L-band'i hacim saçılımıyla depolarize eder; HV yüksek ve sabit kalır. <b>Tarım alanı</b> ekilir, büyür ve hasat edilir; bitki indeksi sezon boyunca güçlü biçimde iner çıkar. Eşikler bu sahne için bulunur (ortalama HV üzerinde Otsu, mevsimsel salınım için üst çeyrek kuralı) ve grafikte kesikli çizgiyle gösterilir.`)}</p>
      <div class="stats" style="margin-bottom:12px">
        <div class="stat"><b style="color:${LC_COLORS[0]}">${forest.km2.toFixed(0)} km²</b><span>${T(`forest / tree cover · ${pct(forest.pct, 0)}`, `orman / ağaç örtüsü · ${pct(forest.pct, 0)}`)}</span></div>
        <div class="stat"><b style="color:${LC_COLORS[1]}">${crop.km2.toFixed(0)} km²</b><span>${T(`cropland · ${pct(crop.pct, 0)}`, `tarım alanı · ${pct(crop.pct, 0)}`)}</span></div>
        <div class="stat"><b>${L.edgeKm.toFixed(0)} km</b><span>${T(`forest–cropland edge`, `orman–tarım sınırı`)}</span></div>
      </div>
      <div class="controls"><div class="seg" id="lcSeg"><button data-s="classes" class="on">Classes</button><button data-s="confidence">Confidence</button><button data-s="edges">Forest–field edge</button></div></div>
      <div class="result">
        <canvas class="map" id="lcMap" width="512" height="512"></canvas>
        <div>
          <div class="chart"><canvas id="lcScatter"></canvas></div>
          <div class="classes" style="margin-top:10px">${L.classes.map((c, k) => `<div class="row"><i style="background:${LC_COLORS[k]}"></i><div><b>${c.name}</b><span>${c.why}</span><div class="bar-conf" title="mean confidence"><i style="width:${(c.meanConf * 100).toFixed(0)}%"></i></div></div><div class="v">${c.km2.toFixed(0)} km²<br><span class="muted">${pct(c.pct)}</span></div></div>`).join('')}</div>
        </div>
      </div>
      <p class="note">${T(`Rule-based and relative to this scene, from browse brightness: it separates <b>behaviour</b> (steady canopy vs seasonal crop), not species. Young plantations and sugar cane can look like forest in a short series; flooded forest, and very smooth dry pasture, can look like water. The edge length is a proxy for the clearing frontier, useful at deforestation sites such as Rondônia.`, `Kurala dayalı ve bu sahneye göreli, görüntü parlaklığından: tür değil <b>davranış</b> ayırır (sabit örtü ve mevsimlik ürün). Kısa bir seride genç plantasyonlar ve şeker kamışı orman gibi görünebilir; su basmış orman ve çok düz kuru mera su gibi görünebilir. Sınır uzunluğu, Rondônia gibi ormansızlaşma alanlarında açma cephesinin göstergesidir.`)}</p>
    </div>`;
  const draw = async (show) => {
    $$('#lcSeg button').forEach((b) => b.classList.toggle('on', b.dataset.s === show));
    const r = await call('landcoverRender', { id: S.stack.id, show, t: S.t });
    if ($('#lcMap')) drawTo($('#lcMap'), new ImageData(new Uint8ClampedArray(r.data), r.w, r.h));
  };
  $$('#lcSeg button').forEach((b) => b.addEventListener('click', () => draw(b.dataset.s)));
  draw('classes');
  const xs = L.sample.map((p) => p[0]), ys = L.sample.map((p) => p[1]);
  const xmax = Math.max(...xs) * 1.02, ymin = Math.min(...ys), ymax = Math.max(...ys);
  chart('lcScatter', {
    type: 'scatter',
    data: { datasets: [
      ...L.classes.map((c, k) => ({ label: c.name, data: L.sample.filter((p) => p[2] === k).map((p) => ({ x: p[0], y: p[1] })), backgroundColor: LC_COLORS[k] + 'aa', pointRadius: 1.6, borderWidth: 0 })),
      { type: 'line', label: 'HV threshold', data: [{ x: 0, y: L.hvThr }, { x: xmax, y: L.hvThr }], borderColor: '#fff', borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
      { type: 'line', label: 'swing threshold', data: [{ x: L.ampThr, y: ymin }, { x: L.ampThr, y: ymax }], borderColor: '#fff', borderDash: [4, 4], borderWidth: 1, pointRadius: 0 },
    ] },
    options: { maintainAspectRatio: false, animation: false, parsing: false,
      scales: { x: { min: 0, max: xmax, title: { display: true, text: 'seasonal swing of the vegetation index (RVI)' } }, y: { title: { display: true, text: 'mean HV brightness' } } },
      plugins: { legend: { labels: { boxWidth: 8, filter: (it) => !it.text.includes('threshold') } } } },
  });
}

// ---------------------------------------------------------------- flood history (Google, GLAD-derived)
let inundationIndex = null;
async function toolFloodHist(el) {
  el.innerHTML = '<div class="empty">Loading flood history…</div>';
  if (!inundationIndex) { try { inundationIndex = await (await fetch(`${app.base}data/inundation.json`)).json(); } catch (e) { inundationIndex = {}; } }
  const info = inundationIndex[S.site.id];
  if (!S.stack) S.stack = await getStack();
  if (!el.isConnected) return;
  if (!info) { el.innerHTML = '<div class="empty">This site lies outside the flood-history dataset (latitude −39° to 43°, longitude −125° to 170°).</div>'; return; }
  const im = new Image(); im.src = `${app.base}data/${info.img}`; await im.decode();
  const c = new OffscreenCanvas(SIZE, SIZE), cx = c.getContext('2d'); cx.drawImage(im, 0, 0, SIZE, SIZE);
  const px = cx.getImageData(0, 0, SIZE, SIZE).data, levels = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < levels.length; i++) levels[i] = Math.round(px[i * 4] / 85);
  const opts = acqs().map((a, i) => `<option value="${i}">${a.date}</option>`).join('');
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:860px">${T(`Coloured zones: how often each 128 m pixel was <b>wet between 1999 and 2020</b> (Google Flood Forecasting inundation history, derived from the GLAD Landsat surface-water record, permanent water removed). On top: the water <b>NISAR</b> sees on the selected pass (dark HH below the scene's Otsu threshold). Water inside the zones is the known flood regime; water outside them is unusual for the last two decades, or an irrigated paddy the optical record missed.`, `Renkli bölgeler: her 128 m pikselin <b>1999–2020 arasında</b> ne sıklıkla ıslak olduğu (Google Flood Forecasting su baskını geçmişi, GLAD Landsat yüzey suyu kaydından, kalıcı su çıkarılmış). Üstte: seçili geçişte <b>NISAR</b>'ın gördüğü su (sahnenin Otsu eşiğinin altında koyu HH). Bölgelerin içindeki su bilinen sel düzenidir; dışındaki su son yirmi yıl için olağan dışıdır ya da optik kaydın kaçırdığı sulu bir çeltiktir.`)}</p>
      <div class="controls"><label>Pass <select id="fhDate">${opts}</select></label></div>
      <div class="result">
        <div><canvas class="map" id="fhMap" width="512" height="512"></canvas>
          <div class="legend" style="margin-top:6px"><span><i style="background:#7846a0"></i>wet ≥0.5% of the time</span><span><i style="background:#c85aaa"></i>≥1%</span><span><i style="background:#ff783c"></i>≥5%</span><span><i style="background:#40c8ff"></i>NISAR water in a zone</span><span><i style="background:#fff"></i>NISAR water outside</span><span><i style="background:#14286e"></i>permanent water (every pass, outside the zones)</span></div></div>
        <div id="fhStats"></div>
      </div>
      <p class="note">${T(`${esc(info.source)} · <a href="${info.url}" target="_blank">dataset</a> · <a href="https://sites.research.google/gr/floodforecasting/" target="_blank">Google Flood Forecasting</a>. Rice paddies flooded every season count as wet in both records.`, `${esc(info.source)} · <a href="${info.url}" target="_blank">veri seti</a> · <a href="https://sites.research.google/gr/floodforecasting/" target="_blank">Google Flood Forecasting</a>. Her sezon su basan çeltik tarlaları iki kayıtta da ıslak sayılır.`)}</p>
    </div>`;
  $('#fhDate').value = S.t;
  const run = async () => {
    const t = +$('#fhDate').value, tok = ++viewToken;
    const r = await call('floodHistory', { id: S.stack.id, levels: levels.slice().buffer, t });
    if (tok !== viewToken || !$('#fhMap')) return;
    drawTo($('#fhMap'), new ImageData(new Uint8ClampedArray(r.data), r.w, r.h));
    const s = r.stats;
    $('#fhStats').innerHTML = `
      <div class="stats" style="grid-template-columns:1fr 1fr">
        <div class="stat"><b>${info.km2.low.toFixed(0)} km²</b><span>${T(`flood-prone 1999–2020 (≥0.5%) · ${info.pct.low.toFixed(1)}% of the scene`, `sel riskli 1999–2020 (≥%0,5) · sahnenin %${info.pct.low.toFixed(1)}'i`)}</span></div>
        <div class="stat"><b>${info.km2.high.toFixed(0)} km²</b><span>${T(`frequently wet (≥5%)`, `sık ıslak (≥%5)`)}</span></div>
        <div class="stat"><b>${s.wetNowKm2.toFixed(0)} km²</b><span>${T(`NISAR water on ${acqs()[t].date}`, `${acqs()[t].date} tarihinde NISAR suyu`)}</span></div>
        <div class="stat"><b>${pct(s.wetNowInZone, 0)}</b><span>${T(`of it inside the historical zones`, `tarihsel bölgelerin içinde`)}</span></div>
        <div class="stat"><b>${s.everKm2.toFixed(0)} km²</b><span>${T(`wet on at least one NISAR pass`, `en az bir NISAR geçişinde ıslak`)}</span></div>
        <div class="stat"><b>${pct(s.zoneSeenWet, 0)}</b><span>${T(`of the flood-prone zone seen wet by NISAR`, `sel riskli bölgenin NISAR'ın ıslak gördüğü payı`)}</span></div>
      </div>
      <p class="note">${T(`High agreement means NISAR reproduces the known flood regime. NISAR water far outside the zones is worth a closer look: new flooding, a reservoir change, or paddies. The comparison uses the ${acqs().length} passes available here.`, `Yüksek uyum, NISAR'ın bilinen sel düzenini yeniden ürettiği anlamına gelir. Bölgelerin çok dışındaki NISAR suyu yakından bakmaya değer: yeni bir sel, baraj gölü değişimi ya da çeltik. Karşılaştırma burada mevcut ${acqs().length} geçişi kullanır.`)}</p>`;
  };
  $('#fhDate').addEventListener('change', run);
  run();
}


function toolChange(el) {
  const opts = acqs().map((a, i) => `<option value="${i}">${a.date}</option>`).join('');
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:820px">${T(`The brightness ratio between two passes is taken on a log scale, which turns radar speckle into roughly even noise. Otsu's method then picks the threshold that best separates "changed" from "unchanged" pixels. Each changed pixel gets a confidence score: how far beyond the threshold it lies, relative to the noise of unchanged pixels.`, `İki geçiş arasındaki parlaklık oranı logaritmik ölçekte alınır; bu, radar karlanmasını yaklaşık eşit gürültüye çevirir. Otsu yöntemi "değişen" ve "değişmeyen" pikselleri en iyi ayıran eşiği seçer. Her değişen piksel bir güven puanı alır: eşiğin ne kadar ötesinde olduğu, değişmeyen piksellerin gürültüsüne göre.`)}</p>
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
        <div class="stat"><b class="up">${pct(r.inc)}</b><span>${T(`brighter · ${r.incKm2.toFixed(0)} km²`, `parlaklaşan · ${r.incKm2.toFixed(0)} km²`)}</span></div>
        <div class="stat"><b class="down">${pct(r.dec)}</b><span>${T(`darker · ${r.decKm2.toFixed(0)} km²`, `koyulaşan · ${r.decKm2.toFixed(0)} km²`)}</span></div>
        <div class="stat"><b>${pct(r.meanConf, 0)}</b><span>${T(`mean confidence of changed pixels`, `değişen piksellerin ortalama güveni`)}</span></div>
      </div>
      <div class="legend" style="margin-bottom:10px">${show === 'conf'
        ? '<span><i style="background:#440154"></i>low</span><span><i style="background:#21918c"></i>medium</span><span><i style="background:#fde725"></i>high confidence</span>'
        : '<span><i style="background:#28d2ff"></i>brighter</span><span><i style="background:#ff5a3c"></i>darker</span><span><i style="background:#555"></i>no significant change</span>'}</div>
      <table class="t"><tr><th>Brighter usually means</th><th>Darker usually means</th></tr>
      <tr><td class="small">vegetation growth, flooding under a canopy (double bounce), refreezing snow, wetter soil, new structures</td>
      <td class="small">open water, clearing or burning, harvest, melting (wet) snow, smoother ground</td></tr></table>
      <p class="note">${T(`${acqs()[a].date} → ${acqs()[b].date} (${days} days). Threshold |log-ratio| = ${r.thr.toFixed(3)}, about a ${(Math.exp(r.thr) * 100 - 100).toFixed(0)}% brightness change.`, `${acqs()[a].date} → ${acqs()[b].date} (${days} gün). Eşik |log-oran| = ${r.thr.toFixed(3)}, yaklaşık %${(Math.exp(r.thr) * 100 - 100).toFixed(0)} parlaklık değişimi.`)}</p>`;
  };
  ['cFrom', 'cTo', 'cCh'].forEach((id) => $('#' + id).addEventListener('change', run));
  $$('#cShow button').forEach((b) => b.addEventListener('click', () => { show = b.dataset.s; $$('#cShow button').forEach((x) => x.classList.toggle('on', x === b)); run(); }));
  run();
}

function toolClasses(el) {
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:820px">${T(`Every pixel is described by six numbers: HH and HV on the selected date, their difference, their averages over all passes, and how much they vary. k-means groups similar pixels without any labels, and each group is then read physically. A pixel's confidence measures how much closer it is to its own group centre than to the next one.`, `Her piksel altı sayıyla tanımlanır: seçili tarihteki HH ve HV, farkları, tüm geçişlerdeki ortalamaları ve ne kadar değiştikleri. k-means benzer pikselleri etiket olmadan gruplar; her grup sonra fiziksel olarak yorumlanır. Bir pikselin güveni, kendi grup merkezine bir sonrakinden ne kadar yakın olduğunu ölçer.`)}</p>
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
      + `<p class="note">${T(`Group names come from simple physical rules on the group averages. They are interpretations, not validated land-cover classes.`, `Grup adları grup ortalamalarına uygulanan basit fiziksel kurallardan gelir. Bunlar yorumdur, doğrulanmış arazi örtüsü sınıfları değildir.`)}</p>`;
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
      $('#fChart').parentElement.innerHTML = `<div class="empty">${T(`This site has ${ts.length} passes. A forecast needs at least ${MIN_POINTS}.`, `Bu alanda ${ts.length} geçiş var. Tahmin için en az ${MIN_POINTS} gerekir.`)}</div>`;
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
      <p class="note">${T(`Current trend: ${f.trendPerMonth >= 0 ? '+' : ''}${f.trendPerMonth.toFixed(2)}${unit} per month, damped towards flat (φ = ${f.model.phi}).`, `Mevcut eğilim: ayda ${f.trendPerMonth >= 0 ? '+' : ''}${f.trendPerMonth.toFixed(2)}${unit}, düze doğru sönümlenmiş (φ = ${f.model.phi}).`)}</p>`;
    const b = f.backtest;
    const better = b.skill > 0.05;
    $('#fSkill').innerHTML = `<h3>How good is it? (backtest)</h3>
      <p class="small muted">${T(`Each of the last ${b.n} passes was predicted using only the passes before it, then compared with simply repeating the previous value.`, `Son ${b.n} geçişin her biri yalnızca kendinden önceki geçişlerle tahmin edildi, sonra bir önceki değeri tekrarlamakla karşılaştırıldı.`)}</p>
      <dl class="kv"><dt>Error, trend model</dt><dd class="mono">${b.maeTrend.toFixed(2)}${unit}</dd>
      <dt>Error, "same as last pass"</dt><dd class="mono">${b.maePersist.toFixed(2)}${unit}</dd>
      <dt>Skill</dt><dd class="mono" style="color:${better ? 'var(--ok)' : 'var(--no)'}">${(b.skill * 100).toFixed(0)}%</dd>
      <dt>Inside 80% range</dt><dd class="mono">${Math.round(b.coverage80 * b.n)} of ${b.n}</dd></dl>
      <p class="note">${T(`${better ? 'The trend beats the naive guess here.' : 'The trend does <b>not</b> beat the naive guess here. Treat the forecast as a scenario, not a prediction.'}`, `${better ? 'Eğilim burada basit tahmini geçiyor.' : 'Eğilim burada basit tahmini <b>geçemiyor</b>. Tahmini bir kesinlik değil, senaryo olarak okuyun.'}`)}</p>`;
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
    <p class="note">${T(`Sources: NASA EONET (natural events, linking to GDACS, InciWeb and others) ${src.eonet === 'ok' ? '' : '(unavailable at last build)'} · USGS earthquake catalogue, M ≥ 4 within 250 km ${src.usgs === 'ok' ? '' : '(unavailable at last build)'} · GDELT news search, filtered to headlines naming both the place and the process ${src.gdelt === 'ok' ? '' : '(not reachable at the last data build; filled by the weekly GitHub Actions run)'}.`, `Kaynaklar: NASA EONET (doğal olaylar; GDACS, InciWeb ve diğerlerine bağlantılı) ${src.eonet === 'ok' ? '' : '(son derlemede erişilemedi)'} · USGS deprem kataloğu, 250 km içinde M ≥ 4 ${src.usgs === 'ok' ? '' : '(son derlemede erişilemedi)'} · GDELT haber araması, hem yeri hem süreci adlandıran başlıklara süzülmüş ${src.gdelt === 'ok' ? '' : '(son derlemede erişilemedi; haftalık GitHub Actions çalışmasında doldurulur)'}.`)}</p>
  </div>`;
  const ts = times();
  const nearestPass = (d) => { let best = null; ts.forEach((t, i) => { const dd = (t - tOf(d)) / DAY; if (best === null || Math.abs(dd) < Math.abs(best.dd)) best = { i, dd }; }); return best; };
  const render = (k) => {
    const rows = list.filter((e) => k === 'all' || e.kind === k);
    $('#evList').innerHTML = rows.length ? rows.map((e) => {
      const np = nearestPass(e.date);
      const kind = e.kind === 'quake' ? `Earthquake${e.mag ? ' M' + e.mag.toFixed(1) : ''}` : e.kind === 'news' ? `News · ${esc(e.source || '')}` : esc(e.category || 'Event');
      return `<div class="ev-row"><span class="d">${e.date}</span><span class="k">${kind}</span><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a>
        <span class="near">${e.distKm != null ? e.distKm + ' km · ' : ''}${np ? `<a href="${hrefOf(S.site)}/images" data-i="${np.i}" class="jump">pass ${np.dd === 0 ? 'same day' : (np.dd > 0 ? '+' : '') + Math.round(np.dd) + ' d'}</a>` : ''}</span></div>`;
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


// ================================================================== AGRICULTURE
const AG_THEMES = new Set(['agriculture', 'groundwater', 'flood']);
export function isAgSite(site) { if (site.region) return true; return AG_THEMES.has((STORIES[site.id] || {}).theme || site.theme); }

const AG_TOOLS = [
  ['deep', 'Crop types & calendar', 'U-TAE or your U-Mamba / SITSMamba'],
  ['suggest', 'What could grow here', 'Suitable crops vs crops grown now'],
  ['moisture', 'Soil moisture', 'Four soil layers + NISAR surface wetness'],
  ['drought', 'Drought', 'Drier than usual? Rain, soil, heat'],
  ['context', 'Weather & NDVI', 'Rain, temperature, optical greenness'],
];
const MODE_LABEL = { sos: 'Start of season', pos: 'Peak of season', eos: 'End of season', harvest: 'Harvest date', flood: 'Flooding date' };

function agDays() { const ts = times(); return ts.map((t) => Math.round((t - ts[0]) / DAY)); }
function dayLabel(d) { return d == null || Number.isNaN(d) ? '–' : fmtShort(times()[0] + d * DAY); }

async function agEnsure() {
  if (!S.stack) S.stack = await getStack();
  if (!S.agri) S.agri = await call('agri', { id: S.stack.id, days: agDays(), t0: times()[0] });
  return S.agri;
}

function agriTab(el) {
  el.innerHTML = `
  <div class="grid g-side">
    <div class="subnav" id="agTools">${AG_TOOLS.map(([k, t, d]) => `<button data-k="${k}" class="${S.agTool === k ? 'on' : ''}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>
    <div id="agTool"><div class="empty">Loading…</div></div>
  </div>
  <p class="note">${T(`Crop types and their calendar come from the trained networks (Sentinel-2 time series). Everything runs in your browser.`, `Ürün türleri ve takvimleri eğitilmiş ağlardan (Sentinel-2 zaman serisi) gelir. Her şey tarayıcınızda çalışır.`)}</p>`;
  $$('#agTools button').forEach((b) => b.addEventListener('click', () => {
    S.agTool = b.dataset.k; $$('#agTools button').forEach((x) => x.classList.toggle('on', x === b)); showAgTool();
  }));
  getStack().then((st) => { S.stack = st; if (S.tab === 'agri') showAgTool(); });
}

function showAgTool() {
  destroyCharts();
  ({ calendar: agCalendar, harvest: agHarvest, patterns: agPatterns, fields: agFields, context: agContext, landcover: toolLandcover, deep: agDeep, suggest: agSuggest, moisture: agMoisture, drought: agDrought }[S.agTool] || agDeep)($('#agTool'));
}

async function agMap(canvas, mode, opts = {}) {
  const r = await call('agriRender', { id: S.stack.id, mode, ...opts });
  drawTo(canvas, new ImageData(new Uint8ClampedArray(r.data), r.w, r.h));
}

function dateLegend() {
  const ts = times(), n = 5;
  const labels = Array.from({ length: n }, (_, k) => fmtShort(ts[0] + (k / (n - 1)) * (ts[ts.length - 1] - ts[0])));
  return `<div style="height:10px;border-radius:4px;background:linear-gradient(90deg,#30123b,#4662d7,#36aaf9,#1ae4b6,#72fe5e,#c8ef34,#faba39,#f66b19,#ca2a04,#7a0403)"></div>
    <div class="legend" style="justify-content:space-between;margin-top:4px">${labels.map((l) => `<span>${l}</span>`).join('')}</div>`;
}

function monthBars(id, hist, label, color) {
  const keys = Object.keys(hist || {}).sort();
  chart(id, {
    type: 'bar',
    data: { labels: keys.map((k) => new Date(k + '-15').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })), datasets: [{ label, data: keys.map((k) => hist[k]), backgroundColor: color }] },
    options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { y: { title: { display: true, text: 'km²' } } } },
  });
}

function agCalendar(el) {
  const A = S.agri;
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:860px">For every pixel the radar vegetation index series is smoothed and three dates are read off: <b>start of season</b> (half-way up the rise before the peak), <b>peak</b> (maximum canopy) and <b>end of season</b> (half-way down after the peak). Only pixels with a clear seasonal cycle (cropland, ${pct(A.croplandPct, 0)} of the scene, ${Math.round(A.croplandKm2)} km²) are coloured; the rest is shown in grey.</p>
      <div class="controls"><div class="seg" id="calSeg"><button data-m="sos" class="on">Start of season</button><button data-m="pos">Peak</button><button data-m="eos">End of season</button></div></div>
      <div class="result">
        <div><canvas class="map" id="agMap" width="512" height="512"></canvas>${dateLegend()}</div>
        <div><h3 class="small muted" style="font-weight:500" id="calTitle"></h3><div class="chart"><canvas id="calHist"></canvas></div>
        <p class="note">Where the colour changes abruptly from field to field, neighbouring farms planted or harvested at different times.</p></div>
      </div>
    </div>`;
  const draw = (m) => {
    $$('#calSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    agMap($('#agMap'), m);
    $('#calTitle').textContent = `${MODE_LABEL[m]}: cropland area per month`;
    monthBars('calHist', A.hist[m], MODE_LABEL[m], '#e8b04a');
  };
  $$('#calSeg button').forEach((b) => b.addEventListener('click', () => draw(b.dataset.m)));
  draw('sos');
}

function agHarvest(el) {
  const A = S.agri, ts = times();
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:860px"><b>Harvest</b> = the sharpest drop in the vegetation index from an above-average level (the canopy disappears within one 12-day revisit). <b>Flooding</b> = a pass on which a field is dark in HH like water, but bright again within about two months: the signature of paddies flooded for transplanting rice, or of a short flood.</p>
      <div class="controls"><div class="seg" id="hvSeg"><button data-m="harvest" class="on">Harvest date</button><button data-m="flood">Flooding date</button></div></div>
      <div class="result">
        <div><canvas class="map" id="agMap" width="512" height="512"></canvas>${dateLegend()}</div>
        <div class="stack">
          <div><h3 class="small muted" style="font-weight:500">Harvest progress: share of cropland harvested</h3><div class="chart sm"><canvas id="hvCurve"></canvas></div></div>
          <div><h3 class="small muted" style="font-weight:500">Flooded area on each pass (km², permanent water excluded)</h3><div class="chart sm"><canvas id="flCurve"></canvas></div></div>
        </div>
      </div>
    </div>`;
  const draw = (m) => { $$('#hvSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === m)); agMap($('#agMap'), m); };
  $$('#hvSeg button').forEach((b) => b.addEventListener('click', () => draw(b.dataset.m)));
  draw('harvest');
  const line = (id, ys, label, color, unit) => chart(id, {
    type: 'line', data: { datasets: [{ label, data: ts.map((x, i) => ({ x, y: ys[i] })), borderColor: color, backgroundColor: color + '33', fill: true, pointRadius: 2, tension: 0.2 }] },
    options: { maintainAspectRatio: false, animation: false, parsing: false, scales: { x: timeAxis(), y: { beginAtZero: true, title: { display: true, text: unit } } }, plugins: { legend: { display: false } } },
  });
  line('hvCurve', A.harvestCum, 'harvested', '#f59e0b', '%');
  line('flCurve', A.floodKm2, 'flooded', '#3fb8ff', 'km²');
}

function agPatterns(el) {
  const A = S.agri, ts = times();
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:860px"><b>Cropping intensity, not crop type.</b> From the radar vegetation-index series of each pixel: how many growing seasons it had (growth peaks followed by a harvest drop), whether it was flooded before the canopy grew, or whether its vegetation stayed steady. These are rules on the NISAR time series: they say <b>how often and how the land was cropped</b>, not which crop it was. Crop types come from the deep-learning models (Crops &amp; yield → Deep learning). ${A.prior?.used ? `Crop patterns are only allowed where <b>ESA WorldCover 10 m</b> maps cropland (${pct(A.prior.wcCropPct, 0)} of this area); ${pct(A.prior.removedPct, 0)} of the radar-seasonal pixels were outside it (grassland, desert, towns) and were reassigned.` : 'ESA WorldCover could not be read, so no land-cover prior was applied.'} Patches under 4 radar pixels (~0.15 km²) are merged into their neighbours.</p>
      <div class="result">
        <canvas class="map" id="agMap" width="512" height="512"></canvas>
        <div class="classes">${A.patterns.map((p) => `<div class="row"><i style="background:${p.color}"></i><div><b>${p.name}</b><span>${p.why}</span></div><div class="v">${p.km2.toFixed(0)} km²<br><span class="muted">${pct(p.pct)}</span></div></div>`).join('')}</div>
      </div>
      <h3 class="small muted" style="font-weight:500;margin-top:14px">Average vegetation index through the year, per pattern</h3>
      <div class="chart"><canvas id="ptProf"></canvas></div>
    </div>`;
  agMap($('#agMap'), 'pattern');
  chart('ptProf', {
    type: 'line',
    data: { datasets: A.patterns.filter((p) => p.km2 > 0).map((p) => ({ label: p.name, data: ts.map((x, i) => ({ x, y: p.profile[i] })), borderColor: p.color, backgroundColor: p.color, pointRadius: 2, tension: 0.25 })) },
    options: { maintainAspectRatio: false, animation: false, parsing: false, scales: { x: timeAxis(), y: { title: { display: true, text: 'RVI (relative)' } } }, plugins: { legend: { labels: { boxWidth: 10 } } } },
  });
}

function agFields(el) {
  const A = S.agri, ts = times();
  const segs = A.segments;
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:860px">Neighbouring pixels with the same cropping pattern and harvest month are grouped into <b>segments</b>. Where fields are larger than a few hundred metres (Iowa, Mato Grosso, Ukraine) a segment is usually one field or a block of fields; where fields are small (Punjab, Nile, Mekong) it is a group of fields managed on the same calendar. Click a row or the map.</p>
      <div class="result">
        <canvas class="map" id="agMap" width="512" height="512" style="cursor:pointer"></canvas>
        <div>
          <div style="max-height:330px;overflow:auto"><table class="t" id="fTab"><tr><th>#</th><th>Pattern</th><th style="text-align:right">km²</th><th>Start</th><th>Peak</th><th>Harvest</th></tr>
          ${segs.slice(0, 60).map((g, k) => `<tr data-id="${g.id}" style="cursor:pointer"><td class="num">${k + 1}</td><td><span class="tag" style="--c:${PATTERN_COLORS[g.cls]}"><i></i>${PATTERN_NAMES[g.cls]}</span></td><td class="num">${g.km2.toFixed(1)}</td><td>${dayLabel(g.sos)}</td><td>${dayLabel(g.peak)}</td><td>${dayLabel(g.harvest)}</td></tr>`).join('')}</table></div>
          <h3 class="small muted" style="font-weight:500;margin-top:10px" id="fTitle">Select a segment</h3>
          <div class="chart sm"><canvas id="fProf"></canvas></div>
        </div>
      </div>
      <p class="note">${segs.length} segments of at least 6 pixels (≈ ${(6 * (S.stack.pixelKm2 || 0.04)).toFixed(2)} km²); the 60 largest are listed.</p>
    </div>`;
  const select = (id) => {
    S.agSeg = id;
    agMap($('#agMap'), 'segments', { seg: id });
    $$('#fTab tr[data-id]').forEach((r) => r.style.background = +r.dataset.id === id ? 'var(--surface-3)' : '');
    const g = segs.find((x) => x.id === id);
    if (!g) return;
    $('#fTitle').textContent = `Segment: ${PATTERN_NAMES[g.cls]}, ${g.km2.toFixed(1)} km² · peak ${dayLabel(g.peak)} · harvest ${dayLabel(g.harvest)}`;
    chart('fProf', {
      type: 'line', data: { datasets: [{ label: 'RVI', data: ts.map((x, i) => ({ x, y: g.profile[i] })), borderColor: '#e8b04a', backgroundColor: '#e8b04a', pointRadius: 2, tension: 0.25 }] },
      options: { maintainAspectRatio: false, animation: false, parsing: false, scales: { x: timeAxis() }, plugins: { legend: { display: false } } },
    });
  };
  $$('#fTab tr[data-id]').forEach((r) => r.addEventListener('click', () => select(+r.dataset.id)));
  $('#agMap').addEventListener('click', async (e) => {
    const r = e.target.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * SIZE), y = Math.floor(((e.clientY - r.top) / r.height) * SIZE);
    const { seg } = await call('segmentAt', { id: S.stack.id, x, y });
    if (seg >= 0) select(seg);
  });
  select(S.agSeg >= 0 ? S.agSeg : (segs[0]?.id ?? -1));
}

const PATTERN_NAMES = ['Open water', 'Flooded, then grown', 'Two or more seasons', 'One season', 'Steady vegetation', 'Bare / built / fallow'];
const PATTERN_COLORS = ['#2563eb', '#22d3ee', '#f59e0b', '#facc15', '#16a34a', '#a8a29e'];

async function agContext(el) {
  el.innerHTML = '<div class="empty">Loading weather and NDVI…</div>';
  let ctx = null;
  if (S.site.region) {
    el.innerHTML = '<div class="empty">Fetching NASA POWER weather and MODIS NDVI for this window…</div>';
    const b = aoiBounds();
    ctx = await liveContext(S.site.id, S.site.lon, S.site.lat, [b.W, b.S, b.E, b.N]);
  } else {
    try { const r = await fetch(`${app.base}data/context/${S.site.id}.json`); if (r.ok) ctx = await r.json(); } catch (e) { /* none */ }
  }
  if (S.tab !== 'agri' || S.agTool !== 'context') return;
  if (!ctx) { el.innerHTML = '<div class="empty">No weather / NDVI context for this site yet (run pipeline/build_context.py).</div>'; return; }
  if (!S.stack) S.stack = await getStack();
  const rviWin = windowRvi(S.stack), ts = times();
  const w = ctx.weather || { dates: [], precip_mm: [], t2m_c: [] }, nd = ctx.ndvi || { dates: [], mean: [] };
  const tOfD = (d) => Date.parse(d + 'T12:00:00Z');
  // weekly precipitation totals keep the chart readable
  const weeks = {};
  w.dates.forEach((d, i) => { const k = Math.floor((tOfD(d) - tOfD(w.dates[0])) / (7 * DAY)); weeks[k] = (weeks[k] || 0) + (w.precip_mm[i] || 0); });
  const wk = Object.entries(weeks).map(([k, v]) => ({ x: tOfD(w.dates[0]) + (+k + 0.5) * 7 * DAY, y: v }));
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:860px">${T(`The radar vegetation index of the whole area (NISAR) next to the optical NDVI of the same area (NASA MODIS, 16-day composites) and the weather (NASA POWER). When the two vegetation curves rise and fall together, the radar is seeing the crop cycle. Radar keeps working through the monsoon cloud, when optical composites become patchy.`, `Bütün alanın radar bitki indeksi (NISAR), aynı alanın optik NDVI'si (NASA MODIS, 16 günlük) ve hava durumu (NASA POWER) yan yana. İki bitki eğrisi birlikte iniyor çıkıyorsa radar ürün döngüsünü görüyordur. Optik görüntüler muson bulutu altında parçalı kalırken radar çalışmaya devam eder.`)}</p>
      <div class="chart lg"><canvas id="cxVeg"></canvas></div>
      <div class="chart sm" style="margin-top:12px"><canvas id="cxWx"></canvas></div>
      <p class="note">${T(`Sources: ${esc(nd.source || '')} · ${esc(w.source || '')}. NDVI is the scene mean of valid (cloud-free) pixels in each composite.`, `Kaynaklar: ${esc(nd.source || '')} · ${esc(w.source || '')}. NDVI, her bileşimdeki geçerli (bulutsuz) piksellerin sahne ortalamasıdır.`)}</p>
    </div>`;
  const xmin = Math.min(ts[0], ...(nd.dates.length ? [tOfD(nd.dates[0])] : [])), xmax = Math.max(ts[ts.length - 1], ...(nd.dates.length ? [tOfD(nd.dates[nd.dates.length - 1])] : []));
  chart('cxVeg', {
    type: 'line',
    data: { datasets: [
      { label: 'NISAR RVI (whole area)', data: ts.map((x, i) => ({ x, y: rviWin[i] })), borderColor: '#e8b04a', backgroundColor: '#e8b04a', pointRadius: 3, tension: 0.25, yAxisID: 'y' },
      { label: 'MODIS NDVI', data: nd.dates.map((d, i) => ({ x: tOfD(d), y: nd.mean[i] })), borderColor: '#44e07a', backgroundColor: '#44e07a', pointRadius: 2, tension: 0.25, yAxisID: 'y1' },
    ] },
    options: { maintainAspectRatio: false, animation: false, parsing: false, interaction: { mode: 'nearest', intersect: false },
      scales: { x: { ...timeAxis(), min: xmin, max: xmax }, y: { title: { display: true, text: 'RVI (relative)' } }, y1: { position: 'right', min: 0, max: 1, grid: { display: false }, title: { display: true, text: 'NDVI' } } },
      plugins: { legend: { labels: { boxWidth: 10 } } } },
  });
  chart('cxWx', {
    data: { datasets: [
      { type: 'bar', label: 'Rain, mm per week', data: wk, backgroundColor: 'rgba(63,184,255,0.55)', yAxisID: 'y' },
      { type: 'line', label: 'Air temperature °C', data: w.dates.map((d, i) => ({ x: tOfD(d), y: w.t2m_c[i] })), borderColor: '#ff6a4d', pointRadius: 0, borderWidth: 1, yAxisID: 'y1' },
    ] },
    options: { maintainAspectRatio: false, animation: false, parsing: false,
      scales: { x: { ...timeAxis(), min: xmin, max: xmax }, y: { beginAtZero: true, title: { display: true, text: 'mm / week' } }, y1: { position: 'right', grid: { display: false }, title: { display: true, text: '°C' } } },
      plugins: { legend: { labels: { boxWidth: 10 } } } },
  });
}

// ---------------------------------------------------------------- two-area similarity
const cmpStacks = new Map();
function toolCompare(el) {
  const R = S.site, b = aoiBounds();
  const hw = (b.E - b.W) / 2, hh = (b.N - b.S) / 2;
  let recentList = [];
  try { recentList = JSON.parse(localStorage.getItem('dws.recentRegions2') || '[]').filter((x) => x.box.join() !== [b.W, b.S, b.E, b.N].join()); } catch (e) { /* none */ }
  const refs = (archLib?.archetypes || []).flatMap((a) => a.sites.slice(0, 1).map((x) => ({ label: `${a.name} (Brazil)`, lat: x.lat, lon: x.lon })));
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:880px">${T(`Compare this area (A) with any other area (B). Both are fetched live from NISAR and described the same way: how bright the radar is (HH, HV), how much it changes from pass to pass, and the plant index RVI. The result says how similar the two surfaces behave and which parts of A look most like B.`, `Bu alanı (A) başka herhangi bir alanla (B) karşılaştırın. İkisi de NISAR'dan canlı çekilir ve aynı şekilde tanımlanır: radarın ne kadar parlak olduğu (HH, HV), geçişten geçişe ne kadar değiştiği ve bitki indeksi RVI. Sonuç, iki yüzeyin ne kadar benzer davrandığını ve A'nın hangi kısımlarının B'ye en çok benzediğini söyler.`)}</p>
      <div class="controls" style="flex-wrap:wrap">
        <label>Area B at <input id="cmpLL" placeholder="lat, lon  e.g. -12.55, -55.75" style="width:220px"></label>
        ${recentList.length ? `<label>or a recent area <select id="cmpRecent"><option value="">–</option>${recentList.map((x, i) => `<option value="${i}">${esc(x.label || x.box.map((v) => v.toFixed(2)).join(', '))}</option>`).join('')}</select></label>` : ''}
        <label>or a reference <select id="cmpRef"><option value="">–</option>${refs.map((x, i) => `<option value="${i}">${esc(x.label)}</option>`).join('')}</select></label>
        <label><input type="checkbox" id="cmpShift" ${(R.lat >= 0) !== true ? '' : ''}> shift B by 6 months (other hemisphere)</label>
        <button class="btn" id="cmpGo">Compare</button>
      </div>
      <div id="cmpOut"><p class="note">${T(`B is drawn with the same size as A (${(2 * hw * 111 * Math.cos((R.lat * Math.PI) / 180)).toFixed(0)} × ${(2 * hh * 111).toFixed(0)} km). Fetching it takes as long as opening a new area.`, `B, A ile aynı boyutta çizilir (${(2 * hw * 111 * Math.cos((R.lat * Math.PI) / 180)).toFixed(0)} × ${(2 * hh * 111).toFixed(0)} km). Yüklenmesi yeni bir alan açmak kadar sürer.`)}</p></div>
    </div>`;
  if (!refs.length) fetch(`${app.base}data/archetypes.json`).then((r) => r.json()).then((j) => { archLib = j; if (S.tool === 'compare') toolCompare(el); });
  const boxAt = (lat, lon) => { const hl = hw; return [lon - hl, lat - hh, lon + hl, lat + hh]; };
  $('#cmpGo').addEventListener('click', async () => {
    let box = null;
    const ll = $('#cmpLL').value.split(/[ ,;]+/).map(Number).filter((v) => !Number.isNaN(v));
    if ($('#cmpRecent')?.value) box = recentList[+$('#cmpRecent').value].box;
    else if ($('#cmpRef').value) { const r0 = refs[+$('#cmpRef').value]; box = boxAt(r0.lat, r0.lon); }
    else if (ll.length === 2 && Math.abs(ll[0]) <= 90) box = boxAt(ll[0], ll[1]);
    if (!box) { $('#cmpOut').innerHTML = '<div class="empty">Enter "lat, lon" or pick an area.</div>'; return; }
    const key = box.map((v) => v.toFixed(4)).join('/'), idB = `cmp_${key}`;
    $('#cmpOut').innerHTML = '<div class="loading-region"><div class="small muted" id="cmpStage">Searching the ASF archive for area B…</div><div class="bar"><i id="cmpBar"></i></div></div>';
    try {
      if (!cmpStacks.has(key)) cmpStacks.set(key, call('region', { id: idB, box, maxDates: 24 }, [], (p) => {
        if ($('#cmpStage')) $('#cmpStage').textContent = `Area B: ${p.stage}${p.total > 1 ? ` · ${p.done} / ${p.total}` : ''}`;
        if ($('#cmpBar')) $('#cmpBar').style.width = `${p.total ? (100 * p.done) / p.total : 5}%`;
      }));
      const infoB = await cmpStacks.get(key);
      if (!S.stack) S.stack = await getStack();
      const r = await call('compare', { idA: S.stack.id, idB });
      if (S.tool !== 'compare' || !$('#cmpOut')) return;
      if (r.error) { $('#cmpOut').innerHTML = `<div class="empty">${esc(r.error)}</div>`; return; }
      showCompare(r, infoB, box, $('#cmpShift').checked);
    } catch (e) {
      cmpStacks.delete(key);
      $('#cmpOut').innerHTML = `<div class="empty">${T(`Area B could not be loaded`, `B alanı yüklenemedi`)}: ${esc(e.message)}</div>`;
    }
  });
}

// landscape-level similarity: several independent views of "how alike are two places", each 0..1
const climCache = new Map();
async function powerClim(lat, lon) {
  const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (!climCache.has(k)) climCache.set(k, fetch(`https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,PRECTOTCORR,GWETROOT&community=AG&longitude=${lon.toFixed(3)}&latitude=${lat.toFixed(3)}&format=JSON`)
    .then((r) => r.json()).then((j) => { const P = j.properties.parameter, M = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']; return { t: M.map((m) => P.T2M[m]), p: M.map((m) => P.PRECTOTCORR[m]), w: M.map((m) => P.GWETROOT[m]) }; }));
  return climCache.get(k);
}
const WC_LABEL = { 10: 'trees', 20: 'shrub', 30: 'grass', 40: 'cropland', 50: 'built-up', 60: 'bare', 70: 'snow / ice', 80: 'water', 90: 'wetland', 95: 'mangrove', 100: 'moss' };
const topShares = (o, names, n = 3) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${names(k)} ${Math.round(v * 100)} %`).join(', ');
const intersect = (a, b) => Object.keys({ ...a, ...b }).reduce((s, k) => s + Math.min(a[k] || 0, b[k] || 0), 0);

async function landscapeDims(boxA, boxB, shift, r) {
  const c = (b) => [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2];
  const [laA, loA] = c(boxA), [laB, loB] = c(boxB);
  const [mixA, mixB, clA, clB, tA, tB] = await Promise.all([
    cropMix(app.base, boxA).catch(() => null), cropMix(app.base, boxB).catch(() => null),
    powerClim(laA, loA).catch(() => null), powerClim(laB, loB).catch(() => null),
    terrain(boxA).catch(() => null), terrain(boxB).catch(() => null),
  ]);
  const sh = (arr) => (shift ? arr.map((_, i) => arr[(i + 6) % 12]) : arr);
  const dims = [{ key: 'radar', label: 'Radar behaviour', score: r.similarity, a: '', b: '', how: 'overlap of the six NISAR features' }];
  if (r.wcA && r.wcB) dims.push({ key: 'cover', label: 'Land cover', score: intersect(r.wcA, r.wcB), a: topShares(r.wcA, (k) => WC_LABEL[k] || k), b: topShares(r.wcB, (k) => WC_LABEL[k] || k), how: 'shared share of ESA WorldCover classes' });
  if (mixA?.totalHa && mixB?.totalHa) {
    const sa = Object.fromEntries(mixA.list.map((x) => [x.name, x.share])), sb = Object.fromEntries(mixB.list.map((x) => [x.name, x.share]));
    dims.push({ key: 'crops', label: 'Crop mix', score: intersect(sa, sb), a: topShares(sa, (k) => k), b: topShares(sb, (k) => k), how: 'shared share of crops grown (SPAM)' });
  }
  if (clA && clB) {
    const bt = sh(clB.t), bp = sh(clB.p), bw = sh(clB.w);
    const rmsT = Math.sqrt(clA.t.reduce((s, v, i) => s + (v - bt[i]) ** 2, 0) / 12);
    const rmsP = Math.sqrt(clA.p.reduce((s, v, i) => s + (Math.log1p(v) - Math.log1p(bp[i])) ** 2, 0) / 12);
    const rmsW = Math.sqrt(clA.w.reduce((s, v, i) => s + (v - bw[i]) ** 2, 0) / 12);
    const yr = (p) => Math.round(p.reduce((a, b) => a + b, 0) * 30.4);
    const mean = (v) => (v.reduce((a, b) => a + b, 0) / 12).toFixed(1);
    dims.push({ key: 'climate', label: 'Climate', score: Math.exp(-rmsT / 4) * Math.exp(-rmsP / 0.6), a: `${mean(clA.t)} °C, ${yr(clA.p)} mm/yr`, b: `${mean(clB.t)} °C, ${yr(clB.p)} mm/yr`, how: `monthly temperature and rain${shift ? ' (B shifted 6 months)' : ''}, NASA POWER` });
    dims.push({ key: 'water', label: 'Soil water regime', score: Math.exp(-rmsW / 0.12), a: `root zone ${mean(clA.w)}`, b: `root zone ${mean(clB.w)}`, how: 'monthly root-zone wetness, NASA POWER' });
  }
  if (tA && tB) {
    const d = Math.abs(tA.p90 - tB.p90) / 8 + Math.abs(tA.steepFrac - tB.steepFrac) / 0.3;
    const elev = (t) => Math.round(t.elev.reduce((a, b) => a + b, 0) / t.elev.length);
    dims.push({ key: 'terrain', label: 'Terrain', score: Math.exp(-d), a: `${elev(tA)} m, slope p90 ${tA.p90.toFixed(0)}°`, b: `${elev(tB)} m, slope p90 ${tB.p90.toFixed(0)}°`, how: 'slope distribution (elevation tiles)' });
  }
  return dims;
}

function showDims(dims) {
  const box = $('#cmpDims');
  if (!box) return;
  const overall = dims.reduce((s, d) => s + d.score, 0) / dims.length;
  box.innerHTML = `
    <h3 style="margin:16px 0 6px">How alike are the two places? <span class="muted small">(${Math.round(overall * 100)} % overall)</span></h3>
    <div class="result"><div class="chart" style="height:320px"><canvas id="cmpRadar"></canvas></div>
    <table class="t"><tr><th>Aspect</th><th style="text-align:right">alike</th><th>A</th><th>B</th></tr>
    ${dims.map((d) => `<tr><td title="${esc(d.how)}">${esc(d.label)}</td><td class="num">${Math.round(d.score * 100)} %</td><td class="small">${esc(d.a)}</td><td class="small">${esc(d.b)}</td></tr>`).join('')}</table></div>
    <p class="note">${T(`Not a pixel-by-pixel match: each aspect compares the two places as a whole. Radar behaviour and land cover come from the areas themselves; crop mix from SPAM 2010; climate and soil water from NASA POWER long-term monthly means; terrain from elevation tiles. The overall value is the plain mean of the aspects.`, `Piksel piksel bir eşleştirme değil: her boyut iki yeri bir bütün olarak karşılaştırır. Radar davranışı ve arazi örtüsü alanların kendisinden; ürün karışımı SPAM 2010'dan; iklim ve toprak suyu NASA POWER uzun dönem aylık ortalamalarından; arazi yapısı yükseklik karolarından gelir. Toplam değer, boyutların düz ortalamasıdır.`)}</p>`;
  chart('cmpRadar', {
    type: 'radar',
    data: { labels: dims.map((d) => d.label), datasets: [{ label: 'similarity %', data: dims.map((d) => Math.round(d.score * 100)), borderColor: '#e8b04a', backgroundColor: 'rgba(232,176,74,0.25)', pointRadius: 3 }] },
    options: { maintainAspectRatio: false, animation: false, scales: { r: { min: 0, max: 100, ticks: { stepSize: 25, backdropColor: 'transparent', color: '#8a94a3' }, grid: { color: 'rgba(138,148,163,0.25)' }, angleLines: { color: 'rgba(138,148,163,0.25)' }, pointLabels: { color: '#c9d1d9' } } }, plugins: { legend: { display: false } } },
  });
}

function showCompare(r, infoB, boxB, shift) {
  const pct0 = Math.round(r.similarity * 100);
  const verdict = pct0 >= 75 ? T('very similar', 'çok benzer') : pct0 >= 55 ? T('similar', 'benzer') : pct0 >= 35 ? T('partly similar', 'kısmen benzer') : T('different', 'farklı');
  const tsA = times(), accB = infoB.acquisitions || [];
  const doy = (t) => { const d = new Date(t); return (t - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY; };
  const tB = accB.map((a) => Date.parse(a.date + 'T12:00:00Z'));
  const off = shift ? 182 : 0;
  const ptsA = (k) => tsA.map((t, i) => ({ x: doy(t), y: r.curves.a[k][i] })).filter((p) => p.y != null).sort((p, q) => p.x - q.x);
  const ptsB = (k) => tB.map((t, i) => ({ x: (doy(t) + off) % 365, y: r.curves.b[k][i] })).filter((p) => p.y != null).sort((p, q) => p.x - q.x);
  // calendar overlap and curve correlation (RVI) on the shared days of the year
  const interp = (pts, x) => { for (let i = 1; i < pts.length; i++) if (pts[i].x >= x && pts[i - 1].x <= x) { const w = (x - pts[i - 1].x) / Math.max(pts[i].x - pts[i - 1].x, 1e-6); return pts[i - 1].y * (1 - w) + pts[i].y * w; } return null; };
  const pa = ptsA('rvi'), pb = ptsB('rvi'), pairs = [];
  for (let x = 0; x < 365; x += 6) { const ya = interp(pa, x), yb = interp(pb, x); if (ya != null && yb != null) pairs.push([ya, yb]); }
  const rr = pairs.length >= 5 ? pearson(pairs) : null;
  const latB = (boxB[1] + boxB[3]) / 2, lonB = (boxB[0] + boxB[2]) / 2;
  $('#cmpOut').innerHTML = `
    <div class="stats" style="margin:10px 0">
      <div class="stat"><b>${pct0} %</b><span>${T(`overall similarity · ${verdict}`, `genel benzerlik · ${verdict}`)}</span></div>
      <div class="stat"><b>${Math.round(r.closeShare * 100)} %</b><span>${T(`of area A behaves like B's typical surface`, `A alanının B'nin tipik yüzeyi gibi davranan payı`)}</span></div>
      <div class="stat"><b>${rr == null ? '–' : rr.toFixed(2)}</b><span>${T(`season-curve match (RVI)${rr == null ? ': the two calendars barely overlap' : ''}`, `sezon eğrisi uyumu (RVI)${rr == null ? ': iki takvim neredeyse örtüşmüyor' : ''}`)}</span></div>
    </div>
    <div class="result">
      <canvas class="map" id="cmpMap" width="512" height="512"></canvas>
      <div>
        <div class="legend" style="margin-bottom:8px"><span><i style="background:#22c55e"></i>like B</span><span><i style="background:#eab308"></i>somewhat</span><span><i style="background:#ef4444"></i>unlike B</span><span><i style="background:#111"></i>water / no data</span></div>
        <table class="t"><tr><th>Feature</th><th style="text-align:right">A</th><th style="text-align:right">B</th><th style="text-align:right">overlap</th></tr>
        ${r.feats.map((f) => `<tr><td>${esc(f.name)}</td><td class="num">${f.name === 'RVI' ? f.a.toFixed(2) : f.a.toFixed(0)}</td><td class="num">${f.name === 'RVI' ? f.b.toFixed(2) : f.b.toFixed(0)}</td><td class="num">${Math.round(f.overlap * 100)} %</td></tr>`).join('')}</table>
        <p class="note">${T(`Area B: ${latB.toFixed(3)}°, ${lonB.toFixed(3)}°, ${accB.length} passes${accB.length ? ` (${accB[0].date} – ${accB[accB.length - 1].date})` : ''}.`, `B alanı: ${latB.toFixed(3)}°, ${lonB.toFixed(3)}°, ${accB.length} geçiş${accB.length ? ` (${accB[0].date} – ${accB[accB.length - 1].date})` : ''}.`)}</p>
      </div>
    </div>
    <div id="cmpDims"><p class="muted small" style="margin-top:12px">Comparing land cover, crop mix, climate, soil water and terrain…</p></div>
    <h3 class="small muted" style="font-weight:500;margin-top:12px">Through the year (day of year${shift ? ', B shifted by 6 months' : ''})</h3>
    <div class="chart sm"><canvas id="cmpCurve"></canvas></div>
    <p class="note">${T(`Similarity = how much the distributions of the six features overlap (100 % = identical spread of values). The map colours every ~${Math.round(r.blockM)} m block of A by its distance to B's typical block. Radar brightness comes from 8-bit browse images, which can differ a little between tracks, so levels are compared more loosely than changes. Areas in different hemispheres have opposite seasons: tick "shift B by 6 months" to line up the crop calendars. Similar radar behaviour does not prove the same land use.`, `Benzerlik = altı özelliğin dağılımlarının ne kadar örtüştüğü (%100 = değerlerin aynı yayılımı). Harita, A'nın her ~${Math.round(r.blockM)} m'lik bloğunu B'nin tipik bloğuna uzaklığına göre renklendirir. Radar parlaklığı 8 bitlik görüntülerden gelir ve izler arasında biraz farklı olabilir; bu yüzden seviyeler değişimlerden daha gevşek karşılaştırılır. Farklı yarım kürelerde mevsimler terstir: ürün takvimlerini hizalamak için "B'yi 6 ay kaydır"ı işaretleyin. Benzer radar davranışı aynı arazi kullanımını kanıtlamaz.`)}</p>`;
  const bA = aoiBounds();
  landscapeDims([bA.W, bA.S, bA.E, bA.N], boxB, shift, r).then(showDims).catch(() => { if ($('#cmpDims')) $('#cmpDims').innerHTML = ''; });
  const dist = new Float32Array(r.dist), G = r.G, img = new ImageData(G, G);
  for (let g = 0; g < G * G; g++) {
    const d = dist[g], o = g * 4;
    img.data[o + 3] = 255;
    if (d < 0) { img.data[o] = img.data[o + 1] = img.data[o + 2] = 17; continue; }
    const c = d < 0.7 ? [34, 197, 94] : d < 1.4 ? [234, 179, 8] : [239, 68, 68];
    const k = Math.max(0.45, 1 - Math.min(d, 3) / 6);
    img.data[o] = c[0] * k; img.data[o + 1] = c[1] * k; img.data[o + 2] = c[2] * k;
  }
  const cv = $('#cmpMap'), cx = cv.getContext('2d'), tmp = new OffscreenCanvas(G, G);
  tmp.getContext('2d').putImageData(img, 0, 0); cx.imageSmoothingEnabled = false; cx.drawImage(tmp, 0, 0, cv.width, cv.height);
  chart('cmpCurve', {
    type: 'line',
    data: { datasets: [
      { label: 'A · RVI', data: ptsA('rvi'), borderColor: '#e8b04a', backgroundColor: '#e8b04a', pointRadius: 3, tension: 0.25 },
      { label: 'B · RVI', data: ptsB('rvi'), borderColor: '#3fb8ff', backgroundColor: '#3fb8ff', pointRadius: 3, tension: 0.25 },
      { label: 'A · HV', data: ptsA('hv'), borderColor: 'rgba(232,176,74,0.45)', borderDash: [4, 3], pointRadius: 0, yAxisID: 'y1' },
      { label: 'B · HV', data: ptsB('hv'), borderColor: 'rgba(63,184,255,0.45)', borderDash: [4, 3], pointRadius: 0, yAxisID: 'y1' },
    ] },
    options: { maintainAspectRatio: false, animation: false, parsing: false,
      scales: { x: { type: 'linear', min: 0, max: 365, ticks: { callback: (v) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Math.min(11, Math.floor(v / 30.42))] } },
        y: { title: { display: true, text: 'RVI' } }, y1: { position: 'right', grid: { display: false }, title: { display: true, text: 'HV' } } },
      plugins: { legend: { labels: { boxWidth: 10 } } } },
  });
}

// ---------------------------------------------------------------- structural fingerprint (Brazil archetype library)
let archLib = null;
async function toolFingerprint(el) {
  el.innerHTML = '<div class="empty">Loading the Brazil radar archetype library…</div>';
  archLib = archLib || (await (await fetch(`${app.base}data/archetypes.json`)).json());
  const L = archLib, A = acqs(), ts = times();
  if (S.tab !== 'analysis' || S.tool !== 'fingerprint') return;
  const months = (a, b) => `${new Date(a + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} – ${new Date(b + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`;
  const north = S.site.lat >= 0, ST = L.selftest;
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:900px"><b>Planetary surface fingerprint.</b> Every land use leaves a structural signature in L-band radar: how rough and wet the surface is (HH), how much plant volume stands on it (HV), and how both rise and fall. NISAR passes over well-known Brazilian landscapes form a <b>radar ground-truth library</b>; every ~280 m block of this area is matched to its nearest <b>structural class</b> (annual cropland, semi-perennial crops, open grass / wetland, closed canopy) and to the closest specific Brazilian example. Blocks that WorldCover 2021 called bare or grassland but that now behave like annual cropland are flagged as <b>structural shifts</b>: new fields or new irrigation.</p>
      <div class="controls"><div class="seg" id="fpShow"><button data-s="best" class="on">Structural class</button><button data-s="conf">Confidence</button><button data-s="arch">Closest Brazilian example</button><button data-s="shift">Structural shifts</button></div></div>
      <div class="result">
        <canvas class="map" id="fpMap" width="512" height="512"></canvas>
        <div id="fpOut"><div class="empty">Matching…</div></div>
      </div>
      <p class="note"><b>How reliable is the library?</b> Leave-one-area-out self-test in Brazil (each area matched against a library built without it): structural class right for <b>${Math.round(ST.groups.overall * 100)} %</b> of cells (chance ${Math.round(100 / L.groups.length)} %): ${L.groups.map((g) => `${g.name.split(' (')[0].toLowerCase()} ${Math.round((ST.groups.per[g.id]?.acc || 0) * 100)} %`).join(', ')}; the specific example only ${Math.round(ST.overall * 100)} % (chance ${Math.round(100 / L.archetypes.length)} %), so read it as a hint. Library: ${L.archetypes.reduce((a, x) => a + x.sites.length, 0)} Brazilian areas, only their cells whose ESA WorldCover class fits the land use, NISAR passes ${months(L.window[0], L.window[1])} (public NISAR data over Brazil begins in June 2026). This area: ${A.length} passes, ${months(A[0].date, A[A.length - 1].date)}${north ? ". Northern hemisphere: seasons run about six months apart from Brazil's, so crops can sit in a different phase; a full-year, phase-shifted curve match becomes possible once NISAR has a year over Brazil (mid-2027)" : ''}. Features per block: mean HH, mean HV, their temporal spread, HV range, RVI, HV trend. A match says "behaves like", not "is".</p>
    </div>`;
  const r = await call('fingerprint', { id: S.stack.id, days: ts.map((t) => (t - ts[0]) / DAY), lib: L });
  if (!$('#fpMap')) return;
  if (r.error) { $('#fpOut').innerHTML = `<div class="empty">${esc(r.error)}</div>`; return; }
  const best = new Int16Array(r.best), conf = new Float32Array(r.conf), arch = new Int16Array(r.arch), shift = new Uint8Array(r.shift), G = r.G, K = L.groups.length;
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const gcols = L.groups.map((a) => hex(a.color)), acols = L.archetypes.map((a) => hex(a.color));
  let show = 'best';
  const draw = () => {
    const img = new ImageData(G, G);
    for (let g = 0; g < G * G; g++) {
      const k = best[g], o = g * 4;
      img.data[o + 3] = 255;
      if (k < 0) { img.data[o] = img.data[o + 1] = img.data[o + 2] = 12; continue; }
      if (k === K) { img.data[o] = img.data[o + 1] = img.data[o + 2] = 70; continue; }
      let c = gcols[k];
      if (show === 'conf') c = c.map((x) => x * (0.25 + 0.75 * conf[g]));
      if (show === 'arch') c = arch[g] >= 0 ? acols[arch[g]] : [70, 70, 70];
      if (show === 'shift') c = shift[g] ? [255, 40, 160] : c.map((x) => x * 0.3);
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2];
    }
    const cv = $('#fpMap'), cx = cv.getContext('2d');
    const tmp = new OffscreenCanvas(G, G); tmp.getContext('2d').putImageData(img, 0, 0);
    cx.imageSmoothingEnabled = false; cx.drawImage(tmp, 0, 0, cv.width, cv.height);
  };
  draw();
  $$('#fpShow button').forEach((bt) => bt.addEventListener('click', () => { show = bt.dataset.s; $$('#fpShow button').forEach((x) => x.classList.toggle('on', x === bt)); draw(); }));
  const tot = r.groups.reduce((a, c) => a + c.km2, 0) + r.unlikeKm2;
  const rows = r.groups.map((c, k) => ({ ...c, g: L.groups[k] })).filter((c) => c.km2 > 0).sort((p, q) => q.km2 - p.km2);
  const arows = r.archetypes.map((c, k) => ({ ...c, a: L.archetypes[k] })).filter((c) => c.km2 > 0).sort((p, q) => q.km2 - p.km2);
  $('#fpOut').innerHTML = `
    <div class="stats" style="margin-bottom:10px">
      <div class="stat"><b>${rows[0] ? esc(rows[0].g.name.split(' (')[0]) : '–'}</b><span>${T(`dominant structure (${rows[0] ? Math.round((rows[0].km2 / tot) * 100) : 0} % of area)`, `baskın yapı (alanın %${rows[0] ? Math.round((rows[0].km2 / tot) * 100) : 0}'i)`)}</span></div>
      <div class="stat"><b>${r.worldcover ? `${r.shiftKm2.toFixed(1)} km²` : '–'}</b><span>${T(`structural shift: bare / grass in 2021 → annual cropland now`, `yapısal değişim: 2021'de çıplak / çayır → şimdi tek yıllık tarım`)}</span></div>
    </div>
    <table class="t"><tr><th>Structural class</th><th style="text-align:right">km²</th><th style="text-align:right">share</th><th style="text-align:right">confidence</th></tr>
    ${rows.map((c) => `<tr><td><span class="tag" style="--c:${c.g.color}"><i></i>${esc(c.g.name)}</span></td><td class="num">${c.km2.toFixed(1)}</td><td class="num">${Math.round((c.km2 / tot) * 100)} %</td><td class="num">${Math.round(c.conf * 100)} %</td></tr>`).join('')}
    ${r.unlikeKm2 ? `<tr><td><span class="tag" style="--c:#464646"><i></i>unlike the library</span></td><td class="num">${r.unlikeKm2.toFixed(1)}</td><td class="num">${Math.round((r.unlikeKm2 / tot) * 100)} %</td><td></td></tr>` : ''}</table>
    <h3 class="small muted" style="font-weight:500;margin-top:12px">Closest specific Brazilian example (a hint)</h3>
    <table class="t">${arows.slice(0, 6).map((c) => `<tr><td><span class="tag" style="--c:${c.a.color}"><i></i>${esc(c.a.name)}</span></td><td class="num">${Math.round((c.km2 / tot) * 100)} %</td><td class="num small muted">self-test ${Math.round((ST.per[c.a.id]?.acc || 0) * 100)} %</td></tr>`).join('')}</table>
    <details style="margin-top:8px"><summary class="small muted">Where the archetypes come from</summary>
    <table class="t">${L.archetypes.map((a) => `<tr><td><span class="tag" style="--c:${a.color}"><i></i>${esc(a.name)}</span></td><td class="small">${a.sites.map((x) => `${x.lat.toFixed(2)}, ${x.lon.toFixed(2)} (${x.passes} passes, ${x.cells} cells)`).join(' · ')}</td></tr>`).join('')}</table></details>
    <p class="note">Blocks of ~${Math.round(r.blockM)} m (${r.B}×${r.B} radar pixels). Confidence = how clearly the closest class beats the others.${r.worldcover ? ' Structural shifts need ≥ 60 % bare / shrub / grass in ESA WorldCover 2021 and an annual-cropland match with ≥ 40 % confidence.' : ' WorldCover was not available here, so structural shifts are not computed.'}</p>`;
}

// ---------------------------------------------------------------- mine-tailings spill / mudflow extent
function toolSpill(el) {
  const A = acqs(), opts = A.map((a, i) => `<option value="${i}">${a.date}</option>`).join('');
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:880px">${T(`When a tailings dam fails or a mine spills, mud and water bury the surface: vegetation disappears (L-band HV drops) and smooth wet mud or ponded water turns HH dark. This tool maps that <b>physical spread</b> between two passes and how much farmland it reached. It does <b>not</b> measure contamination: radar cannot see arsenic, lead or cadmium in soil. Use the result to decide where soil and water samples should be taken first.`, `Bir atık barajı yıkıldığında ya da maden atığı döküldüğünde çamur ve su yüzeyi örter: bitki örtüsü kaybolur (L-band HV düşer), düz ıslak çamur ya da göllenen su HH'yi koyulaştırır. Bu araç iki geçiş arasındaki bu <b>fiziksel yayılımı</b> ve ulaştığı tarım alanını haritalar. Kirliliği <b>ölçmez</b>: radar topraktaki arsenik, kurşun ya da kadmiyumu göremez. Sonucu, önce nereden toprak ve su örneği alınacağına karar vermek için kullanın.`)}</p>
      <div class="controls">
        <label>Before <select id="spA">${opts}</select></label>
        <label>After <select id="spB">${opts}</select></label>
        <label>Sensitivity <select id="spK"><option value="2.5">high (2.5σ)</option><option value="3" selected>normal (3σ)</option><option value="4">strict (4σ)</option></select></label>
      </div>
      <div class="result">
        <canvas class="map" id="spMap" width="512" height="512"></canvas>
        <div id="spOut"><div class="empty">Mapping…</div></div>
      </div>
    </div>`;
  // default: the last-but-one pass as 'after', so the last pass can confirm that the change persists
  $('#spA').value = Math.max(0, A.length - 3);
  $('#spB').value = Math.max(1, A.length - 2);
  const b = aoiBounds();
  const run = async () => {
    const a = +$('#spA').value, bb = +$('#spB').value, tok = ++viewToken;
    $('#spOut').innerHTML = '<div class="empty">Mapping…</div>';
    const r = await call('spill', { id: S.stack.id, a, b: bb, k: +$('#spK').value });
    const base = await renderImage(S.stack.id, bb, 'rgb');
    if (tok !== viewToken || !$('#spMap')) return;
    if (r.error) { $('#spOut').innerHTML = `<div class="empty">${esc(r.error)}</div>`; return; }
    const ov = new Uint8ClampedArray(r.data), d = base.data;
    for (let i = 0; i < ov.length; i += 4) if (ov[i + 3]) for (let c = 0; c < 3; c++) d[i + c] = d[i + c] * 0.25 + ov[i + c] * 0.75;
    drawTo($('#spMap'), base);
    const lonOf = (x) => b.W + ((x + 0.5) / SIZE) * (b.E - b.W), latOf = (y) => b.N - ((y + 0.5) / SIZE) * (b.N - b.S);
    $('#spOut').innerHTML = `
      <div class="stats" style="margin-bottom:10px">
        <div class="stat"><b>${r.km2.toFixed(2)} km²</b><span>${T(`changed like a spill (${r.n} patches)`, `dökülme gibi değişen (${r.n} parça)`)}</span></div>
        <div class="stat"><b>${r.worldcover ? `${(r.cropKm2 * 100).toFixed(0)} ha` : '–'}</b><span>${T(`of it on cropland (ESA WorldCover)`, `tarım alanında (ESA WorldCover)`)}</span></div>
      </div>
      <div class="legend" style="margin-bottom:10px"><span><i style="background:#ff781e"></i>vegetation buried / stripped (HV drop)</span><span><i style="background:#28c8ff"></i>dark after: water or wet mud (HH drop)</span><span><i style="background:#ff28a0"></i>on cropland</span></div>
      ${r.byClass.length ? `<table class="t"><tr><th>Land cover reached (WorldCover 2021)</th><th style="text-align:right">km²</th></tr>${r.byClass.map(([c, v]) => `<tr><td>${esc(c)}</td><td class="num">${v.toFixed(2)}</td></tr>`).join('')}</table>` : ''}
      ${r.patches.length ? `<table class="t" style="margin-top:8px"><tr><th>Patch</th><th style="text-align:right">km²</th><th style="text-align:right">cropland ha</th><th style="text-align:right">wet / dark</th><th>Location</th></tr>
      ${r.patches.slice(0, 8).map((p, i) => `<tr><td>${i + 1}</td><td class="num">${p.km2.toFixed(2)}</td><td class="num">${(p.cropKm2 * 100).toFixed(0)}</td><td class="num">${Math.round(p.wet * 100)} %</td><td class="small">${latOf(p.y).toFixed(4)}, ${lonOf(p.x).toFixed(4)}</td></tr>`).join('')}</table>` : '<p class="muted">${T(`Nothing changed like a spill between these passes.`, `Bu geçişler arasında dökülmeye benzer bir değişim yok.`)}</p>'}
      <p class="note">${T(`<b>Filtered out:</b> ${r.drop.single.toFixed(2)} km² changed in HV only (seasonal canopy, harvest), ${r.drop.transient.toFixed(2)} km² came back on the next pass (moisture, temporary water)${r.hasNext ? '' : ' (no later pass yet, so persistence could not be checked)'}, ${r.drop.small.toFixed(2)} km² in patches too small or too weak.`, `<b>Elenen:</b> ${r.drop.single.toFixed(2)} km² yalnızca HV'de değişti (mevsimsel örtü, hasat), ${r.drop.transient.toFixed(2)} km² sonraki geçişte eski haline döndü (nem, geçici su)${r.hasNext ? '' : ' (henüz sonraki geçiş yok, kalıcılık denetlenemedi)'}, ${r.drop.small.toFixed(2)} km² çok küçük ya da zayıf parçalardaydı.`)}</p>
      <p class="note">${T(`Before = mean of ${A[r.before[0]].date}–${A[r.before[1]].date}, after = ${A[bb].date}${r.hasNext ? `, checked on ${A[bb + 1].date}` : ''}. A pixel counts when its change exceeds ${$('#spK').value}σ, σ being the larger of the window's robust spread (HV ${r.sigmaHV.toFixed(1)}, HH ${r.sigmaHH.toFixed(1)} browse units) and the pixel's own pass-to-pass variability before the event, when HV and HH change together (or HH turns water-dark), and when the change persists; patches ≥ 6 radar pixels. Pixels that were water before are left out. New open-pit work, fire and large floods can still pass these tests: check the patches against the Optical view and local reports. Contamination (heavy metals, acidity) needs soil / water samples and laboratory analysis; hyperspectral imagery (EnMAP, PRISMA) can help target them.`, `Önce = ${A[r.before[0]].date}–${A[r.before[1]].date} ortalaması, sonra = ${A[bb].date}${r.hasNext ? `, ${A[bb + 1].date} geçişinde denetlendi` : ''}. Bir piksel şu durumda sayılır: değişimi ${$('#spK').value}σ'yı aşıyorsa (σ, pencerenin dayanıklı yayılımı (HV ${r.sigmaHV.toFixed(1)}, HH ${r.sigmaHH.toFixed(1)} birim) ile pikselin olaydan önceki kendi geçişten geçişe değişkenliğinin büyüğü), HV ve HH birlikte değişiyorsa (ya da HH su gibi koyulaşıyorsa) ve değişim kalıcıysa; parçalar ≥ 6 radar pikseli. Önceden su olan pikseller dışarıda tutulur. Yeni açık ocak çalışması, yangın ve büyük seller bu testleri yine geçebilir: parçaları Optik görünüm ve yerel haberlerle karşılaştırın. Kirlilik (ağır metal, asitlik) için toprak / su örneği ve laboratuvar analizi gerekir; hiperspektral görüntüler (EnMAP, PRISMA) örnek noktalarını seçmeye yardım edebilir.`)}</p>`;
  };
  ['spA', 'spB', 'spK'].forEach((id) => $('#' + id).addEventListener('change', run));
  run();
}

// ---------------------------------------------------------------- glaciers and snow
async function toolGlacier(el) {
  el.innerHTML = '<div class="empty">Loading elevation and finding snow and ice…</div>';
  const b = aoiBounds(), box = [b.W, b.S, b.E, b.N], key = box.join(',');
  if (!terrains.has(key)) terrains.set(key, terrain(box));
  const T = await terrains.get(key).catch(() => null);
  if (S.tab !== 'analysis' || S.tool !== 'glacier') return;
  const A = acqs(), ts = times();
  let t = A.length - 1;
  const run = async () => {
    const r = await call('glacier', { id: S.stack.id, t, elev: T ? T.elev.slice().buffer : null });
    if (!$('#glOut') && !el.isConnected) return;
    if (r.none) {
      el.innerHTML = `<div class="panel"><p class="muted">${T(`No glacier or permanent snow here (${r.iceKm2.toFixed(1)} km² of snow / ice in ESA WorldCover). Draw an area over a glaciated mountain range or an ice sheet margin, for example the Alps, the Karakoram, Patagonia, Alaska or Svalbard.`, `Burada buzul ya da kalıcı kar yok (ESA WorldCover'da ${r.iceKm2.toFixed(1)} km² kar / buz). Buzullu bir dağ silsilesi ya da buz örtüsü kenarı üzerinde alan çizin: örneğin Alpler, Karakurum, Patagonya, Alaska ya da Svalbard.`)}</p></div>`;
      return;
    }
    const peak = r.wetShare.indexOf(Math.max(...r.wetShare));
    const on = r.wetShare.findIndex((w) => w >= 0.3), off = r.wetShare.length - 1 - [...r.wetShare].reverse().findIndex((w) => w >= 0.3);
    if (!$('#glOut')) {
      el.innerHTML = `
        <div class="panel">
          <p class="muted" style="max-width:880px">${T(`Melting snow and ice hold liquid water, which swallows the radar signal: a glacier turns dark in HH when it melts and bright again when it refreezes. Radar sees this through cloud and polar night, pass after pass.`, `Eriyen kar ve buz sıvı su tutar; su radar sinyalini yutar: buzul eriyince HH'de koyulaşır, yeniden donunca parlaklaşır. Radar bunu bulutun ve kutup gecesinin içinden, geçiş geçiş görür.`)}</p>
          <div class="controls"><label>Pass <select id="glT">${A.map((a, i) => `<option value="${i}" ${i === t ? 'selected' : ''}>${a.date}</option>`).join('')}</select></label></div>
          <div class="result"><canvas class="map" id="glMap" width="512" height="512"></canvas><div id="glOut"></div></div>
          <div class="chart sm" style="margin-top:12px"><canvas id="glChart"></canvas></div>
          <p class="note">${T(`Wet = HH more than 2 robust σ (σ = ${r.sigma.toFixed(1)} browse units, the glacier's pass-to-pass spread) below the pixel's own dry reference (its 80th percentile over the passes), after Nagler & Rott (2000). Ice area: ${r.worldcover ? 'ESA WorldCover 2021 snow / ice' : 'pixels above 3,000 m (WorldCover unavailable)'}. Wet-snow line = the highest 100 m band in which at least half of the ice is wet. Fresh dry snow, rough crevasse fields and radar shadow on steep faces can mimic or hide melt; ice speed and thickness change need interferometry (GUNW / GOFF) and are not computed here.`, `Islak = HH, pikselin kendi kuru referansının (geçişler üzerindeki 80. yüzdeliği) 2 dayanıklı σ'dan fazla altında (σ = ${r.sigma.toFixed(1)} birim, buzulun geçişten geçişe yayılımı), Nagler & Rott (2000) yöntemiyle. Buz alanı: ${r.worldcover ? 'ESA WorldCover 2021 kar / buz' : '3.000 m üzerindeki pikseller (WorldCover yok)'}. Islak kar çizgisi = buzun en az yarısının ıslak olduğu en yüksek 100 m'lik bant. Taze kuru kar, pürüzlü yarık alanları ve dik yamaçlardaki radar gölgesi erimeyi taklit edebilir ya da gizleyebilir; buz hızı ve kalınlık değişimi interferometri (GUNW / GOFF) ister ve burada hesaplanmaz.`)}</p>
        </div>`;
      $('#glT').addEventListener('change', () => { t = +$('#glT').value; run(); });
      chart('glChart', {
        type: 'line',
        data: { datasets: [
          { label: 'wet (melting) share of the ice, %', data: ts.map((x, i) => ({ x, y: Math.round(r.wetShare[i] * 100) })), borderColor: '#1e8cff', backgroundColor: 'rgba(30,140,255,0.2)', fill: true, pointRadius: 3, yAxisID: 'y' },
          ...(r.snowLine ? [{ label: 'wet-snow line, m', data: ts.map((x, i) => ({ x, y: r.snowLine[i] })), borderColor: '#e8b04a', pointRadius: 3, spanGaps: true, yAxisID: 'y1' }] : []),
        ] },
        options: { maintainAspectRatio: false, animation: false, parsing: false, scales: { x: timeAxis(), y: { min: 0, max: 100, title: { display: true, text: 'wet %' } }, y1: { position: 'right', grid: { display: false }, title: { display: true, text: 'm' } } }, plugins: { legend: { labels: { boxWidth: 10 } } } },
      });
    }
    drawTo($('#glMap'), new ImageData(new Uint8ClampedArray(r.data), r.w, r.h));
    $('#glOut').innerHTML = `
      <div class="stats" style="margin-bottom:10px">
        <div class="stat"><b>${r.iceKm2.toFixed(1)} km²</b><span>${T(`snow and ice in this area`, `bu alanda kar ve buz`)}</span></div>
        <div class="stat"><b>${Math.round(r.wetShare[t] * 100)} %</b><span>${T(`wet (melting) on ${A[t].date}`, `${A[t].date} tarihinde ıslak (eriyor)`)}</span></div>
        <div class="stat"><b>${r.snowLine?.[t] ? `${r.snowLine[t]} m` : '–'}</b><span>${T(`wet-snow line on that pass`, `o geçişte ıslak kar çizgisi`)}</span></div>
      </div>
      <div class="legend" style="margin-bottom:8px"><span><i style="background:#ebf2fa"></i>dry snow / ice</span><span><i style="background:#1e8cff"></i>wet: melting</span><span><i style="background:#555"></i>not ice</span></div>
      <table class="t">
        <tr><td>Most melt</td><td>${A[peak].date} (${Math.round(r.wetShare[peak] * 100)} % wet)</td></tr>
        <tr><td>Melt season (≥ 30 % wet)</td><td>${on >= 0 ? `${A[on].date} → ${A[off].date}` : 'no pass with ≥ 30 % wet'}</td></tr>
      </table>`;
  };
  if (!S.stack) S.stack = await getStack();
  run();
}

// ---------------------------------------------------------------- landslides
const terrains = new Map();
async function toolLandslide(el) {
  el.innerHTML = '<div class="empty">Loading elevation (slope), the NASA landslide catalog and rainfall since 2001…</div>';
  const b = aoiBounds(), box = [b.W, b.S, b.E, b.N], key = box.join(',');
  if (!terrains.has(key)) terrains.set(key, terrain(box));
  const radius = Math.max(25, ((b.E - b.W) * 111 * Math.cos((S.site.lat * Math.PI) / 180)) / 2 + 15);
  const [T, cat, rain] = await Promise.all([
    terrains.get(key),
    catalogNear(app.base, S.site.lat, S.site.lon, radius).catch(() => ({ events: [] })),
    rainTrigger(S.site.lat, S.site.lon).catch((e) => ({ error: String(e) })),
  ]);
  if (S.tab !== 'analysis' || S.tool !== 'landslide') return;
  const sus = susceptibility(T, cat.events.length);
  const last = rain.obs?.[rain.obs.length - 1];
  const now = last ? hazard(sus.k, last.pct) : null;
  const A = acqs(), def = Math.max(1, Math.min(A.length - 1, A.length - 3));
  el.innerHTML = `
    <div class="panel">
      <h3 style="margin:0 0 6px">Hazard: now and the next 7 days</h3>
      <p class="muted" style="max-width:880px">${T(`Rain-triggered landslide hazard in the spirit of NASA's LHASA model: susceptible terrain (steep slopes, past landslides) combined with heavy recent rainfall compared with this place's own record. It says when conditions favour landslides, not where one will happen.`, `NASA'nın LHASA modelindeki yaklaşımla yağışa bağlı heyelan tehlikesi: yatkın arazi (dik yamaçlar, geçmiş heyelanlar) ile bu yerin kendi kaydına göre yoğun son yağışın birleşimi. Koşulların ne zaman heyelana elverişli olduğunu söyler, nerede heyelan olacağını değil.`)}</p>
      <div class="stats" style="margin:10px 0">
        <div class="stat"><b>${sus.label}</b><span>${T(`terrain susceptibility · slope p90 ${T.p90.toFixed(0)}°, ${Math.round(T.steepFrac * 100)} % of area ≥ 15°`, `arazi yatkınlığı · eğim p90 ${T.p90.toFixed(0)}°, alanın %${Math.round(T.steepFrac * 100)}'i ≥ 15°`)}</span></div>
        <div class="stat"><b>${cat.events.length}</b><span>${T(`catalogued landslides within ${Math.round(radius)} km (1988–2017)`, `${Math.round(radius)} km içinde kayıtlı heyelan (1988–2017)`)}</span></div>
        ${last ? `<div class="stat"><b>${Math.round(last.pct * 100)}th</b><span>${T(`percentile of 7-day rain index on ${last.date}`, `${last.date} tarihinde 7 günlük yağış indeksinin yüzdeliği`)}</span></div>
        <div class="stat"><b style="color:${HAZARD_COLORS[now.k]}">${now.label}</b><span>${T(`hazard on ${last.date}`, `${last.date} tarihinde tehlike`)}</span></div>` : `<div class="stat"><b>–</b><span>${T(`rainfall unavailable${rain.error ? `: ${esc(rain.error)}` : ''}`, `yağış verisi yok${rain.error ? `: ${esc(rain.error)}` : ''}`)}</span></div>`}
      </div>
      ${rain.fc?.length ? `<div class="ls-days">${rain.fc.map((d) => { const h = hazard(sus.k, d.pct); return `<div style="--c:${HAZARD_COLORS[h.k]}"><b>${new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</b><span>${h.label}</span><small>${d.rain.toFixed(0)} mm · ${Math.round(d.pct * 100)}th pct</small></div>`; }).join('')}</div>` : ''}
      ${rain.obs ? '<div class="chart sm" style="margin-top:10px"><canvas id="lsRain"></canvas></div>' : ''}
      <p class="note">${T(`7-day antecedent rainfall index (weights 1/(k+1)², as LHASA 1.0) against its 90th / 95th / 99th percentiles over ${rain.years || '–'} years at this point. Hazard table: rain above the 90th / 95th / 99th percentile gives moderate / high / very high on high-susceptibility terrain, one level lower on moderate terrain, two lower on low terrain, nothing on flat ground. ${esc(rain.source || '')}. Slope from Terrarium elevation tiles (zoom ${T.zoom}, ~${Math.round(T.pxM)} m grid). Not an official warning: check the national geological survey or civil protection agency.`, `7 günlük öncül yağış indeksi (ağırlıklar 1/(k+1)², LHASA 1.0'daki gibi), bu noktada ${rain.years || '–'} yıllık kayıttaki 90. / 95. / 99. yüzdelikleriyle karşılaştırılır. Tehlike tablosu: yüksek yatkınlıklı arazide 90. / 95. / 99. yüzdeliğin üstündeki yağış orta / yüksek / çok yüksek tehlike verir; orta arazide bir, düşük arazide iki seviye aşağı; düz arazide hiçbir şey. ${esc(rain.source || '')}. Eğim Terrarium yükseklik karolarından (yakınlık ${T.zoom}, ~${Math.round(T.pxM)} m ızgara). Resmi uyarı değildir: ulusal jeoloji kurumunu ya da AFAD'ı takip edin.`)}</p>

      <h3 style="margin:18px 0 6px">Detection with NISAR</h3>
      <p class="muted" style="max-width:880px">${T(`A landslide strips vegetation and exposes soil and rock: L-band HV (volume scattering from plants) drops sharply on a steep slope and stays low. Candidates are pixels on slopes ≥ 15° whose HV fell more than 2.5× the change seen on flat ground (where no landslide can happen) between the passes before and after the chosen date, and stayed low afterwards.`, `Heyelan bitki örtüsünü söker, toprağı ve kayayı açığa çıkarır: L-band HV (bitkilerden hacim saçılımı) dik yamaçta keskin biçimde düşer ve düşük kalır. Adaylar: eğimi ≥ 15° olan, HV'si seçili tarihten önceki ve sonraki geçişler arasında düz arazide (heyelan olamayacak yerde) görülen değişimin 2,5 katından fazla düşen ve sonra da düşük kalan pikseller.`)}</p>
      <div class="controls">
        <label>Event between the passes before and <select id="lsT">${A.map((a, i) => `<option value="${i}" ${i === def ? 'selected' : ''} ${i === 0 ? 'disabled' : ''}>${a.date}</option>`).join('')}</select></label>
        <label>Min. slope <select id="lsSlope"><option>10</option><option selected>15</option><option>20</option><option>25</option></select>°</label>
        <label>Sensitivity <select id="lsK"><option value="2">high (2σ)</option><option value="2.5" selected>normal (2.5σ)</option><option value="3">strict (3σ)</option></select></label>
      </div>
      <div class="result">
        <canvas class="map" id="lsMap" width="512" height="512"></canvas>
        <div id="lsOut"><div class="empty">Detecting…</div></div>
      </div>
      ${cat.events.length ? `<h3 class="small muted" style="font-weight:500;margin-top:14px">Landslides reported nearby (NASA Global Landslide Catalog)</h3>
      <table class="t"><tr><th>Date</th><th>Where</th><th>Type</th><th>Trigger</th><th>Size</th><th style="text-align:right">Deaths</th><th style="text-align:right">km</th></tr>
      ${cat.events.slice(0, 12).map((e) => `<tr><td>${e.date}</td><td class="small">${esc(e.title)}</td><td>${esc(e.category)}</td><td>${esc(e.trigger)}</td><td>${esc(e.size)}</td><td class="num">${e.fatalities ?? '–'}</td><td class="num">${e.km.toFixed(0)}</td></tr>`).join('')}</table>
      <p class="note">${T(`${esc(cat.source || '')}. The catalog ends in 2017 and NISAR began in 2025, so these events show where slopes have failed before, not a validation of this year's detections.`, `${esc(cat.source || '')}. Katalog 2017'de bitiyor, NISAR 2025'te başladı; bu olaylar yamaçların daha önce nerede kaydığını gösterir, bu yılın tespitlerinin doğrulaması değildir.`)}</p>` : ''}
    </div>`;
  if (rain.obs) {
    const pts = [...rain.obs, ...(rain.fc || []).filter((d) => d.forecast)];
    const tt = (d) => Date.parse(d + 'T12:00:00Z');
    const line = (v, label, c) => ({ label, data: [{ x: tt(pts[0].date), y: v }, { x: tt(pts[pts.length - 1].date), y: v }], borderColor: c, borderDash: [4, 4], pointRadius: 0, borderWidth: 1 });
    chart('lsRain', {
      data: { datasets: [
        { type: 'bar', label: 'Daily rain, mm', data: pts.map((d) => ({ x: tt(d.date), y: d.rain })), backgroundColor: pts.map((d) => (d.forecast ? 'rgba(63,184,255,0.3)' : 'rgba(63,184,255,0.7)')), yAxisID: 'y' },
        { type: 'line', label: '7-day rain index', data: pts.map((d) => ({ x: tt(d.date), y: d.ari })), borderColor: '#e8b04a', pointRadius: 0, borderWidth: 2, yAxisID: 'y' },
        { type: 'line', ...line(rain.p90, '90th pct', '#e8b04a') }, { type: 'line', ...line(rain.p95, '95th pct', '#f97316') }, { type: 'line', ...line(rain.p99, '99th pct', '#ef4444') },
      ] },
      options: { maintainAspectRatio: false, animation: false, parsing: false, scales: { x: { ...timeAxis(), min: tt(pts[0].date) - 864e5, max: tt(pts[pts.length - 1].date) + 864e5 }, y: { beginAtZero: true, title: { display: true, text: 'mm' } } }, plugins: { legend: { labels: { boxWidth: 10 } } } },
    });
  }
  const run = async () => {
    const t = +$('#lsT').value, tok = ++viewToken;
    $('#lsOut').innerHTML = '<div class="empty">Detecting…</div>';
    const r = await call('landslide', { id: S.stack.id, t, slope: T.slope.slice().buffer, minSlope: +$('#lsSlope').value, k: +$('#lsK').value });
    const base = await renderImage(S.stack.id, t, 'rgb');
    if (tok !== viewToken || !$('#lsMap')) return;
    if (r.error) { $('#lsOut').innerHTML = `<div class="empty">${esc(r.error)}</div>`; return; }
    const ov = new Uint8ClampedArray(r.data), d = base.data;
    for (let i = 0; i < ov.length; i += 4) {
      const a = ov[i + 3] / 255;
      if (!a) continue;
      for (let c = 0; c < 3; c++) d[i + c] = d[i + c] * (1 - a) + ov[i + c] * a;
    }
    drawTo($('#lsMap'), base);
    const lonOf = (x) => b.W + ((x + 0.5) / SIZE) * (b.E - b.W), latOf = (y) => b.N - ((y + 0.5) / SIZE) * (b.N - b.S);
    $('#lsOut').innerHTML = `
      <div class="stats" style="margin-bottom:10px">
        <div class="stat"><b>${r.n}</b><span>${T(`candidate patches`, `aday parça`)}</span></div>
        <div class="stat"><b>${r.km2.toFixed(2)} km²</b><span>${T(`of ${r.steepKm2.toFixed(0)} km² steep ground`, `${r.steepKm2.toFixed(0)} km² dik arazi içinde`)}</span></div>
      </div>
      <div class="legend" style="margin-bottom:10px"><span><i style="background:#ff3c28"></i>HV drop (vegetation lost)</span><span><i style="background:#ffd60a"></i>HV drop + HH change (new bare surface)</span><span><i style="background:rgba(255,255,255,0.3)"></i>slope ≥ ${$('#lsSlope').value}°</span></div>
      ${r.patches.length ? `<table class="t"><tr><th>Patch</th><th style="text-align:right">km²</th><th style="text-align:right">slope</th><th style="text-align:right">HV drop</th><th>Location</th></tr>
      ${r.patches.slice(0, 10).map((p, i) => `<tr><td>${i + 1}</td><td class="num">${p.km2.toFixed(3)}</td><td class="num">${p.slope.toFixed(0)}°</td><td class="num">${(-p.z).toFixed(1)}σ</td><td class="small">${latOf(p.y).toFixed(4)}, ${lonOf(p.x).toFixed(4)}</td></tr>`).join('')}</table>` : '<p class="muted">${T(`No candidate on steep ground between these passes.`, `Bu geçişler arasında dik arazide aday yok.`)}</p>'}
      <p class="note">${T(`Before = passes ${A[r.before[0]].date}–${A[r.before[1]].date}, after = ${A[r.after[0]].date}–${A[r.after[1]].date}${r.persist ? ', checked against the later passes' : ' (no later passes to check persistence)'}; noise σ = ${r.sigma.toFixed(1)} browse units from ${r.noiseFrom}. Background: the radar colour image (HH/HV) of the chosen date. Candidates also come from logging, fire, harvest of terrace fields or snow; check them against optical images (Optical view) before calling them landslides. Steep slopes facing away from the radar can be in shadow, and slopes facing it are compressed (layover): browse pixels there are less reliable.`, `Önce = ${A[r.before[0]].date}–${A[r.before[1]].date} geçişleri, sonra = ${A[r.after[0]].date}–${A[r.after[1]].date}${r.persist ? ', sonraki geçişlerle denetlendi' : ' (kalıcılığı denetleyecek sonraki geçiş yok)'}; gürültü σ = ${r.sigma.toFixed(1)} birim, kaynak: ${r.noiseFrom}. Arka plan: seçili tarihin radar renk görüntüsü (HH/HV). Adaylar ağaç kesimi, yangın, teras tarlası hasadı ya da kardan da gelebilir; heyelan demeden önce optik görüntüyle (Optik görünüm) karşılaştırın. Radara sırtını dönen dik yamaçlar gölgede kalabilir, radara bakanlar sıkışır (layover): oradaki pikseller daha az güvenilirdir.`)}</p>`;
  };
  ['lsT', 'lsSlope', 'lsK'].forEach((id) => $('#' + id).addEventListener('change', run));
  run();
}

// ---------------------------------------------------------------- crop suggestions (GAEZ suitability vs SPAM)
const SPAM_GROUP_NAME = { VEGE: 'Vegetables', OCER: 'Other cereals', OPUL: 'Other pulses', TROF: 'Fruit', REST: 'Other crops', RICE: 'Rice' };
const pctTxt = (x) => `${x > 0 ? '+' : ''}${Math.round(x * 100)} %`;
async function agSuggest(el) {
  el.innerHTML = '<div class="empty">Reading FAO GAEZ suitability, the SPAM crop mix and ERA5-Land soil moisture for this area…</div>';
  const b = aoiBounds(), box = [b.W, b.S, b.E, b.N];
  const [suit, mix, soil] = await Promise.all([
    suitability(app.base, box),
    cropMix(app.base, box).catch(() => ({ list: [], totalHa: 0 })),
    era5Soil(S.site.lat, S.site.lon).catch(() => null),
  ]);
  if (S.tab !== 'agri' || S.agTool !== 'suggest') return;
  if (!suit.cells) { el.innerHTML = '<div class="empty">GAEZ rates no crop here (no current cropland in these cells, or outside the land mask).</div>'; return; }
  const share = Object.fromEntries(mix.list.map((c) => [c.code, c.share]));
  const rows = suit.list.filter((c) => !ENERGY.has(c.code)).map((c) => {
    const sp = GAEZ_TO_SPAM[c.code];
    const sh = sp ? sp.reduce((a, k) => a + (share[k] || 0), 0) : null;
    const best = Math.max(c.rain ?? 0, c.irr ?? 0);
    return { ...c, share: sh, best, irrGain: c.irr != null ? c.irr - (c.rain ?? 0) : 0 };
  });
  // crops sharing one SPAM class (carrot, cabbage, onion, tomato -> vegetables) are one row: the best-rated of them
  const grownBy = new Map();
  for (const r of rows.filter((x) => x.share >= 0.02 && x.best >= 25)) {
    const k = (GAEZ_TO_SPAM[r.code] || []).join('+');
    const o = grownBy.get(k);
    if (!o) grownBy.set(k, { ...r, members: [r.name] });
    else { o.members.push(r.name); if (r.best > o.best) Object.assign(o, { ...r, members: o.members }); }
  }
  const grown = [...grownBy.values()].map((r) => (r.members.length > 1 ? { ...r, name: `${SPAM_GROUP_NAME[(GAEZ_TO_SPAM[r.code] || [])[0]] || 'Group'} (best rated: ${r.name}; also ${r.members.filter((m) => m !== r.name).join(', ')})` } : r))
    .sort((p, q) => q.share - p.share);
  const options = rows.filter((r) => !(r.share >= 0.02) && r.best >= 40).sort((p, q) => q.best - p.best).slice(0, 12);
  const misfit = rows.filter((r) => r.share >= 0.05 && r.best < 25);
  const now = Date.now();
  const root = soil ? windowAnomaly(soil, 2, now - 36 * DAY, now) : null;
  const surf = soil ? windowAnomaly(soil, 0, now - 20 * DAY, now) : null;
  const water = (r) => (r.irrGain >= 20 ? '<span class="muted">needs irrigation</span>' : r.rain >= 40 ? 'rain-fed OK' : r.irr != null ? '<span class="muted">irrigation helps</span>' : '');
  const row = (r, extra) => `<tr><td>${esc(r.name)}</td><td>${suitClass(r.rain)} <span class="muted">(${Math.round(r.rain ?? 0)})</span></td><td>${r.irr != null ? `${suitClass(r.irr)} <span class="muted">(${Math.round(r.irr)})</span>` : '–'}</td><td>${water(r)}</td>${extra(r)}</tr>`;
  const head = (last) => `<tr><th>Crop</th><th>Rain-fed</th><th>Irrigated</th><th>Water</th><th>${last}</th></tr>`;
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:880px">${T(`Which crops the climate, soil and terrain of this area <b>could</b> support (FAO GAEZ v4 suitability on today's cropland) set against the crops that <b>are</b> grown here (SPAM). Crops that are suitable but not grown are options to consider; crops that are grown but rated poorly depend on irrigation or are under stress.`, `Bu alanın iklimi, toprağı ve arazisinin hangi ürünleri <b>destekleyebileceği</b> (bugünkü tarım alanında FAO GAEZ v4 uygunluğu) ve burada hangi ürünlerin <b>ekildiği</b> (SPAM) karşılaştırılır. Uygun ama ekilmeyen ürünler değerlendirilecek seçeneklerdir; ekilen ama düşük puan alan ürünler sulamaya bağlıdır ya da stres altındadır.`)}</p>
      ${root ? `<div class="stats" style="margin:10px 0">
        <div class="stat"><b>${pctTxt(surf.pct)}</b><span>${T(`topsoil 0–7 cm vs normal (last 3 weeks)`, `üst toprak 0–7 cm, normale göre (son 3 hafta)`)}</span></div>
        <div class="stat"><b>${pctTxt(root.pct)}</b><span>${T(`root zone 28–100 cm vs normal (last 5 weeks)`, `kök bölgesi 28–100 cm, normale göre (son 5 hafta)`)}</span></div>
        <div class="stat"><b>${root.mean.toFixed(2)}</b><span>${T(`root-zone water, m³/m³ (normal ${root.normal.toFixed(2)})`, `kök bölgesi suyu, m³/m³ (normal ${root.normal.toFixed(2)})`)}</span></div></div>` : ''}
      <div class="chart" style="height:440px"><canvas id="sgBar"></canvas></div>
      <h3 class="small muted" style="font-weight:500;margin-top:14px">Options: suitable here but not grown in this area</h3>
      ${options.length ? `<table class="t">${head('Grown now')}${options.map((r) => row(r, (x) => `<td>${x.share == null ? '–' : x.share > 0 ? '< 2 %' : 'no'}</td>`)).join('')}</table>` : '<p class="muted">${T(`No crop rated medium or better that is not already grown.`, `Orta ya da daha iyi puan alıp henüz ekilmeyen ürün yok.`)}</p>'}
      <h3 class="small muted" style="font-weight:500;margin-top:14px">Grown here now (SPAM) and how suitable they are</h3>
      ${grown.length ? `<table class="t">${head('Share of crop area')}${grown.map((r) => row(r, (x) => `<td class="num">${Math.round(x.share * 100)} %</td>`)).join('')}</table>` : '<p class="muted">No SPAM crop data for this area.</p>'}
      ${misfit.length ? `<p class="note">${T(`<b>Grown but rated below "moderate":</b> ${misfit.map((r) => esc(r.name)).join(', ')}, which probably depends on irrigation beyond GAEZ's assumptions, a microclimate, or is at risk in dry years.`, `<b>Ekiliyor ama "vasat"ın altında puan alıyor:</b> ${misfit.map((r) => esc(r.name)).join(', ')}; muhtemelen GAEZ varsayımlarının ötesinde sulamaya, bir mikroklimaya bağlı ya da kurak yıllarda risk altında.`)}</p>` : ''}
      ${root && root.pct < -0.15 ? `<p class="note">${T(`The root zone is ${Math.round(-root.pct * 100)} % drier than normal for the time of year, so rain-fed options carry more risk this season; crops marked "needs irrigation" are not realistic without water.`, `Kök bölgesi mevsim normalinden %${Math.round(-root.pct * 100)} daha kuru; yağmura bağlı seçenekler bu sezon daha riskli, "sulama gerekir" diye işaretli ürünler susuz gerçekçi değil.`)}</p>` : ''}
      <p class="note">${T(`Suitability: ${esc(suit.source)} (${esc(suit.license)}); index 0–100, classes as in GAEZ (≥85 very high, ≥70 high, ≥55 good, ≥40 medium, ≥25 moderate, ≥10 marginal). Mean over ${suit.cells} cell(s) of 0.25° (~28 km): it describes the area, not one parcel, and knows nothing about the field's own soil, water rights, markets or prices. Crops grown: ${esc(mix.source || 'SPAM 2010')}. Soil moisture: ERA5-Land via Open-Meteo, normal = 2019–now mean for the same days of the year. Energy grasses (miscanthus, switchgrass…) are left out.`, `Uygunluk: ${esc(suit.source)} (${esc(suit.license)}); indeks 0–100, GAEZ sınıfları (≥85 çok yüksek, ≥70 yüksek, ≥55 iyi, ≥40 orta, ≥25 vasat, ≥10 sınırda). 0,25°'lik (~28 km) ${suit.cells} hücrenin ortalaması: tek bir parseli değil alanı anlatır; tarlanın kendi toprağını, su haklarını, pazarı ya da fiyatları bilmez. Ekilen ürünler: ${esc(mix.source || 'SPAM 2010')}. Toprak nemi: Open-Meteo üzerinden ERA5-Land, normal = yılın aynı günlerinin 2019–bugün ortalaması. Enerji bitkileri (miskantus, darıotu…) dışarıda tutuldu.`)}</p>
    </div>`;
  const top = rows.slice(0, 16);
  chart('sgBar', {
    type: 'bar',
    data: { labels: top.map((r) => r.name), datasets: [
      { label: 'Rain-fed', data: top.map((r) => r.rain ?? 0), backgroundColor: '#44e07a' },
      { label: 'Irrigated', data: top.map((r) => r.irr ?? 0), backgroundColor: '#3fb8ff' },
    ] },
    options: { indexAxis: 'y', maintainAspectRatio: false, animation: false,
      scales: { x: { min: 0, max: 100, title: { display: true, text: 'GAEZ suitability index (0–100)' } }, y: { ticks: { autoSkip: false } } },
      plugins: { legend: { labels: { boxWidth: 10 } }, tooltip: { callbacks: { afterLabel: (c) => suitClass(c.raw) } } } },
  });
}

// ---------------------------------------------------------------- drought
async function agDrought(el) {
  el.innerHTML = '<div class="empty">Reading 25 years of rainfall and temperature (NASA POWER) and soil moisture (ERA5-Land)…</div>';
  if (!S.stack) S.stack = await getStack();
  const [D, wet] = await Promise.all([
    droughtData(S.site.lat, S.site.lon).catch((e) => ({ error: String(e.message || e) })),
    call('wetness', { id: S.stack.id }).catch(() => ({ sm: [] })),
  ]);
  if (S.tab !== 'agri' || S.agTool !== 'drought') return;
  if (D.error) { el.innerHTML = `<div class="empty">${T(`Could not load the records`, `Kayıtlar yüklenemedi`)}: ${esc(D.error)}</div>`; return; }
  const last = D.series[D.series.length - 1], soilNow = D.soil?.now;
  const parts = [last.p90, soilNow?.p].filter((v) => v != null);
  const blend = parts.reduce((a, b) => a + b, 0) / parts.length, cls = dClass(blend);
  const sm = wet.sm.filter((v) => v != null), wetNow = sm.length ? sm[sm.length - 1] : null;
  const pctLabel = (p) => T(`${Math.round(p * 100)}th percentile`, `${Math.round(p * 100)}. yüzdelik`);
  const spi = (p) => { const v = probit(p); return Math.abs(v) < 0.05 ? '0.0' : v.toFixed(1); };
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:880px">${T(`Is this area drier than it usually is at this time of year? Each number compares now with the same weeks in every year on record. A low percentile means few years were as dry.`, `Bu alan yılın bu zamanına göre her zamankinden daha kuru mu? Her sayı şimdiyi, kayıttaki her yılın aynı haftalarıyla karşılaştırır. Düşük yüzdelik, çok az yılın bu kadar kuru olduğu anlamına gelir.`)}</p>
      <div class="stats" style="margin:10px 0">
        <div class="stat"><b style="color:${cls.color}">${esc(cls.label)}</b><span>${T(`drought level now (rain 90 days + root-zone soil)`, `şu anki kuraklık seviyesi (90 günlük yağış + kök bölgesi)`)}</span></div>
        <div class="stat"><b>${pctLabel(last.p90)}</b><span>${T(`rain of the last 90 days (${Math.round(last.r90)} mm, SPI ${spi(last.p90)})`, `son 90 günün yağışı (${Math.round(last.r90)} mm, SPI ${spi(last.p90)})`)}</span></div>
        <div class="stat"><b>${soilNow ? pctLabel(soilNow.p) : '–'}</b><span>${T(`root-zone soil moisture, 28–100 cm${soilNow ? ` (${soilNow.v.toFixed(2)} m³/m³)` : D.soil?.error ? `: ${esc(D.soil.error)}` : ''}`, `kök bölgesi toprak nemi, 28–100 cm${soilNow ? ` (${soilNow.v.toFixed(2)} m³/m³)` : D.soil?.error ? `: ${esc(D.soil.error)}` : ''}`)}</span></div>
        <div class="stat"><b>${D.heat.now != null ? `${(D.heat.now - D.heat.normal >= 0 ? '+' : '')}${(D.heat.now - D.heat.normal).toFixed(1)} °C` : '–'}</b><span>${T(`last 30 days vs normal temperature`, `son 30 gün, normal sıcaklığa göre`)}</span></div>
      </div>
      <table class="t"><tr><th>Window</th><th style="text-align:right">rain, mm</th><th style="text-align:right">${T('percentile', 'yüzdelik')}</th><th style="text-align:right">SPI</th><th>level</th></tr>
      ${[30, 90, 180].map((n) => { const c = dClass(last[`p${n}`]); return `<tr><td>${T(`last ${n} days`, `son ${n} gün`)}</td><td class="num">${Math.round(last[`r${n}`])}</td><td class="num">${Math.round(last[`p${n}`] * 100)}</td><td class="num">${spi(last[`p${n}`])}</td><td><span class="tag" style="--c:${c.color}"><i></i>${esc(c.label)}</span></td></tr>`; }).join('')}</table>
      <div class="chart" style="height:280px;margin-top:12px"><canvas id="drChart"></canvas></div>
      ${wetNow != null ? `<p class="note">${T(`<b>NISAR:</b> on the latest pass the bare soil of this area was at ${Math.round(wetNow * 100)} % of its own wet–dry range (0 % = driest pass seen, 100 % = wettest). It is a relative radar measure of the top few centimetres.`, `<b>NISAR:</b> son geçişte bu alanın çıplak toprağı kendi ıslak–kuru aralığının %${Math.round(wetNow * 100)} seviyesindeydi (%0 = görülen en kuru geçiş, %100 = en ıslak). Üstteki birkaç santimetrenin göreli bir radar ölçüsüdür.`)}</p>` : ''}
      <p class="note">${T(`Levels follow the US Drought Monitor percentiles: D0 ≤ 30th, D1 ≤ 20th, D2 ≤ 10th, D3 ≤ 5th, D4 ≤ 2nd. SPI = the percentile expressed as standard deviations (−1 moderately dry, −1.5 severely, −2 extremely). Rain percentiles compare the same calendar window (± 5 days) in ${D.years} years; soil moisture in ${D.soil?.years || '–'} years. ${esc(D.source)}. Area-wide values (~10–50 km grids): an irrigated field can be green in a drought.`, `Seviyeler ABD Kuraklık İzleyicisi yüzdeliklerini izler: D0 ≤ 30., D1 ≤ 20., D2 ≤ 10., D3 ≤ 5., D4 ≤ 2. SPI = yüzdeliğin standart sapma cinsinden ifadesi (−1 orta derecede kuru, −1,5 şiddetli, −2 aşırı). Yağış yüzdelikleri aynı takvim penceresini (± 5 gün) ${D.years} yılda, toprak nemi ${D.soil?.years || '–'} yılda karşılaştırır. ${esc(D.source)}. Alan geneli değerler (~10–50 km ızgaralar): sulanan bir tarla kuraklıkta yeşil kalabilir.`)}</p>
    </div>`;
  const tt = (d) => Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T12:00:00Z`);
  const xs = D.series.map((o) => tt(o.date)), x0 = xs[0], x1 = xs[xs.length - 1];
  const band = (lo, hi, c) => ({ label: '', data: [{ x: x0, y: hi }, { x: x1, y: hi }], fill: { target: { value: lo } }, backgroundColor: c, borderWidth: 0, pointRadius: 0 });
  chart('drChart', {
    type: 'line',
    data: { datasets: [
      { label: 'rain, 90 days', data: D.series.map((o, i) => ({ x: xs[i], y: o.p90 * 100 })), borderColor: '#3fb8ff', pointRadius: 0, borderWidth: 2 },
      { label: 'rain, 30 days', data: D.series.map((o, i) => ({ x: xs[i], y: o.p30 * 100 })), borderColor: 'rgba(63,184,255,0.45)', pointRadius: 0, borderWidth: 1 },
      ...(D.soil?.pts ? [{ label: 'root-zone soil moisture', data: D.soil.pts.map((p) => ({ x: p.t, y: p.p * 100 })), borderColor: '#a3e635', pointRadius: 0, borderWidth: 2 }] : []),
      band(0, 2, 'rgba(127,29,29,0.35)'), band(2, 5, 'rgba(220,38,38,0.25)'), band(5, 10, 'rgba(249,115,22,0.2)'), band(10, 20, 'rgba(246,183,60,0.16)'), band(20, 30, 'rgba(253,230,138,0.12)'),
    ] },
    options: { maintainAspectRatio: false, animation: false, parsing: false,
      scales: { x: { ...timeAxis(), min: x0, max: x1 }, y: { min: 0, max: 100, title: { display: true, text: 'percentile (low = dry)' } } },
      plugins: { legend: { labels: { boxWidth: 10, filter: (l) => l.text } } } },
  });
}

// ---------------------------------------------------------------- soil moisture
async function agMoisture(el) {
  el.innerHTML = '<div class="empty">Fetching ERA5-Land soil moisture (4 layers), NASA POWER soil wetness and computing NISAR surface wetness…</div>';
  if (!S.stack) S.stack = await getStack();
  const [soil, pw, wet] = await Promise.all([
    era5Soil(S.site.lat, S.site.lon).catch((e) => ({ error: String(e) })),
    powerWetness(S.site.lat, S.site.lon).catch(() => null),
    call('wetness', { id: S.stack.id }).catch(() => ({ sm: [], px: 0 })),
  ]);
  if (S.tab !== 'agri' || S.agTool !== 'moisture') return;
  if (soil.error) { el.innerHTML = `<div class="empty">${T(`Could not load ERA5-Land`, `ERA5-Land yüklenemedi`)}: ${esc(soil.error)}</div>`; return; }
  const ts = times();
  const t0 = Math.min(ts[0], Date.now() - 200 * DAY) - 30 * DAY;
  const tOfD = (d) => Date.parse(d + 'T12:00:00Z');
  const idx = soil.dates.map((d, i) => [tOfD(d), i]).filter(([t]) => t >= t0);
  const now = Date.now();
  const anoms = ERA5_LAYERS.map((_, k) => windowAnomaly(soil, k, now - 20 * DAY, now));
  // NISAR wetness vs ERA5 0-7 cm on the pass dates
  const surfAt = (t) => { const d = new Date(t).toISOString().slice(0, 10); const i = soil.dates.indexOf(d); return i >= 0 ? soil.layers[0].values[i] : null; };
  const pairs = wet.sm.map((v, i) => [v, surfAt(ts[i])]).filter(([a, b2]) => a != null && b2 != null);
  const r = pearson(pairs);
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:880px">${T(`Soil water in four depths from the ERA5-Land reanalysis (~9 km), its normal for the time of year, and a relative surface-wetness index measured by NISAR itself in the low-vegetation pixels of this area.`, `ERA5-Land yeniden analizinden (~9 km) dört derinlikte toprak suyu, yılın bu zamanı için normali ve bu alanın az bitkili piksellerinde doğrudan NISAR'la ölçülen göreli yüzey ıslaklığı indeksi.`)}</p>
      <table class="t" style="margin:8px 0"><tr><th>Layer</th><th style="text-align:right">last 3 weeks, m³/m³</th><th style="text-align:right">normal</th><th style="text-align:right">vs normal</th></tr>
      ${ERA5_LAYERS.map(([, label, color], k) => (anoms[k] ? `<tr><td><span class="tag" style="--c:${color}"><i></i>${label}</span></td><td class="num">${anoms[k].mean.toFixed(3)}</td><td class="num">${anoms[k].normal.toFixed(3)}</td><td class="num">${pctTxt(anoms[k].pct)}</td></tr>` : '')).join('')}</table>
      <div class="chart lg"><canvas id="smEra"></canvas></div>
      <h3 class="small muted" style="font-weight:500;margin-top:14px">NISAR relative surface wetness vs ERA5-Land topsoil</h3>
      ${wet.sm.length ? `<div class="chart sm"><canvas id="smSar"></canvas></div>
      <p class="note">${T(`${wet.px} low-vegetation radar pixels (${Math.round(wet.km2 || 0)} km²); only passes on which a pixel is bare (low HV) count; per pixel 0 = its driest bare pass, 1 = its wettest (change detection on HH, Wagner et al. 1999); a gap = too few bare pixels that day. ${pairs.length >= 5 ? `Correlation with ERA5-Land 0–7 cm on the ${pairs.length} pass dates: <b>r = ${r.toFixed(2)}</b>${r < 0.3 ? ' (weak: vegetation growth, tillage or the different footprint dominate here)' : ''}.` : ''} It is relative and needs bare or low vegetation; under a closed canopy L-band HH follows the plants, not the soil.`, `${wet.px} az bitkili radar pikseli (${Math.round(wet.km2 || 0)} km²); yalnızca pikselin çıplak olduğu (düşük HV) geçişler sayılır; her piksel için 0 = en kuru çıplak geçişi, 1 = en ıslağı (HH üzerinde değişim tespiti, Wagner ve ark. 1999); boşluk = o gün çok az çıplak piksel. ${pairs.length >= 5 ? `${pairs.length} geçiş tarihinde ERA5-Land 0–7 cm ile korelasyon: <b>r = ${r.toFixed(2)}</b>${r < 0.3 ? ' (zayıf: burada bitki büyümesi, toprak işleme ya da farklı ölçek baskın)' : ''}.` : ''} Göreli bir ölçüdür ve çıplak ya da az bitkili zemin ister; kapalı örtü altında L-band HH toprağı değil bitkileri izler.`)}</p>`
      : `<p class="muted">${T(`Not enough passes or low-vegetation pixels (${wet.px}) for the radar index.`, `Radar indeksi için yeterli geçiş ya da az bitkili piksel yok (${wet.px}).`)}</p>`}
      ${pw ? `<h3 class="small muted" style="font-weight:500;margin-top:14px">NASA POWER soil wetness, monthly since 2016</h3><div class="chart sm"><canvas id="smPow"></canvas></div>` : ''}
      <p class="note">${T(`${esc(soil.source)}; ERA5-Land grid point ${soil.gridLat.toFixed(2)}°, ${soil.gridLon.toFixed(2)}°. Normal = mean of the same days of the year (±7 days) over 2019–now. ${pw ? `${esc(pw.source)} (0 = dry, 1 = saturated; surface, root zone, whole profile).` : ''} Reanalysis is model-based (weather data assimilated, ~9 km); it does not see a single field's irrigation.`, `${esc(soil.source)}; ERA5-Land ızgara noktası ${soil.gridLat.toFixed(2)}°, ${soil.gridLon.toFixed(2)}°. Normal = 2019–bugün yılın aynı günlerinin (±7 gün) ortalaması. ${pw ? `${esc(pw.source)} (0 = kuru, 1 = doygun; yüzey, kök bölgesi, tüm profil).` : ''} Yeniden analiz model tabanlıdır (hava gözlemleri özümsenmiş, ~9 km); tek bir tarlanın sulamasını görmez.`)}</p>
    </div>`;
  chart('smEra', {
    type: 'line',
    data: { datasets: [
      ...soil.layers.map((L) => ({ label: L.label, data: idx.map(([t, i]) => ({ x: t, y: L.values[i] })), borderColor: L.color, backgroundColor: L.color, pointRadius: 0, borderWidth: 1.5 })),
      { label: '0–7 cm normal', data: idx.map(([t, i]) => ({ x: t, y: soil.layers[0].normal[i] })), borderColor: '#3fb8ff', borderDash: [4, 4], pointRadius: 0, borderWidth: 1 },
      { label: 'NISAR passes', data: ts.filter((t) => t >= t0).map((t) => ({ x: t, y: surfAt(t) })), borderColor: '#fff', backgroundColor: '#fff', showLine: false, pointRadius: 3 },
    ] },
    options: { maintainAspectRatio: false, animation: false, parsing: false, scales: { x: timeAxis(), y: { title: { display: true, text: 'volumetric soil water, m³/m³' } } }, plugins: { legend: { labels: { boxWidth: 10 } } } },
  });
  if (wet.sm.length) chart('smSar', {
    type: 'line',
    data: { datasets: [
      { label: 'NISAR relative wetness', data: ts.map((x, i) => ({ x, y: wet.sm[i] })), borderColor: '#e8b04a', backgroundColor: '#e8b04a', pointRadius: 3, tension: 0, spanGaps: false, yAxisID: 'y' },
      { label: 'ERA5-Land 0–7 cm', data: idx.filter(([t]) => t >= ts[0] - 5 * DAY).map(([t, i]) => ({ x: t, y: soil.layers[0].values[i] })), borderColor: '#3fb8ff', pointRadius: 0, borderWidth: 1, yAxisID: 'y1' },
    ] },
    options: { maintainAspectRatio: false, animation: false, parsing: false, scales: { x: { ...timeAxis(), min: ts[0] - 5 * DAY, max: ts[ts.length - 1] + 5 * DAY }, y: { min: 0, max: 1, title: { display: true, text: 'NISAR (0–1)' } }, y1: { position: 'right', grid: { display: false }, title: { display: true, text: 'm³/m³' } } }, plugins: { legend: { labels: { boxWidth: 10 } } } },
  });
  if (pw) chart('smPow', {
    type: 'line',
    data: { datasets: [['top', 'surface', '#3fb8ff'], ['root', 'root zone', '#a3e635'], ['prof', 'profile', '#e8b04a']].map(([k, label, c]) => ({ label, data: pw.months.map((m, i) => ({ x: tOfD(m), y: pw[k][i] })), borderColor: c, backgroundColor: c, pointRadius: 0, borderWidth: 1.5 })) },
    options: { maintainAspectRatio: false, animation: false, parsing: false, scales: { x: timeAxis(), y: { min: 0, max: 1, title: { display: true, text: 'wetness (0–1)' } } }, plugins: { legend: { labels: { boxWidth: 10 } } } },
  });
}

function pearson(p) {
  const n = p.length;
  if (n < 3) return 0;
  const mx = p.reduce((a, [x]) => a + x, 0) / n, my = p.reduce((a, [, y]) => a + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

// ---------------------------------------------------------------- region summary (live regions)
// ---------------------------------------------------------------- calibrated NISAR (GCOV gamma-naught via the proxy)
let proxyCfg = null;
async function nisarProxy() {
  try { const own = localStorage.getItem('dws.nisarProxy'); if (own) return own; } catch (e) { /* storage blocked */ }
  if (proxyCfg === null) proxyCfg = await fetch(`${app.base}config.json`).then((r) => (r.ok ? r.json() : {})).then((j) => j.nisarProxy || '').catch(() => '');
  return proxyCfg;
}

function calPanelHTML(R) {
  if (R.calibrated) {
    return `<div class="panel cal-on"><h3>${T('Calibrated NISAR data', 'Kalibre NISAR verisi')}</h3><p class="muted" style="margin:0">${T(`Every tool now uses <b>γ⁰ backscatter in dB</b> from the GCOV HDF5 products (${R.calibrated.pxM} m pixels averaged onto the area grid), on one fixed scale for all passes: HH −25…0 dB, HV −32…−7 dB. ${R.acquisitions.length} passes.`, `Tüm araçlar artık GCOV HDF5 ürünlerinden <b>dB cinsinden γ⁰ geri saçılımı</b> kullanıyor (${R.calibrated.pxM} m pikseller alan ızgarasına ortalandı), tüm geçişler için tek sabit ölçek: HH −25…0 dB, HV −32…−7 dB. ${R.acquisitions.length} geçiş.`)}</p></div>`;
  }
  return `<div class="panel" id="calPanel"><h3>${T('Data quality', 'Veri kalitesi')}</h3>
    <p class="muted" style="margin:0 0 8px">${T('Now: NISAR <b>browse</b> images (8-bit, ~165 m), each stretched on its own, so brightness is relative. Switch to the <b>calibrated</b> product: γ⁰ in dB from the 20 m GCOV files, the same scale on every pass.', 'Şu an: NISAR <b>önizleme</b> görüntüleri (8 bit, ~165 m), her biri kendi başına gerilmiş; parlaklık görelidir. <b>Kalibre</b> ürüne geçin: 20 m GCOV dosyalarından dB cinsinden γ⁰, her geçişte aynı ölçek.')}</p>
    <div id="calCtl" class="small muted">${T('Checking for a calibrated-data server…', 'Kalibre veri sunucusu aranıyor…')}</div></div>`;
}

async function calPanelInit(R) {
  const box = $('#calCtl');
  if (!box) return;
  const proxy = await nisarProxy();
  const kmMax = Math.max(...windowKm(R));
  if (!proxy) {
    box.innerHTML = `${T('No calibrated-data server is set up yet. Deploy the free proxy in <code>worker/</code> (5 minutes, see worker/README.md) and paste its address:', 'Henüz kalibre veri sunucusu yok. <code>worker/</code> içindeki ücretsiz proxy\'yi kurun (5 dakika, worker/README.md) ve adresini yapıştırın:')}
      <div class="controls" style="margin-top:6px"><input id="calUrl" placeholder="https://nisar-proxy.<name>.workers.dev" style="width:300px"><button class="btn" id="calSave">${T('Save', 'Kaydet')}</button></div>`;
    $('#calSave').addEventListener('click', () => { try { localStorage.setItem('dws.nisarProxy', $('#calUrl').value.trim()); } catch (e) { /* blocked */ } calPanelInit(R); });
    return;
  }
  if (kmMax > 60) { box.innerHTML = T(`Calibrated mode reads the 20 m files block by block; draw an area of at most 60 km (this one is ${kmMax.toFixed(0)} km).`, `Kalibre mod 20 m dosyaları blok blok okur; en fazla 60 km'lik bir alan çizin (bu alan ${kmMax.toFixed(0)} km).`); return; }
  const n = Math.min(12, R.acquisitions.length);
  const mb = Math.round(n * 2 * Math.max(1, (kmMax * 1000 / 20 / 512) ** 2) * 1.2);
  box.innerHTML = `<button class="btn btn-primary" id="calGo">${T('Use calibrated data (γ⁰ dB, 20 m)', 'Kalibre veriyi kullan (γ⁰ dB, 20 m)')}</button>
    <span style="margin-left:8px">${T(`latest ${n} passes · about ${mb} MB`, `son ${n} geçiş · yaklaşık ${mb} MB`)}</span>`;
  $('#calGo').addEventListener('click', () => runCalibrated(R, proxy, n));
}

function runCalibrated(R, proxy, n) {
  const box = $('#calCtl');
  box.innerHTML = `<div class="small muted" id="calStage">${T('Starting…', 'Başlıyor…')}</div><div class="bar"><i id="calBar"></i></div>`;
  const dates = R.acquisitions.slice(-n).map((a) => ({ date: a.date, urls: a.h5s?.length ? a.h5s : [a.h5].filter(Boolean) })).filter((d) => d.urls.length);
  const w = new Worker(new URL('../calWorker.js', import.meta.url), { type: 'module' });
  const rid = Math.random();
  w.onmessage = async (ev) => {
    const m = ev.data;
    if (m.rid !== rid) return;
    if (m.progress) {
      if ($('#calStage')) $('#calStage').textContent = `${m.progress.stage} · ${m.progress.done} / ${m.progress.total}`;
      if ($('#calBar')) $('#calBar').style.width = `${(100 * m.progress.done) / Math.max(1, m.progress.total)}%`;
      return;
    }
    w.terminate();
    if (m.error || !m.hh?.length) { if ($('#calCtl')) $('#calCtl').innerHTML = `<span class="no">${T('Calibrated data could not be read', 'Kalibre veri okunamadı')}: ${esc(m.error || T('no pass covered the area', 'alanı kapsayan geçiş yok'))}</span>`; return; }
    const res = await call('calibrate', { id: S.stack?.id || R.id, hh: m.hh, hv: m.hv, used: m.used, pxM: m.pxM, cal: m.cal }, [...m.hh, ...m.hv]);
    if (res.error) { $('#calCtl').textContent = res.error; return; }
    R.acquisitions = res.acquisitions;
    R.calibrated = res.calibrated;
    stacks.delete(R.id);
    S.stack = null; S.agri = null; S.ml = {};
    S.t = Math.min(S.t, R.acquisitions.length - 1); S.cmpT = 0;
    drawTimeline();
    rerenderSite();
  };
  w.postMessage({ rid, box: R.box, proxy, dates });
}

function regionOverview(el) {
  const a = acqs(), first = a[0], last = a[a.length - 1], R = S.site;
  el.innerHTML = `
  <div class="grid g-2">
    <div class="stack">
      <div class="panel">
        <h3>This window</h3>
        <p class="muted" style="margin:0">${T(`${windowKm(R)[0].toFixed(1)} × ${windowKm(R)[1].toFixed(1)} km (${Math.round(windowKm(R)[0] * windowKm(R)[1]).toLocaleString()} km²) drawn around ${R.lat.toFixed(3)}°, ${R.lon.toFixed(3)}°. Every NISAR GCOV pass on track ${R.track.path} / frame ${R.track.frame} (${R.track.dir.toLowerCase()}) was fetched live from the ASF archive, aligned by phase correlation and cropped in your browser.`, `${windowKm(R)[0].toFixed(1)} × ${windowKm(R)[1].toFixed(1)} km (${Math.round(windowKm(R)[0] * windowKm(R)[1]).toLocaleString()} km²), ${R.lat.toFixed(3)}°, ${R.lon.toFixed(3)}° çevresinde çizildi. İz ${R.track.path} / çerçeve ${R.track.frame} (${R.track.dir.toLowerCase()}) üzerindeki her NISAR GCOV geçişi ASF arşivinden canlı çekildi, faz korelasyonuyla hizalandı ve tarayıcınızda kırpıldı.`)}</p>
      </div>
      ${calPanelHTML(R)}
      <div class="stats">
        <div class="stat"><b>${a.length}</b><span>${T(`NISAR passes`, `NISAR geçişi`)}</span></div>
        <div class="stat"><b>${Math.round((tOf(last.date) - tOf(first.date)) / DAY)}</b><span>${T(`days covered`, `gün kapsandı`)}</span></div>

      </div>
      <div class="panel"><h3>Start here</h3><ul class="plain">
        <li><a href="${hrefOf(R)}/agri" data-agtool="deep">Crop types (deep learning)</a>: crop type per field from a trained network.</li></ul></div>
      <div class="panel"><h3>Crops grown here</h3><div id="rsMix" class="small muted">Loading SPAM 2010 crop statistics…</div></div>
      <div class="panel"><h3>Ground labels nearby</h3><div id="rsLab" class="small muted">Looking for NASA Harvest field labels…</div></div>
      <div class="panel"><h3>Passes</h3><div style="max-height:220px;overflow:auto"><table class="t"><tr><th>Date</th><th>Product</th><th style="text-align:right">valid</th><th style="text-align:right">shift km</th></tr>
        ${a.map((x) => `<tr><td class="mono">${x.date}</td><td class="small">${/PROVISIONAL/.test(x.collection || '') ? 'provisional' : 'validated / beta'}</td><td class="num">${pct(x.valid, 0)}</td><td class="num">${x.kml ? 'KML' : x.coregShiftKm.join(', ')}</td></tr>`).join('')}</table></div></div>
    </div>
    <div class="stack">
      <div class="panel">
        <div class="panel-head"><h3>First vs. latest pass</h3><a href="${hrefOf(R)}/images">Open radar images →</a></div>
        <div class="grid g-2" style="gap:8px">
          <figure style="margin:0"><canvas class="rthumb" data-i="0" width="256" height="256" style="width:100%;aspect-ratio:1;border-radius:6px;background:#07090b"></canvas><figcaption class="small muted mono">${first.date}</figcaption></figure>
          <figure style="margin:0"><canvas class="rthumb" data-i="${a.length - 1}" width="256" height="256" style="width:100%;aspect-ratio:1;border-radius:6px;background:#07090b"></canvas><figcaption class="small muted mono">${last.date}</figcaption></figure>
        </div>
        <p class="note">${T(`Magenta = strong HH (bare or flooded fields, double bounce), green = strong HV (crop and tree canopies), dark = smooth surfaces such as calm water.`, `Macenta = güçlü HH (çıplak ya da su basmış tarla, çift yansıma), yeşil = güçlü HV (ürün ve ağaç örtüsü), koyu = sakin su gibi düz yüzeyler.`)}</p>
      </div>
      <div class="panel"><h3>What radar can tell us here</h3>
        <div class="grid g-3" style="gap:12px">
          <div><div class="small" style="color:var(--ok);margin-bottom:4px">Measured directly</div><ul class="plain small">${CAPS.agriculture[0].map((x) => `<li>${x}</li>`).join('')}</ul></div>
          <div><div class="small" style="color:var(--warn);margin-bottom:4px">With other data</div><ul class="plain small">${CAPS.agriculture[1].map((x) => `<li>${x}</li>`).join('')}</ul></div>
          <div><div class="small" style="color:var(--no);margin-bottom:4px">Not from radar</div><ul class="plain small">${CAPS.agriculture[2].map((x) => `<li>${x}</li>`).join('')}</ul></div>
        </div></div>
    </div>
  </div>`;
  $$('a[data-agtool]', el).forEach((l) => l.addEventListener('click', () => { S.agTool = l.dataset.agtool; }));
  calPanelInit(R);
  labelsNear(app.base, R.box).then((L) => {
    if (!$('#rsLab')) return;
    const P = L.points;
    if (!P.length) { $('#rsLab').textContent = 'No NASA Harvest (CropHarvest) field labels within 25 km of this area.'; return; }
    const crop = P.filter((p) => p.crop), groups = {};
    crop.forEach((p) => { const g = p.label || p.group || 'crop (type not recorded)'; groups[g] = (groups[g] || 0) + 1; });
    const rows = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const ds = [...new Set(P.map((p) => p.dataset))].join(', '), yrs = P.map((p) => p.year).filter(Boolean);
    $('#rsLab').innerHTML = `<p>${P.length} field labels within 25 km (${P.filter((p) => p.inside).length} inside the area): <b>${crop.length}</b> crop, <b>${P.length - crop.length}</b> not crop${yrs.length ? `, collected ${Math.min(...yrs)}–${Math.max(...yrs)}` : ''}.</p>
      ${rows.length ? `<table class="t"><tr><th>Recorded on the ground</th><th style="text-align:right">labels</th></tr>${rows.map(([g, c]) => `<tr><td>${esc(g.replace(/_/g, ' '))}</td><td class="num">${c}</td></tr>`).join('')}</table>` : ''}
      <p class="note">${T(`${esc(L.source)} (${esc(L.license)}); campaigns: ${esc(ds)}. Points where people recorded what grew, useful to check the crop maps.`, `${esc(L.source)} (${esc(L.license)}); kampanyalar: ${esc(ds)}. İnsanların arazide neyin yetiştiğini kaydettiği noktalar; ürün haritalarını denetlemek için yararlı.`)}</p>`;
  }).catch(() => { if ($('#rsLab')) $('#rsLab').textContent = 'Field labels could not be loaded.'; });
  cropMix(app.base, R.box).then((mix) => {
    if (!$('#rsMix')) return;
    if (!mix.totalHa) { $('#rsMix').textContent = 'No crop statistics for this area (SPAM 2010 maps no cropland here).'; return; }
    $('#rsMix').innerHTML = `<table class="t"><tr><th>Crop</th><th style="text-align:right">share of crop area</th><th style="text-align:right">typical yield</th></tr>${mix.list.slice(0, 10).map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${(c.share * 100).toFixed(0)} %</td><td class="num">${c.tHa != null ? c.tHa.toFixed(1) + ' t/ha' : '–'}</td></tr>`).join('')}</table>
      <p class="note">${T(`${Math.round(mix.totalHa).toLocaleString()} ha of crops in the 0.25° cells around this area, around 2010. Source: ${esc(mix.source)}. Used as a prior by the crop-type models.`, `Bu alanın çevresindeki 0,25°'lik hücrelerde yaklaşık 2010 itibarıyla ${Math.round(mix.totalHa).toLocaleString()} ha ürün. Kaynak: ${esc(mix.source)}. Ürün türü modellerinde ön bilgi olarak kullanılır.`)}</p>`;
  }).catch(() => { if ($('#rsMix')) $('#rsMix').textContent = 'Crop statistics could not be loaded.'; });
  getStack().then(async (stack) => {
    S.stack = stack;
    $$('.rthumb', el).forEach((cv) => renderImage(stack.id, +cv.dataset.i, 'rgb', { filtered: true }).then((im) => drawTo(cv, im)));

  });
}

// ---------------------------------------------------------------- deep learning: U-TAE crop types (Sentinel-2)
const PASTIS_COLORS = ['#1f1f1f', '#5b9c2d', '#e6c44a', '#f48120', '#b8860b', '#ffe600', '#d2b48c', '#ffa500', '#800080', '#c71585',
  '#cd853f', '#a0522d', '#ff69b4', '#8b4513', '#32cd32', '#9acd32', '#006400', '#deb887', '#b22222', '#9ca3af'];
let dlWorker = null, dlRid = 0;
const dlPending = new Map();
function dlCall(args, onProgress) {
  if (!dlWorker) {
    dlWorker = new Worker(new URL('../dlWorker.js', import.meta.url), { type: 'module' });
    dlWorker.onmessage = (e) => {
      const p = dlPending.get(e.data.rid);
      if (!p) return;
      if (e.data.progress) { p.onProgress?.(e.data.progress); return; }
      dlPending.delete(e.data.rid);
      e.data.ok ? p.res(e.data.out) : p.rej(new Error(e.data.error));
    };
  }
  return new Promise((res, rej) => { const id = ++dlRid; dlPending.set(id, { res, rej, onProgress }); dlWorker.postMessage({ rid: id, args }); });
}

async function agDeep(el) {
  const R = S.site, b = aoiBounds();
  S.dl = S.dl || { lon: R.lon, lat: R.lat, season: 2025 };
  el.innerHTML = `
    <div class="panel">
      <p class="muted" style="max-width:900px">${T(`<b>U-TAE</b> (Garnot &amp; Landrieu, ICCV 2021) is a deep network for satellite image time series: a convolutional U-Net whose skip connections are combined over time by lightweight temporal attention. We run the <b>published weights trained on PASTIS</b> (2,433 patches of French farmland, 18 crop types; test mIoU 63–65 %) directly in your browser (ONNX Runtime, WebAssembly). Its input is a <b>Sentinel-2</b> time series, which is read for a 1.28 × 1.28 km window straight from the public Cloud-Optimized GeoTIFFs on AWS. Click the radar map to move the window, then run.`, `<b>U-TAE</b> (Garnot &amp; Landrieu, ICCV 2021) uydu görüntü zaman serileri için bir derin ağdır: atlama bağlantıları hafif bir zamansal dikkat mekanizmasıyla zaman boyunca birleştirilen evrişimli bir U-Net. <b>PASTIS üzerinde eğitilmiş yayımlanmış ağırlıkları</b> (Fransız tarım arazisinden 2.433 parça, 18 ürün türü; test mIoU %63–65) doğrudan tarayıcınızda çalıştırıyoruz (ONNX Runtime, WebAssembly). Girdisi bir <b>Sentinel-2</b> zaman serisidir; 1,28 × 1,28 km'lik pencere için doğrudan AWS'deki açık Cloud-Optimized GeoTIFF'lerden okunur. Pencereyi taşımak için radar haritasına tıklayın, sonra çalıştırın.`)}</p>
      <div class="controls">
        <label>Season <select id="dlSeason">${[2025, 2024, 2023, 2022, 2018].map((y) => `<option value="${y}">Sep ${y} – Oct ${y + 1}${y === 2018 ? ' (PASTIS season)' : ''}</option>`).join('')}</select></label>
        <label>Model <select id="dlModel"><option value="utae_pastis">U-TAE (PASTIS, published weights)</option></select></label>
        <label>Dates <select id="dlDates"><option>12</option><option selected>16</option><option>24</option></select></label>
        <button class="btn primary" id="dlRun">Run model here</button>
        <span class="small muted mono" id="dlWhere"></span>
      </div>
      <div class="result">
        <div><canvas class="map" id="dlPick" width="512" height="512" style="cursor:crosshair"></canvas>
          <p class="note">${T(`NISAR colour composite of the region; the square is the 1.28 km window sent to the network.`, `Bölgenin NISAR renk bileşimi; kare, ağa gönderilen 1,28 km'lik penceredir.`)}</p></div>
        <div id="dlOut"><div class="empty">Choose a window and press “Run U-TAE here”. The first run downloads the model (4.5 MB) and about 10 MB of Sentinel-2 data per date.</div></div>
      </div>
      <p class="note">${T(`<b>Domain shift:</b> the network learned French crops and the French calendar (winter cereals sown in autumn, maize and sunflower in spring). Outside that setting, classes are the nearest French equivalent: rice paddies, cotton or sugar cane have no class of their own. Treat results outside Western Europe as field delineation plus a crop-group hint, not as a crop census. ${R.lat < 35 || R.lat > 60 || R.lon < -10 || R.lon > 30 ? '<b>This region is outside the training domain.</b>' : ''}`, `<b>Alan kayması:</b> ağ Fransız ürünlerini ve Fransız takvimini öğrendi (sonbaharda ekilen kışlık tahıllar, ilkbaharda mısır ve ayçiçeği). Bu ortamın dışında sınıflar en yakın Fransız karşılığıdır: çeltik, pamuk ya da şeker kamışının kendi sınıfı yoktur. Batı Avrupa dışındaki sonuçları ürün sayımı olarak değil, tarla sınırı çizimi ve ürün grubu ipucu olarak okuyun. ${R.lat < 35 || R.lat > 60 || R.lon < -10 || R.lon > 30 ? '<b>Bu bölge eğitim alanının dışında.</b>' : ''}`)}</p>
    </div>`;
  $('#dlSeason').value = S.dl.season;
  // models listed in web/public/models/index.json (U-TAE + the team's U-Mamba / SITSMamba once exported)
  fetch(`${app.base}models/index.json`).then((r) => r.json()).then((idx) => {
    if (!$('#dlModel')) return;
    $('#dlModel').innerHTML = (idx.models || []).map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join('');
    $('#dlModel').value = S.dl.model || (idx.models[0] || {}).id || 'utae_pastis';
  }).catch(() => {});
  const pick = $('#dlPick');
  const base = await renderImage(S.stack.id, S.t, 'rgb', { filtered: true });
  const drawPick = () => {
    drawTo(pick, base);
    const ctx = pick.getContext('2d'), W = pick.width;
    const x = ((S.dl.lon - b.W) / (b.E - b.W)) * W, y = ((b.N - S.dl.lat) / (b.N - b.S)) * W;
    const s = Math.max(6, (1.28 / windowKm(R)[0]) * W);
    ctx.strokeStyle = '#e8b04a'; ctx.lineWidth = 2; ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    $('#dlWhere').textContent = `${S.dl.lat.toFixed(4)}°, ${S.dl.lon.toFixed(4)}°`;
  };
  drawPick();
  pick.addEventListener('click', (e) => {
    const r = pick.getBoundingClientRect();
    S.dl.lon = b.W + ((e.clientX - r.left) / r.width) * (b.E - b.W);
    S.dl.lat = b.N - ((e.clientY - r.top) / r.height) * (b.N - b.S);
    drawPick();
  });
  if (S.dl.result && S.dl.result.key === `${S.dl.lon},${S.dl.lat},${S.dl.season},${S.dl.model}`) showDeep(S.dl.result);
  $('#dlRun').addEventListener('click', async () => {
    S.dl.season = +$('#dlSeason').value;
    const out = $('#dlOut');
    out.innerHTML = '<div class="loading-region"><div class="small muted" id="dlStage">Starting…</div><div class="bar"><i id="dlBar"></i></div></div>';
    try {
      S.dl.model = $('#dlModel').value;
      // crops grown around the window (SPAM 2010, 0.25° cells): prior against crop classes not grown here
      const mix = await cropMix(app.base, [S.dl.lon - 0.15, S.dl.lat - 0.15, S.dl.lon + 0.15, S.dl.lat + 0.15]).catch(() => null);
      const r = await dlCall({ lon: S.dl.lon, lat: S.dl.lat, season: S.dl.season, maxDates: +$('#dlDates').value, model: S.dl.model, mix: mix && mix.totalHa ? mix : null, base: new URL(app.base, location.href).href }, (p) => {
        if ($('#dlStage')) $('#dlStage').textContent = `${p.stage}${p.total > 1 ? ` · ${p.done} / ${p.total}` : ''}`;
        if ($('#dlBar')) $('#dlBar').style.width = `${p.total ? (100 * p.done) / p.total : 8}%`;
      });
      r.key = `${S.dl.lon},${S.dl.lat},${S.dl.season},${S.dl.model}`;
      S.dl.result = r;
      if ($('#dlOut')) showDeep(r);
    } catch (e) {
      if ($('#dlOut')) $('#dlOut').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  });
}

// PASTIS classes -> crop groups that exist almost everywhere (shown outside the training domain)
const CROP_GROUPS = [
  { name: 'Background / not cropland', color: '#1f1f1f', of: [0] },
  { name: 'Grassland & fodder', color: '#5b9c2d', of: [1, 14] },
  { name: 'Cereals (wheat, barley, triticale)', color: '#e6c44a', of: [2, 4, 6, 10, 11, 17] },
  { name: 'Maize & sorghum', color: '#f48120', of: [3, 18] },
  { name: 'Oilseeds & legumes (rapeseed, sunflower, soy)', color: '#ffe600', of: [5, 7, 15] },
  { name: 'Root crops (beet, potato)', color: '#c71585', of: [9, 13] },
  { name: 'Vineyards & orchards', color: '#006400', of: [8, 16] },
  { name: 'Vegetables & flowers', color: '#ff69b4', of: [12] },
  { name: 'Cropland, crop not recognised', color: '#9ca3af', of: [19] },
];
const GROUP_OF = (() => { const g = new Uint8Array(20); CROP_GROUPS.forEach((G, k) => G.of.forEach((c) => (g[c] = k))); return g; })();

const GENERIC_COLORS = ['#f48120', '#ffe600', '#9acd32', '#e6c44a', '#5b9c2d', '#c71585', '#006400', '#ff69b4', '#22d3ee', '#a0522d'];
/** Crop calendar of the model's fields: Sentinel-2 NDVI per predicted crop, with green-up, peak, senescence, harvest. */
function deepCalendar(r, nameOf, colOf) {
  if (!$('#dlOut')) return;
  nisarCalendar(r, nameOf, colOf);
  if (!r.calendar?.length) return;
  const box = document.createElement('div');
  box.style.marginTop = '14px';
  box.innerHTML = `<h3 class="small muted" style="font-weight:500">Crop calendar of these fields (from the model's crop map and the Sentinel-2 NDVI of each crop)</h3>
    <div class="chart sm"><canvas id="dlCal"></canvas></div>
    <table class="t" style="margin-top:8px"><tr><th>Crop</th><th style="text-align:right">ha</th><th>Green-up</th><th>Peak</th><th>Senescence</th><th>Harvest</th></tr>
    ${r.calendar.map((c) => `<tr><td><span class="tag" style="--c:${colOf(c.cls)}"><i></i>${esc(nameOf(c.cls))}</span></td><td class="num">${(c.px * 0.01).toFixed(1)}</td><td>${c.greenUp}</td><td>${c.peak} <span class="muted">(NDVI ${c.peakNdvi.toFixed(2)})</span></td><td>${c.senescence}</td><td>${c.harvest || '–'}</td></tr>`).join('')}</table>
    <p class="note">${T(`Green-up / senescence = half-way up to / down from the NDVI peak of the crop's mean curve (smoothed); harvest = the sharpest NDVI drop after the peak. Dates are those of the Sentinel-2 scenes used.`, `Yeşillenme / yaşlanma = ürünün ortalama eğrisinin (yumuşatılmış) NDVI tepesine yarı yol çıkış / yarı yol iniş; hasat = tepeden sonraki en keskin NDVI düşüşü. Tarihler kullanılan Sentinel-2 sahnelerinindir.`)}</p>`;
  $('#dlOut').appendChild(box);
  const t = r.dates.map((d) => Date.parse(d + 'T12:00:00Z'));
  chart('dlCal', {
    type: 'line',
    data: { datasets: r.calendar.slice(0, 8).map((c) => ({ label: nameOf(c.cls), data: t.map((x, i) => ({ x, y: c.ndvi[i] })), borderColor: colOf(c.cls), backgroundColor: colOf(c.cls), pointRadius: 2, tension: 0.25 })) },
    options: { maintainAspectRatio: false, animation: false, parsing: false, scales: { x: timeAxis(), y: { min: -0.1, max: 1, title: { display: true, text: 'NDVI' } } }, plugins: { legend: { labels: { boxWidth: 10 } } } },
  });
}

/**
 * NISAR per crop: the model's crop map is laid over the region's NISAR series; radar pixels that are mostly one crop
 * give that crop's L-band vegetation index through the season and the radar dates of peak, harvest and flooding.
 */
async function nisarCalendar(r, nameOf, colOf) {
  if (!S.stack || !S.dl) return;
  const P = r.size, d = (P * 10) / 2 / 111320, dl = d / Math.cos((S.dl.lat * Math.PI) / 180);
  const patch = [S.dl.lon - dl, S.dl.lat - d, S.dl.lon + dl, S.dl.lat + d];
  const skip = r.generic ? [r.classes.length - 1] : [0];
  const res = await call('classSeries', { id: S.stack.id, patch, cls: r.cls.slice().buffer, P, skip }).catch(() => ({ classes: [] }));
  if (!$('#dlOut')) return;
  const box = document.createElement('div');
  box.style.marginTop = '14px';
  const A = acqs(), ts = times();
  if (!res.classes.length) {
    box.innerHTML = `<p class="note">${T(`<b>NISAR per crop:</b> the fields in this 1.28 km window are smaller than NISAR's browse pixels here (~${res.radarPxM || 165} m), so no radar pixel is mostly one crop. Draw a smaller area (finer radar grid, up to the ~165 m of the browse images) or move the window to larger fields.`, `<b>Ürün başına NISAR:</b> bu 1,28 km'lik penceredeki tarlalar NISAR'ın buradaki piksellerinden (~${res.radarPxM || 165} m) küçük; hiçbir radar pikseli çoğunlukla tek ürün değil. Daha küçük bir alan çizin (daha ince radar ızgarası, görüntülerin ~165 m'sine kadar) ya da pencereyi daha büyük tarlalara taşıyın.`)}</p>`;
    $('#dlOut').appendChild(box); return;
  }
  box.innerHTML = `<h3 class="small muted" style="font-weight:500">NISAR L-band through the season, per crop of the model's map</h3>
    <div class="chart sm"><canvas id="dlRad"></canvas></div>
    <table class="t" style="margin-top:8px"><tr><th>Crop</th><th style="text-align:right">radar px</th><th>Radar peak</th><th>Harvest (radar)</th><th>Flooded (radar)</th></tr>
    ${res.classes.map((c) => `<tr><td><span class="tag" style="--c:${colOf(c.cls)}"><i></i>${esc(nameOf(c.cls))}</span></td><td class="num">${c.radarPx}</td><td>${A[c.peak]?.date || '–'}</td><td>${c.harvest >= 0 ? A[c.harvest].date : '–'}</td><td>${c.flood >= 0 ? A[c.flood].date : '–'}</td></tr>`).join('')}</table>
    <p class="note">${T(`Radar pixels (~${res.radarPxM} m) that are at least 60 % one crop of the model's map; RVI = 4·HV/(HH+HV) from the NISAR passes of this area. Radar sees through cloud, so these dates do not depend on clear skies; harvest = sharpest RVI drop after the peak, flooded = a pass darker than the water threshold in HH followed by recovery (paddy transplanting).`, `Modelin haritasında en az %60'ı tek ürün olan radar pikselleri (~${res.radarPxM} m); RVI = 4·HV/(HH+HV), bu alanın NISAR geçişlerinden. Radar bulutun içini gördüğü için bu tarihler açık havaya bağlı değil; hasat = tepeden sonraki en keskin RVI düşüşü, su basması = HH'de su eşiğinden koyu bir geçişi izleyen toparlanma (çeltik dikimi).`)}</p>`;
  $('#dlOut').appendChild(box);
  chart('dlRad', {
    type: 'line',
    data: { datasets: res.classes.slice(0, 8).map((c) => ({ label: nameOf(c.cls), data: ts.map((x, i) => ({ x, y: c.rvi[i] })), borderColor: colOf(c.cls), backgroundColor: colOf(c.cls), borderDash: [5, 3], pointRadius: 2, tension: 0.25 })) },
    options: { maintainAspectRatio: false, animation: false, parsing: false, scales: { x: timeAxis(), y: { title: { display: true, text: 'NISAR RVI (relative)' } } }, plugins: { legend: { labels: { boxWidth: 10 } } } },
  });
}

function showDeepGeneric(r) {
  const P = r.size, N = P * P, total = r.counts.reduce((a, c) => a + c, 0);
  const isSem = r.head === 'sem';
  const colOf = (k) => (isSem ? PASTIS_COLORS[k] : k === r.classes.length - 1 ? '#1f1f1f' : GENERIC_COLORS[k % GENERIC_COLORS.length]);
  const order = r.counts.map((c, k) => [c, k]).filter(([c]) => c > 0).sort((a, b2) => b2[0] - a[0]);
  let ymin = Infinity, ymax = -Infinity, ysum = 0, yn = 0;
  if (r.yieldMap) for (const v of r.yieldMap) if (Number.isFinite(v)) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); ysum += v; yn++; }
  $('#dlOut').innerHTML = `
    <div class="grid g-${r.yieldMap ? 3 : 2}" style="gap:8px">
      <figure style="margin:0"><canvas id="dlRgb" width="${P}" height="${P}" style="width:100%;aspect-ratio:1;border-radius:6px;image-rendering:pixelated"></canvas><figcaption class="small muted">Sentinel-2, mid-season</figcaption></figure>
      <figure style="margin:0"><canvas id="dlCls" width="${P}" height="${P}" style="width:100%;aspect-ratio:1;border-radius:6px;image-rendering:pixelated"></canvas><figcaption class="small muted">${esc(r.model.label)}: ${isSem ? 'crop types' : 'crops'}</figcaption></figure>
      ${r.yieldMap ? `<figure style="margin:0"><canvas id="dlYld" width="${P}" height="${P}" style="width:100%;aspect-ratio:1;border-radius:6px;image-rendering:pixelated"></canvas><figcaption class="small muted">Predicted yield, ${ymin.toFixed(1)}–${ymax.toFixed(1)} t/ha (mean ${(ysum / Math.max(1, yn)).toFixed(2)})</figcaption></figure>` : ''}
    </div>
    <div class="classes" style="margin-top:10px">${order.map(([c, k]) => `<div class="row"><i style="background:${colOf(k)}"></i><div><b>${esc(r.classes[k] || '')}</b><div class="bar-conf"><i style="width:${(r.meanConf[k] * 100).toFixed(0)}%"></i></div></div><div class="v">${(c * 0.01).toFixed(1)} ha<br><span class="muted">${pct(c / total)} · conf ${pct(r.meanConf[k], 0)}</span></div></div>`).join('')}</div>
    <p class="note">${T(`Input: Sentinel-2 on a ${r.post.grid} grid (${r.post.stepsObserved} steps observed); Sentinel-1 channels empty (the model was trained with random S1 drop-out). Post-processing: ${r.post.worldcover ? 'ESA WorldCover bare / built / water and' : ''} pixels that never green (NDVI &lt; 0.3) or that the model's field-extent head rejects are not fields (${(r.post.maskedWcPx * 0.01).toFixed(1)} ha).${r.model.metrics ? ` Validation: ${esc(JSON.stringify(r.model.metrics).slice(0, 160))}.` : ''}`, `Girdi: ${r.post.grid} ızgarada Sentinel-2 (${r.post.stepsObserved} adım gözlendi); Sentinel-1 kanalları boş (model rastgele S1 düşürmeyle eğitildi). Son işlem: ${r.post.worldcover ? 'ESA WorldCover çıplak / yapı / su ve' : ''} hiç yeşermeyen (NDVI &lt; 0,3) ya da modelin tarla sınırı başlığının reddettiği pikseller tarla sayılmaz (${(r.post.maskedWcPx * 0.01).toFixed(1)} ha).${r.model.metrics ? ` Doğrulama: ${esc(JSON.stringify(r.model.metrics).slice(0, 160))}.` : ''}`)}</p>`;
  const put = (id, fn) => { const c = $('#' + id); if (!c) return; const x = c.getContext('2d'), im = x.createImageData(P, P); for (let i = 0; i < N; i++) im.data.set(fn(i), i * 4); x.putImageData(im, 0, 0); };
  const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  put('dlRgb', (i) => r.rgb.subarray(i * 4, i * 4 + 4));
  put('dlCls', (i) => [...hex(colOf(r.cls[i])), 255]);
  deepCalendar(r, (k) => r.classes[k] || '', colOf);
  if (r.yieldMap) put('dlYld', (i) => { const v = r.yieldMap[i]; if (!Number.isFinite(v)) return [31, 31, 31, 255]; const t = (v - ymin) / Math.max(1e-6, ymax - ymin); const st = [[185, 28, 28], [250, 204, 21], [21, 128, 61]]; const k = t < 0.5 ? 0 : 1, f = t < 0.5 ? t * 2 : (t - 0.5) * 2; return [...st[k].map((c, j) => c + (st[k + 1][j] - c) * f), 255]; });
}

function showDeep(r) {
  if (r.generic) return showDeepGeneric(r);
  const P = r.size, N = P * P, total = r.counts.reduce((a, c) => a + c, 0);
  const useGroups = S.dlGroups ?? !r.post?.inDomain;
  const gCounts = new Array(CROP_GROUPS.length).fill(0), gConf = new Array(CROP_GROUPS.length).fill(0);
  r.counts.forEach((c, k) => { gCounts[GROUP_OF[k]] += c; gConf[GROUP_OF[k]] += r.meanConf[k] * c; });
  const order = useGroups
    ? gCounts.map((c, k) => [c, k]).filter(([c]) => c > 0).sort((a, b2) => b2[0] - a[0])
    : r.counts.map((c, k) => [c, k]).filter(([c]) => c > 0).sort((a, b2) => b2[0] - a[0]);
  const nameOf = (k) => (useGroups ? CROP_GROUPS[k].name : r.classes[k]), colOf = (k) => (useGroups ? CROP_GROUPS[k].color : PASTIS_COLORS[k]);
  const confOf = (k) => (useGroups ? (gCounts[k] ? gConf[k] / gCounts[k] : 0) : r.meanConf[k]);
  $('#dlOut').innerHTML = `
    <div class="grid g-2" style="gap:8px">
      <figure style="margin:0"><canvas id="dlRgb" width="${P}" height="${P}" style="width:100%;aspect-ratio:1;border-radius:6px;image-rendering:pixelated"></canvas><figcaption class="small muted">Sentinel-2 true colour, ${r.dates[Math.floor(r.dates.length / 2)]}</figcaption></figure>
      <figure style="margin:0"><canvas id="dlCls" width="${P}" height="${P}" style="width:100%;aspect-ratio:1;border-radius:6px;image-rendering:pixelated"></canvas><figcaption class="small muted">U-TAE crops, post-processed · <label><input type="checkbox" id="dlConf"> shade by confidence</label> · <label><input type="checkbox" id="dlGroups" ${useGroups ? 'checked' : ''}> crop groups</label></figcaption></figure>
    </div>
    <div class="classes" style="margin-top:10px">${order.map(([c, k]) => `<div class="row"><i style="background:${colOf(k)}"></i><div><b>${esc(nameOf(k))}</b><div class="bar-conf" title="mean confidence"><i style="width:${(confOf(k) * 100).toFixed(0)}%"></i></div></div><div class="v">${(c * 0.01).toFixed(1)} ha<br><span class="muted">${pct(c / total)} · conf ${pct(confOf(k), 0)}</span></div></div>`).join('')}</div>
    <p class="note">${T(`<b>Post-processing</b> (the network only knows French farmland): ${r.post?.worldcover ? `${(r.post.maskedWcPx * 0.01).toFixed(1)} ha set to background because ESA WorldCover does not map cropland there` : 'ESA WorldCover could not be read'}; ${(r.post?.maskedGreenPx * 0.01 || 0).toFixed(1)} ha never green this season (max NDVI &lt; 0.3, e.g. desert, rock, towns); patches under ${r.post?.mmuHa ?? 0.3} ha merged into their neighbours (${(r.post?.mergedPx * 0.01 || 0).toFixed(1)} ha); one crop per field by soft vote of the class probabilities;${r.post?.prior ? ` regional crop mix (${esc(r.post.prior.top.join(', '))}; SPAM 2010) used as a prior${r.post.prior.suppressed.length ? `, suppressing classes not grown here: ${esc(r.post.prior.suppressed.join(', '))}` : ''};` : ''} ${(r.post?.unrecognisedPx * 0.01 || 0).toFixed(1)} ha that the network called background but WorldCover maps as cropland (or that has a crop-like greening season) are kept as <i>cropland, crop not recognised</i>.${r.post && !r.post.inDomain ? ' <b>Outside the training domain (Western Europe): crop groups are shown instead of French crop names.</b>' : ''}`, `<b>Son işlem</b> (ağ yalnızca Fransız tarım arazisini biliyor): ${r.post?.worldcover ? `ESA WorldCover orada tarım alanı göstermediği için ${(r.post.maskedWcPx * 0.01).toFixed(1)} ha arka plana alındı` : 'ESA WorldCover okunamadı'}; ${(r.post?.maskedGreenPx * 0.01 || 0).toFixed(1)} ha bu sezon hiç yeşermedi (en yüksek NDVI &lt; 0,3; ör. çöl, kaya, yerleşim); ${r.post?.mmuHa ?? 0.3} ha'dan küçük parçalar komşularına katıldı (${(r.post?.mergedPx * 0.01 || 0).toFixed(1)} ha); sınıf olasılıklarının yumuşak oylamasıyla tarla başına tek ürün;${r.post?.prior ? ` bölgesel ürün karışımı (${esc(r.post.prior.top.join(', '))}; SPAM 2010) ön bilgi olarak kullanıldı${r.post.prior.suppressed.length ? `, burada ekilmeyen sınıflar bastırıldı: ${esc(r.post.prior.suppressed.join(', '))}` : ''};` : ''} ağın arka plan dediği ama WorldCover'ın tarım alanı gösterdiği (ya da ürün benzeri yeşerme sezonu olan) ${(r.post?.unrecognisedPx * 0.01 || 0).toFixed(1)} ha <i>tarım alanı, ürün tanınmadı</i> olarak tutuldu.${r.post && !r.post.inDomain ? ' <b>Eğitim alanının (Batı Avrupa) dışında: Fransız ürün adları yerine ürün grupları gösteriliyor.</b>' : ''}`)}</p>
    <p class="note">${T(`${r.dates.length} Sentinel-2 dates (${r.dates[0]} → ${r.dates[r.dates.length - 1]}), 10 m pixels, 1 pixel = 0.01 ha. Confidence = softmax probability of the chosen class. Weights: U-TAE fold ${r.model.fold} (Zenodo 5172293)${r.model.testMetrics?.test_IoU ? `, PASTIS test mIoU ${(+r.model.testMetrics.test_IoU).toFixed(1)} %, OA ${(+r.model.testMetrics.test_accuracy).toFixed(1)} %` : ''}.`, `${r.dates.length} Sentinel-2 tarihi (${r.dates[0]} → ${r.dates[r.dates.length - 1]}), 10 m piksel, 1 piksel = 0,01 ha. Güven = seçilen sınıfın softmax olasılığı. Ağırlıklar: U-TAE kat ${r.model.fold} (Zenodo 5172293)${r.model.testMetrics?.test_IoU ? `, PASTIS test mIoU %${(+r.model.testMetrics.test_IoU).toFixed(1)}, OA %${(+r.model.testMetrics.test_accuracy).toFixed(1)}` : ''}.`)}</p>`;
  const put = (id, fn) => { const c = $('#' + id), x = c.getContext('2d'), im = x.createImageData(P, P); for (let i = 0; i < N; i++) { const v = fn(i); im.data.set(v, i * 4); } x.putImageData(im, 0, 0); };
  put('dlRgb', (i) => r.rgb.subarray(i * 4, i * 4 + 4));
  const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const cols = PASTIS_COLORS.map(hex);
  const drawCls = () => {
    const shade = $('#dlConf')?.checked;
    const gcols = CROP_GROUPS.map((G) => hex(G.color));
    put('dlCls', (i) => { const c = useGroups ? gcols[GROUP_OF[r.cls[i]]] : cols[r.cls[i]], a = shade ? 0.25 + 0.75 * r.conf[i] : 1; return [c[0] * a, c[1] * a, c[2] * a, 255]; });
  };
  drawCls();
  $('#dlConf').addEventListener('change', drawCls);
  $('#dlGroups').addEventListener('change', (e) => { S.dlGroups = e.target.checked; showDeep(r); });
  deepCalendar(r, (k) => r.classes[k], (k) => PASTIS_COLORS[k]);
}

// ---------------------------------------------------------------- parcel report (team analyzer, live)
/** NISAR radar vegetation index of the whole window on each pass (no classification). */
function windowRvi(stack) { return stack.hh.map((h, t) => (4 * stack.hv[t]) / (h + stack.hv[t] + 1)); }

async function reportTab(el) {
  el.innerHTML = '<div class="empty">Loading…</div>';
  if (!S.stack) S.stack = await getStack();
  if (S.tab !== 'report') return;
  const b = aoiBounds();
  renderReport(el, { site: S.site, box: [b.W, b.S, b.E, b.N], times: times(), rvi: windowRvi(S.stack), charts: S.charts });
}

// ---------------------------------------------------------------- archive: every radar pass over the window since 1978
const BAND_COL = { L: '#7dd3fc', C: '#94a3b8' };
async function archiveTab(el) {
  el.innerHTML = '<div class="empty">Searching the ASF archive for every radar mission over this window (Seasat 1978 → NISAR)…</div>';
  const A = await fetchArchive(S.site.lon, S.site.lat);
  if (S.tab !== 'archive' || !el.isConnected) return;
  const total = A.reduce((n, p) => n + p.count, 0);
  const lb = A.filter((p) => p.band === 'L').reduce((n, p) => n + p.count, 0);
  const years = [];
  const y0 = Math.min(...A.flatMap((p) => Object.keys(p.years).map(Number)), 2025), y1 = new Date().getUTCFullYear();
  for (let y = y0; y <= y1; y++) years.push(y);
  const alos = A.find((p) => p.id === 'ALOS');
  const rtc = alos?.rtc || [];
  const then = rtc.filter((g) => /HH/.test(g.pol || 'HH')).sort((a, b) => Math.abs(+a.date.slice(5, 7) - 7) - Math.abs(+b.date.slice(5, 7) - 7))[0];
  el.innerHTML = `
    <div class="stack">
      <div class="stats">
        <div class="stat"><b>${total.toLocaleString()}</b><span>${T(`radar acquisitions in the ASF archive over this point`, `bu nokta üzerinde ASF arşivindeki radar çekimi`)}</span></div>
        <div class="stat"><b>${lb.toLocaleString()}</b><span>${T(`of them L-band (Seasat, JERS-1, ALOS, UAVSAR, NISAR)`, `tanesi L-band (Seasat, JERS-1, ALOS, UAVSAR, NISAR)`)}</span></div>
        <div class="stat"><b>${y0}</b><span>${T(`first year with data here`, `burada verinin olduğu ilk yıl`)}</span></div>
        <div class="stat"><b>${A.filter((p) => p.count).length}</b><span>${T(`missions`, `görev`)}</span></div>
      </div>
      <div class="panel"><h3>Passes per year and mission</h3><div class="chart"><canvas id="arYears"></canvas></div>
        <p class="note">${T(`Source: ASF DAAC search API (all platforms it distributes). Older missions were recorded only within reach of receiving stations, so many regions have no data before 2006. Sentinel-1 and NISAR counts are exact per year; the others are counted per acquisition date.`, `Kaynak: ASF DAAC arama API'si (dağıttığı tüm platformlar). Eski görevler yalnızca alıcı istasyonların menzilinde kaydedildi; birçok bölgede 2006 öncesi veri yok. Sentinel-1 ve NISAR sayıları yıllık tam sayılardır; diğerleri çekim tarihine göre sayılır.`)}</p></div>
      ${then ? `<div class="panel"><h3>L-band then and now: ALOS PALSAR ${then.date.slice(0, 4)} vs NISAR ${acqs()[acqs().length - 1].date.slice(0, 4)}</h3>
        <div class="grid g-2" style="gap:10px">
          <figure style="margin:0"><img src="${then.browse}" alt="ALOS PALSAR browse" loading="lazy" style="width:100%;border-radius:6px;background:#07090b"><figcaption class="small muted">ALOS PALSAR ${esc(then.pol || '')} ${then.date}, radiometrically terrain-corrected browse (ASF), whole scene ~70 km</figcaption></figure>
          <figure style="margin:0"><canvas id="arNow" width="256" height="256" style="width:100%;aspect-ratio:1;border-radius:6px;background:#07090b"></canvas><figcaption class="small muted">NISAR ${acqs()[acqs().length - 1].date}, this ${windowKm(S.site).map((v) => v.toFixed(0)).join(' × ')} km window, HH</figcaption></figure>
        </div>
        <p class="note">${T(`Both are L-band (23–24 cm): the same physics, 15+ years apart, so cleared forest, new reservoirs, towns and irrigation schemes stand out. The ALOS image is the archive's browse of the whole scene (not cropped to the window; north is up after terrain correction).`, `İkisi de L-band (23–24 cm): aynı fizik, 15 yıldan fazla arayla; açılan orman, yeni barajlar, şehirler ve sulama projeleri öne çıkar. ALOS görüntüsü arşivin tüm sahne önizlemesidir (pencereye kırpılmamış; arazi düzeltmesinden sonra kuzey yukarıda).`)}</p></div>` : ''}
      <div class="panel"><h3>Missions</h3>
        <table class="t"><tr><th>Mission</th><th>Band</th><th>Years</th><th style="text-align:right">Acquisitions here</th><th>Browse samples</th></tr>
        ${A.map((p) => `<tr><td>${esc(p.label)}</td><td><span class="tag" style="--c:${BAND_COL[p.band]}"><i></i>${p.band}</span></td><td>${p.years}</td><td class="num">${p.count ? p.count.toLocaleString() : (p.error ? 'n/a' : '0')}</td>
          <td>${p.items.length ? `<div class="thumbs">${p.items.filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 6)) === 0).slice(0, 6).map((it) => `<a href="${it.browse}" target="_blank" rel="noopener" title="${esc(it.product)}"><img src="${it.browse}" loading="lazy" alt=""><span>${it.date}</span></a>`).join('')}</div>` : '<span class="muted small">–</span>'}</td></tr>`).join('')}
        </table>
        <p class="note">${T(`Browse images from older missions are in radar geometry (not map-aligned) and show the whole scene. Open one to see it full size.`, `Eski görevlerin önizleme görüntüleri radar geometrisindedir (haritaya hizalı değil) ve tüm sahneyi gösterir. Tam boyda görmek için birini açın.`)}</p></div>
    </div>`;
  chart('arYears', {
    type: 'bar',
    data: { labels: years, datasets: A.filter((p) => p.count).map((p) => ({ label: p.label, data: years.map((y) => p.years[y] || 0), backgroundColor: p.id === 'NISAR' ? '#e8b04a' : p.band === 'L' ? `hsl(${195 + 25 * ARCHIVE_PLATFORMS.indexOf(p) % 60} 85% 70%)` : `hsl(215 ${10 + 8 * (ARCHIVE_PLATFORMS.indexOf(p) % 4)}% ${48 + 6 * (ARCHIVE_PLATFORMS.indexOf(p) % 3)}%)` })) },
    options: { maintainAspectRatio: false, animation: false, scales: { x: { stacked: true }, y: { stacked: true, title: { display: true, text: 'acquisitions' } } }, plugins: { legend: { labels: { boxWidth: 10 } } } },
  });
  if (then) renderImage(S.stack?.id || (await getStack()).id, acqs().length - 1, 'hh', { filtered: true }).then((im) => { if ($('#arNow')) drawTo($('#arNow'), im); });
}
