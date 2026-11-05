// Procedural city of Port Verrin: roads, districts, buildings, colliders.
import * as THREE from 'three';

export const GRID = 8;          // blocks per side
export const CELL = 64;         // road centre to road centre
export const ROAD = 14;         // road width
export const WALK = 4;          // sidewalk width
export const HALF = (GRID * CELL) / 2;
export const MARGIN = 48;       // open land around the grid
export const W = HALF + MARGIN; // world half size (x, and north z)
export const QUAY_Z = HALF + ROAD / 2 + 14; // water starts south of this
export const LANE = 3.5;
export const rc = (i) => -HALF + i * CELL;

export const DISTRICTS = [
  { name: 'Copperline', blurb: 'Glass towers and nervous money', mult: 1.6, color: '#7fd3ff', ground: '#5d6470' },
  { name: 'Old Kiln', blurb: 'Brick lofts and late-night studios', mult: 1.15, color: '#ff9a6b', ground: '#6e5a50' },
  { name: 'Saltmarsh Docks', blurb: 'Cranes, containers, quiet deals', mult: 1.0, color: '#ffd166', ground: '#5e5a4c' },
  { name: 'Vesper Heights', blurb: 'Lawns, porches, bored teenagers', mult: 1.35, color: '#9cff8f', ground: '#4f7a45' },
];
export function districtAt(x, z) {
  if (z < 0) return x >= 0 ? 0 : 1;
  return x < 0 ? 2 : 3;
}
export function blockOf(x, z) {
  return [Math.floor((x + HALF) / CELL), Math.floor((z + HALF) / CELL)];
}
export function blockBounds(bi, bj) {
  return { x0: rc(bi) + ROAD / 2, x1: rc(bi + 1) - ROAD / 2, z0: rc(bj) + ROAD / 2, z1: rc(bj + 1) - ROAD / 2 };
}
export function nearestNode(x, z) {
  const c = (v) => Math.max(0, Math.min(GRID, Math.round((v + HALF) / CELL)));
  return [c(x), c(z)];
}
export const nodePos = (i, j) => [rc(i), rc(j)];

export const HIDEOUT_BLOCK = [1, 5];
export const SHOP_BLOCK = [2, 1];
export const PRECINCT_BLOCK = [5, 1];
const PARKS = new Set(['4,2', '6,6', '1,2', '2,6']);

// Hideout layout (block 1,5)
export const HIDEOUT = {
  lot: { x0: -181, x1: -139, z0: 75, z1: 117 },
  gate: { x0: -166, x1: -154 },
  trays: [[-146, 82], [-146, 88], [-146, 94], [-146, 100], [-151, 82], [-151, 88], [-151, 94], [-151, 100]],
  bench: [-170, 96],
  carSpot: [-160, 84, Math.PI],
  spawn: [-162, 95],
};
export const SHOP_POINT = [-96, -137];
export const PRECINCT_POINT = [96, -137];
export const PAWN_POINT = [-43, 72.5];

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- geometry builder: one merged mesh for all buildings ----------
const CELL_U = 4;          // one window cell is 4 world units
const TEX_CELLS = 8;       // texture is 8x8 window cells
const S = CELL_U * TEX_CELLS;
const PLAIN_UV = [0.004, 0.004];

