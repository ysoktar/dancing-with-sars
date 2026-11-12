import './style.css';
import Chart from 'chart.js/auto';
import { GlobeView, latestBefore } from './globe.js';
import { themeOf, THEMES } from './sites.js';
import { $, $$, DAY, tOf, fmtDate, fmtShort, esc, ICON } from './util.js';
import { openSitePage, closeSitePage } from './pages/site.js';
import { renderSites, renderMethod, renderData } from './pages/static.js';

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
  const [catalog, coverage, motion, events, dem, mosaic] = await Promise.all([
    get('catalog.json', null), get('coverage.json', { months: [] }), get('motion.json', { sites: {} }), get('events.json', { sites: {} }), get('dem.json', {}), get('mosaic.json', { cycles: [] }),
  ]);
  if (!catalog) throw new Error('catalog.json missing: run pipeline/build_data.py');
  Object.assign(app, { catalog, coverage, motion, events, dem, mosaic });
  app.sites = catalog.sites.filter((s) => s.acquisitions?.length >= 2);
  const last = app.sites.flatMap((s) => s.acquisitions.map((a) => a.date)).sort().pop();
  const cyc0 = mosaic.cycles[mosaic.cycles.length - 1];
  $('#barMeta').textContent = (cyc0 ? `World mosaic: ${cyc0.granules.toLocaleString()} frames · ` : '') + `${app.sites.reduce((n, s) => n + s.acquisitions.length, 0)} site passes · latest ${fmtDate(tOf(last))}`;

  app.globe = new GlobeView($('#globeViz'), { base: BASE, onSiteClick: (s) => go(`#/site/${s.id}`) });
  app.globe.setSites(app.sites);
  app.globe.setCoverage(coverage);
  const cyc = mosaic.cycles[mosaic.cycles.length - 1];
  if (cyc) {
    app.globe.setMosaic(cyc);
    $('#mosaicDates').textContent = `${fmtShort(tOf(cyc.start))} – ${fmtShort(tOf(cyc.end))}`;
  } else $('#mosaicLayer').style.display = 'none';
  const evs = [];
  for (const [id, list] of Object.entries(events.sites || {})) {
    for (const e of list) if (e.kind === 'event' && e.lat != null) evs.push({ ...e, site: id, color: eventColor(e.category) });
  }
  app.globe.setEvents(evs);

  buildRail();
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
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.route === (page === 'site' ? 'sites' : page || 'globe')));
  const sheet = $('#sheet');
  if (!page) {
    closeSheet();
    return;
  }
  if (current && current !== 'site') closeSitePage();
  if (page === 'site') {
    const site = app.sites.find((s) => s.id === id);
    if (!site) return go('#/sites');
    $$('.rail-item').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    app.globe.focus(site);
    openSheet();
    openSitePage(sheet, site, tab || 'overview');
    current = 'site';
    return;
  }
  closeSitePage();
  openSheet();
  if (page === 'sites') renderSites(sheet);
  else if (page === 'method') renderMethod(sheet);
  else if (page === 'data') renderData(sheet);
  else return go('#/');
  current = page;
}

function openSheet() {
  document.body.classList.add('sheet-open');
  if (app.tl.playing) togglePlay();
}
function closeSheet() {
  closeSitePage();
  document.body.classList.remove('sheet-open');
  $('#sheet').innerHTML = '';
  $$('.rail-item').forEach((b) => b.classList.remove('on'));
  app.globe.blur();
  current = null;
}

export function sheetHead(title, sub = '') {
  return `<div class="sheet-head"><div><h2 id="sheetTitle">${title}</h2>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    <a class="close" href="#/" aria-label="Close and return to globe">${ICON.close}</a></div>`;
}

// ===================================================================== rail (site list on the globe)
function buildRail() {
  const order = Object.keys(THEMES);
  const groups = {};
  for (const s of app.sites) {
    const th = themeOf(s);
    (groups[th.label] = groups[th.label] || []).push(s);
  }
  const html = Object.entries(groups)
    .sort((a, b) => order.indexOf(a[1][0].theme) - order.indexOf(b[1][0].theme))
    .map(([label, list]) => `<div class="rail-group">${esc(label)}</div>` + list.map((s) =>
      `<button class="rail-item" data-id="${s.id}" style="--c:${themeOf(s).color}"><span class="sw"></span><span><b>${esc(s.name)}</b><small>${esc(s.country)}</small></span><span class="n">${s.acquisitions.length}</span></button>`).join(''))
    .join('');
  $('#railList').innerHTML = html;
  $$('.rail-item').forEach((b) => b.addEventListener('click', () => go(`#/site/${b.dataset.id}`)));
  $$('.rail-item').forEach((b) => b.addEventListener('mouseenter', () => {
    const s = app.sites.find((x) => x.id === b.dataset.id);
    if (s && !document.body.classList.contains('sheet-open')) app.globe.focus(s, 900);
  }));
}

