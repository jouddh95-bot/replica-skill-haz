// Characters, cars and their AI.
import * as THREE from 'three';
import { GRID, ROAD, LANE, rc, nearestNode, nodePos, blockBounds } from './city.js';

const matCache = new Map();
export function lambert(color, extra) {
  const key = color + (extra ? JSON.stringify(extra) : '');
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...extra }));
  return matCache.get(key);
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const G = {
  torso: box(0.7, 0.8, 0.42), head: box(0.44, 0.44, 0.44), hair: box(0.48, 0.16, 0.48),
  leg: (() => { const g = box(0.26, 0.86, 0.3); g.translate(0, -0.43, 0); return g; })(),
  arm: (() => { const g = box(0.2, 0.76, 0.22); g.translate(0, -0.36, 0); return g; })(),
  hood: box(0.5, 0.2, 0.2),
};
export const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function makeCharacter({ skin, top, pants, hair }) {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(G.torso, lambert(top)); torso.position.y = 1.28; g.add(torso);
  const head = new THREE.Mesh(G.head, lambert(skin)); head.position.y = 1.92; g.add(head);
  const hr = new THREE.Mesh(G.hair, lambert(hair)); hr.position.y = 2.16; g.add(hr);
  const parts = {};
  for (const [name, x] of [['legL', -0.17], ['legR', 0.17]]) {
    const p = new THREE.Group(); p.position.set(x, 0.88, 0);
    p.add(new THREE.Mesh(G.leg, lambert(pants))); g.add(p); parts[name] = p;
  }
  for (const [name, x] of [['armL', -0.46], ['armR', 0.46]]) {
    const p = new THREE.Group(); p.position.set(x, 1.62, 0);
    p.add(new THREE.Mesh(G.arm, lambert(top))); g.add(p); parts[name] = p;
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.parts = parts;
  return g;
}
export function animateCharacter(g, phase, amt) {
  const p = g.userData.parts, s = Math.sin(phase) * amt;
  p.legL.rotation.x = s; p.legR.rotation.x = -s; p.armL.rotation.x = -s * 0.8; p.armR.rotation.x = s * 0.8;
}

const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4226];
const TOPS = [0x3b6ea5, 0xd1495b, 0x2a9d8f, 0xe9c46a, 0x6d597a, 0xf4a261, 0x264653, 0xbcb8b1, 0x8ab17d];
const PANTS = [0x22223b, 0x4a4e69, 0x3d405b, 0x5c4033, 0x1b263b];
const HAIR = [0x1b1b1b, 0x4b2e1a, 0xa0522d, 0xdeb887, 0x777777];
export function randomLook(rng) {
  const p = (a) => a[Math.floor(rng() * a.length)];
  return { skin: p(SKINS), top: p(TOPS), pants: p(PANTS), hair: p(HAIR) };
}

// ---------------- Cars ----------------
const CG = {
  body: box(2.0, 0.7, 4.4), cabin: box(1.72, 0.62, 2.2), wheel: (() => { const g = new THREE.CylinderGeometry(0.4, 0.4, 0.32, 10); g.rotateZ(Math.PI / 2); return g; })(),
  light: box(0.42, 0.18, 0.06), bar: box(0.55, 0.18, 0.4), stripe: box(2.04, 0.22, 2.2),
};
const glass = new THREE.MeshLambertMaterial({ color: 0x1e2a36 });
const tyre = new THREE.MeshLambertMaterial({ color: 0x18181a });
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a3a });
export const CAR_COLORS = [0xc0392b, 0x2e86de, 0xf5cd79, 0x10ac84, 0x8e44ad, 0xe67e22, 0xdfe6e9, 0x34495e, 0x6ab04c, 0xff7979];

