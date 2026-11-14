// ESA WorldCover 10 m (2021, v200) read in the browser from Microsoft Planetary Computer
// (anonymous SAS token, CORS-enabled Cloud-Optimized GeoTIFFs). Used as a land-cover prior:
// crops are only allowed where WorldCover maps cropland, deserts / built-up / water are never fields.
import { fromUrl } from 'geotiff';

export const WC = { TREE: 10, SHRUB: 20, GRASS: 30, CROP: 40, BUILT: 50, BARE: 60, SNOW: 70, WATER: 80, WETLAND: 90, MANGROVE: 95, MOSS: 100 };
export const WC_NAMES = { 10: 'Tree cover', 20: 'Shrubland', 30: 'Grassland', 40: 'Cropland', 50: 'Built-up', 60: 'Bare / sparse', 70: 'Snow / ice', 80: 'Water', 90: 'Wetland', 95: 'Mangroves', 100: 'Moss / lichen' };
let token = null, tokenT = 0;

async function sas() {
  if (!token || Date.now() - tokenT > 40 * 60 * 1000) {
    token = (await (await fetch('https://planetarycomputer.microsoft.com/api/sas/v1/token/esa-worldcover')).json()).token;
    tokenT = Date.now();
  }
  return token;
}

const tileName = (lat0, lon0) => `${lat0 < 0 ? 'S' : 'N'}${String(Math.abs(lat0)).padStart(2, '0')}${lon0 < 0 ? 'W' : 'E'}${String(Math.abs(lon0)).padStart(3, '0')}`;

/**
 * WorldCover classes on a W x H grid covering box = [west, south, east, north] (nearest neighbour).
 * Returns Uint8Array (0 where no data could be read).
 */
export async function readWorldCover(box, W, H) {
  const [w, s, e, n] = box;
  const out = new Uint8Array(W * H);
  const tok = await sas();
  const tiles = [];
  for (let la = Math.floor(s / 3) * 3; la < n; la += 3) for (let lo = Math.floor(w / 3) * 3; lo < e; lo += 3) tiles.push([la, lo]);
  await Promise.all(tiles.map(async ([la, lo]) => {
    const url = `https://ai4edataeuwest.blob.core.windows.net/esa-worldcover/v200/2021/map/ESA_WorldCover_10m_2021_v200_${tileName(la, lo)}_Map.tif?${tok}`;
    let img;
    try { img = await (await fromUrl(url, { allowFullFile: false })).getImage(); } catch (err) { return; }   // ocean tiles do not exist
    const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution();
    // part of the output grid inside this tile
    const tw = Math.max(w, lo), te = Math.min(e, lo + 3), ts = Math.max(s, la), tn = Math.min(n, la + 3);
    const c0 = Math.floor(((tw - w) / (e - w)) * W), c1 = Math.ceil(((te - w) / (e - w)) * W);
    const r0 = Math.floor(((n - tn) / (n - s)) * H), r1 = Math.ceil(((n - ts) / (n - s)) * H);
    const ow = c1 - c0, oh = r1 - r0;
    if (ow <= 0 || oh <= 0) return;
    const gx0 = w + (c0 / W) * (e - w), gx1 = w + (c1 / W) * (e - w), gy1 = n - (r0 / H) * (n - s), gy0 = n - (r1 / H) * (n - s);
    const win = [Math.max(0, Math.floor((gx0 - ox) / rx)), Math.max(0, Math.floor((gy1 - oy) / ry)), Math.min(img.getWidth(), Math.ceil((gx1 - ox) / rx)), Math.min(img.getHeight(), Math.ceil((gy0 - oy) / ry))];
    if (win[2] <= win[0] || win[3] <= win[1]) return;
    const r = await img.readRasters({ window: win, width: ow, height: oh, resampleMethod: 'nearest', samples: [0], interleave: true });
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) out[(r0 + y) * W + c0 + x] = r[y * ow + x];
  }));
  return out;
}
