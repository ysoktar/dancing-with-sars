import { app, sheetHead } from '../main.js';
import { STORIES, themeOf } from '../sites.js';
import { $$, tOf, fmtDate, fmtShort, esc } from '../util.js';
import { T } from '../ux.js';

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
const CAP = () => [
  {
    c: 'var(--ok)', h: T('Measured directly', 'Doğrudan ölçülür'), p: T('NISAR observes these itself, day or night, through cloud.', 'NISAR bunları kendisi, gece gündüz, bulutun içinden gözler.'),
    items: [
      [T('Ground motion', 'Yer hareketi'), T('Sinking, uplift, earthquake and volcanic deformation, to centimetres, along the line of sight (GUNW interferograms).', 'Çökme, yükselme, deprem ve volkanik deformasyon, santimetre düzeyinde, bakış doğrultusunda (GUNW interferogramları).')],
      [T('Ice motion', 'Buz hareketi'), T('Glacier flow speed and direction from pixel offsets (GOFF).', 'Piksel kaymalarından buzul akış hızı ve yönü (GOFF).')],
      [T('Open water and floods', 'Açık su ve seller'), T('Calm water is dark; water under trees is bright (double bounce).', 'Sakin su koyudur; ağaç altındaki su parlaktır (çift yansıma).')],
      [T('Vegetation structure', 'Bitki yapısı'), T('Forest loss, burn scars and crop growth change the HV (volume) signal.', 'Orman kaybı, yangın izleri ve ürün büyümesi HV (hacim) sinyalini değiştirir.')],
      [T('Melt and freeze', 'Erime ve donma'), T('Wet snow absorbs microwaves; refrozen firn scatters strongly.', 'Islak kar mikrodalgayı yutar; yeniden donmuş firn güçlü saçar.')],
      [T('Ships and slicks at sea', 'Denizde gemi ve petrol lekesi'), T('Ships are bright points, oil slicks dark patches (Sentinel-1 covers oceans better than NISAR).', 'Gemiler parlak nokta, petrol lekeleri koyu alan (okyanusları Sentinel-1 NISAR\'dan iyi kapsar).')],
    ],
  },
  {
    c: 'var(--warn)', h: T('Estimated with other data', 'Başka veriyle tahmin edilir'), p: T('Radar is one input; a model or another dataset does the rest.', 'Radar girdilerden biridir; gerisini bir model ya da başka bir veri seti yapar.'),
    items: [
      [T('Crop type', 'Ürün türü'), T('Here from a deep network on Sentinel-2, cleaned with WorldCover and SPAM; radar adds the calendar through cloud.', 'Burada Sentinel-2 üzerinde derin ağdan, WorldCover ve SPAM ile temizlenmiş; radar bulut altında takvimi ekler.')],
      [T('Soil moisture', 'Toprak nemi'), T('Radar gives a relative wetness on bare soil; values in m³/m³ come from ERA5-Land. NISAR\'s validated soil-moisture product is not released yet.', 'Radar çıplak toprakta göreli ıslaklık verir; m³/m³ değerleri ERA5-Land\'den gelir. NISAR\'ın doğrulanmış toprak nemi ürünü henüz yayımlanmadı.')],
      [T('Drought', 'Kuraklık'), T('Rain and soil-moisture records against each place\'s own history; radar wetness as a cross-check.', 'Yağış ve toprak nemi kayıtları her yerin kendi geçmişine göre; radar ıslaklığı çapraz kontrol.')],
      [T('Landslide hazard', 'Heyelan tehlikesi'), T('Slope and rainfall percentiles (LHASA-style); radar detects scars afterwards.', 'Eğim ve yağış yüzdelikleri (LHASA tarzı); radar izleri sonradan tespit eder.')],
      [T('Groundwater loss', 'Yeraltı suyu kaybı'), T('Subsidence hints at it; wells or GRACE gravity confirm it.', 'Çökme bunu işaret eder; kuyular ya da GRACE gravite ölçümleri doğrular.')],
      [T('Crop suitability', 'Ürün uygunluğu'), T('From FAO GAEZ climate, soil and terrain models, not from radar.', 'Radardan değil, FAO GAEZ iklim, toprak ve arazi modellerinden.')],
    ],
  },
  {
    c: 'var(--no)', h: T('Not measurable by radar', 'Radarla ölçülemez'), p: T('Better served by other instruments, and radar can still add context.', 'Başka aletler daha iyi ölçer; radar yine de bağlam ekleyebilir.'),
    items: [
      [T('Soil contamination, heavy metals', 'Toprak kirliliği, ağır metaller'), T('Needs samples and laboratory analysis; hyperspectral imagery (EnMAP, PRISMA) helps target them.', 'Örnek ve laboratuvar analizi gerekir; hiperspektral görüntüler (EnMAP, PRISMA) yer seçmeye yardım eder.')],
      [T('Yield in t/ha', 'Verim (t/ha)'), T('Needs harvest records to calibrate; radar only ranks canopies.', 'Kalibrasyon için hasat kayıtları gerekir; radar yalnızca bitki örtülerini sıralar.')],
      [T('Greenhouse gases, SO₂, NO₂', 'Sera gazları, SO₂, NO₂'), T('Atmospheric spectrometers such as Sentinel-5P / TROPOMI.', 'Sentinel-5P / TROPOMI gibi atmosfer spektrometreleri.')],
      [T('Rainfall amount', 'Yağış miktarı'), T('Weather radar, GPM and weather models.', 'Hava radarı, GPM ve hava modelleri.')],
      [T('Mineral composition', 'Mineral bileşimi'), T('Imaging spectrometers such as NASA EMIT.', 'NASA EMIT gibi görüntüleme spektrometreleri.')],
      [T('Exact earthquake or eruption time', 'Depremin ya da patlamanın tam zamanı'), T('Not reliably predictable by any method today.', 'Bugün hiçbir yöntemle güvenilir biçimde öngörülemez.')],
    ],
  },
];

