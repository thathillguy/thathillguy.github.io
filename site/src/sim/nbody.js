// N-body gravity with a Barnes-Hut quadtree. No DOM, no React: runs in a Web Worker and under `node --test`.
//
// Units: distance in "sim units", where the shorter side of the viewport spans 100 units;
// time in seconds; G = 1. Coordinates follow the screen: origin at the centre, y grows downward.

export const COLOURS = ['#E24e42', '#e9b000', '#EB6E80', '#008F95'];

export const DEFAULTS = {
  bodies: 6000,           // number of orbiting bodies the sim keeps alive
  centralMass: 6000,      // the black body pinned at the origin
  centralRadius: 3,
  softening: 1,           // Plummer softening length for body-body forces
  bodyMassFraction: 0.03, // all bodies together weigh this fraction of the central body
  massPerArea: null,      // or set the mass per unit radius^2 directly (tests)
  minRadius: 0.12,        // drawn radius; ~1px on a laptop
  maxRadius: 0.4,
  theta: 0.75,            // Barnes-Hut opening angle; lower is more accurate and slower
  dt: 1 / 120,            // fixed physics step
  maxFrame: 0.05,         // most real time absorbed by one advance() call
  spin: 1,                // orbital direction: 1 = clockwise on screen, -1 = anticlockwise
  halfW: 80,              // visible half-extents, in sim units (see setViewport)
  halfH: 50,
  random: Math.random,
};

const EMPTY = -1, INTERNAL = -2, CROWD = -3; // quadtree leaf states (CROWD: several coincident bodies)
const MAX_DEPTH = 24;

/** Speed of a circular orbit at distance rho from the (softened) central body. */
export function circularSpeed(o, rho) {
  const c = o.centralRadius;
  const d2 = rho * rho + c * c;
  return rho * Math.sqrt(o.centralMass / (d2 * Math.sqrt(d2)));
}

/** Velocity for a circular orbit through (x, y), scaled by factor, in the sim's spin direction. */
export function orbitalVelocity(o, x, y, factor = 1) {
  const rho = Math.hypot(x, y) || 1e-9;
  const v = (factor * circularSpeed(o, rho) * o.spin) / rho;
  return [-y * v, x * v];
}

/**
 * Where a test body launched from (x, y) with velocity (vx, vy) would go under the
 * central body alone, as a flat [x0, y0, x1, y1, ...] array. Used to draw the aim preview.
 */
export function previewPath(o, x, y, vx, vy, steps = 90, dt = 1 / 30) {
  const { centralMass, centralRadius } = o;
  const c2 = centralRadius * centralRadius;
  const out = new Float64Array(steps * 2);
  const sub = 4, h = dt / sub;
  for (let k = 0; k < steps; k++) {
    for (let s = 0; s < sub; s++) {
      const d2 = x * x + y * y + c2;
      const f = -centralMass / (d2 * Math.sqrt(d2));
      vx += f * x * h;
      vy += f * y * h;
      x += vx * h;
      y += vy * h;
    }
    out[2 * k] = x;
    out[2 * k + 1] = y;
    if (x * x + y * y < c2) return out.subarray(0, 2 * k + 2);
  }
  return out;
}

