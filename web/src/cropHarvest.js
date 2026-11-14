// NASA Harvest CropHarvest field labels near an area (pipeline/build_cropharvest.py): ground truth to set beside the
// maps (crop / non-crop, crop group, crop type where the campaign recorded it).
let index = null;
const tiles = new Map();

export async function labelsNear(base, box, padKm = 25) {
  if (!index) index = fetch(`${base}data/cropharvest/index.json`).then((r) => r.json());
  const I = await index;
  const [w, s, e, n] = box, lat = (s + n) / 2, pd = padKm / 111.32, pl = pd / Math.max(Math.cos((lat * Math.PI) / 180), 0.1);
  const W = w - pl, E = e + pl, S = s - pd, N = n + pd;
  const out = [];
  for (let la = Math.floor(S / 10) * 10; la < N; la += 10) for (let lo = Math.floor(W / 10) * 10; lo < E; lo += 10) {
    const k = `${la}_${lo}`;
    if (!I.tiles.includes(k)) continue;
    if (!tiles.has(k)) tiles.set(k, fetch(`${base}data/cropharvest/${k}.json`).then((r) => r.json()));
    for (const p of (await tiles.get(k)).p) if (p[0] >= S && p[0] <= N && p[1] >= W && p[1] <= E) out.push({ lat: p[0], lon: p[1], crop: !!p[2], group: p[3], label: p[4], year: p[5], dataset: I.datasets[p[6]], inside: p[0] >= s && p[0] <= n && p[1] >= w && p[1] <= e });
  }
  return { points: out, source: I.source, license: I.license };
}
