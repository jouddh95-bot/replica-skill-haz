// Heat, wanted level, Precinct 9 cruisers.
import { Car } from './actors.js';
import { HIDEOUT, PRECINCT_POINT } from './city.js';

export class Police {
  constructor(game) {
    this.game = game;
    this.cops = [];
    this.wanted = 0;
    this.suspicion = 0;
    this.evade = 0;
    this.bust = 0;
    this.lastSeen = null;
    this.spawnT = 0;
  }
  get heat() { return this.game.eco.s.heat; }
  set heat(v) { this.game.eco.s.heat = Math.max(0, Math.min(100, v)); }

  patrolTarget() { return Math.min(7, 3 + Math.floor(this.heat / 22)); }
  chaseTarget() { return Math.min(7, 1 + this.wanted * 2); }
  evadeNeeded() { return 7 + this.wanted * 3; }

  sees(cop, x, z, range) {
    const d = Math.hypot(cop.pos.x - x, cop.pos.z - z);
    if (d > range) return false;
    return d < 10 || this.game.city.segmentClear(cop.pos.x, cop.pos.z, x, z);
  }

  // A crime at (x,z): add heat; any cop who can see it starts a chase.
  crime(heat, x, z, range = 32, kind = '') {
    this.heat += heat;
    for (const c of this.cops) {
      if (this.sees(c, x, z, range)) { this.setWanted(Math.max(this.wanted, this.levelFromHeat()), kind); return true; }
    }
    return false;
  }
  levelFromHeat() { return 1 + (this.heat > 55 ? 1 : 0) + (this.heat > 82 ? 1 : 0); }
  setWanted(n, kind) {
    if (n > this.wanted) {
      if (this.wanted === 0) this.game.toast(kind === 'deal' ? 'A cruiser saw the hand-off. Run!' : 'Precinct 9 is on you. Lose them!', 'bad');
      this.wanted = Math.min(3, n);
      this.evade = 0;
      const p = this.game.playerPos(); this.lastSeen = [p.x, p.z];
    }
  }

  spawnCop(mode, minDist) {
    const p = this.game.playerPos();
    const car = new Car(this.game.scene, { color: 0xffffff, police: true, mode });
    car.isCop = true;
    if (!car.placeOnRoad(this.game.rng, p.x, p.z, minDist)) car.placeOnRoad(this.game.rng, PRECINCT_POINT[0], PRECINCT_POINT[1], 0);
    this.cops.push(car);
    this.game.cars.push(car);
    return car;
  }
  removeCop(c) {
    c.remove(this.game.scene);
    this.cops = this.cops.filter((x) => x !== c);
    this.game.cars = this.game.cars.filter((x) => x !== c);
  }

  update(dt, t) {
    const g = this.game, p = g.playerPos(), inYard = g.eco.inYard(p.x, p.z);
    // population
    const want = this.wanted ? this.chaseTarget() + 2 : this.patrolTarget();
    this.spawnT -= dt;
    if (this.cops.length < want && this.spawnT <= 0) { this.spawnCop(this.wanted ? 'chase' : 'patrol', this.wanted ? 80 : 110); this.spawnT = this.wanted ? 2.5 : 6; }
    if (this.cops.length > want) {
      const far = this.cops.find((c) => Math.hypot(c.pos.x - p.x, c.pos.z - p.z) > 160);
      if (far) this.removeCop(far);
    }

    // AI and sight
    let seen = false, nearest = 1e9;
    const chasing = this.wanted > 0;
    let chasers = 0;
    for (const c of this.cops) {
      const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
      nearest = Math.min(nearest, d);
      if (c.deployed) {
        c.drive(dt, 0, 0, true, g.city); c.syncMesh(t);
        if (this.sees(c, p.x, p.z, chasing ? 75 : 22)) seen = true;
        continue;
      }
      if (chasing && chasers < this.chaseTarget() && d < 260) {
        chasers++;
        c.mode = 'chase'; c.sirenOn = true;
        const tgt = this.lastSeen && !this._seenNow ? this.lastSeen : [p.x, p.z];
        c.aiChase(dt, g, tgt[0], tgt[1], !g.player.car);
      } else {
        if (c.mode === 'chase') { c.mode = 'patrol'; c.route = null; c.sirenOn = false; }
        c.aiTraffic(dt, g, 12);
      }
      if (this.sees(c, p.x, p.z, chasing ? 75 : 22)) { seen = true; }
      c.syncMesh(t);
    }
    this._seenNow = seen;

    if (!chasing) {
      // suspicion builds when a hot player is in view
      if (seen && this.heat >= 40 && !inYard) {
        this.suspicion += dt;
        if (this.suspicion > 2.2) this.setWanted(this.levelFromHeat(), 'spotted');
      } else this.suspicion = Math.max(0, this.suspicion - dt);
      this.heat -= dt * (inYard ? 1.6 : 0.3);
      this.bust = 0;
    } else {
      if (seen) { this.evade = 0; this.lastSeen = [p.x, p.z]; this.heat += dt * 0.6; this.wanted = Math.max(this.wanted, this.levelFromHeat()); }
      else this.evade += dt * (inYard ? 3 : 1);
      if (this.evade >= this.evadeNeeded()) {
        this.wanted = 0; this.evade = 0; this.suspicion = 0;
        this.heat = Math.max(15, this.heat - 15);
        for (const c of this.cops) c.sirenOn = false;
        g.toast('You lost them. Lie low for a while.', 'cash');
      }
      // bust check
      nearest = Math.min(nearest + 0, g.nearestOfficer() + 3.5);
      for (const n of g.npcs) if (n.kind === 'cop' && !n.dead && n.state !== 'walk' && g.city.segmentClear(n.h.pos.x, n.h.pos.z, p.x, p.z) && Math.hypot(n.h.pos.x - p.x, n.h.pos.z - p.z) < 45) { seen = true; this.evade = 0; this.lastSeen = [p.x, p.z]; break; }
      const pSpeed = g.player.car ? Math.abs(g.player.car.speed) : g.player.speedNow;
      if (nearest < 6 && pSpeed < 4 && !(inYard && !seen) && !g.player.human.dead) this.bust += dt;
      else this.bust = Math.max(0, this.bust - dt * 0.6);
      if (this.bust > 2.4) { this.bust = 0; g.busted(); }
    }
  }

  clearAll() {
    this.wanted = 0; this.evade = 0; this.bust = 0; this.suspicion = 0; this.lastSeen = null;
    for (const c of [...this.cops]) this.removeCop(c);
    this.game.removeOfficers?.();
  }
}
