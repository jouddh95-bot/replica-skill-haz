// Port Verrin: game bootstrap, player, camera, combat, world loop.
import * as THREE from 'three';
import { City, HIDEOUT, SHOP_POINT, PAWN_POINT, mulberry32 } from './city.js';
import { Car, CAR_COLORS, wrapAngle, headMat } from './actors.js';
import { Human, loadHumans, makeWeaponMesh } from './characters.js';
import { Npc, gangCorners } from './npcs.js';
import { Effects, Arsenal, WEAPONS, WEAPON_ORDER, castRay } from './combat.js';
import { Economy } from './economy.js';
import { Police } from './police.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Renderer } from './render.js';

const DAY_LEN = 480; // seconds per in-game day
const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _o = new THREE.Vector3();

class Player {
  constructor(scene) {
    this.human = new Human(scene, { tint: 0x8fb39a, hp: 100 });
    this.human.pos.set(HIDEOUT.spawn[0], 0, HIDEOUT.spawn[1]);
    this.human.heading = Math.PI / 2;
    this.car = null; this.speedNow = 0; this.lastHurt = 0;
  }
  get pos() { return this.human.pos; }
  get heading() { return this.human.heading; }
  set heading(h) { this.human.heading = h; }
  facing() { return this.car ? this.car.heading : this.human.heading; }
}

