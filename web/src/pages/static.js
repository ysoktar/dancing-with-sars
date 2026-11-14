import { app, sheetHead } from '../main.js';
import { STORIES, themeOf } from '../sites.js';
import { $$, tOf, fmtDate, fmtShort, esc } from '../util.js';

// ------------------------------------------------------------------ Sites
export function renderSites(sheet) {
  const cards = app.sites.map((s) => {
    const th = themeOf(s);
    const a = s.acquisitions, last = a[a.length - 1];
    const mo = app.motion.sites?.[s.id] || {};
    const chips = [
      `<span class="tag" style="--c:${th.color}"><i></i>${th.label}</span>`,
      mo.GUNW?.length ? '<span class="tag">Interferograms</span>' : '',
      mo.GOFF?.length ? '<span class="tag">Offsets</span>' : '',
    ].join('');
    return `<a class="card" href="#/site/${s.id}">
      <img src="${app.base}data/${last.frameImg}" alt="" loading="lazy">
      <div class="c-body">
        <h3>${esc(s.name)}</h3>
        <p>${esc(s.country)} · ${a.length} passes · ${fmtShort(tOf(a[0].date))} – ${fmtShort(tOf(last.date))}</p>
        <p>${esc(STORIES[s.id]?.headline || '')}</p>
        <div class="chips">${chips}</div>
      </div></a>`;
  }).join('');
  sheet.innerHTML = sheetHead('Study sites', `${app.sites.length} places where NISAR is watching the surface change`) +
    `<div class="sheet-body"><div class="page"><div class="cards">${cards}</div></div></div>`;
}

// ------------------------------------------------------------------ What radar can tell
const CAP = [
  {
    c: 'var(--ok)', h: 'Measured directly', p: 'NISAR observes these itself, day or night, through cloud.',
    items: [
      ['Ground motion', 'Sinking, uplift, earthquake and volcanic deformation, to centimetres, along the line of sight (GUNW interferograms).'],
      ['Ice motion', 'Glacier flow speed and direction from pixel offsets (GOFF).'],
      ['Open water and floods', 'Calm water is dark; water under trees is bright (double bounce).'],
      ['Vegetation structure', 'Forest loss, burn scars and crop growth change the HV (volume) signal.'],
      ['Melt and freeze', 'Wet snow absorbs microwaves; refrozen firn scatters strongly.'],
      ['Ships and slicks at sea', 'Ships are bright points, oil slicks dark patches (Sentinel-1 covers oceans better than NISAR).'],
    ],
  },
  {
    c: 'var(--warn)', h: 'Estimated with other data', p: 'Radar is one input; a model or another dataset does the rest.',
    items: [
      ['Crop type and yield', 'Needs labelled fields, weather and harvest statistics.'],
      ['Soil moisture', 'Needs vegetation correction; NISAR\'s validated soil-moisture product is not released yet.'],
      ['Flood forecasting', 'Needs rainfall (GPM), terrain and a hydrological model.'],
      ['Groundwater loss', 'Subsidence hints at it; wells or GRACE gravity confirm it.'],
      ['Urban growth and population', 'Built-up area is visible; population needs census data.'],
      ['Untracked fishing', 'Radar ships without an AIS signal are leads, not proof of illegal activity.'],
    ],
  },
  {
    c: 'var(--no)', h: 'Not measurable by radar', p: 'Better served by other instruments, and radar can still add context.',
    items: [
      ['Greenhouse gases, SO₂, NO₂', 'Atmospheric spectrometers such as Sentinel-5P / TROPOMI.'],
      ['Acid rain, rainfall amount', 'Weather radar, GPM and chemistry models.'],
      ['Mineral composition', 'Imaging spectrometers such as NASA EMIT.'],
      ['Counting people or animals', 'Far below what a 3–10 m radar pixel resolves.'],
      ['Exact earthquake or eruption time', 'Not reliably predictable by any method today.'],
      ['Detailed 3-D city models', 'LiDAR and photogrammetry are far more detailed.'],
    ],
  },
];

