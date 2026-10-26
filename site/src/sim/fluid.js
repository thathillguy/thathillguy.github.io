// A particle fluid on a grid, for when the page falls: each star deposits itself onto a coarse
// grid (cloud-in-cell), the grid's density gives a pressure, and each star feels the pressure
// gradient, a little viscosity toward the local mean velocity, gravity, and the walls of the
// viewport. Weakly compressible, so the pool wobbles; cheap enough for a hundred thousand stars.
// The GPU engine runs the same scheme in compute shaders (see gpu.js).

export const FLUID = {
  cell: 1.2,        // grid spacing (sim units)
  K: 30000,         // stiffness: acceleration = -K grad(rho / rho0); the wave speed is sqrt(K)
  cohesion: 0,      // how far below rest density the pressure may go negative
  visc: 0.08,       // velocity relaxed toward the cell mean by this fraction per substep
  g: 100,           // downward field (sim units / s^2)
  bounce: 0.2,      // restitution at the walls and floor
  substeps: 8,      // per simulation step: sqrt(K) * dt / substeps must stay under `cell`
  maxCells: 256,    // per axis
};

export class Fluid {
  constructor(o = {}) {
    this.o = { ...FLUID, ...o };
    this.cols = this.rows = 0;
  }

  /** Size the grid to the viewport and set the rest density so n stars fill `fraction` of the height. */
  fit(halfW, halfH, n, fraction) {
    const { maxCells } = this.o;
    const h = Math.max(this.o.cell, (2 * halfW) / (maxCells - 2), (2 * halfH) / (maxCells - 2));
    const cols = Math.ceil((2 * halfW) / h) + 2, rows = Math.ceil((2 * halfH) / h) + 2;
    if (cols !== this.cols || rows !== this.rows) {
      this.cols = cols; this.rows = rows;
      this.count = new Float32Array(cols * rows);
      this.smooth = new Float32Array(cols * rows);
      this.tmp = new Float32Array(cols * rows);
      this.mx = new Float32Array(cols * rows);
      this.my = new Float32Array(cols * rows);
      this.pres = new Float32Array(cols * rows);
    }
    this.h = h;
    this.ox = -halfW - h; this.oy = -halfH - h; // cell (0,0) sits just outside the top-left corner
    this.halfW = halfW; this.halfH = halfH;
    // stars per cell at rest, lowered a little because the pool compresses under its own weight
    const depth = fraction * 2 * halfH;
    this.rho0 = ((n / (2 * halfW * depth)) * h * h) / (1 + (0.5 * this.o.g * depth) / this.o.K);
  }

  /** A 5-tap binomial blur of the deposited density, both ways: the pressure field needs to be
   *  smoother than a dozen stars per cell can make it. */
  _smooth() {
    const { cols, rows, count, smooth, tmp } = this;
    // the margin cells lie beyond the walls: fold what landed there back onto the edge cells, and
    // blur with clamped indices, so the walls read as solid rather than as empty space
    for (let r = 0; r < rows; r++) { const o = r * cols; count[o + 1] += count[o]; count[o + cols - 2] += count[o + cols - 1]; count[o] = count[o + cols - 1] = 0; }
    for (let c = 0; c < cols; c++) { count[cols + c] += count[c]; count[(rows - 2) * cols + c] += count[(rows - 1) * cols + c]; count[c] = count[(rows - 1) * cols + c] = 0; }
    const k = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
    for (let r = 1; r < rows - 1; r++) {
      const o = r * cols;
      for (let c = 1; c < cols - 1; c++) {
        let a = 0;
        for (let t = -2; t <= 2; t++) { const cc = Math.min(Math.max(c + t, 1), cols - 2); a += k[t + 2] * count[o + cc]; }
        tmp[o + c] = a;
      }
    }
    for (let c = 1; c < cols - 1; c++) {
      for (let r = 1; r < rows - 1; r++) {
        let a = 0;
        for (let t = -2; t <= 2; t++) { const rr = Math.min(Math.max(r + t, 1), rows - 2); a += k[t + 2] * tmp[rr * cols + c]; }
        smooth[r * cols + c] = a;
      }
    }
    // beyond the walls the pressure continues the edge value, so the gradient there is zero
    for (let r = 0; r < rows; r++) { const o = r * cols; smooth[o] = smooth[o + 1]; smooth[o + cols - 1] = smooth[o + cols - 2]; }
    for (let c = 0; c < cols; c++) { smooth[c] = smooth[cols + c]; smooth[(rows - 1) * cols + c] = smooth[(rows - 2) * cols + c]; }
  }

