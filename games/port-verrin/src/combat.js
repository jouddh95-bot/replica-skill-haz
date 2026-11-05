// Weapons, hit detection, bullets, explosions and particle effects.
import * as THREE from 'three';
import { makeWeaponMesh } from './characters.js';

export const WEAPONS = {
  fists: { name: 'Fists', melee: true, dmg: 14, range: 1.9, rate: 0.42, key: 1 },
  bat: { name: 'Bat', melee: true, dmg: 34, range: 2.4, rate: 0.62, key: 2, price: 150 },
  pistol: { name: 'Pistol', dmg: 24, rate: 0.26, mag: 12, spread: 0.012, range: 140, key: 3, price: 500, ammoPack: 36, ammoPrice: 60, sound: 1 },
  smg: { name: 'SMG', dmg: 15, rate: 0.085, auto: true, mag: 30, spread: 0.035, range: 110, key: 4, price: 1800, ammoPack: 90, ammoPrice: 120, sound: 0.8 },
  shotgun: { name: 'Shotgun', dmg: 13, pellets: 9, rate: 0.95, mag: 6, spread: 0.085, range: 40, key: 5, price: 1400, ammoPack: 18, ammoPrice: 90, sound: 1.6 },
};
export const WEAPON_ORDER = ['fists', 'bat', 'pistol', 'smg', 'shotgun'];

function dotTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---------- particles ----------
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.glowTex = dotTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    this.smokeTex = dotTexture('rgba(255,255,255,0.8)', 'rgba(255,255,255,0)');
    this.pool = [];
    this.live = [];
    this.tracers = [];
    this.flash = new THREE.PointLight(0xffc070, 0, 14, 2);
    scene.add(this.flash);
    this.flashT = 0;
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9 });
    this.tracerMat.color.setRGB(3, 2.4, 1.4);
  }
  _sprite(additive) {
    let s = this.pool.find((p) => !p.visible && p.userData.additive === additive);
    if (!s) {
      const m = new THREE.SpriteMaterial({ map: additive ? this.glowTex : this.smokeTex, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
      s = new THREE.Sprite(m); s.userData.additive = additive; this.pool.push(s); this.scene.add(s);
    }
    s.visible = true;
    return s;
  }
  spawn(x, y, z, o) {
    const s = this._sprite(!!o.additive);
    s.position.set(x, y, z);
    s.material.color.setRGB(...o.color);
    s.material.opacity = o.opacity ?? 1;
    s.scale.setScalar(o.size);
    s.userData.v = new THREE.Vector3(o.vx || 0, o.vy || 0, o.vz || 0);
    s.userData.life = s.userData.max = o.life;
    s.userData.grow = o.grow || 0; s.userData.grav = o.grav || 0; s.userData.op = o.opacity ?? 1;
    this.live.push(s);
  }
  muzzle(p, scale = 1) {
    this.spawn(p.x, p.y, p.z, { additive: true, color: [4, 2.6, 1.2], size: 0.55 * scale, life: 0.05 });
    this.flash.position.copy(p); this.flash.intensity = 30 * scale; this.flashT = 0.05;
  }
  sparks(p, n = 6) {
    for (let i = 0; i < n; i++) this.spawn(p.x, p.y, p.z, { additive: true, color: [3, 2.2, 1], size: 0.09, life: 0.25 + Math.random() * 0.2, vx: (Math.random() - 0.5) * 7, vy: Math.random() * 5, vz: (Math.random() - 0.5) * 7, grav: 14 });
    this.spawn(p.x, p.y, p.z, { color: [0.6, 0.6, 0.6], size: 0.3, life: 0.6, grow: 1.2, vy: 0.6, opacity: 0.5 });
  }
  blood(p, n = 7) {
    for (let i = 0; i < n; i++) this.spawn(p.x, p.y, p.z, { color: [0.45, 0.02, 0.02], size: 0.12 + Math.random() * 0.1, life: 0.45, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 2.5, vz: (Math.random() - 0.5) * 3, grav: 9 });
  }
  smoke(p, dark) {
    this.spawn(p.x + (Math.random() - 0.5), p.y, p.z + (Math.random() - 0.5), { color: dark ? [0.12, 0.12, 0.12] : [0.5, 0.5, 0.5], size: 1.2, life: 2.2, grow: 1.8, vy: 2.2, opacity: 0.55 });
  }
  fire(p) {
    this.spawn(p.x + (Math.random() - 0.5) * 1.4, p.y, p.z + (Math.random() - 0.5) * 1.4, { additive: true, color: [3.5, 1.4, 0.3], size: 1.0 + Math.random(), life: 0.5, grow: -1, vy: 3 });
  }
  explosion(p) {
    for (let i = 0; i < 26; i++) this.spawn(p.x, p.y + 1, p.z, { additive: true, color: [5, 2.2, 0.5], size: 2 + Math.random() * 2, life: 0.6 + Math.random() * 0.4, grow: 3, vx: (Math.random() - 0.5) * 14, vy: Math.random() * 10, vz: (Math.random() - 0.5) * 14, grav: 6 });
    for (let i = 0; i < 14; i++) this.spawn(p.x, p.y + 1.5, p.z, { color: [0.08, 0.08, 0.08], size: 3, life: 2.5, grow: 2.5, vx: (Math.random() - 0.5) * 6, vy: 3 + Math.random() * 4, vz: (Math.random() - 0.5) * 6, opacity: 0.8 });
    this.flash.position.set(p.x, p.y + 2, p.z); this.flash.intensity = 300; this.flashT = 0.3;
  }
  tracer(a, b) {
    const g = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
    const l = new THREE.Line(g, this.tracerMat.clone());
    this.scene.add(l); this.tracers.push({ l, t: 0.06 });
  }
  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i], u = s.userData;
      u.life -= dt;
      if (u.life <= 0) { s.visible = false; this.live.splice(i, 1); continue; }
      u.v.y -= u.grav * dt;
      s.position.addScaledVector(u.v, dt);
      if (s.position.y < 0.03) { s.position.y = 0.03; u.v.set(u.v.x * 0.3, 0, u.v.z * 0.3); }
      s.scale.addScalar(u.grow * dt);
      s.material.opacity = u.op * Math.min(1, (u.life / u.max) * 1.6);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]; t.t -= dt;
      if (t.t <= 0) { this.scene.remove(t.l); t.l.geometry.dispose(); t.l.material.dispose(); this.tracers.splice(i, 1); }
    }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.intensity = 0; }
  }
}

