// The about card as a boat: a rigid rectangle that floats on the fluid. Buoyancy is hydrostatic
// against the free surface measured just beside the hull (there is no surface under a hull),
// sampled along the hull's bottom and sides so a tilt rights itself; drag toward the water's
// motion; gravity. The fluid treats the hull as a solid wall (see fluid.js and gpu.js).
// Units are the simulation's; y points down.

const K_SURFACE = 8;   // the k-th highest star in a column marks the surface (the rest is spray)
const COLUMN = 4;      // width of the surface-measuring columns beside the hull

export class Boat {
  constructor(o = {}) {
    this.sigma = o.sigma ?? 0.4;  // density relative to the fluid: the fraction of the height submerged at rest
    this.drag = o.drag ?? 2.5;    // 1/s, toward the water's velocity, along
    this.heave = o.heave ?? 6;    // 1/s, up and down: water resists a hull bobbing far more than sliding
    this.spin = o.spin ?? 6.0;    // 1/s, angular damping
    this.maxTilt = o.maxTilt ?? 0.3; // rad: it is a page, it should stay readable
    this.tau = o.tau ?? 0.25;     // s, how quickly the hull believes a change in the surface it sees
    this.moor = o.moor ?? 0.35;   // 1/s^2, a slack line back toward where the page laid the card out
    this.moorX = null;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.th = 0; this.om = 0;
    this.hw = 1; this.hh = 1;
    this.ceiling = 0;             // sim units kept clear at the top of the view (the top bar)
    this.active = false;
    this.surface = null;          // [yLeft, yRight]: the smoothed surface beside the hull
    this._top = [new Float64Array(K_SURFACE), new Float64Array(K_SURFACE)];
  }

  /** Hold the hull at (x, y), level and still. */
  pin(x, y) { this.x = x; this.y = y; this.vx = this.vy = this.th = this.om = 0; this.active = false; this.surface = null; }

  /** Ease toward (x, y, level) when the water is gone, by `k` of the way. */
  easeTo(x, y, k) { this.x += (x - this.x) * k; this.y += (y - this.y) * k; this.th += (0 - this.th) * k; this.vx = this.vy = this.om = 0; }

  /** The pose the fluid solvers need. */
  get hull() { return { x: this.x, y: this.y, c: Math.cos(this.th), s: Math.sin(this.th), hw: this.hw, hh: this.hh, vx: this.vx, vy: this.vy }; }

