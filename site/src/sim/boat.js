// The about card as a ship: a rigid hull (HULL_SHAPE in fluid.js) that floats on the fluid.
// The water's own pressure field is integrated over the hull's faces, so the hull rises when
// the water under it is compressed and settles when it is not; drag toward the water's motion;
// gravity. The fluid treats the hull as a solid wall (fluid.js and gpu.js). Units are the
// simulation's; y points down.
import { hullEdges, hullArea } from './fluid.js';

export class Boat {
  constructor(o = {}) {
    this.sigma = o.sigma ?? 0.42;  // density relative to the fluid: the fraction of the height submerged at rest
    this.drag = o.drag ?? 2.5;     // 1/s, toward the water's velocity, along
    this.heave = o.heave ?? 6;     // 1/s, up and down: water resists a hull bobbing far more than sliding
    this.spin = o.spin ?? 6.0;     // 1/s, angular damping
    this.maxTilt = o.maxTilt ?? 0.3; // rad: it is a page, it should stay readable
    this.moor = o.moor ?? 0.35;    // 1/s^2, a slack line back toward where the page laid the card out
    this.moorX = null;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0; this.th = 0; this.om = 0;
    this.hw = 1; this.hh = 1;
    this.ceiling = 0;              // sim units kept clear at the top of the view (the top bar)
    this.top = -Infinity;          // world y of the top of the view the card lives on
    this.active = false;
    this.held = false;             // docked where the page laid it out until the water can carry it (see step)
    this.wet = 0;                  // fraction of the hull's faces under pressure, for inspection
  }

  /** Hold the hull at (x, y), level and still. */
  pin(x, y) { this.x = x; this.y = y; this.vx = this.vy = this.th = this.om = 0; this.active = false; }

  /** Ease toward (x, y, level) when the water is gone, by `k` of the way. */
  easeTo(x, y, k) { this.x += (x - this.x) * k; this.y += (y - this.y) * k; this.th += (0 - this.th) * k; this.vx = this.vy = this.om = 0; }

  /** The pose the fluid solvers need. */
  get hull() { return { x: this.x, y: this.y, c: Math.cos(this.th), s: Math.sin(this.th), hw: this.hw, hh: this.hh, vx: this.vx, vy: this.vy }; }

  /**
   * Advance by dt. `fluid` is the grid (for its layout) and `pressure` its pressure field;
   * `positions` (x, y, m, r per star) and `velocities` (vx, vy) give the water's motion near
   * the hull; the pool's walls are at ±halfW and its floor at floorY; g is the downward field.
   */
  step(dt, fluid, pressure, positions, velocities, n, halfW, floorY, g) {
    const { x, y, hw, hh } = this;
    const c = Math.cos(this.th), s = Math.sin(this.th);
    const ext = Math.abs(c) * hw + Math.abs(s) * hh;
    const W = 2 * hw;

    // pressure on every face but the deck, sampled a little outside each face. Before the grid's
    // first fit (a scroll can release the boat between a tick and this call) there is no field
    // to sample yet: the boat simply falls for that frame.
    const fitted = fluid.cols > 1 && fluid.rows > 1 && pressure.length >= fluid.cols * fluid.rows;
    const A = hullArea(hw, hh), out = 0.8 * fluid.h;
    let fx = 0, fy = 0, tq = 0, wet = 0, total = 0;
    for (const e of fitted ? hullEdges(hw, hh) : []) {
      if (e.ny < -0.9) continue; // the deck
      const N = Math.max(2, Math.round(e.len / (W / 16))), ds = e.len / N;
      const wnx = c * e.nx - s * e.ny, wny = s * e.nx + c * e.ny;   // world normal (outward)
      for (let i = 0; i < N; i++) {
        const t = (i + 0.5) / N;
        const lx = e.x0 + (e.x1 - e.x0) * t, ly = e.y0 + (e.y1 - e.y0) * t;
        const wx = x + c * lx - s * ly, wy = y + s * lx + c * ly;   // world point on the face
        const P = Math.max(0, fluid.pressureAt(pressure, wx + wnx * out, wy + wny * out));
        total += ds;
        if (P <= 0) continue;
        const dfx = -P * wnx * ds, dfy = -P * wny * ds;
        fx += dfx; fy += dfy;
        tq += (wx - x) * dfy - (wy - y) * dfx;
        wet += ds;
      }
    }
    this.wet = total > 0 ? wet / total : 0;

    // the water's motion just below the hull, for drag
    let fvx = 0, fvy = 0, fn = 0;
    const lo = x - ext - 1, hi = x + ext + 1;
    for (let i = 0, k = 0; i < n; i++, k += 4) {
      const px = positions[k];
      if (px < lo || px > hi) continue;
      const dx = px - x, dy = positions[k + 1] - y;
      const lx = c * dx + s * dy, ly = -s * dx + c * dy;
      if (Math.abs(lx) < hw + 1 && ly > hh - 1 && ly < hh + 6) { fvx += velocities[2 * i]; fvy += velocities[2 * i + 1]; fn++; }
    }

    const m = this.sigma * A, H = 2 * hh, I = (m * (W * W + H * H)) / 12;
    if (!(m > 0) || !Number.isFinite(fx + fy + tq)) { // no hull yet, or a bad pressure sample: fall freely
      if (!Number.isFinite(fx + fy + tq)) console.warn('boat: non-finite pressure force', { fx, fy, tq, wet, cols: fluid.cols, rows: fluid.rows, h: fluid.h });
      if (this.held) return;
      this.vy += g * dt; this.y += this.vy * dt;
      return;
    }
    let ax = fx / m, ay = fy / m + g, al = tq / I;
    if (this.wet > 0) {
      const f = Math.min(1, 2 * this.wet);
      const ux = fn > 0 ? fvx / fn : 0, uy = fn > 0 ? fvy / fn : 0;
      ax += f * this.drag * (ux - this.vx); ay += f * this.heave * (uy - this.vy);
      al -= f * this.spin * this.om;
      if (this.moorX != null) ax -= this.moor * (x - this.moorX);
    } else al -= 0.3 * this.om;
    // held: the page keeps the card where it laid it out until the rising water would lift it,
    // so it is launched with no net force rather than dropped into the pool (a slap that flung
    // thousands of stars)
    if (this.held) { if (ay >= 0) return; this.held = false; }
    this.vx += ax * dt; this.vy += ay * dt; this.om += al * dt;
    this.x += this.vx * dt; this.y += this.vy * dt; this.th += this.om * dt;
    const lim = this.maxTilt;
    if (this.th > lim) { this.th = lim; this.om = Math.min(this.om, 0); }
    if (this.th < -lim) { this.th = -lim; this.om = Math.max(this.om, 0); }
    // walls, floor, and the top of the view as a soft ceiling
    const ey = Math.abs(s) * hw + Math.abs(c) * hh;
    if (this.x - ext < -halfW) { this.x = -halfW + ext; this.vx = Math.abs(this.vx) * 0.3; }
    if (this.x + ext > halfW) { this.x = halfW - ext; this.vx = -Math.abs(this.vx) * 0.3; }
    if (this.y + ey > floorY) { this.y = floorY - ey; this.vy = -Math.abs(this.vy) * 0.2; this.om *= 0.5; }
    const over = this.top + this.ceiling - (this.y - ey);
    if (over > 0) { this.vy += (40 * over - 4 * Math.min(this.vy, 0)) * dt; }
  }
}
