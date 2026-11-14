// Weather and optical greenness for any region, fetched live in the browser
// (same as pipeline/build_context.py): NASA POWER daily precipitation / 2 m temperature,
// and MODIS Terra 16-day NDVI from NASA GIBS (palette PNG -> NDVI with GIBS' colour map).
const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=MODIS_Terra_L3_NDVI_16Day&CRS=EPSG:4326&WIDTH=96&HEIGHT=96&FORMAT=image/png';
const COLORMAP = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_L3_NDVI.xml';
const START = '2025-10-01';
const cache = new Map();
let palette = null;

const ymd = (d) => d.toISOString().slice(0, 10);

async function ndviPalette() {
  if (palette) return palette;
  const xml = await (await fetch(COLORMAP)).text();
  palette = new Map();
  for (const m of xml.matchAll(/<ColorMapEntry([^>]*)\/>/g)) {
    const a = m[1];
    const rgb = a.match(/rgb="([^"]+)"/), v = a.match(/value="\[([-\d.]+),([-\d.]+)\)"/);
    if (!rgb || !v || /nodata="true"|transparent="true"/.test(a)) continue;
    palette.set(rgb[1].replace(/\s/g, ''), (parseFloat(v[1]) + parseFloat(v[2])) / 2);
  }
  return palette;
}

function modisDates(end) {
  const out = [], s = new Date(START + 'T00:00:00Z');
  for (let y = s.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
    for (let d = new Date(Date.UTC(y, 0, 1)); d.getUTCFullYear() === y && d <= end; d = new Date(d.getTime() + 16 * 86400000)) if (d >= s) out.push(ymd(d));
  }
  return out;
}

async function ndviSeries(box) {
  const pal = await ndviPalette();
  const [w, s, e, n] = box;
  const dates = modisDates(new Date(Date.now() - 20 * 86400000));
  const out = { source: 'MODIS Terra MOD13Q1 16-day NDVI via NASA GIBS (live)', dates: [], mean: [], p90: [], valid: [] };
  const cv = new OffscreenCanvas(96, 96), cx = cv.getContext('2d', { willReadFrequently: true });
  const one = async (d) => {
    try {
      const bmp = await createImageBitmap(await (await fetch(`${GIBS}&BBOX=${s},${w},${n},${e}&TIME=${d}`)).blob());
      return bmp;
    } catch (err) { return null; }
  };
  // a few requests in parallel, results kept in date order
  const bmps = [];
  for (let i = 0; i < dates.length; i += 6) bmps.push(...await Promise.all(dates.slice(i, i + 6).map(one)));
  bmps.forEach((bmp, k) => {
    if (!bmp) return;
    cx.clearRect(0, 0, 96, 96); cx.drawImage(bmp, 0, 0, 96, 96); bmp.close();
    const px = cx.getImageData(0, 0, 96, 96).data, v = [];
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      const val = pal.get(`${px[i]},${px[i + 1]},${px[i + 2]}`);
      if (val != null) v.push(val);
    }
    if (v.length < 0.2 * 96 * 96) return;
    v.sort((a, b) => a - b);
    out.dates.push(dates[k]); out.mean.push(+(v.reduce((a, b) => a + b, 0) / v.length).toFixed(4));
    out.p90.push(+v[Math.floor(v.length * 0.9)].toFixed(4)); out.valid.push(+(v.length / (96 * 96)).toFixed(3));
  });
  return out;
}

async function powerSeries(lon, lat) {
  const end = new Date(Date.now() - 2 * 86400000);
  const url = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,T2M&community=AG&longitude=${lon.toFixed(3)}&latitude=${lat.toFixed(3)}&start=${START.replace(/-/g, '')}&end=${ymd(end).replace(/-/g, '')}&format=JSON`;
  const p = (await (await fetch(url)).json()).properties.parameter;
  const days = Object.keys(p.PRECTOTCORR).sort();
  const clean = (x) => (x == null || x <= -998 ? null : +x.toFixed(2));
  return { source: 'NASA POWER (MERRA-2 / IMERG based), daily (live)', dates: days.map((d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`),
    precip_mm: days.map((d) => clean(p.PRECTOTCORR[d])), t2m_c: days.map((d) => clean(p.T2M[d])) };
}

/** {weather, ndvi} for a region; cached per region id. */
export function liveContext(id, lon, lat, box) {
  if (!cache.has(id)) {
    cache.set(id, Promise.all([powerSeries(lon, lat).catch(() => null), ndviSeries(box).catch(() => null)])
      .then(([weather, ndvi]) => ({ weather, ndvi })));
  }
  return cache.get(id);
}
