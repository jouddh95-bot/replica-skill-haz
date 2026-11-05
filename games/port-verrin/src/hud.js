// DOM HUD, minimap, shop and phone panels.
import { DISTRICTS, HIDEOUT, SHOP_POINT, W, QUAY_Z } from './city.js';
import { SHOP_ITEMS, PAWN_ITEMS } from './economy.js';
import { WEAPONS } from './combat.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = { money: $('money'), inv: $('inv'), goal: $('goal'), wanted: $('wanted'), heat: $('heatbar').firstElementChild,
      heatLabel: $('heatlabel'), evadeBar: $('evadebar'), evadeFill: $('evadebar').firstElementChild, evadeLabel: $('evadelabel'),
      clock: $('clock'), district: $('district'), prompt: $('prompt'), toasts: $('toasts'), banner: $('banner'), speed: $('speed'),
      hp: $('hpbar').firstElementChild, ar: $('arbar').firstElementChild, weapon: $('weapon'), cross: $('crosshair'), hit: $('hitmark'), vig: $('vignette') };
    this.map = $('minimap'); this.mctx = this.map.getContext('2d');
    this.phoneTab = 'orders';
    this.shopOpen = false; this.phoneOpen = false;
    $('shop').addEventListener('click', (e) => { if (e.target.id === 'shop') this.closePanels(); });
    $('phone').addEventListener('click', (e) => { if (e.target.id === 'phone') this.closePanels(); });
    this._lastDistrict = -1;
  }

  toast(text, kind = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind; d.textContent = text;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 5) this.el.toasts.firstElementChild.remove();
    setTimeout(() => d.remove(), 6500);
  }
  banner(title, sub, ms = 3200) {
    const b = this.el.banner;
    b.querySelector('h2').textContent = title; b.querySelector('p').textContent = sub;
    b.style.opacity = 1;
    clearTimeout(this._bt); this._bt = setTimeout(() => { b.style.opacity = 0; }, ms);
  }
  prompt(text) {
    const p = this.el.prompt;
    if (!text) { p.style.display = 'none'; return; }
    p.style.display = 'block';
    p.innerHTML = '<kbd>E</kbd> ' + text.replace(/</g, '&lt;');
  }

  update(dt) {
    const g = this.game, s = g.eco.s, pol = g.police;
    this.el.money.textContent = '$' + Math.floor(s.money).toLocaleString();
    this.el.inv.innerHTML =
      `Lumen tins <b>${s.product}</b><br>Raw glowcaps <b>${s.raw}</b><br>Spore packs <b>${s.spores}</b><br>Empty tins <b>${s.tins}</b>` +
      (s.fert ? `<br>Fertilizer <b>${s.fert}</b>` : '');
    this.el.goal.innerHTML = '<span>GOAL</span>' + g.eco.goalText();
    let w = '';
    for (let i = 0; i < 3; i++) w += `<span class="${i < pol.wanted ? 'on' : 'off'}">●</span>`;
    this.el.wanted.innerHTML = w;
    this.el.heat.style.width = s.heat.toFixed(0) + '%';
    this.el.heatLabel.textContent = pol.wanted ? 'Wanted. Break line of sight' : pol.suspicion > 0.2 ? 'A cruiser is watching you...' : `Heat ${Math.round(s.heat)}`;
    const ev = pol.wanted > 0;
    this.el.evadeBar.style.display = this.el.evadeLabel.style.display = ev ? 'block' : 'none';
    if (ev) this.el.evadeFill.style.width = Math.min(100, (pol.evade / pol.evadeNeeded()) * 100) + '%';
    const hrs = Math.floor(s.time * 24), mins = Math.floor((s.time * 24 * 60) % 60);
    this.el.clock.textContent = `Day ${s.day} · ${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    const p = g.playerPos(), d = g.eco.districtOf(p.x, p.z);
    this.el.district.innerHTML = `<b>${DISTRICTS[d].name}</b><br>Turf ${Math.round(s.control[d])}% · $${g.eco.unitPrice(d)}/tin`;
    if (d !== this._lastDistrict) { if (this._lastDistrict >= 0) this.banner(DISTRICTS[d].name.toUpperCase(), DISTRICTS[d].blurb, 2200); this._lastDistrict = d; }
    if (g.player.car) { this.el.speed.style.display = 'block'; this.el.speed.innerHTML = Math.round(Math.abs(g.player.car.speed) * 3.6) + ' <small>km/h</small>'; }
    else this.el.speed.style.display = 'none';
    this.el.hp.style.width = Math.max(0, s.health) + '%';
    this.el.ar.style.width = (s.armor * 2) + '%';
    const wid = s.weapon || 'fists', wpn = WEAPONS[wid];
    this.el.weapon.innerHTML = `<b>${wpn.name}</b>` + (wpn.melee ? '' : ` <span>${(s.clip && s.clip[wid]) || 0} / ${(s.ammo && s.ammo[wid]) || 0}</span>`) + (g.arsenal.reloadT > 0 ? ' <i>reloading</i>' : '');
    this.el.cross.style.display = g.player.car || g.player.human.dead ? 'none' : 'block';
    this.el.cross.classList.toggle('aim', !!g.aiming);
    this._hitT = Math.max(0, (this._hitT || 0) - dt); this.el.hit.style.opacity = this._hitT > 0 ? 1 : 0;
    this._dmgT = Math.max(0, (this._dmgT || 0) - dt); this.el.vig.style.opacity = Math.min(0.8, this._dmgT * 2) + (s.health < 30 ? 0.25 : 0);
    this._minimap(g.time);
    if (this.phoneOpen) { this._phoneT = (this._phoneT || 0) - dt; if (this._phoneT <= 0) { this._phoneT = 0.5; this.renderPhone(); } }
  }

  hitMarker() { this._hitT = 0.15; }
  damageFlash() { this._dmgT = 0.45; }

  // ---------- minimap ----------
  _minimap(t) {
    const g = this.game, c = this.mctx, Wd = this.map.width, scale = Wd / 170; // 170 world units across
    const p = g.playerPos(), city = g.city, px = city.mapPx;
    c.save();
    c.fillStyle = '#1d5470'; c.fillRect(0, 0, Wd, Wd);
    c.translate(Wd / 2, Wd / 2);
    const k = scale / px;
    c.drawImage(city.mapCanvas, (-W - p.x) * scale, (-W - p.z) * scale, city.mapCanvas.width * k, city.mapCanvas.height * k);
    const dot = (x, z, col, r = 6, clamp = true) => {
      let dx = (x - p.x) * scale, dz = (z - p.z) * scale;
      const lim = Wd / 2 - 10;
      if (clamp) { const m = Math.max(Math.abs(dx), Math.abs(dz)); if (m > lim) { dx *= lim / m; dz *= lim / m; } }
      else if (Math.abs(dx) > lim || Math.abs(dz) > lim) return;
      c.fillStyle = col; c.beginPath(); c.arc(dx, dz, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#000'; c.lineWidth = 2; c.stroke();
    };
    dot(-160, 96, '#ffd166', 9);
    dot(SHOP_POINT[0], SHOP_POINT[1], '#6cf2c2', 8);
    dot(-43, 72.5, '#ff9a6b', 8);
    for (const n of g.npcs) if (!n.dead && (n.kind === 'cop' || (n.kind === 'gang' && n.state === 'shoot'))) dot(n.h.pos.x, n.h.pos.z, n.kind === 'cop' ? '#5aa0ff' : '#ff4040', 4, false);
    for (const o of g.eco.orders) dot(o.c.x, o.c.z, '#c792ff', 8);
    g.eco.s.dealers.forEach((dl, d) => {
      if (dl.hired || g.eco.s.control[d] >= 20) { const [x, z] = g.eco.dealerSpots[d]; dot(x, z, dl.hired ? '#7fd3ff' : '#ffffff', 7); }
    });
    const blink = Math.floor(t * 5) % 2;
    for (const cop of g.police.cops) dot(cop.pos.x, cop.pos.z, cop.sirenOn ? (blink ? '#ff3355' : '#3388ff') : '#8899bb', 6, false);
    // player arrow
    c.rotate(-g.player.facing() + Math.PI);
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -13); c.lineTo(9, 10); c.lineTo(0, 5); c.lineTo(-9, 10); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }

  // ---------- panels ----------
  closePanels() {
    $('shop').classList.remove('open'); $('phone').classList.remove('open');
    this.shopOpen = this.phoneOpen = false;
  }
  anyOpen() { return this.shopOpen || this.phoneOpen; }

  openShop(kind = 'garden') {
    this.closePanels();
    this.shopKind = kind;
    this.shopOpen = true; $('shop').classList.add('open');
    document.exitPointerLock?.();
    this.renderShop();
  }
  renderShop() {
    const eco = this.game.eco, s = eco.s;
    const card = $('shopcard');
    const pawn = this.shopKind === 'pawn', items = pawn ? PAWN_ITEMS : SHOP_ITEMS;
    card.innerHTML = `<button class="ghost close" data-close>Close (Esc)</button><h3>${pawn ? "Marlow's Pawn" : 'Fern & Spore Garden Supply'}</h3>
      <div class="sub">${pawn ? '"No receipts, no questions, no refunds."' : '"We sell spores for mushroom crafts. What you do with them is your business."'} · You have $${Math.floor(s.money)}</div>` +
      items.map((it, i) => {
        const ok = s.money >= it.price && (!it.can || it.can(s));
        return `<div class="row"><div><div>${it.name}</div><div class="meta">${it.desc}</div></div><button data-buy="${i}" ${ok ? '' : 'disabled'}>$${it.price}</button></div>`;
      }).join('');
    card.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => { eco.buy(items[+b.dataset.buy]); this.renderShop(); }));
    card.querySelector('[data-close]').addEventListener('click', () => this.closePanels());
  }

  togglePhone() {
    if (this.phoneOpen) { this.closePanels(); return; }
    this.closePanels();
    this.phoneOpen = true; $('phone').classList.add('open');
    document.exitPointerLock?.();
    this.renderPhone();
  }
  renderPhone() {
    const eco = this.game.eco, s = eco.s, tab = this.phoneTab;
    const tabs = [['orders', 'Orders'], ['runners', 'Runners'], ['turf', 'Turf'], ['help', 'How to play']];
    let body = '';
    if (tab === 'orders') {
      body = eco.orders.length ? eco.orders.map((o) => `<div class="row"><div><div>${o.c.name} · ${o.qty} tin${o.qty > 1 ? 's' : ''}</div>
        <div class="meta">${DISTRICTS[o.c.d].name} · $${o.price} each · leaves in ${Math.ceil(o.left)}s</div></div><b style="color:var(--mint)">$${o.qty * o.price}</b></div>`).join('')
        : '<div class="row"><div class="meta">No orders right now. They come in every half minute or so.</div></div>';
      body += `<div class="row"><div class="meta">Purple markers on the map are customers. Walk up and press E. Copperline pays the most, but it is crawling with cruisers.</div></div>`;
    } else if (tab === 'runners') {
      body = s.dealers.map((dl, d) => `<div class="row"><div><div>${DISTRICTS[d].name}: ${eco.dealerNames[d]}</div>
        <div class="meta">${dl.hired ? `Stock ${dl.stock}/15 · holding $${dl.cash} for you · sells one tin every 16s and keeps 25%` : s.control[d] >= 20 ? 'Available. White dot on your map. Costs $600' : `Needs 20% turf (now ${Math.round(s.control[d])}%)`}</div></div>
        <b style="color:${dl.hired ? 'var(--sky)' : 'var(--dim)'}">${dl.hired ? 'Hired' : s.control[d] >= 20 ? 'Ready' : 'Locked'}</b></div>`).join('');
    } else if (tab === 'turf') {
      body = s.control.map((c, d) => `<div class="row"><div><div>${DISTRICTS[d].name}</div><div class="meta">${DISTRICTS[d].blurb} · $${eco.unitPrice(d)}/tin</div></div>
        <div class="tbar"><i style="width:${c}%;background:${DISTRICTS[d].color}"></i></div></div>`).join('') +
        `<div class="row"><div class="meta">Every sale grows your turf. More turf, better prices. Total earned: $${Math.floor(s.earned).toLocaleString()}</div></div>`;
    } else {
      body = `<div class="row"><div class="meta" style="line-height:1.7">
        1. Your yard (yellow) has grow trays. Press E with spore packs to plant.<br>
        2. When the caps glow, harvest them, then pack them into tins at the workbench.<br>
        3. Customers text you orders. Find the purple marker and hand over the tins.<br>
        4. Restock spores, tins and fertilizer at Fern & Spore (green).<br>
        5. Each deal adds heat. Above 40 heat, cruisers that see you will start a chase. Break line of sight until the blue bar fills, or hide in your yard.<br>
        6. If a cruiser pins you down while you're slow, you get collared: you lose your product and some cash.<br>
        7. At 20% turf a runner offers to work that district. Keep them stocked and collect.<br>
        8. Marlow's Pawn (orange) sells a bat, guns, ammo, armour and medkits. Right mouse aims, left mouse attacks, 1 to 5 or the wheel switch weapons, R reloads.<br>
        9. Brine Rats (red) hold corners in the Docks and Vesper Heights. Get close and they fight. Take them down for cash and turf.<br>
        At two or more wanted dots, officers get out and shoot. Damaged cars catch fire and explode.<br>
        Press E next to any car to take it. Space is the handbrake.</div></div>`;
    }
    const card = $('phonecard');
    card.innerHTML = `<button class="ghost close" data-close>Close (Tab)</button><h3>Burner phone</h3><div class="sub">${this.game.eco.goalText()}</div>
      <div class="tabs">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div>${body}`;
    card.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { this.phoneTab = b.dataset.tab; this.renderPhone(); }));
    card.querySelector('[data-close]').addEventListener('click', () => this.closePanels());
  }
}