// ---------- hit testing ----------
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
// ray (origin o, unit dir d) against a sphere; returns distance or -1
function raySphere(o, d, c, r) {
  _v.subVectors(o, c);
  const b = _v.dot(d), cc = _v.lengthSq() - r * r, disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : -1;
}
// Cast a bullet. targets: humans and cars. Returns {t, point, human?, car?, head?}
export function castRay(game, o, d, range, ignore) {
  let best = { t: range, point: null };
  // buildings: march in 1m steps
  for (let t = 0.5; t < best.t; t += 1) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y <= 0) { best = { t, point: new THREE.Vector3(x, 0.02, z), ground: true }; break; }
    if (game.city.pointBlocked(x, z) && y < 40) { best = { t, point: new THREE.Vector3(x, y, z), wall: true }; break; }
  }
  for (const h of game.humans()) {
    if (h === ignore || h.dead) continue;
    const p = h.pos;
    if (Math.abs(p.x - o.x) > best.t + 2 || Math.abs(p.z - o.z) > best.t + 2) continue;
    const head = raySphere(o, d, _w.set(p.x, 1.65, p.z), 0.2);
    if (head > 0 && head < best.t) { best = { t: head, human: h, head: true }; continue; }
    for (const y of [1.2, 0.75, 0.35]) {
      const tt = raySphere(o, d, _w.set(p.x, y, p.z), y > 1 ? 0.36 : 0.3);
      if (tt > 0 && tt < best.t) { best = { t: tt, human: h }; break; }
    }
  }
  for (const c of game.cars) {
    if (c === ignore) continue;
    const tt = raySphere(o, d, _w.set(c.pos.x, 0.9, c.pos.z), 1.7);
    if (tt > 0 && tt < best.t) best = { t: tt, car: c };
  }
  if (!best.point) best.point = o.clone().addScaledVector(d, best.t);
  return best;
}

