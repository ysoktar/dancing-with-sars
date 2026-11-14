// 3-D globe: real NISAR radar frames draped on the Earth, the satellite's
// orbit, global acquisition density and study-site markers, all driven by
// the timeline.

import Globe from 'globe.gl';
import * as THREE from 'three';
import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js';
import { themeOf } from './sites.js';

const DEG = Math.PI / 180;
const R_EARTH_KM = 6371;
const NISAR_ALT_KM = 747;
const NISAR_INC = 98.4 * DEG;
const NISAR_PERIOD_MIN = 100.0;

export class GlobeView {
  constructor(el, { base, onSiteClick }) {
    this.base = base;
    this.onSiteClick = onSiteClick;
    this.layers = { mosaic: true, frames: true, density: false, footprints: false, satellite: true, night: false, events: false };
    this.events = [];
    this.texCache = new Map();
    this.frameMeshes = new Map();
    // textures are decoded off the main thread (createImageBitmap), so switching cycles / layers does not stall rendering
    this.loader = new THREE.ImageBitmapLoader();
    this.loader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
    this.tiles = new Map();          // high-resolution mosaic tiles currently on the globe
    this.selected = null;

    this.globe = new Globe(el, { rendererConfig: { antialias: true, alpha: true, powerPreference: 'high-performance' } })
      .backgroundColor('rgba(0,0,0,0)')
      .globeCurvatureResolution(2)          // denser globe mesh: less pinching near the poles
      .globeImageUrl(base + 'textures/earth-blue-marble.jpg')
      .bumpImageUrl(base + 'textures/earth-topology.png')
      .showAtmosphere(true)
      .atmosphereColor('#9db8d9')
      .atmosphereAltitude(0.14)
      // study sites
      .htmlElementsData([])
      .htmlLat('lat').htmlLng('lon').htmlAltitude(0.012)
      .htmlElement((d) => this._marker(d))
      // acquisition density
      .hexBinPointLat((d) => d[0]).hexBinPointLng((d) => d[1]).hexBinPointWeight((d) => d[2])
      .hexBinResolution(3)
      .hexMargin(0.25)
      .hexAltitude((d) => 0.003 + 0.09 * Math.sqrt(d.sumWeight / (this._maxW || 1)))
      .hexTopColor((d) => densityColor(d.sumWeight))
      .hexSideColor((d) => densityColor(d.sumWeight, 0.55))
      .hexTransitionDuration(600)
      .hexLabel((d) => `<div class="tip"><b>≈ ${Math.round(d.sumWeight).toLocaleString()}</b> GCOV frames this month<br><span>estimated from a 4-day sample, 3° cell</span></div>`)
      // footprints
      .polygonCapColor(() => 'rgba(56,189,248,0.05)')
      .polygonSideColor(() => 'rgba(0,0,0,0)')
      .polygonStrokeColor(() => 'rgba(125,211,252,0.55)')
      .polygonAltitude(0.004)
      .polygonsTransitionDuration(0)
      // natural events (NASA EONET)
      .pointLat('lat').pointLng('lon').pointAltitude(0.006).pointRadius(0.35)
      .pointColor((d) => d.color)
      .pointLabel((d) => `<div class="tip"><b>${d.title}</b><br><span>${d.category} · ${d.date}</span></div>`)
      .pointsTransitionDuration(0)
      // selection ring
      .ringLat('lat').ringLng('lon').ringColor(() => (t) => `rgba(232,176,74,${1 - t})`)
      .ringMaxRadius(3).ringPropagationSpeed(2).ringRepeatPeriod(1400);

    const mat = this.globe.globeMaterial();
    mat.bumpScale = 6;
    mat.shininess = 8;
    const renderer = this.globe.renderer();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));   // retina at 1.5x: ~45 % fewer pixels than 2x
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    // sharp textures at grazing angles and near the poles (less smearing / radial streaks)
    this.globe.onGlobeReady(() => {
      for (const m of [mat.map, mat.bumpMap]) if (m) { m.anisotropy = this.maxAniso; m.needsUpdate = true; }
    });
    this.globe.controls().autoRotate = true;
    this.globe.controls().autoRotateSpeed = 0.25;
    this.globe.controls().enableDamping = true;
    this.globe.pointOfView({ lat: 25, lng: 20, altitude: 2.4 });

    this.frameGroup = new THREE.Group();
    this.globe.scene().add(this.frameGroup);

    this._resize = () => this.globe.width(el.clientWidth).height(el.clientHeight);
    window.addEventListener('resize', this._resize);
    this._resize();

    el.addEventListener('pointerdown', () => { this.globe.controls().autoRotate = false; });
    this.satT0 = performance.now();
    this._buildSatellite();
    this._animate();
    document.addEventListener('visibilitychange', () => (document.hidden ? this.pause() : this.resume()));
  }

  _texture(url, cb, onError) {
    this.loader.load(url, (bmp) => {
      const tex = new THREE.Texture(bmp);
      tex.flipY = false;                      // the bitmap is already flipped by createImageBitmap
      tex.wrapS = THREE.RepeatWrapping;       // no seam where longitude wraps at ±180°
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.maxAniso || 4;
      tex.needsUpdate = true;
      cb(tex);
    }, undefined, onError);
  }

  /** Stop rendering while the globe is hidden (page in front, tab in background). */
  pause() {
    if (this.paused) return;
    this.paused = true; this.globe.pauseAnimation();
  }

  resume() {
    if (!this.paused || document.hidden || document.body.classList.contains('sheet-open')) return;
    this.paused = false; this.globe.resumeAnimation();
  }

  setSites(sites) {
    this.sites = sites;
    this.globe.htmlElementsData(sites);
  }

  setCoverage(coverage) { this.coverage = coverage; }

  setEvents(list) { this.events = list; }

  /**
   * Worldwide NISAR mosaics, one per 12-day cycle. The globe shows the cycle
   * that contains the timeline date (or the most recent one before it).
   */
  setMosaics(cycles) {
    this.cycles = (cycles || []).slice().sort((a, b) => a.start.localeCompare(b.start));
    if (!this.cycles.length) return;
    const gl = this.globe.renderer().getContext();
    this.canBig = window.innerWidth > 800 && gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 8192;
    this.mosTex = new Map(); // url -> texture (LRU)
    const r = this.globe.getGlobeRadius() * 1.0012;
    const geo = new THREE.SphereGeometry(r, 256, 128, (90 - 180) * DEG, 2 * Math.PI, 0, Math.PI);
    this.mosaic = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.92 }));
    this.mosaic.renderOrder = 1;
    this.mosaic.visible = false;
    this.globe.scene().add(this.mosaic);
    if (this.date) this.update(this.date, true);
  }

  cycleAt(date) {
    if (!this.cycles?.length) return null;
    const d = date.toISOString().slice(0, 10);
    let c = null;
    for (const x of this.cycles) if (x.start <= d) c = x;
    return c;
  }

  _mosaicTexture(url, cb) {
    if (this.mosTex.has(url)) {
      const t = this.mosTex.get(url);
      this.mosTex.delete(url); this.mosTex.set(url, t); // refresh LRU order
      return cb(t);
    }
    this._texture(url, (tex) => {
      this.mosTex.set(url, tex);
      while (this.mosTex.size > 4) {
        const [k, old] = this.mosTex.entries().next().value;
        if (old === this.mosaic.material.map) break;
        old.dispose(); this.mosTex.delete(k);
      }
      cb(tex);
    });
  }

  _showMosaic(date) {
    if (!this.mosaic) return;
    const c = this.cycleAt(date);
    this.currentCycle = c;
    if (!c || !this.layers.mosaic) { this.mosaic.visible = false; return; }
    // small texture while the date is moving, the 8k one once it settles
    const want = (big) => this.base + 'data/' + (big ? c.img8k : c.img4k);
    const apply = (url) => this._mosaicTexture(url, (tex) => {
      if (this.currentCycle !== c) return;
      this.mosaic.material.map = tex;
      this.mosaic.material.needsUpdate = true;
      this.mosaic.visible = this.layers.mosaic;
    });
    if (this.mosaic.userData.id !== c.id) { this.mosaic.userData.id = c.id; apply(want(false)); this._clearTiles(); }
    clearTimeout(this._bigTimer);
    if (this.canBig) this._bigTimer = setTimeout(() => apply(want(true)), 700);
  }

  blur() {
    this.selected = null;
    this.globe.ringsData([]);
    document.querySelectorAll('.marker').forEach((m) => m.classList.remove('on'));
  }

  setLayer(name, on) {
    this.layers[name] = on;
    if (name === 'night') this.globe.globeImageUrl(this.base + (on ? 'textures/earth-night.jpg' : 'textures/earth-blue-marble.jpg'));
    if (name === 'frames') this.frameGroup.visible = on;
    if (name === 'mosaic' && this.mosaic) this._showMosaic(this.date || new Date());
    if (name === 'satellite') this.satGroup.visible = on;
    this.update(this.date, true);
  }

  focus(site, ms = 1500) {
    this.selected = site;
    this.globe.controls().autoRotate = false;
    this.globe.pointOfView({ lat: site.lat, lng: site.lon, altitude: 0.8 }, ms);
    this.globe.ringsData([site]);
    document.querySelectorAll('.marker').forEach((m) => m.classList.toggle('on', m.dataset.id === site.id));
  }

  /** Update every layer to the timeline date (Date). */
  update(date, force = false) {
    if (!date) return;
    this.date = date;
    this._setSatDay(date);
    this._showMosaic(date);
    const month = date.toISOString().slice(0, 7);
    if (this.coverage && (force || month !== this._month)) {
      this._month = month;
      const m = this.coverage.months.find((x) => x.month === month) || { bins: [], footprints: [] };
      // hex heights are relative to the busiest cell of the whole record, so months stay comparable
      if (!this._maxW) this._maxW = Math.max(1, ...this.coverage.months.flatMap((mm) => mm.bins.map((b) => b[2]))) * 2.5;
      this.globe.hexBinPointsData(this.layers.density ? m.bins : []);
      this.globe.polygonsData(this.layers.footprints ? m.footprints.map((ring) => ({ geometry: { type: 'Polygon', coordinates: [ring] } })) : []);
    }
    if (this.events.length) {
      const t = date.getTime();
      this.globe.pointsData(this.layers.events ? this.events.filter((e) => {
        const a = new Date(e.date).getTime(), b = new Date(e.end || e.date).getTime() + 14 * 86400000;
        return a <= t && t <= b;
      }) : []);
    }
    if (this.sites) {
      for (const s of this.sites) {
        const a = latestBefore(s.acquisitions, date);
        this._showFrame(s, a);
        const el = document.querySelector(`.marker[data-id="${s.id}"]`);
        if (el) {
          el.classList.toggle('stale', !a);
          const fresh = a && (date - new Date(a.date)) / 86400000 < 6;
          el.classList.toggle('fresh', !!fresh);
        }
      }
    }
  }

  _showFrame(site, acq) {
    const key = site.id;
    const cur = this.frameMeshes.get(key);
    if (!acq) { if (cur) cur.visible = false; return; }
    if (cur && cur.userData.date === acq.date) { cur.visible = true; return; }
    const url = this.base + 'data/' + acq.frameImg;
    const apply = (tex) => {
      // a newer request may have superseded this one
      if (this.latestReq?.[key] !== url) return;
      let mesh = this.frameMeshes.get(key);
      const [W, S, E, N] = acq.frameBounds;
      const r = this.globe.getGlobeRadius() * 1.0025;
      const geo = new THREE.SphereGeometry(r, 48, 48, (90 + W) * DEG, (E - W) * DEG, (90 - N) * DEG, (N - S) * DEG);
      if (!mesh) {
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.95, side: THREE.DoubleSide });
        mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 2;
        this.frameGroup.add(mesh);
        this.frameMeshes.set(key, mesh);
      } else {
        mesh.geometry.dispose();
        mesh.geometry = geo;
        mesh.material.map = tex;
        mesh.material.needsUpdate = true;
      }
      mesh.visible = true;
      mesh.userData.date = acq.date;
    };
    this.latestReq = this.latestReq || {};
    this.latestReq[key] = url;
    if (this.texCache.has(url)) apply(this.texCache.get(url));
    else this._texture(url, (tex) => { this.texCache.set(url, tex); apply(tex); });
  }

  _marker(site) {
    const theme = themeOf(site);
    const el = document.createElement('div');
    el.className = 'marker';
    el.dataset.id = site.id;
    el.style.setProperty('--c', theme.color);
    el.innerHTML = `<span class="dot"></span><span class="lbl">${site.name}</span>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); this.onSiteClick && this.onSiteClick(site); });
    return el;
  }

  _satelliteModel() {
    const g = new THREE.Group();
    const gold = new THREE.MeshPhongMaterial({ color: 0xd4a017, emissive: 0x4a3200, shininess: 80 });
    const panel = new THREE.MeshPhongMaterial({ color: 0x1e3a8a, emissive: 0x0b1a40, shininess: 120 });
    const mesh = new THREE.MeshPhongMaterial({ color: 0xe5e7eb, emissive: 0x333333, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    const s = 0.55;
    const bus = new THREE.Mesh(new THREE.BoxGeometry(1.2 * s, 1.2 * s, 2.0 * s), gold);
    g.add(bus);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(5 * s, 0.08 * s, 1.4 * s), panel);
    wing.position.set(-3.2 * s, 0, 0);
    g.add(wing);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * s, 0.06 * s, 4 * s), mesh);
    boom.rotation.z = Math.PI / 2.6; boom.position.set(1.6 * s, 0.9 * s, 0);
    g.add(boom);
    // 12 m deployable mesh reflector, the signature of NISAR
    const dish = new THREE.Mesh(new THREE.SphereGeometry(3.2 * s, 24, 12, 0, Math.PI * 2, 0, 0.55), mesh);
    dish.position.set(3.6 * s, 2.4 * s, 0);
    dish.rotation.z = -Math.PI / 1.6;
    g.add(dish);
    return g;
  }

  /** High-resolution mosaic tiles (10°, ~1.1 km/px) are streamed in when zoomed in on a cycle that has them. */
  _clearTiles() {
    for (const m of this.tiles.values()) { m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); this.globe.scene().remove(m); }
    this.tiles.clear();
  }

  _updateTiles() {
    const c = this.currentCycle, T = c && c.tiles;
    const pov = this.globe.pointOfView();
    if (!T || !this.layers.mosaic || this.paused || pov.altitude > 1.1) {
      for (const m of this.tiles.values()) m.visible = false;
      return;
    }
    const toVec = (lat, lng) => { const p = lat * DEG, l = lng * DEG; return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; };
    const cam = toVec(pov.lat, pov.lng);
    const cap = Math.acos(1 / (1 + pov.altitude)) + 8 * DEG;          // visible spherical cap (+ margin)
    const want = [];
    for (const [r, col] of T.list) {
      const N = 90 - r * T.deg, Wl = -180 + col * T.deg;
      const v = toVec(N - T.deg / 2, Wl + T.deg / 2);
      const ang = Math.acos(Math.max(-1, Math.min(1, v[0] * cam[0] + v[1] * cam[1] + v[2] * cam[2])));
      if (ang < cap) want.push([ang, r, col]);
    }
    want.sort((a, b) => a[0] - b[0]);
    const keep = new Set(want.slice(0, 48).map(([, r, col]) => `${r}_${col}`));
    for (const [k, m] of this.tiles) {
      m.visible = keep.has(k);
      if (!keep.has(k) && this.tiles.size > 96) { m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); this.globe.scene().remove(m); this.tiles.delete(k); }
    }
    let started = 0;
    for (const k of keep) {
      if (this.tiles.has(k) || started >= 4) continue;                  // at most 4 new tile requests per update
      started++;
      const [r, col] = k.split('_').map(Number);
      const N = 90 - r * T.deg, S = N - T.deg, Wl = -180 + col * T.deg;
      const geo = new THREE.SphereGeometry(this.globe.getGlobeRadius() * 1.0016, 24, 24, (90 + Wl) * DEG, T.deg * DEG, (90 - N) * DEG, T.deg * DEG);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0 }));
      mesh.renderOrder = 1;
      this.tiles.set(k, mesh);
      this.globe.scene().add(mesh);
      const cyc = c.id;
      this._texture(`${this.base}data/${T.path}/${k}.webp`, (tex) => {
        if (this.currentCycle?.id !== cyc || this.tiles.get(k) !== mesh) { tex.dispose(); return; }
        mesh.material.map = tex; mesh.material.opacity = 0.95; mesh.material.needsUpdate = true;
      });
    }
  }

  /** Real NISAR orbit (SGP4 from the latest CelesTrak TLE). The satellite flies on the timeline date with an
   * accelerated clock (1 s = 1 min), with its ground trail and the ~242 km L-band swath to the left of the track. */
  setTLE(tle) {
    try { this.satrec = twoline2satrec(tle.line1, tle.line2); } catch (e) { this.satrec = null; }
  }

  _satAt(date) {
    if (this.satrec) {
      const pv = propagate(this.satrec, date);
      if (pv && pv.position) {
        const g = eciToGeodetic(pv.position, gstime(date));
        return { lat: degreesLat(g.latitude), lng: degreesLong(g.longitude), alt: g.height / R_EARTH_KM };
      }
    }
    const p = orbitLatLng((date.getTime() / 60000) % 1e6);   // fallback: circular sun-synchronous orbit
    return p;
  }

  _buildSatellite() {
    this.satGroup = new THREE.Group();
    this.sat = this._satelliteModel();
    this.satGroup.add(this.sat);
    this.trailN = 90;                                  // 45 minutes of track, 30 s apart
    const pos = new Float32Array(this.trailN * 3), col = new Float32Array(this.trailN * 3);
    for (let i = 0; i < this.trailN; i++) { const k = (i / (this.trailN - 1)) ** 1.5; col.set([0.91 * k, 0.69 * k, 0.29 * k], i * 3); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.trail.frustumCulled = false;
    this.satGroup.add(this.trail);
    // swath ribbon on the ground (near / far edge per trail point)
    const sp = new Float32Array(this.trailN * 2 * 3), sa = new Float32Array(this.trailN * 2);
    const idx = [];
    for (let i = 0; i < this.trailN - 1; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    for (let i = 0; i < this.trailN; i++) sa[2 * i] = sa[2 * i + 1] = (i / (this.trailN - 1)) ** 2;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('fade', new THREE.BufferAttribute(sa, 1));
    sg.setIndex(idx);
    this.swath = new THREE.Mesh(sg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: 'attribute float fade; varying float vF; void main(){ vF = fade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vF; void main(){ gl_FragColor = vec4(0.91, 0.69, 0.29, 0.38 * vF); }',
    }));
    this.swath.frustumCulled = false;
    this.satGroup.add(this.swath);
    this.globe.scene().add(this.satGroup);
    this.satClock = { base: Date.now(), t0: performance.now() };
  }

  /** Move the satellite clock to a timeline date (keeps the time of day running). */
  _setSatDay(date) {
    const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    if (this.satClock && this.satClock.day !== day) { this.satClock = { day, base: day + 10 * 3600e3, t0: performance.now() }; }
  }

  _animate() {
    const R = () => this.globe.getGlobeRadius();
    const NEAR_KM = 440, FAR_KM = 680;                 // swath edges from nadir (left-looking L-band, ~242 km wide)
    const dest = (lat, lng, brg, km) => {            // great-circle destination point (degrees)
      const d = km / R_EARTH_KM, φ1 = lat * DEG, λ1 = lng * DEG, θ = brg * DEG;
      const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
      const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
      return [φ2 / DEG, λ2 / DEG];
    };
    const bearing = (a, b) => {
      const φ1 = a.lat * DEG, φ2 = b.lat * DEG, dλ = (b.lng - a.lng) * DEG;
      return Math.atan2(Math.sin(dλ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ)) / DEG;
    };
    let last = 0, lastTiles = 0;
    const tick = (now) => {
      requestAnimationFrame(tick);
      if (now - lastTiles > 250) { lastTiles = now; this._updateTiles(); }
      if (this.paused || !this.layers.satellite || now - last < 33) return;   // ~30 fps is plenty for the satellite
      last = now;
      const t = this.satClock.base + (performance.now() - this.satClock.t0) * 60;   // 1 s = 1 min
      const p = this._satAt(new Date(t));
      const c = this.globe.getCoords(p.lat, p.lng, p.alt);
      this.sat.position.set(c.x, c.y, c.z);
      this.sat.lookAt(0, 0, 0);
      const tp = this.trail.geometry.attributes.position.array;
      const sp = this.swath.geometry.attributes.position.array;
      let prev = null;
      for (let i = 0; i < this.trailN; i++) {
        const q = this._satAt(new Date(t - (this.trailN - 1 - i) * 30000));
        const cc = this.globe.getCoords(q.lat, q.lng, q.alt);
        tp[i * 3] = cc.x; tp[i * 3 + 1] = cc.y; tp[i * 3 + 2] = cc.z;
        const nxt = i < this.trailN - 1 ? this._satAt(new Date(t - (this.trailN - 2 - i) * 30000)) : null;
        const brg = nxt ? bearing(q, nxt) : (prev ? bearing(prev, q) : 0);
        for (const [k, km] of [[0, NEAR_KM], [1, FAR_KM]]) {
          const [la, lo] = dest(q.lat, q.lng, brg - 90, km);      // left of the flight direction
          const g = this.globe.getCoords(la, lo, 0.003);
          sp.set([g.x, g.y, g.z], (2 * i + k) * 3);
        }
        prev = q;
      }
      this.trail.geometry.attributes.position.needsUpdate = true;
      this.swath.geometry.attributes.position.needsUpdate = true;
    };
    requestAnimationFrame(tick);
  }
}

function orbitLatLng(tMin) {
  const n = (2 * Math.PI) / NISAR_PERIOD_MIN;
  const u = n * tMin; // argument of latitude
  const lat = Math.asin(Math.sin(NISAR_INC) * Math.sin(u));
  let lng = Math.atan2(Math.cos(NISAR_INC) * Math.sin(u), Math.cos(u));
  const earthRot = (2 * Math.PI / 1436) * tMin; // sidereal day in minutes
  lng = lng - earthRot + 0.6;
  lng = ((lng / DEG + 540) % 360) - 180;
  return { lat: lat / DEG, lng, alt: NISAR_ALT_KM / R_EARTH_KM };
}

export function latestBefore(acqs, date) {
  let best = null;
  const t = date.getTime();
  for (const a of acqs) {
    const at = new Date(a.date + 'T12:00:00Z').getTime();
    if (at <= t + 43200000) best = a; else break;
  }
  return best;
}

function densityColor(w, alpha = 0.9) {
  const t = Math.max(0, Math.min(1, Math.log10(1 + w) / 3.3));
  const stops = [[14, 116, 144], [56, 189, 248], [167, 139, 250], [244, 114, 182], [253, 224, 71]];
  const f = t * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(f)), u = f - k;
  const c = stops[k].map((v, i) => Math.round(v * (1 - u) + stops[k + 1][i] * u));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
