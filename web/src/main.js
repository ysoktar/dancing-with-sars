import './style.css';
import Chart from 'chart.js/auto';
import { GlobeView, latestBefore } from './globe.js';
import { STORIES, themeOf } from './sites.js';
import { loadStack, render, drawTo, darkSeries, logRatio, robustTrend, maskedMean, SIZE, CLUSTER_COLORS } from './sar.js';
import { pixelFeatures, kmeans, describeCluster, trainAutoencoder } from './ml.js';

const BASE = import.meta.env.BASE_URL;
const DAY = 86400000;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtShort = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const tOf = (s) => new Date(s + 'T12:00:00Z').getTime();

Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(148,163,184,0.12)';
Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
Chart.defaults.font.size = 11;

const state = {
  catalog: null, coverage: null, sites: [], site: null, stack: null, t: 0, cmpT: 0,
  mode: 'rgb', filtered: true, swipe: false, labels: null, kmK: 0, ae: null, pixel: null,
  tl: { start: 0, end: 0, day: 0, playing: false, timer: null },
};
const charts = {};

// ======================================================================= boot
async function boot() {
  const [catalog, coverage] = await Promise.all([
    fetch(BASE + 'data/catalog.json').then((r) => r.json()),
    fetch(BASE + 'data/coverage.json').then((r) => r.json()).catch(() => ({ months: [] })),
  ]);
  state.catalog = catalog;
  state.coverage = coverage;
  state.sites = catalog.sites.filter((s) => s.acquisitions && s.acquisitions.length >= 2);
  $('#genTime').textContent = catalog.generated;

  const nAcq = state.sites.reduce((a, s) => a + s.acquisitions.length, 0);
  $('#stat-acq').textContent = nAcq;
  $('#stat-sites').textContent = state.sites.length;
  $('#stat-global').textContent = coverage.months.reduce((a, m) => a + m.total, 0).toLocaleString();

  state.globe = new GlobeView($('#globeViz'), { base: BASE, onSiteClick: (s) => selectSite(s, { scroll: false, fly: true }) });
  state.globe.setSites(state.sites);
  state.globe.setCoverage(coverage);

  buildSiteList();
  buildTimeline();
  bindLayers();
  bindExplorer();
  bindML();
  buildLearn();

  const first = state.sites.find((s) => s.id === 'sylhet') || state.sites[0];
  selectSite(first, { scroll: false, fly: false });
}

// ======================================================================= site list
function buildSiteList() {
  const ul = $('#siteList');
  const tabs = $('#siteTabs');
  for (const s of state.sites) {
    const th = themeOf(s);
    const li = document.createElement('li');
    li.dataset.id = s.id;
    li.style.setProperty('--c', th.color);
    li.innerHTML = `<span class="sw"></span><div>${s.name}<small>${s.country} · ${th.label}</small></div><span class="n">${s.acquisitions.length}</span>`;
    li.onclick = () => selectSite(s, { scroll: false, fly: true });
    ul.appendChild(li);
    const b = document.createElement('button');
    b.dataset.id = s.id;
    b.style.setProperty('--c', th.color);
    b.innerHTML = `<i></i>${s.name}`;
    b.onclick = () => selectSite(s, { scroll: false, fly: true });
    tabs.appendChild(b);
  }
}

// ======================================================================= timeline
function buildTimeline() {
  const allDates = state.sites.flatMap((s) => s.acquisitions.map((a) => tOf(a.date)));
  const covStart = state.coverage.months.length ? new Date(state.coverage.months[0].month + '-01T00:00:00Z').getTime() : Math.min(...allDates);
  const start = Math.min(covStart, Math.min(...allDates) - 5 * DAY);
  const end = Math.max(...allDates) + 2 * DAY;
  Object.assign(state.tl, { start, end });
  const range = $('#tlRange');
  range.max = Math.round((end - start) / DAY);
  range.value = range.max;
  range.addEventListener('input', () => setDay(+range.value, 'slider'));
  $('#playBtn').onclick = togglePlay;
  window.addEventListener('resize', drawTimelineBars);
  drawTimelineBars();
  // month labels
  const months = $('#tlMonths');
  const nMonths = (end - start) / (30.44 * DAY);
  const every = Math.max(1, Math.ceil((nMonths * 38) / Math.max(200, months.clientWidth || 600)));
  let mi = 0;
  const d = new Date(start); d.setUTCDate(1);
  while (d.getTime() <= end) {
    const t = d.getTime();
    if (t >= start && mi++ % every === 0) {
      const span = document.createElement('span');
      span.style.left = ((t - start) / (end - start)) * 100 + '%';
      span.textContent = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) + (d.getUTCMonth() === 0 ? ' ’' + String(d.getUTCFullYear()).slice(2) : '');
      months.appendChild(span);
    }
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  setDay(+range.value, 'init');
}

