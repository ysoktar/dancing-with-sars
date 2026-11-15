// Disasters page: for each kind of disaster, its natural and human causes, what happens on the ground, how it looks to
// an L-band radar (animated HH / HV signature) and the tool on this site that detects it, with an example area.
import { sheetHead } from '../main.js';
import { T } from '../ux.js';
import { presetTool } from './site.js';

const C = { hh: '#e8b04a', hv: '#22c55e', dz: '#38bdf8' };
const reg = (box, tab) => `#/region/${box.map((v) => v.toFixed(4)).join('/')}/${tab}`;

// signature series: 12 passes (~12 days apart), values 0..1 (low..high backscatter); event after pass `ev`
const D = () => [
  {
    k: 'quake', c: '#ef4444', name: T('Earthquake', 'Deprem'),
    natural: [T('a fault slips after centuries of strain', 'yüzyıllarca biriken gerilimle fay kayar')],
    human: [T('induced quakes: fluid injection, large reservoirs, mining', 'tetiklenmiş depremler: sıvı enjeksiyonu, büyük barajlar, madencilik'), T('damage grows with weak buildings and dense cities', 'hasar zayıf binalar ve yoğun kentlerle büyür')],
    ground: T('The ground shakes for seconds and can shift by metres along the fault. Buildings that collapse lose their walls.', 'Zemin saniyelerce sarsılır, fay boyunca metrelerce kayabilir. Çöken binalar duvarlarını kaybeder.'),
    radar: T('Intact buildings send a strong HH “double bounce” (wall + ground). After a collapse it is gone: HH drops over the town. Fault movement shows as fringes in interferograms.', 'Sağlam binalar güçlü bir HH “çift sekme” (duvar + zemin) gönderir. Çöktükten sonra bu kaybolur: kent üzerinde HH düşer. Fay hareketi interferogramlarda saçaklar olarak görünür.'),
    ev: 6, hh: [0.82, 0.8, 0.83, 0.81, 0.82, 0.8, 0.52, 0.5, 0.53, 0.55, 0.56, 0.58], hv: [0.36, 0.35, 0.37, 0.36, 0.35, 0.36, 0.44, 0.43, 0.42, 0.41, 0.4, 0.4],
    tool: 'quake', tab: 'analysis', toolName: T('Earthquakes & damage', 'Deprem ve hasar'), box: [38.95, 36.83, 39.05, 36.91], where: T('Harran, Türkiye (quakes nearby, USGS)', 'Harran, Türkiye (yakın depremler, USGS)'),
  },
  {
    k: 'landslide', c: '#f97316', name: T('Landslide', 'Heyelan'),
    natural: [T('days of heavy rain soak the slope', 'günlerce yoğun yağış yamacı doyurur'), T('earthquakes and snowmelt', 'deprem ve kar erimesi')],
    human: [T('road cuts and quarries undercut slopes', 'yol yarmaları ve taş ocakları yamacı oyar'), T('forest clearing removes the roots that hold soil', 'orman kesimi toprağı tutan kökleri yok eder')],
    ground: T('A slope gives way: soil, rock and trees slide downhill, leaving a bare scar.', 'Yamaç çöker: toprak, kaya ve ağaçlar aşağı kayar, geride çıplak bir yara kalır.'),
    radar: T('Vegetation is stripped, so HV (volume scattering from plants) drops sharply on a steep slope and stays low.', 'Bitki örtüsü sökülür; dik yamaçta HV (bitkilerden hacim saçılımı) keskin düşer ve düşük kalır.'),
    ev: 5, hh: [0.5, 0.51, 0.49, 0.5, 0.52, 0.6, 0.57, 0.56, 0.55, 0.55, 0.54, 0.55], hv: [0.62, 0.6, 0.63, 0.61, 0.62, 0.26, 0.25, 0.27, 0.26, 0.28, 0.27, 0.29],
    tool: 'landslide', tab: 'analysis', toolName: T('Landslides', 'Heyelan'), box: [41.1, 40.95, 41.2, 41.03], where: T('Eastern Black Sea, Türkiye (steep, rainy)', 'Doğu Karadeniz, Türkiye (dik, yağışlı)'),
  },
  {
    k: 'flood', c: '#3b82f6', name: T('Flood', 'Sel ve taşkın'),
    natural: [T('extreme rain, snowmelt, storm surge', 'aşırı yağış, kar erimesi, fırtına kabarması')],
    human: [T('building on floodplains, sealed ground, narrowed rivers', 'taşkın ovalarına yapılaşma, geçirimsiz zemin, daraltılmış dereler'), T('dam or levee failure', 'baraj ya da set yıkılması')],
    ground: T('Water spreads over fields and streets for days, then drains back.', 'Su günlerce tarlalara ve sokaklara yayılır, sonra çekilir.'),
    radar: T('Calm water reflects the radar away like a mirror: HH and HV go dark, then recover when it drains. Flooded crops and trees turn brighter in HH instead (double bounce).', 'Durgun su radarı ayna gibi uzağa yansıtır: HH ve HV kararır, su çekilince geri gelir. Su basmış ürün ve ağaçlar ise HH’de parlaklaşır (çift sekme).'),
    ev: 5, hh: [0.55, 0.56, 0.54, 0.55, 0.57, 0.1, 0.12, 0.35, 0.5, 0.54, 0.55, 0.56], hv: [0.36, 0.37, 0.35, 0.36, 0.37, 0.07, 0.08, 0.2, 0.31, 0.35, 0.36, 0.36],
    tool: 'change', tab: 'analysis', toolName: T('Change between two dates · Water layer', 'İki tarih arası değişim · Su katmanı'), box: [105.55, 10.26, 105.65, 10.34], where: T('Mekong Delta, Viet Nam', 'Mekong Deltası, Vietnam'),
  },
  {
    k: 'drought', c: '#eab308', name: T('Drought', 'Kuraklık'),
    natural: [T('months with little rain, heat waves', 'aylarca az yağış, sıcak hava dalgaları')],
    human: [T('pumping more groundwater and river water than is refilled', 'yenilenenden fazla yeraltı ve yüzey suyu çekmek'), T('thirsty crops in dry regions', 'kurak bölgelerde çok su isteyen ürünler')],
    ground: T('The soil dries out week by week; crops grow less and are harvested early.', 'Toprak hafta hafta kurur; ürün az büyür, erken hasat edilir.'),
    radar: T('Dry soil reflects less: HH slowly falls. The seasonal rise of HV (crop growth) stays small.', 'Kuru toprak daha az yansıtır: HH yavaşça düşer. HV’nin mevsimsel yükselişi (ürün büyümesi) küçük kalır.'),
    ev: -1, hh: [0.62, 0.6, 0.57, 0.53, 0.49, 0.46, 0.43, 0.41, 0.39, 0.38, 0.37, 0.36], hv: [0.3, 0.33, 0.36, 0.38, 0.37, 0.35, 0.31, 0.29, 0.28, 0.27, 0.26, 0.26],
    tool: 'drought', tab: 'agri', toolName: T('Drought · Soil moisture', 'Kuraklık · Toprak nemi'), box: [32.75, 37.83, 32.85, 37.91], where: T('Konya Plain, Türkiye', 'Konya Ovası, Türkiye'),
  },
  {
    k: 'sinkhole', c: '#a855f7', name: T('Sinkhole & subsidence', 'Obruk ve çökme'),
    natural: [T('water slowly dissolves limestone or gypsum underground (karst)', 'su yeraltında kireçtaşı ya da jipsi yavaşça eritir (karst)')],
    human: [T('over-pumping groundwater drains the caves that held the roof up; Konya’s Karapınar now has hundreds of sinkholes', 'aşırı yeraltı suyu çekimi tavanı taşıyan boşlukları boşaltır; Konya Karapınar’da artık yüzlerce obruk var')],
    ground: T('The ground sinks by millimetres to centimetres a year, then a hole can open in a single night.', 'Zemin yılda milimetreler-santimetreler çöker, sonra tek gecede bir delik açılabilir.'),
    radar: T('Interferograms measure the slow sinking (blue line). After a collapse a new ring of shadow and bright rim appears, or a dark disc when it fills with water.', 'İnterferogramlar yavaş çökmeyi ölçer (mavi çizgi). Çöküşten sonra yeni bir gölge halkası ve parlak kenar ya da su dolunca koyu bir disk belirir.'),
    ev: 8, hh: [0.5, 0.51, 0.5, 0.49, 0.5, 0.51, 0.5, 0.5, 0.18, 0.2, 0.22, 0.21], hv: [0.3, 0.3, 0.31, 0.3, 0.29, 0.3, 0.3, 0.31, 0.12, 0.13, 0.14, 0.13], dz: [0.92, 0.89, 0.86, 0.83, 0.8, 0.77, 0.74, 0.71, 0.15, 0.15, 0.15, 0.15],
    tool: 'change', tab: 'analysis', toolName: T('Change between two dates (deformation: next step)', 'İki tarih arası değişim (deformasyon: sonraki adım)'), box: [33.45, 37.68, 33.6, 37.78], where: T('Karapınar, Konya, Türkiye', 'Karapınar, Konya, Türkiye'),
  },
  {
    k: 'spill', c: '#78716c', name: T('Mine spill & mudflow', 'Maden atığı ve çamur akışı'),
    natural: [T('heavy rain or a quake can trigger it', 'yoğun yağış ya da deprem tetikleyebilir')],
    human: [T('a tailings dam or waste heap fails (design, maintenance)', 'bir atık barajı ya da yığını çöker (tasarım, bakım)'), T('cyanide heap leaching on slopes', 'yamaçlarda siyanürlü yığın liçi')],
    ground: T('Mud and mine waste bury fields, roads and rivers, and stay.', 'Çamur ve maden atığı tarlaları, yolları ve dereleri gömer ve kalır.'),
    radar: T('Buried plants: HV drops. The fresh mud changes HH. Unlike a flood, it does not recover.', 'Gömülen bitkiler: HV düşer. Taze çamur HH’yi değiştirir. Selden farklı olarak geri gelmez.'),
    ev: 5, hh: [0.5, 0.51, 0.5, 0.49, 0.5, 0.3, 0.31, 0.32, 0.31, 0.33, 0.32, 0.33], hv: [0.45, 0.46, 0.44, 0.45, 0.46, 0.14, 0.15, 0.15, 0.16, 0.15, 0.16, 0.17],
    tool: 'spill', tab: 'analysis', toolName: T('Mine spill / mudflow', 'Maden atığı / çamur akışı'), box: [38.49, 39.38, 38.59, 39.46], where: T('İliç, Erzincan, Türkiye (2024 heap failure)', 'İliç, Erzincan, Türkiye (2024 yığın çökmesi)'),
  },
  {
    k: 'glacier', c: '#06b6d4', name: T('Glacier melt & outburst floods', 'Buzul erimesi ve taşkınlar'),
    natural: [T('warm spells and summer sun', 'sıcak dönemler ve yaz güneşi')],
    human: [T('global warming from greenhouse gases lengthens and deepens the melt season', 'sera gazlarından kaynaklanan küresel ısınma erime mevsimini uzatır ve derinleştirir')],
    ground: T('Snow turns wet, ice thins and retreats; meltwater lakes grow and can burst.', 'Kar ıslanır, buz incelir ve geri çekilir; erime gölleri büyür ve taşabilir.'),
    radar: T('Liquid water swallows L-band: HH drops sharply while the snow is wet and comes back when it refreezes.', 'Sıvı su L-band’i yutar: kar ıslakken HH keskin düşer, yeniden donunca geri gelir.'),
    ev: -1, hh: [0.72, 0.71, 0.7, 0.55, 0.3, 0.18, 0.16, 0.22, 0.45, 0.66, 0.7, 0.71], hv: [0.4, 0.4, 0.39, 0.32, 0.2, 0.14, 0.13, 0.16, 0.27, 0.37, 0.39, 0.4],
    tool: 'glacier', tab: 'analysis', toolName: T('Glaciers & snow', 'Buzul ve kar'), box: [7.95, 46.42, 8.1, 46.52], where: T('Aletsch Glacier, Switzerland', 'Aletsch Buzulu, İsviçre'),
  },
  {
    k: 'fire', c: '#dc2626', name: T('Wildfire', 'Orman yangını'),
    natural: [T('lightning in dry, windy weather', 'kuru ve rüzgârlı havada yıldırım')],
    human: [T('most fires: carelessness, arson, land clearing', 'yangınların çoğu: dikkatsizlik, kundaklama, arazi açma'), T('hotter, drier summers', 'daha sıcak, daha kuru yazlar')],
    ground: T('The canopy burns; bare, ashy soil is left, and slopes become prone to floods and landslides.', 'Örtü yanar; çıplak, küllü toprak kalır, yamaçlar sel ve heyelana açık hale gelir.'),
    radar: T('Leaves and branches are gone: HV falls and recovers only over years. HH can rise over the exposed ground. Radar maps burn scars through smoke.', 'Yaprak ve dallar gider: HV düşer ve ancak yıllar içinde toparlanır. Açığa çıkan zeminde HH artabilir. Radar yanık alanları dumanın içinden haritalar.'),
    ev: 6, hh: [0.45, 0.46, 0.44, 0.45, 0.46, 0.45, 0.56, 0.55, 0.54, 0.54, 0.53, 0.53], hv: [0.66, 0.65, 0.67, 0.66, 0.65, 0.66, 0.3, 0.31, 0.32, 0.33, 0.34, 0.35],
    tool: 'change', tab: 'analysis', toolName: T('Change between two dates', 'İki tarih arası değişim'), box: [28.3, 36.95, 28.45, 37.05], where: T('Muğla, Türkiye (fire-prone forests)', 'Muğla, Türkiye (yangına açık ormanlar)'),
  },
];

