// Which crops grow in a region: SPAM 2010 (IFPRI MapSPAM) crop mix on 0.25° cells, built by
// pipeline/build_crop_prior.py into web/public/data/cropprior/. Used to list the crops of a region with their
// typical yields, and as a prior that suppresses crop classes a model predicts but that are not grown there.
let meta = null;
const tiles = new Map();

async function getMeta(base) {
  if (!meta) meta = await (await fetch(`${base}data/cropprior/crops.json`)).json();
  return meta;
}

/** Area-weighted crop mix over box [w, s, e, n]: [{code, name, share, tHa}] sorted by share, plus total crop area (ha). */
export async function cropMix(base, box) {
  const M = await getMeta(base);
  const [w, s, e, n] = box, res = M.res;
  const acc = {}, yAcc = {};
  let total = 0;
  const keys = new Set();
  for (let la = Math.floor(s / 10) * 10; la < n; la += 10) for (let lo = Math.floor(w / 10) * 10; lo < e; lo += 10) keys.add(`${la}_${lo}`);
  for (const k of keys) {
    if (!M.tiles.includes(k)) continue;
    if (!tiles.has(k)) tiles.set(k, fetch(`${base}data/cropprior/${k}.json`).then((r) => r.json()));
    const T = await tiles.get(k);
    for (const [rc, [tot, lst]] of Object.entries(T.cells)) {
      const [r, c] = rc.split('_').map(Number);
      const lat = 90 - (r + 0.5) * res, lon = -180 + (c + 0.5) * res;
      // cells whose centre lies in the box (a cell straddling a small box still counts)
      if (lat < s - res / 2 || lat > n + res / 2 || lon < w - res / 2 || lon > e + res / 2) continue;
      total += tot;
      for (const [code, share, tHa] of lst) {
        const a = share * tot;
        acc[code] = (acc[code] || 0) + a;
        if (tHa != null) yAcc[code] = (yAcc[code] || 0) + a * tHa;
      }
    }
  }
  const list = Object.entries(acc).map(([code, a]) => ({ code, name: M.crops[code] || code, share: total ? a / total : 0, tHa: yAcc[code] ? yAcc[code] / a : null }))
    .sort((p, q) => q.share - p.share);
  return { list, totalHa: total, source: M.source, groups: M.groups };
}

// PASTIS classes -> SPAM crops (null = no SPAM equivalent, the prior leaves them unchanged)
export const PASTIS_TO_SPAM = [null, null, ['WHEA'], ['MAIZ'], ['BARL'], ['RAPE'], ['BARL'], ['SUNF'], ['TEMF'], ['SUGB'], ['OCER', 'WHEA'], ['WHEA'],
  ['VEGE', 'TROF', 'TEMF'], ['POTA'], null, ['SOYB'], ['TEMF', 'TROF'], ['OCER', 'WHEA', 'BARL'], ['SORG'], null];
const NAME_TO_SPAM = { wheat: ['WHEA'], corn: ['MAIZ'], maize: ['MAIZ'], rapeseed: ['RAPE'], canola: ['RAPE'], soybean: ['SOYB'], soy: ['SOYB'], barley: ['BARL'], sunflower: ['SUNF'], rice: ['RICE'], potato: ['POTA'], sorghum: ['SORG'], beet: ['SUGB'] };
export const spamOfName = (name) => { const k = Object.keys(NAME_TO_SPAM).find((x) => String(name).toLowerCase().includes(x)); return k ? NAME_TO_SPAM[k] : null; };

/** Prior weight per class: grown here (>= 2 % of crop area) 1, marginal (0.5-2 %) 0.3, not grown (< 0.5 %) 0.02. */
export function classWeights(mix, spamLists) {
  const share = Object.fromEntries(mix.list.map((c) => [c.code, c.share]));
  return spamLists.map((codes) => {
    if (!codes || !mix.totalHa) return 1;
    const s = codes.reduce((a, c) => a + (share[c] || 0), 0);
    return s >= 0.02 ? 1 : s >= 0.005 ? 0.3 : 0.02;
  });
}