export class NBody {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.random = this.o.random;
    this.halfW = this.o.halfW;
    this.halfH = this.o.halfH;
    this.time = 0;
    this.stats = { absorbed: 0, escaped: 0, steps: 0, nodes: 0 };
    this._acc = 0;
    this.n = 0;
    this._alloc(Math.max(64, this.o.bodies * 2));
    this._stack = new Int32Array(4096);
    this.massPerArea = this.o.massPerArea ?? 1; // provisional until the population exists
    for (let i = 0; i < this.o.bodies; i++) this._spawnAnywhere(i % COLOURS.length);
    if (this.o.massPerArea == null) {
      let sumR2 = 0;
      for (let i = 0; i < this.n; i++) sumR2 += this.r[i] * this.r[i];
      this.massPerArea = sumR2 > 0 ? (this.o.bodyMassFraction * this.o.centralMass) / sumR2 : 1;
      for (let i = 0; i < this.n; i++) this.m[i] = this.massPerArea * this.r[i] * this.r[i];
    }
    this._accelerate();
  }

  _alloc(cap) {
    this.cap = cap;
    for (const k of ['x', 'y', 'vx', 'vy', 'ax', 'ay', 'r', 'm']) this[k] = new Float64Array(cap);
    this.colour = new Uint8Array(cap);
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
    const old = { x: this.x, y: this.y, vx: this.vx, vy: this.vy, ax: this.ax, ay: this.ay, r: this.r, m: this.m, colour: this.colour };
    this._alloc(this.cap * 2);
    for (const k of Object.keys(old)) this[k].set(old[k]);
  }

  /** Visible half-width and half-height in sim units; spawning and escape use them. */
  setViewport(halfW, halfH) {
    this.halfW = halfW;
    this.halfH = halfH;
  }

  get count() {
    return this.n;
  }

  /** Change how many bodies the sim keeps alive. Extra bodies spawn in place; surplus ones vanish. */
  setCount(target) {
    target = Math.max(0, Math.floor(target));
    this.o.bodies = target;
    while (this.n > target) this.n--;
    while (this.n < target) this._spawnAnywhere(Math.floor(this.random() * COLOURS.length));
  }

  addBody(x, y, vx, vy, radius, colourIndex) {
    if (this.n === this.cap) this._grow();
    const i = this.n++;
    this.x[i] = x; this.y[i] = y;
    this.vx[i] = vx; this.vy[i] = vy;
    this.ax[i] = 0; this.ay[i] = 0;
    this.r[i] = radius;
    this.m[i] = this.massPerArea * radius * radius;
    this.colour[i] = colourIndex;
    return i;
  }

  circularSpeed(rho) { return circularSpeed(this.o, rho); }
  orbitalVelocity(x, y, factor = 1) { return orbitalVelocity(this.o, x, y, factor); }
  previewPath(x, y, vx, vy, steps, dt) { return previewPath(this.o, x, y, vx, vy, steps, dt); }

  _randomRadius() {
    const { minRadius, maxRadius } = this.o;
    return minRadius + (maxRadius - minRadius) * this.random();
  }

  _perturbed(x, y, lo, hi) {
    const [vx, vy] = this.orbitalVelocity(x, y, lo + (hi - lo) * this.random());
    const ang = (this.random() - 0.5) * 0.17; // about +/- 5 degrees
    const c = Math.cos(ang), s = Math.sin(ang);
    return [vx * c - vy * s, vx * s + vy * c];
  }

  // Mostly inside the disc that fits the viewport (orbits are circles, so that is where bodies
  // stay visible), with a quarter of them further out along the long axis. Near-circular orbits.
  _spawnAnywhere(colourIndex) {
    const rIn = 0.95 * Math.min(this.halfW, this.halfH);
    const rOut = 0.95 * Math.max(this.halfW, this.halfH);
    const inner = this.o.centralRadius * 3;
    let rho;
    do {
      rho = this.random() < 0.75
        ? rIn * Math.sqrt(this.random())
        : Math.sqrt(rIn * rIn + (rOut * rOut - rIn * rIn) * this.random());
    } while (rho < inner);
    const t = 2 * Math.PI * this.random();
    const x = rho * Math.cos(t), y = rho * Math.sin(t);
    const [vx, vy] = this._perturbed(x, y, 0.94, 1.03);
    this.addBody(x, y, vx, vy, this._randomRadius(), colourIndex);
  }

  // Just outside the short edge of the viewport, slightly sub-circular so it swings inward.
  _spawnAtRim(colourIndex) {
    const rho = 1.04 * Math.min(this.halfW, this.halfH);
    const t = 2 * Math.PI * this.random();
    const x = rho * Math.cos(t), y = rho * Math.sin(t);
    const [vx, vy] = this._perturbed(x, y, 0.8, 0.95);
    this.addBody(x, y, vx, vy, this._randomRadius(), colourIndex);
  }

  // ---- Barnes-Hut quadtree ----------------------------------------------------------------

  _newNode(cx, cy, h) {
    if (this.nodes === this.treeCap) {
      const old = this;
      const { nx, ny, nh, nm, ncx, ncy, nleaf, nchild } = old;
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
          // single body here: push it down one level, unless we are too deep already
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
    const { n, x, y, ax, ay } = this;
    const { centralMass, centralRadius, softening, theta } = this.o;
    const eps2 = softening * softening, c2 = centralRadius * centralRadius;
    const theta2 = theta * theta;

    for (let i = 0; i < n; i++) {
      const d2 = x[i] * x[i] + y[i] * y[i] + c2;
      const f = -centralMass / (d2 * Math.sqrt(d2));
      ax[i] = f * x[i];
      ay[i] = f * y[i];
    }
    if (n < 2) return;

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
          for (let k = 0; k < 4; k++) {
            const ch = nchild[c + k];
            if (ch >= 0 && nleaf[ch] !== EMPTY) stack[sp++] = ch;
          }
        }
      }
      ax[i] += axi;
      ay[i] += ayi;
    }
  }

  /** Exact all-pairs accelerations into (outX, outY); for tests and tuning only. */
  _accelerateDirect(outX, outY) {
    const { n, x, y, m } = this;
    const { centralMass, centralRadius, softening } = this.o;
    const eps2 = softening * softening, c2 = centralRadius * centralRadius;
    for (let i = 0; i < n; i++) {
      const d2 = x[i] * x[i] + y[i] * y[i] + c2;
      const f = -centralMass / (d2 * Math.sqrt(d2));
      outX[i] = f * x[i]; outY[i] = f * y[i];
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

  // ---- integration ------------------------------------------------------------------------

  /** One fixed step of velocity Verlet (kick, drift, kick), then absorb/escape handling. */
  step() {
    const { dt } = this.o;
    const h = dt / 2;
    const { x, y, vx, vy, ax, ay } = this;
    for (let i = 0; i < this.n; i++) {
      vx[i] += ax[i] * h;
      vy[i] += ay[i] * h;
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
    }
    this._accelerate();
    for (let i = 0; i < this.n; i++) {
      vx[i] += ax[i] * h;
      vy[i] += ay[i] * h;
    }
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

  // Drop bodies swallowed by the centre or flung far away, then top the population back up.
  _cull() {
    const { x, y, r, m, colour } = this;
    const dead = this._dead;
    const stats = this.stats;
    const far = 3 * Math.max(this.halfW, this.halfH);
    const far2 = far * far;
    const c = this.o.centralRadius;
    let changed = false;
    for (let i = 0; i < this.n; i++) {
      const d2 = x[i] * x[i] + y[i] * y[i];
      const swallow = c + r[i];
      if (d2 < swallow * swallow) { dead[i] = 1; stats.absorbed++; changed = true; }
      else if (d2 > far2) { dead[i] = 1; stats.escaped++; changed = true; }
    }
    if (!changed) return;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      if (dead[i]) { dead[i] = 0; continue; }
      if (w !== i) {
        x[w] = x[i]; y[w] = y[i];
        this.vx[w] = this.vx[i]; this.vy[w] = this.vy[i];
        this.ax[w] = this.ax[i]; this.ay[w] = this.ay[i];
        r[w] = r[i]; m[w] = m[i]; colour[w] = colour[i];
      }
      w++;
    }
    this.n = w;
    while (this.n < this.o.bodies) this._spawnAtRim(Math.floor(this.random() * COLOURS.length));
  }

  /** Total mechanical energy (kinetic + softened potential), exact; for tests only. */
  energy() {
    const { n, x, y, vx, vy, m } = this;
    const { centralMass, centralRadius, softening } = this.o;
    const eps2 = softening * softening, c2 = centralRadius * centralRadius;
    let e = 0;
    for (let i = 0; i < n; i++) {
      e += 0.5 * m[i] * (vx[i] * vx[i] + vy[i] * vy[i]);
      e -= (centralMass * m[i]) / Math.sqrt(x[i] * x[i] + y[i] * y[i] + c2);
      for (let j = i + 1; j < n; j++) {
        const dx = x[j] - x[i], dy = y[j] - y[i];
        e -= (m[i] * m[j]) / Math.sqrt(dx * dx + dy * dy + eps2);
      }
    }
    return e;
  }
}
