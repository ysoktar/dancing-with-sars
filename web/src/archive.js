// Every spaceborne / airborne radar acquisition the ASF archive holds over a point, from Seasat (1978) on.
// ASF search API (CORS-enabled, no login). Browse images are shown as <img> (the archive's browse
// server sends no CORS header, so their pixels are displayed, not analysed).
const SEARCH = 'https://api.daac.asf.alaska.edu/services/search/param';
export const ARCHIVE_PLATFORMS = [
  { id: 'SEASAT', label: 'Seasat', band: 'L', years: '1978' },
  { id: 'ERS-1', label: 'ERS-1', band: 'C', years: '1991–2000' },
  { id: 'JERS-1', label: 'JERS-1', band: 'L', years: '1992–1998' },
  { id: 'ERS-2', label: 'ERS-2', band: 'C', years: '1995–2011' },
  { id: 'RADARSAT-1', label: 'RADARSAT-1', band: 'C', years: '1995–2013' },
  { id: 'ALOS', label: 'ALOS PALSAR', band: 'L', years: '2006–2011' },
  { id: 'UAVSAR', label: 'UAVSAR (airborne)', band: 'L', years: '2008–' },
  { id: 'SENTINEL-1', label: 'Sentinel-1', band: 'C', years: '2014–' },
  { id: 'NISAR', label: 'NISAR', band: 'L', years: '2025–' },
];
const cache = new Map();

async function query(params) {
  const r = await fetch(`${SEARCH}?${new URLSearchParams(params)}`);
  if (!r.ok) throw new Error(`ASF ${r.status}`);
  return r;
}

/** { platform: { count, years: {yyyy: n}, items: [{date, browse, product, level, geocoded}] } } */
export function fetchArchive(lon, lat) {
  const key = `${lon.toFixed(3)},${lat.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);
  const pt = `POINT(${lon.toFixed(4)} ${lat.toFixed(4)})`;
  const one = async (p) => {
    const out = { ...p, count: 0, years: {}, items: [] };
    try {
      if (p.id === 'NISAR' || p.id === 'SENTINEL-1') {
        // large collections: exact count, then a sample per year for the gallery and the per-year histogram
        const params = p.id === 'NISAR' ? { dataset: 'NISAR', processingLevel: 'GCOV' } : { platform: 'SENTINEL-1', processingLevel: 'GRD_HD' };
        out.count = +(await (await query({ ...params, intersectsWith: pt, output: 'count' })).text()) || 0;
        const y1 = new Date().getUTCFullYear(), y0 = p.id === 'NISAR' ? 2025 : 2014;
        await Promise.all(Array.from({ length: y1 - y0 + 1 }, (_, k) => y0 + k).map(async (y) => {
          const n = +(await (await query({ ...params, intersectsWith: pt, start: `${y}-01-01T00:00:00Z`, end: `${y}-12-31T23:59:59Z`, output: 'count' })).text()) || 0;
          if (n) out.years[y] = n;
          const r = await (await query({ ...params, intersectsWith: pt, start: `${y}-05-01T00:00:00Z`, end: `${y}-12-31T23:59:59Z`, output: 'jsonlite', maxResults: '3' })).json();
          for (const g of r.results || []) if (g.browse?.length) out.items.push({ date: g.startTime.slice(0, 10), browse: g.browse.find((b) => /LATLON\.png$/.test(b)) || g.browse[0], product: g.productID || g.granuleName, level: g.processingLevel || '' });
        }));
      } else {
        const r = await (await query({ platform: p.id, intersectsWith: pt, output: 'jsonlite', maxResults: '2000' })).json();
        const seen = new Set();
        for (const g of r.results || []) {
          const d = g.startTime.slice(0, 10), y = d.slice(0, 4);
          if (seen.has(d)) continue;                       // one entry per date (several processing levels exist)
          seen.add(d);
          out.years[y] = (out.years[y] || 0) + 1; out.count++;
          if (g.browse?.length) out.items.push({ date: d, browse: g.browse[0], product: g.productID || g.granuleName, level: g.processingLevel || '', beam: g.beamMode });
        }
        if (p.id === 'ALOS') {
          // terrain-corrected (geocoded) browse for the L-band "then vs now" comparison
          const rtc = await (await query({ platform: 'ALOS', processingLevel: 'RTC_HI_RES', intersectsWith: pt, output: 'jsonlite', maxResults: '200' })).json();
          out.rtc = (rtc.results || []).filter((g) => g.browse?.length).map((g) => ({ date: g.startTime.slice(0, 10), browse: g.browse[0], product: g.productID || g.granuleName, wkt: g.wkt, pol: g.polarization }))
            .sort((a, b) => a.date.localeCompare(b.date));
        }
      }
    } catch (e) { out.error = String(e.message || e); }
    out.items.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  };
  const pr = Promise.all(ARCHIVE_PLATFORMS.map(one));
  cache.set(key, pr);
  return pr;
}
