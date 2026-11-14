// Which crops COULD grow in a region: FAO / IIASA GAEZ v4 suitability (current cropland, 1981-2010 climate, high
// inputs), rain-fed and irrigated, on 0.25° cells built by pipeline/build_suitability.py into web/public/data/suitability/.
let meta = null;
const tiles = new Map();

// GAEZ crop -> SPAM 2010 codes (to tell "grown here now" from "a new option"); null = not a food / cash crop in SPAM
export const GAEZ_TO_SPAM = {
  wheat: ['WHEA'], wetland_rice: ['RICE'], dryland_rice: ['RICE'], maize: ['MAIZ'], barley: ['BARL'], pearl_millet: ['PMIL'],
  foxtail_millet: ['SMIL'], sorghum: ['SORG'], oat: ['OCER'], rye: ['OCER'], buckwheat: ['OCER'], white_potato: ['POTA'],
  sweet_potato: ['SWPO'], yam: ['YAMS'], cassava: ['CASS'], phaseolus_bean: ['BEAN'], chickpea: ['CHIC'], gram: ['OPUL', 'CHIC'],
  cowpea: ['COWP'], pigeonpea: ['PIGE'], dry_pea: ['OPUL'], soybean: ['SOYB'], groundnut: ['GROU'], coconut: ['CNUT'],
  oil_palm: ['OILP'], sunflower: ['SUNF'], rapeseed: ['RAPE'], olive: ['OOIL', 'TEMF'], sugarcane: ['SUGC'], sugarbeet: ['SUGB'],
  cotton: ['COTT'], flax: ['OFIB'], coffee: ['ACOF', 'RCOF'], cocoa: ['COCO'], tea: ['TEAS'], tobacco: ['TOBA'], banana: ['BANA', 'PLNT'],
  citrus: ['TROF', 'TEMF'], cabbage: ['VEGE'], carrot: ['VEGE'], onion: ['VEGE'], tomato: ['VEGE'], alfalfa: ['REST'], rubber: ['REST'],
};
// energy / fodder grasses: listed separately, not as crop suggestions
export const ENERGY = new Set(['miscanthus', 'switchgrass', 'reed_canary_grass', 'biomass_sorghum', 'jatropha', 'napier_grass']);

export async function suitMeta(base) {
  if (!meta) meta = await (await fetch(`${base}data/suitability/crops.json`)).json();
  return meta;
}
export const suitClass = (v) => (v == null ? '–' : (meta?.classes || []).find(([lo]) => v >= lo)?.[1] || '–');

async function readTile(base, key, M) {
  const blob = await (await fetch(`${base}data/suitability/${key}.png`)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = new OffscreenCanvas(bmp.width, bmp.height), cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0);
  const rgba = cx.getImageData(0, 0, bmp.width, bmp.height).data;
  const g = new Uint8Array(bmp.width * bmp.height);
  for (let i = 0; i < g.length; i++) g[i] = rgba[i * 4];
  return g;
}

/** Mean suitability (0..100) per crop over the 0.25° cells around box [w, s, e, n]: [{code, name, rain, irr}]. */
export async function suitability(base, box) {
  const M = await suitMeta(base), res = M.res, C = M.cells, L = M.layers.length;
  const [w, s, e, n] = box;
  const pad = res / 2;
  // cell rows / cols (global 0.25-degree grid, row 0 at 90N) whose centres fall in the padded box
  const r0 = Math.max(0, Math.floor((90 - (n + pad)) / res)), r1 = Math.min(719, Math.ceil((90 - (s - pad)) / res) - 1);
  const c0 = Math.max(0, Math.floor((w - pad + 180) / res)), c1 = Math.min(1439, Math.ceil((e + pad + 180) / res) - 1);
  const sum = new Float64Array(L), cnt = new Float64Array(L);
  let cells = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const ty = Math.floor(r / C) * C, tx = Math.floor(c / C) * C;
    const key = `${90 - (ty + C) * res}_${-180 + tx * res}`;
    if (!M.tiles.includes(key)) continue;
    if (!tiles.has(key)) tiles.set(key, readTile(base, key, M));
    const g = await tiles.get(key);
    let any = false;
    for (let k = 0; k < L; k++) {
      const v = g[(k * C + (r - ty)) * C + (c - tx)];
      if (v === 255) continue;
      sum[k] += v; cnt[k]++; any = true;
    }
    if (any) cells++;
  }
  const by = {};
  M.layers.forEach((id, k) => {
    const [code, ws] = id.split('|');
    const o = (by[code] ||= { code, name: M.crops[code] || code, rain: null, irr: null });
    if (cnt[k]) o[ws] = sum[k] / cnt[k];
  });
  const list = Object.values(by).filter((o) => o.rain != null || o.irr != null)
    .sort((p, q) => Math.max(q.rain ?? 0, q.irr ?? 0) - Math.max(p.rain ?? 0, p.irr ?? 0));
  return { list, cells, source: M.source, license: M.license, classes: M.classes };
}