export function makeCarMesh(color, police) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(CG.body, lambert(police ? 0xf2f2f2 : color)); body.position.y = 0.72; g.add(body);
  const cab = new THREE.Mesh(CG.cabin, police ? lambert(0x1a2a4a) : glass); cab.position.set(0, 1.38, -0.25); g.add(cab);
  if (police) { const st = new THREE.Mesh(CG.stripe, lambert(0x1d3a6e)); st.position.set(0, 0.72, 0.1); g.add(st); }
  for (const [x, z] of [[-0.98, 1.4], [0.98, 1.4], [-0.98, -1.4], [0.98, -1.4]]) {
    const w = new THREE.Mesh(CG.wheel, tyre); w.position.set(x, 0.4, z); g.add(w);
  }
  for (const x of [-0.65, 0.65]) {
    const h = new THREE.Mesh(CG.light, headMat); h.position.set(x, 0.8, 2.21); g.add(h);
    const t = new THREE.Mesh(CG.light, tailMat); t.position.set(x, 0.8, -2.21); g.add(t);
  }
  let bars = null;
  if (police) {
    const red = new THREE.MeshBasicMaterial({ color: 0x551111 }), blue = new THREE.MeshBasicMaterial({ color: 0x112255 });
    const r = new THREE.Mesh(CG.bar, red); r.position.set(-0.3, 1.78, -0.25);
    const b = new THREE.Mesh(CG.bar, blue); b.position.set(0.3, 1.78, -0.25);
    g.add(r, b); bars = { red, blue };
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.bars = bars;
  return g;
}

let carId = 0;
export class Car {
  constructor(scene, { color, police = false, x = 0, z = 0, heading = 0, mode = 'parked' }) {
    this.id = carId++;
    this.police = police;
    this.mesh = makeCarMesh(color, police);
    scene.add(this.mesh);
    this.pos = new THREE.Vector3(x, 0, z);
    this.heading = heading;
    this.speed = 0; this.steer = 0;
    this.mode = mode;          // parked | traffic | player | patrol | chase
    this.maxSpeed = police ? 34 : 30;
    this.radius = 2.3;
    this.wait = 0; this.stuck = 0; this.reverseT = 0; this.ignoreT = 0;
    this.sirenOn = false;
    this.syncMesh();
  }
  get fx() { return Math.sin(this.heading); }
  get fz() { return Math.cos(this.heading); }

  drive(dt, throttle, steer, handbrake, city) {
    let s = this.speed;
    if (throttle > 0) s += (s < -0.5 ? 40 : 16 * (1 - Math.max(0, s) / (this.maxSpeed * 1.05))) * throttle * dt;
    else if (throttle < 0) s += (s > 0.5 ? -38 : -12) * -throttle * dt;
    else s -= Math.sign(s) * Math.min(Math.abs(s), 5 * dt);
    if (handbrake) s -= Math.sign(s) * Math.min(Math.abs(s), 22 * dt);
    this.speed = Math.max(-9, Math.min(this.maxSpeed, s));
    this.steer += (steer - this.steer) * Math.min(1, 8 * dt);
    const turnRate = 2.1 * (1 - Math.min(Math.abs(this.speed) / 70, 0.45));
    const tf = Math.max(-1, Math.min(1, this.speed / 7));
    this.heading = wrapAngle(this.heading + this.steer * turnRate * tf * dt * (handbrake ? 1.45 : 1));
    this.pos.x += this.fx * this.speed * dt;
    this.pos.z += this.fz * this.speed * dt;
    let impact = 0;
    for (const o of [1.25, -1.25]) {
      const c = { x: this.pos.x + this.fx * o, z: this.pos.z + this.fz * o };
      const bx = c.x, bz = c.z;
      if (city.resolveCircle(c, 1.15)) {
        this.pos.x += c.x - bx; this.pos.z += c.z - bz;
        impact = Math.max(impact, Math.abs(this.speed));
      }
    }
    if (impact > 0) this.speed *= impact > 14 ? 0.35 : 0.7;
    return impact;
  }
  syncMesh(t = 0) {
    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.mesh.rotation.y = this.heading;
    const bars = this.mesh.userData.bars;
    if (bars) {
      const on = this.sirenOn, ph = Math.floor(t * 6) % 2;
      bars.red.color.setHex(on && ph ? 0xff2040 : 0x551111);
      bars.blue.color.setHex(on && !ph ? 0x3080ff : 0x112255);
    }
  }
  remove(scene) { scene.remove(this.mesh); }

