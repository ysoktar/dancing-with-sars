// 3-D view: the radar image draped over 30 m elevation (Copernicus DEM).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SIZE } from './sar.js';

export class Terrain3D {
  constructor(container, dem, sideKm) {
    this.container = container;
    const w = container.clientWidth, h = container.clientHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x07090b);
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.01, 100);
    this.camera.position.set(0, -1.25, 0.95);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;

    // relief: real scale would be invisible for flat sites, so exaggerate to ~12 % of the width
    const reliefM = Math.max(1, dem.hi - dem.lo);
    const realRatio = reliefM / (sideKm * 1000);
    this.exaggeration = Math.max(1, Math.min(40, Math.round(0.12 / realRatio)));
    const geo = new THREE.PlaneGeometry(1, 1, SIZE - 1, SIZE - 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, ((dem.h[i] - dem.lo) / (sideKm * 1000)) * this.exaggeration);
    geo.computeVertexNormals();
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: this.texture }));
    this.scene.add(this.mesh);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-1, 1, 1.4);
    this.scene.add(sun);
    this.ro = new ResizeObserver(() => {
      const W = container.clientWidth, H = container.clientHeight;
      if (!W || !H) return;
      this.renderer.setSize(W, H); this.camera.aspect = W / H; this.camera.updateProjectionMatrix();
    });
    this.ro.observe(container);
    const loop = () => { if (!this.renderer) return; this.raf = requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    loop();
  }

  setImage(imageData) {
    this.canvas.getContext('2d').putImageData(imageData, 0, 0);
    this.texture.needsUpdate = true;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.texture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.renderer = null;
  }
}