function drawTimelineBars() {
  const cv = $('#tlBars');
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const { start, end } = state.tl;
  const X = (t) => ((t - start) / (end - start)) * w;
  // monthly global acquisition volume as soft bars
  const maxM = Math.max(1, ...state.coverage.months.map((m) => m.total));
  for (const m of state.coverage.months) {
    const t0 = new Date(m.month + '-01T00:00:00Z').getTime();
    const t1 = new Date(new Date(t0).setUTCMonth(new Date(t0).getUTCMonth() + 1)).getTime();
    const bh = (m.total / maxM) * (h * 0.55);
    const g = ctx.createLinearGradient(0, h - bh, 0, h);
    g.addColorStop(0, 'rgba(56,189,248,0.35)'); g.addColorStop(1, 'rgba(56,189,248,0.04)');
    ctx.fillStyle = g;
    ctx.fillRect(X(t0) + 1, h - bh, Math.max(1, X(t1) - X(t0) - 2), bh);
  }
  // per-site acquisition ticks
  const rows = state.sites.length;
  state.sites.forEach((s, r) => {
    const sel = state.site && state.site.id === s.id;
    ctx.fillStyle = themeOf(s).color;
    ctx.globalAlpha = sel ? 1 : 0.55;
    const y = 2 + (r / rows) * (h * 0.42);
    for (const a of s.acquisitions) {
      const x = X(tOf(a.date));
      ctx.fillRect(x - (sel ? 1.5 : 1), y, sel ? 3 : 2, sel ? 4 : 3);
    }
  });
  ctx.globalAlpha = 1;
}

function setDay(day, source) {
  state.tl.day = day;
  const t = state.tl.start + day * DAY;
  const date = new Date(t);
  if (source !== 'slider') $('#tlRange').value = day;
  $('#tlDate').textContent = fmtDate(t);
  const month = date.toISOString().slice(0, 7);
  const m = state.coverage.months.find((x) => x.month === month);
  const live = state.sites.filter((s) => { const a = latestBefore(s.acquisitions, date); return a && (t - tOf(a.date)) < 6 * DAY; }).map((s) => s.name);
  $('#tlInfo').textContent = (m ? `${m.total.toLocaleString()} NISAR GCOV frames acquired worldwide in ${date.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })}` : '') +
    (live.length ? ` · new pass: ${live.join(', ')}` : '');
  state.globe.update(date);
  // keep the explorer in step with the timeline
  if (state.stack && source !== 'explorer') {
    const acqs = state.site.acquisitions;
    let k = 0;
    for (let i = 0; i < acqs.length; i++) if (tOf(acqs[i].date) <= t + DAY / 2) k = i;
    if (k !== state.t) setT(k, 'timeline');
  }
}

function togglePlay() {
  const btn = $('#playBtn');
  if (state.tl.playing) {
    clearInterval(state.tl.timer); state.tl.playing = false; btn.textContent = '▶'; return;
  }
  state.tl.playing = true; btn.textContent = '❚❚';
  const max = +$('#tlRange').max;
  if (state.tl.day >= max - 1) setDay(0, 'play');
  state.tl.timer = setInterval(() => {
    const step = +$('#tlSpeed').value;
    let d = state.tl.day + step;
    if (d > max) d = 0;
    setDay(d, 'play');
  }, 140);
}

function bindLayers() {
  $$('.layers input').forEach((inp) => inp.addEventListener('change', () => state.globe.setLayer(inp.dataset.layer, inp.checked)));
}