function sig(d) {
  const W = 300, H = 120, px = 26, py = 12, n = d.hh.length;
  const x = (i) => px + (i / (n - 1)) * (W - px - 8), y = (v) => H - py - v * (H - 2 * py);
  const path = (a) => a.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ev = d.ev >= 0 ? (x(d.ev - 1) + x(d.ev)) / 2 : null;
  return `<svg class="dz-sig" viewBox="0 0 ${W} ${H}" role="img" aria-label="${T('Radar signature', 'Radar imzası')}">
    <line x1="${px}" y1="${H - py}" x2="${W - 8}" y2="${H - py}" class="dz-ax"/><line x1="${px}" y1="${py}" x2="${px}" y2="${H - py}" class="dz-ax"/>
    <text x="4" y="${py + 6}" class="dz-t">${T('high', 'yüksek')}</text><text x="4" y="${H - py}" class="dz-t">${T('low', 'düşük')}</text>
    ${ev ? `<line x1="${ev}" y1="${py - 4}" x2="${ev}" y2="${H - py}" class="dz-ev" style="stroke:${d.c}"/><text x="${ev + 4}" y="${py + 4}" class="dz-t" style="fill:${d.c}">${T('event', 'olay')}</text>` : ''}
    ${d.dz ? `<path d="${path(d.dz)}" class="dz-line" style="stroke:${C.dz}" pathLength="1"/>` : ''}
    <path d="${path(d.hv)}" class="dz-line" style="stroke:${C.hv}" pathLength="1"/>
    <path d="${path(d.hh)}" class="dz-line" style="stroke:${C.hh}" pathLength="1"/>
    <text x="${W - 8}" y="${H - 1}" text-anchor="end" class="dz-t">${T('12-day passes →', '12 günlük geçişler →')}</text>
  </svg>`;
}

