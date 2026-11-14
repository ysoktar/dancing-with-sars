import './style.css';
import Chart from 'chart.js/auto';
import { GlobeView, latestBefore } from './globe.js';
import { themeOf, THEMES } from './sites.js';
import { $, $$, DAY, tOf, fmtDate, fmtShort, esc, ICON } from './util.js';
import { openSitePage, closeSitePage, hrefOf } from './pages/site.js';
import { call } from './sarClient.js';
import { renderMethod, renderData } from './pages/static.js';

const BASE = import.meta.env.BASE_URL;

Chart.defaults.color = '#8a94a3';
Chart.defaults.borderColor = 'rgba(138,148,163,0.14)';
Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
Chart.defaults.font.size = 11;

export const app = {
  base: BASE,
  catalog: null, coverage: null, motion: { sites: {} }, events: { sites: {} },
  sites: [], globe: null,
  tl: { start: 0, end: 0, day: 0, playing: false, timer: null },
  listeners: new Set(), // called with (date) when the timeline moves
};

// ===================================================================== boot
async function boot() {
  const get = (f, fallback) => fetch(BASE + 'data/' + f).then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);
  const [catalog, coverage, motion, events, dem, mosaic, tle] = await Promise.all([
    get('catalog.json', null), get('coverage.json', { months: [] }), get('motion.json', { sites: {} }), get('events.json', { sites: {} }), get('dem.json', {}), get('mosaic.json', { cycles: [] }), get('nisar_tle.json', null),
  ]);
  if (!catalog) throw new Error('catalog.json missing: run pipeline/build_data.py');
  Object.assign(app, { catalog, coverage, motion, events, dem, mosaic });
  app.sites = [];        // no predefined places: the user picks any region on the globe
  const cyc0 = mosaic.cycles[mosaic.cycles.length - 1];
  $('#barMeta').textContent = cyc0 ? `World mosaics: ${mosaic.cycles.length} cycles, ${mosaic.cycles.reduce((n, c) => n + c.granules, 0).toLocaleString()} NISAR frames · latest ${fmtDate(tOf(cyc0.end))}` : '';

  app.globe = new GlobeView($('#globeViz'), { base: BASE, onSiteClick: () => {} });
  app.globe.setSites([]);
  window.__pov = (lat, lng, altitude = 1.8) => { app.globe.globe.controls().autoRotate = false; app.globe.globe.pointOfView({ lat, lng, altitude }); };   // debugging / screenshots
  app.globe.setCoverage(coverage);
  if (tle) app.globe.setTLE(tle);
  if (mosaic.cycles.length) app.globe.setMosaics(mosaic.cycles);
  else $('#mosaicLayer').style.display = 'none';
  const evs = [];
  for (const [id, list] of Object.entries(events.sites || {})) {
    for (const e of list) if (e.kind === 'event' && e.lat != null) evs.push({ ...e, site: id, color: eventColor(e.category) });
  }
  app.globe.setEvents(evs);

  buildRegionPanel();
  buildTimeline();
  bindLayers();
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('sheet-open')) go('#/'); });
  $('#scrim').addEventListener('click', () => go('#/'));
  route();
}

export function eventColor(cat = '') {
  if (/flood/i.test(cat)) return '#3fb8ff';
  if (/fire/i.test(cat)) return '#ff6a4d';
  if (/volcan/i.test(cat)) return '#ff3d6e';
  if (/storm|cyclone/i.test(cat)) return '#b48cff';
  if (/ice/i.test(cat)) return '#c8f0ff';
  return '#e8b04a';
}

export function go(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}

// ===================================================================== router
let current = null;
function route() {
  const parts = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean);
  const [page, id, tab] = parts;
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.route === (page || 'globe')));
  const sheet = $('#sheet');
  if (!page) {
    closeSheet();
    return;
  }
  if (current && current !== 'region') closeSitePage();
  if (page === 'region') {
    if (parts.length < 3) { closeSheet(); setPicking(true); return; }
    const [, lon, lat, half = '0.22', rtab] = parts;
    openRegion(+lon, +lat, +half, rtab || 'overview');
    current = 'region';
    return;
  }
  closeSitePage();
  openSheet();
  if (page === 'method') renderMethod(sheet);
  else if (page === 'data') renderData(sheet);
  else return go('#/');
  current = page;
}