// ======================================================================= explorer
async function selectSite(site, { scroll = false, fly = true } = {}) {
  if (state.site && state.site.id === site.id && state.stack) { if (fly) state.globe.focus(site); return; }
  state.site = site;
  state.stack = null; state.labels = null; state.ae = null; state.pixel = null;
  const story = STORIES[site.id] || {};
  const th = themeOf(site);
  $$('#siteList li').forEach((li) => li.classList.toggle('active', li.dataset.id === site.id));
  $$('#siteTabs button').forEach((b) => b.classList.toggle('on', b.dataset.id === site.id));
  $('#exTitle').textContent = `${site.name}, ${site.country}`;
  $('#exHeadline').textContent = story.headline || '';
  const chip = $('#exTheme');
  chip.style.setProperty('--c', th.color);
  chip.textContent = `${th.icon} ${th.label}`;
  $('#exStory').innerHTML = story.story || '';
  $('#exDrivers').innerHTML = (story.drivers || []).map((d) => `<li>${d}</li>`).join('');
  $('#exPol').innerHTML = story.pol || '';
  $('#exLook').innerHTML = story.lookFor || '';
  $('#exFuture').innerHTML = story.future || '';
  if (fly) state.globe.focus(site);
  drawTimelineBars();
  if (scroll) $('#explorer').scrollIntoView({ behavior: 'smooth' });

  // reset ML panels
  $('#kmLegend').innerHTML = '<p class="muted">Press <b>Run k-means</b>.</p>';
  $('#cdLegend').innerHTML = '<p class="muted">Pick two dates.</p>';
  $('#aeStatus').textContent = '';
  ['kmCanvas', 'cdCanvas', 'aeCanvas'].forEach((id) => { const c = $('#' + id); c.getContext('2d').clearRect(0, 0, c.width, c.height); });
  if (charts.aeLoss) { charts.aeLoss.destroy(); charts.aeLoss = null; }
  if (charts.aeLatent) { charts.aeLatent.destroy(); charts.aeLatent = null; }
  if (charts.aeRecon) { charts.aeRecon.destroy(); charts.aeRecon = null; }

  const loading = $('#stackLoading');
  loading.classList.add('on');
  const bar = loading.querySelector('i');
  bar.style.width = '0%';
  const stack = await loadStack(site, BASE + 'data/', (p) => (bar.style.width = Math.round(p * 100) + '%'));
  if (state.site !== site) return; // user switched meanwhile
  state.stack = stack;
  loading.classList.remove('on');
  $('#aoiKm').textContent = Math.round(stack.aoiKm);

  // date strip + selectors
  const strip = $('#dateStrip');
  strip.innerHTML = '';
  site.acquisitions.forEach((a, i) => {
    const b = document.createElement('button');
    b.textContent = fmtShort(a.date + 'T12:00:00Z');
    b.title = a.granule;
    b.onclick = () => setT(i, 'explorer');
    strip.appendChild(b);
  });
  const opts = site.acquisitions.map((a, i) => `<option value="${i}">${a.date}</option>`).join('');
  ['#cmpDate', '#cdFrom', '#cdTo'].forEach((s) => ($(s).innerHTML = opts));
  state.cmpT = 0;
  $('#cmpDate').value = 0;
  $('#cdFrom').value = 0;
  $('#cdTo').value = site.acquisitions.length - 1;

  buildSeriesChart();
  // jump the explorer to the date nearest to the timeline position
  const t = state.tl.start + state.tl.day * DAY;
  let k = site.acquisitions.length - 1;
  for (let i = 0; i < site.acquisitions.length; i++) if (tOf(site.acquisitions[i].date) <= t + DAY / 2) k = i;
  setT(k, 'select', true);
  runChange();
}

function setT(t, source, force = false) {
  if (!state.stack) return;
  if (t === state.t && !force) return;
  state.t = t;
  $$('#dateStrip button').forEach((b, i) => { b.classList.toggle('on', i === t); b.classList.toggle('cmp', state.swipe && i === state.cmpT); });
  const on = $('#dateStrip button.on');
  if (on) { const strip = $('#dateStrip'); strip.scrollLeft = on.offsetLeft - strip.clientWidth / 2 + on.clientWidth / 2; }
  renderViewer();
  updateMeta();
  if (charts.ts) charts.ts.update('none');
  if (source === 'explorer') {
    const day = Math.round((tOf(state.site.acquisitions[t].date) - state.tl.start) / DAY);
    setDay(day, 'explorer');
  }
}

function renderViewer() {
  const st = state.stack;
  if (!st) return;
  const extra = { filtered: state.filtered, labels: state.labels, anomaly: state.ae?.err };
  drawTo($('#sarCanvas'), render(st, state.t, state.mode, extra));
  const badge = $('#canvasBadge');
  badge.textContent = `${st.dates[state.t]} · ${state.mode.toUpperCase()}`;
  if (state.swipe) {
    drawTo($('#sarCanvasB'), render(st, state.cmpT, state.mode, extra));
    badge.dataset.cmp = `▸ ${st.dates[state.cmpT]}`;
  }
  drawCrosshair();
}