export function renderMethod(sheet) {
  sheet.innerHTML = sheetHead('What radar can tell', 'And where it needs help') + `
  <div class="sheet-body"><div class="page">
    <p class="lead" style="margin-bottom:18px">NISAR sends microwave pulses and records the echo. The echo depends mostly on surface <b>roughness</b> and <b>wetness</b> (dielectric constant), and its phase records tiny <b>movements</b> between passes. That makes radar very good at some questions and blind to others.</p>
    <div class="cap">${CAP.map((col) => `<div class="panel col" style="--c:${col.c}"><h3>${col.h}</h3><p>${col.p}</p><ul>${col.items.map(([b, t]) => `<li><b>${b}</b>${t}</li>`).join('')}</ul></div>`).join('')}</div>

    <div class="grid g-2" style="margin-top:16px">
      <div class="panel">
        <h3>Wavelength decides what you see</h3>
        <div class="seg" id="band" style="margin:6px 0 10px">
          <button data-b="X">X · 3 cm</button><button data-b="C">C · 5.6 cm</button><button data-b="S">S · 10 cm</button><button data-b="L" class="on">L · 24 cm</button>
        </div>
        <svg class="diagram" id="canopy" viewBox="0 0 600 260" role="img" aria-label="How far radar waves reach into a forest"></svg>
        <p class="muted small" id="bandTxt" style="margin-top:8px"></p>
      </div>
      <div class="panel">
        <h3>Three ways a surface sends the pulse back</h3>
        <table class="t">
          <tr><th>Mechanism</th><th>Example</th><th>Radar sees</th></tr>
          <tr><td>Surface</td><td>Calm water, smooth soil</td><td>Dark (pulse reflected away); rough soil brighter. Mostly HH.</td></tr>
          <tr><td>Double bounce</td><td>Buildings, flooded forest</td><td>Very bright HH: ground and wall act as a corner reflector.</td></tr>
          <tr><td>Volume</td><td>Forest canopy, dry snow</td><td>Many scatterings scramble polarization: strong HV.</td></tr>
        </table>
        <h3 style="margin-top:16px">NISAR in numbers</h3>
        <dl class="kv">
          <dt>Launch</dt><dd>30 July 2025, GSLV-F16, Sriharikota</dd>
          <dt>Orbit</dt><dd>747 km, sun-synchronous, 98.4°</dd>
          <dt>Revisit</dt><dd>12 days, ascending and descending</dd>
          <dt>Radars</dt><dd>L-band 24 cm (NASA), S-band 10 cm (ISRO)</dd>
          <dt>Swath</dt><dd>~242 km, 12 m mesh reflector</dd>
          <dt>Products</dt><dd>GCOV backscatter · GUNW interferograms · GOFF offsets · GSLC / RSLC</dd>
        </dl>
      </div>
    </div>
  </div></div>`;
  band('L');
  $$('#band button').forEach((b) => b.addEventListener('click', () => { $$('#band button').forEach((x) => x.classList.toggle('on', x === b)); band(b.dataset.b); }));
}

const BANDS = {
  X: [0.1, 'X-band (3 cm) bounces off the top leaves. Fine detail, no view below the canopy.'],
  C: [0.28, 'C-band (5.6 cm, Sentinel-1) reaches the upper canopy. The workhorse for floods over open land and for sea ice; it saturates over dense forest.'],
  S: [0.55, 'S-band (10 cm, ISRO on NISAR) reaches into the branches. Sensitive to crops, young forest and soil moisture under light vegetation.'],
  L: [1, 'L-band (24 cm, NASA on NISAR) passes through to trunks and ground. It detects water under the forest, tracks biomass, and stays coherent over vegetation for interferometry.'],
};
function band(b) {
  const [depth, txt] = BANDS[b];
  const top = 60, ground = 215, stop = top + (ground - top) * depth;
  let trees = '';
  for (let i = 0; i < 9; i++) {
    const x = 40 + i * 66, h = 115 + (i % 3) * 14;
    trees += `<rect x="${x - 3}" y="${ground - h + 50}" width="6" height="${h - 50}" fill="#5b4632"/><ellipse cx="${x}" cy="${ground - h + 38}" rx="32" ry="46" fill="#2f5d3a"/>`;
  }
  let waves = '';
  for (let k = 0; k < 4; k++) {
    const x0 = 80 + k * 135, wl = { X: 6, C: 10, S: 16, L: 28 }[b];
    let d = `M ${x0} 0`;
    for (let y = 0; y < stop; y += 2) d += ` L ${(x0 + Math.sin((y / wl) * Math.PI * 2) * 5 + y * 0.22).toFixed(1)} ${y}`;
    const ex = x0 + stop * 0.22;
    waves += `<path d="${d}" stroke="#e8b04a" stroke-width="1.8" fill="none"/><circle cx="${ex}" cy="${stop}" r="4" fill="#e8b04a"/>`;
    if (b === 'L') waves += `<path d="M ${ex} ${stop} L ${ex + 16} ${stop} L ${ex + 16} ${stop - 70}" stroke="#ff6a4d" stroke-width="1.6" fill="none" stroke-dasharray="4 3"/>`;
  }
  document.getElementById('canopy').innerHTML = `<rect x="0" y="${ground}" width="600" height="45" fill="#2c2419"/><rect x="0" y="${ground}" width="600" height="4" fill="#3fb8ff" opacity="${b === 'L' ? 0.9 : 0.35}"/>${trees}${waves}
    <text x="12" y="${ground + 30}" fill="#8a94a3" font-size="11" font-family="Inter">flooded forest floor${b === 'L' ? ': reached (red = double bounce back to the satellite)' : ''}</text>`;
  document.getElementById('bandTxt').textContent = txt;
}