  /**
   * Advance by dt. `positions` holds (x, y, m, r) per star and `velocities` (vx, vy), n stars;
   * the pool's walls are at ±halfW and its floor at halfH; g is the current downward field.
   */
  step(dt, positions, velocities, n, halfW, halfH, g) {
    const { x, y, hw, hh } = this;
    const c = Math.cos(this.th), s = Math.sin(this.th);
    const ext = Math.abs(c) * hw + Math.abs(s) * hh; // the hull's half-width along world x
    // the surface is read in a column on each side of the hull, kept inside the walls
    const xl1 = Math.max(x - ext - 0.3, -halfW + COLUMN), xl0 = xl1 - COLUMN;
    const xr0 = Math.min(x + ext + 0.3, halfW - COLUMN), xr1 = xr0 + COLUMN;
    const [tl, tr] = this._top;
    tl.fill(halfH); tr.fill(halfH);
    let fvx = 0, fvy = 0, fn = 0;
    const bottom = y + ext + 6; // water this far below the hull counts for drag
    for (let i = 0, k = 0; i < n; i++, k += 4) {
      const px = positions[k], py = positions[k + 1];
      let top = null;
      if (px >= xl0 && px <= xl1) top = tl;
      else if (px >= xr0 && px <= xr1) top = tr;
      else continue;
      if (py < top[K_SURFACE - 1]) { // insert into the k smallest
        let j = K_SURFACE - 1;
        while (j > 0 && top[j - 1] > py) { top[j] = top[j - 1]; j--; }
        top[j] = py;
      }
      if (py < bottom) { fvx += velocities[2 * i]; fvy += velocities[2 * i + 1]; fn++; }
    }
    // an empty column (no water there yet) borrows the other side; the reading is low-passed
    let ml = tl[K_SURFACE - 1], mr = tr[K_SURFACE - 1];
    if (ml >= halfH && mr < halfH) ml = mr;
    if (mr >= halfH && ml < halfH) mr = ml;
    const k = Math.min(1, dt / this.tau);
    if (!this.surface) this.surface = [ml, mr];
    else { this.surface[0] += (ml - this.surface[0]) * k; this.surface[1] += (mr - this.surface[1]) * k; }
    const [yl, yr] = this.surface;
    const xl = (xl0 + xl1) / 2, xr = (xr0 + xr1) / 2;
    const surfaceAt = (wx) => yl + ((yr - yl) * (wx - xl)) / (xr - xl);

    // pressure on the hull's bottom and sides, hydrostatic below the interpolated surface
    const W = 2 * hw, H = 2 * hh, A = W * H;
    let fx = 0, fy = 0, tq = 0, wet = 0;
    const sample = (lx, ly, nx, ny, ds) => {
      const wx = x + c * lx - s * ly, wy = y + s * lx + c * ly;   // world point
      const depth = wy - surfaceAt(wx);
      if (depth <= 0) return;
      const P = g * depth;
      const wnx = c * nx - s * ny, wny = s * nx + c * ny;         // world normal (outward)
      const dfx = -P * wnx * ds, dfy = -P * wny * ds;
      fx += dfx; fy += dfy;
      tq += (wx - x) * dfy - (wy - y) * dfx;
      wet += ds;
    };
    const NB = 12, NS = 4;
    for (let i = 0; i < NB; i++) sample(-hw + (W * (i + 0.5)) / NB, hh, 0, 1, W / NB);
    for (let i = 0; i < NS; i++) {
      const ly = -hh + (H * (i + 0.5)) / NS;
      sample(-hw, ly, -1, 0, H / NS);
      sample(hw, ly, 1, 0, H / NS);
    }
    const m = this.sigma * A, I = (m * (W * W + H * H)) / 12;
    let ax = fx / m, ay = fy / m + g, al = tq / I;
    if (this.moorX != null && wet > 0) ax -= this.moor * (x - this.moorX);
    if (wet > 0) {
      const f = Math.min(1, wet / (W + 2 * H));
      const ux = fn > 0 ? fvx / fn : 0, uy = fn > 0 ? fvy / fn : 0;
      ax += f * this.drag * (ux - this.vx); ay += f * this.heave * (uy - this.vy);
      al -= f * this.spin * this.om;
    } else al -= 0.3 * this.om;
    this.vx += ax * dt; this.vy += ay * dt; this.om += al * dt;
    this.x += this.vx * dt; this.y += this.vy * dt; this.th += this.om * dt;
    const lim = this.maxTilt;
    if (this.th > lim) { this.th = lim; this.om = Math.min(this.om, 0); }
    if (this.th < -lim) { this.th = -lim; this.om = Math.max(this.om, 0); }
    // walls, floor, and the top of the view as a ceiling (a surge should not carry it off the page)
    const ey = Math.abs(s) * hw + Math.abs(c) * hh;
    if (this.x - ext < -halfW) { this.x = -halfW + ext; this.vx = Math.abs(this.vx) * 0.3; }
    if (this.x + ext > halfW) { this.x = halfW - ext; this.vx = -Math.abs(this.vx) * 0.3; }
    if (this.y + ey > halfH) { this.y = halfH - ey; this.vy = -Math.abs(this.vy) * 0.2; this.om *= 0.5; }
    if (this.y - ey < -halfH + this.ceiling) { this.y = -halfH + this.ceiling + ey; this.vy = Math.max(this.vy, 0); }
  }
}
