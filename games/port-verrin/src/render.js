// Renderer, physical sky, sky-driven reflections, bloom and tone mapping.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

export class Renderer {
  constructor(canvas, scene, camera) {
    this.scene = scene; this.camera = camera;
    const r = this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.85;

    // physical sky
    this.sky = new Sky();
    this.sky.scale.setScalar(4500);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.85;
    scene.add(this.sky);
    this.sunDir = new THREE.Vector3(0, 1, 0);

    // stars for the night sky
    const sg = new THREE.BufferGeometry(), pts = [];
    for (let i = 0; i < 1500; i++) {
      const v = new THREE.Vector3().randomDirection(); if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05;
      pts.push(v.x * 3000, v.y * 3000, v.z * 3000);
    }
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    scene.add(this.stars);

    // reflections rendered from the same sky
    this.pmrem = new THREE.PMREMGenerator(r);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky(); this.envSky.scale.setScalar(100);
    this.envSky.material = this.sky.material;
    this.envScene.add(this.envSky);
    this.envT = 0; this.envRT = null;

    // post
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.35, 0.4, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    const pr = r.getPixelRatio();
    this.composer.addPass(new SMAAPass(window.innerWidth * pr, window.innerHeight * pr));

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
      r.setSize(window.innerWidth, window.innerHeight);
      this.composer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // elevation in radians, azimuth in radians
  setSun(elev, azim, night, center) {
    this.sunDir.setFromSphericalCoords(1, Math.PI / 2 - elev, azim);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.starMat.opacity = night * 0.9;
    this.sky.position.copy(center); this.stars.position.copy(center);
    this.r.toneMappingExposure = 0.5 + (1 - night) * 0.12;
    this.bloom.strength = 0.3 + night * 0.2;
  }

  updateEnv(dt, force) {
    this.envT -= dt;
    if (this.envT > 0 && !force) return;
    this.envT = 4;
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
    this.scene.environment = this.envRT.texture;
    if (old) old.dispose();
  }

  render() { this.composer.render(); }
}