// ------------------------------------------------------------------ Data & methods
export function renderData(sheet) {
  const c = app.catalog;
  const nMo = Object.values(app.motion.sites || {}).reduce((n, m) => n + (m.GUNW?.length || 0) + (m.GOFF?.length || 0), 0);
  sheet.innerHTML = sheetHead('Data & methods', `Catalog built ${fmtDate(Date.parse(c.generated))}`) + `
  <div class="sheet-body"><div class="page">
    <div class="grid g-2">
      <div class="stack">
        <div class="panel">
          <h3>Where the data comes from</h3>
          <ol class="steps">
            <li><b>NISAR L2 GCOV</b> (backscatter, HH + HV): ${app.sites.reduce((n, s) => n + s.acquisitions.length, 0)} passes over ${app.sites.length} sites, found with the ASF DAAC search API. One orbit track per site keeps the viewing geometry identical on every date.</li>
            <li><b>NISAR L2 GUNW and GOFF</b> (interferograms, pixel offsets): ${nMo} image pairs on the same tracks.</li>
            <li>The images are the geocoded browse renderings ASF publishes with each product (<code>*_LATLON.png</code>), cropped to each site.</li>
            <li>Provisional products ship without exact bounds, so every date is aligned to a reference pass by <b>FFT phase correlation</b> (residual ≤ 2 px).</li>
            <li><b>World mosaics</b>: for each of ${app.mosaic?.cycles?.length || 0} complete 12-day repeat cycles, every GCOV frame (${(app.mosaic?.cycles || []).reduce((n, c) => n + c.granules, 0).toLocaleString()} frames in total, ~60 GB of browse images streamed per cycle) is georeferenced from its footprint and painted onto a 2.8 km global grid. The globe shows the cycle that matches the timeline date. Dual-pol HH/HV frames are painted last so they win in overlaps. Open ocean is masked (noise), polar seas are kept (sea ice). Each frame is contrast-stretched on its own, so brightness steps between neighbouring frames are visible.</li>
            <li><b>Global acquisition density</b>: NASA CMR footprints, sampled four days per month on a 3° grid.</li>
            <li><b>Context</b>: NASA EONET events, USGS earthquakes, GDELT news; optical images from NASA GIBS (MODIS Terra).</li>
            <li><b>Elevation</b>: Copernicus DEM GLO-30 (30 m, AWS Open Data) cropped to each site, used for shaded relief and the 3-D view.</li>
            <li>A GitHub Actions workflow refreshes everything weekly and redeploys the site.</li>
            <li>Going global: see <a href="https://github.com/ysoktar/dancing-with-sars/blob/main/docs/GLOBAL_DATA.md" target="_blank" rel="noopener">docs/GLOBAL_DATA.md</a> for the size of the full NISAR archive and worldwide elevation, and how to process them.</li>
          </ol>
        </div>
        <div class="panel">
          <h3>Analysis methods</h3>
          <table class="t">
            <tr><th>Tool</th><th>Method</th><th>Output</th></tr>
            <tr><td>Speckle reduction</td><td>Lee adaptive filter, 5×5</td><td>cleaner images</td></tr>
            <tr><td>Change detection</td><td>log-ratio, Otsu threshold</td><td>change map, km², per-pixel confidence</td></tr>
            <tr><td>Surface types</td><td>k-means++ on 6 features</td><td>groups, physical reading, confidence</td></tr>
            <tr><td>Forecast</td><td>Theil–Sen trend + residual bootstrap</td><td>80 / 95% ranges, backtest vs. persistence</td></tr>
          </table>
        </div>
      </div>
      <div class="stack">
        <div class="panel">
          <h3>Limitations</h3>
          <ul class="plain">
            <li>Browse images are 8-bit renderings (~150 m pixels), not calibrated γ⁰ at 10–20 m. Numbers here are <b>relative brightness</b>; <code>pipeline/fetch_hdf5.py</code> extracts calibrated values with a free Earthdata login.</li>
            <li>Most products are labelled <i>provisional</i> by the NISAR project. Validated L-band products start from 21 October 2026, so the record is short and multi-year analysis needs Sentinel-1 or Landsat history.</li>
            <li>Interferogram and offset images are pictures of the measurement. Motion values need the HDF5 files.</li>
            <li>The ML results are unsupervised and point to places worth checking. They are not validated maps.</li>
            <li>News and event matches are context, not validation.</li>
          </ul>
        </div>
        <div class="panel">
          <h3>Challenge resources</h3>
          <table class="t">
            <tr><th>Resource</th><th>What it gives you</th></tr>
            <tr><td><a href="https://search.asf.alaska.edu/" target="_blank" rel="noopener">ASF Vertex</a></td><td>NASA's SAR archive; every NISAR product used here (GCOV, GUNW, GOFF).</td></tr>
            <tr><td><a href="https://search.earthdata.nasa.gov/search" target="_blank" rel="noopener">NASA Earthdata Search</a></td><td>Search all NASA Earth data (NISAR, optical, GPM rainfall, SMAP soil moisture…).</td></tr>
            <tr><td><a href="https://nisar-docs.asf.alaska.edu/" target="_blank" rel="noopener">NISAR Data User Guide</a></td><td>Product formats, access and processing for NISAR.</td></tr>
            <tr><td><a href="https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar" target="_blank" rel="noopener">Intro to SAR</a> · <a href="https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/remote-sensing" target="_blank" rel="noopener">Intro to remote sensing</a></td><td>Wavelength, polarization, scattering, resolution.</td></tr>
            <tr><td><a href="https://appliedsciences.nasa.gov/get-involved/training" target="_blank" rel="noopener">NASA ARSET trainings</a></td><td>Free courses on SAR and NISAR for disasters, agriculture, water and ecosystems.</td></tr>
            <tr><td><a href="https://nisar.jpl.nasa.gov/applications/arcgis-storymaps/" target="_blank" rel="noopener">NISAR StoryMaps</a></td><td>Floods, wildfires, land subsidence, oil slicks and glacier motion, explained with SAR.</td></tr>
            <tr><td><a href="https://nisar.jpl.nasa.gov/applications/societal-benefit/" target="_blank" rel="noopener">NISAR applications white papers</a></td><td>Two-page summaries of NISAR's societal applications.</td></tr>
            <tr><td><a href="https://uavsar.jpl.nasa.gov/education/postcards.html" target="_blank" rel="noopener">UAVSAR postcards</a></td><td>Airborne L-band false-colour examples, the same colour logic as this site's radar images.</td></tr>
          </table>
          <h3 style="margin-top:14px">Other SAR missions (partner agencies)</h3>
          <table class="t">
            <tr><th>Mission</th><th>Band</th><th>Access</th></tr>
            <tr><td><a href="https://donnees-data.asc-csa.gc.ca/en/dataset/rcm" target="_blank" rel="noopener">RADARSAT Constellation (CSA)</a></td><td>C</td><td>maritime, ice, disasters, ecosystems; registration</td></tr>
            <tr><td><a href="https://donnees-data.asc-csa.gc.ca/en/dataset/radarsat1" target="_blank" rel="noopener">RADARSAT-1 archive (CSA)</a></td><td>C</td><td>1995–2013, open licence: decades of history before NISAR</td></tr>
            <tr><td><a href="https://catalogos.conae.gov.ar/catalogo/catalogoSatSaocomInfo.html" target="_blank" rel="noopener">SAOCOM (CONAE)</a></td><td>L</td><td>same wavelength as NISAR; strong over Argentina, where YieldSAT has fields; ONE CLICK registration</td></tr>
          </table>
          <p class="note">These archives need an account, so they are linked here rather than built into the site. <a href="https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial" target="_blank" rel="noopener">CSA's SAR Python tutorial</a> shows how to work with them.</p>
        </div>
        <div class="panel">
          <h3>Run it yourself</h3>
<pre>pip install -r pipeline/requirements.txt
python pipeline/build_data.py     # GCOV, ~10 min
python pipeline/build_motion.py   # GUNW + GOFF
python pipeline/build_events.py   # events and news
python pipeline/build_dem.py      # 30 m elevation
python pipeline/build_mosaic.py   # world mosaic, ~60 GB streamed, ~40 min
cd web && npm ci && npm run dev</pre>
          <p class="note">Source code: <a href="https://github.com/ysoktar/dancing-with-sars" target="_blank" rel="noopener">github.com/ysoktar/dancing-with-sars</a> · Data: NASA/JPL-Caltech &amp; ISRO via <a href="https://search.asf.alaska.edu" target="_blank" rel="noopener">ASF DAAC</a> · <a href="https://nisar-docs.asf.alaska.edu/" target="_blank" rel="noopener">NISAR data user guide</a></p>
        </div>
      </div>
    </div>
  </div></div>`;
}