class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; }
  _push(v, nrm, uv, col) {
    this.p.push(v[0], v[1], v[2]); this.n.push(nrm[0], nrm[1], nrm[2]);
    this.uv.push(uv[0], uv[1]); this.c.push(col.r, col.g, col.b);
  }
  _normal(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }
  quad(a, b, c, d, col, uvs) {
    const n = this._normal(a, b, c);
    const u = uvs || [PLAIN_UV, PLAIN_UV, PLAIN_UV, PLAIN_UV];
    this._push(a, n, u[0], col); this._push(b, n, u[1], col); this._push(c, n, u[2], col);
    this._push(a, n, u[0], col); this._push(c, n, u[2], col); this._push(d, n, u[3], col);
  }
  tri(a, b, c, col) {
    const n = this._normal(a, b, c);
    this._push(a, n, PLAIN_UV, col); this._push(b, n, PLAIN_UV, col); this._push(c, n, PLAIN_UV, col);
  }
  box(x0, y0, z0, x1, y1, z1, col, opt = {}) {
    const win = opt.windows !== false;
    const roof = opt.roof || col;
    const off = opt.uoff || 0, voff = opt.voff || 0;
    const wuv = (len, h0, h1) => win
      ? [[off, (h0 + voff) / S], [off + len / S, (h0 + voff) / S], [off + len / S, (h1 + voff) / S], [off, (h1 + voff) / S]]
      : null;
    const L = z1 - z0, Wd = x1 - x0;
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col, wuv(L, y0, y1));
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, wuv(L, y0, y1));
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, wuv(Wd, y0, y1));
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, wuv(Wd, y0, y1));
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], roof);
  }
  gable(x0, z0, x1, z1, y0, h, col) {
    const zm = (z0 + z1) / 2, yr = y0 + h;
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, yr, zm], [x1, yr, zm], col);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, yr, zm], [x0, yr, zm], col);
    this.tri([x1, y0, z1], [x1, y0, z0], [x1, yr, zm], col);
    this.tri([x0, y0, z0], [x0, y0, z1], [x0, yr, zm], col);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
}

function windowTextures() {
  const size = 512, cell = size / TEX_CELLS;
  const a = document.createElement('canvas'); a.width = a.height = size;
  const e = document.createElement('canvas'); e.width = e.height = size;
  const rg = document.createElement('canvas'); rg.width = rg.height = size;
  const ca = a.getContext('2d'), ce = e.getContext('2d'), cr = rg.getContext('2d');
  cr.fillStyle = '#00f000'; cr.fillRect(0, 0, size, size); // G = roughness, B = metalness (glTF convention)
  ca.fillStyle = '#e8e4dc'; ca.fillRect(0, 0, size, size);
  ce.fillStyle = '#000'; ce.fillRect(0, 0, size, size);
  const rnd = mulberry32(7);
  for (let i = 0; i < TEX_CELLS; i++) for (let j = 0; j < TEX_CELLS; j++) {
    const x = i * cell, y = j * cell;
    ca.fillStyle = '#c9c4ba'; ca.fillRect(x, y + cell - 6, cell, 6); // floor ledge
    ca.fillStyle = '#2b3646'; ca.fillRect(x + 14, y + 12, cell - 28, cell - 26);
    cr.fillStyle = '#002090'; cr.fillRect(x + 14, y + 12, cell - 28, cell - 26);
    ca.fillStyle = 'rgba(255,255,255,0.18)'; ca.fillRect(x + 14, y + 12, 8, cell - 26);
    if (rnd() < 0.38) {
      const warm = rnd() < 0.75;
      ce.fillStyle = warm ? '#ffcf7a' : '#8fd6ff';
      ce.fillRect(x + 14, y + 12, cell - 28, cell - 26);
    }
  }
  const ta = new THREE.CanvasTexture(a), te = new THREE.CanvasTexture(e), tr = new THREE.CanvasTexture(rg);
  for (const t of [ta, te, tr]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  ta.colorSpace = te.colorSpace = THREE.SRGBColorSpace;
  return [ta, te, tr];
}

export function makeSign(text, w, h, bg, fg, font = 'bold 54px Trebuchet MS') {
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.round(512 * h / w);
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = fg; x.lineWidth = 8; x.strokeRect(8, 8, c.width - 16, c.height - 16);
  x.fillStyle = fg; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, c.width / 2, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t }));
}

