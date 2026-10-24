// Pure n-body gravity simulation. No DOM, no React: it runs in the browser and under `node --test`.
//
// Units: distance in "sim units", where the shorter side of the viewport spans 100 units;
// time in seconds; G = 1. Coordinates follow the screen: origin at the centre, y grows downward.

export const COLOURS = ['#E24e42', '#e9b000', '#EB6E80', '#008F95'];

export const DEFAULTS = {
  bodies: 150,          // number of orbiting bodies the sim keeps alive
  centralMass: 6000,    // the black body pinned at the origin
  centralRadius: 3,
  softening: 1.5,       // Plummer softening length for body-body forces
  massPerArea: 0.5,     // body mass = massPerArea * radius^2 (all bodies together ~2% of the centre)
  minRadius: 0.6,
  maxRadius: 2,
  mergedMaxRadius: 3.2, // merged bodies stop growing here
  touchFactor: 0,       // bodies merge when closer than touchFactor * (r1 + r2); 0 = pass through
  dt: 1 / 240,          // fixed physics step
  maxFrame: 0.05,       // most real time absorbed by one advance() call
  spin: 1,              // orbital direction: 1 = clockwise on screen, -1 = anticlockwise
  halfW: 80,            // visible half-extents, in sim units (see setViewport)
  halfH: 50,
  random: Math.random,
};

export class NBody {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.random = this.o.random;
    this.halfW = this.o.halfW;
    this.halfH = this.o.halfH;
    this.time = 0;
    this.stats = { merges: 0, absorbed: 0, escaped: 0, steps: 0 };
    this._acc = 0;
    this._touching = [];
    this.n = 0;
    this._alloc(Math.max(64, this.o.bodies * 2));
    for (let i = 0; i < this.o.bodies; i++) this._spawnAnywhere(i % COLOURS.length);
    this._accelerate();
  }

  _alloc(cap) {
    this.cap = cap;
    for (const k of ['x', 'y', 'vx', 'vy', 'ax', 'ay', 'r', 'm']) this[k] = new Float64Array(cap);
    this.colour = new Uint8Array(cap);
    this._dead = new Uint8Array(cap);
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

  addBody(x, y, vx, vy, radius, colourIndex) {
    if (this.n === this.cap) this._grow();
    const i = this.n++;
    this.x[i] = x; this.y[i] = y;
    this.vx[i] = vx; this.vy[i] = vy;
    this.ax[i] = 0; this.ay[i] = 0;
    this.r[i] = radius;
    this.m[i] = this.o.massPerArea * radius * radius;
    this.colour[i] = colourIndex;
    return i;
  }

  /** Speed of a circular orbit at distance rho from the (softened) central body. */
  circularSpeed(rho) {
    const c = this.o.centralRadius;
    const d2 = rho * rho + c * c;
    return rho * Math.sqrt(this.o.centralMass / (d2 * Math.sqrt(d2)));
  }

  /** Velocity for a circular orbit through (x, y), scaled by factor, in the sim's spin direction. */
  orbitalVelocity(x, y, factor = 1) {
    const rho = Math.hypot(x, y) || 1e-9;
    const v = (factor * this.circularSpeed(rho) * this.o.spin) / rho;
    return [-y * v, x * v];
  }

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
    const inner = this.o.centralRadius * 4;
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
    this.addBody(x, y, vx, vy, this._randomRadius() * 0.8, colourIndex);
  }

  _accelerate() {
    const { n, x, y, ax, ay, m, r } = this;
    const { centralMass, centralRadius, softening, touchFactor } = this.o;
    const eps2 = softening * softening, c2 = centralRadius * centralRadius;
    const touching = this._touching;
    touching.length = 0;

    for (let i = 0; i < n; i++) {
      const d2 = x[i] * x[i] + y[i] * y[i] + c2;
      const f = -centralMass / (d2 * Math.sqrt(d2));
      ax[i] = f * x[i];
      ay[i] = f * y[i];
    }
    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i], mi = m[i], ri = r[i];
      let axi = 0, ayi = 0;
      for (let j = i + 1; j < n; j++) {
        const dx = x[j] - xi, dy = y[j] - yi;
        const raw = dx * dx + dy * dy;
        const d2 = raw + eps2;
        const inv = 1 / (d2 * Math.sqrt(d2));
        axi += inv * m[j] * dx;
        ayi += inv * m[j] * dy;
        ax[j] -= inv * mi * dx;
        ay[j] -= inv * mi * dy;
        const touch = touchFactor * (ri + r[j]);
        if (raw < touch * touch) touching.push(i, j);
      }
      ax[i] += axi;
      ay[i] += ayi;
    }
  }

  /** One fixed step of velocity Verlet (kick, drift, kick), then collisions. */
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
    if (this._collide()) this._accelerate();
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

  _merge(i, j) {
    const { x, y, vx, vy, m, r } = this;
    const mi = m[i], mj = m[j], total = mi + mj;
    x[i] = (x[i] * mi + x[j] * mj) / total;
    y[i] = (y[i] * mi + y[j] * mj) / total;
    vx[i] = (vx[i] * mi + vx[j] * mj) / total;
    vy[i] = (vy[i] * mi + vy[j] * mj) / total;
    const rr = Math.min(Math.sqrt(total / this.o.massPerArea), this.o.mergedMaxRadius);
    r[i] = rr;
    m[i] = this.o.massPerArea * rr * rr; // mass past the size cap is "radiated away"
  }

  // Merge touching bodies, drop bodies swallowed by the centre or flung far away,
  // then top the population back up from the rim. Returns true if anything changed.
  _collide() {
    const { x, y, r, m, colour } = this;
    const dead = this._dead;
    const stats = this.stats;
    let changed = false;

    const t = this._touching;
    for (let k = 0; k < t.length; k += 2) {
      let i = t[k], j = t[k + 1];
      if (dead[i] || dead[j]) continue;
      if (m[j] > m[i]) { const s = i; i = j; j = s; }
      this._merge(i, j);
      dead[j] = 1;
      stats.merges++;
      changed = true;
    }

    const far = 3 * Math.max(this.halfW, this.halfH);
    const far2 = far * far;
    const c = this.o.centralRadius;
    for (let i = 0; i < this.n; i++) {
      if (dead[i]) continue;
      const d2 = x[i] * x[i] + y[i] * y[i];
      const swallow = c + r[i];
      if (d2 < swallow * swallow) { dead[i] = 1; stats.absorbed++; changed = true; }
      else if (d2 > far2) { dead[i] = 1; stats.escaped++; changed = true; }
    }

    if (changed) {
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
    return changed;
  }

  /** Total mechanical energy (kinetic + softened potential), for tests and tuning. */
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
