// Port Verrin: game bootstrap, player, camera, world loop.
import * as THREE from 'three';
import { City, HIDEOUT, SHOP_POINT, GRID, mulberry32 } from './city.js';
import { Car, Ped, makeCharacter, animateCharacter, CAR_COLORS, wrapAngle } from './actors.js';
import { Economy } from './economy.js';
import { Police } from './police.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';

const DAY_LEN = 480; // seconds per in-game day
const $ = (id) => document.getElementById(id);

class Player {
  constructor(scene) {
    this.mesh = makeCharacter({ skin: 0xc68642, top: 0x2a9d8f, pants: 0x22223b, hair: 0x1b1b1b });
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.62), new THREE.MeshLambertMaterial({ color: 0xffd166 }));
    cap.position.set(0, 2.2, 0.06); this.mesh.add(cap);
    scene.add(this.mesh);
    this.pos = new THREE.Vector3(HIDEOUT.spawn[0], 0, HIDEOUT.spawn[1]);
    this.heading = Math.PI / 2; this.car = null; this.speedNow = 0; this.phase = 0;
  }
  facing() { return this.car ? this.car.heading : this.heading; }
}

class Game {
  constructor() {
    const canvas = $('view');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x8ec9f0, 120, 520);
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.3, 1600);
    this.rng = mulberry32(2024);
    this.time = 0;

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a4030, 0.8);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -80; sc.right = sc.top = 80; sc.near = 1; sc.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.city = new City(this.scene);
    this.audio = new Audio();
    this.markers = [];
    this.cars = [];
    this.eco = new Economy(this);
    this.police = new Police(this);
    this.hud = new Hud(this);
    this.player = new Player(this.scene);
    this.headlight = new THREE.SpotLight(0xfff0d0, 0, 60, 0.55, 0.5, 1.2);
    this.scene.add(this.headlight, this.headlight.target);

    // the player's own car in the yard
    const [cx, cz, ch] = HIDEOUT.carSpot;
    this.myCar = new Car(this.scene, { color: 0x6c5ce7, x: cx, z: cz, heading: ch });
    this.cars.push(this.myCar);
    // traffic
    for (let i = 0; i < 18; i++) {
      const c = new Car(this.scene, { color: CAR_COLORS[i % CAR_COLORS.length], mode: 'traffic' });
      c.placeOnRoad(this.rng, cx, cz, 30);
      this.cars.push(c);
    }
    // parked cars along curbs
    for (let i = 0; i < 22; i++) {
      const c = new Car(this.scene, { color: CAR_COLORS[(i * 3) % CAR_COLORS.length] });
      c.placeOnRoad(this.rng, cx, cz, 20);
      const r = c.route; const off = 2.3;
      c.pos.x += -r.dj * off; c.pos.z += r.di * off; c.route = null;
      c.syncMesh();
      this.cars.push(c);
    }
    // pedestrians
    this.peds = [];
    for (let i = 0; i < 40; i++) this.peds.push(new Ped(this.scene, this.rng, Math.floor(this.rng() * GRID), Math.floor(this.rng() * GRID)));

    this.yardMarker = this.addMarker(-160, 78, 0xffd166);
    this.shopMarker = this.addMarker(SHOP_POINT[0], SHOP_POINT[1], 0x6cf2c2);

    this.camYaw = Math.PI / 2; this.camPitch = 0.32; this.lastMouse = 0;
    this.keys = new Set();
    this.running = false; this.bustedT = 0; this.saveT = 10;
    this._bindInput();
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    this.clock = new THREE.Clock();
    this._applyDaylight();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- helpers used by other modules ----------
  toast(t, k) { this.hud.toast(t, k); }
  banner(a, b) { this.hud.banner(a, b, 5000); }
  playerPos() { return this.player.car ? this.player.car.pos : this.player.pos; }
  addMarker(x, z, color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.5, 32), mat); ring.rotation.x = -Math.PI / 2;
    const bmat = mat.clone(); bmat.opacity = 0.12;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 70, 12, 1, true), bmat); beam.position.y = 35;
    g.add(ring, beam); g.position.set(x, 0.08, z);
    this.scene.add(g); this.markers.push(g);
    return g;
  }
  removeMarker(m) { this.scene.remove(m); this.markers = this.markers.filter((x) => x !== m); }

  obstacleAhead(car, dist) {
    const fx = car.fx, fz = car.fz;
    const hit = (x, z, lat) => {
      const dx = x - car.pos.x, dz = z - car.pos.z, along = dx * fx + dz * fz;
      if (along <= 0.5 || along > dist) return false;
      return Math.abs(-dx * fz + dz * fx) < lat;
    };
    for (const o of this.cars) if (o !== car && hit(o.pos.x, o.pos.z, 1.8)) return true;
    if (!this.player.car && hit(this.player.pos.x, this.player.pos.z, 1.6)) return true;
    return false;
  }

  // ---------- input ----------
  _bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') { e.preventDefault(); if (this.running) this.hud.togglePhone(); return; }
      if (e.code === 'Escape') { this.hud.closePanels(); return; }
      if (!this.running) return;
      if (e.code === 'KeyE' && !e.repeat && !this.hud.anyOpen() && this.bustedT <= 0) this.interact();
      if (e.code === 'KeyH' && !e.repeat) this.audio.horn();
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    const canvas = $('view');
    canvas.addEventListener('click', () => { if (this.running && !this.hud.anyOpen()) canvas.requestPointerLock?.(); });
    let drag = false;
    canvas.addEventListener('mousedown', () => { drag = true; });
    window.addEventListener('mouseup', () => { drag = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.running) return;
      if (document.pointerLockElement === canvas || drag) {
        this.camYaw -= e.movementX * 0.0032;
        this.camPitch = Math.max(-0.1, Math.min(1.2, this.camPitch + e.movementY * 0.0026));
        this.lastMouse = this.time;
      }
    });
    $('btn-new').addEventListener('click', () => this.start(false));
    $('btn-continue').addEventListener('click', () => this.start(true));
    if (this.eco.hasSave()) $('btn-continue').style.display = '';
    $('loading').style.display = 'none';
  }
  start(cont) {
    this.audio.start();
    if (cont) this.eco.load(); else this.eco.reset();
    $('title').style.display = 'none';
    this.running = true;
    this.hud.banner('PORT VERRIN', 'Saltmarsh Docks · your yard is behind you', 3500);
    this.toast('Goal: ' + this.eco.goalText());
    this.toast('Press Tab any time for your phone. Click the screen to lock the mouse.', 'phone');
  }
  key(...codes) { return codes.some((c) => this.keys.has(c)); }

  nearestInteractable() {
    const p = this.player.pos; let best = null, bd = 1e9;
    for (const it of this.eco.interactables()) {
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d < it.r && d < bd) { bd = d; best = it; }
    }
    return best;
  }
  nearestCar() {
    const p = this.player.pos; let best = null, bd = 4.2;
    for (const c of this.cars) { const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  interact() {
    const pl = this.player;
    if (pl.car) { this.exitCar(); return; }
    const it = this.nearestInteractable();
    if (it) { it.action(); return; }
    const car = this.nearestCar();
    if (car) this.enterCar(car);
  }
  enterCar(car) {
    const pl = this.player;
    if (car.isCop) {
      this.police.removeCop(car);
      const stolen = new Car(this.scene, { color: 0xffffff, police: true, x: car.pos.x, z: car.pos.z, heading: car.heading });
      stolen.maxSpeed = 36; this.cars.push(stolen); car = stolen;
      this.police.crime(30, car.pos.x, car.pos.z, 60, 'theft');
      this.police.setWanted(Math.max(2, this.police.levelFromHeat()), 'theft');
      this.toast('You took a Precinct 9 cruiser. Bold.', 'bad');
    } else if (car.mode === 'traffic') {
      this.police.crime(8, car.pos.x, car.pos.z, 30, 'theft');
      this.toast('You pulled the driver out. That will be noticed.', 'bad');
      const ped = this.peds.find((p) => p.down <= 0);
      if (ped) { ped.mesh.position.set(car.pos.x + car.fz * 2, 0, car.pos.z - car.fx * 2); ped.flee = 6; }
    }
    car.mode = 'player'; car.route = null;
    pl.car = car; pl.mesh.visible = false;
    this.audio.blip(300);
  }
  exitCar() {
    const pl = this.player, car = pl.car;
    const p = { x: car.pos.x + car.fz * 2.4, z: car.pos.z - car.fx * 2.4 };
    this.city.resolveCircle(p, 0.5);
    pl.pos.set(p.x, 0, p.z); pl.heading = car.heading;
    car.mode = 'parked';
    pl.car = null; pl.mesh.visible = true;
  }

  busted() {
    if (this.bustedT > 0) return;
    const s = this.eco.s, lost = s.product + s.raw, fine = Math.round(s.money * 0.15);
    s.product = 0; s.raw = 0; s.money -= fine; s.heat = 10;
    $('bustedmsg').textContent = `Precinct 9 took ${lost} glowcap item${lost === 1 ? '' : 's'} and fined you $${fine}. You walk out of holding at dawn.`;
    $('busted').style.display = 'flex';
    this.audio.bad();
    this.bustedT = 4;
    this.police.clearAll();
    if (this.player.car) this.exitCar();
    this.eco.save();
  }
  _finishBust() {
    $('busted').style.display = 'none';
    const pl = this.player;
    pl.pos.set(HIDEOUT.spawn[0], 0, HIDEOUT.spawn[1]); pl.heading = Math.PI / 2;
    this.camYaw = Math.PI / 2;
    this.eco.s.time = 0.27;
  }

  // ---------- simulation ----------
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    if (this.running) this.update(dt);
    else this._titleCam(dt);
    this.renderer.render(this.scene, this.camera);
  }
  _titleCam() {
    const a = this.time * 0.05;
    this.camera.position.set(Math.cos(a) * 170, 90, Math.sin(a) * 170);
    this.camera.lookAt(0, 10, 0);
    this.sun.position.set(80, 140, 60); this.sun.target.position.set(0, 0, 0);
  }

  update(dt) {
    const s = this.eco.s, pl = this.player;
    s.time += dt / DAY_LEN;
    if (s.time >= 1) { s.time -= 1; s.day++; }

    if (this.bustedT > 0) { this.bustedT -= dt; if (this.bustedT <= 0) this._finishBust(); }
    const canMove = this.bustedT <= 0 && !this.hud.anyOpen();

    // --- player ---
    if (pl.car) {
      const car = pl.car;
      const thr = canMove ? (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0) : 0;
      const st = canMove ? (this.key('KeyA', 'ArrowLeft') ? 1 : 0) - (this.key('KeyD', 'ArrowRight') ? 1 : 0) : 0;
      const impact = car.drive(dt, thr, st, canMove && this.key('Space'), this.city);
      if (impact > 9) this.audio.crash(impact);
      pl.pos.copy(car.pos);
    } else {
      let mx = 0, mz = 0;
      if (canMove) {
        const f = (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0);
        const r = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);
        const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
        mx = fx * f - fz * r; mz = fz * f + fx * r;
      }
      const len = Math.hypot(mx, mz);
      const sp = this.key('ShiftLeft', 'ShiftRight') ? 9.5 : 5.2;
      if (len > 0) {
        mx /= len; mz /= len;
        pl.pos.x += mx * sp * dt; pl.pos.z += mz * sp * dt;
        pl.heading += wrapAngle(Math.atan2(mx, mz) - pl.heading) * Math.min(1, dt * 12);
        pl.phase += dt * sp * 1.6;
      }
      pl.speedNow = len > 0 ? sp : 0;
      const p = { x: pl.pos.x, z: pl.pos.z };
      this.city.resolveCircle(p, 0.45);
      for (const c of this.cars) {
        for (const o of [1.2, -1.2]) {
          const cx = c.pos.x + c.fx * o, cz = c.pos.z + c.fz * o, dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
          if (d < 1.6 && d > 1e-4) { p.x = cx + (dx / d) * 1.6; p.z = cz + (dz / d) * 1.6; }
        }
      }
      pl.pos.set(p.x, 0, p.z);
      pl.mesh.position.copy(pl.pos); pl.mesh.rotation.y = pl.heading;
      animateCharacter(pl.mesh, pl.phase, len > 0 ? (sp > 6 ? 0.9 : 0.6) : 0);
    }

    // --- traffic and parked cars ---
    for (const c of this.cars) {
      if (c.mode === 'traffic') c.aiTraffic(dt, this);
      else if (c.mode === 'parked' && Math.abs(c.speed) > 0.05) c.drive(dt, 0, 0, true, this.city);
      if (!c.isCop) c.syncMesh(this.time);
    }
    this.police.update(dt, this.time);
    this._carCollisions();

    // --- pedestrians ---
    for (const ped of this.peds) {
      ped.update(dt);
      if (ped.down > 0) continue;
      const pp = ped.mesh.position;
      for (const c of this.cars) {
        if (Math.abs(c.speed) < 5) continue;
        if (Math.hypot(c.pos.x - pp.x, c.pos.z - pp.z) < 2.0) {
          ped.knock(c.fx * c.speed * 0.5, c.fz * c.speed * 0.5);
          if (c === pl.car) { this.police.crime(12, pp.x, pp.z, 45, 'hit'); this.audio.crash(30); }
          break;
        }
      }
      if (this.police.wanted && Math.hypot(pp.x - pl.pos.x, pp.z - pl.pos.z) < 12) ped.flee = 2;
    }

    this.eco.update(dt);
    this.saveT -= dt; if (this.saveT <= 0) { this.saveT = 15; this.eco.save(); }

    // --- markers ---
    const pp = this.playerPos();
    for (const m of this.markers) {
      m.children[0].rotation.z += dt; m.children[0].scale.setScalar(1 + Math.sin(this.time * 4) * 0.08);
      const d = Math.hypot(m.position.x - pp.x, m.position.z - pp.z);
      m.children[1].visible = d > 14;
    }
    this.yardMarker.visible = !this.eco.inYard(pp.x, pp.z);

    // --- prompt ---
    if (!canMove) this.hud.prompt(null);
    else if (pl.car) this.hud.prompt(Math.abs(pl.car.speed) < 2 ? 'Get out' : null);
    else {
      const it = this.nearestInteractable();
      if (it) this.hud.prompt(it.label());
      else {
        const car = this.nearestCar();
        this.hud.prompt(car ? (car.isCop ? 'Take the cruiser (huge heat)' : car.mode === 'traffic' ? 'Pull the driver out and take the car' : 'Get in') : null);
      }
    }

    this._camera(dt);
    this._applyDaylight();
    this.hud.update(dt);
    let sirenD = 1e9;
    for (const c of this.police.cops) if (c.sirenOn) sirenD = Math.min(sirenD, Math.hypot(c.pos.x - pl.pos.x, c.pos.z - pl.pos.z));
    this.audio.update(this.time, !!pl.car, pl.car ? pl.car.speed : 0, sirenD < 1e8, sirenD);
  }

  _carCollisions() {
    const cars = this.cars, pc = this.player.car;
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      if (Math.abs(dx) > 5 || Math.abs(dz) > 5) continue;
      const d = Math.hypot(dx, dz), min = 3.4;
      if (d >= min || d < 1e-4) continue;
      const push = (min - d) / 2, nx = dx / d, nz = dz / d;
      const am = a.mode === 'parked' ? 0.4 : 1, bm = b.mode === 'parked' ? 0.4 : 1;
      a.pos.x -= nx * push * am; a.pos.z -= nz * push * am;
      b.pos.x += nx * push * bm; b.pos.z += nz * push * bm;
      const rel = Math.abs(a.speed - b.speed);
      if (a === pc || b === pc) {
        const other = a === pc ? b : a;
        if (rel > 8) {
          this.audio.crash(rel * 2);
          if (other.mode === 'parked' || other.mode === 'traffic') other.speed += (a === pc ? a.speed : b.speed) * 0.3;
          if (other.police) this.police.crime(15, other.pos.x, other.pos.z, 80, 'ram');
          else if (rel > 14) this.police.crime(3, other.pos.x, other.pos.z, 30, 'crash');
        }
        pc.speed *= rel > 8 ? 0.6 : 0.95;
      }
    }
  }

  _camera(dt) {
    const pl = this.player, cam = this.camera;
    let tx, ty, tz, dist;
    if (pl.car) {
      const car = pl.car;
      if (this.time - this.lastMouse > 1.2 && Math.abs(car.speed) > 1) {
        const want = car.speed >= 0 ? car.heading : car.heading;
        this.camYaw += wrapAngle(want - this.camYaw) * Math.min(1, dt * 2.5);
        this.camPitch += (0.28 - this.camPitch) * Math.min(1, dt * 2);
      }
      tx = car.pos.x; ty = 2.2; tz = car.pos.z; dist = 10.5 + Math.abs(car.speed) * 0.08;
    } else { tx = pl.pos.x; ty = 1.9; tz = pl.pos.z; dist = 6.5; }
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw), cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    // pull the camera in if a building is between it and the player
    let d = dist;
    for (let k = 1; k <= 8; k++) {
      const t = (dist * k) / 8;
      if (this.city.pointBlocked(tx - fx * t * cp, tz - fz * t * cp)) { d = Math.max(2, t - 1.2); break; }
    }
    cam.position.set(tx - fx * d * cp, Math.max(0.8, ty + d * sp + 0.6), tz - fz * d * cp);
    cam.lookAt(tx, ty, tz);
    this.sun.target.position.set(tx, 0, tz);
  }

  _applyDaylight() {
    const t = this.eco.s.time, ang = (t - 0.25) * Math.PI * 2, sy = Math.sin(ang);
    const day = THREE.MathUtils.smoothstep(sy, -0.12, 0.28), night = 1 - day;
    const p = this.playerPos();
    const dusk = Math.max(0, 1 - Math.abs(sy) / 0.25) * 0.8;
    const sky = new THREE.Color(0x0a1022).lerp(new THREE.Color(0x8ec9f0), day).lerp(new THREE.Color(0xf08a5d), dusk * 0.55);
    this.scene.background = sky; this.scene.fog.color.copy(sky);
    this.hemi.intensity = 0.28 + day * 0.6;
    this.hemi.color.setHex(day > 0.5 ? 0xcfe8ff : 0x7d8cc4);
    if (sy > -0.05) {
      this.sun.position.set(p.x + Math.cos(ang) * 120, Math.max(18, sy * 160), p.z + 50);
      this.sun.color.setHex(0xffffff).lerp(new THREE.Color(0xffa060), dusk);
      this.sun.intensity = 0.2 + day * 1.35;
    } else {
      this.sun.position.set(p.x - Math.cos(ang) * 120, Math.max(30, -sy * 160), p.z - 40);
      this.sun.color.setHex(0x9fb4ff); this.sun.intensity = 0.38;
    }
    this.city.setNight(night);
    // player car headlights at night
    const car = this.player.car;
    if (car && night > 0.3) {
      this.headlight.intensity = 60 * night;
      this.headlight.position.set(car.pos.x + car.fx * 2.2, 1.2, car.pos.z + car.fz * 2.2);
      this.headlight.target.position.set(car.pos.x + car.fx * 20, 0, car.pos.z + car.fz * 20);
    } else this.headlight.intensity = 0;
  }
}

window.game = new Game();
