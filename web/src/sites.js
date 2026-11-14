// Narrative layer for each study site. The radar data itself comes from
// public/data/catalog.json (built by pipeline/build_data.py from real NISAR
// GCOV acquisitions); this file adds the human story and hypotheses.

export const THEMES = {
  groundwater:   { label: 'Agriculture & groundwater', color: '#f5a524', icon: '◍' },
  flood:         { label: 'Monsoon flooding',          color: '#38bdf8', icon: '≋' },
  deforestation: { label: 'Deforestation',             color: '#22c55e', icon: '♣' },
  glacier:       { label: 'Glaciers & ice',            color: '#a5f3fc', icon: '❄' },
  agriculture:   { label: 'Crop cycles',               color: '#facc15', icon: '✿' },
  wetland:       { label: 'Wetlands',                  color: '#2dd4bf', icon: '◌' },
  volcano:       { label: 'Volcanism',                 color: '#f43f5e', icon: '▲' },
  wildfire:      { label: 'Wildfire recovery',         color: '#fb923c', icon: '✶' },
  subsidence:    { label: 'Agriculture & groundwater', color: '#f5a524', icon: '◍' },
};

export const STORIES = {
  konya: {
    theme: 'groundwater',
    headline: 'Türkiye’s breadbasket is drinking its own foundations',
    story: `The Konya Closed Basin grows a large share of Türkiye’s wheat, sugar beet and maize, but there is no river outlet: every drop of irrigation comes from rain or from aquifers that have been pumped far faster than they recharge. Water tables have dropped by tens of metres, the land is sinking, and collapse sinkholes (<em>obruk</em>) open near Karapınar. This window covers the Çumra irrigation plain south of Konya city.`,
    drivers: [
      'Summer irrigation of maize and sugar beet raises soil moisture and builds tall canopies, so HH and HV both brighten (higher dielectric constant, more volume scattering).',
      'Harvested wheat fields turn into smooth, dry stubble that scatters little energy back to the radar. They show up as dark patches from late June on.',
      'The steady sinking itself is a phase signal. Backscatter cannot see it, but NISAR’s interferometric GUNW product, from the same orbits, can.',
    ],
    pol: 'HV (cross-pol) separates leafy irrigated crops from bare fields. HH also responds to soil moisture and to field roughness from ploughing.',
    lookFor: 'Field-by-field flicker as crops are planted, irrigated and harvested. The city of Konya and Çumra town stay bright all year because buildings act as corner reflectors (double-bounce).',
    future: 'Pair the GCOV crop map with GUNW subsidence rates to see which irrigation districts are pumping hardest.',
  },
  sylhet: {
    theme: 'flood',
    headline: 'The haor basin breathes in and out with the monsoon',
    story: `North-eastern Bangladesh holds the <em>haors</em>, bowl-shaped floodplains that become an inland sea in the monsoon and turn back into rice land in winter. Water flows in from the Meghalaya hills (the wettest place on Earth) and the Barak river system. Villages sit on raised mounds and stay islands for months.`,
    drivers: [
      'Open, calm floodwater acts like a mirror: the radar pulse bounces away and HH turns very dark.',
      'Where water stands under trees or emergent rice, L-band reaches the water surface and comes back off stems by double bounce, so HH turns <em>brighter</em> than on dry land.',
      'As the flood recedes (Oct–Nov), mud and newly transplanted boro rice paddies brighten step by step.',
    ],
    pol: 'HH is the best flood mapper: low over open water, very high over flooded vegetation. HV helps tell flooded forest from open water.',
    lookFor: 'Watch the dark water fraction grow through the monsoon and shrink after September. The bright green band on one edge is the forested hills (volume scattering in HV).',
    future: 'NISAR’s 12-day repeat, day or night and through monsoon clouds, makes near-real-time flood bulletins possible where optical satellites are blind.',
  },
  rondonia: {
    theme: 'deforestation',
    headline: 'The fishbone frontier of the Amazon',
    story: `Rondônia is one of the most deforested states of Brazil. Roads cut through the forest and side roads sprout every few kilometres, which creates the famous “fishbone” clearing pattern. Most clearing and burning happens in the dry season (June–October), exactly the period this NISAR series covers.`,
    drivers: [
      'Intact rainforest is a thick 3-D volume of leaves, branches and trunks. L-band’s 24 cm waves scatter many times inside it and come back strongly depolarized (high HV).',
      'Cutting and burning removes that volume, so HV drops sharply. Felled trunks left on the ground can briefly raise HH before they are burned.',
      'Pasture and soy fields that replace the forest follow seasonal moisture changes instead of the forest’s steady signal.',
    ],
    pol: 'HV, the cross-polarized channel, is the deforestation detector. L-band sees below the canopy top, so it tracks biomass better than shorter C-band.',
    lookFor: 'Dark geometric blocks with sharp edges against the textured forest. Run the change detector between June and October.',
    future: 'NISAR was designed to estimate woody biomass to within 20 Mg/ha below 100 Mg/ha. That is the basis for carbon accounting and REDD+ verification.',
  },
  jakobshavn: {
    theme: 'glacier',
    headline: 'Greenland’s fastest glacier keeps time with the seasons',
    story: `Jakobshavn Isbræ (Sermeq Kujalleq) drains about 7% of the Greenland Ice Sheet and has flowed at times faster than 40 m per day. It ends in the Ilulissat Icefjord, a UNESCO World Heritage site choked with icebergs. This series runs from midsummer melt into the polar night, when optical satellites see nothing at all.`,
    drivers: [
      'Summer meltwater makes the snow wet. Wet snow absorbs microwaves, so the ice sheet goes dark.',
      'In autumn the surface refreezes and the radar again penetrates metres into dry firn, where ice lenses and buried layers scatter strongly. The ice sheet brightens.',
      'Iceberg mélange in the fjord shifts and rearranges from one pass to the next.',
    ],
    pol: 'Both channels respond to the melt/freeze cycle. HV highlights volume scattering inside the firn.',
    lookFor: 'A sudden ice-sheet-wide brightening as melt ends. Bright, chaotic texture in the fjord as icebergs calve.',
    future: 'NISAR’s offset-tracking products (GOFF) measure glacier speed every 12 days, and seasonal backscatter maps melt extent for sea-level models.',
  },
  tulare: {
    theme: 'agriculture',
    headline: 'A phantom lake and a sinking valley',
    story: `Tulare Lake was once the largest freshwater lake west of the Mississippi. It was drained for farming and briefly returned in the floods of 2023. Today the basin is one of the most productive farm regions on Earth, and one of the fastest-sinking: decades of groundwater pumping have lowered parts of the San Joaquin Valley by several metres.`,
    drivers: [
      'Row crops (cotton, tomatoes, grain) go through planting, canopy growth and harvest. HV rises and falls with the canopy.',
      'Orchards (almonds, pistachios) give a steadier, brighter HV signal all year.',
      'Winter rain and spring irrigation raise soil moisture and lift HH over bare fields.',
    ],
    pol: 'HV maps crop canopy and orchard volume. HH tracks soil moisture and the row direction of tilled fields.',
    lookFor: 'Over a full year (24 dates) the checkerboard of fields cycles through its crop calendar. The old lakebed stands out as a large, flat, uniform area.',
    future: 'GUNW interferograms from NISAR will map subsidence at centimetre precision across the whole valley twice a month.',
  },
  okavango: {
    theme: 'wetland',
    headline: 'A flood that arrives in the dry season',
    story: `The Okavango is a river that never reaches the sea. Rain falls on the Angolan highlands in summer, and the flood pulse takes months to creep 1,000 km into the Kalahari. It peaks in the delta in the middle of the dry winter (around July–August), just when wildlife needs it most.`,
    drivers: [
      'Rising water under papyrus and reeds turns the wetland into a field of corner reflectors (water + stems), so HH brightens strongly.',
      'Open lagoons and channels stay dark (specular reflection).',
      'As the pulse recedes in September–October, floodplain grasses dry out and backscatter drops.',
    ],
    pol: 'HH double-bounce is the signature of flooded vegetation, and only long wavelengths like L-band can reach the water below the canopy.',
    lookFor: 'Channels and islands; the bright flooded-vegetation zone expanding in July–August and contracting by October.',
    future: 'Inundation maps every 12 days for transboundary water management between Angola, Namibia and Botswana.',
  },
  punjab: {
    theme: 'agriculture',
    headline: 'Two harvests a year: the rice–wheat waltz',
    story: `Punjab feeds a large share of India’s grain reserve on a strict double-crop rotation: wheat in winter (rabi, Nov–Apr) and paddy rice in the monsoon (kharif, Jun–Oct). With almost a full year of NISAR passes, every stage of that rhythm is visible.`,
    drivers: [
      'June–July: fields are flooded for rice transplanting, so HH turns very dark (open water).',
      'August–September: rice plants grow out of the water, and stem–water double bounce raises HH sharply.',
      'October–November: harvest, followed by residue burning and wheat sowing. Backscatter drops again, then rises slowly as the wheat grows through winter.',
    ],
    pol: 'HH tracks the flood-and-grow cycle of paddy rice. The HV/HH ratio separates wheat canopy from bare soil.',
    lookFor: 'A year-long heartbeat: dark in early summer, bright in late monsoon, a dip at harvest, a slow winter rise.',
    future: 'Crop-type and sowing-date maps for food-security forecasting. ISRO’s S-band on NISAR adds sensitivity to young crops.',
  },
  mississippi: {
    theme: 'wetland',
    headline: 'A delta drowning in slow motion',
    story: `Coastal Louisiana has lost thousands of square kilometres of wetlands since the 1930s. Levees starve the marshes of river sediment, canals let salt water in, and the land subsides while the sea rises. The bird’s-foot delta reaches into the Gulf, and the hurricane season (June–November) brings storm surges.`,
    drivers: [
      'Healthy marsh has a dense, upright grass canopy that scatters strongly in both channels.',
      'Marsh that breaks up into open water goes dark and stays dark.',
      'Seasonal growth and dieback of marsh grasses and tides change the backscatter from pass to pass.',
    ],
    pol: 'HH separates open water from marsh, and HV tracks marsh canopy vigor.',
    lookFor: 'The sharp land–water boundary and dark fingers of open water moving into the marsh.',
    future: 'Combine GCOV land-loss maps with GUNW subsidence to prioritize sediment diversions and coastal restoration projects.',
  },
  kilauea: {
    theme: 'volcano',
    headline: 'Fresh lava rewrites the surface',
    story: `Kīlauea on the Island of Hawaiʻi is one of the most active volcanoes in the world. Its summit caldera and rift zones have produced repeated eruptions in recent years. Every new lava flow replaces the old surface with new rock that has a different roughness.`,
    drivers: [
      'Rough, clinkery ʻaʻā lava is very bright in radar; smooth, glassy pāhoehoe is much darker.',
      'Vegetation on older flows (ʻōhiʻa forest) adds volume scattering (HV).',
      'Inflation and deflation of the magma chamber deforms the ground by centimetres. That shows up in interferometric phase, not in backscatter.',
    ],
    pol: 'HH contrast maps lava roughness. HV separates vegetated old flows from bare new ones.',
    lookFor: 'Abrupt local brightness changes where new flows appear, against otherwise very stable scattering.',
    future: 'Joint GCOV + GUNW monitoring can catch inflation before an eruption and map lava flows through volcanic fume and cloud.',
  },
  jasper: {
    theme: 'wildfire',
    headline: 'Two years after the fire',
    story: `In July 2024 a wildfire swept through Jasper National Park in the Canadian Rockies and destroyed a large part of Jasper townsite. This window covers the burn scar and surrounding unburned forest. Recovery in a cold, high-latitude forest takes decades, while snow cover returns every autumn.`,
    drivers: [
      'Burned stands lost their needles and fine branches, so they have much less volume scattering (lower HV) than the green forest around them.',
      'Standing dead trunks above wet ground can still give double-bounce returns in HH.',
      'Snowfall from October changes the ground’s dielectric properties and roughness. Wet spring snow absorbs, dry winter snow is fairly transparent at L-band.',
    ],
    pol: 'HV contrast between burned and unburned forest outlines the fire scar.',
    lookFor: 'A persistent low-HV patch in the valley; the autumn transition as snow arrives.',
    future: 'Burn-severity and regrowth mapping through smoke and cloud, and biomass-loss estimates for carbon budgets.',
  },
  thwaites: {
    theme: 'glacier',
    headline: 'Watching the “Doomsday Glacier” through the polar night',
    story: `Thwaites Glacier in West Antarctica is about the size of Florida. Warm ocean water is eating it away from below, and its collapse could raise global sea level by about 65 cm. The NISAR series runs from the austral summer into the long winter darkness, when only radar can see.`,
    drivers: [
      'Dry polar firn lets L-band penetrate deep, so backscatter depends on buried layers, grain size and accumulation history.',
      'Crevasse fields and the shear margins of the fast-flowing glacier scatter strongly.',
      'Sea ice forming in the Amundsen Sea in autumn changes the backscatter off the coast.',
    ],
    pol: 'HH and HV respond to firn structure. Their ratio separates rough crevasse zones from smooth firn.',
    lookFor: 'Stable inland firn against a changing ice front and sea ice.',
    future: 'Ice velocity from NISAR offset tracking, and grounding-line migration from interferometry.',
  },
  nile: {
    theme: 'agriculture',
    headline: 'Egypt’s farm belt, irrigated from one river',
    story: `Almost all of Egypt’s crops grow on the thin strip and delta watered by the Nile, where it hardly ever rains. Fields are small and irrigated through canals: wheat and clover (berseem) in winter, then rice, maize and cotton in summer. Water is rationed, and rice area is officially capped to save it.`,
    drivers: [
      'Rice paddies are flooded in May–June, so HH turns dark, then brightens as the plants grow out of the water.',
      'Winter wheat greens up from December and is harvested in April–May; the radar vegetation index (RVI) rises and then drops sharply.',
      'Canals, villages and the dense road grid stay bright in HH all year (double bounce).',
    ],
    pol: 'HV and the RVI follow canopy growth. HH shows paddy flooding and the bright built-up network.',
    lookFor: 'Two growing seasons a year, and a summer burst of flooded rice in the northern delta.',
    future: 'Area and timing of each irrigated crop every 12 days, a direct input for water allocation in a water-scarce country.',
  },
  iowa: {
    theme: 'agriculture',
    headline: 'One crop a year, on a grid of square miles',
    story: `Iowa grows maize (corn) and soybeans in a rotation on large, rectangular fields laid out on the US survey grid. The season is short: planting in late April–May, canopy closure in July, harvest in September–November. Fields then lie bare or under residue through a snowy winter.`,
    drivers: [
      'Maize builds a tall, leafy canopy in summer, so HV (volume scattering) rises strongly and peaks in July–August.',
      'Harvest removes the canopy within days, so the RVI drops field by field: this is visible as a harvest wave.',
      'Snow and frozen soil in winter change the dielectric properties and make bare fields look different from autumn.',
    ],
    pol: 'HV and RVI separate maize (taller, higher) from soybean. HH responds to soil moisture and tillage.',
    lookFor: 'A single summer peak and a sharp autumn harvest drop. Fields are large enough to show up as blocks.',
    future: 'Mid-season crop condition and harvest progress through cloud, complementing USDA crop progress reports.',
  },
  matogrosso: {
    theme: 'agriculture',
    headline: 'Two harvests a year on the old savanna',
    story: `Mato Grosso is Brazil’s largest soybean producer. Around Sorriso the Cerrado has been converted into huge mechanised fields. With the rains starting in September–October, soybeans are planted, harvested in January–February, and immediately followed by a second crop (safrinha maize) before the dry season.`,
    drivers: [
      'Two green-up and harvest cycles between October and July: soy, then maize, give two RVI peaks.',
      'Fields are bare at the end of the dry season (August–September), so HV is at its lowest.',
      'Remaining patches of Cerrado and riverside forest keep a high, steady HV all year.',
    ],
    pol: 'HV / RVI track each crop’s canopy. Steady high HV marks the remaining native vegetation.',
    lookFor: 'A double-crop pattern over very large fields, and clearings at the edge of the remaining savanna.',
    future: 'Planting and harvest dates for both crops, and monitoring of new conversion of native vegetation.',
  },
  ukraine: {
    theme: 'agriculture',
    headline: 'Winter wheat on the black soils',
    story: `The Poltava region lies in Ukraine’s chernozem (black earth) belt, among the most fertile soils on Earth. Winter wheat is sown in September–October, survives the winter under snow, greens up in spring and is harvested in July. Sunflower and maize are spring-sown and harvested in autumn. Exports from this belt matter for world food prices.`,
    drivers: [
      'Winter wheat greens up in April–May and is harvested in July: HV / RVI rise in spring and drop in midsummer.',
      'Sunflower and maize peak later (July–August) and are harvested in September–October.',
      'Snow cover in winter changes the radar signal independently of the crops.',
    ],
    pol: 'HV / RVI separate the early (wheat) and late (sunflower, maize) peaks. HH is sensitive to snow and soil moisture.',
    lookFor: 'Two kinds of fields: early-summer harvests (wheat) and autumn harvests (sunflower, maize).',
    future: 'Independent, cloud-proof estimates of sown and harvested area, important for food-security monitoring.',
  },
  mekong: {
    theme: 'agriculture',
    headline: 'Up to three rice crops a year',
    story: `The Mekong Delta produces about half of Vietnam’s rice. Dykes and canals allow two or even three crops a year on the same paddies. The delta is low and flat, so it is exposed to river floods in the wet season and to salt water moving inland in the dry season, a growing problem with sea-level rise and upstream dams.`,
    drivers: [
      'Each rice crop starts with flooded paddies (HH very dark) and ends with harvest (RVI drop): up to three such cycles per year.',
      'Neighbouring fields are planted on different dates, giving a patchwork of crop stages on every pass.',
      'Orchards, villages and canal banks keep a steady, bright signal.',
    ],
    pol: 'HH tracks flooding and transplanting. HV / RVI track rice growth.',
    lookFor: 'Repeated flood–grow–harvest cycles, and which areas keep one, two or three crops.',
    future: 'Rice area and stage across the delta every 12 days, and early warning when salinity intrusion forces fields out of production.',
  },
  phuprao: {
    theme: 'agriculture',
    headline: 'Rain-fed rice on the Mekong border',
    story: `Wat Sirindhorn Wararam Phu Prao sits on a sandstone ridge in Sirindhorn district, Ubon Ratchathani, looking across the Mekong lowlands into Laos. Around it lie rain-fed paddies, cassava and rubber plots, dry dipterocarp forest on the ridges, and the Sirindhorn reservoir to the north-west. Most rice here is a single wet-season crop that depends on the monsoon, which makes the area sensitive to drought and to late rains.`,
    drivers: [
      'Monsoon rains (May–October) flood the paddies: HH turns dark, then RVI rises as the rice grows.',
      'Harvest in November–December: RVI drops, and fields stay bare and dry through the dry season.',
      'The Sirindhorn reservoir shrinks and grows with the seasons; rubber and forest on the ridges keep a steady high HV.',
    ],
    pol: 'HH separates open water, flooded paddies and dry ground. HV / RVI track rice growth and separate tree crops from annual crops.',
    lookFor: 'A single wet-season rice cycle in the lowlands, the reservoir shoreline moving, and steady forest on the ridge around the temple.',
    future: 'Cloud-proof monitoring of planted area and drought stress in the monsoon season, when optical images are mostly cloudy.',
  },
};

export function themeOf(site) {
  const t = (STORIES[site.id] && STORIES[site.id].theme) || site.theme;
  return THEMES[t] || THEMES.wetland;
}
