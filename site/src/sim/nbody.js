// Two nebulae of stars on a collision course, under softened Newtonian gravity.
//
// This module is the reference simulation: the CPU holds every body and integrates with a
// Barnes-Hut quadtree. In browsers with WebGPU the integration runs on the GPU instead
// (see gpu.js), using this class for the setup, the cores, and the housekeeping.
//
// Units: distance in "sim units", where the shorter side of the viewport spans 100 units;
// time in seconds; G = 1. Coordinates follow the screen: origin at the centre, y grows downward.
//
// A star's drawn disc is a symbol. Its real radius is negligible next to its spacing, so stars
// never touch: the dynamics are collisionless gravity, which is what galaxy encounters are.

export const COLOURS = ['#3A7BD5', '#F28C28']; // one colour per nebula: blue, orange

export const DEFAULTS = {
  bodies: 50000,
  nebulaMass: 3000,      // each: unseen core plus stars
  coreFraction: 0.7,     // share of nebulaMass in the unseen core (a dark halo, in effect)
  nebulaRadius: 42,      // where a nebula's disc is truncated, in sim units
  scaleLength: 12,       // exponential disc scale length: surface density falls as exp(-r / h)
  dispersion: 0.08,      // random radial / tangential velocity kick, as a fraction of circular speed
  fallG: 160,            // the downward field when the page "falls" (sim units / s^2)
  bounce: 0.35,          // restitution at the floor
  bankDepth: 7,          // how thick the bank of fallen stars is (sim units)
  coreSoftening: 5,      // Plummer softening of the cores
  softening: 1,          // Plummer softening between stars
  separation: 110,       // starting distance between the two cores (their apoapsis)
  periapsis: 25,         // closest approach of the cores' mutual orbit
  minRadius: 0.03,       // drawn radius of a star, in sim units (well under a pixel)
  maxRadius: 0.09,
  holeMass: 1500,        // the black hole placed under the pointer
  holeSoftening: 3,
  lightSpeed: 46,        // c, sim units per second (G = 1): sets the hole's Schwarzschild radius
  theta: 1.0,            // Barnes-Hut opening angle (0.8% rms force error)
  dt: 1 / 120,           // fixed physics step
  maxFrame: 0.05,        // most real time absorbed by one advance() call
  halfW: 80,             // visible half-extents, in sim units (see setViewport)
  halfH: 50,
  random: Math.random,
  prime: true,           // compute the initial accelerations (false when a GPU engine will)
};

const EMPTY = -1, INTERNAL = -2, CROWD = -3; // quadtree leaf states
const MAX_DEPTH = 24;

/** Schwarzschild radius of a mass m: 2 G m / c^2, with G = 1. */
/** A star's resting height in the bank of fallen stars: a hash of its slot, denser at the bottom. */
export function bankOffset(i, depth) {
  const u = (Math.imul(i + 1, 2654435761) >>> 0) / 4294967296;
  return 0.3 + depth * u * u;
}

export function schwarzschildRadius(m, c) {
  return (2 * m) / (c * c);
}

