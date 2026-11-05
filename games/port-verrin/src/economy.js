// The underground business: growing, packing, orders, runners, turf, saves.
import * as THREE from 'three';
import { DISTRICTS, HIDEOUT, SHOP_POINT, PAWN_POINT, districtAt, mulberry32 } from './city.js';
import { WEAPONS } from './combat.js';
import { randomLook } from './actors.js';
import { Human } from './characters.js';

const SAVE_KEY = 'port-verrin-save-v1';
export const GROW_TIME = 45;
export const FERT_GROW_TIME = 28;
export const BASE_PRICE = 48;

export const SHOP_ITEMS = [
  { id: 'spores', name: 'Glowcap spores x5', desc: 'One tray takes one spore pack.', price: 50, give: (s) => { s.spores += 5; } },
  { id: 'tins', name: 'Empty tins x10', desc: 'Each Lumen tin holds one harvested cap.', price: 30, give: (s) => { s.tins += 10; } },
  { id: 'fert', name: 'Bog-mix fertilizer x5', desc: 'Faster growth and one extra cap per tray.', price: 70, give: (s) => { s.fert += 5; } },
  { id: 'tray', name: 'Extra grow tray', desc: 'Adds a tray to your yard (max 8).', price: 350, can: (s) => s.trays.length < 8, give: (s) => { s.trays.push({ stage: 'empty', t: 0, fert: false }); } },
  { id: 'bench', name: 'Bench upgrade', desc: 'Packs twice as fast, 10 per batch.', price: 600, can: (s) => s.benchLevel < 2, give: (s) => { s.benchLevel = 2; } },
];

const gun = (id) => ({ id, name: WEAPONS[id].name, desc: id === 'bat' ? 'Aluminium. Hits hard, never runs dry.' : `Comes with a full magazine of ${WEAPONS[id].mag}.`, price: WEAPONS[id].price,
  can: (s) => !s.weapons[id], give: (s) => { s.weapons[id] = true; if (WEAPONS[id].mag) s.clip[id] = WEAPONS[id].mag; s.weapon = id; } });
const ammo = (id) => ({ id: id + '-ammo', name: `${WEAPONS[id].name} ammo x${WEAPONS[id].ammoPack}`, desc: 'Reload with R.', price: WEAPONS[id].ammoPrice,
  can: (s) => !!s.weapons[id], give: (s) => { s.ammo[id] = (s.ammo[id] || 0) + WEAPONS[id].ammoPack; } });
export const PAWN_ITEMS = [
  gun('bat'), gun('pistol'), ammo('pistol'), gun('shotgun'), ammo('shotgun'), gun('smg'), ammo('smg'),
  { id: 'armor', name: 'Body armour', desc: 'Soaks up 50 damage before your health.', price: 300, can: (s) => s.armor < 50, give: (s) => { s.armor = 50; } },
  { id: 'med', name: 'Field medkit', desc: 'Back to full health right now.', price: 120, can: (s) => s.health < 100, give: (s) => { s.health = 100; } },
];

const FIRST = ['Mags', 'Tobin', 'Ines', 'Rook', 'Dell', 'Priya', 'Oskar', 'June', 'Fitz', 'Wren', 'Caspian', 'Lula', 'Benno', 'Sable', 'Arlo', 'Nadia', 'Quill', 'Hester'];
const LAST = ['Vane', 'Okafor', 'Marsh', 'Calder', 'Ruiz', 'Petrov', 'Hale', 'Moreau', 'Lindqvist', 'Bello', 'Strand', 'Kaur'];

function freshState() {
  return {
    money: 300, spores: 2, tins: 8, raw: 0, product: 0, fert: 0,
    trays: [0, 1, 2, 3].map(() => ({ stage: 'empty', t: 0, fert: false })),
    bench: { busy: false, t: 0, qty: 0 }, benchLevel: 1,
    control: [0, 0, 0, 0],
    dealers: DISTRICTS.map(() => ({ hired: false, stock: 0, cash: 0, t: 0 })),
    earned: 0, sales: 0, heat: 0, time: 0.36, day: 1, goal: 0, won: false,
    weapons: {}, ammo: {}, clip: {}, weapon: 'fists', health: 100, armor: 0,
  };
}