export function renderMethod(sheet) {
  sheet.innerHTML = sheetHead(T('What radar can tell', 'Radar neyi söyler'), T('And where it needs help', 'Ve nerede yardıma ihtiyaç duyar')) + `
  <div class="sheet-body"><div class="page">
    <p class="lead" style="margin-bottom:18px">${T('NISAR sends microwave pulses and records the echo. The echo depends mostly on surface <b>roughness</b> and <b>wetness</b> (dielectric constant), and its phase records tiny <b>movements</b> between passes. That makes radar very good at some questions and blind to others.', 'NISAR mikrodalga sinyaller gönderip yankıyı kaydeder. Yankı çoğunlukla yüzeyin <b>pürüzlülüğüne</b> ve <b>ıslaklığına</b> (dielektrik sabiti) bağlıdır; fazı ise geçişler arasındaki küçük <b>hareketleri</b> kaydeder. Bu yüzden radar bazı sorularda çok iyi, bazılarında kördür.')}</p>
    <div class="cap">${CAP().map((col) => `<div class="panel col" style="--c:${col.c}"><h3>${col.h}</h3><p>${col.p}</p><ul>${col.items.map(([b, t]) => `<li><b>${b}</b>${t}</li>`).join('')}</ul></div>`).join('')}</div>

    <div class="grid g-2" style="margin-top:16px">
      <div class="panel">
        <h3>${T('Wavelength decides what you see', 'Ne gördüğünüzü dalga boyu belirler')}</h3>
        <div class="seg" id="band" style="margin:6px 0 10px">
          <button data-b="X">X · 3 cm</button><button data-b="C">C · 5.6 cm</button><button data-b="S">S · 10 cm</button><button data-b="L" class="on">L · 24 cm</button>
        </div>
        <svg class="diagram" id="canopy" viewBox="0 0 600 260" role="img" aria-label="${T('How far radar waves reach into a forest', 'Radar dalgalarının ormana ne kadar girdiği')}"></svg>
        <p class="muted small" id="bandTxt" style="margin-top:8px"></p>
      </div>
      <div class="panel">
        <h3>${T('Three ways a surface sends the pulse back', 'Bir yüzeyin sinyali geri göndermesinin üç yolu')}</h3>
        <table class="t">
          <tr><th>${T('Mechanism', 'Mekanizma')}</th><th>${T('Example', 'Örnek')}</th><th>${T('Radar sees', 'Radar ne görür')}</th></tr>
          <tr><td>${T('Surface', 'Yüzey')}</td><td>${T('Calm water, smooth soil', 'Sakin su, düz toprak')}</td><td>${T('Dark (pulse reflected away); rough soil brighter. Mostly HH.', 'Koyu (sinyal başka yöne yansır); pürüzlü toprak daha parlak. Çoğunlukla HH.')}</td></tr>
          <tr><td>${T('Double bounce', 'Çift yansıma')}</td><td>${T('Buildings, flooded forest', 'Binalar, su basmış orman')}</td><td>${T('Very bright HH: ground and wall act as a corner reflector.', 'Çok parlak HH: zemin ve duvar köşe yansıtıcı gibi davranır.')}</td></tr>
          <tr><td>${T('Volume', 'Hacim')}</td><td>${T('Forest canopy, dry snow', 'Orman örtüsü, kuru kar')}</td><td>${T('Many scatterings scramble polarization: strong HV.', 'Çok sayıda saçılma polarizasyonu karıştırır: güçlü HV.')}</td></tr>
        </table>
        <h3 style="margin-top:16px">${T('NISAR in numbers', 'Rakamlarla NISAR')}</h3>
        <dl class="kv">
          <dt>${T('Launch', 'Fırlatma')}</dt><dd>${T('30 July 2025, GSLV-F16, Sriharikota', '30 Temmuz 2025, GSLV-F16, Sriharikota')}</dd>
          <dt>${T('Orbit', 'Yörünge')}</dt><dd>${T('747 km, sun-synchronous, 98.4°', '747 km, güneşe eşzamanlı, 98,4°')}</dd>
          <dt>${T('Revisit', 'Tekrar geçiş')}</dt><dd>${T('12 days, ascending and descending', '12 gün, yükselen ve alçalan')}</dd>
          <dt>${T('Radars', 'Radarlar')}</dt><dd>${T('L-band 24 cm (NASA), S-band 10 cm (ISRO)', 'L-band 24 cm (NASA), S-band 10 cm (ISRO)')}</dd>
          <dt>${T('Swath', 'Tarama şeridi')}</dt><dd>${T('~242 km, 12 m mesh reflector', '~242 km, 12 m ağ yansıtıcı')}</dd>
          <dt>${T('Products', 'Ürünler')}</dt><dd>${T('GCOV backscatter · GUNW interferograms · GOFF offsets · GSLC / RSLC', 'GCOV geri saçılım · GUNW interferogramları · GOFF kaymaları · GSLC / RSLC')}</dd>
        </dl>
      </div>
    </div>
  </div></div>`;
  band('L');
  $$('#band button').forEach((b) => b.addEventListener('click', () => { $$('#band button').forEach((x) => x.classList.toggle('on', x === b)); band(b.dataset.b); }));
}