// ===================================================================== timeline
function buildTimeline() {
  const all = app.sites.flatMap((s) => s.acquisitions.map((a) => tOf(a.date)));
  const covStart = app.coverage.months.length ? Date.parse(app.coverage.months[0].month + '-01T00:00:00Z') : Math.min(...all);
  const start = Math.min(covStart, Math.min(...all) - 5 * DAY);
  const end = Math.max(...all) + 2 * DAY;
  Object.assign(app.tl, { start, end });
  const range = $('#tlRange');
  range.max = Math.round((end - start) / DAY);
  range.value = range.max;
  range.addEventListener('input', () => setDay(+range.value, 'slider'));
  $('#playBtn').addEventListener('click', togglePlay);
  window.addEventListener('resize', () => { drawTimeline(); monthLabels(); });
  drawTimeline();
  monthLabels();
  setDay(+range.value, 'init');
}

function monthLabels() {
  const { start, end } = app.tl;
  const box = $('#tlMonths');
  box.innerHTML = '';
  const nMonths = (end - start) / (30.44 * DAY);
  const every = Math.max(1, Math.ceil((nMonths * 40) / Math.max(200, box.clientWidth || 600)));
  const d = new Date(start); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
  let i = 0;
  while (d.getTime() <= end) {
    if (i++ % every === 0) {
      const s = document.createElement('span');
      s.style.left = ((d.getTime() - start) / (end - start)) * 100 + '%';
      s.textContent = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) + (d.getUTCMonth() === 0 ? ` ${d.getUTCFullYear()}` : '');
      box.appendChild(s);
    }
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
}

export function drawTimeline() {
  const cv = $('#tlBars');
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const { start, end } = app.tl;
  const X = (t) => ((t - start) / (end - start)) * w;
  const maxM = Math.max(1, ...app.coverage.months.map((m) => m.total));
  ctx.fillStyle = 'rgba(140,196,255,0.16)';
  for (const m of app.coverage.months) {
    const t0 = Date.parse(m.month + '-01T00:00:00Z');
    const d = new Date(t0); d.setUTCMonth(d.getUTCMonth() + 1);
    const bh = Math.max(1, (m.total / maxM) * h * 0.5);
    ctx.fillRect(X(t0) + 1, h - bh, Math.max(1, X(d.getTime()) - X(t0) - 2), bh);
  }
  const sel = app.selected;
  const rows = app.sites.length;
  app.sites.forEach((s, r) => {
    const on = sel === s.id;
    ctx.fillStyle = themeOf(s).color;
    ctx.globalAlpha = sel ? (on ? 1 : 0.25) : 0.7;
    const y = 1 + (r / rows) * (h * 0.46);
    for (const a of s.acquisitions) ctx.fillRect(X(tOf(a.date)) - 1, y, 2, on ? 4 : 2.5);
  });
  ctx.globalAlpha = 1;
}

export function setDay(day, source) {
  app.tl.day = day;
  const t = app.tl.start + day * DAY;
  const date = new Date(t);
  if (source !== 'slider') $('#tlRange').value = day;
  $('#tlDate').textContent = fmtDate(t);
  const m = app.coverage.months.find((x) => x.month === date.toISOString().slice(0, 7));
  const fresh = app.sites.filter((s) => { const a = latestBefore(s.acquisitions, date); return a && t - tOf(a.date) < 4 * DAY; }).map((s) => s.name);
  $('#tlInfo').textContent = [fresh.length ? `New pass: ${fresh.join(', ')}` : '', m ? `${m.total.toLocaleString()} GCOV frames acquired worldwide this month` : ''].filter(Boolean).join('  ·  ');
  app.globe.update(date);
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
  const max = +$('#tlRange').max;
  if (app.tl.day >= max - 1) setDay(0, 'play');
  app.tl.timer = setInterval(() => {
    let d = app.tl.day + +$('#tlSpeed').value;
    if (d > max) d = 0;
    setDay(d, 'play');
  }, 150);
}

function bindLayers() {
  const box = $('#layers');
  $('#layersToggle').addEventListener('click', () => {
    box.classList.toggle('open');
    $('#layersToggle').setAttribute('aria-expanded', box.classList.contains('open'));
  });
  $$('#layersMenu input').forEach((inp) => inp.addEventListener('change', () => app.globe.setLayer(inp.dataset.layer, inp.checked)));
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;z-index:99;left:16px;right:16px;top:64px;padding:12px;background:#3a1414;border:1px solid #7a2a2a;border-radius:8px">Could not load data: ${esc(e.message)}</div>`);
});
