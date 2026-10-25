// N-body gravity with a Barnes-Hut quadtree. No DOM, no React: runs in a Web Worker and under `node --test`.
//
// Two nebulae, each a disc of small bodies around an unseen core, on an eccentric mutual orbit.
// Units: distance in "sim units", where the shorter side of the viewport spans 100 units;
// time in seconds; G = 1. Coordinates follow the screen: origin at the centre, y grows downward.

export const COLOURS = ['#E24e42', '#e9b000', '#EB6E80', '#008F95'];
const NEBULA_COLOURS = [[0, 1], [2, 3]]; // each nebula draws from its own pair

export const DEFAULTS = {
  bodies: 6000,          // number of bodies the sim keeps alive, shared between the nebulae
  nebulae: 2,
  nebulaMass: 3000,      // each, unseen core plus bodies
  coreFraction: 0.7,     // share of nebulaMass sitting in the unseen core
  nebulaRadius: 28,      // disc radius in sim units
  coreSoftening: 5,      // Plummer softening of the cores (keeps them from slingshotting bodies)
  softening: 1,          // Plummer softening for body-body forces
  separation: 110,       // starting distance between the two cores (their apoapsis)
  periapsis: 25,         // closest approach of the cores' mutual orbit
  holeMass: 4500,        // the black hole placed under the pointer
  holeSoftening: 2.5,
  holeRadius: 1.4,       // bodies inside this are swallowed (and respawn in a nebula)
  massPerArea: null,     // body mass per radius^2; derived from the masses above unless set (tests)
  minRadius: 0.12,       // drawn radius; ~1px on a laptop
  maxRadius: 0.4,
  theta: 0.75,           // Barnes-Hut opening angle; lower is more accurate and slower
  dt: 1 / 120,           // fixed physics step
  maxFrame: 0.05,        // most real time absorbed by one advance() call
  halfW: 80,             // visible half-extents, in sim units (see setViewport)
  halfH: 50,
  random: Math.random,
};

