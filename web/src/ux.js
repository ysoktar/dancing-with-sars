// Interface helpers: light / dark theme, English / Turkish, and a glossary (dashed-underlined terms with a plain
// definition on hover). Translation swaps exact interface strings in place, so every page and tool is covered without
// each one knowing about languages; long method notes stay in English where no translation is given.
import Chart from 'chart.js/auto';

const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return v; };

// ------------------------------------------------------------------ theme
export function initTheme() {
  const saved = LS('dws.theme');
  const theme = saved || (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  applyTheme(theme);
  const b = document.getElementById('themeBtn');
  if (b) b.addEventListener('click', () => { const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; LS('dws.theme', t); applyTheme(t); });
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const css = getComputedStyle(document.documentElement);
  Chart.defaults.color = css.getPropertyValue('--muted').trim() || '#8a94a3';
  Chart.defaults.borderColor = t === 'light' ? 'rgba(60,70,90,0.12)' : 'rgba(138,148,163,0.12)';
  const b = document.getElementById('themeBtn');
  if (b) { b.textContent = t === 'light' ? '☾' : '☀'; b.title = lang === 'tr' ? (t === 'light' ? 'Koyu tema' : 'Açık tema') : (t === 'light' ? 'Dark theme' : 'Light theme'); }
  Object.values(Chart.instances || {}).forEach((c) => { try { c.update('none'); } catch (e) { /* chart gone */ } });
}

// ------------------------------------------------------------------ language
let lang = 'en';
export const getLang = () => lang;
/** Text in the current language: T('English', 'Türkçe'). Views are redrawn on a language switch (event 'dws:lang'). */
export const T = (en, tr) => (lang === 'tr' && tr ? tr : en);
const TR = {
  // navigation and global
  'Globe': 'Küre', 'Select region': 'Bölge seç', 'What radar can tell': 'Radar neyi söyler', 'Data & methods': 'Veri ve yöntem',
  'Layers': 'Katmanlar', 'Legend': 'Lejant', 'Draw an area on the globe': 'Kürede bir alan çiz', 'Go': 'Git',
  'Find a place first (then draw)': 'Önce bir yer bul (sonra çiz)', 'Cancel': 'İptal', 'Close': 'Kapat', 'Recent areas': 'Son alanlar',
  'Radar': 'Radar', 'What the radar shows': 'Radarın gösterdikleri', 'Context': 'Bağlam',
  'Multi-date composite (3 cycles)': 'Çok tarihli kompozit (3 döngü)', 'Full-resolution NISAR frames when zoomed in': 'Yakınlaşınca tam çözünürlüklü NISAR çerçeveleri',
  'Change since the previous cycle': 'Önceki döngüden bu yana değişim', 'Water & wet surfaces': 'Su ve ıslak yüzeyler',
  'Seasonal variability (fields vs steady land)': 'Mevsimsel değişkenlik (tarla ve sabit arazi)', 'Snow & ice melt': 'Kar ve buz erimesi',
  'Cropland & forest (from the mosaics)': 'Tarım ve orman (mozaiklerden)', 'Acquisitions per month': 'Aylık çekim sayısı',
  'Natural events (EONET)': 'Doğal olaylar (EONET)', 'NISAR satellite, orbit & swath': 'NISAR uydusu, yörünge ve tarama şeridi',
  'Night side lights': 'Gece ışıkları', 'Main crop (SPAM)': 'Ana ürün (SPAM)', 'Landslide history (NASA)': 'Heyelan geçmişi (NASA)', 'Radar indices': 'Radar indisleri', 'Change twins of farm fields (NISAR + ML)': 'Tarlaların değişim ikizleri (NISAR + ML)', 'Floods, fires & any change': 'Sel, yangın ve her değişim', 'What changed between two dates': 'İki tarih arasında ne değişti', 'Disasters': 'Afetler', 'Explore an area': 'Bir alanı incele', 'Disasters & change': 'Afetler ve değişim', 'Crops & drought': 'Tarım ve kuraklık', 'Disaster &amp; change signals': 'Afet ve değişim sinyalleri', 'Explore a disaster': 'Bir afeti keşfet', 'How each disaster works →': 'Her afet nasıl işler →', 'Or look at any place': 'Ya da herhangi bir yere bakın', 'RVI, RFDI, HV/HH from calibrated γ⁰': 'Kalibre γ⁰ ile RVI, RFDI, HV/HH', 'Earthquakes & damage': 'Deprem ve hasar', 'Nearby quakes + building-damage proxy': 'Yakın depremler + bina hasar göstergesi', 'Sentinel-1 C-band (2020 · 2021)': 'Sentinel-1 C-band (2020 · 2021)',
  // region page tabs
  'Summary': 'Özet', 'Crops': 'Tarım', 'Parcel report': 'Parsel raporu', 'Archive 1978→': 'Arşiv 1978→', 'Radar images': 'Radar görüntüleri',
  'Change & ML': 'Değişim ve analiz', 'Forecast': 'Tahmin',
  // crops tools
  'Crop types & calendar': 'Ürün türleri ve takvim', 'U-TAE or your U-Mamba / SITSMamba': 'U-TAE ya da U-Mamba / SITSMamba',
  'What could grow here': 'Burada ne yetişebilir', 'Suitable crops vs crops grown now': 'Uygun ürünler ve şu an ekilenler',
  'Soil moisture': 'Toprak nemi', 'Four soil layers + NISAR surface wetness': 'Dört toprak katmanı + NISAR yüzey ıslaklığı',
  'Drought': 'Kuraklık', 'Drier than usual? Rain, soil, heat': 'Her zamankinden kuru mu? Yağış, toprak, sıcaklık',
  'Cropland vs forest': 'Tarım ve orman', 'Where fields end and forest begins': 'Tarlanın bittiği, ormanın başladığı yer',
  'Weather & NDVI': 'Hava ve NDVI', 'Rain, temperature, optical greenness': 'Yağış, sıcaklık, optik yeşillik',
  // analysis tools
  'Compare two areas': 'İki alanı karşılaştır', 'How alike two places behave': 'İki yer ne kadar benzer davranıyor',
  'Change between two dates': 'İki tarih arası değişim', 'Log-ratio + automatic threshold': 'Log-oran + otomatik eşik',
  'Surface types': 'Yüzey türleri', 'Unsupervised k-means clustering': 'Denetimsiz k-ortalamalar kümeleme',
  'Seasonal swing vs canopy volume': 'Mevsimsel salınım ve bitki hacmi', 'Flood history': 'Sel geçmişi',
  'Landslides': 'Heyelanlar', 'Detect slides + rain-triggered hazard': 'Heyelan tespiti + yağışa bağlı tehlike',
  'Mine spill / mudflow': 'Maden atığı / çamur akışı', 'Spread of tailings and farmland reached': 'Atığın yayılımı ve ulaştığı tarım alanı',
  'Glaciers & snow': 'Buzullar ve kar', 'When and where ice melts': 'Buz ne zaman, nerede eriyor',
  // common labels
  'Before': 'Önce', 'After': 'Sonra', 'From': 'Başlangıç', 'To': 'Bitiş', 'Pass': 'Geçiş', 'Sensitivity': 'Duyarlılık', 'Compare': 'Karşılaştır',
  'Min. slope': 'En az eğim', 'Channel': 'Kanal', 'Change': 'Değişim', 'Confidence': 'Güven', 'Crop': 'Ürün', 'Window': 'Pencere', 'Layer': 'Katman',
  'Rain-fed': 'Yağmura bağlı', 'Irrigated': 'Sulu', 'Water': 'Su', 'Grown now': 'Şu an ekili', 'Share of crop area': 'Tarım alanındaki payı',
  'normal': 'normal', 'Aspect': 'Boyut', 'alike': 'benzer', 'Feature': 'Özellik', 'overlap': 'örtüşme', 'Patch': 'Parça', 'Location': 'Konum',
  'Loading…': 'Yükleniyor…', 'Detecting…': 'Tespit ediliyor…', 'Mapping…': 'Haritalanıyor…', 'Matching…': 'Eşleştiriliyor…',
  'Radar behaviour': 'Radar davranışı', 'Land cover': 'Arazi örtüsü', 'Crop mix': 'Ürün karışımı', 'Climate': 'İklim', 'Soil water regime': 'Toprak suyu rejimi', 'Terrain': 'Arazi yapısı',
  'Most melt': 'En çok erime', 'Melt season (≥ 30 % wet)': 'Erime mevsimi (≥ %30 ıslak)',
  'dry snow / ice': 'kuru kar / buz', 'wet: melting': 'ıslak: eriyor', 'not ice': 'buz değil',
  'like B': "B'ye benzer", 'somewhat': 'kısmen', 'unlike B': "B'ye benzemez", 'water / no data': 'su / veri yok',
  'Hazard: now and the next 7 days': 'Tehlike: şimdi ve önümüzdeki 7 gün', 'Detection with NISAR': 'NISAR ile tespit',
  'Options: suitable here but not grown in this area': 'Seçenekler: burada uygun ama bu bölgede ekilmiyor',
  'Grown here now (SPAM) and how suitable they are': 'Şu an burada ekilenler (SPAM) ve ne kadar uygun oldukları',
  'NISAR relative surface wetness vs ERA5-Land topsoil': 'NISAR göreli yüzey ıslaklığı ve ERA5-Land üst toprak',
  'Multi-date composite · HH backscatter': 'Çok tarihli kompozit · HH geri saçılım', 'Selected area': 'Seçili alan', 'drawn rectangle': 'çizilen dikdörtgen',
  'NISAR satellite': 'NISAR uydusu', 'position (accelerated clock)': 'konum (hızlandırılmış saat)', 'ground track': 'yer izi',
  'Seasonal variability': 'Mevsimsel değişkenlik', 'Main crop': 'Ana ürün', 'Landslide history': 'Heyelan geçmişi', 'Water &amp; wet surfaces': 'Su ve ıslak yüzeyler',
  'Snow &amp; ice melt': 'Kar ve buz erimesi', 'No layer on.': 'Açık katman yok.',
  'very high': 'çok yüksek', 'high': 'yüksek', 'good': 'iyi', 'medium': 'orta', 'moderate': 'vasat', 'marginal': 'sınırda', 'very marginal or not suitable': 'çok sınırda ya da uygun değil',
  'needs irrigation': 'sulama gerekir', 'rain-fed OK': 'yağmurla olur', 'irrigation helps': 'sulama faydalı', 'no': 'hayır', 'Selected region': 'Seçili bölge',
  'low': 'düşük', 'very high hazard': 'çok yüksek tehlike', 'D0 abnormally dry': 'D0 olağandışı kuru', 'D1 moderate drought': 'D1 orta kuraklık', 'D2 severe drought': 'D2 şiddetli kuraklık',
  'D3 extreme drought': 'D3 aşırı kuraklık', 'D4 exceptional drought': 'D4 istisnai kuraklık', 'wetter than usual': 'normalden ıslak',
  'Structural class': 'Yapısal sınıf', 'Through the year': 'Yıl boyunca', 'Area B at': 'B alanı:', 'or a recent area': 'ya da son bir alan', 'or a reference': 'ya da bir referans',
  'shift B by 6 months (other hemisphere)': "B'yi 6 ay kaydır (diğer yarım küre)", 'Event between the passes before and': 'Olay, şu geçişten önceki geçişlerle arasında:',
  'Choose a window and press “Run U-TAE here”. The first run downloads the model (4.5 MB) and about 10 MB of Sentinel-2 data per date.': 'Bir pencere seçip “Run U-TAE here”a basın. İlk çalıştırma modeli (4,5 MB) ve tarih başına yaklaşık 10 MB Sentinel-2 verisini indirir.',
  'Enter "lat, lon" or pick an area.': '"enlem, boylam" girin ya da bir alan seçin.',
  'Fetching ERA5-Land soil moisture (4 layers), NASA POWER soil wetness and computing NISAR surface wetness…': 'ERA5-Land toprak nemi (4 katman), NASA POWER toprak ıslaklığı çekiliyor ve NISAR yüzey ıslaklığı hesaplanıyor…',
  'Fetching NASA POWER weather and MODIS NDVI for this window…': 'Bu pencere için NASA POWER hava ve MODIS NDVI verisi çekiliyor…',
  'GAEZ rates no crop here (no current cropland in these cells, or outside the land mask).': 'GAEZ burada hiçbir ürünü puanlamıyor (bu hücrelerde tarım alanı yok ya da kara maskesinin dışında).',
  'Loading elevation (slope), the NASA landslide catalog and rainfall since 2001…': "Yükseklik (eğim), NASA heyelan kataloğu ve 2001'den beri yağış yükleniyor…",
  'Loading elevation and finding snow and ice…': 'Yükseklik yükleniyor, kar ve buz aranıyor…',
  'Loading flood history…': 'Sel geçmişi yükleniyor…',
  'Loading radar images…': 'Radar görüntüleri yükleniyor…',
  'Loading weather and NDVI…': 'Hava ve NDVI yükleniyor…',
  'NISAR has not yet published interferograms or offset maps covering this site.': 'NISAR bu alanı kapsayan interferogram ya da kayma haritası henüz yayımlamadı.',
  'Nothing recorded for this filter.': 'Bu süzgeç için kayıt yok.',
  'Reading 25 years of rainfall and temperature (NASA POWER) and soil moisture (ERA5-Land)…': '25 yıllık yağış ve sıcaklık (NASA POWER) ile toprak nemi (ERA5-Land) okunuyor…',
  'Reading FAO GAEZ suitability, the SPAM crop mix and ERA5-Land soil moisture for this area…': 'Bu alan için FAO GAEZ uygunluğu, SPAM ürün karışımı ve ERA5-Land toprak nemi okunuyor…',
  'Searching the ASF archive for every radar mission over this window (Seasat 1978 → NISAR)…': 'ASF arşivinde bu pencere üzerindeki tüm radar görevleri aranıyor (Seasat 1978 → NISAR)…',
  'Separating cropland from forest…': 'Tarım alanı ormandan ayrılıyor…',
  'This site lies outside the flood-history dataset (latitude −39° to 43°, longitude −125° to 170°).': 'Bu alan sel geçmişi veri setinin dışında (enlem −39° – 43°, boylam −125° – 170°).',
  'Searching the ASF archive…': 'ASF arşivi aranıyor…',
  'Comparing land cover, crop mix, climate, soil water and terrain…': 'Arazi örtüsü, ürün karışımı, iklim, toprak suyu ve arazi yapısı karşılaştırılıyor…',
  'How alike are the two places?': 'İki yer ne kadar benzer?',
  'Closest specific Brazilian example (a hint)': 'En yakın Brezilya örneği (ipucu)',
  'Landslides reported nearby (NASA Global Landslide Catalog)': 'Yakında bildirilen heyelanlar (NASA Küresel Heyelan Kataloğu)',
  'NASA POWER soil wetness, monthly since 2016': "NASA POWER toprak ıslaklığı, 2016'dan beri aylık",
  'Crops grown here': 'Burada ekilen ürünler',
  'Ground labels nearby': 'Yakındaki arazi etiketleri',
  'Looking for NASA Harvest field labels…': 'NASA Harvest arazi etiketleri aranıyor…',
  'Loading SPAM 2010 crop statistics…': 'SPAM 2010 ürün istatistikleri yükleniyor…',
  'Recorded on the ground': 'Arazide kaydedilen',
  'labels': 'etiket',
  'Crop types and calendar': 'Ürün türleri ve takvim',
  'Date': 'Tarih',
  'Where': 'Yer',
  'Type': 'Tür',
  'Trigger': 'Tetikleyici',
  'Size': 'Boyut',
  'Deaths': 'Ölüm',
  'rain, mm': 'yağış, mm',
  'level': 'seviye',
  'rain-fed OK': 'yağmurla olur',
  'Wet-snow line on that pass': 'O geçişte ıslak kar çizgisi',
  'Closest Brazilian example': 'En yakın Brezilya örneği',
  'Structural shifts': 'Yapısal değişimler',
  'wheat': 'buğday', 'rice': 'pirinç', 'maize': 'mısır', 'soybean': 'soya', 'sugarcane': 'şeker kamışı', 'barley': 'arpa', 'cotton': 'pamuk', 'sorghum': 'sorgum',
  'millet': 'darı', 'cassava': 'manyok', 'oil palm': 'yağ palmiyesi', 'vegetables': 'sebze', 'reported': 'bildirilen', '1–9 deaths': '1–9 ölüm', '10+ deaths': '10+ ölüm',
};
// paragraphs with markup inside: translated as a whole (elements with data-i18n-html="key")
const TR_HTML = {
  intro: '<b>Afetler Dünya’yı nasıl değiştirir, radarla görün.</b> NASA–ISRO <b>NISAR</b> uydusunun gerçek görüntüleri; uydu tüm karaları 12 günde bir, bulutun içinden ve gece de görür. Her afet radar yankısında kendi izini bırakır: birini seçin, neden olduğunu ve radarın onu nasıl bulduğunu görün.',
  drawNote: 'Alanınızın bütün NISAR geçişleri canlı çekilir ve tarayıcınızda analiz edilir. Radar pikselleri yaklaşık 165 m; 5 km\'lik bir alanda yaklaşık 30 × 30 piksel vardır.',
};
const original = new WeakMap();
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CANVAS', 'svg', 'CODE']);

function translateTree(root) {
  if (!root) return;
  root.querySelectorAll?.('[data-i18n-html]').forEach((el) => {
    if (!original.has(el)) original.set(el, el.innerHTML);
    el.innerHTML = lang === 'tr' && TR_HTML[el.dataset.i18nHtml] ? TR_HTML[el.dataset.i18nHtml] : original.get(el);
  });
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (SKIP.has(n.parentNode?.nodeName) || n.parentNode?.closest?.('[data-i18n-html]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodes = [];
  while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes) {
    const raw = original.has(n) ? original.get(n) : n.nodeValue;
    const key = raw.trim();
    if (!key) continue;
    if (lang === 'tr' && TR[key]) {
      if (!original.has(n)) original.set(n, raw);
      n.nodeValue = raw.replace(key, TR[key]);
    } else if (lang === 'en' && original.has(n)) n.nodeValue = original.get(n);
  }
  root.querySelectorAll?.('input[placeholder]').forEach((el) => {
    if (!el.dataset.ph) el.dataset.ph = el.placeholder;
    el.placeholder = lang === 'tr' ? el.dataset.ph.replace('e.g.', 'ör.').replace('or', 'ya da') : el.dataset.ph;
  });
}

export function initLang() {
  lang = LS('dws.lang') || ((navigator.language || '').startsWith('tr') ? 'tr' : 'en');
  document.documentElement.lang = lang;
  const b = document.getElementById('langBtn');
  if (b) {
    b.textContent = lang === 'tr' ? 'EN' : 'TR';
    b.addEventListener('click', () => {
      lang = lang === 'tr' ? 'en' : 'tr'; LS('dws.lang', lang); document.documentElement.lang = lang;
      b.textContent = lang === 'tr' ? 'EN' : 'TR'; b.title = lang === 'tr' ? 'Switch to English' : 'Türkçeye geç';
      window.dispatchEvent(new Event('dws:lang'));
      refresh(document.body);
      applyTheme(document.documentElement.dataset.theme || 'dark');
    });
    b.title = lang === 'tr' ? 'Switch to English' : 'Türkçeye geç';
  }
}

// ------------------------------------------------------------------ glossary
const TERMS = [
  ['NISAR', 'NASA–ISRO radar satellite (launched 2025). It images almost all land and ice every 12 days, day and night, through cloud.', 'NASA–ISRO radar uydusu (2025). Neredeyse tüm karayı ve buzu 12 günde bir, gece gündüz, bulutun içinden görüntüler.'],
  ['SAR', 'Synthetic aperture radar: a satellite radar that sends its own microwave pulses and measures the echo, so it works at night and through cloud.', 'Yapay açıklıklı radar: kendi mikrodalga sinyalini gönderip yankısını ölçen uydu radarı; gece ve bulut altında çalışır.'],
  ['L-band', 'Radar wavelength of about 24 cm. It passes through leaves and senses stems, branches and soil.', 'Yaklaşık 24 cm dalga boylu radar. Yaprakların arasından geçer, gövde, dal ve toprağı algılar.'],
  ['HH', 'Radar sent and received horizontally. Mostly tells how rough and how wet the ground surface is.', 'Yatay gönderilip yatay alınan radar. Çoğunlukla yüzeyin ne kadar pürüzlü ve ıslak olduğunu gösterir.'],
  ['HV', 'Radar sent horizontally, received vertically. Plants scramble the signal, so HV measures how much plant volume there is.', 'Yatay gönderilip dikey alınan radar. Bitkiler sinyali karıştırır; HV bitki hacmini ölçer.'],
  ['RVI', 'Radar vegetation index = 4·HV / (HH + HV). Higher means more plant volume.', 'Radar bitki indeksi = 4·HV / (HH + HV). Yüksekse bitki hacmi fazladır.'],
  ['backscatter', 'The part of the radar pulse that bounces back to the satellite. Bright = strong echo.', 'Radar sinyalinin uyduya geri dönen kısmı. Parlak = güçlü yankı.'],
  ['browse', 'Quick-look images published with each NISAR product: 8-bit, about 165 m pixels. Good for patterns, not for absolute values.', 'Her NISAR ürünüyle yayımlanan hızlı bakış görüntüleri: 8 bit, ~165 m piksel. Desenler için iyi, mutlak değer için değil.'],
  ['swath', 'The strip of ground the satellite images on one pass (about 240 km wide for NISAR).', 'Uydunun bir geçişte görüntülediği şerit (NISAR için ~240 km).'],
  ['speckle', 'Grainy noise that every radar image has. It is filtered by averaging over space and time.', 'Her radar görüntüsünde olan karlı gürültü. Zaman ve mekânda ortalama alınarak azaltılır.'],
  ['NDVI', 'Optical greenness index from red and near-infrared light. Needs clear skies.', 'Kırmızı ve yakın kızılötesi ışıktan optik yeşillik indeksi. Açık gökyüzü ister.'],
  ['SPI', 'Standardized Precipitation Index: how unusual recent rain is, in standard deviations (−1 dry, −2 extremely dry).', 'Standart Yağış İndeksi: son yağışın ne kadar olağan dışı olduğu (−1 kuru, −2 aşırı kuru).'],
  ['percentile', 'Share of years on record that were lower. 10th percentile = only 1 year in 10 was drier.', 'Kayıtlı yılların ne kadarının daha düşük olduğu. 10. yüzdelik = 10 yılda sadece 1 yıl daha kuru.'],
  ['WorldCover', 'ESA land-cover map at 10 m (2021): trees, cropland, grass, built-up, water…', 'ESA\'nın 10 m arazi örtüsü haritası (2021): ağaç, tarım, çayır, yapı, su…'],
  ['GAEZ', 'FAO / IIASA Global Agro-Ecological Zones: how suitable climate, soil and terrain are for each crop.', 'FAO / IIASA Küresel Tarımsal-Ekolojik Bölgeler: iklim, toprak ve arazinin her ürün için ne kadar uygun olduğu.'],
  ['SPAM', 'IFPRI crop map (2010): how much of each crop is grown in every ~10 km cell.', 'IFPRI ürün haritası (2010): her ~10 km hücrede hangi üründen ne kadar ekildiği.'],
  ['ERA5-Land', 'ECMWF weather reanalysis at ~9 km: soil moisture, rain and temperature from models fed with observations.', 'ECMWF\'nin ~9 km hava yeniden analizi: gözlemle beslenen modellerden toprak nemi, yağış, sıcaklık.'],
  ['NASA POWER', 'NASA service with daily weather and solar data for any point since 1981.', '1981\'den beri her nokta için günlük hava ve güneş verisi sunan NASA servisi.'],
  ['U-TAE', 'A deep network that reads a time series of Sentinel-2 images and names the crop of each pixel.', 'Sentinel-2 görüntü serisini okuyup her pikselin ürününü söyleyen derin ağ.'],
  ['k-means', 'A method that groups pixels with similar values without being told what the groups are.', 'Benzer değerli pikselleri, grupların ne olduğu söylenmeden kümeleyen yöntem.'],
  ['interferogram', 'Map of the phase difference between two radar passes; its colour bands show ground movement of a few centimetres.', 'İki radar geçişi arasındaki faz farkı haritası; renk bantları birkaç santimetrelik yer hareketini gösterir.'],
  ['mosaic', 'Many satellite frames stitched into one world image for each 12-day cycle.', 'Her 12 günlük döngü için birçok uydu çerçevesinin tek dünya görüntüsünde birleştirilmesi.'],
  ['wet snow', 'Snow with liquid water in it. It swallows the radar signal, so melting snow and ice look dark.', 'İçinde sıvı su olan kar. Radar sinyalini yutar; eriyen kar ve buz koyu görünür.'],
  ['susceptibility', 'How prone the terrain is to landslides (mainly slope), independent of today\'s weather.', 'Arazinin heyelana ne kadar yatkın olduğu (çoğunlukla eğim); günün havasından bağımsız.'],
  ['σ', 'Sigma: the typical size of random noise. "3σ" = three times larger than normal noise, so unlikely to be chance.', 'Sigma: rastgele gürültünün tipik büyüklüğü. "3σ" = normal gürültünün üç katı, tesadüf olma ihtimali düşük.'],
];
const TERM_RE = new RegExp(`(^|[^\\w-])(${TERMS.map((t) => t[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=$|[^\\w-])`);
const TDEF = Object.fromEntries(TERMS.map((t) => [t[0], t]));
const NO_TERM = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CANVAS', 'svg', 'CODE', 'BUTTON', 'SELECT', 'OPTION', 'A', 'ABBR', 'LABEL', 'H1', 'H2', 'TH', 'INPUT', 'B']);

function markTerms(root) {
  if (!root?.querySelectorAll) return;
  // one underline per term per block (paragraph, cell, legend section), so text stays readable
  const blocks = root.querySelectorAll('p, td, li, .lg-note, .note, .muted, .rail-intro, .stat span, section');
  blocks.forEach((blk) => {
    if (blk.dataset.terms) return;
    blk.dataset.terms = '1';
    const seen = new Set();
    const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentNode.closest('abbr,button,select,a,label,canvas,th,b') || NO_TERM.has(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = [];
    while (w.nextNode()) nodes.push(w.currentNode);
    for (let n of nodes) {
      let m;
      while (n && (m = TERM_RE.exec(n.nodeValue))) {
        const term = m[2];
        const at = m.index + m[1].length;
        if (seen.has(term)) { const rest = n.splitText(at + term.length); n = rest; continue; }
        seen.add(term);
        const mid = n.splitText(at), rest = mid.splitText(term.length);
        const ab = document.createElement('abbr');
        ab.className = 'term'; ab.dataset.term = term; ab.textContent = term;
        mid.replaceWith(ab);
        n = rest;
      }
    }
  });
}

function initTips() {
  const tip = document.createElement('div');
  tip.className = 'term-tip'; tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  const show = (el) => {
    const t = TDEF[el.dataset.term];
    if (!t) return;
    tip.innerHTML = `<b>${t[0]}</b> ${lang === 'tr' ? t[2] : t[1]}`;
    tip.style.display = 'block';
    const r = el.getBoundingClientRect(), tw = Math.min(300, window.innerWidth - 24);
    tip.style.maxWidth = `${tw}px`;
    const x = Math.max(12, Math.min(window.innerWidth - tw - 12, r.left + r.width / 2 - tw / 2));
    const below = r.bottom + 8 + tip.offsetHeight < window.innerHeight;
    tip.style.left = `${x}px`;
    tip.style.top = `${below ? r.bottom + 8 : r.top - tip.offsetHeight - 8}px`;
  };
  document.addEventListener('mouseover', (e) => { const el = e.target.closest?.('abbr.term'); if (el) show(el); });
  document.addEventListener('mouseout', (e) => { if (e.target.closest?.('abbr.term')) tip.style.display = 'none'; });
  document.addEventListener('focusin', (e) => { const el = e.target.closest?.('abbr.term'); if (el) show(el); });
  document.addEventListener('click', (e) => { const el = e.target.closest?.('abbr.term'); if (el) show(el); else tip.style.display = 'none'; });
}

// ------------------------------------------------------------------ keep the page translated and marked
let busy = false;
function refresh(root) {
  busy = true;
  try { translateTree(root); markTerms(root); } finally { busy = false; }
}
export function initUX() {
  initLang();
  initTheme();
  initTips();
  refresh(document.body);
  let pending = null;
  new MutationObserver((muts) => {
    if (busy) return;
    if (muts.every((m) => m.target.closest?.('.term-tip'))) return;
    clearTimeout(pending);
    pending = setTimeout(() => refresh(document.body), 120);
  }).observe(document.body, { childList: true, subtree: true });
}