function openSheet() {
  document.body.classList.add('sheet-open');
  app.globe.pause();                 // the globe is hidden behind the page: stop rendering it
  if (app.tl.playing) togglePlay();
}
function closeSheet() {
  closeSitePage();
  document.body.classList.remove('sheet-open');
  app.globe.resume();
  $('#sheet').innerHTML = '';
  app.globe.blur();
  current = null;
}

export function sheetHead(title, sub = '') {
  return `<div class="sheet-head"><div><h2 id="sheetTitle">${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    <a class="close" href="#/" aria-label="Close and return to globe">${ICON.close}</a></div>`;
}

// ===================================================================== region selection
const regions = new Map();            // key -> Promise<region>
const RECENT_KEY = 'dws.recentRegions';
let pickHalf = 0.22;
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } };
function remember(r) {
  try {
    const list = [{ lon: r.lon, lat: r.lat, half: r.half_deg, label: r.name }, ...recent().filter((x) => !(Math.abs(x.lon - r.lon) < 1e-3 && Math.abs(x.lat - r.lat) < 1e-3))].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch (e) { /* storage may be blocked */ }
  drawRecent();
}
function regionBox(lon, lat, h) { const hl = h / Math.max(Math.cos((lat * Math.PI) / 180), 0.05); return [lon - hl, lat - h, lon + hl, lat + h]; }

export function setPicking(on) {
  app.globe.setPickMode(on, (lat, lng) => {
    setPicking(false);
    go(`#/region/${lng.toFixed(4)}/${lat.toFixed(4)}/${pickHalf}/overview`);
  });
  $('#pickBtn').classList.toggle('on', on);
  $('#pickBtn').textContent = on ? 'Click a point on the globe…' : 'Pick a point on the globe';
}

function buildRegionPanel() {
  $('#railList').innerHTML = `
    <div class="region-panel">
      <button class="btn primary" id="pickBtn">Pick a point on the globe</button>
      <form class="field" id="coordForm"><span class="small muted">or search a place / “lat, lon”</span>
        <div style="display:flex;gap:6px"><input id="cQuery" placeholder="e.g. Polatlı, Ankara  or  39.58, 32.14" style="flex:1"><button class="btn">Go</button></div>
        <span class="small" id="cMsg" style="color:var(--warn)"></span></form>
      <div class="field"><span class="small muted">Window width</span>
        <div style="display:flex;gap:6px;align-items:center"><div class="seg" id="halfSeg"><button data-h="0.1">22 km</button><button data-h="0.22" class="on">49 km</button><button data-h="0.4">89 km</button></div>
        <input id="cKm" type="number" min="5" max="120" step="1" placeholder="km" title="any width in km (5–120)" style="width:64px"></div>
        <span class="small muted">NISAR browse pixels are ~165 m: below ~10 km a window holds only a few dozen pixels across.</span></div>
      <div id="recentList"></div>
      <p class="small muted" style="margin-top:10px">Every NISAR pass over the window is fetched live from the ASF archive, aligned and analysed in your browser: crop segmentation, fields, yield segmentation, cropland vs forest, crop calendar.</p>
    </div>`;
  $('#pickBtn').addEventListener('click', () => setPicking(!app.globe.picking));
  $$('#halfSeg button').forEach((b) => b.addEventListener('click', () => { pickHalf = +b.dataset.h; $('#cKm').value = ''; $$('#halfSeg button').forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#cKm').addEventListener('change', () => {
    const km = Math.max(5, Math.min(120, parseFloat($('#cKm').value)));
    if (!Number.isFinite(km)) return;
    pickHalf = +(km / 2 / 111.32).toFixed(4);
    $$('#halfSeg button').forEach((x) => x.classList.remove('on'));
  });
  $('#coordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#cQuery').value.trim();
    $('#cMsg').textContent = '';
    if (!q) return;
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    let la, lo;
    if (m) { la = +m[1]; lo = +m[2]; } else {
      try {
        const r = await (await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`)).json();
        if (r[0]) { la = +r[0].lat; lo = +r[0].lon; }
      } catch (err) { /* offline */ }
    }
    if (Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 85) go(`#/region/${lo.toFixed(4)}/${la.toFixed(4)}/${pickHalf}/overview`);
    else $('#cMsg').textContent = 'Place not found. Try “lat, lon”.';
  });
  drawRecent();
}

function drawRecent() {
  const list = recent();
  const el = $('#recentList');
  if (!el) return;
  el.innerHTML = list.length ? `<div class="rail-group">Recent regions</div>` + list.map((r) => `<button class="rail-item" data-href="#/region/${r.lon.toFixed(4)}/${r.lat.toFixed(4)}/${r.half}/overview"><span class="sw" style="--c:#e8b04a"></span><span><b>${esc(r.label)}</b><small>${r.lat.toFixed(2)}°, ${r.lon.toFixed(2)}° · ${(r.half * 222.6).toFixed(0)} km</small></span></button>`).join('') : '';
  $$('#recentList .rail-item').forEach((b) => b.addEventListener('click', () => go(b.dataset.href)));
}

async function placeName(lon, lat) {
  // reverse geocoding is optional: coordinates are used when it is not reachable
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=8&lat=${lat}&lon=${lon}`, { headers: { Accept: 'application/json' } });
    const j = await r.json(), a = j.address || {};
    return [a.county || a.state_district || a.city || a.town || a.region || a.state, a.country].filter(Boolean).join(', ');
  } catch (e) { return ''; }
}

function openRegion(lon, lat, half, tab) {
  const key = `${lon.toFixed(4)},${lat.toFixed(4)},${half}`;
  const sheet = $('#sheet');
  const box = regionBox(lon, lat, half);
  app.globe.showBox(box);
  app.globe.focus({ id: key, lat, lon }, 1200);
  openSheet();
  if (!regions.has(key)) {
    sheet.innerHTML = sheetHead(`Region ${lat.toFixed(3)}°, ${lon.toFixed(3)}°`, `${(half * 222.6).toFixed(0)} km window`) +
      `<div class="sheet-body"><div class="page"><div class="loading-region"><div class="small muted" id="rgStage">Searching the ASF archive…</div><div class="bar"><i id="rgBar"></i></div><p class="note">The radar images are public NISAR browse products (~4 MB each). Nothing is installed or uploaded.</p></div></div></div>`;
    const id = `r_${key}`;
    regions.set(key, Promise.all([
      call('region', { id, lon, lat, half_deg: half, maxDates: 24 }, [], (p) => {
        if ($('#rgStage')) $('#rgStage').textContent = `${p.stage}${p.total > 1 ? ` · ${p.done} / ${p.total}` : ''}`;
        if ($('#rgBar')) $('#rgBar').style.width = `${p.total ? (100 * p.done) / p.total : 5}%`;
      }),
      placeName(lon, lat),
    ]).then(([info, name]) => ({
      id, region: true, lon, lat, half_deg: half, name: name || `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`, country: '', theme: 'agriculture',
      track: info.track, acquisitions: info.acquisitions, box,
    })));
  }
  regions.get(key).then((r) => {
    if (!location.hash.startsWith(`#/region/${lon.toFixed(4)}/${lat.toFixed(4)}`) && !location.hash.startsWith(`#/region/${lon}/${lat}`)) return;
    remember(r);
    openSitePage(sheet, r, tab);
  }).catch((e) => {
    regions.delete(key);
    sheet.innerHTML = sheetHead(`Region ${lat.toFixed(3)}°, ${lon.toFixed(3)}°`) + `<div class="sheet-body"><div class="page"><div class="empty">${esc(e.message)}<br><br><a href="#/region">Pick another point</a></div></div></div>`;
  });
}

// ===================================================================== timeline
// From the first civilian imaging radar in orbit (Seasat, 1978) to today. The scale is piecewise:
// the archive years take the first quarter of the line, NISAR's era (from launch) the rest.
const SEASAT = Date.UTC(1978, 5, 27), LAUNCH = Date.UTC(2025, 6, 30), FIRST_PRODUCTS = Date.UTC(2025, 9, 12);
const ARCHIVE_FRAC = 0.25, STEPS = 10000;
export const MISSIONS = [
  { name: 'Seasat', band: 'L', from: '1978-06-27', to: '1978-10-10', color: '#7dd3fc' },
  { name: 'ERS-1', band: 'C', from: '1991-07-17', to: '2000-03-10', color: '#64748b' },
  { name: 'JERS-1', band: 'L', from: '1992-02-11', to: '1998-10-11', color: '#7dd3fc' },
  { name: 'ERS-2', band: 'C', from: '1995-04-21', to: '2011-07-05', color: '#64748b' },
  { name: 'RADARSAT-1', band: 'C', from: '1995-11-04', to: '2013-03-29', color: '#64748b' },
  { name: 'Envisat', band: 'C', from: '2002-03-01', to: '2012-04-08', color: '#64748b' },
  { name: 'ALOS PALSAR', band: 'L', from: '2006-01-24', to: '2011-04-22', color: '#7dd3fc' },
  { name: 'Sentinel-1', band: 'C', from: '2014-04-03', to: '2099-01-01', color: '#94a3b8' },
  { name: 'ALOS-2 PALSAR-2', band: 'L', from: '2014-05-24', to: '2099-01-01', color: '#7dd3fc' },
  { name: 'SAOCOM-1', band: 'L', from: '2018-10-08', to: '2099-01-01', color: '#7dd3fc' },
  { name: 'NISAR', band: 'L+S', from: '2025-07-30', to: '2099-01-01', color: '#e8b04a' },
].map((m) => ({ ...m, t0: Date.parse(m.from + 'T00:00:00Z'), t1: Date.parse(m.to + 'T00:00:00Z') }));

function toPos(t) {
  const { start, end } = app.tl;
  return t < LAUNCH ? ARCHIVE_FRAC * Math.max(0, (t - start) / (LAUNCH - start)) : ARCHIVE_FRAC + (1 - ARCHIVE_FRAC) * Math.min(1, (t - LAUNCH) / (end - LAUNCH));
}
function fromPos(p) {
  const { start, end } = app.tl;
  return p < ARCHIVE_FRAC ? start + (p / ARCHIVE_FRAC) * (LAUNCH - start) : LAUNCH + ((p - ARCHIVE_FRAC) / (1 - ARCHIVE_FRAC)) * (end - LAUNCH);
}

function buildTimeline() {
  const all = app.mosaic.cycles.flatMap((c) => [tOf(c.start), tOf(c.end)]);
  const start = SEASAT;
  const end = Math.max(Date.now() - DAY, ...all) + 2 * DAY;
  Object.assign(app.tl, { start, end });
  const range = $('#tlRange');
  range.max = STEPS;
  range.addEventListener('input', () => setDay(Math.round((fromPos(+range.value / STEPS) - start) / DAY), 'slider'));
  $('#playBtn').addEventListener('click', togglePlay);
  drawTimeline();
  const lastMosaic = all.length ? Math.max(...all) : end;
  setDay(Math.round((lastMosaic - start) / DAY), 'init');
}

/** One line: radar missions in the archive part (L-band light blue, C-band grey), amber where a NISAR world mosaic exists, white for the open region's passes. */
export function drawTimeline() {
  const { start, end } = app.tl;
  if (!end) return;
  const P = (t) => (toPos(t) * 100).toFixed(3) + '%';
  const segs = [];
  // archive eras: L-band missions drawn over C-band ones
  const lband = MISSIONS.filter((m) => m.band === 'L' && m.t0 < LAUNCH);
  const cband = MISSIONS.filter((m) => m.band === 'C' && m.t0 < LAUNCH);
  for (const m of cband) segs.push([m.t0, Math.min(m.t1, LAUNCH), 'rgba(100,116,139,0.55)']);
  for (const m of lband) segs.push([m.t0, Math.min(m.t1, LAUNCH) + 40 * DAY, 'rgba(125,211,252,0.9)']);
  for (const c of app.mosaic?.cycles || []) segs.push([tOf(c.start) - DAY / 2, tOf(c.end) + DAY / 2, 'rgba(232,176,74,0.75)']);
  segs.push([LAUNCH - DAY, LAUNCH + 2 * DAY, '#e8b04a']);
  const site = app.selectedSite;
  if (site) for (const a of site.acquisitions) segs.push([tOf(a.date) - DAY, tOf(a.date) + DAY, '#ffffff']);
  // flatten overlaps: later entries win
  const cuts = [...new Set(segs.flatMap(([a, b]) => [a, b]))].sort((x, y) => x - y);
  const stops = ['transparent 0%'];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const mid = (cuts[i] + cuts[i + 1]) / 2;
    let col = null;
    for (const [a, b, c] of segs) if (a <= mid && mid < b) col = c;
    if (col) stops.push(`transparent ${P(cuts[i])}`, `${col} ${P(cuts[i])}`, `${col} ${P(cuts[i + 1])}`, `transparent ${P(cuts[i + 1])}`);
  }
  stops.push('transparent 100%');
  $('#tlRange').style.setProperty('--tl-seg', `linear-gradient(90deg, ${stops.join(', ')})`);
}