export class Economy {
  constructor(game) {
    this.game = game;
    this.s = freshState();
    this.orders = [];
    this.orderTimer = 8;
    this.rng = mulberry32(Date.now() & 0xffff);
    const crng = mulberry32(99);
    this.customers = [];
    for (let i = 0; i < 18; i++) {
      const d = i % 4;
      const [x, z] = game.city.randomSidewalkPoint(crng, d);
      this.customers.push({ name: FIRST[i] + ' ' + LAST[i % LAST.length], d, x, z, look: randomLook(crng), busy: false });
    }
    const drng = mulberry32(4242);
    this.dealerSpots = DISTRICTS.map((_, d) => game.city.randomSidewalkPoint(drng, d));
    this.dealerNames = ['Kit "Rivets" Calder', 'Mo Sandoval', 'Pip Ashgrove', 'Lenny Two-Coats'];
    this._buildYard();
    this._buildDealers();
  }

  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      this.s = Object.assign(freshState(), data);
      if (this.s.health <= 0) this.s.health = 100;
      this.s.bench = { busy: false, t: 0, qty: 0 };
      this._syncTrayMeshes();
      return true;
    } catch { return false; }
  }
  save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.s)); } catch { /* storage unavailable */ } }
  reset() { this.s = freshState(); this.orders = []; this._syncTrayMeshes(); try { localStorage.removeItem(SAVE_KEY); } catch { } }

  // ---------- yard visuals ----------
  _buildYard() {
    const scene = this.game.scene;
    this.trayMeshes = [];
    const wood = new THREE.MeshLambertMaterial({ color: 0x6b4a32 }), soil = new THREE.MeshLambertMaterial({ color: 0x2b1d14 });
    this.capMat = new THREE.MeshLambertMaterial({ color: 0x9ffaff, emissive: 0x4ff0ff, emissiveIntensity: 1.2 });
    const stemMat = new THREE.MeshLambertMaterial({ color: 0xe8f6f2, emissive: 0x2a6060, emissiveIntensity: 0.3 });
    const stemG = new THREE.CylinderGeometry(0.06, 0.09, 0.45, 6); stemG.translate(0, 0.22, 0);
    const capG = new THREE.SphereGeometry(0.22, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2); capG.translate(0, 0.42, 0);
    HIDEOUT.trays.forEach(([x, z], i) => {
      const g = new THREE.Group();
      const frame = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.7, 1.8), wood); frame.position.y = 0.55; g.add(frame);
      const top = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.08, 1.5), soil); top.position.y = 0.92; g.add(top);
      for (const [lx, lz] of [[-1.5, -0.7], [1.5, -0.7], [-1.5, 0.7], [1.5, 0.7]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 0.15), wood); leg.position.set(lx, 0.1, lz); g.add(leg);
      }
      const caps = new THREE.Group(); caps.position.y = 0.95;
      for (let k = 0; k < 7; k++) {
        const m = new THREE.Group();
        m.add(new THREE.Mesh(stemG, stemMat), new THREE.Mesh(capG, this.capMat));
        m.position.set(-1.25 + (k % 4) * 0.83 + (k > 3 ? 0.4 : 0), 0, k > 3 ? 0.35 : -0.35);
        m.rotation.y = k;
        caps.add(m);
      }
      g.add(caps);
      g.position.set(x, 0, z); g.rotation.y = Math.PI / 2;
      scene.add(g);
      this.trayMeshes.push({ g, caps });
    });
    // bench
    const bench = new THREE.Group();
    const tbl = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 1.6), wood); tbl.position.y = 1.0; bench.add(tbl);
    for (const [lx, lz] of [[-1.8, -0.6], [1.8, -0.6], [-1.8, 0.6], [1.8, 0.6]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1, 0.15), wood); leg.position.set(lx, 0.5, lz); bench.add(leg);
    }
    const tinMat = new THREE.MeshLambertMaterial({ color: 0xb8c4cc, emissive: 0x112233 });
    for (let k = 0; k < 5; k++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 10), tinMat);
      t.position.set(-1.2 + k * 0.55, 1.18, 0.1); bench.add(t);
    }
    const lamp = new THREE.PointLight(0x9ff7ff, 6, 14, 1.6); lamp.position.set(0, 3, 0); bench.add(lamp);
    bench.position.set(HIDEOUT.bench[0], 0, HIDEOUT.bench[1]);
    scene.add(bench);
    this._syncTrayMeshes();
  }
  _syncTrayMeshes() {
    if (!this.trayMeshes) return;
    this.trayMeshes.forEach((tm, i) => {
      const tray = this.s.trays[i];
      tm.g.visible = !!tray;
      if (!tray) return;
      const growT = tray.fert ? FERT_GROW_TIME : GROW_TIME;
      const k = tray.stage === 'empty' ? 0 : tray.stage === 'ready' ? 1 : Math.min(1, tray.t / growT);
      tm.caps.visible = k > 0.02;
      tm.caps.scale.setScalar(0.2 + k * 1.1);
    });
  }

  _buildDealers() {
    this.dealerMeshes = this.dealerSpots.map(([x, z], d) => {
      const m = new Human(this.game.scene, { tint: [0x5a7a5a, 0x7a5a8a, 0x8a7a4a, 0x4a6a8a][d] });
      m.pos.set(x, 0, z); m.group.visible = false;
      return m;
    });
  }

  // ---------- tick ----------
  update(dt) {
    const s = this.s;
    for (const tray of s.trays) {
      if (tray.stage !== 'growing') continue;
      tray.t += dt;
      if (tray.t >= (tray.fert ? FERT_GROW_TIME : GROW_TIME)) { tray.stage = 'ready'; this.game.toast('A grow tray at the yard is glowing. Ready to harvest.', 'cash'); }
    }
    if (s.bench.busy) {
      s.bench.t -= dt;
      if (s.bench.t <= 0) {
        s.product += s.bench.qty; s.bench.busy = false;
        this.game.toast(`Packed ${s.bench.qty} Lumen tin${s.bench.qty > 1 ? 's' : ''}.`, 'cash');
        this.game.audio.blip(880);
      }
    }
    this._syncTrayMeshes();
    this.capMat.emissiveIntensity = 1.0 + Math.sin(performance.now() / 300) * 0.35;

    // orders
    this.orderTimer -= dt;
    if (this.orderTimer <= 0) {
      this.orderTimer = 18 + this.rng() * 16;
      if (this.orders.length < 3) this._newOrder();
    }
    for (const o of this.orders) o.left -= dt;
    const expired = this.orders.filter((o) => o.left <= 0);
    for (const o of expired) { o.c.busy = false; this.game.toast(`${o.c.name} stopped waiting.`, 'bad'); this.game.removeMarker(o.marker); o.npc.remove(); }
    this.orders = this.orders.filter((o) => o.left > 0);
    const pl = this.game.playerPos();
    for (const o of this.orders) { o.npc.heading = Math.atan2(pl.x - o.c.x, pl.z - o.c.z); o.npc.update(dt, 0); }
    for (const m of this.dealerMeshes) if (m.group.visible) { m.heading = Math.atan2(pl.x - m.pos.x, pl.z - m.pos.z); m.update(dt, 0); }

    // dealers
    s.dealers.forEach((dl, d) => {
      this.dealerMeshes[d].group.visible = dl.hired;
      if (!dl.hired || dl.stock <= 0) return;
      dl.t += dt;
      if (dl.t >= 16) {
        dl.t = 0; dl.stock--; dl.cash += Math.round(this.unitPrice(d) * 0.75);
        s.control[d] = Math.min(100, s.control[d] + 1);
        s.heat = Math.min(100, s.heat + 0.8);
      }
    });
    this._checkGoals();
  }

  unitPrice(d) { return Math.round(BASE_PRICE * DISTRICTS[d].mult * (1 + this.s.control[d] / 200)); }

  _newOrder() {
    const free = this.customers.filter((c) => !c.busy);
    if (!free.length) return;
    // early game: favour the docks and Old Kiln
    const early = this.s.sales < 3;
    const pool = early ? free.filter((c) => c.d === 1 || c.d === 2) : free;
    const c = (pool.length ? pool : free)[Math.floor(this.rng() * (pool.length ? pool : free).length)];
    c.busy = true;
    const qty = 1 + Math.floor(this.rng() * (early ? 2 : 4));
    const npc = new Human(this.game.scene, { tint: [0xd9c7a8, 0xa8c4d9, 0xc9a8d9, 0xb5d9a8][c.d] });
    npc.pos.set(c.x, 0, c.z);
    const marker = this.game.addMarker(c.x, c.z, 0xc792ff);
    const o = { c, qty, price: this.unitPrice(c.d), left: 170, npc, marker };
    this.orders.push(o);
    this.game.toast(`Phone: ${c.name} in ${DISTRICTS[c.d].name} wants ${qty} tin${qty > 1 ? 's' : ''} ($${o.price} each).`, 'phone');
    this.game.audio.phone();
  }

  // ---------- interactions ----------
  interactables() {
    const s = this.s, out = [];
    s.trays.forEach((tray, i) => {
      const [x, z] = HIDEOUT.trays[i];
      out.push({
        x, z, r: 2.6,
        label: () => {
          if (tray.stage === 'empty') return s.spores > 0 ? `Plant spores${s.fert > 0 ? ' + fertilizer' : ''} (${s.spores} packs)` : 'Tray empty. Buy spores at Fern & Spore';
          if (tray.stage === 'growing') { const T = tray.fert ? FERT_GROW_TIME : GROW_TIME; return `Growing... ${Math.ceil(T - tray.t)}s`; }
          return 'Harvest glowcaps';
        },
        action: () => {
          if (tray.stage === 'empty' && s.spores > 0) {
            s.spores--; tray.stage = 'growing'; tray.t = 0; tray.fert = s.fert > 0; if (tray.fert) s.fert--;
            this.game.audio.blip(520);
          } else if (tray.stage === 'ready') {
            const n = 3 + (tray.fert ? 1 : 0) + Math.floor(this.rng() * 2);
            s.raw += n; tray.stage = 'empty'; tray.t = 0;
            this.game.toast(`Harvested ${n} glowcaps.`, 'cash'); this.game.audio.blip(660);
          }
        },
      });
    });
    out.push({
      x: HIDEOUT.bench[0], z: HIDEOUT.bench[1], r: 2.8,
      label: () => {
        if (s.bench.busy) return `Packing ${s.bench.qty}... ${Math.ceil(s.bench.t)}s`;
        if (s.raw <= 0) return 'Workbench: no caps to pack';
        if (s.tins <= 0) return 'Workbench: out of empty tins';
        return `Pack caps into tins (${Math.min(s.raw, s.tins, s.benchLevel > 1 ? 10 : 5)})`;
      },
      action: () => {
        if (s.bench.busy || s.raw <= 0 || s.tins <= 0) return;
        const q = Math.min(s.raw, s.tins, s.benchLevel > 1 ? 10 : 5);
        s.raw -= q; s.tins -= q;
        s.bench = { busy: true, t: (s.benchLevel > 1 ? 1 : 2) * q, qty: q };
        this.game.audio.blip(440);
      },
    });
    out.push({ x: SHOP_POINT[0], z: SHOP_POINT[1], r: 3.5, label: () => 'Shop at Fern & Spore', action: () => this.game.hud.openShop('garden') });
    out.push({ x: PAWN_POINT[0], z: PAWN_POINT[1], r: 3.5, label: () => "Browse Marlow's Pawn (weapons)", action: () => this.game.hud.openShop('pawn') });
    for (const o of this.orders) {
      out.push({
        x: o.c.x, z: o.c.z, r: 2.6,
        label: () => s.product >= o.qty ? `Hand ${o.qty} tin${o.qty > 1 ? 's' : ''} to ${o.c.name} for $${o.qty * o.price}` : `${o.c.name} wants ${o.qty}. You have ${s.product}`,
        action: () => this.sell(o),
      });
    }
    s.dealers.forEach((dl, d) => {
      const [x, z] = this.dealerSpots[d];
      if (!dl.hired && s.control[d] < 20) return;
      out.push({
        x, z, r: 2.6,
        label: () => {
          if (!dl.hired) return `Hire ${this.dealerNames[d]} as your ${DISTRICTS[d].name} runner ($600)`;
          const give = Math.min(s.product, 15 - dl.stock);
          return `${this.dealerNames[d]}: collect $${dl.cash}${give > 0 ? `, hand over ${give} tins` : ''} (stock ${dl.stock}/15)`;
        },
        action: () => {
          if (!dl.hired) {
            if (s.money < 600) { this.game.toast('You need $600 to bring on a runner.', 'bad'); return; }
            s.money -= 600; dl.hired = true; this.game.toast(`${this.dealerNames[d]} now works ${DISTRICTS[d].name}. Keep them stocked.`, 'cash');
            this.save(); return;
          }
          const give = Math.min(s.product, 15 - dl.stock);
          s.product -= give; dl.stock += give;
          if (dl.cash > 0) { s.money += dl.cash; s.earned += dl.cash; this.game.audio.cash(); this.game.toast(`Collected $${dl.cash} from ${this.dealerNames[d]}.`, 'cash'); dl.cash = 0; }
          this.save();
        },
      });
    });
    return out;
  }

  sell(o) {
    const s = this.s;
    if (s.product < o.qty) { this.game.toast(`You need ${o.qty} packed tins. Pack more at the yard workbench.`, 'bad'); return; }
    const total = o.qty * o.price;
    s.product -= o.qty; s.money += total; s.earned += total; s.sales++;
    const d = o.c.d;
    s.control[d] = Math.min(100, s.control[d] + 3 + o.qty);
    this.game.police.crime(4 + o.qty * 2 * (d === 0 ? 1.5 : 1), o.c.x, o.c.z, 30, 'deal');
    this.game.audio.cash();
    this.game.toast(`+$${total} from ${o.c.name}. ${DISTRICTS[d].name} turf ${Math.round(s.control[d])}%`, 'cash');
    if (s.control[d] >= 20 && !s.dealers[d].hired && s.control[d] - 3 - o.qty < 20) this.game.toast(`A runner in ${DISTRICTS[d].name} wants in. Find them on your map.`, 'phone');
    o.c.busy = false;
    this.game.removeMarker(o.marker);
    const npc = o.npc;
    setTimeout(() => npc.remove(), 4000);
    this.orders = this.orders.filter((x) => x !== o);
    this.save();
  }

  buy(item) {
    const s = this.s;
    if (s.money < item.price || (item.can && !item.can(s))) return false;
    s.money -= item.price; item.give(s); this.game.audio.blip(700); this.save();
    return true;
  }

  // ---------- goals ----------
  static GOALS = [
    ['Plant your 2 spore packs in the grow trays at your yard', (s) => s.trays.some((t) => t.stage !== 'empty') || s.raw > 0 || s.product > 0 || s.sales > 0],
    ['Wait for the caps to glow, then harvest them', (s) => s.raw > 0 || s.product > 0 || s.sales > 0],
    ['Pack the caps into tins at the workbench', (s) => s.product > 0 || s.sales > 0],
    ['Answer a phone order (purple marker, Tab for details) and make the drop', (s) => s.sales > 0],
    ['Restock at Fern & Spore in Old Kiln (green marker)', (s) => s.spores > 0 && s.sales > 0 || s.sales > 3],
    ['Push a district to 20% turf and hire a runner there', (s) => s.dealers.some((d) => d.hired)],
    ['Earn $5,000 in total', (s) => s.earned >= 5000],
    ['Own the city: 60% turf in all four districts', (s) => s.control.every((c) => c >= 60)],
  ];
  _checkGoals() {
    const s = this.s, G = Economy.GOALS;
    while (s.goal < G.length && G[s.goal][1](s)) {
      s.goal++;
      if (s.goal < G.length) this.game.toast('New goal: ' + G[s.goal][0]);
      else if (!s.won) { s.won = true; this.game.banner('PORT VERRIN IS YOURS', 'Every district answers to you. Keep the empire running.'); }
      this.save();
    }
  }
  goalText() { const G = Economy.GOALS; return this.s.goal < G.length ? G[this.s.goal][0] : 'Keep the empire running. Watch the heat.'; }
  inYard(x, z) { const L = HIDEOUT.lot; return x > L.x0 && x < L.x1 && z > L.z0 && z < L.z1; }
  districtOf(x, z) { return districtAt(x, z); }
}
