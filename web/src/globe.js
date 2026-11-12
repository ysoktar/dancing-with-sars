// 3-D globe: real NISAR radar frames draped on the Earth, the satellite's
// orbit, global acquisition density and study-site markers, all driven by
// the timeline.

import Globe from 'globe.gl';
import * as THREE from 'three';
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
    this.loader = new THREE.TextureLoader();
    this.selected = null;

    this.globe = new Globe(el, { rendererConfig: { antialias: true, alpha: true } })
      .backgroundColor('rgba(0,0,0,0)')
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
      // satellite + orbit trail
      .objectLat('lat').objectLng('lng').objectAltitude('alt')
      .objectThreeObject(() => this._satelliteModel())
      .objectLabel(() => '<div class="tip"><b>NISAR</b><br>NASA–ISRO SAR · 747 km sun-synchronous orbit<br>L-band 24 cm + S-band 10 cm · 12-day repeat</div>')
      .pathPoints('pts').pathPointLat((p) => p[0]).pathPointLng((p) => p[1]).pathPointAlt((p) => p[2])
      .pathColor(() => ['rgba(232,176,74,0)', 'rgba(232,176,74,0.85)'])
      .pathStroke(1.2)
      .pathTransitionDuration(0)
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
    this._animate();
  }

  setSites(sites) {
    this.sites = sites;
    this.globe.htmlElementsData(sites);
  }

  setCoverage(coverage) { this.coverage = coverage; }

  setEvents(list) { this.events = list; }

  /** Worldwide NISAR mosaic (equirectangular RGBA) as a shell just above the globe. */
  setMosaic(cycle) {
    if (!cycle) return;
    const gl = this.globe.renderer().getContext();
    const big = window.innerWidth > 800 && gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 8192;
    const url = this.base + 'data/' + (big ? cycle.img8k : cycle.img4k);
    this.loader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const r = this.globe.getGlobeRadius() * 1.0012;
      const geo = new THREE.SphereGeometry(r, 180, 90, (90 - 180) * DEG, 2 * Math.PI, 0, Math.PI);
      this.mosaic = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.92 }));
      this.mosaic.renderOrder = 1;
      this.mosaic.visible = this.layers.mosaic;
      this.globe.scene().add(this.mosaic);
    });
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
    if (name === 'mosaic' && this.mosaic) this.mosaic.visible = on;
    if (name === 'satellite' && !on) { this.globe.objectsData([]); this.globe.pathsData([]); }
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
    else this.loader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.texCache.set(url, tex);
      apply(tex);
    });
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
    const s = 1.1;
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

  _animate() {
    const tick = () => {
      requestAnimationFrame(tick);
      if (!this.layers.satellite) return;
      const now = performance.now();
      if (now - (this._lastSat || 0) < 120) return;
      this._lastSat = now;
      // Accelerated circular orbit model: 1 real second = 1 orbital minute
      const tMin = (now - this.satT0) / 1000;
      const pos = (tm) => orbitLatLng(tm);
      const p = pos(tMin);
      const trail = [];
      for (let k = 40; k >= 0; k--) { const q = pos(tMin - k * 0.9); trail.push([q.lat, q.lng, q.alt]); }
      // split trail at the antimeridian
      const segs = [[]];
      for (let i = 0; i < trail.length; i++) {
        if (i && Math.abs(trail[i][1] - trail[i - 1][1]) > 180) segs.push([]);
        segs[segs.length - 1].push(trail[i]);
      }
      this.globe.objectsData([p]);
      this.globe.pathsData(segs.filter((s) => s.length > 1).map((pts) => ({ pts })));
    };
    tick();
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