function updateMeta() {
  const a = state.site.acquisitions[state.t];
  const rows = [
    ['Date (UTC)', a.time.replace('T', ' ').replace('Z', '')],
    ['Granule', a.granule],
    ['Collection', a.collection || '–'],
    ['Track', `path ${a.path} · frame ${a.frame} · ${a.dir?.toLowerCase()}`],
    ['Polarizations', (a.pols || []).join(', ') || 'HH, HV'],
    ['Co-registration', `${a.coregShiftKm?.[0] ?? 0} km N–S, ${a.coregShiftKm?.[1] ?? 0} km E–W`],
    ['Full product', `<a href="${a.h5}" target="_blank" rel="noopener">HDF5</a> (Earthdata login) · <a href="${a.browse}" target="_blank" rel="noopener">browse PNG</a>`],
  ];
  $('#acqMeta').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

function bindExplorer() {
  $$('#modeSeg button').forEach((b) => (b.onclick = () => {
    $$('#modeSeg button').forEach((x) => x.classList.toggle('on', x === b));
    state.mode = b.dataset.mode; renderViewer();
  }));
  $('#leeToggle').onchange = (e) => { state.filtered = e.target.checked; renderViewer(); };
  $('#swipeToggle').onchange = (e) => {
    state.swipe = e.target.checked;
    $('#canvasWrap').classList.toggle('swipe', state.swipe);
    $('#compareRow').classList.toggle('on', state.swipe);
    setT(state.t, 'swipe', true);
  };
  $('#cmpDate').onchange = (e) => { state.cmpT = +e.target.value; setT(state.t, 'swipe', true); };

  const wrap = $('#canvasWrap');
  let dragging = false;
  $('#swipeHandle').addEventListener('pointerdown', (e) => { dragging = true; e.stopPropagation(); e.preventDefault(); });
  window.addEventListener('pointerup', () => (dragging = false));
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = wrap.getBoundingClientRect();
    const p = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    wrap.style.setProperty('--swipe', p + '%');
  });
  wrap.addEventListener('click', (e) => {
    if (!state.stack) return;
    const r = wrap.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * SIZE), y = Math.floor(((e.clientY - r.top) / r.height) * SIZE);
    state.pixel = [x, y];
    drawCrosshair();
    pixelChart();
  });
}

function drawCrosshair() {
  const ch = $('#crosshair');
  if (!state.pixel) { ch.style.display = 'none'; return; }
  ch.style.display = 'block';
  ch.style.left = ((state.pixel[0] + 0.5) / SIZE) * 100 + '%';
  ch.style.top = ((state.pixel[1] + 0.5) / SIZE) * 100 + '%';
}

// current-date marker plugin
const nowLine = {
  id: 'nowLine',
  afterDatasetsDraw(chart, _a, opts) {
    if (!state.stack || !opts.enabled) return;
    const x = chart.scales.x.getPixelForValue(tOf(state.stack.dates[state.t]));
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save(); ctx.strokeStyle = '#facc15'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.restore();
  },
};

const timeAxis = (extra = {}) => ({
  type: 'linear',
  ticks: { callback: (v) => fmtShort(v), maxTicksLimit: 7 },
  grid: { color: 'rgba(148,163,184,0.08)' },
  ...extra,
});

