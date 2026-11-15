// Map legend (bottom right): one section per active globe layer, rebuilt when layers or the timeline change.
import { esc } from './util.js';
import { T } from './ux.js';

const fmt = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
const ramp = (a, b, label) => `<div class="lg-ramp"><div class="lg-bar" style="background:linear-gradient(90deg,${a},${b})"></div><span>${label}</span></div>`;
const sw = (c, label, extra = '') => `<span class="lg-item"><i style="background:${c}${extra}"></i>${label}</span>`;

const SECTIONS = {
  mtc: (g) => {
    const cyc = g.mtcInfo;
    if (!cyc) return `<b>Multi-date composite</b><div class="lg-note">${T(`Needs three 12-day cycles before this date.`, `Bu tarihten önce üç 12 günlük döngü gerekir.`)}</div>`;
    return `<b>Multi-date composite · HH backscatter</b>
      ${ramp('#000', '#f00', `R · ${fmt(cyc[0].start)}`)}${ramp('#000', '#0f0', `G · ${fmt(cyc[1].start)}`)}${ramp('#000', '#00f', `B · ${fmt(cyc[2].start)}`)}
      <div class="lg-row lg-ends"><span>${T('low (≤ 90)', 'düşük (≤ 90)')}</span><span>${T('browse brightness', 'görüntü parlaklığı')}</span><span>${T('high (≥ 240)', 'yüksek (≥ 240)')}</span></div>
      <div class="lg-note">${T(`Equal on all three dates → grey/white; a colour means the surface changed between dates. Fixed mapping everywhere: stretch 90–240, gamma 1.4, date differences ×2.`, `Üç tarihte de aynı → gri/beyaz; renk, yüzeyin tarihler arasında değiştiği anlamına gelir. Her yerde aynı sabit eşleme: germe 90–240, gamma 1,4, tarih farkları ×2.`)}</div>`;
  },
  mosaic: (g) => {
    if (g.layers.mtc && g.mtcInfo) return '';
    const c = g.currentCycle;
    return `<b>NISAR world mosaic${c ? ` · ${fmt(c.start)} – ${fmt(c.end)}` : ''}</b>
      ${ramp('#000', '#f00', 'R · HH')}${ramp('#000', '#0f0', 'G · HV')}${ramp('#000', '#00f', 'B · HH/HV')}
      <div class="lg-note">${T(`Fixed ranges of the browse values, the same everywhere:`, `Görüntü değerlerinin her yerde aynı sabit aralıkları:`)} HH 140–255 (γ 1.5), HV 60–230, HH/HV as HH−HV −20…+60. ${T(`L-band convention as in the JAXA PALSAR mosaics: forest → green (strong HV), fields and bare soil → blue (HH ≫ HV), towns / flooded vegetation → bright, water → black.`, `JAXA PALSAR mozaiklerindeki L-band düzeni: orman → yeşil (güçlü HV), tarla ve çıplak toprak → mavi (HH ≫ HV), yerleşim / su basmış bitki → parlak, su → siyah.`)}</div>`;
  },
  change: (g) => (g.metricInfo?.prev ? `<b>${T('Change since the previous cycle', 'Önceki döngüden bu yana değişim')}</b>
      ${ramp('#ff8a4d', '#ff2633', T('darker: cleared, harvested, flooded, melting', 'koyulaşan: açılmış, hasat edilmiş, su basmış, eriyen'))}${ramp('#4dccE6', '#33ffff', T('brighter: crops growing, new structures, refreezing', 'parlaklaşan: büyüyen ürün, yeni yapı, yeniden donma'))}
      <div class="lg-note">${fmt(g.metricInfo.prev.start)} → ${fmt(g.metricInfo.cur.start)}. ${T(`Mean of the HH and HV change; changes under 20 browse units (normal pass-to-pass noise) are not shown. Patches with straight edges follow satellite swaths: the change happened between two passes (snowfall, rain, harvest).`, `HH ve HV değişiminin ortalaması; 20 birimin altındaki değişimler (olağan geçiş gürültüsü) gösterilmez. Düz kenarlı lekeler uydu şeritlerini izler: değişim iki geçiş arasında oldu (kar yağışı, yağmur, hasat).`)}</div>` : `<b>${T('Change since the previous cycle', 'Önceki döngüden bu yana değişim')}</b><div class="lg-note">${T('Needs an earlier full cycle.', 'Daha önceki bir tam döngü gerekir.')}</div>`),
  water: () => `<b>Water &amp; wet surfaces</b>${ramp('rgba(38,140,255,0.35)', '#268cff', T('dark in HH and HV: open water, floods, wet paddies', 'HH ve HV\'de koyu: açık su, sel, ıslak çeltik'))}
      <div class="lg-note">${T(`Smooth dry sand and radar shadow can look the same.`, `Düz kuru kum ve radar gölgesi de aynı görünebilir.`)}</div>`,
  variability: () => `<b>Seasonal variability</b>${ramp('#141e46', '#fadc3c', T('how much the plant signal (HV relative to HH) changes', 'bitki sinyalinin (HH\'ye göre HV) ne kadar değiştiği'))}
      <div class="lg-row lg-ends"><span>${T('steady: forest, desert, ice', 'sabit: orman, çöl, buz')}</span><span>${T('changing: fields', 'değişen: tarlalar')}</span></div>
      <div class="lg-note">${T(`Robust spread of HV − HH over the full 12-day cycles since June 2026; using the ratio cancels most differences between satellite tracks.`, `Haziran 2026'dan beri tam 12 günlük döngülerde HV − HH'nin dayanıklı yayılımı; oran kullanmak uydu izleri arasındaki farkların çoğunu yok eder.`)}</div>`,
  melt: () => `<b>Snow &amp; ice melt</b>${ramp('#96d2ff', '#5a14c8', T('how deep the radar dropped when the snow was wettest', 'kar en ıslakken radarın ne kadar düştüğü'))}
      <div class="lg-note">${T(`Cold regions only (above ~2,000 m or beyond 60°). Wet snow and melting ice swallow L-band; a deep drop marks strong melt.`, `Yalnızca soğuk bölgeler (~2.000 m üstü ya da 60°'nin ötesi). Islak kar ve eriyen buz L-band'i yutar; derin düşüş güçlü erimeyi gösterir.`)}</div>`,
  maincrop: () => `<b>Main crop</b> <span class="lg-note">(SPAM 2010, 0.25°)</span>
      <div class="lg-grid">${sw('#e6be46', 'wheat')}${sw('#28c8dc', 'rice')}${sw('#fa7828', 'maize')}${sw('#b45ac8', 'soybean')}${sw('#82dc3c', 'sugarcane')}${sw('#c8a06e', 'barley')}${sw('#f0f0f0', 'cotton')}${sw('#c85050', 'sorghum')}${sw('#966e3c', 'millet')}${sw('#6e4628', 'cassava')}${sw('#147832', 'oil palm')}${sw('#3ca05a', 'vegetables')}</div>
      <div class="lg-note">${T(`The crop with the largest share of each cell's crop land; fainter = less cropland.`, `Her hücrenin tarım alanında en büyük paya sahip ürün; soluk = daha az tarım alanı.`)}</div>`,
  s1: (g) => `<b>Sentinel-1 C-band${g.s1Year ? ` · ${g.s1Year}` : ''}</b> <span class="lg-note">(ESA WorldCover S1 composite, CC BY 4.0)</span>
      ${ramp('#000', '#f00', 'R · VV −22…0 dB')}${ramp('#000', '#0f0', 'G · VH −28…−8 dB')}${ramp('#000', '#00f', 'B · VV−VH 2…14 dB')}
      <div class="lg-note">${T(`Yearly median of the European Sentinel-1 radar (5.6 cm, C-band), 2020 or 2021 following the timeline. Colours: forest and dense vegetation → yellow-green (strong VV and VH), fields → olive to purple through the year, deserts and smooth bare ground → blue (weak VH), towns → bright, open water → not shown. C-band is shorter than NISAR's L-band and sees mainly leaves and the top of the canopy. Contains modified Copernicus Sentinel data.`, `Avrupa Sentinel-1 radarının (5,6 cm, C-band) yıllık medyanı; zaman çizelgesine göre 2020 ya da 2021. Renkler: orman ve yoğun bitki örtüsü → sarı-yeşil (güçlü VV ve VH), tarlalar → yıl içinde zeytin yeşilinden mora, çöl ve düz çıplak toprak → mavi (zayıf VH), yerleşim → parlak, açık su → gösterilmez. C-band, NISAR'ın L-band'inden kısadır ve çoğunlukla yaprakları ve tepe örtüsünü görür. Değiştirilmiş Copernicus Sentinel verisi içerir.`)}</div>`,
  twins: () => `<b>${T('Change twins of farm fields', 'Tarlaların değişim ikizleri')}</b>
      <div class="lg-grid">${sw('#e8b04a', T('field', 'tarla'))}${sw('#ef4444', T('unusual this season (top 5 % of its region)', 'bu sezon olağandışı (bölgesinin en üst %5\'i)'))}</div>
      <div class="lg-note">${T('1,500 fields in five farming regions. Zoom in and click a dot: the fields elsewhere in the world whose NISAR season curve changed the same way are listed, most similar first.', 'Beş tarım bölgesinde 1.500 tarla. Yakınlaşıp bir noktaya tıklayın: NISAR sezon eğrisi dünyanın başka yerinde aynı biçimde değişen tarlalar, en benzerden başlayarak listelenir.')}</div>`,
  landslides: () => `<b>Landslide history</b> <span class="lg-note">(NASA Global Landslide Catalog, 1988–2017)</span>
      <div class="lg-grid">${sw('#ff783c', 'reported')}${sw('#ff3c28', '1–9 deaths')}${sw('#dc143c', '10+ deaths')}</div>`,
  landcover: () => `<b>${T('Cropland &amp; forest', 'Tarım ve orman')}</b> <span class="lg-note">(NISAR mosaics, Jun–Nov 2026)</span>
      <div class="lg-grid">${sw('#e8b04a', T('cropland: strong seasonal swing', 'tarım: güçlü mevsimsel salınım'))}${sw('#15803d', T('forest: high HV, steady', 'orman: yüksek, sabit HV'))}
        ${sw('#84cc16', T('tree crops / mixed', 'ağaç ürünleri / karışık'))}${sw('#a8a29e', T('grass / bare / built', 'çayır / çıplak / yapı'))}</div>`,
  density: () => `<b>${T('NISAR frames per month', 'Aylık NISAR çerçevesi')}</b>
      <div class="lg-bar" style="background:linear-gradient(90deg,#1e3a8a,#2563eb,#22d3ee,#fde047,#f97316)"></div>
      <div class="lg-row lg-ends"><span>few</span><span>many (3° cells)</span></div>`,
  events: () => `<b>${T('Natural events (NASA EONET)', 'Doğal olaylar (NASA EONET)')}</b>
      <div class="lg-grid">${sw('#3fb8ff', T('flood', 'sel'))}${sw('#ff6a4d', T('wildfire', 'orman yangını'))}${sw('#ff3d6e', T('volcano', 'yanardağ'))}${sw('#b48cff', T('storm', 'fırtına'))}${sw('#c8f0ff', T('ice', 'buz'))}${sw('#e8b04a', T('other', 'diğer'))}</div>`,
  satellite: (g) => {
    if (!g.date || g.date.getTime() < Date.UTC(2025, 6, 30) || g.layers.s1) return '';
    const ep = g.tleEpoch ? new Date(g.tleEpoch).toISOString().slice(0, 10) : null;
    if (!g.satValid(g.date)) return `<b>NISAR satellite</b><div class="lg-note">${T(`Not shown on this date: its exact position is only known within two weeks of the latest orbit data${ep ? ` (${ep})` : ''}.`, `Bu tarihte gösterilmiyor: kesin konumu yalnızca son yörünge verisinin${ep ? ` (${ep})` : ''} iki hafta yakınında bilinir.`)}</div>`;
    return `<b>NISAR satellite</b>
      <div class="lg-grid">${sw('#ffd166', T('position in real time', 'gerçek zamanlı konum'))}${sw('rgba(255,209,102,0.5)', T('last 45 min of track', 'son 45 dk iz'))}${sw('rgba(56,189,248,0.45)', T('~242 km L-band swath (left-looking)', '~242 km L-band tarama şeridi (sola bakan)'))}</div>
      <div class="lg-note">${T(`Orbit from the CelesTrak TLE of ${ep}, SGP4; on other dates, the same time of day.`, `Yörünge CelesTrak TLE (${ep}), SGP4; diğer tarihlerde günün aynı saati.`)}</div>`;
  },
  night: () => `<b>${T('Night lights', 'Gece ışıkları')}</b> <span class="lg-note">(NASA Black Marble)</span>`,
};
const ORDER = ['change', 'water', 'variability', 'melt', 'maincrop', 'twins', 'landslides', 'mtc', 'mosaic', 's1', 'density', 'events', 'satellite', 'night'];

export function updateLegend(globe, el) {
  if (!el || !globe) return;
  const parts = ORDER.filter((k) => globe.layers[k]).map((k) => SECTIONS[k](globe)).filter(Boolean);
  if (globe.boxShown) parts.push(`<b>Selected area</b><div class="lg-grid">${sw('transparent', 'drawn rectangle', ';border:2px solid #e8b04a')}</div>`);
  const open = !el.classList.contains('collapsed');
  el.innerHTML = `<button class="lg-head" aria-expanded="${open}">Legend</button><div class="lg-body">${parts.map((p) => `<section>${p}</section>`).join('') || '<div class="lg-note">No layer on.</div>'}</div>`;
  el.querySelector('.lg-head').onclick = () => { el.classList.toggle('collapsed'); updateLegend(globe, el); };
}
export { esc };