export class Arsenal {
  // The player's weapons and the meshes they hold
  constructor(game) {
    this.game = game;
    this.meshes = {};
    for (const id of ['bat', 'pistol', 'smg', 'shotgun']) { const m = makeWeaponMesh(id); m.visible = false; game.scene.add(m); this.meshes[id] = m; }
    this.cool = 0; this.reloadT = 0;
  }
  get s() { return this.game.eco.s; }
  get cur() { return this.s.weapon || 'fists'; }
  owned(id) { return id === 'fists' || !!this.s.weapons[id]; }
  select(id) { if (this.owned(id) && this.cur !== id) { this.s.weapon = id; this.reloadT = 0; this.game.audio.blip(500); } }
  cycle(dir) {
    const list = WEAPON_ORDER.filter((w) => this.owned(w));
    const i = list.indexOf(this.cur);
    this.select(list[(i + dir + list.length) % list.length]);
  }
  clip(id) { return (this.s.clip && this.s.clip[id]) || 0; }
  reload() {
    const id = this.cur, w = WEAPONS[id];
    if (w.melee || this.reloadT > 0) return;
    const need = w.mag - this.clip(id), have = this.s.ammo[id] || 0;
    if (need <= 0 || have <= 0) return;
    this.reloadT = 1.3;
    this._pendingReload = id;
    this.game.audio.tone(300, 0.06, 'square', 0.06); this.game.audio.tone(500, 0.06, 'square', 0.06, 0.9);
  }
  update(dt, firing, aiming) {
    this.cool -= dt;
    if (!firing) this._held = false;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0 && this._pendingReload) {
        const id = this._pendingReload, w = WEAPONS[id];
        const need = w.mag - this.clip(id), take = Math.min(need, this.s.ammo[id] || 0);
        this.s.clip[id] = this.clip(id) + take; this.s.ammo[id] -= take; this._pendingReload = null;
      }
    }
    const g = this.game, pl = g.player;
    // weapon mesh placement
    for (const [id, m] of Object.entries(this.meshes)) m.visible = !pl.car && id === this.cur && !pl.human.dead;
    const m = this.meshes[this.cur];
    if (m && m.visible) {
      const hand = pl.human.handPos(_hand);
      m.position.copy(hand);
      if (this.cur === 'bat') {
        const h = pl.human, B = h.bones;
        if (B) { B.rFore.getWorldPosition(_fore); m.lookAt(_tmp.copy(hand).multiplyScalar(2).sub(_fore)); }
        else m.rotation.set(-0.6, h.heading, 0);
      } else {
        const yaw = aiming || firing ? g.camYaw : pl.human.heading;
        const pitch = aiming || firing ? g.aimPitch() : -0.9;
        m.lookAt(_tmp.set(hand.x + Math.sin(yaw) * Math.cos(pitch), hand.y + Math.sin(pitch), hand.z + Math.cos(yaw) * Math.cos(pitch)));
      }
    }
    if (!firing || this.cool > 0 || this.reloadT > 0 || pl.car || pl.human.dead) return;
    const id = this.cur, w = WEAPONS[id];
    if (!w.auto && this._held) return;
    this._held = true;
    this.cool = w.rate;
    if (w.melee) { g.meleeAttack(pl.human, w, true); return; }
    if (this.clip(id) <= 0) { if ((this.s.ammo[id] || 0) > 0) this.reload(); else { g.audio.tone(900, 0.03, 'square', 0.05); g.toast(`Out of ${w.name.toLowerCase()} ammo. Buy more at Marlow's Pawn.`, 'bad'); } return; }
    this.s.clip[id]--;
    g.playerShoot(w);
  }
  release() { this._held = false; }
}
const _hand = new THREE.Vector3(), _fore = new THREE.Vector3(), _tmp = new THREE.Vector3();