  // ---------- traffic AI (lane following on the road grid) ----------
  placeOnRoad(rng, avoidX, avoidZ, minDist = 0) {
    for (let k = 0; k < 60; k++) {
      const horiz = rng() < 0.5;
      const line = Math.floor(rng() * (GRID + 1)), seg = Math.floor(rng() * GRID);
      let ni, nj, di, dj;
      if (horiz) { nj = line; ni = seg; di = 1; dj = 0; } else { ni = line; nj = seg; di = 0; dj = 1; }
      if (rng() < 0.5) { ni += di; nj += dj; di = -di; dj = -dj; }
      const [ax, az] = nodePos(ni, nj), t = 0.3 + rng() * 0.4;
      const x = ax + di * 64 * t - dj * LANE, z = az + dj * 64 * t + di * LANE;
      if (Math.hypot(x - avoidX, z - avoidZ) < minDist) continue;
      this.pos.set(x, 0, z);
      this.heading = Math.atan2(di, dj);
      this.route = { ni, nj, di, dj, phase: 'seg' };
      this._setTarget();
      return true;
    }
    return false;
  }
  routeFromHere() {
    // pick the lane direction closest to the current heading at the nearest node
    const [ni, nj] = nearestNode(this.pos.x, this.pos.z);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let best = null, bd = -9;
    for (const [di, dj] of dirs) {
      const bi = ni + di, bj = nj + dj;
      if (bi < 0 || bj < 0 || bi > GRID || bj > GRID) continue;
      const d = di * this.fx + dj * this.fz;
      if (d > bd) { bd = d; best = [di, dj]; }
    }
    this.route = { ni, nj, di: best[0], dj: best[1], phase: 'turn' };
    this._setTarget();
  }
  _setTarget() {
    const r = this.route, off = ROAD / 2 + 2.5;
    const rx = -r.dj * LANE, rz = r.di * LANE; // right-hand lane offset (right = (-fz, fx))
    if (r.phase === 'seg') {
      const [bx, bz] = nodePos(r.ni + r.di, r.nj + r.dj);
      this.tx = bx - r.di * off + rx; this.tz = bz - r.dj * off + rz;
    } else {
      const [ax, az] = nodePos(r.ni, r.nj);
      this.tx = ax + r.di * off + rx; this.tz = az + r.dj * off + rz;
    }
  }
  _advanceRoute(rng) {
    const r = this.route;
    if (r.phase === 'seg') {
      const bi = r.ni + r.di, bj = r.nj + r.dj;
      const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([di, dj]) => {
        if (di === -r.di && dj === -r.dj) return false;
        const ci = bi + di, cj = bj + dj;
        return ci >= 0 && cj >= 0 && ci <= GRID && cj <= GRID;
      });
      const pick = opts.length ? opts[Math.floor(rng() * opts.length)] : [-r.di, -r.dj];
      this.route = { ni: bi, nj: bj, di: pick[0], dj: pick[1], phase: 'turn' };
    } else {
      r.phase = 'seg';
    }
    this._setTarget();
  }
  steerTo(tx, tz) {
    const desired = Math.atan2(tx - this.pos.x, tz - this.pos.z);
    const diff = wrapAngle(desired - this.heading);
    return { steer: Math.max(-1, Math.min(1, diff * 2.6)), diff };
  }
  aiTraffic(dt, game, cruise = 11) {
    if (!this.route) this.routeFromHere();
    if (Math.hypot(this.tx - this.pos.x, this.tz - this.pos.z) < 3.2) this._advanceRoute(game.rng);
    const { steer, diff } = this.steerTo(this.tx, this.tz);
    let target = Math.abs(diff) > 0.35 ? 6 : cruise;
    if (this.ignoreT > 0) this.ignoreT -= dt;
    else if (game.obstacleAhead(this, 11)) target = 0;
    let throttle = this.speed < target ? 1 : (this.speed > target + 1.5 ? -0.6 : 0);
    if (target === 0) {
      this.wait += dt;
      if (this.speed > 0.4) throttle = -1; else { throttle = 0; this.speed = 0; }
      if (this.wait > 4) { this.ignoreT = 1.5; this.wait = 0; }
    } else this.wait = 0;
    this.drive(dt, throttle, steer, false, game.city);
  }

  // ---------- police pursuit ----------
  aiChase(dt, game, tx, tz, careful) {
    const city = game.city;
    const dist = Math.hypot(tx - this.pos.x, tz - this.pos.z);
    let gx = tx, gz = tz;
    if (!(dist < 70 && city.segmentClear(this.pos.x, this.pos.z, tx, tz))) {
      if (!this.nav || Math.hypot(this.nav[0] - this.pos.x, this.nav[1] - this.pos.z) < 7) {
        const [ci, cj] = nearestNode(this.pos.x, this.pos.z), [pi, pj] = nearestNode(tx, tz);
        const [cx, cz] = nodePos(ci, cj);
        if (Math.hypot(cx - this.pos.x, cz - this.pos.z) > 8) this.nav = [cx, cz];
        else {
          const di = Math.sign(pi - ci), dj = Math.sign(pj - cj);
          let ni = ci, nj = cj;
          if (Math.abs(pi - ci) >= Math.abs(pj - cj) && di) ni += di; else if (dj) nj += dj; else if (di) ni += di;
          this.nav = nodePos(ni, nj);
        }
      }
      [gx, gz] = this.nav;
    } else this.nav = null;
    const { steer, diff } = this.steerTo(gx, gz);
    let throttle = 1;
    if (Math.abs(diff) > 1.1 && this.speed > 12) throttle = -0.6;
    if (careful && dist < 12) throttle = this.speed > dist * 0.6 ? -1 : 0.3;
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      this.drive(dt, -1, -Math.sign(steer || 1), false, city);
      return;
    }
    if (Math.abs(this.speed) < 1.5 && throttle > 0) { this.stuck += dt; if (this.stuck > 1.4) { this.stuck = 0; this.reverseT = 1.1; } }
    else this.stuck = 0;
    this.drive(dt, throttle, steer, Math.abs(diff) > 1.5 && this.speed > 10, city);
  }
}

