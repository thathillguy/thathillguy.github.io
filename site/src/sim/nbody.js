// N-body gravity with a Barnes-Hut quadtree. No DOM, no React: runs in a Web Worker and under `node --test`.
//
// Two nebulae, each a disc of small bodies around an unseen core, on an eccentric mutual orbit.
// Units: distance in "sim units", where the shorter side of the viewport spans 100 units;
// time in seconds; G = 1. Coordinates follow the screen: origin at the centre, y grows downward.

import { walkRange, EMPTY, INTERNAL, CROWD } from './walk.js';

export const COLOURS = ['#E24e42', '#e9b000', '#EB6E80', '#008F95'];
export const BLACK = 4; // colour index of a collapsed body

// Arrays live in SharedArrayBuffers when the environment has them, so worker threads can walk
// the same tree without copying. Plain ArrayBuffers otherwise; the physics is identical.
const shared = () => typeof SharedArrayBuffer !== 'undefined' && (typeof crossOriginIsolated === 'undefined' || crossOriginIsolated);
const f64 = (n) => new Float64Array(shared() ? new SharedArrayBuffer(n * 8) : n);
const i32 = (n) => new Int32Array(shared() ? new SharedArrayBuffer(n * 4) : n);
const u8 = (n) => new Uint8Array(n);
const NEBULA_COLOURS = [[0, 1], [2, 3]]; // each nebula draws from its own pair

export const DEFAULTS = {
  bodies: 6000,          // number of bodies the sim keeps alive, shared between the nebulae
  nebulae: 2,
  nebulaMass: 3000,      // each, unseen core plus bodies
  coreFraction: 0.7,     // share of nebulaMass sitting in the unseen core
  nebulaRadius: 34,      // disc radius in sim units
  profile: 0.8,          // body radius within a nebula is R * u^profile: lower is denser at the core
  coreSoftening: 5,      // Plummer softening of the cores (keeps them from slingshotting bodies)
  softening: 1,          // Plummer softening for body-body forces
  separation: 110,       // starting distance between the two cores (their apoapsis)
  periapsis: 25,         // closest approach of the cores' mutual orbit
  holeMass: null,        // the pointer's black hole; null = whatever mass gives it holeHorizon at this c
  holeHorizon: 1.4,      // Schwarzschild radius of the pointer's hole, in sim units
  holeSoftening: 3,
  lightSpeed: null,      // c, sim units per second (G = 1); null = set so a body holding
  collapseFraction: 0.08,//   this share of all body mass collapses into a black hole
  touchFactor: 1,        // bodies merge when closer than touchFactor * (r1 + r2); 0 turns merging off
  mergeChance: 1,        // probability per step while touching
  replaceMerged: false,  // true keeps the population by letting a fresh body in at a nebula's rim per merge
  stickSpeed: 2.5,       // impacts slower than this (relative speed) simply combine
  shatterSpeed: 10,      // by this relative speed the impact is at full intensity
  fragmentFraction: 0.35,// at full intensity this share of the smaller body's mass is thrown off (0 = never)
  fragmentEnergy: 0.5,   // at most this share of the kinetic energy the merge destroys goes into fragments
  fragmentMinSpeed: 0.8, // fragments that could not get clear are not made
  eatRatio: 0.1,         // a body lighter than this fraction of the other is simply eaten, however hard it hits
  fullRatio: 0.4,        // from this mass ratio up, fragmentation is at full strength
  density: null,         // mass = density * radius^radiusExponent; derived from the masses above unless set
  radiusExponent: 3,     // 3: radius grows with the cube root of mass, like a solid ball
  minRadius: 0.05,       // drawn radius; well under a pixel to ~1.3 px on a laptop
  maxRadius: 0.16,
  theta: 1.0,            // Barnes-Hut opening angle; lower is more accurate and slower (0.8% rms error here)
  dt: 1 / 120,           // fixed physics step
  maxFrame: 0.05,        // most real time absorbed by one advance() call
  halfW: 80,             // visible half-extents, in sim units (see setViewport)
  halfH: 50,
  random: Math.random,
};

const MAX_DEPTH = 24;
const POOL_MAX = 16; // touching-pair regions are reserved for up to this many walkers
let shareGeneration = 0; // global, so workers never confuse one sim's buffers with another's

/** Schwarzschild radius of a mass m: 2 G m / c^2, with G = 1. */
export function schwarzschildRadius(m, c) {
  return (2 * m) / (c * c);
}

/** The speed of light at which a body of mass m and radius r sits exactly on its horizon. */
export function collapseLightSpeed(m, r) {
  return Math.sqrt((2 * m) / r);
}