export class City {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.buckets = new Map();
    this.lamps = null;
    this.nightMats = [];
    this.rng = mulberry32(1337);
    this._buildGround();
    this._buildBuildings();
    this._buildProps();
  }

  // ---------- colliders ----------
  addCollider(x0, z0, x1, z1) {
    const c = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) };
    this.colliders.push(c);
    const [a0, b0] = blockOf(c.x0, c.z0), [a1, b1] = blockOf(c.x1, c.z1);
    for (let i = a0; i <= a1; i++) for (let j = b0; j <= b1; j++) {
      const k = i + ',' + j;
      if (!this.buckets.has(k)) this.buckets.set(k, []);
      this.buckets.get(k).push(c);
    }
  }
  near(x, z) {
    const [bi, bj] = blockOf(x, z), out = [];
    for (let i = bi - 1; i <= bi + 1; i++) for (let j = bj - 1; j <= bj + 1; j++) {
      const b = this.buckets.get(i + ',' + j); if (b) out.push(...b);
    }
    return out;
  }
  pointBlocked(x, z) {
    const b = this.buckets.get(blockOf(x, z).join(','));
    if (!b) return false;
    for (const c of b) if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return true;
    return false;
  }
  segmentClear(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 3);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.pointBlocked(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }
  // Push a circle out of all colliders. Mutates p {x,z}. Returns true if anything was hit.
  resolveCircle(p, r) {
    let hit = false;
    for (const c of this.near(p.x, p.z)) {
      const cx = Math.max(c.x0, Math.min(p.x, c.x1)), cz = Math.max(c.z0, Math.min(p.z, c.z1));
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), k = (r - d) / d;
        p.x += dx * k; p.z += dz * k;
      } else {
        const l = p.x - c.x0, rr = c.x1 - p.x, t = p.z - c.z0, b = c.z1 - p.z, m = Math.min(l, rr, t, b);
        if (m === l) p.x = c.x0 - r; else if (m === rr) p.x = c.x1 + r; else if (m === t) p.z = c.z0 - r; else p.z = c.z1 + r;
      }
    }
    const lim = W - 3;
    if (p.x < -lim) { p.x = -lim; hit = true; }
    if (p.x > lim) { p.x = lim; hit = true; }
    if (p.z < -lim) { p.z = -lim; hit = true; }
    if (p.z > QUAY_Z - r) { p.z = QUAY_Z - r; hit = true; }
    return hit;
  }

  randomSidewalkPoint(rng, district) {
    for (let tries = 0; tries < 200; tries++) {
      const bi = Math.floor(rng() * GRID), bj = Math.floor(rng() * GRID);
      const b = blockBounds(bi, bj), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      if (district !== undefined && districtAt(cx, cz) !== district) continue;
      if (bi === HIDEOUT_BLOCK[0] && bj === HIDEOUT_BLOCK[1]) continue;
      const side = Math.floor(rng() * 4), t = 8 + rng() * (b.x1 - b.x0 - 16);
      let x, z;
      if (side === 0) { x = b.x0 + t; z = b.z0 + 2; }
      else if (side === 1) { x = b.x0 + t; z = b.z1 - 2; }
      else if (side === 2) { x = b.x0 + 2; z = b.z0 + t; }
      else { x = b.x1 - 2; z = b.z0 + t; }
      if (!this.pointBlocked(x, z)) return [x, z];
    }
    return [0, 0];
  }

  // ---------- ground ----------
  _buildGround() {
    const px = 2048 / (2 * W);
    const cw = 2048, ch = Math.round((QUAY_Z + W) * px);
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    const X = (v) => (v + W) * px, Z = (v) => (v + W) * px;
    const rect = (x0, z0, x1, z1, col) => { g.fillStyle = col; g.fillRect(X(x0), Z(z0), (x1 - x0) * px, (z1 - z0) * px); };

    rect(-W, -W, W, QUAY_Z, '#47603f');
    // speckle grass
    const r = mulberry32(5);
    for (let i = 0; i < 9000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)'; g.fillRect(r() * cw, r() * ch, 3, 3); }
    // quay
    rect(-W, HALF + ROAD / 2, W, QUAY_Z, '#8b8a82');
    for (let x = -W; x < W; x += 8) rect(x, QUAY_Z - 1.2, x + 4, QUAY_Z, '#e8c547');
    // asphalt over the whole grid
    const e = HALF + ROAD / 2;
    rect(-e, -e, e, e, '#2e3137');
    for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
      const b = blockBounds(i, j), d = districtAt((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2);
      rect(b.x0, b.z0, b.x1, b.z1, '#9a9890');            // sidewalk
      const key = i + ',' + j;
      const inner = PARKS.has(key) ? '#4f8a45' : (i === HIDEOUT_BLOCK[0] && j === HIDEOUT_BLOCK[1]) ? '#6d665a' : DISTRICTS[d].ground;
      rect(b.x0 + WALK, b.z0 + WALK, b.x1 - WALK, b.z1 - WALK, inner);
      g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1;
      g.strokeRect(X(b.x0 + WALK), Z(b.z0 + WALK), (b.x1 - b.x0 - 2 * WALK) * px, (b.z1 - b.z0 - 2 * WALK) * px);
      if (PARKS.has(key)) { // paths
        const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
        rect(cx - 1.5, b.z0 + WALK, cx + 1.5, b.z1 - WALK, '#b8a77f');
        rect(b.x0 + WALK, cz - 1.5, b.x1 - WALK, cz + 1.5, '#b8a77f');
      }
    }
    // lane markings and crosswalks
    for (let i = 0; i <= GRID; i++) {
      const v = rc(i);
      for (let j = 0; j < GRID; j++) {
        const a = rc(j) + ROAD / 2 + 3, b = rc(j + 1) - ROAD / 2 - 3;
        for (let s = a; s < b; s += 6) {
          rect(v - 0.2, s, v + 0.2, Math.min(s + 3, b), '#e8c547');
          rect(s, v - 0.2, Math.min(s + 3, b), v + 0.2, '#e8c547');
        }
        // crosswalk stripes at both ends of each segment
        for (const z of [rc(j) + ROAD / 2 + 0.5, rc(j + 1) - ROAD / 2 - 2.5]) {
          for (let k = -ROAD / 2 + 1; k < ROAD / 2 - 0.5; k += 1.6) {
            rect(v + k, z, v + k + 0.8, z + 2, 'rgba(240,240,240,0.75)');
            rect(z, v + k, z + 2, v + k + 0.8, 'rgba(240,240,240,0.75)');
          }
        }
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const geo = new THREE.PlaneGeometry(2 * W, QUAY_Z + W);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0, (QUAY_Z - W) / 2);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.mapCanvas = c; this.mapPx = px;

    // sidewalk curbs (thin raised rims, visual only)
    // water
    const water = new THREE.Mesh(new THREE.PlaneGeometry(4000, 2000),
      new THREE.MeshStandardMaterial({ color: 0x0f3448, metalness: 0.35, roughness: 0.12 }));
    water.rotation.x = -Math.PI / 2; water.position.set(0, -1.4, QUAY_Z + 1000);
    this.scene.add(water); this.water = water;
    const quayWall = new THREE.Mesh(new THREE.BoxGeometry(2 * W, 1.6, 1), new THREE.MeshLambertMaterial({ color: 0x6f6e68 }));
    quayWall.position.set(0, -0.8, QUAY_Z + 0.5); this.scene.add(quayWall);
    // land beyond the margin
    const far = new THREE.Mesh(new THREE.PlaneGeometry(4000, 2000), new THREE.MeshLambertMaterial({ color: 0x3d5537 }));
    far.rotation.x = -Math.PI / 2; far.position.set(0, -0.05, -W - 1000 + 1); this.scene.add(far);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(2000, QUAY_Z + W + 2), new THREE.MeshLambertMaterial({ color: 0x3d5537 }));
      side.rotation.x = -Math.PI / 2; side.position.set(sx * (W + 1000 - 1), -0.05, (QUAY_Z - W) / 2); this.scene.add(side);
    }
  }

  // ---------- buildings ----------
  _buildBuildings() {
    const gb = new GeoBuilder();
    const rng = this.rng;
    const col = (h, s, l) => new THREE.Color().setHSL(h, s, l);
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const uoff = () => Math.floor(rng() * 8) / 8;

    const building = (x0, z0, x1, z1, h, c, opt = {}) => {
      gb.box(x0, 0, z0, x1, h, z1, c, { uoff: uoff(), voff: Math.floor(rng() * 8) * CELL_U, roof: opt.roof || c.clone().multiplyScalar(0.7), windows: opt.windows });
      this.addCollider(x0, z0, x1, z1);
    };

    for (let bi = 0; bi < GRID; bi++) for (let bj = 0; bj < GRID; bj++) {
      const b = blockBounds(bi, bj);
      const L = { x0: b.x0 + WALK, x1: b.x1 - WALK, z0: b.z0 + WALK, z1: b.z1 - WALK };
      const key = bi + ',' + bj;
      const d = districtAt((L.x0 + L.x1) / 2, (L.z0 + L.z1) / 2);
      if (PARKS.has(key)) { this._park(L); continue; }
      if (bi === HIDEOUT_BLOCK[0] && bj === HIDEOUT_BLOCK[1]) { this._hideout(gb); continue; }
      if (bi === SHOP_BLOCK[0] && bj === SHOP_BLOCK[1]) {
        building(-112, -156, -80, -139, 8, col(0.33, 0.25, 0.55), { roof: col(0.33, 0.3, 0.3) });
        building(L.x0, L.z0, L.x1, -160, 15, col(0.03, 0.45, 0.42));
        building(L.x0, -156, -115, L.z1, 10, col(0.07, 0.4, 0.5));
        building(-77, -156, L.x1, L.z1, 11, col(0.05, 0.35, 0.45));
        const s = makeSign('FERN & SPORE', 16, 3, '#1f4a2e', '#b6ffb0'); s.position.set(-96, 6.4, -138.9); this.scene.add(s);
        const aw = new THREE.Mesh(new THREE.BoxGeometry(30, 0.3, 3), new THREE.MeshLambertMaterial({ color: 0x2e8b57 }));
        aw.position.set(-96, 4, -137.6); aw.rotation.x = -0.25; this.scene.add(aw);
        continue;
      }
      if (bi === PRECINCT_BLOCK[0] && bj === PRECINCT_BLOCK[1]) {
        building(80, -170, 112, -139, 12, col(0.6, 0.15, 0.85), { roof: col(0.6, 0.3, 0.3) });
        building(L.x0, L.z0, L.x1, -173, 30, col(0.58, 0.2, 0.55));
        const s = makeSign('PRECINCT 9', 14, 3, '#14264a', '#9fd0ff'); s.position.set(96, 9.5, -138.9); this.scene.add(s);
        continue;
      }
      if (d === 0) { // Copperline towers
        const n = rng() < 0.5 ? 2 : 1, m = 2, gap = 3;
        const cw = (L.x1 - L.x0 - gap * (n - 1)) / n, cd = (L.z1 - L.z0 - gap * (m - 1)) / m;
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
          const x0 = L.x0 + i * (cw + gap), z0 = L.z0 + j * (cd + gap);
          const h = 24 + Math.floor(rng() * 16) * 4 * (1 - Math.hypot(bi - 6, bj - 2) / 10);
          const c = col(0.52 + rng() * 0.1, 0.18 + rng() * 0.2, 0.55 + rng() * 0.2);
          building(x0, z0, x0 + cw, z0 + cd, Math.max(20, h), c);
          if (rng() < 0.6) { // setback crown
            const ins = 3 + rng() * 3, h2 = 8 + rng() * 16;
            gb.box(x0 + ins, h, z0 + ins, x0 + cw - ins, h + h2, z0 + cd - ins, c.clone().offsetHSL(0, 0, 0.06), { uoff: uoff(), voff: h });
          }
        }
      } else if (d === 1) { // Old Kiln brick
        const splits = pick([[1, 2], [2, 2], [2, 1]]), gap = 2.5;
        const [n, m] = splits;
        const cw = (L.x1 - L.x0 - gap * (n - 1)) / n, cd = (L.z1 - L.z0 - gap * (m - 1)) / m;
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
          const x0 = L.x0 + i * (cw + gap), z0 = L.z0 + j * (cd + gap);
          const h = 9 + Math.floor(rng() * 5) * 4;
          building(x0, z0, x0 + cw, z0 + cd, h, col(0.02 + rng() * 0.07, 0.45 + rng() * 0.2, 0.36 + rng() * 0.14));
          if (rng() < 0.4) { // chimney
            const cx = x0 + 3 + rng() * (cw - 6), cz = z0 + 3 + rng() * (cd - 6);
            gb.box(cx - 0.8, h, cz - 0.8, cx + 0.8, h + 5, cz + 0.8, col(0.03, 0.4, 0.3), { windows: false });
          }
        }
      } else if (d === 2) { // Docks: warehouses and containers
        const long = rng() < 0.5;
        if (long) {
          building(L.x0, L.z0, L.x1, L.z0 + 22, 9 + rng() * 4, col(0.12 + rng() * 0.05, 0.25, 0.45), { windows: false, roof: col(0.1, 0.1, 0.35) });
          this._containers(gb, L.x0 + 2, L.z0 + 26, L.x1 - 2, L.z1 - 2);
        } else {
          building(L.x0, L.z0, L.x0 + 20, L.z1, 8 + rng() * 5, col(0.55, 0.15, 0.45), { windows: false, roof: col(0.55, 0.1, 0.3) });
          this._containers(gb, L.x0 + 24, L.z0 + 2, L.x1 - 2, L.z1 - 2);
        }
      } else { // Vesper Heights houses
        const gap = 6, cw = (L.x1 - L.x0 - gap) / 2, cd = (L.z1 - L.z0 - gap) / 2;
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
          const x0 = L.x0 + i * (cw + gap) + 3, z0 = L.z0 + j * (cd + gap) + 3;
          const x1 = x0 + cw - 6, z1 = z0 + cd - 6, h = 4.5 + rng() * 2.5;
          const c = col(rng(), 0.35, 0.72);
          building(x0, z0, x1, z1, h, c);
          gb.gable(x0 - 0.6, z0 - 0.6, x1 + 0.6, z1 + 0.6, h, 3, col(rng() * 0.1, 0.4, 0.3));
          this._treeAt(x1 + 2, z1 + 2);
        }
      }
    }

    const [ta, te, tr] = windowTextures();
    const mat = new THREE.MeshStandardMaterial({ map: ta, emissiveMap: te, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true,
      roughnessMap: tr, metalnessMap: tr, roughness: 1, metalness: 1 });
    this.buildingMat = mat;
    const mesh = new THREE.Mesh(gb.build(), mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  _containers(gb, x0, z0, x1, z1) {
    const rng = this.rng;
    const cols = [0xd1495b, 0x00798c, 0xedae49, 0x30638e, 0x66a182, 0x8d6a9f];
    for (let z = z0; z + 6.2 <= z1; z += 7) {
      for (let x = x0; x + 2.6 <= x1; x += 3.2) {
        if (rng() < 0.25) continue;
        const stack = 1 + Math.floor(rng() * 3);
        for (let s = 0; s < stack; s++) {
          const c = new THREE.Color(cols[Math.floor(rng() * cols.length)]);
          gb.box(x, s * 2.6, z, x + 2.5, s * 2.6 + 2.5, z + 6.1, c, { windows: false, roof: c.clone().multiplyScalar(0.8) });
        }
        this.addCollider(x, z, x + 2.5, z + 6.1);
      }
    }
  }

  _hideout(gb) {
    const H = HIDEOUT.lot, fence = new THREE.Color(0x7a6f5d), shed = new THREE.Color(0x5b6b7a);
    const f = (x0, z0, x1, z1) => { gb.box(x0, 0, z0, x1, 2.4, z1, fence, { windows: false }); this.addCollider(x0, z0, x1, z1); };
    f(H.x0, H.z0, HIDEOUT.gate.x0, H.z0 + 0.4);
    f(HIDEOUT.gate.x1, H.z0, H.x1, H.z0 + 0.4);
    f(H.x0, H.z1 - 0.4, H.x1, H.z1);
    f(H.x0, H.z0, H.x0 + 0.4, H.z1);
    f(H.x1 - 0.4, H.z0, H.x1, H.z1);
    gb.box(H.x0 + 0.4, 0, 103, -156, 6, H.z1 - 0.4, shed, { windows: false, roof: new THREE.Color(0x3a3f45) });
    this.addCollider(H.x0 + 0.4, 103, -156, H.z1 - 0.4);
    const ps = makeSign("MARLOW'S PAWN", 12, 2.4, '#3a0f12', '#ffcf5a'); ps.position.set(-43, 4.2, 74.9); ps.rotation.y = Math.PI; this.scene.add(ps);
    const s = makeSign('VERRIN YARD 7', 10, 2, '#2a2418', '#ffd166', 'bold 64px Trebuchet MS');
    s.position.set(-160, 3.6, H.z0 - 0.05); s.rotation.y = Math.PI; this.scene.add(s);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.6, 0.3), new THREE.MeshLambertMaterial({ color: 0x333333 }));
    for (const x of [HIDEOUT.gate.x0 - 0.2, HIDEOUT.gate.x1 + 0.2]) { const p = post.clone(); p.position.set(x, 2.3, H.z0 + 0.2); this.scene.add(p); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(12.6, 0.3, 0.3), post.material);
    bar.position.set(-160, 4.6, H.z0 + 0.2); this.scene.add(bar);
  }

  _park(L) {
    const rng = this.rng;
    for (let i = 0; i < 14; i++) {
      const x = L.x0 + 3 + rng() * (L.x1 - L.x0 - 6), z = L.z0 + 3 + rng() * (L.z1 - L.z0 - 6);
      const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
      if (Math.abs(x - cx) < 3 || Math.abs(z - cz) < 3) continue;
      this._treeAt(x, z);
    }
  }

  _treeAt(x, z) {
    (this._trees ||= []).push([x, z, 0.8 + this.rng() * 0.6]);
    this.addCollider(x - 0.4, z - 0.4, x + 0.4, z + 0.4);
  }

  // ---------- props: trees, lamps, hills, piers ----------
  _buildProps() {
    const rng = this.rng;
    // border trees
    for (let i = 0; i < 160; i++) {
      const t = rng() * 4;
      let x, z;
      const e = HALF + ROAD / 2 + 6, f = W - 6;
      if (t < 1) { x = -f + rng() * 2 * f; z = -e - 4 - rng() * (MARGIN - 14); }
      else if (t < 2) { x = -e - 4 - rng() * (MARGIN - 14); z = -f + rng() * (HALF + f); }
      else if (t < 3) { x = e + 4 + rng() * (MARGIN - 14); z = -f + rng() * (HALF + f); }
      else continue;
      this._treeAt(x, z);
    }
    const trees = this._trees;
    const trunkG = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 6); trunkG.translate(0, 1.1, 0);
    const crownG = new THREE.IcosahedronGeometry(1.7, 0); crownG.translate(0, 3.4, 0);
    const trunk = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x6b4a32 }), trees.length);
    const crown = new THREE.InstancedMesh(crownG, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    trees.forEach(([x, z, k], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
      m.compose(p.set(x, 0, z), q, s.set(k, k, k));
      trunk.setMatrixAt(i, m); crown.setMatrixAt(i, m);
      crown.setColorAt(i, c.setHSL(0.25 + rng() * 0.12, 0.45, 0.28 + rng() * 0.12));
    });
    trunk.castShadow = crown.castShadow = true;
    this.scene.add(trunk, crown);

    // street lamps at block corners
    const spots = [];
    for (let bi = 0; bi < GRID; bi++) for (let bj = 0; bj < GRID; bj++) {
      const b = blockBounds(bi, bj);
      spots.push([b.x0 + 1, b.z0 + 1], [b.x1 - 1, b.z1 - 1]);
    }
    const poleG = new THREE.CylinderGeometry(0.1, 0.14, 6, 6); poleG.translate(0, 3, 0);
    const headG = new THREE.BoxGeometry(0.7, 0.25, 0.7); headG.translate(0, 6.05, 0);
    const poles = new THREE.InstancedMesh(poleG, new THREE.MeshLambertMaterial({ color: 0x2d3138 }), spots.length);
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
    const heads = new THREE.InstancedMesh(headG, this.lampMat, spots.length);
    spots.forEach(([x, z], i) => { m.makeTranslation(x, 0, z); poles.setMatrixAt(i, m); heads.setMatrixAt(i, m); });
    this.scene.add(poles, heads);
    // soft glow pools under lamps (additive discs, visible at night)
    const poolTex = (() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64;
      const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,210,140,0.9)'); gr.addColorStop(1, 'rgba(255,210,140,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    })();
    this.poolMat = new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const poolG = new THREE.PlaneGeometry(9, 9); poolG.rotateX(-Math.PI / 2); poolG.translate(0, 0.05, 0);
    const pools = new THREE.InstancedMesh(poolG, this.poolMat, spots.length);
    spots.forEach(([x, z], i) => { m.makeTranslation(x, 0, z); pools.setMatrixAt(i, m); });
    this.scene.add(pools);

    // distant hills ring (north, west, east)
    const hillMat = new THREE.MeshLambertMaterial({ color: 0x4c5f52, flatShading: true });
    for (let i = 0; i < 40; i++) {
      const a = Math.PI * 0.95 + (i / 40) * Math.PI * 1.1;
      const r = 520 + rng() * 120, h = 40 + rng() * 90;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(60 + rng() * 60, h, 6), hillMat);
      hill.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r * 0.9 - 40);
      this.scene.add(hill);
    }
    // piers and cranes on the waterfront
    const wood = new THREE.MeshLambertMaterial({ color: 0x7b5b3a });
    for (const x of [-200, -120, -40]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(8, 0.6, 40), wood);
      pier.position.set(x, -0.3, QUAY_Z + 20); this.scene.add(pier);
    }
    const craneMat = new THREE.MeshLambertMaterial({ color: 0xe0a43a });
    for (const x of [-170, -70]) {
      const g = new THREE.Group();
      const leg = new THREE.BoxGeometry(1.2, 26, 1.2);
      for (const [dx, dz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) { const l = new THREE.Mesh(leg, craneMat); l.position.set(dx, 13, dz); g.add(l); }
      const arm = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 46), craneMat); arm.position.set(0, 26, 12); g.add(arm);
      g.position.set(x, 0, QUAY_Z - 6); this.scene.add(g);
      for (const [dx, dz] of [[-4, -3], [4, -3]]) this.addCollider(x + dx - 0.6, QUAY_Z - 6 + dz - 0.6, x + dx + 0.6, QUAY_Z - 6 + dz + 0.6);
    }
  }

  setNight(n) {
    this.buildingMat.emissiveIntensity = n * 1.1;
    this.lampMat.color.setRGB(0.33 + n * 1.8, 0.33 + n * 1.4, 0.33 + n * 0.7);
    this.poolMat.opacity = n * 0.35;
  }
}