class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x9fc6e0, 200, 950);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.2, 5000);
    this.view = new Renderer($('view'), this.scene, this.camera);
    this.rng = mulberry32(2024);
    this.time = 0;

    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a4030, 0.6);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -70; sc.right = sc.top = 70; sc.near = 1; sc.far = 450;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.city = new City(this.scene);
    this.audio = new Audio();
    this.fx = new Effects(this.scene);
    this.markers = [];
    this.cars = [];
    this.npcs = [];
    this.pickups = [];
    this.eco = new Economy(this);
    this.police = new Police(this);
    this.player = new Player(this.scene);
    this.arsenal = new Arsenal(this);
    this.hud = new Hud(this);
    this.headlight = new THREE.SpotLight(0xfff0d0, 0, 70, 0.55, 0.5, 1.2);
    this.scene.add(this.headlight, this.headlight.target);

    const [cx, cz, ch] = HIDEOUT.carSpot;
    this.myCar = new Car(this.scene, { color: 0x3b2a6e, x: cx, z: cz, heading: ch });
    this.cars.push(this.myCar);
    for (let i = 0; i < 18; i++) {
      const c = new Car(this.scene, { color: CAR_COLORS[i % CAR_COLORS.length], mode: 'traffic' });
      c.placeOnRoad(this.rng, cx, cz, 30); this.cars.push(c);
    }
    for (let i = 0; i < 22; i++) this.cars.push(this._parkedCar(cx, cz));

    for (let i = 0; i < 28; i++) this.npcs.push(new Npc(this, 'civ'));
    this.corners = gangCorners(this.city);
    this.corners.forEach((c, k) => this._spawnGang(k));

    this.yardMarker = this.addMarker(-160, 78, 0xffd166);
    this.shopMarker = this.addMarker(SHOP_POINT[0], SHOP_POINT[1], 0x6cf2c2);
    this.pawnMarker = this.addMarker(PAWN_POINT[0], PAWN_POINT[1], 0xff9a6b);

    this.camYaw = Math.PI / 2; this.camPitch = 0.28; this.lastMouse = 0;
    this.keys = new Set(); this.firing = false; this.aiming = false; this.lastShot = -9;
    this.running = false; this.overlayT = 0; this.overlayKind = null; this.saveT = 10;
    this._bindInput();
    this.clock = new THREE.Clock();
    this._applyDaylight(0);
    this.view.updateEnv(0, true);
    this.view.r.setAnimationLoop(() => this.frame());
  }

  _parkedCar(ax, az) {
    const c = new Car(this.scene, { color: CAR_COLORS[Math.floor(this.rng() * CAR_COLORS.length)] });
    c.placeOnRoad(this.rng, ax, az, 20);
    const r = c.route; c.pos.x += -r.dj * 2.3; c.pos.z += r.di * 2.3; c.route = null;
    c.syncMesh();
    return c;
  }
  _spawnGang(k) {
    const [x, z] = this.corners[k];
    const weapons = ['pistol', 'bat', 'pistol'];
    for (let i = 0; i < 3; i++) {
      const n = new Npc(this, 'gang', { home: [x + (i - 1) * 1.6, z + (i % 2) * 1.2], weapon: weapons[i] });
      n.corner = k; this.npcs.push(n);
    }
  }

  // ---------- helpers used by other modules ----------
  toast(t, k) { this.hud.toast(t, k); }
  banner(a, b) { this.hud.banner(a, b, 5000); }
  playerPos() { return this.player.car ? this.player.car.pos : this.player.pos; }
  humans() { const out = [this.player.human]; for (const n of this.npcs) out.push(n.h); return out; }
  npcOf(h) { return this.npcs.find((n) => n.h === h); }
  makeNpcWeapon(id) { const m = makeWeaponMesh(id); this.scene.add(m); return m; }
  nearestOfficer() {
    let d = 1e9; const p = this.player.pos;
    for (const n of this.npcs) if (n.kind === 'cop' && !n.dead) d = Math.min(d, Math.hypot(n.h.pos.x - p.x, n.h.pos.z - p.z));
    return d;
  }
  removeOfficers() {
    for (const n of this.npcs.filter((x) => x.kind === 'cop')) this._removeNpc(n);
  }
  _removeNpc(n) { n.h.remove(); if (n.gun) this.scene.remove(n.gun); this.npcs = this.npcs.filter((x) => x !== n); }
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
    for (const n of this.npcs) if (n.state !== 'walk' && n.state !== 'idle' && !n.dead && hit(n.h.pos.x, n.h.pos.z, 1.4)) return true;
    return false;
  }

  // ---------- input ----------
  _bindInput() {
    const canvas = $('view');
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') { e.preventDefault(); if (this.running) this.hud.togglePhone(); return; }
      if (e.code === 'Escape') { this.hud.closePanels(); return; }
      if (!this.running) return;
      if (e.code === 'KeyE' && !e.repeat && !this.hud.anyOpen() && this.overlayT <= 0) this.interact();
      if (e.code === 'KeyH' && !e.repeat) this.audio.horn();
      if (e.code === 'KeyR' && !e.repeat) this.arsenal.reload();
      const digit = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
      if (digit >= 0) this.arsenal.select(WEAPON_ORDER[digit]);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.firing = this.aiming = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    let dragLook = false;
    canvas.addEventListener('mousedown', (e) => {
      if (!this.running || this.hud.anyOpen()) return;
      const locked = document.pointerLockElement === canvas;
      if (!locked) {
        try { const r = canvas.requestPointerLock?.(); r?.catch?.(() => {}); } catch { /* pointer lock unavailable */ }
        if (!this._lockFailed) { setTimeout(() => { if (document.pointerLockElement !== canvas) this._lockFailed = true; }, 400); }
      }
      if (e.button === 0 && (locked || this._lockFailed)) this.firing = true;
      if (e.button === 2) { this.aiming = true; if (!locked) dragLook = true; }
      if (e.button === 1 || (e.button === 0 && !locked)) dragLook = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.firing = false; }
      if (e.button === 2) this.aiming = false;
      dragLook = false;
    });
    window.addEventListener('wheel', (e) => { if (this.running && !this.hud.anyOpen()) this.arsenal.cycle(e.deltaY > 0 ? 1 : -1); }, { passive: true });
    window.addEventListener('mousemove', (e) => {
      if (!this.running) return;
      if (document.pointerLockElement === canvas || dragLook) {
        const k = this.aiming ? 0.6 : 1;
        this.camYaw -= e.movementX * 0.0032 * k;
        this.camPitch = Math.max(-0.6, Math.min(1.2, this.camPitch + e.movementY * 0.0026 * k));
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
    this.hud.banner('PORT VERRIN', 'Saltmarsh Docks · your yard', 3500);
    this.toast('Goal: ' + this.eco.goalText());
    this.toast("Click to lock the mouse. Right mouse aims, left mouse punches or shoots. Guns at Marlow's Pawn (orange).", 'phone');
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
    for (const c of this.cars) { if (c.wrecked) continue; const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  interact() {
    const pl = this.player;
    if (pl.human.dead) return;
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
      const n = new Npc(this, 'civ', { at: [car.pos.x + car.fz * 2.2, car.pos.z - car.fx * 2.2] });
      n.scare(car.pos.x, car.pos.z, 10); this.npcs.push(n);
    }
    car.mode = 'player'; car.route = null; car.deployed = false;
    pl.car = car; pl.human.group.visible = false;
    this.audio.blip(300);
  }
  exitCar() {
    const pl = this.player, car = pl.car;
    const p = { x: car.pos.x + car.fz * 2.4, z: car.pos.z - car.fx * 2.4 };
    this.city.resolveCircle(p, 0.5);
    pl.pos.set(p.x, 0, p.z); pl.heading = car.heading;
    if (!car.wrecked) car.mode = 'parked';
    pl.car = null; pl.human.group.visible = true;
  }

  // ---------- combat ----------
  aimPitch() { this.camera.getWorldDirection(_d); return Math.asin(Math.max(-1, Math.min(1, _d.y))); }
  playerShoot(w) {
    const pl = this.player, cam = this.camera;
    cam.getWorldDirection(_d);
    // start the ray level with the player so nothing behind them gets hit
    const along = _v.subVectors(pl.pos, cam.position).dot(_d);
    _o.copy(cam.position).addScaledVector(_d, Math.max(0, along + 0.4));
    pl.human.handPos(_v);
    const muzzle = _v.clone().addScaledVector(_d, 0.35);
    this.fx.muzzle(muzzle, w.sound);
    this.audio.gun(w.sound, 1);
    let hitAny = false;
    for (let i = 0; i < (w.pellets || 1); i++) {
      const dir = _d.clone();
      const sp = w.spread * (this.aiming ? 0.5 : 1.3) * (pl.speedNow > 1 ? 1.5 : 1);
      dir.x += (Math.random() - 0.5) * sp * 2; dir.y += (Math.random() - 0.5) * sp * 2; dir.z += (Math.random() - 0.5) * sp * 2; dir.normalize();
      const r = castRay(this, _o, dir, w.range, pl.human);
      if (i < 3) this.fx.tracer(muzzle, r.point);
      if (r.human) {
        const n = this.npcOf(r.human);
        if (n) { n.damage(w.dmg, true, dir.x * 4, dir.z * 4, r.head); hitAny = true; }
      } else if (r.car) {
        r.car.hp -= w.dmg * 0.6; this.fx.sparks(r.point, 5); hitAny = true;
        if (r.car.mode === 'traffic') { r.car.mode = 'parked'; }
      } else if (r.wall || r.ground) this.fx.sparks(r.point, 3);
    }
    if (hitAny) this.hud.hitMarker();
    this.camPitch = Math.max(-0.6, this.camPitch - 0.012 * w.sound);
    this.lastShot = this.time;
    this.police.crime(1.5, pl.pos.x, pl.pos.z, 55, 'shots');
    for (const n of this.npcs) if (Math.hypot(n.h.pos.x - pl.pos.x, n.h.pos.z - pl.pos.z) < 45) {
      if (n.kind === 'civ') n.scare(pl.pos.x, pl.pos.z, 10);
      else if (n.kind === 'gang' && Math.hypot(n.h.pos.x - pl.pos.x, n.h.pos.z - pl.pos.z) < 30) n.provoke();
    }
  }
  meleeAttack(att, w, fromPlayer) {
    const ok = w.name === 'Bat' ? att.swing() : att.punch();
    if (!ok) return;
    const fx = Math.sin(att.heading), fz = Math.cos(att.heading);
    let hit = false;
    for (const n of this.npcs) {
      if (n.dead || n.h === att) continue;
      const dx = n.h.pos.x - att.pos.x, dz = n.h.pos.z - att.pos.z, d = Math.hypot(dx, dz);
      if (d > w.range || (dx * fx + dz * fz) / (d || 1) < 0.35) continue;
      n.damage(w.dmg, fromPlayer, fx * 3, fz * 3);
      n.h.pos.x += fx * 0.5; n.h.pos.z += fz * 0.5;
      hit = true;
    }
    if (hit) { this.audio.punch(); this.hud.hitMarker(); this.police.crime(3, att.pos.x, att.pos.z, 25, 'assault'); }
    else this.audio.tone(200, 0.05, 'triangle', 0.04);
  }
  npcMelee(n, dmg) {
    const p = this.player.pos;
    if (this.player.car || Math.hypot(p.x - n.h.pos.x, p.z - n.h.pos.z) > 1.9) return;
    this.audio.punch();
    this.damagePlayer(dmg, n);
  }
  damagePlayer(n, src) {
    const s = this.eco.s, pl = this.player;
    if (pl.human.dead || this.overlayT > 0) return;
    const absorb = Math.min(s.armor, n * 0.7);
    s.armor -= absorb; s.health -= n - absorb;
    pl.lastHurt = this.time;
    pl.human.hurt();
    this.hud.damageFlash();
    this.fx.blood(_v.set(pl.pos.x, 1.2, pl.pos.z), 4);
    if (s.health <= 0) this.playerDied();
  }
  onNpcKilled(n) {
    const p = n.h.pos, s = this.eco.s;
    if (n.kind === 'civ') { this.police.crime(16, p.x, p.z, 45, 'murder'); }
    else if (n.kind === 'cop') { this.police.crime(35, p.x, p.z, 200, 'cop'); this.police.setWanted(3, 'cop'); }
    else if (n.kind === 'gang') {
      const d = this.eco.districtOf(p.x, p.z);
      s.control[d] = Math.min(100, s.control[d] + 3);
      this.dropCash(p.x, p.z, 60 + Math.floor(this.rng() * 120));
      this.police.crime(6, p.x, p.z, 40, 'gang');
    }
    for (const o of this.npcs) if (o.kind === 'civ' && Math.hypot(o.h.pos.x - p.x, o.h.pos.z - p.z) < 30) o.scare(p.x, p.z, 12);
  }
  dropCash(x, z, amount) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.3), new THREE.MeshStandardMaterial({ color: 0x3ddc84, emissive: 0x1a8a4a, emissiveIntensity: 1.5 }));
    m.position.set(x + 0.8, 0.4, z); this.scene.add(m);
    this.pickups.push({ m, amount });
  }
  explodeCar(c) {
    const p = c.pos;
    this.fx.explosion(p); this.audio.explode();
    c.wreck();
    if (this.player.car === c) { this.exitCar(); this.damagePlayer(45, null); }
    for (const n of this.npcs) {
      if (n.dead) continue;
      const d = Math.hypot(n.h.pos.x - p.x, n.h.pos.z - p.z);
      if (d < 7) n.damage(d < 4 ? 999 : 40, true, (n.h.pos.x - p.x), (n.h.pos.z - p.z));
    }
    if (!this.player.car) { const d = Math.hypot(this.player.pos.x - p.x, this.player.pos.z - p.z); if (d < 7) this.damagePlayer(d < 4 ? 60 : 25, null); }
    for (const o of this.cars) if (o !== c && !o.wrecked && Math.hypot(o.pos.x - p.x, o.pos.z - p.z) < 6) o.hp -= 70;
    this.police.crime(10, p.x, p.z, 60, 'explosion');
  }

  showOverlay(kind, title, msg, secs) {
    $('bustedtitle').textContent = title; $('bustedmsg').textContent = msg;
    $('busted').style.display = 'flex';
    this.overlayT = secs; this.overlayKind = kind;
  }
  busted() {
    if (this.overlayT > 0) return;
    const s = this.eco.s, lost = s.product + s.raw, fine = Math.round(s.money * 0.15);
    s.product = 0; s.raw = 0; s.money -= fine; s.heat = 10;
    this.showOverlay('bust', 'COLLARED', `Precinct 9 took ${lost} glowcap item${lost === 1 ? '' : 's'} and fined you $${fine}. You walk out of holding at dawn.`, 4);
    this.audio.bad();
    this.police.clearAll();
    if (this.player.car) this.exitCar();
    this.eco.save();
  }
  playerDied() {
    const s = this.eco.s, fee = Math.round(s.money * 0.1);
    this.player.human.die(0, 0);
    s.money -= fee;
    this.showOverlay('dead', 'FLATLINED', `St. Brine Clinic patched you up for $${fee}. Your stash at the yard is safe.`, 4.5);
    this.audio.bad();
    this.eco.save();
  }
  _finishOverlay() {
    $('busted').style.display = 'none';
    const pl = this.player, s = this.eco.s;
    if (this.overlayKind === 'dead') {
      this.police.clearAll();
      const old = pl.human; old.remove();
      pl.human = new Human(this.scene, { tint: 0x8fb39a, hp: 100 });
      s.health = 100; s.heat = Math.min(s.heat, 20);
    }
    pl.pos.set(HIDEOUT.spawn[0], 0, HIDEOUT.spawn[1]); pl.heading = Math.PI / 2;
    pl.human.group.visible = true;
    this.camYaw = Math.PI / 2;
    this.eco.s.time = this.overlayKind === 'bust' ? 0.27 : this.eco.s.time;
    this.overlayKind = null;
  }

  // ---------- simulation ----------
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.time += dt;
    if (this.running) this.update(dt);
    else this._titleCam(dt);
    this.view.render();
  }
  _titleCam(dt) {
    const a = this.time * 0.05;
    this.camera.position.set(Math.cos(a) * 170, 70, Math.sin(a) * 170);
    this.camera.lookAt(0, 20, 0);
    this.eco.s.time = 0.78;
    this._applyDaylight(dt, new THREE.Vector3(0, 0, 0));
    for (const c of this.cars) { if (c.mode === 'traffic') c.aiTraffic(dt, this); c.syncMesh(this.time); }
  }

  update(dt) {
    const s = this.eco.s, pl = this.player;
    s.time += dt / DAY_LEN;
    if (s.time >= 1) { s.time -= 1; s.day++; }
    if (this.overlayT > 0) { this.overlayT -= dt; if (this.overlayT <= 0) this._finishOverlay(); }
    const canMove = this.overlayT <= 0 && !this.hud.anyOpen() && !pl.human.dead;

    // --- player ---
    const aiming = canMove && !pl.car && (this.aiming || this.time - this.lastShot < 0.6);
    if (pl.car) {
      const car = pl.car;
      const thr = canMove ? (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0) : 0;
      const st = canMove ? (this.key('KeyA', 'ArrowLeft') ? 1 : 0) - (this.key('KeyD', 'ArrowRight') ? 1 : 0) : 0;
      const impact = car.wrecked ? 0 : car.drive(dt, thr, st, canMove && this.key('Space'), this.city);
      if (impact > 9) { this.audio.crash(impact); if (impact > 14) car.hp -= impact * 0.7; }
      pl.pos.copy(car.pos);
      pl.speedNow = Math.abs(car.speed);
    } else {
      let mx = 0, mz = 0;
      if (canMove) {
        const f = (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0);
        const r = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);
        const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
        mx = fx * f - fz * r; mz = fz * f + fx * r;
      }
      const len = Math.hypot(mx, mz);
      const sp = aiming ? 3.2 : this.key('ShiftLeft', 'ShiftRight') ? 8.5 : 4.6;
      if (len > 0) {
        mx /= len; mz /= len;
        pl.pos.x += mx * sp * dt; pl.pos.z += mz * sp * dt;
        if (!aiming) pl.heading += wrapAngle(Math.atan2(mx, mz) - pl.heading) * Math.min(1, dt * 12);
      }
      if (aiming) pl.heading += wrapAngle(this.camYaw - pl.heading) * Math.min(1, dt * 20);
      pl.speedNow = len > 0 ? sp : 0;
      const p = { x: pl.pos.x, z: pl.pos.z };
      this.city.resolveCircle(p, 0.42);
      for (const c of this.cars) for (const o of [1.2, -1.2]) {
        const cx = c.pos.x + c.fx * o, cz = c.pos.z + c.fz * o, dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
        if (d < 1.6 && d > 1e-4) { p.x = cx + (dx / d) * 1.6; p.z = cz + (dz / d) * 1.6; }
      }
      pl.pos.set(p.x, 0, p.z);
      const w = WEAPONS[this.arsenal.cur];
      pl.human.aim = aiming && !w.melee ? { pitch: this.aimPitch(), twoHand: this.arsenal.cur !== 'pistol' } : null;
      pl.human.update(dt, pl.speedNow);
      // health regen
      if (!pl.human.dead && this.time - pl.lastHurt > 6 && s.health < 100) s.health = Math.min(100, s.health + dt * 3);
    }
    this.arsenal.update(dt, canMove && this.firing && !pl.car, aiming);

    // --- cars ---
    for (const c of this.cars) {
      if (c.mode === 'traffic') c.aiTraffic(dt, this);
      else if (c.mode === 'parked' && Math.abs(c.speed) > 0.05) c.drive(dt, 0, 0, true, this.city);
      if (!c.wrecked && c.hp <= 0) this.explodeCar(c);
      else if (!c.wrecked && c.hp < 35 && Math.random() < dt * 8) this.fx.smoke(_v.set(c.pos.x + c.fx * 1.8, 1.1, c.pos.z + c.fz * 1.8), c.hp < 15);
      if (c.wrecked) {
        c.burnT -= dt;
        if (c.burnT > 0) { if (Math.random() < dt * 25) this.fx.fire(_v.set(c.pos.x, 0.8, c.pos.z)); if (Math.random() < dt * 6) this.fx.smoke(_v.set(c.pos.x, 1.6, c.pos.z), true); }
        if (c.burnT < -60 && Math.hypot(c.pos.x - pl.pos.x, c.pos.z - pl.pos.z) > 90) c.dead = true;
      }
      if (!c.isCop) c.syncMesh(this.time);
    }
    for (const c of this.cars.filter((x) => x.dead)) { c.remove(this.scene); this.cars = this.cars.filter((x) => x !== c); this.cars.push(this._parkedCar(pl.pos.x, pl.pos.z)); }
    this.police.update(dt, this.time);
    this._deployOfficers();
    this._carCollisions();

    // --- people ---
    for (const n of this.npcs) {
      n.update(dt);
      if (n.dead) continue;
      const pp = n.h.pos;
      for (const c of this.cars) {
        if (Math.abs(c.speed) < 4.5) continue;
        if (Math.hypot(c.pos.x - pp.x, c.pos.z - pp.z) < 2.0) {
          const byPlayer = c === pl.car;
          n.damage(Math.abs(c.speed) * 4, byPlayer, c.fx * c.speed * 0.3, c.fz * c.speed * 0.3);
          pp.x += c.fx * 1.5; pp.z += c.fz * 1.5;
          if (byPlayer) { this.audio.crash(30); this.police.crime(8, pp.x, pp.z, 45, 'hit'); }
          break;
        }
      }
      if (n.kind === 'civ' && this.police.wanted && Math.hypot(pp.x - pl.pos.x, pp.z - pl.pos.z) < 12) n.scare(pl.pos.x, pl.pos.z, 3);
    }
    // respawn the dead elsewhere, retire far officers
    for (const n of [...this.npcs]) {
      if (n.respawn) {
        this._removeNpc(n);
        if (n.kind === 'civ') this.npcs.push(new Npc(this, 'civ'));
        if (n.kind === 'gang' && !this.npcs.some((o) => o.kind === 'gang' && o.corner === n.corner)) setTimeout(() => this._spawnGang(n.corner), 90000);
      } else if (n.kind === 'cop' && (Math.hypot(n.h.pos.x - pl.pos.x, n.h.pos.z - pl.pos.z) > 120 || (this.police.wanted === 0 && Math.hypot(n.h.pos.x - pl.pos.x, n.h.pos.z - pl.pos.z) > 40))) {
        this._removeNpc(n);
      }
    }
    if (this.police.wanted === 0) for (const n of this.npcs) if (n.kind === 'cop' && n.state === 'shoot') { n.state = 'flee'; n.threat = [pl.pos.x, pl.pos.z]; n.fleeT = 6; }
    for (const c of this.police.cops) if (c.deployed && !this.npcs.some((n) => n.kind === 'cop' && n.fromCar === c)) c.deployed = false;

    // --- pickups ---
    for (const k of [...this.pickups]) {
      k.m.rotation.y += dt * 3; k.m.position.y = 0.4 + Math.sin(this.time * 4) * 0.1;
      if (!pl.car && Math.hypot(k.m.position.x - pl.pos.x, k.m.position.z - pl.pos.z) < 1.6) {
        s.money += k.amount; s.earned += k.amount; this.audio.cash(); this.toast(`Picked up $${k.amount}.`, 'cash');
        this.scene.remove(k.m); this.pickups = this.pickups.filter((x) => x !== k);
      }
    }

    this.eco.update(dt);
    this.fx.update(dt);
    this.saveT -= dt; if (this.saveT <= 0) { this.saveT = 15; this.eco.save(); }

    // --- markers ---
    const pp = this.playerPos();
    for (const m of this.markers) {
      m.children[0].rotation.z += dt; m.children[0].scale.setScalar(1 + Math.sin(this.time * 4) * 0.08);
      m.children[1].visible = Math.hypot(m.position.x - pp.x, m.position.z - pp.z) > 14;
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

    this._camera(dt, aiming);
    this._applyDaylight(dt);
    this.hud.update(dt);
    let sirenD = 1e9;
    for (const c of this.police.cops) if (c.sirenOn) sirenD = Math.min(sirenD, Math.hypot(c.pos.x - pl.pos.x, c.pos.z - pl.pos.z));
    this.audio.update(this.time, !!pl.car, pl.car ? pl.car.speed : 0, sirenD < 1e8, sirenD);
  }

  _deployOfficers() {
    const pol = this.police, pl = this.player;
    if (!pol.wanted || pl.human.dead) return;
    const officers = this.npcs.filter((n) => n.kind === 'cop' && !n.dead).length;
    for (const c of pol.cops) {
      if (c.deployed || officers >= 8) continue;
      const d = Math.hypot(c.pos.x - pl.pos.x, c.pos.z - pl.pos.z);
      const playerSlow = !pl.car || Math.abs(pl.car.speed) < 4;
      if (d < 24 && playerSlow && c.sirenOn) {
        c.deployed = true; c.speed *= 0.3;
        const n = pol.wanted >= 2 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const side = i === 0 ? 1 : -1;
          const o = new Npc(this, 'cop', { at: [c.pos.x + c.fz * 2 * side, c.pos.z - c.fx * 2 * side], weapon: 'pistol' });
          o.state = pol.wanted >= 2 ? 'shoot' : 'arrest'; o.fromCar = c; o.angry = 999;
          this.npcs.push(o);
        }
      }
    }
    for (const n of this.npcs) if (n.kind === 'cop' && !n.dead && pol.wanted >= 2 && n.state === 'arrest') n.state = 'shoot';
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
      const am = a.mode === 'parked' || a.wrecked ? 0.4 : 1, bm = b.mode === 'parked' || b.wrecked ? 0.4 : 1;
      a.pos.x -= nx * push * am; a.pos.z -= nz * push * am;
      b.pos.x += nx * push * bm; b.pos.z += nz * push * bm;
      const rel = Math.abs(a.speed - b.speed);
      if (rel > 12) { a.hp -= rel * 0.6; b.hp -= rel * 0.6; }
      if (a === pc || b === pc) {
        const other = a === pc ? b : a;
        if (rel > 8) {
          this.audio.crash(rel * 2);
          if (other.mode === 'parked' || other.mode === 'traffic') other.speed += (a === pc ? a.speed : b.speed) * 0.3;
          if (other.isCop) this.police.crime(15, other.pos.x, other.pos.z, 80, 'ram');
          else if (rel > 14) this.police.crime(3, other.pos.x, other.pos.z, 30, 'crash');
        }
        pc.speed *= rel > 8 ? 0.6 : 0.95;
      }
    }
  }

  _camera(dt, aiming) {
    const pl = this.player, cam = this.camera;
    let tx, ty, tz, dist, side = 0;
    if (pl.car) {
      const car = pl.car;
      if (this.time - this.lastMouse > 1.2 && Math.abs(car.speed) > 1) {
        this.camYaw += wrapAngle(car.heading - this.camYaw) * Math.min(1, dt * 2.5);
        this.camPitch += (0.22 - this.camPitch) * Math.min(1, dt * 2);
      }
      tx = car.pos.x; ty = 1.9; tz = car.pos.z; dist = 9.5 + Math.abs(car.speed) * 0.08;
    } else {
      tx = pl.pos.x; ty = aiming ? 1.6 : 1.7; tz = pl.pos.z; dist = aiming ? 2.6 : 4.6; side = aiming ? 0.75 : 0.45;
    }
    this._dist = (this._dist ?? dist) + (dist - (this._dist ?? dist)) * Math.min(1, dt * 10);
    this._side = (this._side ?? side) + (side - (this._side ?? side)) * Math.min(1, dt * 10);
    const fov = aiming ? 50 : 62;
    if (Math.abs(cam.fov - fov) > 0.1) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 10); cam.updateProjectionMatrix(); }
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw), cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const rx = -fz, rz = fx; // camera right
    tx += rx * this._side; tz += rz * this._side;
    let d = this._dist;
    for (let k = 1; k <= 8; k++) {
      const t = (this._dist * k) / 8;
      if (this.city.pointBlocked(tx - fx * t * cp, tz - fz * t * cp)) { d = Math.max(1.2, t - 0.8); break; }
    }
    cam.position.set(tx - fx * d * cp, Math.max(0.5, ty + d * sp), tz - fz * d * cp);
    cam.lookAt(tx + fx * 2, ty + (pl.car ? 0 : 0.1) - sp * 0.2, tz + fz * 2);
    this.sun.target.position.set(pl.pos.x, 0, pl.pos.z);
  }

  _applyDaylight(dt, center) {
    const t = this.eco.s.time, ang = (t - 0.25) * Math.PI * 2, sy = Math.sin(ang);
    const day = THREE.MathUtils.smoothstep(sy, -0.12, 0.28), night = 1 - day;
    const p = center || this.playerPos();
    const dusk = Math.max(0, 1 - Math.abs(sy) / 0.25) * 0.8;
    this.view.setSun(Math.asin(Math.max(-1, Math.min(1, sy))), Math.PI * 0.75 + Math.cos(ang) * 0.6, night, this.camera.position);
    this.view.updateEnv(dt);
    const envK = 0.04 + day * 0.32;
    if (this._envK === undefined || Math.abs(envK - this._envK) > 0.02 || (this._envScan = (this._envScan || 0) - dt) < 0) {
      this._envK = envK; this._envScan = 3;
      this.scene.traverse((o) => { const m = o.material; if (m && m.isMeshStandardMaterial) m.envMapIntensity = m.userData.envBoost ? envK * 2 : envK; });
    }
    const fog = new THREE.Color(0x05070d).lerp(new THREE.Color(0x9bb8cf), day).lerp(new THREE.Color(0xe39a6a), dusk * 0.5);
    this.scene.fog.color.copy(fog);
    this.hemi.intensity = 0.95 - day * 0.05;
    this.hemi.color.setHex(day > 0.5 ? 0xcfe8ff : 0x6d7cb4);
    if (sy > -0.05) {
      const dir = this.view.sunDir;
      this.sun.position.set(p.x + dir.x * 200, Math.max(25, dir.y * 200), p.z + dir.z * 200);
      this.sun.color.setHex(0xfff4e6).lerp(new THREE.Color(0xffa060), dusk);
      this.sun.intensity = 0.3 + day * 2.4;
    } else {
      this.sun.position.set(p.x - 80, 140, p.z - 60);
      this.sun.color.setHex(0x9fb4ff); this.sun.intensity = 0.7;
    }
    this.city.setNight(night);
    headMat.color.setRGB(1 + night * 2, 0.95 + night * 1.8, 0.8 + night * 1.4);
    const car = this.player.car;
    if (car && night > 0.3) {
      this.headlight.intensity = 90 * night;
      this.headlight.position.set(car.pos.x + car.fx * 2.2, 1.2, car.pos.z + car.fz * 2.2);
      this.headlight.target.position.set(car.pos.x + car.fx * 20, 0, car.pos.z + car.fz * 20);
    } else this.headlight.intensity = 0;
  }
}

(async () => {
  const base = new URL('../assets/Soldier.glb', import.meta.url).href;
  $('loading').textContent = 'Loading characters...';
  await loadHumans(base);
  $('loading').textContent = 'Building the city...';
  await new Promise((r) => setTimeout(r, 30));
  window.game = new Game();
})();