/** Speed of a circular orbit at distance rho around a mass m with Plummer softening e. */
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
    this.stats = { escaped: 0, swallowed: 0, steps: 0 };
    this._acc = 0;
    this.n = 0;
    this._alloc(Math.max(64, Math.ceil(this.o.bodies * 1.1)));
    this._stack = new Int32Array(4096);
    this._initCores();
    for (let i = 0; i < this.o.bodies; i++) this._spawn(i % 2);
    // star masses: m = density * r^3, with the density set by the mass budget
    let sum = 0;
    for (let i = 0; i < this.n; i++) sum += this.r[i] ** 3;
    this.density = sum > 0 ? (2 * this.o.nebulaMass * (1 - this.o.coreFraction)) / sum : 1;
    for (let i = 0; i < this.n; i++) this.m[i] = this.density * this.r[i] ** 3;
    this._balanceMomentum();
    if (this.o.prime) this._accelerate();
  }

  _alloc(cap) {
    this.cap = cap;
    for (const k of ['x', 'y', 'vx', 'vy', 'ax', 'ay', 'r', 'm']) this[k] = new Float64Array(cap);
    this.colour = new Uint8Array(cap);
    this.floor = new Float32Array(cap); // each star's resting height in the bank, as an offset above the bottom edge
    this.home = new Uint8Array(cap);
    this._dead = new Uint8Array(cap);
    this._keys = new Float64Array(cap);
    this._scratch = new Float64Array(cap);
    this._scratch8 = new Uint8Array(cap);
    this._allocTree(cap * 4 + 64);
  }

  _allocTree(cap) {
    this.treeCap = cap;
    for (const k of ['nx', 'ny', 'nh', 'nm', 'ncx', 'ncy']) this[k] = new Float64Array(cap);
    this.nleaf = new Int32Array(cap);
    this.nchild = new Int32Array(cap * 4);
  }

  // ---- cores -----------------------------------------------------------------------------------

  /** Two unseen cores on a bound eccentric orbit about their common centre, plus room for the hole. */
  _initCores() {
    this.k = 2;
    for (const name of ['cx', 'cy', 'cvx', 'cvy', 'cax', 'cay', 'cm', 'ce2', 'spin']) this[name] = new Float64Array(3);
    this.cpinned = new Uint8Array(3);
    const { nebulaMass, coreFraction, periapsis, coreSoftening } = this.o;
    this.cm.fill(nebulaMass * coreFraction, 0, 2);
    this.ce2.fill(coreSoftening * coreSoftening, 0, 2);
    // lay them along the viewport's long axis, not further apart than the view can show
    const sep = Math.min(this.o.separation, 1.1 * Math.max(this.halfW, this.halfH));
    const along = this.halfW >= this.halfH ? [1, 0] : [0, 1];
    const across = [-along[1], along[0]];
    const total = 2 * nebulaMass; // stars ride with their cores, so they count toward the orbit
    const rp = Math.min(periapsis, sep);
    const vRel = Math.sqrt(total * Math.max(0, 2 / sep - 2 / (sep + rp))); // vis-viva at apoapsis
    for (let c = 0; c < 2; c++) {
      const s = (c - 0.5) * sep;
      this.cx[c] = along[0] * s;
      this.cy[c] = along[1] * s;
      const v = (c === 0 ? -1 : 1) * vRel / 2;
      this.cvx[c] = across[0] * v;
      this.cvy[c] = across[1] * v;
      this.spin[c] = c === 0 ? 1 : -1; // one prograde, one retrograde: classic tidal tails
    }
    this.hole = null;
    this.fall = 0;        // 0: gravity as usual; 1: a uniform downward field and a floor instead
    this.fallen = false;
    this.recovering = false;
  }

  // Random orbital velocities never sum to exactly zero: let each core absorb its disc's residual,
  // then remove whatever is left with a common shift, so the system starts exactly at rest.
  _balanceMomentum() {
    for (let c = 0; c < 2; c++) {
      let px = 0, py = 0;
      for (let i = 0; i < this.n; i++) {
        if (this.home[i] !== c) continue;
        px += this.m[i] * (this.vx[i] - this.cvx[c]);
        py += this.m[i] * (this.vy[i] - this.cvy[c]);
      }
      this.cvx[c] -= px / this.cm[c];
      this.cvy[c] -= py / this.cm[c];
    }
    let px = 0, py = 0, mass = 0;
    for (let i = 0; i < this.n; i++) { px += this.m[i] * this.vx[i]; py += this.m[i] * this.vy[i]; mass += this.m[i]; }
    for (let c = 0; c < this.k; c++) { px += this.cm[c] * this.cvx[c]; py += this.cm[c] * this.cvy[c]; mass += this.cm[c]; }
    const sx = px / mass, sy = py / mass;
    for (let i = 0; i < this.n; i++) { this.vx[i] -= sx; this.vy[i] -= sy; }
    for (let c = 0; c < this.k; c++) { this.cvx[c] -= sx; this.cvy[c] -= sy; }
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
  /**
   * How far the page has "fallen", 0..1: mutual gravity fades out as a uniform downward field
   * and a floor fade in. Coming back from a fall, the banked stars are returned to the discs.
   */
  setFall(f) {
    this.fall = Math.min(1, Math.max(0, f));
    if (this.fall > 0.6) this.fallen = true;
    if (this.fall < 0.25 && this.fallen) { this.fallen = false; this.recovering = true; }
  }

  setHole(x, y) {
    if (this.hole == null) {
      const c = (this.hole = this.k++);
      this.cm[c] = this.o.holeMass;
      this.ce2[c] = this.o.holeSoftening * this.o.holeSoftening;
      this.cpinned[c] = 1;
      this.cvx[c] = 0; this.cvy[c] = 0; this.cax[c] = 0; this.cay[c] = 0;
    }
    this.cx[this.hole] = x;
    this.cy[this.hole] = y;
  }

  /** Remove the black hole, if there is one. */
  clearHole() {
    if (this.hole == null) return;
    this.k--;
    this.cpinned[this.hole] = 0;
    this.hole = null;
  }

  // ---- stars -------------------------------------------------------------------------------------

  addBody(x, y, vx, vy, radius, colourIndex, home) {
    const i = this.n++;
    this.x[i] = x; this.y[i] = y;
    this.vx[i] = vx; this.vy[i] = vy;
    this.ax[i] = 0; this.ay[i] = 0;
    this.r[i] = radius;
    this.m[i] = (this.density ?? 1) * radius ** 3;
    this.colour[i] = colourIndex;
    this.floor[i] = bankOffset(i, this.o.bankDepth);
    this.home[i] = home;
    return i;
  }

  /** Circular speed at distance rho from a core, counting the disc mass inside rho. */
  // Fraction of an exponential disc's mass inside rho, normalised to the truncation radius.
  _enclosed(rho) {
    const { nebulaRadius: R, scaleLength: h } = this.o;
    const m = (r) => 1 - (1 + r / h) * Math.exp(-r / h);
    return Math.min(1, m(rho) / m(R));
  }

  _discSpeed(c, rho) {
    const { nebulaMass, coreFraction, coreSoftening } = this.o;
    const discMass = nebulaMass * (1 - coreFraction) * this._enclosed(rho);
    const vCore = circularSpeed(this.cm[c], coreSoftening, rho);
    return Math.sqrt(vCore * vCore + discMass / Math.max(rho, 0.5));
  }

  // A star in nebula c's exponential disc (or, with `rim`, out at its faint edge, drifting
  // inward), on a near-circular orbit about its core with a little random motion, riding with
  // the core. The exponential profile has no edge: the disc just thins out.
  _spawn(c, rim = false) {
    const { nebulaRadius: R, scaleLength: h, dispersion, minRadius, maxRadius } = this.o;
    let rho;
    if (rim) rho = R * (0.85 + 0.15 * this.random());
    else do rho = -h * Math.log(this.random() * this.random()); while (rho > R); // r e^(-r/h)
    rho = Math.max(rho, 0.3);
    const t = 2 * Math.PI * this.random();
    const ux = Math.cos(t), uy = Math.sin(t);
    const vc = this._discSpeed(c, rho);
    const vt = this.spin[c] * vc * ((rim ? 0.9 : 1) + dispersion * (2 * this.random() - 1));
    const vr = vc * dispersion * (2 * this.random() - 1) - (rim ? 0.05 * vc : 0);
    const radius = minRadius + (maxRadius - minRadius) * this.random();
    this.addBody(this.cx[c] + rho * ux, this.cy[c] + rho * uy, this.cvx[c] - uy * vt + ux * vr, this.cvy[c] + ux * vt + uy * vr, radius, c, c);
  }

  // ---- forces (reference, Barnes-Hut) ------------------------------------------------------------

  // Reorder the stars along a Z-order (Morton) curve so neighbours in space are neighbours in
  // memory: the tree then builds and walks with fewer cache misses. Every few steps is enough.
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
    for (const arr of [this.colour, this.home]) {
      for (let i = 0; i < n; i++) tmp8[i] = arr[view[i] % 1048576];
      arr.set(tmp8.subarray(0, n));
    }
  }

  _newNode(cx, cy, h) {
    if (this.nodes === this.treeCap) {
      const old = { nx: this.nx, ny: this.ny, nh: this.nh, nm: this.nm, ncx: this.ncx, ncy: this.ncy, nleaf: this.nleaf, nchild: this.nchild };
      this._allocTree(this.treeCap * 2);
      for (const k of Object.keys(old)) this[k].set(old[k]);
    }
    const k = this.nodes++;
    this.nx[k] = cx; this.ny[k] = cy; this.nh[k] = h;
    this.nm[k] = 0; this.ncx[k] = 0; this.ncy[k] = 0;
    this.nleaf[k] = EMPTY;
    this.nchild.fill(-1, k * 4, k * 4 + 4);
    return k;
  }

  _buildTree() {
    const { n, x, y, m } = this;
    this.nodes = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (x[i] < minX) minX = x[i]; if (x[i] > maxX) maxX = x[i];
      if (y[i] < minY) minY = y[i]; if (y[i] > maxY) maxY = y[i];
    }
    if (n > 64 && this.stats.steps % 8 === 0) this._sortMorton(minX, minY, Math.max(maxX - minX, maxY - minY, 1e-9));
    const half = Math.max(maxX - minX, maxY - minY, 1) * 0.5 * 1.001 + 1e-6;
    const root = this._newNode((minX + maxX) / 2, (minY + maxY) / 2, half);
    const { nx, ny, nh, nm, ncx, ncy, nleaf, nchild } = this;
    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i], mi = m[i];
      let node = root, depth = 0;
      for (;;) {
        nm[node] += mi; ncx[node] += mi * xi; ncy[node] += mi * yi;
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
          nm[child] = m[j]; ncx[child] = m[j] * x[j]; ncy[child] = m[j] * y[j];
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
  }

  /** Accelerations on cores (from everything) and on stars (cores exactly, stars via the tree). */
  _accelerate() {
    this._coreForces();
    if (this.n < 2) return;
    this._buildTree();
    const { n, x, y, ax, ay, nx, ny, nh, nm, ncx, ncy, nleaf, nchild } = this;
    const eps2 = this.o.softening ** 2, theta2 = this.o.theta ** 2, mu = 1 - this.fall;
    const stack = this._stack;
    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i];
      let axi = 0, ayi = 0, sp = 0;
      stack[sp++] = 0;
      while (sp > 0) {
        const node = stack[--sp];
        const leaf = nleaf[node];
        if (leaf === i) continue;
        const dx = ncx[node] - xi, dy = ncy[node] - yi;
        const d2 = dx * dx + dy * dy;
        let open = false;
        if (leaf === INTERNAL) {
          // a cell that contains this star must be opened: its lump would include the star itself
          const h = nh[node];
          const inside = xi > nx[node] - h && xi <= nx[node] + h && yi > ny[node] - h && yi <= ny[node] + h;
          const s = 2 * h;
          open = inside || s * s >= theta2 * d2;
        }
        if (!open) {
          const q = d2 + eps2;
          const f = nm[node] / (q * Math.sqrt(q));
          axi += f * dx;
          ayi += f * dy;
        } else {
          const c = node * 4;
          for (let j = 0; j < 4; j++) {
            const ch = nchild[c + j];
            if (ch >= 0 && nleaf[ch] !== EMPTY) stack[sp++] = ch;
          }
        }
      }
      ax[i] += axi * mu;
      ay[i] += ayi * mu;
    }
  }

  /** Core <-> core and core <-> star forces, exact and pairwise. Resets star accelerations. */
  _coreForces() {
    const { n, k, x, y, ax, ay, m, cx, cy, cax, cay, cm, ce2 } = this;
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
    const mu = 1 - this.fall;
    for (let i = 0; i < n; i++) {
      let axi = 0, ayi = 0;
      const xi = x[i], yi = y[i], mi = m[i];
      for (let c = 0; c < k; c++) {
        const w = c === this.hole ? 1 : mu; // the pointer's hole keeps its pull through a fall
        const dx = cx[c] - xi, dy = cy[c] - yi;
        const q = dx * dx + dy * dy + ce2[c];
        const inv = w / (q * Math.sqrt(q));
        axi += inv * cm[c] * dx; ayi += inv * cm[c] * dy;
        cax[c] -= inv * mi * dx; cay[c] -= inv * mi * dy;
      }
      ax[i] = axi; ay[i] = ayi;
    }
  }

  /** Exact all-pairs star accelerations (cores included) into (outX, outY); tests only. */
  _accelerateDirect(outX, outY) {
    const { n, k, x, y, m, cx, cy, cm, ce2 } = this;
    const eps2 = this.o.softening ** 2;
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

  /** One fixed step of velocity Verlet (kick, drift, kick) for stars and cores, then housekeeping. */
  step() {
    const { dt } = this.o;
    const h = dt / 2;
    const { x, y, vx, vy, ax, ay } = this;
    for (let i = 0; i < this.n; i++) {
      vx[i] += ax[i] * h; vy[i] += ay[i] * h;
      x[i] += vx[i] * dt; y[i] += vy[i] * dt;
    }
    if (this.fall > 0) this._floor();
    this.driftCores(dt);
    this._accelerate();
    if (this.fall > 0) {
      const g = this.fall * this.o.fallG;
      for (let i = 0; i < this.n; i++) ay[i] += g;
    }
    for (let i = 0; i < this.n; i++) { vx[i] += ax[i] * h; vy[i] += ay[i] * h; }
    this.kickCores(h);
    this.cull();
    this.time += dt;
    this.stats.steps++;
  }

  /** During a fall, stars that reach their resting height in the bank bounce and settle. */
  _floor() {
    const { n, y, vx, vy, floor } = this;
    const bottom = this.halfH, bounce = this.o.bounce;
    for (let i = 0; i < n; i++) {
      const fy = bottom - floor[i];
      if (y[i] > fy) {
        y[i] = fy;
        if (vy[i] > 0) vy[i] = -vy[i] * bounce;
        vx[i] *= 0.97;
      }
    }
  }

  /** Cores: half-kick with the current accelerations, then drift. */
  driftCores(dt) {
    const { k, cx, cy, cvx, cvy, cax, cay, cpinned } = this;
    const h = dt / 2;
    for (let c = 0; c < k; c++) {
      if (cpinned[c]) continue;
      cvx[c] += cax[c] * h; cvy[c] += cay[c] * h;
      cx[c] += cvx[c] * dt; cy[c] += cvy[c] * dt;
    }
  }

  /** Cores: the second half-kick. */
  kickCores(h) {
    const { k, cvx, cvy, cax, cay, cpinned } = this;
    for (let c = 0; c < k; c++) { if (!cpinned[c]) { cvx[c] += cax[c] * h; cvy[c] += cay[c] * h; } }
  }

  /** Absorb the real time elapsed since the last call and run whole steps. */
  advance(seconds) {
    this._acc += Math.min(Math.max(seconds, 0), this.o.maxFrame);
    while (this._acc >= this.o.dt) {
      this.step();
      this._acc -= this.o.dt;
    }
  }

  /**
   * Stars that fell into the black hole or were flung far out of view are replaced at a nebula's
   * rim. Returns the indices rewritten, for a GPU mirror to copy; null if nothing changed.
   */
  cull() {
    const { x, y, n } = this;
    const dead = this._dead;
    const far = 3 * Math.max(this.halfW, this.halfH), far2 = far * far;
    let changed = 0;
    for (let i = 0; i < n; i++) {
      if (x[i] * x[i] + y[i] * y[i] > far2) { dead[i] = 1; this.stats.escaped++; changed++; }
    }
    if (this.hole != null) {
      const c = this.hole, hx = this.cx[c], hy = this.cy[c], rr = this.holeRadius ** 2;
      for (let i = 0; i < n; i++) {
        const dx = x[i] - hx, dy = y[i] - hy;
        if (!dead[i] && dx * dx + dy * dy < rr) { dead[i] = 1; this.stats.swallowed++; changed++; }
      }
    }
    if (this.recovering) {
      // after a fall: a few percent of the banked stars per step go back into the discs
      const band = this.halfH - this.o.bankDepth - 1;
      let quota = Math.ceil(0.04 * n), found = 0;
      for (let i = 0; i < n; i++) {
        if (dead[i] || y[i] < band) continue;
        found++;
        if (quota > 0) { dead[i] = 2; quota--; changed++; }
      }
      if (!found) this.recovering = false;
    }
    if (!changed) return null;
    const rewritten = [];
    for (let i = 0; i < n; i++) {
      if (!dead[i]) continue;
      const rim = dead[i] === 1;
      dead[i] = 0;
      this.n = i;                       // respawn writes into slot i
      this._spawn(this.home[i], rim);
      rewritten.push(i);
    }
    this.n = n;
    return rewritten;
  }

  /** Total momentum of stars and cores, for tests. */
  momentum() {
    let px = 0, py = 0;
    for (let i = 0; i < this.n; i++) { px += this.m[i] * this.vx[i]; py += this.m[i] * this.vy[i]; }
    for (let c = 0; c < this.k; c++) { px += this.cm[c] * this.cvx[c]; py += this.cm[c] * this.cvy[c]; }
    return [px, py];
  }

  /** Total mechanical energy (kinetic + softened potential), exact; for tests only. */
  energy() {
    const { n, k, x, y, vx, vy, m, cx, cy, cvx, cvy, cm, ce2 } = this;
    const eps2 = this.o.softening ** 2;
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