/** Speed of a circular orbit at distance rho around a core of mass m with Plummer softening e. */
export function circularSpeed(m, e, rho) {
  const d2 = rho * rho + e * e;
  return rho * Math.sqrt(m / (d2 * Math.sqrt(d2)));
}

export class NBody {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.random = this.o.random;
    this.halfW = this.o.halfW;
    this.halfH = this.o.halfH;
    this.time = 0;
    this.stats = { escaped: 0, swallowed: 0, merges: 0, collapses: 0, steps: 0, nodes: 0 };
    this.hole = null;
    this._touching = [];
    this._acc = 0;
    this.n = 0;
    this._alloc(Math.max(64, this.o.bodies * 2));
    this._stack = new Int32Array(4096);
    this._initCores();
    this.density = this.o.density ?? 1; // provisional until the population exists
    for (let i = 0; i < this.o.bodies; i++) this._spawnInNebula(i % this.nebulaCount);
    if (this.o.density == null) {
      let sum = 0;
      for (let i = 0; i < this.n; i++) sum += Math.pow(this.r[i], this.o.radiusExponent);
      const bodyMass = this.k * this.o.nebulaMass * (1 - this.o.coreFraction);
      this.density = sum > 0 ? bodyMass / sum : 1;
      for (let i = 0; i < this.n; i++) this.m[i] = this.massOf(this.r[i]);
    }
    this._balanceCores();
    this._setConstants();
    this._accelerate();
  }

  /** Choose c (and the pointer hole's mass) from the body mass present, unless given explicitly. */
  _setConstants() {
    let total = 0;
    for (let i = 0; i < this.n; i++) total += this.m[i];
    const critical = this.o.collapseFraction * total;
    if (this.o.lightSpeed == null) {
      this.o.lightSpeed = critical > 0 ? collapseLightSpeed(critical, this.radiusOf(critical)) : 46;
    }
    if (this.o.holeMass == null) {
      this.o.holeMass = (this.o.holeHorizon * this.o.lightSpeed ** 2) / 2;
    }
  }

  _alloc(cap) {
    this.cap = cap;
    // All 64-bit: 32-bit storage measured slower in V8 (each load converts to a double) and
    // rounding the accelerations breaks the exact pairwise symmetry that conserves momentum.
    for (const k of ['x', 'y', 'vx', 'vy', 'ax', 'ay', 'r', 'm']) this[k] = f64(cap);
    this.colour = u8(cap);
    this.home = u8(cap);
    this.black = u8(cap); // 1 for a body that has collapsed into a black hole
    this._dead = u8(cap);
    this._keys = new Float64Array(cap);   // Morton code * 2^20 + index, for sorting
    this._scratch = new Float64Array(cap);
    this._scratch8 = new Uint8Array(cap);
    // touching pairs: one region per walker (region 0 doubles as the single-thread region)
    this._touchPer = 8 * Math.ceil(cap / 4) + 1024;
    this._touching = i32(this._touchPer * POOL_MAX);
    this._touchCount = 0;
    this._ctrl = i32(4); // shared chunk counter for the pool
    this._allocTree(cap * 4 + 64);
    this._shareGen = ++shareGeneration;
  }

  _allocTree(cap) {
    this.treeCap = cap;
    this.nx = f64(cap);   // cell centre
    this.ny = f64(cap);
    this.nh = f64(cap);   // cell half-size
    this.nm = f64(cap);   // mass in cell
    this.ncx = f64(cap);  // centre of mass (sum m*x during the build)
    this.ncy = f64(cap);
    this.nrmax = f64(cap); // largest body radius in the cell
    this.nleaf = i32(cap);  // body index, or EMPTY / INTERNAL / CROWD
    this.nchild = i32(cap * 4);
    this._shareGen = ++shareGeneration;
  }

  _grow() {
    const old = { x: this.x, y: this.y, vx: this.vx, vy: this.vy, ax: this.ax, ay: this.ay, r: this.r, m: this.m, colour: this.colour, home: this.home, black: this.black };
    this._alloc(this.cap * 2);
    for (const k of Object.keys(old)) this[k].set(old[k]);
  }

  // ---- cores -----------------------------------------------------------------------------------

  /** The unseen cores: one per nebula, on a bound eccentric orbit about their common centre. */
  _initCores() {
    const k = (this.k = Math.max(1, this.o.nebulae | 0));
    this.nebulaCount = k;
    const cap = k + 4; // room for a black hole or two
    for (const name of ['cx', 'cy', 'cvx', 'cvy', 'cax', 'cay', 'cm', 'ce2', 'cabsorb', 'spin']) this[name] = new Float64Array(cap);
    this.cpinned = new Uint8Array(cap);
    const { nebulaMass, coreFraction, periapsis, coreSoftening } = this.o;
    this.cm.fill(nebulaMass * coreFraction, 0, k);
    this.ce2.fill(coreSoftening * coreSoftening, 0, k);
    if (k === 1) { this.spin[0] = 1; return; }
    // lay them along the viewport's long axis, not further apart than the view can show
    const sep = Math.min(this.o.separation, 1.1 * Math.max(this.halfW, this.halfH));
    const along = this.halfW >= this.halfH ? [1, 0] : [0, 1];
    const across = [-along[1], along[0]];
    const total = k * nebulaMass; // bodies ride with their cores, so they count toward the orbit
    const rp = Math.min(periapsis, sep);
    const vRel = Math.sqrt(total * Math.max(0, 2 / sep - 2 / (sep + rp))); // vis-viva at apoapsis
    for (let c = 0; c < k; c++) {
      const s = (c - (k - 1) / 2) * sep;            // -sep/2, +sep/2
      this.cx[c] = along[0] * s;
      this.cy[c] = along[1] * s;
      const v = (c === 0 ? -1 : 1) * vRel / k;
      this.cvx[c] = across[0] * v;
      this.cvy[c] = across[1] * v;
      this.spin[c] = c % 2 === 0 ? 1 : -1;            // one prograde, one retrograde: classic tails
    }
  }

  // Random orbital velocities never sum to exactly zero: let each core absorb its disc's residual
  // momentum so every nebula, and the system, starts with the momentum its orbit was designed for.
  _balanceCores() {
    for (let c = 0; c < this.nebulaCount; c++) {
      if (this.cm[c] <= 0) continue;
      let px = 0, py = 0;
      for (let i = 0; i < this.n; i++) {
        if (this.home[i] !== c) continue;
        px += this.m[i] * (this.vx[i] - this.cvx[c]);
        py += this.m[i] * (this.vy[i] - this.cvy[c]);
      }
      this.cvx[c] -= px / this.cm[c];
      this.cvy[c] -= py / this.cm[c];
    }
    // The discs do not weigh exactly the same, so remove whatever net momentum is left by a
    // common velocity shift: the system's centre of mass then stays put.
    let px = 0, py = 0, mass = 0;
    for (let i = 0; i < this.n; i++) { px += this.m[i] * this.vx[i]; py += this.m[i] * this.vy[i]; mass += this.m[i]; }
    for (let c = 0; c < this.k; c++) { px += this.cm[c] * this.cvx[c]; py += this.cm[c] * this.cvy[c]; mass += this.cm[c]; }
    if (mass <= 0) return;
    const sx = px / mass, sy = py / mass;
    for (let i = 0; i < this.n; i++) { this.vx[i] -= sx; this.vy[i] -= sy; }
    for (let c = 0; c < this.k; c++) { this.cvx[c] -= sx; this.cvy[c] -= sy; }
  }

  /** Walk the tree on a pool of worker threads from now on (requires shared memory). */
  setPool(pool) {
    this.pool = pool;
    this._shareGenSent = -1;
  }

  /** The buffers a walker needs, for posting to workers. */
  sharedBuffers() {
    const b = (a) => a.buffer;
    return {
      x: b(this.x), y: b(this.y), r: b(this.r), ax: b(this.ax), ay: b(this.ay),
      nx: b(this.nx), ny: b(this.ny), nh: b(this.nh), nm: b(this.nm), ncx: b(this.ncx), ncy: b(this.ncy), nrmax: b(this.nrmax),
      nleaf: b(this.nleaf), nchild: b(this.nchild), ctrl: b(this._ctrl), touch: b(this._touching),
    };
  }

  /** Visible half-width and half-height in sim units; respawning and escape use them. */
  setViewport(halfW, halfH) {
    this.halfW = halfW;
    this.halfH = halfH;
  }

  get count() {
    return this.n;
  }

  /** Schwarzschild radius of the pointer's black hole, in sim units. */
  get holeRadius() {
    return schwarzschildRadius(this.o.holeMass, this.o.lightSpeed);
  }

  /** Put the black hole at (x, y), creating it if needed. It is pinned: it pulls but does not move. */
  setHole(x, y) {
    if (this.hole == null) {
      const c = (this.hole = this.k++);
      this.cm[c] = this.o.holeMass;
      this.ce2[c] = this.o.holeSoftening * this.o.holeSoftening;
      this.cabsorb[c] = this.holeRadius; // the event horizon: nothing inside comes back
      this.cpinned[c] = 1;
      this.cvx[c] = 0; this.cvy[c] = 0; this.cax[c] = 0; this.cay[c] = 0;
    }
    this.cx[this.hole] = x;
    this.cy[this.hole] = y;
  }

  /** Remove the black hole, if there is one. */
  clearHole() {
    if (this.hole == null) return;
    const c = this.hole;
    const last = --this.k;
    if (c !== last) {
      for (const a of [this.cx, this.cy, this.cvx, this.cvy, this.cax, this.cay, this.cm, this.ce2, this.cabsorb, this.spin]) a[c] = a[last];
      this.cpinned[c] = this.cpinned[last];
    }
    this.cpinned[last] = 0;
    this.cabsorb[last] = 0;
    this.hole = null;
  }

  /** Change how many bodies the sim keeps alive. Extra bodies spawn in place; surplus ones vanish. */
  setCount(target) {
    target = Math.max(0, Math.floor(target));
    this.o.bodies = target;
    while (this.n > target) this.n--;
    while (this.n < target) this._spawnInNebula(this.n % this.nebulaCount);
  }

  /** Mass of a body of the given radius, and the radius a body of the given mass draws at. */
  massOf(radius) { return this.density * Math.pow(radius, this.o.radiusExponent); }
  radiusOf(mass) { return Math.pow(mass / this.density, 1 / this.o.radiusExponent); }

  addBody(x, y, vx, vy, radius, colourIndex, home = 0) {
    if (this.n === this.cap) this._grow();
    const i = this.n++;
    this.x[i] = x; this.y[i] = y;
    this.vx[i] = vx; this.vy[i] = vy;
    this.ax[i] = 0; this.ay[i] = 0;
    this.r[i] = radius;
    this.m[i] = this.massOf(radius);
    this.colour[i] = colourIndex;
    this.home[i] = home;
    this.black[i] = 0;
    return i;
  }

  _randomRadius() {
    const { minRadius, maxRadius } = this.o;
    return minRadius + (maxRadius - minRadius) * this.random();
  }

  /** Circular speed at distance rho from a core, counting the disc mass inside rho. */
  _discSpeed(c, rho) {
    const { nebulaMass, coreFraction, coreSoftening, nebulaRadius } = this.o;
    const enclosed = Math.min(1, Math.pow(rho / nebulaRadius, 1 / this.o.profile));
    const discMass = nebulaMass * (1 - coreFraction) * enclosed;
    const vCore = circularSpeed(this.cm[c], coreSoftening, rho);
    return Math.sqrt(vCore * vCore + discMass / Math.max(rho, 0.5));
  }

  // A body in nebula c's disc, on a near-circular orbit about its core, riding with the core.
  _spawnInNebula(c) {
    const rho = this.o.nebulaRadius * Math.pow(this.random(), this.o.profile) + 0.3;
    const t = 2 * Math.PI * this.random();
    const ux = Math.cos(t), uy = Math.sin(t);
    const v = this.spin[c] * this._discSpeed(c, rho) * (0.96 + 0.08 * this.random());
    const pair = NEBULA_COLOURS[c % NEBULA_COLOURS.length];
    this.addBody(
      this.cx[c] + rho * ux, this.cy[c] + rho * uy,
      this.cvx[c] - uy * v, this.cvy[c] + ux * v,
      this._randomRadius(), pair[(this.n >> 1) & 1], c,
    );
  }

  // A fresh small body at the outer edge of nebula c, slightly sub-circular so it drifts inward.
  _spawnAtNebulaRim(c) {
    const rho = this.o.nebulaRadius * (0.85 + 0.2 * this.random());
    const t = 2 * Math.PI * this.random();
    const ux = Math.cos(t), uy = Math.sin(t);
    const v = this.spin[c] * this._discSpeed(c, rho) * (0.9 + 0.08 * this.random());
    const pair = NEBULA_COLOURS[c % NEBULA_COLOURS.length];
    this.addBody(
      this.cx[c] + rho * ux, this.cy[c] + rho * uy,
      this.cvx[c] - uy * v, this.cvy[c] + ux * v,
      this._randomRadius(), pair[(this.n >> 1) & 1], c,
    );
  }

  // ---- Barnes-Hut quadtree over the bodies (cores are handled directly) ------------------------

  _newNode(cx, cy, h) {
    if (this.nodes === this.treeCap) {
      const { nx, ny, nh, nm, ncx, ncy, nrmax, nleaf, nchild } = this;
      this._allocTree(this.treeCap * 2);
      this.nx.set(nx); this.ny.set(ny); this.nh.set(nh); this.nm.set(nm);
      this.ncx.set(ncx); this.ncy.set(ncy); this.nrmax.set(nrmax); this.nleaf.set(nleaf); this.nchild.set(nchild);
    }
    const k = this.nodes++;
    this.nx[k] = cx; this.ny[k] = cy; this.nh[k] = h;
    this.nm[k] = 0; this.ncx[k] = 0; this.ncy[k] = 0; this.nrmax[k] = 0;
    this.nleaf[k] = EMPTY;
    const c = k * 4;
    this.nchild[c] = this.nchild[c + 1] = this.nchild[c + 2] = this.nchild[c + 3] = -1;
    return k;
  }

  // Reorder the bodies along a Z-order (Morton) curve so that neighbours in space are
  // neighbours in memory: the tree then builds and walks with far fewer cache misses.
  _sortMorton(minX, minY, span) {
    const { n, x, y } = this;
    const keys = this._keys;
    const scale = 65535 / span;
    for (let i = 0; i < n; i++) {
      let a = ((x[i] - minX) * scale) | 0, b = ((y[i] - minY) * scale) | 0;
      a = (a | (a << 8)) & 0x00ff00ff; a = (a | (a << 4)) & 0x0f0f0f0f; a = (a | (a << 2)) & 0x33333333; a = (a | (a << 1)) & 0x55555555;
      b = (b | (b << 8)) & 0x00ff00ff; b = (b | (b << 4)) & 0x0f0f0f0f; b = (b | (b << 2)) & 0x33333333; b = (b | (b << 1)) & 0x55555555;
      keys[i] = ((a | (b << 1)) >>> 0) * 1048576 + i;
    }
    const view = keys.subarray(0, n);
    view.sort();
    const tmp = this._scratch, tmp8 = this._scratch8;
    for (const arr of [this.x, this.y, this.vx, this.vy, this.ax, this.ay, this.r, this.m]) {
      for (let i = 0; i < n; i++) tmp[i] = arr[view[i] % 1048576];
      arr.set(tmp.subarray(0, n));
    }
    for (const arr of [this.colour, this.home, this.black]) {
      for (let i = 0; i < n; i++) tmp8[i] = arr[view[i] % 1048576];
      arr.set(tmp8.subarray(0, n));
    }
  }

  _buildTree() {
    const { n, x, y, m, r } = this;
    this.nodes = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (x[i] < minX) minX = x[i]; if (x[i] > maxX) maxX = x[i];
      if (y[i] < minY) minY = y[i]; if (y[i] > maxY) maxY = y[i];
    }
    if (n > 64 && this.stats.steps % 8 === 0) this._sortMorton(minX, minY, Math.max(maxX - minX, maxY - minY, 1e-9));
    const half = Math.max(maxX - minX, maxY - minY, 1) * 0.5 * 1.001 + 1e-6;
    const root = this._newNode((minX + maxX) / 2, (minY + maxY) / 2, half);
    const { nx, ny, nh, nm, ncx, ncy, nrmax, nleaf, nchild } = this;

    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i], mi = m[i], ri = r[i];
      let node = root, depth = 0;
      for (;;) {
        nm[node] += mi; ncx[node] += mi * xi; ncy[node] += mi * yi;
        if (ri > nrmax[node]) nrmax[node] = ri;
        const leaf = nleaf[node];
        if (leaf === EMPTY) { nleaf[node] = i; break; }
        if (leaf === CROWD) break;
        if (leaf !== INTERNAL) {
          if (depth >= MAX_DEPTH) { nleaf[node] = CROWD; break; }
          const j = leaf;
          nleaf[node] = INTERNAL;
          const q = (x[j] > nx[node] ? 1 : 0) + (y[j] > ny[node] ? 2 : 0);
          const h = nh[node] * 0.5;
          const child = this._newNode(nx[node] + (q & 1 ? h : -h), ny[node] + (q & 2 ? h : -h), h);
          nchild[node * 4 + q] = child;
          nm[child] = m[j]; ncx[child] = m[j] * x[j]; ncy[child] = m[j] * y[j]; nrmax[child] = r[j];
          nleaf[child] = j;
        }
        const q = (xi > nx[node] ? 1 : 0) + (yi > ny[node] ? 2 : 0);
        let child = nchild[node * 4 + q];
        if (child < 0) {
          const h = nh[node] * 0.5;
          child = this._newNode(nx[node] + (q & 1 ? h : -h), ny[node] + (q & 2 ? h : -h), h);
          nchild[node * 4 + q] = child;
        }
        node = child;
        depth++;
      }
    }
    for (let k = 0; k < this.nodes; k++) {
      if (nm[k] > 0) { ncx[k] /= nm[k]; ncy[k] /= nm[k]; }
    }
    this.stats.nodes = this.nodes;
  }

  // Core forces (exact) and the tree build; the body-body walk follows, serial or on the pool.
  _prepareForces() {
    const { n, k, x, y, ax, ay, m, cx, cy, cax, cay, cm, ce2 } = this;

    // cores <-> cores, and cores <-> bodies (exact, pairwise, momentum-conserving)
    for (let c = 0; c < k; c++) { cax[c] = 0; cay[c] = 0; }
    for (let a = 0; a < k; a++) {
      for (let b = a + 1; b < k; b++) {
        const dx = cx[b] - cx[a], dy = cy[b] - cy[a];
        const q = dx * dx + dy * dy + ce2[a] + ce2[b];
        const inv = 1 / (q * Math.sqrt(q));
        cax[a] += inv * cm[b] * dx; cay[a] += inv * cm[b] * dy;
        cax[b] -= inv * cm[a] * dx; cay[b] -= inv * cm[a] * dy;
      }
    }
    for (let i = 0; i < n; i++) {
      let axi = 0, ayi = 0;
      const xi = x[i], yi = y[i], mi = m[i];
      for (let c = 0; c < k; c++) {
        const dx = cx[c] - xi, dy = cy[c] - yi;
        const q = dx * dx + dy * dy + ce2[c];
        const inv = 1 / (q * Math.sqrt(q));
        axi += inv * cm[c] * dx; ayi += inv * cm[c] * dy;
        cax[c] -= inv * mi * dx; cay[c] -= inv * mi * dy;
      }
      ax[i] = axi; ay[i] = ayi;
    }
    this._touchCount = 0;
    if (n < 2) return false;
    this._buildTree();
    return true;
  }

  _walkViews() {
    return {
      x: this.x, y: this.y, r: this.r, ax: this.ax, ay: this.ay,
      nx: this.nx, ny: this.ny, nh: this.nh, nm: this.nm, ncx: this.ncx, ncy: this.ncy, nrmax: this.nrmax,
      nleaf: this.nleaf, nchild: this.nchild,
      theta2: this.o.theta * this.o.theta, eps2: this.o.softening * this.o.softening, touchFactor: this.o.touchFactor,
    };
  }

  /** Forces on one thread. */
  _accelerate() {
    if (!this._prepareForces()) return;
    this._touchCount = walkRange(this._walkViews(), 0, this.n, this._stack, this._touching, 0, this._touchPer);
  }

  /** Forces with the tree walk spread over the worker pool. */
  async _accelerateAsync() {
    if (!this._prepareForces()) return;
    const regions = await this.pool.walk(this);
    // gather each walker's touching pairs into region 0 (they are disjoint by construction)
    const t = this._touching;
    let at = 0;
    for (const [start, count] of regions) {
      if (start !== at) t.copyWithin(at, start, start + count);
      at += count;
    }
    this._touchCount = at;
  }

  /** Exact all-pairs body accelerations (cores included) into (outX, outY); tests only. */
  _accelerateDirect(outX, outY) {
    const { n, k, x, y, m, cx, cy, cm, ce2 } = this;
    const { softening } = this.o;
    const eps2 = softening * softening;
    for (let i = 0; i < n; i++) {
      outX[i] = 0; outY[i] = 0;
      for (let c = 0; c < k; c++) {
        const dx = cx[c] - x[i], dy = cy[c] - y[i];
        const q = dx * dx + dy * dy + ce2[c];
        const inv = 1 / (q * Math.sqrt(q));
        outX[i] += inv * cm[c] * dx; outY[i] += inv * cm[c] * dy;
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = x[j] - x[i], dy = y[j] - y[i];
        const q = dx * dx + dy * dy + eps2;
        const inv = 1 / (q * Math.sqrt(q));
        outX[i] += inv * m[j] * dx; outY[i] += inv * m[j] * dy;
        outX[j] -= inv * m[i] * dx; outY[j] -= inv * m[i] * dy;
      }
    }
  }

  // ---- integration -------------------------------------------------------------------------------

  /** One fixed step of velocity Verlet (kick, drift, kick) for bodies and cores, then escapes. */
  step() {
    const h = this._beginStep();
    this._accelerate();
    this._finishStep(h);
  }

  /** The same step, with the tree walk on the worker pool. */
  async stepAsync() {
    if (!this.pool) { this.step(); return; }
    const h = this._beginStep();
    await this._accelerateAsync();
    this._finishStep(h);
  }

  _beginStep() {
    const { dt } = this.o;
    const h = dt / 2;
    const { x, y, vx, vy, ax, ay, k, cx, cy, cvx, cvy, cax, cay } = this;
    for (let i = 0; i < this.n; i++) {
      vx[i] += ax[i] * h; vy[i] += ay[i] * h;
      x[i] += vx[i] * dt; y[i] += vy[i] * dt;
    }
    const pinned = this.cpinned;
    for (let c = 0; c < k; c++) {
      if (pinned[c]) continue;
      cvx[c] += cax[c] * h; cvy[c] += cay[c] * h;
      cx[c] += cvx[c] * dt; cy[c] += cvy[c] * dt;
    }
    return h;
  }

  _finishStep(h) {
    const { vx, vy, ax, ay, k, cvx, cvy, cax, cay } = this;
    const pinned = this.cpinned;
    for (let i = 0; i < this.n; i++) { vx[i] += ax[i] * h; vy[i] += ay[i] * h; }
    for (let c = 0; c < k; c++) { if (!pinned[c]) { cvx[c] += cax[c] * h; cvy[c] += cay[c] * h; } }
    this._cull();
    this.time += this.o.dt;
    this.stats.steps++;
  }

  /** Absorb the real time elapsed since the last call and run whole steps. */
  advance(seconds) {
    this._acc += Math.min(Math.max(seconds, 0), this.o.maxFrame);
    while (this._acc >= this.o.dt) {
      this.step();
      this._acc -= this.o.dt;
    }
  }

  // Heavier body i absorbs j: mass and momentum add exactly; the radius follows from the mass.
  // Gentle impacts just combine. Harder ones throw off one to three fragments whose share of the
  // mass, and of the kinetic energy the inelastic merge destroys, grows with the impact intensity.
  _merge(i, j) {
    const { x, y, vx, vy, m, r, black } = this;
    const mi = m[i], mj = m[j], total = mi + mj;
    const rvx = vx[j] - vx[i], rvy = vy[j] - vy[i];
    const vrel = Math.hypot(rvx, rvy);
    x[i] = (x[i] * mi + x[j] * mj) / total;
    y[i] = (y[i] * mi + y[j] * mj) / total;
    vx[i] = (vx[i] * mi + vx[j] * mj) / total;
    vy[i] = (vy[i] * mi + vy[j] * mj) / total;
    let mass = total;
    let made = 0; // fragments created
    const isBlack = black[i] || black[j]; // a black hole swallows whole: nothing comes back out

    const { stickSpeed, shatterSpeed, fragmentFraction, fragmentEnergy, fragmentMinSpeed, eatRatio, fullRatio } = this.o;
    // Intensity grows with impact speed and fades as the masses diverge: a pebble hitting a boulder is eaten.
    const speedPart = Math.min(1, Math.max(0, (vrel - stickSpeed) / Math.max(1e-9, shatterSpeed - stickSpeed)));
    const ratio = Math.min(mi, mj) / Math.max(mi, mj);
    const ratioPart = Math.min(1, Math.max(0, (ratio - eatRatio) / Math.max(1e-9, fullRatio - eatRatio)));
    const intensity = isBlack ? 0 : speedPart * ratioPart;
    if (fragmentFraction > 0 && intensity > 0) {
      const lost = 0.5 * (mi * mj / total) * vrel * vrel;  // kinetic energy the merge destroys
      const budget = lost * fragmentEnergy * intensity * (0.4 + 0.6 * this.random());
      const ejected = fragmentFraction * intensity * Math.min(mi, mj);
      const count = 1 + Math.floor(intensity * 2.999 * this.random());
      // split the ejected mass unevenly among the fragments
      const weights = []; let wsum = 0;
      for (let f = 0; f < count; f++) { const w = 0.3 + this.random(); weights.push(w); wsum += w; }
      const rest = total - ejected;
      const recoil = 1 + ejected / rest; // energy the survivor's recoil will take, roughly
      let dx0 = -rvy, dy0 = rvx;
      const len = Math.hypot(dx0, dy0);
      if (len < 1e-9) { const a = 2 * Math.PI * this.random(); dx0 = Math.cos(a); dy0 = Math.sin(a); } else { dx0 /= len; dy0 /= len; }
      let pxf = 0, pyf = 0, massOut = 0;
      for (let f = 0; f < count; f++) {
        if (f === 0) made = 0;
        const mf = ejected * weights[f] / wsum;
        const ef = budget * weights[f] / wsum;
        const speed = Math.sqrt((2 * ef) / (mf * recoil));
        if (speed < fragmentMinSpeed) continue; // too slow to get clear: stays in the survivor
        const side = f % 2 === 0 ? 1 : -1;
        const a = (this.random() - 0.5) * 2.1, c = Math.cos(a), sn = Math.sin(a); // about +/- 60 degrees
        const ux = side * (dx0 * c - dy0 * sn), uy = side * (dx0 * sn + dy0 * c);
        const rf = this.radiusOf(mf);
        const gap = this.radiusOf(rest) + rf + 0.15 + 0.6 * f;
        const k = this.addBody(x[i] + ux * gap, y[i] + uy * gap, vx[i] + ux * speed, vy[i] + uy * speed, rf, this.colour[j], this.home[j]);
        this.m[k] = mf;
        pxf += mf * ux * speed; pyf += mf * uy * speed;
        massOut += mf;
        made++;
      }
      mass = total - massOut;
      // recoil keeps momentum exact
      vx[i] -= pxf / mass;
      vy[i] -= pyf / mass;
    }
    m[i] = mass;
    // Collapse: once the Schwarzschild radius reaches the body's own size, it is a black hole.
    const rs = schwarzschildRadius(mass, this.o.lightSpeed);
    if (isBlack || rs >= this.radiusOf(mass)) {
      if (!black[i]) this.stats.collapses++;
      black[i] = 1;
      this.colour[i] = BLACK;
      r[i] = rs;
    } else {
      r[i] = this.radiusOf(mass);
    }
    return made;
  }

  // Merge touching bodies, drop bodies flung far out of view or swallowed by a black hole,
  // then top the population back up inside the nebulae.
  _cull() {
    const { x, y, r, m, colour, home } = this;
    const dead = this._dead;
    const far = 3 * Math.max(this.halfW, this.halfH);
    const far2 = far * far;
    let changed = false;
    const t = this._touching;
    const chance = this.o.mergeChance;
    for (let k = 0; k < this._touchCount; k += 2) {
      let i = t[k], j = t[k + 1];
      if (dead[i] || dead[j]) continue;
      if (chance < 1 && this.random() >= chance) continue;
      if (m[j] > m[i]) { const s = i; i = j; j = s; }
      const made = this._merge(i, j);
      dead[j] = 1;
      this.stats.merges++;
      // The population target follows the real change (one body gone, fragments added), so
      // merging never triggers a respawn; set replaceMerged to refill from the rim instead.
      if (!this.o.replaceMerged) this.o.bodies = Math.max(0, this.o.bodies - 1 + made);
      changed = true;
    }
    for (let i = 0; i < this.n; i++) {
      if (x[i] * x[i] + y[i] * y[i] > far2) { dead[i] = 1; this.stats.escaped++; changed = true; }
    }
    if (this.hole != null) {
      const c = this.hole, hx = this.cx[c], hy = this.cy[c], rr = this.cabsorb[c] * this.cabsorb[c];
      for (let i = 0; i < this.n; i++) {
        const dx = x[i] - hx, dy = y[i] - hy;
        if (dx * dx + dy * dy < rr) { dead[i] = 1; this.stats.swallowed++; changed = true; }
      }
    }
    if (!changed) return;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      if (dead[i]) { dead[i] = 0; continue; }
      if (w !== i) {
        x[w] = x[i]; y[w] = y[i];
        this.vx[w] = this.vx[i]; this.vy[w] = this.vy[i];
        this.ax[w] = this.ax[i]; this.ay[w] = this.ay[i];
        r[w] = r[i]; m[w] = m[i]; colour[w] = colour[i]; home[w] = home[i]; this.black[w] = this.black[i];
      }
      w++;
    }
    this.n = w;
    while (this.n < this.o.bodies) this._spawnAtNebulaRim(Math.floor(this.random() * this.nebulaCount));
  }

  /** Total momentum of bodies and cores, for tests. */
  momentum() {
    let px = 0, py = 0;
    for (let i = 0; i < this.n; i++) { px += this.m[i] * this.vx[i]; py += this.m[i] * this.vy[i]; }
    for (let c = 0; c < this.k; c++) { px += this.cm[c] * this.cvx[c]; py += this.cm[c] * this.cvy[c]; }
    return [px, py];
  }

  /** Total mechanical energy (kinetic + softened potential), exact; for tests only. */
  energy() {
    const { n, k, x, y, vx, vy, m, cx, cy, cvx, cvy, cm, ce2 } = this;
    const { softening } = this.o;
    const eps2 = softening * softening;
    let e = 0;
    for (let c = 0; c < k; c++) {
      e += 0.5 * cm[c] * (cvx[c] * cvx[c] + cvy[c] * cvy[c]);
      for (let d = c + 1; d < k; d++) {
        const dx = cx[d] - cx[c], dy = cy[d] - cy[c];
        e -= (cm[c] * cm[d]) / Math.sqrt(dx * dx + dy * dy + ce2[c] + ce2[d]);
      }
    }
    for (let i = 0; i < n; i++) {
      e += 0.5 * m[i] * (vx[i] * vx[i] + vy[i] * vy[i]);
      for (let c = 0; c < k; c++) {
        const dx = cx[c] - x[i], dy = cy[c] - y[i];
        e -= (cm[c] * m[i]) / Math.sqrt(dx * dx + dy * dy + ce2[c]);
      }
      for (let j = i + 1; j < n; j++) {
        const dx = x[j] - x[i], dy = y[j] - y[i];
        e -= (m[i] * m[j]) / Math.sqrt(dx * dx + dy * dy + eps2);
      }
    }
    return e;
  }
}
