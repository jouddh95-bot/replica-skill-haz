// Civilians, Brine Rats gang members and Precinct 9 officers on foot.
import * as THREE from 'three';
import { GRID, blockBounds, mulberry32 } from './city.js';
import { Human } from './characters.js';
import { castRay, WEAPONS } from './combat.js';
import { wrapAngle } from './actors.js';

const CIV_TINTS = [0xffffff, 0xd9c7a8, 0xa8c4d9, 0xc9a8d9, 0xb5d9a8, 0xd9a8a8, 0x9a9a9a, 0xe6d27a];
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3();

export class Npc {
  constructor(game, kind, opt = {}) {
    this.game = game; this.kind = kind;
    const rng = game.rng;
    const tint = kind === 'cop' ? 0x3a4f8c : kind === 'gang' ? 0x9c2f2f : CIV_TINTS[Math.floor(rng() * CIV_TINTS.length)];
    this.h = new Human(game.scene, { tint, hp: kind === 'cop' ? 90 : kind === 'gang' ? 70 : 45 });
    this.weapon = opt.weapon || null;
    this.brave = kind !== 'civ' || rng() < 0.25;
    this.state = 'walk';
    this.t = 0; this.fireCool = 1 + rng(); this.fleeT = 0; this.angry = 0;
    this.speed = 1.2 + rng() * 0.6;
    this.home = opt.home || null;
    if (opt.home) { this.h.pos.set(opt.home[0], 0, opt.home[1]); this.state = 'idle'; }
    else if (opt.at) { this.h.pos.set(opt.at[0], 0, opt.at[1]); }
    else this.setBlock(Math.floor(rng() * GRID), Math.floor(rng() * GRID), true);
    if (this.weapon) { this.gun = game.makeNpcWeapon(this.weapon); }
  }
  setBlock(bi, bj, place) {
    const b = blockBounds(bi, bj);
    this.r = { x0: b.x0 + 2, x1: b.x1 - 2, z0: b.z0 + 2, z1: b.z1 - 2 };
    this.side = this.r.x1 - this.r.x0; this.per = this.side * 4;
    this.dir = this.game.rng() < 0.5 ? 1 : -1;
    if (place) { this.s = this.game.rng() * this.per; const [x, z] = this.pointAt(this.s); this.h.pos.set(x, 0, z); }
  }
  pointAt(s) {
    const r = this.r, L = this.side; s = ((s % this.per) + this.per) % this.per;
    if (s < L) return [r.x0 + s, r.z0];
    if (s < 2 * L) return [r.x1, r.z0 + s - L];
    if (s < 3 * L) return [r.x1 - (s - 2 * L), r.z1];
    return [r.x0, r.z1 - (s - 3 * L)];
  }
  nearestS(x, z) {
    const r = this.r, L = this.side;
    const cands = [
      [Math.max(0, Math.min(L, x - r.x0)), Math.hypot(0, z - r.z0)],
      [L + Math.max(0, Math.min(L, z - r.z0)), Math.abs(x - r.x1)],
      [2 * L + Math.max(0, Math.min(L, r.x1 - x)), Math.abs(z - r.z1)],
      [3 * L + Math.max(0, Math.min(L, r.z1 - z)), Math.abs(x - r.x0)],
    ];
    cands.sort((a, b) => a[1] - b[1]);
    return cands[0][0];
  }
  get dead() { return this.h.dead; }

  scare(x, z, t = 8) {
    if (this.dead) return;
    if (this.kind === 'civ' && !(this.brave && this.angry > 0)) { this.state = 'flee'; this.fleeT = t; this.threat = [x, z]; }
  }
  provoke(t = 25) { if (this.dead) return; this.angry = t; this.state = this.weapon ? 'shoot' : 'fight'; }

  damage(n, fromPlayer, dx = 0, dz = 0, head = false) {
    if (this.dead) return;
    const g = this.game, p = this.h.pos;
    this.h.hp -= n * (head ? 2.5 : 1);
    this.h.hurt();
    g.fx.blood(_t.set(p.x, head ? 1.6 : 1.1, p.z));
    if (this.h.hp <= 0) {
      this.h.die(dx, dz);
      this.state = 'dead';
      if (this.gun) this.gun.visible = false;
      if (fromPlayer) g.onNpcKilled(this);
      return;
    }
    if (fromPlayer) {
      if (this.brave) this.provoke();
      else this.scare(g.player.pos.x, g.player.pos.z, 12);
    }
  }

