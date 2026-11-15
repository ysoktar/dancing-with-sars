// Cloudflare Worker: an authenticated byte-range proxy for NISAR products on NASA's ASF archive.
//
// The website (a static GitHub Pages site) cannot hold an Earthdata token. This Worker holds it as a secret
// (EARTHDATA_TOKEN), adds it to the request to nisar.asf.earthdatacloud.nasa.gov, follows ASF's redirect to the
// signed download URL WITHOUT the token, and streams back only the requested byte range with CORS headers, so the
// browser can read the HDF5 file block by block (h5wasm lazy file). No data is stored, no CPU-heavy work is done here.
//
//   GET|HEAD /h5?url=https://nisar.asf.earthdatacloud.nasa.gov/NISAR/....h5     (Range: bytes=a-b)
//
// Deploy: see worker/README.md (free Cloudflare plan: 100,000 requests / day).

const ALLOWED_HOST = 'nisar.asf.earthdatacloud.nasa.gov';
const signed = new Map(); // product URL -> { url, size, t } (per isolate, reused while the signature is valid)
const TTL = 40 * 60 * 1000;

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allow = (env.ALLOWED_ORIGINS || 'https://ysoktar.github.io,http://localhost:5173,http://localhost:4173').split(',').map((s) => s.trim());
  return {
    'Access-Control-Allow-Origin': allow.includes(origin) || allow.includes('*') ? origin || '*' : allow[0],
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Encoding',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function resolve(product, env) {
  const hit = signed.get(product);
  if (hit && Date.now() - hit.t < TTL) return hit;
  const r = await fetch(product, { method: 'GET', redirect: 'manual', headers: { Authorization: `Bearer ${env.EARTHDATA_TOKEN}`, Range: 'bytes=0-0' } });
  let url = product, res = r;
  if (r.status >= 300 && r.status < 400) {
    url = r.headers.get('Location');
    res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  }
  if (res.status !== 206 && res.status !== 200) throw new Error(`ASF answered ${res.status}`);
  const size = Number((res.headers.get('Content-Range') || '').split('/')[1] || res.headers.get('Content-Length') || 0);
  const v = { url, size, t: Date.now() };
  signed.set(product, v);
  return v;
}

export default {
  async fetch(req, env) {
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const u = new URL(req.url);
    if (u.pathname === '/' || u.pathname === '/health') return new Response(JSON.stringify({ ok: true, token: !!env.EARTHDATA_TOKEN }), { headers: { ...h, 'Content-Type': 'application/json' } });
    if (u.pathname !== '/h5') return new Response('not found', { status: 404, headers: h });
    const product = u.searchParams.get('url') || '';
    let p;
    try { p = new URL(product); } catch (e) { return new Response('bad url', { status: 400, headers: h }); }
    if (p.hostname !== ALLOWED_HOST || !p.pathname.startsWith('/NISAR/') || !p.pathname.endsWith('.h5')) return new Response('only NISAR .h5 products', { status: 403, headers: h });
    if (!env.EARTHDATA_TOKEN) return new Response('EARTHDATA_TOKEN secret missing', { status: 500, headers: h });
    let s;
    try { s = await resolve(product, env); } catch (e) { return new Response(String(e.message || e), { status: 502, headers: h }); }
    const base = { ...h, 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' };
    if (req.method === 'HEAD') return new Response(null, { status: 200, headers: { ...base, 'Content-Length': String(s.size) } });
    const range = req.headers.get('Range');
    let r = await fetch(s.url, range ? { headers: { Range: range } } : {});
    if (r.status === 403) { signed.delete(product); s = await resolve(product, env); r = await fetch(s.url, range ? { headers: { Range: range } } : {}); }
    const out = new Headers(base);
    for (const k of ['Content-Length', 'Content-Range']) if (r.headers.get(k)) out.set(k, r.headers.get(k));
    return new Response(r.body, { status: r.status, headers: out });
  },
};