function buildSeriesChart() {
  const st = state.stack;
  const times = st.dates.map(tOf);
  const hh = st.hhF.map((x) => maskedMean(x, st.valid));
  const hv = st.hvF.map((x) => maskedMean(x, st.valid));
  const dark = darkSeries(st);
  const trH = robustTrend(times, hh), trV = robustTrend(times, hv);
  const anomalies = [];
  if (trH) trH.z.forEach((z, i) => { if (Math.abs(z) > 2.5) anomalies.push({ x: times[i], y: hh[i] }); });
  if (trV) trV.z.forEach((z, i) => { if (Math.abs(z) > 2.5) anomalies.push({ x: times[i], y: hv[i] }); });
  const months = (times[times.length - 1] - times[0]) / (30.44 * DAY);
  $('#trendTxt').textContent = trH ? `trend: HH ${(trH.slope * 30.44).toFixed(2)}, HV ${(trV.slope * 30.44).toFixed(2)} DN/month over ${months.toFixed(1)} mo` : '';

  if (charts.ts) charts.ts.destroy();
  const line = (t) => [{ x: times[0], y: t.fit(times[0]) }, { x: times[times.length - 1], y: t.fit(times[times.length - 1]) }];
  charts.ts = new Chart($('#tsChart'), {
    type: 'line',
    data: {
      datasets: [
        { label: 'HH mean', data: times.map((x, i) => ({ x, y: hh[i] })), borderColor: '#ff4fd8', backgroundColor: '#ff4fd8', tension: 0.3, pointRadius: 3, yAxisID: 'y' },
        { label: 'HV mean', data: times.map((x, i) => ({ x, y: hv[i] })), borderColor: '#3ee86b', backgroundColor: '#3ee86b', tension: 0.3, pointRadius: 3, yAxisID: 'y' },
        { label: 'Dark fraction %', data: times.map((x, i) => ({ x, y: dark.frac[i] * 100 })), borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.12)', fill: true, tension: 0.3, pointRadius: 2, yAxisID: 'y1' },
        ...(trH ? [{ label: 'HH trend', data: line(trH), borderColor: 'rgba(255,79,216,0.6)', borderDash: [6, 4], pointRadius: 0, yAxisID: 'y' },
          { label: 'HV trend', data: line(trV), borderColor: 'rgba(62,232,107,0.6)', borderDash: [6, 4], pointRadius: 0, yAxisID: 'y' }] : []),
        { label: 'Anomaly', data: anomalies, type: 'scatter', pointStyle: 'triangle', pointRadius: 8, borderColor: '#facc15', backgroundColor: '#facc15', yAxisID: 'y' },
      ],
    },
    options: {
      maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'nearest', intersect: false },
      onClick: (_e, els) => { if (els.length) { const x = els[0].element.$context.raw.x; const i = times.indexOf(x); if (i >= 0) setT(i, 'explorer'); } },
      scales: {
        x: timeAxis(),
        y: { title: { display: true, text: 'brightness (DN)' } },
        y1: { position: 'right', grid: { display: false }, title: { display: true, text: 'dark %' }, min: 0 },
      },
      plugins: {
        nowLine: { enabled: true },
        legend: { labels: { boxWidth: 10, filter: (it) => !it.text.includes('trend') } },
        tooltip: { callbacks: { title: (it) => fmtDate(it[0].raw.x) } },
      },
    },
    plugins: [nowLine],
  });
  pixelChart();
}

function pixelChart() {
  const st = state.stack;
  if (!st) return;
  const times = st.dates.map(tOf);
  let hh = [], hv = [];
  if (state.pixel) {
    const [x, y] = state.pixel;
    const avg = (arr) => {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= SIZE || yy >= SIZE) continue;
        s += arr[yy * SIZE + xx]; n++;
      }
      return s / n;
    };
    hh = st.hhF.map(avg); hv = st.hvF.map(avg);
    $('#pxTxt').textContent = `pixel (${x}, ${y}), 3×3 mean`;
  }
  if (charts.px) charts.px.destroy();
  charts.px = new Chart($('#pxChart'), {
    type: 'line',
    data: { datasets: [
      { label: 'HH', data: times.map((x, i) => ({ x, y: hh[i] })), borderColor: '#ff4fd8', backgroundColor: '#ff4fd8', tension: 0.3, pointRadius: 2 },
      { label: 'HV', data: times.map((x, i) => ({ x, y: hv[i] })), borderColor: '#3ee86b', backgroundColor: '#3ee86b', tension: 0.3, pointRadius: 2 },
    ] },
    options: { maintainAspectRatio: false, animation: false, parsing: false, scales: { x: timeAxis(), y: { suggestedMin: 0, suggestedMax: 255 } }, plugins: { nowLine: { enabled: true }, legend: { labels: { boxWidth: 10 } } } },
    plugins: [nowLine],
  });
}

// ======================================================================= ML lab
function bindML() {
  $('#kRange').oninput = (e) => ($('#kVal').textContent = e.target.value);
  $('#kmBtn').onclick = runKmeans;
  $('#cdBtn').onclick = runChange;
  $('#aeEpochs').oninput = (e) => ($('#aeEpochsVal').textContent = e.target.value);
  $('#aeBtn').onclick = runAE;
  $('#aeCanvas').addEventListener('click', (e) => {
    if (!state.ae) return;
    const r = e.target.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * SIZE), y = Math.floor(((e.clientY - r.top) / r.height) * SIZE);
    reconChart(y * SIZE + x, x, y);
  });
}