export function activeMissions(t) { return MISSIONS.filter((m) => m.t0 <= t && t <= m.t1); }

export function setDay(day, source) {
  app.tl.day = day;
  const t = app.tl.start + day * DAY;
  const date = new Date(t);
  if (source !== 'slider') $('#tlRange').value = Math.round(toPos(t) * STEPS);
  const act = activeMissions(t);
  $('#tlDate').textContent = t < LAUNCH ? `${date.getUTCFullYear()}` : fmtDate(t);
  $('#tlDate').title = act.length ? `Imaging radars in orbit: ${act.map((m) => `${m.name} (${m.band})`).join(', ')}` : 'No civilian imaging radar in orbit';
  const m = app.coverage.months.find((x) => x.month === date.toISOString().slice(0, 7));
  app.globe.update(date);
  const cyc = app.globe.cycleAt(date);
  const cycTxt = cyc ? `World mosaic ${fmtShort(tOf(cyc.start))} – ${fmtShort(tOf(cyc.end))}` : '';
  $('#mosaicDates').textContent = cyc ? `${fmtShort(tOf(cyc.start))} – ${fmtShort(tOf(cyc.end))}` : '';
  const milestone = t < LAUNCH ? (act.length ? `${act.map((x) => x.name).join(', ')} in orbit · open a region and its Archive tab for the passes there` : 'No civilian imaging radar in orbit')
    : t < FIRST_PRODUCTS ? (t < LAUNCH + 3 * DAY ? 'NISAR launch, 30 Jul 2025' : 'NISAR commissioning: science products from 12 Oct 2025') : '';
  $('#tlEra').textContent = t < FIRST_PRODUCTS ? milestone : '';
  $('#tlRange').title = [milestone, cycTxt, m ? `${m.total.toLocaleString()} GCOV frames this month` : ''].filter(Boolean).join(' · ');
  if (source !== 'page') app.listeners.forEach((fn) => fn(date));
}