// ---------------- Pedestrians ----------------
export class Ped {
  constructor(scene, rng, bi, bj) {
    this.mesh = makeCharacter(randomLook(rng));
    scene.add(this.mesh);
    this.rng = rng;
    this.setBlock(bi, bj);
    this.s = rng() * this.per;
    this.dir = rng() < 0.5 ? 1 : -1;
    this.speed = 1.2 + rng() * 0.7;
    this.down = 0; this.phase = rng() * 6;
    this.vel = new THREE.Vector3();
    this.flee = 0;
  }
  setBlock(bi, bj) {
    const b = blockBounds(bi, bj);
    this.r = { x0: b.x0 + 2, x1: b.x1 - 2, z0: b.z0 + 2, z1: b.z1 - 2 };
    this.side = this.r.x1 - this.r.x0; this.per = this.side * 4;
  }
  pointAt(s) {
    const r = this.r, L = this.side; s = ((s % this.per) + this.per) % this.per;
    if (s < L) return [r.x0 + s, r.z0];
    if (s < 2 * L) return [r.x1, r.z0 + s - L];
    if (s < 3 * L) return [r.x1 - (s - 2 * L), r.z1];
    return [r.x0, r.z1 - (s - 3 * L)];
  }
  update(dt) {
    const m = this.mesh;
    if (this.down > 0) {
      this.down -= dt;
      m.position.addScaledVector(this.vel, dt);
      this.vel.multiplyScalar(Math.max(0, 1 - 3 * dt));
      m.rotation.x = Math.min(Math.PI / 2, m.rotation.x + dt * 8);
      if (this.down <= 0) {
        m.rotation.x = 0;
        this.setBlock(Math.floor(this.rng() * GRID), Math.floor(this.rng() * GRID));
        this.s = this.rng() * this.per;
      }
      return;
    }
    const sp = this.speed * (this.flee > 0 ? 3 : 1);
    if (this.flee > 0) this.flee -= dt;
    this.s += this.dir * sp * dt;
    const [x, z] = this.pointAt(this.s), [x2, z2] = this.pointAt(this.s + this.dir * 0.5);
    m.position.set(x, 0, z);
    m.rotation.y = Math.atan2(x2 - x, z2 - z);
    this.phase += dt * sp * 4;
    animateCharacter(m, this.phase, 0.6);
  }
  knock(vx, vz) {
    this.down = 12;
    this.vel.set(vx, 0, vz);
  }
}