export function renderDisasters(sheet) {
  const list = D();
  sheet.innerHTML = sheetHead(T('Disasters', 'Afetler'), T('What happens, why, and how NISAR sees it', 'Ne olur, neden olur, NISAR nasıl görür')) + `
  <div class="sheet-body"><div class="page">
    <p class="lead" style="margin-bottom:12px">${T('Every disaster changes the surface in its own way, and leaves its own fingerprint in the radar echo. Each card follows one chain: <b>cause → what happens on the ground → what the radar sees → the tool that finds it</b>. Many disasters are not only natural: people trigger them or make them worse.', 'Her afet yüzeyi kendine özgü biçimde değiştirir ve radar yankısında kendi izini bırakır. Her kart tek bir zinciri izler: <b>neden → yerde ne olur → radar ne görür → onu bulan araç</b>. Afetlerin çoğu yalnızca doğal değildir: insanlar onları tetikler ya da büyütür.')}</p>
    <div class="dz-key small muted">
      <span><i style="background:${C.hh}"></i>HH · ${T('roughness, wetness, buildings', 'pürüzlülük, ıslaklık, binalar')}</span>
      <span><i style="background:${C.hv}"></i>HV · ${T('plant volume', 'bitki hacmi')}</span>
      <span><i style="background:${C.dz}"></i>${T('ground height (interferometry)', 'zemin yüksekliği (interferometri)')}</span>
      <span class="dz-badge nat">${T('natural cause', 'doğal neden')}</span><span class="dz-badge hum">${T('human cause', 'insan kaynaklı neden')}</span>
    </div>
    <div class="seg" id="dzFilter" style="margin:10px 0 14px"><button data-f="all" class="on">${T('All', 'Tümü')}</button><button data-f="nat">${T('Natural, made worse by people', 'Doğal, insanlar ağırlaştırıyor')}</button><button data-f="hum">${T('Mainly caused by people', 'Çoğunlukla insan kaynaklı')}</button></div>
    <div class="dz-grid">${list.map((d) => `
      <article class="panel dz-card" style="--c:${d.c}" data-k="${d.k}">
        <h3><span class="dz-dot"></span>${d.name}</h3>
        <div class="dz-flow">
          <div class="dz-step"><b>${T('Causes', 'Nedenler')}</b>
            <ul>${d.natural.map((x) => `<li><span class="dz-badge nat">${T('natural', 'doğal')}</span> ${x}</li>`).join('')}${d.human.map((x) => `<li><span class="dz-badge hum">${T('human', 'insan')}</span> ${x}</li>`).join('')}</ul></div>
          <div class="dz-step"><b>${T('On the ground', 'Yerde')}</b><p>${d.ground}</p></div>
          <div class="dz-step"><b>${T('What the radar sees', 'Radar ne görür')}</b>${sig(d)}<p>${d.radar}</p></div>
        </div>
        <div class="dz-foot"><span class="small muted">${T('Try it:', 'Deneyin:')} ${d.where}</span>
          <a class="btn btn-sm" href="${reg(d.box, d.tab)}" data-tool="${d.tool}" data-tab="${d.tab}">${d.toolName} →</a></div>
      </article>`).join('')}</div>
    <p class="note" style="margin-top:14px">${T('The curves are schematic signatures that show the typical direction and timing of the change, drawn from the physics of L-band scattering and from the detections on this site; real curves are noisier. Interferometric ground motion (sinkholes, fault slip) uses NISAR GUNW products, the next step for this site.', 'Eğriler, değişimin tipik yönünü ve zamanlamasını gösteren şematik imzalardır; L-band saçılımının fiziğinden ve bu sitedeki tespitlerden çizilmiştir; gerçek eğriler daha gürültülüdür. İnterferometrik zemin hareketi (obruk, fay kayması) NISAR GUNW ürünlerini kullanır; bu sitenin sonraki adımıdır.')}</p>
  </div></div>`;
  sheet.querySelectorAll('[data-tool]').forEach((a) => a.addEventListener('click', () => presetTool(a.dataset.tab, a.dataset.tool)));
  const human = new Set(['sinkhole', 'spill', 'fire']);
  sheet.querySelectorAll('#dzFilter button').forEach((b) => b.addEventListener('click', () => {
    sheet.querySelectorAll('#dzFilter button').forEach((x) => x.classList.toggle('on', x === b));
    sheet.querySelectorAll('.dz-card').forEach((c) => { const f = b.dataset.f, k = c.dataset.k; c.style.display = f === 'all' || (f === 'hum' && human.has(k)) || (f === 'nat' && !human.has(k)) ? '' : 'none'; });
  }));
}
