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
      ${ramp('#000', '#f0f', 'HH → red + blue')}${ramp('#000', '#0f0', 'HV → green')}
      <div class="lg-row lg-ends"><span>0</span><span>browse brightness</span><span>255</span></div>`;
  },
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
const ORDER = ['mtc', 'mosaic', 'landcover', 'density', 'events', 'satellite', 'night'];

export function updateLegend(globe, el) {
  if (!el || !globe) return;
  const parts = ORDER.filter((k) => globe.layers[k]).map((k) => SECTIONS[k](globe)).filter(Boolean);
  if (globe.boxShown) parts.push(`<b>Selected area</b><div class="lg-grid">${sw('transparent', 'drawn rectangle', ';border:2px solid #e8b04a')}</div>`);
  const open = !el.classList.contains('collapsed');
  el.innerHTML = `<button class="lg-head" aria-expanded="${open}">Legend</button><div class="lg-body">${parts.map((p) => `<section>${p}</section>`).join('') || '<div class="lg-note">No layer on.</div>'}</div>`;
  el.querySelector('.lg-head').onclick = () => { el.classList.toggle('collapsed'); updateLegend(globe, el); };
}
export { esc };