export function setDate(t) {
  setDay(Math.round((t - app.tl.start) / DAY), 'page');
}

function togglePlay() {
  const btn = $('#playBtn');
  if (app.tl.playing) {
    clearInterval(app.tl.timer); app.tl.playing = false; btn.innerHTML = ICON.play; return;
  }
  app.tl.playing = true; btn.innerHTML = ICON.pause;
  let pos = +$('#tlRange').value;
  if (pos >= STEPS - 5) pos = 0;
  app.tl.timer = setInterval(() => {
    pos += 6;                                   // constant speed along the line (faster through the archive years)
    if (pos > STEPS) pos = 0;
    $('#tlRange').value = pos;
    setDay(Math.round((fromPos(pos / STEPS) - app.tl.start) / DAY), 'slider');
  }, 120);
}

function bindLayers() {
  const box = $('#layers');
  $('#layersToggle').addEventListener('click', () => {
    box.classList.toggle('open');
    $('#layersToggle').setAttribute('aria-expanded', box.classList.contains('open'));
  });
  $$('#layersMenu input').forEach((inp) => inp.addEventListener('change', () => {
    app.globe.setLayer(inp.dataset.layer, inp.checked);
    if (inp.dataset.layer === 'landcover') $('#lcLegend').classList.toggle('on', inp.checked);
  }));
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;z-index:99;left:16px;right:16px;top:64px;padding:12px;background:#3a1414;border:1px solid #7a2a2a;border-radius:8px">Could not load data: ${esc(e.message)}</div>`);
});