const BANDS = () => ({
  X: [0.1, T('X-band (3 cm) bounces off the top leaves. Fine detail, no view below the canopy.', 'X-band (3 cm) üst yapraklardan geri döner. İnce ayrıntı, örtünün altını görmez.')],
  C: [0.28, T('C-band (5.6 cm, Sentinel-1) reaches the upper canopy. The workhorse for floods over open land and for sea ice; it saturates over dense forest.', 'C-band (5,6 cm, Sentinel-1) üst örtüye ulaşır. Açık arazide sel ve deniz buzu için temel araç; yoğun ormanda doygunluğa ulaşır.')],
  S: [0.55, T('S-band (10 cm, ISRO on NISAR) reaches into the branches. Sensitive to crops, young forest and soil moisture under light vegetation.', 'S-band (10 cm, NISAR üzerinde ISRO) dalların içine ulaşır. Ürünlere, genç ormana ve seyrek bitki altındaki toprak nemine duyarlı.')],
  L: [1, T('L-band (24 cm, NASA on NISAR) passes through to trunks and ground. It detects water under the forest, tracks biomass, and stays coherent over vegetation for interferometry.', 'L-band (24 cm, NISAR üzerinde NASA) gövdelere ve zemine kadar geçer. Orman altındaki suyu tespit eder, biyokütleyi izler ve interferometri için bitki üzerinde tutarlı kalır.')],
});
function band(b) {
  const [depth, txt] = BANDS()[b];
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
    <text x="12" y="${ground + 30}" fill="#8a94a3" font-size="11" font-family="Inter">${T('flooded forest floor', 'su basmış orman zemini')}${b === 'L' ? T(': reached (red = double bounce back to the satellite)', ': ulaşıldı (kırmızı = uyduya çift yansıma)') : ''}</text>`;
  document.getElementById('bandTxt').textContent = txt;
}

// ------------------------------------------------------------------ Data & methods
export function renderData(sheet) {
  const c = app.catalog;
  const cyc = app.mosaic?.cycles || [];
  const frames = cyc.reduce((n, x) => n + (x.granules || 0), 0).toLocaleString();
  const L = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  sheet.innerHTML = sheetHead(T('Data & methods', 'Veri ve yöntem'), `${T('Catalog built', 'Katalog tarihi')} ${fmtDate(Date.parse(c.generated))}`) + `
  <div class="sheet-body"><div class="page">
    <div class="grid g-2">
      <div class="stack">
        <div class="panel">
          <h3>${T('Where the data comes from', 'Veri nereden geliyor')}</h3>
          <ol class="steps">
            <li>${T(`<b>Any area, live.</b> When you draw an area, the browser asks NASA's ASF archive for every NISAR L2 GCOV pass over it, downloads the public browse images (R = HH, G = HV, ~165 m), mosaics the frames of each date, aligns the dates by <b>FFT phase correlation</b> and filters the speckle. Nothing is precomputed.`, `<b>Her alan, canlı.</b> Bir alan çizdiğinizde tarayıcı NASA'nın ASF arşivinden o alan üzerindeki her NISAR L2 GCOV geçişini ister, açık önizleme görüntülerini (R = HH, G = HV, ~165 m) indirir, her tarihin çerçevelerini birleştirir, tarihleri <b>FFT faz korelasyonu</b> ile hizalar ve karlanmayı süzer. Hiçbir şey önceden hesaplanmaz.`)}</li>
            <li>${T(`<b>World mosaics</b>: ${cyc.length} periods (${frames} frames), raw browse values blended with feathered edges, gaps filled from the nearest period, polar caps closed. On the globe: R = HH, G = HV, B = HH/HV, or a multi-date composite. Values are never altered for looks.`, `<b>Dünya mozaikleri</b>: ${cyc.length} dönem (${frames} çerçeve), ham görüntü değerleri yumuşak kenarlarla birleştirildi, boşluklar en yakın dönemden dolduruldu, kutuplar kapatıldı. Kürede: R = HH, G = HV, B = HH/HV ya da çok tarihli kompozit. Değerler görsellik için asla değiştirilmez.`)}</li>
            <li>${T('<b>Globe metric layers</b>: change, water, seasonal variability, snow melt (from the mosaics), main crop (SPAM 2010), landslide history (NASA Global Landslide Catalog).', '<b>Küre metrik katmanları</b>: değişim, su, mevsimsel değişkenlik, kar erimesi (mozaiklerden), ana ürün (SPAM 2010), heyelan geçmişi (NASA Küresel Heyelan Kataloğu).')}</li>
            <li>${T('<b>Crops</b>: Sentinel-2 L2A Cloud-Optimized GeoTIFFs (Earth Search) for the U-TAE network; ESA WorldCover 10 m; SPAM 2010 crop areas; FAO GAEZ v4 suitability; NASA Harvest CropHarvest field labels.', '<b>Tarım</b>: U-TAE ağı için Sentinel-2 L2A Cloud-Optimized GeoTIFF\'ler (Earth Search); ESA WorldCover 10 m; SPAM 2010 ürün alanları; FAO GAEZ v4 uygunluğu; NASA Harvest CropHarvest arazi etiketleri.')}</li>
            <li>${T('<b>Water, weather and soil</b>: NASA POWER (daily rain, temperature, soil wetness, climatology); ERA5-Land soil moisture in four depths and the rain forecast via Open-Meteo; MODIS NDVI from NASA GIBS.', '<b>Su, hava ve toprak</b>: NASA POWER (günlük yağış, sıcaklık, toprak ıslaklığı, iklim ortalamaları); Open-Meteo üzerinden ERA5-Land dört derinlikte toprak nemi ve yağış tahmini; NASA GIBS\'ten MODIS NDVI.')}</li>
            <li>${T('<b>Terrain and hazards</b>: Terrarium elevation tiles (slope), NASA Global Landslide Catalog, NASA EONET events, USGS earthquakes.', '<b>Arazi ve afetler</b>: Terrarium yükseklik karoları (eğim), NASA Küresel Heyelan Kataloğu, NASA EONET olayları, USGS depremleri.')}</li>
            <li>${T(`Going global: see ${L('https://github.com/ysoktar/dancing-with-sars/blob/main/docs/GLOBAL_DATA.md', 'docs/GLOBAL_DATA.md')} for the size of the full NISAR archive and how to process it.`, `Küresel ölçek: tüm NISAR arşivinin boyutu ve nasıl işleneceği için ${L('https://github.com/ysoktar/dancing-with-sars/blob/main/docs/GLOBAL_DATA.md', 'docs/GLOBAL_DATA.md')}.`)}</li>
          </ol>
        </div>
        <div class="panel">
          <h3>${T('Analysis methods', 'Analiz yöntemleri')}</h3>
          <table class="t">
            <tr><th>${T('Tool', 'Araç')}</th><th>${T('Method', 'Yöntem')}</th></tr>
            ${[
              [T('Speckle filter', 'Karlanma süzgeci'), T('multi-temporal Quegan filter + Lee 3×3', 'çok zamanlı Quegan süzgeci + Lee 3×3')],
              [T('Change detection', 'Değişim tespiti'), T('log-ratio, Otsu threshold, per-pixel confidence', 'log-oran, Otsu eşiği, piksel başına güven')],
              [T('Crop types', 'Ürün türleri'), T('U-TAE (PASTIS weights) in the browser, WorldCover + SPAM prior, field vote', 'tarayıcıda U-TAE (PASTIS ağırlıkları), WorldCover + SPAM ön bilgisi, tarla oylaması')],
              [T('Crop suggestions', 'Ürün önerileri'), T('GAEZ suitability vs SPAM crops grown, root-zone moisture', 'GAEZ uygunluğu ve SPAM\'de ekilenler, kök bölgesi nemi')],
              [T('Soil moisture', 'Toprak nemi'), T('ERA5-Land anomaly; NISAR bare-soil change detection (Wagner)', 'ERA5-Land sapması; NISAR çıplak toprakta değişim tespiti (Wagner)')],
              [T('Drought', 'Kuraklık'), T('rain percentiles / SPI, soil-moisture percentile, D0–D4', 'yağış yüzdelikleri / SPI, toprak nemi yüzdeliği, D0–D4')],
              [T('Compare two areas', 'İki alanı karşılaştır'), T('feature-distribution overlap + land cover, crops, climate, soil water, terrain', 'özellik dağılımı örtüşmesi + arazi örtüsü, ürün, iklim, toprak suyu, arazi yapısı')],
              [T('Landslides', 'Heyelanlar'), T('HV drop on slopes ≥ 15° vs flat-ground noise; LHASA-style rain trigger', '≥ 15° eğimde düz arazi gürültüsüne göre HV düşüşü; LHASA tarzı yağış tetikleyicisi')],
              [T('Mine spill', 'Maden atığı'), T('HV and HH change together, persistent, per-pixel threshold', 'HV ve HH birlikte, kalıcı değişim, piksel başına eşik')],
              [T('Glaciers', 'Buzullar'), T('wet-snow mapping (Nagler & Rott), wet-snow line', 'ıslak kar haritalama (Nagler & Rott), ıslak kar çizgisi')],
              [T('Surface types', 'Yüzey türleri'), T('k-means++ on 6 features', '6 özellik üzerinde k-means++')],
              [T('Forecast', 'Tahmin'), T('damped trend + residual bootstrap, backtest', 'sönümlü eğilim + artık önyükleme, geriye dönük test')],
            ].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}
          </table>
        </div>
      </div>
      <div class="stack">
        <div class="panel">
          <h3>${T('Limitations', 'Sınırlamalar')}</h3>
          <ul class="plain">
            <li>${T('Browse images are 8-bit renderings (~165 m pixels), not calibrated γ⁰ at 10–20 m. Numbers here are <b>relative brightness</b>; <code>pipeline/fetch_hdf5.py</code> extracts calibrated values with a free Earthdata login.', 'Önizleme görüntüleri 8 bitlik görsellerdir (~165 m piksel), 10–20 m\'de kalibre γ⁰ değil. Buradaki sayılar <b>göreli parlaklıktır</b>; <code>pipeline/fetch_hdf5.py</code> ücretsiz Earthdata hesabıyla kalibre değerleri çıkarır.')}</li>
            <li>${T('Most products are labelled <i>provisional</i> by the NISAR project; the record starts in October 2025 (June 2026 over much of the southern hemisphere), so multi-year trends need older missions.', 'Ürünlerin çoğu NISAR projesince <i>geçici</i> olarak etiketli; kayıt Ekim 2025\'te (güney yarım kürenin çoğunda Haziran 2026\'da) başlıyor, çok yıllık eğilimler için eski görevler gerekir.')}</li>
            <li>${T('Radar does not measure crop species, yield or soil chemistry directly: those come from other data, and the pages say so.', 'Radar ürün türünü, verimi ya da toprak kimyasını doğrudan ölçmez: bunlar başka verilerden gelir ve sayfalar bunu belirtir.')}</li>
            <li>${T('Global grids (GAEZ, SPAM, ERA5-Land, NASA POWER) describe areas of ~10–50 km, not single parcels.', 'Küresel ızgaralar (GAEZ, SPAM, ERA5-Land, NASA POWER) tek parselleri değil ~10–50 km\'lik alanları anlatır.')}</li>
            <li>${T('Landslide and drought levels are indicators, not official warnings.', 'Heyelan ve kuraklık seviyeleri göstergedir, resmi uyarı değildir.')}</li>
          </ul>
        </div>
        <div class="panel">
          <h3>${T('Challenge resources', 'Yarışma kaynakları')}</h3>
          <table class="t">
            <tr><th>${T('Resource', 'Kaynak')}</th><th>${T('What it gives you', 'Ne sağlar')}</th></tr>
            <tr><td>${L('https://search.asf.alaska.edu/', 'ASF Vertex')}</td><td>${T("NASA's SAR archive; every NISAR product used here (GCOV, GUNW, GOFF).", "NASA'nın SAR arşivi; burada kullanılan tüm NISAR ürünleri (GCOV, GUNW, GOFF).")}</td></tr>
            <tr><td>${L('https://search.earthdata.nasa.gov/search', 'NASA Earthdata Search')}</td><td>${T('Search all NASA Earth data (NISAR, optical, GPM rainfall, SMAP soil moisture…).', 'Tüm NASA yer verisini arayın (NISAR, optik, GPM yağış, SMAP toprak nemi…).')}</td></tr>
            <tr><td>${L('https://nisar-docs.asf.alaska.edu/', 'NISAR Data User Guide')}</td><td>${T('Product formats, access and processing for NISAR.', 'NISAR için ürün biçimleri, erişim ve işleme.')}</td></tr>
            <tr><td>${L('https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar', T('Intro to SAR', 'SAR\'a giriş'))} · ${L('https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/remote-sensing', T('Intro to remote sensing', 'Uzaktan algılamaya giriş'))}</td><td>${T('Wavelength, polarization, scattering, resolution.', 'Dalga boyu, polarizasyon, saçılma, çözünürlük.')}</td></tr>
            <tr><td>${L('https://appliedsciences.nasa.gov/get-involved/training', 'NASA ARSET')}</td><td>${T('Free courses on SAR and NISAR for disasters, agriculture, water and ecosystems.', 'Afet, tarım, su ve ekosistemler için ücretsiz SAR ve NISAR kursları.')}</td></tr>
            <tr><td>${L('https://nisar.jpl.nasa.gov/applications/arcgis-storymaps/', 'NISAR StoryMaps')}</td><td>${T('Floods, wildfires, land subsidence, oil slicks and glacier motion, explained with SAR.', 'Sel, orman yangını, çökme, petrol lekesi ve buzul hareketi, SAR ile anlatılıyor.')}</td></tr>
            <tr><td>${L('https://nisar.jpl.nasa.gov/applications/societal-benefit/', T('NISAR applications white papers', 'NISAR uygulama raporları'))}</td><td>${T("Two-page summaries of NISAR's societal applications.", "NISAR'ın toplumsal uygulamalarının iki sayfalık özetleri.")}</td></tr>
            <tr><td>${L('https://uavsar.jpl.nasa.gov/education/postcards.html', T('UAVSAR postcards', 'UAVSAR kartpostalları'))}</td><td>${T('Airborne L-band false-colour examples.', 'Havadan L-band yanlış renk örnekleri.')}</td></tr>
          </table>
          <h3 style="margin-top:14px">${T('Other SAR missions (partner agencies)', 'Diğer SAR görevleri (ortak ajanslar)')}</h3>
          <table class="t">
            <tr><th>${T('Mission', 'Görev')}</th><th>${T('Band', 'Bant')}</th><th>${T('Access', 'Erişim')}</th></tr>
            <tr><td>${L('https://donnees-data.asc-csa.gc.ca/en/dataset/rcm', 'RADARSAT Constellation (CSA)')}</td><td>C</td><td>${T('maritime, ice, disasters, ecosystems; registration', 'deniz, buz, afet, ekosistem; kayıt gerekir')}</td></tr>
            <tr><td>${L('https://donnees-data.asc-csa.gc.ca/en/dataset/radarsat1', 'RADARSAT-1 (CSA)')}</td><td>C</td><td>${T('1995–2013, open licence: decades of history before NISAR', '1995–2013, açık lisans: NISAR öncesi onlarca yıllık geçmiş')}</td></tr>
            <tr><td>${L('https://catalogos.conae.gov.ar/catalogo/catalogoSatSaocomInfo.html', 'SAOCOM (CONAE)')}</td><td>L</td><td>${T('same wavelength as NISAR; strong over Argentina; ONE CLICK registration', 'NISAR ile aynı dalga boyu; Arjantin üzerinde güçlü; ONE CLICK kaydı')}</td></tr>
          </table>
          <p class="note">${T(`These archives need an account, so they are linked here rather than built into the site. ${L('https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial', "CSA's SAR Python tutorial")} shows how to work with them.`, `Bu arşivler hesap gerektirdiği için siteye gömülmek yerine burada bağlantılandı. ${L('https://github.com/asc-csa/Synthetic_Aperture_Radar_Tutorial', "CSA'nın SAR Python eğitimi")} nasıl çalışılacağını gösterir.`)}</p>
        </div>
        <div class="panel">
          <h3>${T('Run it yourself', 'Kendiniz çalıştırın')}</h3>
<pre>pip install -r pipeline/requirements.txt
python pipeline/build_mosaic.py --start 2026-10-13 --days 12 --tiles
python pipeline/build_metrics.py
python pipeline/build_suitability.py
cd web &amp;&amp; npm ci &amp;&amp; npm run dev</pre>
          <p class="note">${T('Source code', 'Kaynak kod')}: ${L('https://github.com/ysoktar/dancing-with-sars', 'github.com/ysoktar/dancing-with-sars')} · ${T('Data', 'Veri')}: NASA/JPL-Caltech &amp; ISRO via ${L('https://search.asf.alaska.edu', 'ASF DAAC')} · ${L('https://nisar-docs.asf.alaska.edu/', T('NISAR data user guide', 'NISAR veri kullanıcı kılavuzu'))}</p>
        </div>
      </div>
    </div>
  </div></div>`;
}


// ------------------------------------------------------------------ Agriculture overview
const AG = new Set(['agriculture', 'groundwater', 'flood']);

export async function renderAgriculture(sheet) {
  const sites = app.sites.filter((s) => AG.has((STORIES[s.id] || {}).theme || s.theme));
  const months = [];
  for (let d = new Date(Date.UTC(2025, 9, 1)); d <= new Date(); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
  sheet.innerHTML = sheetHead('Agriculture', `${sites.length} crop regions watched by NISAR: when crops grow, peak and are harvested`) + `
  <div class="sheet-body"><div class="page">
    <p class="lead" style="margin-bottom:14px">Each row is a farming region; each column a month. Colour shows how green the fields are, from low (dark) to the region's own maximum (bright). Top: the <b>NISAR radar vegetation index</b>, RVI = 4·HV/(HH+HV), which works through cloud. Bottom: <b>MODIS NDVI</b> from optical images. Matching bright bands mean both sensors see the same crop season.</p>
    <div class="panel"><h3>Radar vegetation index (NISAR, monthly mean)</h3><canvas id="hmR" style="width:100%;display:block"></canvas></div>
    <div class="panel" style="margin-top:14px"><h3>Optical NDVI (MODIS, monthly mean)</h3><canvas id="hmN" style="width:100%;display:block"></canvas></div>
    <div class="panel" style="margin-top:14px"><h3>Crop regions</h3>
      <table class="t" id="agTab"><tr><th>Region</th><th>Passes</th><th>Greenest month (radar)</th><th>Greenest month (optical)</th><th>Rain since Oct 2025</th><th></th></tr></table>
      <p class="note">Open a region's <b>Agriculture</b> tab for per-pixel crop calendars, harvest progress, paddy flooding, cropping patterns and field segments.</p>
    </div>
  </div></div>`;
  const ctx = {};
  await Promise.all(sites.map(async (s) => { try { const r = await fetch(`${app.base}data/context/${s.id}.json`); if (r.ok) ctx[s.id] = await r.json(); } catch (e) { /* none */ } }));
  const radar = sites.map((s) => {
    const m = {};
    for (const a of s.acquisitions) { const k = a.date.slice(0, 7); (m[k] = m[k] || []).push((4 * a.hv) / (a.hh + a.hv + 1)); }
    return months.map((k) => (m[k] ? m[k].reduce((x, y) => x + y, 0) / m[k].length : null));
  });
  const optical = sites.map((s) => {
    const n = ctx[s.id]?.ndvi, m = {};
    if (n) n.dates.forEach((d, i) => { const k = d.slice(0, 7); (m[k] = m[k] || []).push(n.mean[i]); });
    return months.map((k) => (m[k] ? m[k].reduce((x, y) => x + y, 0) / m[k].length : null));
  });
  heatmap($('#hmR'), sites, months, radar);
  heatmap($('#hmN'), sites, months, optical);
  const peak = (row) => { let b = -1, v = -Infinity; row.forEach((x, i) => { if (x != null && x > v) { v = x; b = i; } }); return b < 0 ? '–' : new Date(months[b] + '-15').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }); };
  const rain = (s) => { const w = ctx[s.id]?.weather; return w ? Math.round(w.precip_mm.reduce((a, b) => a + (b || 0), 0)) + ' mm' : '–'; };
  $('#agTab').insertAdjacentHTML('beforeend', sites.map((s, i) => `<tr><td><b>${esc(s.name)}</b> <span class="muted">${esc(s.country)}</span></td><td class="num">${s.acquisitions.length}</td><td>${peak(radar[i])}</td><td>${peak(optical[i])}</td><td class="num">${rain(s)}</td><td><a href="#/site/${s.id}/agri">Open →</a></td></tr>`).join(''));
}

function heatmap(cv, sites, months, rows) {
  const w = cv.clientWidth, rowH = 22, labW = 190, top = 4, h = top + rows.length * rowH + 22;
  const dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  const cw = (w - labW) / months.length;
  const stops = [[13, 8, 135], [126, 3, 168], [204, 71, 120], [248, 149, 64], [240, 249, 33]];
  const col = (t) => { const f = t * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(f)), u = f - k; return `rgb(${stops[k].map((v, i) => Math.round(v * (1 - u) + stops[k + 1][i] * u)).join(',')})`; };
  ctx.font = '12px Inter, sans-serif'; ctx.textBaseline = 'middle';
  rows.forEach((row, r) => {
    const vals = row.filter((v) => v != null);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    ctx.fillStyle = '#b9c0cb'; ctx.fillText(sites[r].name, 0, top + r * rowH + rowH / 2);
    row.forEach((v, c) => {
      ctx.fillStyle = v == null ? '#161a20' : col(hi > lo ? (v - lo) / (hi - lo) : 0.5);
      ctx.fillRect(labW + c * cw + 1, top + r * rowH + 1, cw - 2, rowH - 2);
    });
  });
  ctx.fillStyle = '#8a94a3'; ctx.font = '11px Inter, sans-serif';
  months.forEach((m, c) => { if (c % Math.max(1, Math.round(50 / cw)) === 0) ctx.fillText(new Date(m + '-15').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), labW + c * cw + 2, top + rows.length * rowH + 11); });
}