  update(dt) {
    const g = this.game, h = this.h, p = h.pos, pl = g.player;
    if (this.dead) {
      h.update(dt, 0);
      if (h.deadT > (this.kind === 'civ' ? 25 : 40)) this.respawn = true;
      return;
    }
    const tgt = pl.car ? pl.car.pos : pl.pos;
    const dx = tgt.x - p.x, dz = tgt.z - p.z, dist = Math.hypot(dx, dz);
    let move = 0, face = null;
    this.angry = Math.max(0, this.angry - dt);
    if (pl.human.dead && this.state !== 'walk' && this.state !== 'idle') { this.state = this.home ? 'idle' : 'walk'; this.angry = 0; }

    if (this.state === 'walk') {
      this.s += this.dir * this.speed * dt;
      const [x, z] = this.pointAt(this.s), [x2, z2] = this.pointAt(this.s + this.dir);
      p.set(x, 0, z); face = Math.atan2(x2 - x, z2 - z); move = this.speed;
    } else if (this.state === 'idle') {
      // gang members loiter around their corner and watch the player
      if (this.home) {
        const hx = this.home[0] - p.x, hz = this.home[1] - p.z;
        if (Math.hypot(hx, hz) > 1.5) { const k = 1.4 / Math.hypot(hx, hz); p.x += hx * k * dt; p.z += hz * k * dt; move = 1.4; face = Math.atan2(hx, hz); }
        else if (dist < 18) face = Math.atan2(dx, dz);
        if (this.kind === 'gang' && dist < 7 && !pl.car && !pl.human.dead) { this.provoke(); g.toast('Brine Rats: "Wrong corner, friend."', 'bad'); }
      }
    } else if (this.state === 'flee') {
      this.fleeT -= dt;
      const [tx, tz] = this.threat;
      let ax = p.x - tx, az = p.z - tz; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l;
      p.x += ax * 5.6 * dt; p.z += az * 5.6 * dt; move = 5.6; face = Math.atan2(ax, az);
      if (this.fleeT <= 0) {
        if (this.home) this.state = 'idle';
        else {
          // walk the nearest block's sidewalk again
          const bi = Math.max(0, Math.min(GRID - 1, Math.floor((p.x + 256) / 64))), bj = Math.max(0, Math.min(GRID - 1, Math.floor((p.z + 256) / 64)));
          this.setBlock(bi, bj, false); this.s = this.nearestS(p.x, p.z); this.state = 'walk';
        }
      }
    } else if (this.state === 'fight') {
      face = Math.atan2(dx, dz);
      if (this.angry <= 0 || dist > 40) this.state = this.home ? 'idle' : 'flee', this.fleeT = 3, this.threat = [tgt.x, tgt.z];
      else if (dist > 1.4) { const sp = 5; p.x += (dx / dist) * sp * dt; p.z += (dz / dist) * sp * dt; move = sp; }
      else if (h.punch()) g.npcMelee(this, 9);
    } else if (this.state === 'shoot' || this.state === 'arrest') {
      face = Math.atan2(dx, dz);
      const los = dist < 45 && g.city.segmentClear(p.x, p.z, tgt.x, tgt.z);
      const keep = this.state === 'arrest' ? 1.6 : 9;
      if (!los || dist > keep + 6) { const sp = dist > 20 ? 5.8 : 3.5; p.x += (dx / dist) * sp * dt; p.z += (dz / dist) * sp * dt; move = sp; }
      else if (dist < keep - 3 && this.state === 'shoot') { p.x -= (dx / dist) * 2 * dt; p.z -= (dz / dist) * 2 * dt; move = 2; }
      if (this.state === 'shoot' && los && dist < 40) {
        this.fireCool -= dt;
        if (this.fireCool <= 0) { this.fireCool = this.kind === 'cop' ? 0.7 + g.rng() * 0.6 : 0.9 + g.rng() * 0.8; this.shoot(tgt, dist); }
      }
      if (this.kind === 'gang' && this.angry <= 0) this.state = 'idle';
    }
    if (move > 0 && this.state !== 'walk') {
      const c = { x: p.x, z: p.z }; g.city.resolveCircle(c, 0.4); p.x = c.x; p.z = c.z;
    }
    if (face !== null) h.heading += wrapAngle(face - h.heading) * Math.min(1, dt * 10);
    const aiming = (this.state === 'shoot') && this.weapon && this.weapon !== 'bat';
    h.aim = aiming ? { pitch: Math.atan2(1.2 - 1.45, Math.max(1, dist)), twoHand: this.weapon !== 'pistol' } : null;
    h.update(dt, move);
    if (this.gun) {
      h.handPos(this.gun.position);
      const yaw = h.heading, pitch = aiming ? 0 : -1.1;
      this.gun.lookAt(_t.set(this.gun.position.x + Math.sin(yaw) * Math.cos(pitch), this.gun.position.y + Math.sin(pitch), this.gun.position.z + Math.cos(yaw) * Math.cos(pitch)));
    }
  }

  shoot(tgt, dist) {
    const g = this.game, h = this.h, w = WEAPONS[this.weapon] || WEAPONS.pistol;
    h.handPos(_o);
    const pl = g.player;
    const movingFast = pl.car ? Math.abs(pl.car.speed) > 8 : pl.speedNow > 6;
    const acc = (this.kind === 'cop' ? 0.55 : 0.4) * (movingFast ? 0.55 : 1) * Math.max(0.25, 1 - dist / 45);
    const hit = g.rng() < acc;
    const aimY = pl.car ? 1.0 : 1.2;
    _d.set(tgt.x - _o.x, aimY - _o.y, tgt.z - _o.z).normalize();
    if (!hit) { _d.x += (g.rng() - 0.5) * 0.12; _d.y += (g.rng() - 0.3) * 0.08; _d.z += (g.rng() - 0.5) * 0.12; _d.normalize(); }
    g.fx.muzzle(_o, 0.8);
    g.audio.gun(0.7, Math.min(1, 25 / Math.max(5, dist)));
    const r = hit ? { point: _t.set(tgt.x, aimY, tgt.z).clone() } : castRay(g, _o, _d, 60, h);
    g.fx.tracer(_o, r.point);
    if (hit) {
      if (pl.car) { pl.car.hp -= 4; g.fx.sparks(r.point, 4); }
      else g.damagePlayer(w.dmg * 0.45, this);
    } else if (r.human && r.human !== pl.human) {
      const n = g.npcOf(r.human); if (n) n.damage(10, false);
    } else if (r.wall || r.ground) g.fx.sparks(r.point, 4);
  }
}

// gang corners: fixed, seeded spots in the Docks and Vesper Heights
export function gangCorners(city) {
  const rng = mulberry32(777);
  return [city.randomSidewalkPoint(rng, 2), city.randomSidewalkPoint(rng, 3), city.randomSidewalkPoint(rng, 2)];
}