function runKmeans() {
  const st = state.stack;
  if (!st) return;
  const k = +$('#kRange').value;
  const btn = $('#kmBtn');
  btn.disabled = true; btn.textContent = 'Clustering…';
  setTimeout(() => {
    const t0 = performance.now();
    const feat = pixelFeatures(st, state.t);
    const res = kmeans(feat, st.valid, k);
    state.labels = res.labels; state.kmK = k;
    drawTo($('#kmCanvas'), render(st, state.t, 'clusters', { labels: res.labels }));
    const total = res.counts.reduce((a, b) => a + b, 0);
    const theme = (STORIES[state.site.id] || {}).theme;
    const descs = res.centroids.map((c) => describeCluster(c, theme));
    const seen = {};
    descs.forEach((d) => (seen[d.name] = (seen[d.name] || 0) + 1));
    const nth = {};
    descs.forEach((d) => {
      if (seen[d.name] > 1) { nth[d.name] = (nth[d.name] || 0) + 1; d.name += nth[d.name] === 1 ? ' · darker' : nth[d.name] === seen[d.name] ? ' · brighter' : ' · mid'; }
    });
    $('#kmLegend').innerHTML = res.centroids.map((c, i) => {
      const d = descs[i];
      return `<div class="row"><i style="background:${CLUSTER_COLORS[i]}"></i><div><b>${d.name}</b><span>${d.why}</span></div><span class="pct">${((res.counts[i] / total) * 100).toFixed(1)}%</span></div>`;
    }).join('') + `<p class="hint">${k} classes · ${feat.F} features · ${(performance.now() - t0).toFixed(0)} ms · date ${st.dates[state.t]}</p>`;
    btn.disabled = false; btn.textContent = 'Run k-means';
    if (state.ae) drawLatent();
  }, 30);
}

function runChange() {
  const st = state.stack;
  if (!st) return;
  const a = +$('#cdFrom').value, b = +$('#cdTo').value, ch = $('#cdCh').value;
  const res = logRatio(st, a, b, ch);
  drawTo($('#cdCanvas'), render(st, b, 'change', { change: res }));
  const days = Math.round((tOf(st.dates[b]) - tOf(st.dates[a])) / DAY);
  $('#cdLegend').innerHTML = `
    <div class="row"><i style="background:#28d2ff"></i><div><b>Brighter</b><span>More energy returned: vegetation growth, double bounce from new flooding under canopy, refreezing, wetter soil, new structures.</span></div><span class="pct"><span class="big">${(res.inc * 100).toFixed(1)}%</span>${res.incKm2.toFixed(0)} km²</span></div>
    <div class="row"><i style="background:#ff5a3c"></i><div><b>Darker</b><span>Less energy returned: open water, clearing or burning, harvest, wet snow, smoother surface.</span></div><span class="pct"><span class="big">${(res.dec * 100).toFixed(1)}%</span>${res.decKm2.toFixed(0)} km²</span></div>
    <p class="hint">${st.dates[a]} → ${st.dates[b]} (${days} days) · channel ${ch.toUpperCase()} · Otsu |log-ratio| threshold = ${res.thr.toFixed(3)} (≈ ${(Math.exp(res.thr) * 100 - 100).toFixed(0)}% brightness change)</p>`;
}