const EMPTY = -1, INTERNAL = -2, CROWD = -3; // quadtree leaf states (CROWD: several coincident bodies)
const MAX_DEPTH = 24;
const PROFILE = 0.6; // body radius within a nebula is R * u^PROFILE: denser toward the core

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
    this.stats = { escaped: 0, swallowed: 0, steps: 0, nodes: 0 };
    this.hole = null;
    this._acc = 0;
    this.n = 0;
    this._alloc(Math.max(64, this.o.bodies * 2));
    this._stack = new Int32Array(4096);
    this._initCores();
    this.massPerArea = this.o.massPerArea ?? 1; // provisional until the population exists
    for (let i = 0; i < this.o.bodies; i++) this._spawnInNebula(i % this.nebulaCount);
    if (this.o.massPerArea == null) {
      let sumR2 = 0;
      for (let i = 0; i < this.n; i++) sumR2 += this.r[i] * this.r[i];
      const bodyMass = this.k * this.o.nebulaMass * (1 - this.o.coreFraction);
      this.massPerArea = sumR2 > 0 ? bodyMass / sumR2 : 1;
      for (let i = 0; i < this.n; i++) this.m[i] = this.massPerArea * this.r[i] * this.r[i];
    }
    this._accelerate();
  }

  _alloc(cap) {
    this.cap = cap;
    for (const k of ['x', 'y', 'vx', 'vy', 'ax', 'ay', 'r', 'm']) this[k] = new Float64Array(cap);
    this.colour = new Uint8Array(cap);
    this.home = new Uint8Array(cap);
    this._dead = new Uint8Array(cap);
    this._allocTree(cap * 4 + 64);
  }

  _allocTree(cap) {
    this.treeCap = cap;
    this.nx = new Float64Array(cap);   // cell centre
    this.ny = new Float64Array(cap);
    this.nh = new Float64Array(cap);   // cell half-size
    this.nm = new Float64Array(cap);   // mass in cell
    this.ncx = new Float64Array(cap);  // centre of mass (sum m*x during the build)
    this.ncy = new Float64Array(cap);
    this.nleaf = new Int32Array(cap);  // body index, or EMPTY / INTERNAL / CROWD
    this.nchild = new Int32Array(cap * 4);
  }

  _grow() {
    const old = { x: this.x, y: this.y, vx: this.vx, vy: this.vy, ax: this.ax, ay: this.ay, r: this.r, m: this.m, colour: this.colour, home: this.home };
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

  /** Visible half-width and half-height in sim units; respawning and escape use them. */
  setViewport(halfW, halfH) {
    this.halfW = halfW;
    this.halfH = halfH;
  }

  get count() {
    return this.n;
  }

  /** Put the black hole at (x, y), creating it if needed. It is pinned: it pulls but does not move. */
  setHole(x, y) {
    if (this.hole == null) {
      const c = (this.hole = this.k++);
      this.cm[c] = this.o.holeMass;
      this.ce2[c] = this.o.holeSoftening * this.o.holeSoftening;
      this.cabsorb[c] = this.o.holeRadius;
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

  addBody(x, y, vx, vy, radius, colourIndex, home = 0) {
    if (this.n === this.cap) this._grow();
    const i = this.n++;
    this.x[i] = x; this.y[i] = y;
    this.vx[i] = vx; this.vy[i] = vy;
    this.ax[i] = 0; this.ay[i] = 0;
    this.r[i] = radius;
    this.m[i] = this.massPerArea * radius * radius;
    this.colour[i] = colourIndex;
    this.home[i] = home;
    return i;
  }

  _randomRadius() {
    const { minRadius, maxRadius } = this.o;
    return minRadius + (maxRadius - minRadius) * this.random();
  }

  /** Circular speed at distance rho from a core, counting the disc mass inside rho. */
  _discSpeed(c, rho) {
    const { nebulaMass, coreFraction, coreSoftening, nebulaRadius } = this.o;
    const enclosed = Math.min(1, Math.pow(rho / nebulaRadius, 1 / PROFILE));
    const discMass = nebulaMass * (1 - coreFraction) * enclosed;
    const vCore = circularSpeed(this.cm[c], coreSoftening, rho);
    return Math.sqrt(vCore * vCore + discMass / Math.max(rho, 0.5));
  }

  // A body in nebula c's disc, on a near-circular orbit about its core, riding with the core.
  _spawnInNebula(c) {
    const rho = this.o.nebulaRadius * Math.pow(this.random(), PROFILE) + 0.3;
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

  // ---- Barnes-Hut quadtree over the bodies (cores are handled directly) ------------------------

  _newNode(cx, cy, h) {
    if (this.nodes === this.treeCap) {
      const { nx, ny, nh, nm, ncx, ncy, nleaf, nchild } = this;
      this._allocTree(this.treeCap * 2);
      this.nx.set(nx); this.ny.set(ny); this.nh.set(nh); this.nm.set(nm);
      this.ncx.set(ncx); this.ncy.set(ncy); this.nleaf.set(nleaf); this.nchild.set(nchild);
    }
    const k = this.nodes++;
    this.nx[k] = cx; this.ny[k] = cy; this.nh[k] = h;
    this.nm[k] = 0; this.ncx[k] = 0; this.ncy[k] = 0;
    this.nleaf[k] = EMPTY;
    const c = k * 4;
    this.nchild[c] = this.nchild[c + 1] = this.nchild[c + 2] = this.nchild[c + 3] = -1;
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
    this.stats.nodes = this.nodes;
  }

  _accelerate() {
    const { n, k, x, y, ax, ay, m, cx, cy, cax, cay, cm, ce2 } = this;
    const { softening, theta } = this.o;
    const eps2 = softening * softening;
    const theta2 = theta * theta;

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
    if (n < 2) return;

    // bodies <-> bodies through the tree
    this._buildTree();
    const { nh, nm, ncx, ncy, nleaf, nchild } = this;
    const stack = this._stack;
    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i];
      let axi = 0, ayi = 0;
      let sp = 0;
      stack[sp++] = 0;
      while (sp > 0) {
        const node = stack[--sp];
        const leaf = nleaf[node];
        if (leaf === i) continue;
        const dx = ncx[node] - xi, dy = ncy[node] - yi;
        const d2 = dx * dx + dy * dy;
        const s = nh[node] * 2;
        if (leaf !== INTERNAL || s * s < theta2 * d2) {
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
      ax[i] += axi;
      ay[i] += ayi;
    }
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
    this._accelerate();
    for (let i = 0; i < this.n; i++) { vx[i] += ax[i] * h; vy[i] += ay[i] * h; }
    for (let c = 0; c < k; c++) { if (!pinned[c]) { cvx[c] += cax[c] * h; cvy[c] += cay[c] * h; } }
    this._cull();
    this.time += dt;
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

  // Drop bodies flung far out of view or swallowed by a black hole, then top the population
  // back up inside the nebulae.
  _cull() {
    const { x, y, r, m, colour, home } = this;
    const dead = this._dead;
    const far = 3 * Math.max(this.halfW, this.halfH);
    const far2 = far * far;
    let changed = false;
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
        r[w] = r[i]; m[w] = m[i]; colour[w] = colour[i]; home[w] = home[i];
      }
      w++;
    }
    this.n = w;
    while (this.n < this.o.bodies) this._spawnInNebula(Math.floor(this.random() * this.nebulaCount));
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
