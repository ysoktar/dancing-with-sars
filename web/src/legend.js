// Map legend (bottom right): one section per active globe layer, rebuilt when layers or the timeline change.
import { esc } from './util.js';

const fmt = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
const ramp = (a, b, label) => `<div class="lg-ramp"><div class="lg-bar" style="background:linear-gradient(90deg,${a},${b})"></div><span>${label}</span></div>`;
const sw = (c, label, extra = '') => `<span class="lg-item"><i style="background:${c}${extra}"></i>${label}</span>`;

const SECTIONS = {
  mtc: (g) => {
    const cyc = g.mtcInfo;
    if (!cyc) return `<b>Multi-date composite</b><div class="lg-note">Needs three 12-day cycles before this date.</div>`;
    return `<b>Multi-date composite · HH backscatter</b>
      ${ramp('#000', '#f00', `R · ${fmt(cyc[0].start)}`)}${ramp('#000', '#0f0', `G · ${fmt(cyc[1].start)}`)}${ramp('#000', '#00f', `B · ${fmt(cyc[2].start)}`)}
      <div class="lg-row lg-ends"><span>low (≤ 90)</span><span>browse brightness</span><span>high (≥ 240)</span></div>
      <div class="lg-note">Equal on all three dates → grey/white; a colour means the surface changed between dates. Fixed mapping everywhere: stretch 90–240, gamma 1.4, date differences ×2.</div>`;
  },
  mosaic: (g) => {
    if (g.layers.mtc && g.mtcInfo) return '';
    const c = g.currentCycle;
    return `<b>NISAR world mosaic${c ? ` · ${fmt(c.start)} – ${fmt(c.end)}` : ''}</b>
      ${ramp('#000', '#f00', 'R · HH')}${ramp('#000', '#0f0', 'G · HV')}${ramp('#000', '#00f', 'B · HH/HV')}
      <div class="lg-note">Fixed ranges of the browse values, the same everywhere: HH 140–255 (γ 1.5), HV 60–230, HH/HV as HH−HV −20…+60. L-band convention as in the JAXA PALSAR mosaics: forest → green (strong HV), fields and bare soil → blue (HH ≫ HV), towns / flooded vegetation → bright, water → black.</div>`;
  },
  change: (g) => (g.metricInfo?.prev ? `<b>Change since the previous cycle</b>
      ${ramp('#ff8a4d', '#ff2633', 'darker: cleared, harvested, flooded, melting')}${ramp('#4dccE6', '#33ffff', 'brighter: crops growing, new structures, refreezing')}
      <div class="lg-note">${fmt(g.metricInfo.prev.start)} → ${fmt(g.metricInfo.cur.start)}. Mean of the HH and HV change; changes under 20 browse units (normal pass-to-pass noise) are not shown. Patches with straight edges follow satellite swaths: the change happened between two passes (snowfall, rain, harvest).</div>` : '<b>Change since the previous cycle</b><div class="lg-note">Needs an earlier full cycle.</div>'),
  water: () => `<b>Water &amp; wet surfaces</b>${ramp('rgba(38,140,255,0.35)', '#268cff', 'dark in HH and HV: open water, floods, wet paddies')}
      <div class="lg-note">Smooth dry sand and radar shadow can look the same.</div>`,
  variability: () => `<b>Seasonal variability</b>${ramp('#141e46', '#fadc3c', 'how much the plant signal (HV relative to HH) changes')}
      <div class="lg-row lg-ends"><span>steady: forest, desert, ice</span><span>changing: fields</span></div>
      <div class="lg-note">Robust spread of HV − HH over the full 12-day cycles since June 2026; using the ratio cancels most differences between satellite tracks.</div>`,
  melt: () => `<b>Snow &amp; ice melt</b>${ramp('#96d2ff', '#5a14c8', 'how deep the radar dropped when the snow was wettest')}
      <div class="lg-note">Cold regions only (above ~2,000 m or beyond 60°). Wet snow and melting ice swallow L-band; a deep drop marks strong melt.</div>`,
  maincrop: () => `<b>Main crop</b> <span class="lg-note">(SPAM 2010, 0.25°)</span>
      <div class="lg-grid">${sw('#e6be46', 'wheat')}${sw('#28c8dc', 'rice')}${sw('#fa7828', 'maize')}${sw('#b45ac8', 'soybean')}${sw('#82dc3c', 'sugarcane')}${sw('#c8a06e', 'barley')}${sw('#f0f0f0', 'cotton')}${sw('#c85050', 'sorghum')}${sw('#966e3c', 'millet')}${sw('#6e4628', 'cassava')}${sw('#147832', 'oil palm')}${sw('#3ca05a', 'vegetables')}</div>
      <div class="lg-note">The crop with the largest share of each cell's crop land; fainter = less cropland.</div>`,
  landslides: () => `<b>Landslide history</b> <span class="lg-note">(NASA Global Landslide Catalog, 1988–2017)</span>
      <div class="lg-grid">${sw('#ff783c', 'reported')}${sw('#ff3c28', '1–9 deaths')}${sw('#dc143c', '10+ deaths')}</div>`,
  landcover: () => `<b>Cropland &amp; forest</b> <span class="lg-note">(NISAR mosaics, Jun–Nov 2026)</span>
      <div class="lg-grid">${sw('#e8b04a', 'cropland: strong seasonal swing')}${sw('#15803d', 'forest: high HV, steady')}
        ${sw('#84cc16', 'tree crops / mixed')}${sw('#a8a29e', 'grass / bare / built')}</div>`,
  density: () => `<b>NISAR frames per month</b>
      <div class="lg-bar" style="background:linear-gradient(90deg,#1e3a8a,#2563eb,#22d3ee,#fde047,#f97316)"></div>
      <div class="lg-row lg-ends"><span>few</span><span>many (3° cells)</span></div>`,
  events: () => `<b>Natural events (NASA EONET)</b>
      <div class="lg-grid">${sw('#3fb8ff', 'flood')}${sw('#ff6a4d', 'wildfire')}${sw('#ff3d6e', 'volcano')}${sw('#b48cff', 'storm')}${sw('#c8f0ff', 'ice')}${sw('#e8b04a', 'other')}</div>`,
  satellite: (g) => (g.date && g.date.getTime() < Date.UTC(2025, 6, 30) ? '' : `<b>NISAR satellite</b>
      <div class="lg-grid">${sw('#ffd166', 'position (accelerated clock)')}${sw('rgba(255,209,102,0.5)', 'ground track')}${sw('rgba(56,189,248,0.45)', '~242 km L-band swath (left-looking)')}</div>`),
  night: () => `<b>Night lights</b> <span class="lg-note">(NASA Black Marble)</span>`,
};
const ORDER = ['change', 'water', 'variability', 'melt', 'maincrop', 'landslides', 'mtc', 'mosaic', 'landcover', 'density', 'events', 'satellite', 'night'];

export function updateLegend(globe, el) {
  if (!el || !globe) return;
  const parts = ORDER.filter((k) => globe.layers[k]).map((k) => SECTIONS[k](globe)).filter(Boolean);
  if (globe.boxShown) parts.push(`<b>Selected area</b><div class="lg-grid">${sw('transparent', 'drawn rectangle', ';border:2px solid #e8b04a')}</div>`);
  const open = !el.classList.contains('collapsed');
  el.innerHTML = `<button class="lg-head" aria-expanded="${open}">Legend</button><div class="lg-body">${parts.map((p) => `<section>${p}</section>`).join('') || '<div class="lg-note">No layer on.</div>'}</div>`;
  el.querySelector('.lg-head').onclick = () => { el.classList.toggle('collapsed'); updateLegend(globe, el); };
}
export { esc };