  /**
   * One substep of length dtf for the first n stars of `sim`, with the fluid forces scaled by
   * `strength` (0..1). `sim.ax/ay` carry any other acceleration (residual gravity, the hole).
   */
  substep(sim, n, dtf, strength) {
    const { cols, rows, h, ox, oy, rho0, count, mx, my, pres } = this;
    const { K, cohesion, visc, g, bounce } = this.o;
    const { x, y, vx, vy, ax, ay } = sim;
    const inv = 1 / h;
    count.fill(0); mx.fill(0); my.fill(0);
    // deposit
    for (let i = 0; i < n; i++) {
      const fx = (x[i] - ox) * inv - 0.5, fy = (y[i] - oy) * inv - 0.5;
      const cx = Math.min(Math.max(Math.floor(fx), 0), cols - 2), cy = Math.min(Math.max(Math.floor(fy), 0), rows - 2);
      const tx = Math.min(Math.max(fx - cx, 0), 1), ty = Math.min(Math.max(fy - cy, 0), 1);
      const c = cy * cols + cx;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      count[c] += w00; count[c + 1] += w10; count[c + cols] += w01; count[c + cols + 1] += w11;
      const u = vx[i], v = vy[i];
      mx[c] += w00 * u; mx[c + 1] += w10 * u; mx[c + cols] += w01 * u; mx[c + cols + 1] += w11 * u;
      my[c] += w00 * v; my[c + 1] += w10 * v; my[c + cols] += w01 * v; my[c + cols + 1] += w11 * v;
    }
    // pressure, from the smoothed density
    this._smooth();
    const { smooth } = this;
    for (let c = 0; c < cols * rows; c++) pres[c] = K * Math.max(smooth[c] / rho0 - 1, -cohesion);
    // gather and move: gravity comes in with `strength`, pressure and viscosity with its square,
    // so the stars fall first and become a fluid as they land
    const ps = strength * strength;
    const gs = ps * 0.5 * inv, gg = g * strength, vs = visc * ps;
    const left = -this.halfW + 0.3, right = this.halfW - 0.3, floor = this.halfH - 0.3;
    for (let i = 0; i < n; i++) {
      const fx = (x[i] - ox) * inv - 0.5, fy = (y[i] - oy) * inv - 0.5;
      const cx = Math.min(Math.max(Math.floor(fx), 1), cols - 3), cy = Math.min(Math.max(Math.floor(fy), 1), rows - 3);
      const tx = Math.min(Math.max(fx - cx, 0), 1), ty = Math.min(Math.max(fy - cy, 0), 1);
      const c = cy * cols + cx;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      let gx = 0, gy = 0, cnt = 0, su = 0, sv = 0;
      // the four cells around the star, each with its central-difference gradient
      for (let k = 0; k < 4; k++) {
        const cc = k === 0 ? c : k === 1 ? c + 1 : k === 2 ? c + cols : c + cols + 1;
        const w = k === 0 ? w00 : k === 1 ? w10 : k === 2 ? w01 : w11;
        gx += w * (pres[cc + 1] - pres[cc - 1]);
        gy += w * (pres[cc + cols] - pres[cc - cols]);
        cnt += w * count[cc]; su += w * mx[cc]; sv += w * my[cc];
      }
      let u = vx[i], v = vy[i];
      if (cnt > 1e-6) { u += vs * (su / cnt - u); v += vs * (sv / cnt - v); }
      u += (ax[i] - gx * gs) * dtf;
      v += (ay[i] - gy * gs + gg) * dtf;
      let px = x[i] + u * dtf, py = y[i] + v * dtf;
      if (px < left) { px = left; if (u < 0) u = -u * bounce; }
      else if (px > right) { px = right; if (u > 0) u = -u * bounce; }
      if (py > floor) { py = floor; if (v > 0) v = -v * bounce; }
      x[i] = px; y[i] = py; vx[i] = u; vy[i] = v;
    }
  }
}