async function runAE() {
  const st = state.stack;
  if (!st) return;
  const btn = $('#aeBtn');
  btn.disabled = true;
  const epochs = +$('#aeEpochs').value, samples = +$('#aeSamples').value;
  const status = $('#aeStatus');
  status.textContent = 'Loading TensorFlow.js…';
  if (charts.aeLoss) charts.aeLoss.destroy();
  charts.aeLoss = new Chart($('#aeLoss'), {
    type: 'line',
    data: { labels: [], datasets: [
      { label: 'train', data: [], borderColor: '#38bdf8', pointRadius: 0, tension: 0.2 },
      { label: 'validation', data: [], borderColor: '#facc15', pointRadius: 0, tension: 0.2, borderDash: [4, 3] },
    ] },
    options: { maintainAspectRatio: false, animation: false, scales: { y: { type: 'logarithmic', title: { display: true, text: 'MSE' } }, x: { title: { display: true, text: 'epoch' } } }, plugins: { legend: { labels: { boxWidth: 10 } } } },
  });
  const site = state.site;
  const t0 = performance.now();
  try {
    const res = await trainAutoencoder(st, {
      epochs, samples,
      onEpoch: ({ epoch, loss, valLoss }) => {
        if (state.site !== site) return;
        status.textContent = `epoch ${epoch}/${epochs} · loss ${loss.toExponential(2)}`;
        charts.aeLoss.data.labels.push(epoch);
        charts.aeLoss.data.datasets[0].data.push(loss);
        charts.aeLoss.data.datasets[1].data.push(valLoss);
        charts.aeLoss.update('none');
      },
    });
    if (state.site !== site) return;
    state.ae = res;
    status.textContent = `done · ${res.params.toLocaleString()} parameters · ${res.D}-D input (${st.T} dates × 2 pols) · backend ${res.backend} · ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    drawTo($('#aeCanvas'), render(st, state.t, 'anomaly', { anomaly: res.err }));
    if (!state.labels) runKmeans(); else drawLatent();
    // auto-pick the most anomalous pixel for the reconstruction demo
    let best = 0;
    for (let i = 0; i < res.err.length; i++) if (res.err[i] > res.err[best]) best = i;
    reconChart(best, best % SIZE, Math.floor(best / SIZE));
  } catch (e) {
    console.error(e);
    status.textContent = 'Training failed: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

function drawLatent() {
  const ae = state.ae, st = state.stack;
  if (!ae) return;
  const k = state.kmK || 1;
  const groups = Array.from({ length: k }, () => []);
  const stride = 17;
  for (let i = 0; i < SIZE * SIZE; i += stride) {
    if (!st.valid[i]) continue;
    const c = state.labels ? state.labels[i] : 0;
    if (c === 255) continue;
    groups[c % k].push({ x: ae.latent[i * 2], y: ae.latent[i * 2 + 1], i });
  }
  if (charts.aeLatent) charts.aeLatent.destroy();
  charts.aeLatent = new Chart($('#aeLatent'), {
    type: 'scatter',
    data: { datasets: groups.map((g, c) => ({ label: `class ${c + 1}`, data: g, pointRadius: 1.6, backgroundColor: CLUSTER_COLORS[c] + 'cc', borderWidth: 0 })) },
    options: {
      maintainAspectRatio: false, animation: false,
      scales: { x: { title: { display: true, text: 'z₁' } }, y: { title: { display: true, text: 'z₂' } } },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      onClick: (_e, els) => { if (els.length) { const p = els[0].element.$context.raw; reconChart(p.i, p.i % SIZE, Math.floor(p.i / SIZE)); } },
    },
  });
}

function reconChart(i, x, y) {
  const ae = state.ae, st = state.stack;
  const T = st.T, D = ae.D;
  const times = st.dates.map(tOf);
  const real = ae.X.subarray(i * D, i * D + D), rec = ae.recon.subarray(i * D, i * D + D);
  const pct = (() => { let c = 0; for (let j = 0; j < ae.err.length; j++) if (ae.err[j] < ae.err[i]) c++; return (c / ae.err.length) * 100; })();
  $('#aeHint').innerHTML = `Pixel (${x}, ${y}): reconstruction error ${ae.err[i].toFixed(4)}, more unusual than <b>${pct.toFixed(1)}%</b> of the scene. Solid = NISAR observation, dashed = what the network expected.`;
  // mark it on the anomaly canvas
  drawTo($('#aeCanvas'), render(st, state.t, 'anomaly', { anomaly: ae.err }));
  const cv = $('#aeCanvas'), ctx = cv.getContext('2d');
  const sx = cv.width / SIZE;
  ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc((x + 0.5) * sx, (y + 0.5) * sx, 12, 0, Math.PI * 2); ctx.stroke();
  if (charts.aeRecon) charts.aeRecon.destroy();
  const pts = (arr, off) => times.map((t, k) => ({ x: t, y: arr[off + k] * 255 }));
  charts.aeRecon = new Chart($('#aeRecon'), {
    type: 'line',
    data: { datasets: [
      { label: 'HH observed', data: pts(real, 0), borderColor: '#ff4fd8', backgroundColor: '#ff4fd8', pointRadius: 2, tension: 0.25 },
      { label: 'HH reconstructed', data: pts(rec, 0), borderColor: 'rgba(255,79,216,0.6)', borderDash: [5, 4], pointRadius: 0, tension: 0.25 },
      { label: 'HV observed', data: pts(real, T), borderColor: '#3ee86b', backgroundColor: '#3ee86b', pointRadius: 2, tension: 0.25 },
      { label: 'HV reconstructed', data: pts(rec, T), borderColor: 'rgba(62,232,107,0.6)', borderDash: [5, 4], pointRadius: 0, tension: 0.25 },
    ] },
    options: { maintainAspectRatio: false, animation: false, parsing: false, scales: { x: timeAxis(), y: { suggestedMin: 0, suggestedMax: 255 } }, plugins: { legend: { labels: { boxWidth: 10 } } } },
  });
}

// ======================================================================= Radar 101
const BANDS = {
  X: { depth: 0.08, txt: '<b>X-band (3 cm)</b> bounces off the top leaves. Good for fine detail and urban mapping, but it cannot see below the canopy surface.' },
  C: { depth: 0.25, txt: '<b>C-band (5.6 cm)</b>, as on Sentinel-1, reaches the upper canopy. It is the workhorse for floods over open land, ships and sea ice, but it saturates over dense forest.' },
  S: { depth: 0.5, txt: '<b>S-band (10 cm)</b>, ISRO’s radar on NISAR, reaches into the branches. It is sensitive to crops, young forest and soil moisture under light vegetation.' },
  L: { depth: 1.0, txt: '<b>L-band (24 cm)</b>, NASA’s radar on NISAR, passes through the leaves to the trunks and the ground. It detects water <i>under</i> the forest (double bounce), measures biomass, and stays coherent over vegetation for interferometry.' },
};
function buildLearn() {
  const svg = $('#canopySvg');
  const trees = [];
  for (let i = 0; i < 9; i++) {
    const x = 40 + i * 65 + (i % 2) * 8, h = 120 + (i % 3) * 18;
    trees.push(`<rect x="${x - 4}" y="${250 - h + 60}" width="8" height="${h - 60}" fill="#78350f"/>`);
    trees.push(`<ellipse cx="${x}" cy="${250 - h + 40}" rx="${34 + (i % 2) * 6}" ry="${52}" fill="#166534" opacity="0.85"/>`);
    trees.push(`<ellipse cx="${x - 10}" cy="${250 - h + 30}" rx="18" ry="24" fill="#15803d" opacity="0.7"/>`);
  }
  const draw = (band) => {
    const b = BANDS[band];
    const topY = 70, groundY = 250;
    const stopY = topY + (groundY - topY) * b.depth;
    const waves = [];
    for (let k = 0; k < 4; k++) {
      const x0 = 70 + k * 130;
      const wl = { X: 6, C: 10, S: 16, L: 30 }[band];
      let d = `M ${x0} 0`;
      for (let y = 0; y < stopY; y += 2) d += ` L ${x0 + Math.sin((y / wl) * Math.PI * 2) * 6 + y * 0.25} ${y}`;
      waves.push(`<path d="${d}" stroke="#facc15" stroke-width="2" fill="none" opacity="0.9"/>`);
      const ex = x0 + stopY * 0.25;
      waves.push(`<circle cx="${ex}" cy="${stopY}" r="5" fill="#facc15"><animate attributeName="r" values="3;9;3" dur="1.6s" repeatCount="indefinite"/></circle>`);
      if (band === 'L') waves.push(`<path d="M ${ex} ${stopY} L ${ex + 18} ${stopY - 2} L ${ex + 18} ${stopY - 80}" stroke="#f43f5e" stroke-width="2" fill="none" stroke-dasharray="4 3"/>`);
    }
    svg.innerHTML = `
      <rect x="0" y="250" width="600" height="50" fill="#3f2a14"/>
      <rect x="0" y="250" width="600" height="6" fill="#0ea5e9" opacity="${band === 'L' ? 0.8 : 0.3}"/>
      ${trees.join('')}
      ${waves.join('')}
      <text x="12" y="20" fill="#e2e8f0" font-size="14" font-family="Space Grotesk">${band}-band pulse</text>
      <text x="12" y="290" fill="#94a3b8" font-size="11">flooded forest floor</text>`;
    $('#bandTxt').innerHTML = b.txt;
  };
  $$('#bandSeg button').forEach((btn) => (btn.onclick = () => {
    $$('#bandSeg button').forEach((x) => x.classList.toggle('on', x === btn));
    draw(btn.dataset.band);
  }));
  draw('L');
}

boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('afterbegin', `<div style="position:fixed;z-index:999;top:60px;left:20px;right:20px;padding:12px;background:#7f1d1d;color:#fff;border-radius:8px">Failed to load data: ${e.message}</div>`);
});
