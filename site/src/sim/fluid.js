// A particle fluid on a grid, for when the page falls: each star deposits itself onto a coarse
// grid (cloud-in-cell), the grid's density gives a pressure, and each star feels the pressure
// gradient, a little viscosity toward the local mean velocity, gravity, and the walls of the
// viewport. Weakly compressible, so the pool wobbles; cheap enough for a hundred thousand stars.
// The GPU engine runs the same scheme in compute shaders (see gpu.js).

export const HULL_MARGIN = 0.25; // stars keep this far from the boat's edges (about the width of its outline's stroke)
export const SHED_SPEED = 30;   // sim units/s: rain shed off the card's sides leaves with up to this much sideways, so it lands spread out

/**
 * The ship's profile as fractions of its box (x right, y down), clockwise from the top-left:
 * a flat deck, a long clipper bow that sweeps down into a flat keel, and a raked transom at the
 * stern. Convex. The outline, both fluid solvers and the buoyancy use it.
 */
export const HULL_SHAPES = {
  ship: [[0, 0], [1, 0], [0.99, 0.25], [0.965, 0.5], [0.92, 0.72], [0.85, 0.88], [0.75, 0.97], [0.62, 1], [0.1, 1], [0.03, 0.9], [0, 0.72]],
  raft: [[0, 0], [1, 0], [0.97, 1], [0.03, 1]], // a portrait screen gets a tall card: a raft with raked ends, not a squashed ship
};
export let HULL_SHAPE = HULL_SHAPES.ship;

/** Choose the hull profile ('ship' or 'raft') before any engine or outline is built. */
export function setHullProfile(name) { HULL_SHAPE = HULL_SHAPES[name] ?? HULL_SHAPES.ship; }

/** The hull's edges in local units for a box of half-size (hw, hh): start point, unit outward normal, length. */
export function hullEdges(hw, hh) {
  const n = HULL_SHAPE.length, edges = [];
  for (let k = 0; k < n; k++) {
    const [u0, v0] = HULL_SHAPE[k], [u1, v1] = HULL_SHAPE[(k + 1) % n];
    const x0 = (2 * u0 - 1) * hw, y0 = (2 * v0 - 1) * hh, x1 = (2 * u1 - 1) * hw, y1 = (2 * v1 - 1) * hh;
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    edges.push({ x0, y0, x1, y1, nx: dy / len, ny: -dx / len, len }); // clockwise on a y-down screen: outward is (dy, -dx)
  }
  return edges;
}

/** Signed area of the hull in local units (positive). */
export function hullArea(hw, hh) {
  let a = 0;
  const n = HULL_SHAPE.length;
  for (let k = 0; k < n; k++) {
    const [u0, v0] = HULL_SHAPE[k], [u1, v1] = HULL_SHAPE[(k + 1) % n];
    a += (2 * u0 - 1) * hw * (2 * v1 - 1) * hh - (2 * u1 - 1) * hw * (2 * v0 - 1) * hh;
  }
  return Math.abs(a) / 2;
}

/** The hull's area centroid in local units for a box of half-size (hw, hh): where a uniform hull's weight acts. */
export function hullCentroid(hw, hh) {
  let a = 0, cx = 0, cy = 0;
  const n = HULL_SHAPE.length;
  for (let k = 0; k < n; k++) {
    const [u0, v0] = HULL_SHAPE[k], [u1, v1] = HULL_SHAPE[(k + 1) % n];
    const x0 = (2 * u0 - 1) * hw, y0 = (2 * v0 - 1) * hh, x1 = (2 * u1 - 1) * hw, y1 = (2 * v1 - 1) * hh;
    const cross = x0 * y1 - x1 * y0;
    a += cross; cx += (x0 + x1) * cross; cy += (y0 + y1) * cross;
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/**
 * For a point (lx, ly) in the hull's frame, the distance out through the nearest face and that
 * face's outward normal if the point is inside the hull grown by `margin`; null outside. The
 * deck is never the way out, so water never pools on the page. (Rain that hits the card is
 * handled apart: see the substep. It runs off the deck's corners, as off a roof. Rain let
 * through to the water under the keel had nowhere to go but out the sides, and burst out of
 * them; rain pushed out of the nearest side appeared to pass through the hull.)
 */
export function hullPush(lx, ly, hw, hh, margin = 0) {
  let best = null;
  for (const e of hullEdges(hw, hh)) {
    const sd = (lx - e.x0) * e.nx + (ly - e.y0) * e.ny - margin; // signed distance, negative inside
    if (sd >= 0) return null;
    if (e.ny < -0.9) continue; // the deck
    if (!best || -sd < best.d) best = { d: -sd, nx: e.nx, ny: e.ny };
  }
  return best;
}

/** A fixed pseudo-random number in [0, 1) for star i, a cheap second one beside hash01 (the same in gpu.js). */
export function shedScatter(i) { return (Math.imul(i, 2654435761) >>> 0) / 4294967296; }

export const AIR_PRESSURE = 0.01; // as a fraction of K: the top few units of the pool, and everything above it, count as air
export const LAND_ROOM = 0.04;    // a drop lands only where the pressure is under the full pool's hydrostatic pressure at that depth
                                  // plus this fraction of K (a few units of head): the galaxy cores rain down denser than water, and
                                  // landing all of it at once made the pool burst; a flat density cap let the floor overfill and threw
                                  // the boat off it. Pressure, not density: the pool's particle density runs above rest density in
                                  // ways the smoothing sets, but its pressure is hydrostatic exactly
export const LAND_CHANCE = 0.003; // ...and only this often per substep in full water (more where the water is thin): a drop sinks on
                                  // through the pool as rain and lands anywhere in its depth, so the inflow is spread over the whole
                                  // column (not the top few cells, which pressure could not clear fast enough: that erupted)

export const FLUID = {
  cell: 1.2,        // grid spacing (sim units)
  K: 30000,         // stiffness: acceleration = -K grad(rho / rho0); the wave speed is sqrt(K)
  cohesion: 0,      // how far below rest density the pressure may go negative
  visc: 0.25,       // velocity relaxed toward the cell mean by this fraction per substep
  g: 100,           // downward field (sim units / s^2)
  bounce: 0.2,      // restitution at the walls and floor
  substeps: 8,      // per simulation step: sqrt(K) * dt / substeps must stay under `cell`
  maxCells: 256,    // per axis
  sill: 1.5,        // cells of water below the floor the hull rests on (off the bottom edge of the screen), so a
                    // hull sitting on the bottom has water under its keel to be lifted by
};

export class Fluid {
  constructor(o = {}) {
    this.o = { ...FLUID, ...o };
    this.cols = this.rows = 0;
    this.tick = 0; // substeps so far, for the landing roll
  }

  /**
   * Size the grid to the world: halfW either side, from the top of the first screen (-halfH) down
   * to the water's floor, a sill below floorY (where the hull rests, the bottom of the screen);
   * and set the rest density so n stars fill `fraction` of one screen's height (2 halfH) above
   * floorY.
   */
  fit(halfW, halfH, floorY, n, fraction) {
    const { maxCells, sill } = this.o;
    const h = Math.max(this.o.cell, (2 * halfW) / (maxCells - 2), (floorY + halfH + sill * this.o.cell) / (maxCells - 2));
    floorY += sill * h;
    const tall = floorY + halfH;
    const cols = Math.ceil((2 * halfW) / h) + 2, rows = Math.ceil(tall / h) + 2;
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
    this.halfW = halfW; this.halfH = halfH; this.floorY = floorY;
    // stars per cell at rest, lowered a little because the pool compresses under its own weight
    const depth = fraction * 2 * halfH + sill * h;
    this.depth = depth;
    this.rho0 = ((n / (2 * halfW * depth)) * h * h) / (1 + (0.5 * this.o.g * depth) / this.o.K);
  }

  /** A radial kick: stars within r of (x, y) gain up to `a` outward, falling off as (1 - d/r)^2. */
  impulse(sim, n, { x, y, r, a }) {
    const { x: px, y: py, vx, vy } = sim;
    const r2 = r * r;
    for (let i = 0; i < n; i++) {
      const dx = px[i] - x, dy = py[i] - y, d2 = dx * dx + dy * dy;
      if (d2 >= r2 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), w = 1 - d / r, k = (a * w * w) / d;
      vx[i] += dx * k; vy[i] += dy * k;
    }
  }

  /** A finger dragged through the water: the stars within r of (x, y) are blended toward the
   *  finger's velocity, fully at the centre and not at all at the edge. Held still, it damps. */
  stir(sim, n, { x, y, vx: sx, vy: sy }, r, blend) {
    const { x: px, y: py, vx, vy } = sim;
    const r2 = r * r;
    for (let i = 0; i < n; i++) {
      const dx = px[i] - x, dy = py[i] - y, d2 = dx * dx + dy * dy;
      if (d2 >= r2) continue;
      const w = 1 - Math.sqrt(d2) / r, k = blend * w * w;
      vx[i] += (sx - vx[i]) * k; vy[i] += (sy - vy[i]) * k;
    }
  }

  /** The pressure at a world point, bilinear on the cell centres of `pres` (a grid laid out like this one's). */
  pressureAt(pres, wx, wy) {
    const { cols, rows, h, ox, oy } = this;
    const fx = Math.min(Math.max((wx - ox) / h - 0.5, 0), cols - 1.001), fy = Math.min(Math.max((wy - oy) / h - 0.5, 0), rows - 1.001);
    const cx = Math.floor(fx), cy = Math.floor(fy), tx = fx - cx, ty = fy - cy;
    const c = cy * cols + cx;
    return (1 - tx) * (1 - ty) * pres[c] + tx * (1 - ty) * pres[c + 1] + (1 - tx) * ty * pres[c + cols] + tx * ty * pres[c + cols + 1];
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
  /**
   * One substep. Each star takes part by its release weight sim.relw[i] (0: still a galaxy star,
   * carried only by its galaxy acceleration). A released star is rain until it lands: it falls
   * under gravity, slowed toward a rain's terminal speed, and is nothing to the other drops. It
   * lands when it reaches the floor or water already landed (sim.landed[i]); from then on it is
   * water: it deposits, and feels pressure and viscosity. Water thrown up into the air (where
   * nothing presses) is slowed like rain too.
   */
  substep(sim, n, dtf) {
    const { cols, rows, h, ox, oy, rho0, count, mx, my, pres } = this;
    const hull = sim.boat;
    const { K, cohesion, visc, g, bounce } = this.o;
    const { x, y, vx, vy, ax, ay, relw, landed } = sim;
    const gdx = sim.gdir.x, gdy = sim.gdir.y; // which way is down (a phone's tilt)
    const airDrag = sim.airDrag, airP = AIR_PRESSURE * K; // pressure below which a star is in air (see fluid kernel in gpu.js)
    const inv = 1 / h;
    const roll = 0.6180339887 * ++this.tick; // each star's landing rolls run through a golden-ratio sequence
    count.fill(0); mx.fill(0); my.fill(0);
    // deposit: the water, not the rain
    for (let i = 0; i < n; i++) {
      const rw = relw[i];
      if (rw <= 0 || !landed[i]) continue;
      const fx = (x[i] - ox) * inv - 0.5, fy = (y[i] - oy) * inv - 0.5;
      const cx = Math.min(Math.max(Math.floor(fx), 0), cols - 2), cy = Math.min(Math.max(Math.floor(fy), 0), rows - 2);
      const tx = Math.min(Math.max(fx - cx, 0), 1), ty = Math.min(Math.max(fy - cy, 0), 1);
      const c = cy * cols + cx;
      const w00 = (1 - tx) * (1 - ty) * rw, w10 = tx * (1 - ty) * rw, w01 = (1 - tx) * ty * rw, w11 = tx * ty * rw;
      count[c] += w00; count[c + 1] += w10; count[c + cols] += w01; count[c + cols + 1] += w11;
      const u = vx[i], v = vy[i];
      mx[c] += w00 * u; mx[c + 1] += w10 * u; mx[c + cols] += w01 * u; mx[c + cols + 1] += w11 * u;
      my[c] += w00 * v; my[c + 1] += w10 * v; my[c + cols] += w01 * v; my[c + cols + 1] += w11 * v;
    }
    // pressure, from the smoothed density
    this._smooth();
    const { smooth } = this;
    for (let c = 0; c < cols * rows; c++) pres[c] = K * Math.max(smooth[c] / rho0 - 1, -cohesion);
    // gather and move
    const left = -this.halfW + 0.3, right = this.halfW - 0.3, floor = this.floorY - 0.3;
    for (let i = 0; i < n; i++) {
      const rw = relw[i];
      if (rw <= 0) { // still a galaxy star: its galaxy acceleration only
        vx[i] += ax[i] * dtf; vy[i] += ay[i] * dtf; x[i] += vx[i] * dtf; y[i] += vy[i] * dtf;
        continue;
      }
      const rain = !landed[i];
      const ps = rain ? 0 : rw * rw, gs = ps * 0.5 * inv, gg = g * rw, vs = visc * ps;
      const fx = (x[i] - ox) * inv - 0.5, fy = (y[i] - oy) * inv - 0.5;
      const cx = Math.min(Math.max(Math.floor(fx), 1), cols - 3), cy = Math.min(Math.max(Math.floor(fy), 1), rows - 3);
      const tx = Math.min(Math.max(fx - cx, 0), 1), ty = Math.min(Math.max(fy - cy, 0), 1);
      const c = cy * cols + cx;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      let gx = 0, gy = 0, cnt = 0, su = 0, sv = 0, pl = 0;
      // the four cells around the star, each with its central-difference gradient
      for (let k = 0; k < 4; k++) {
        const cc = k === 0 ? c : k === 1 ? c + 1 : k === 2 ? c + cols : c + cols + 1;
        const w = k === 0 ? w00 : k === 1 ? w10 : k === 2 ? w01 : w11;
        gx += w * (pres[cc + 1] - pres[cc - 1]);
        gy += w * (pres[cc + cols] - pres[cc - cols]);
        cnt += w * count[cc]; su += w * mx[cc]; sv += w * my[cc]; pl += w * pres[cc];
      }
      let u = vx[i], v = vy[i];
      if (!rain && cnt > 1e-6) { u += vs * (su / cnt - u); v += vs * (sv / cnt - v); }
      // air is wherever the water is not pressing: unpressurised, so a star in it falls like rain
      const air = rain ? 1 : Math.max(0, 1 - pl / airP), slow = Math.min(1, airDrag * rw * air * dtf);
      u -= u * slow; v -= v * slow;
      u += (ax[i] - gx * gs + gg * gdx) * dtf;
      v += (ay[i] - gy * gs + gg * gdy) * dtf;
      let px = x[i] + u * dtf, py = y[i] + v * dtf;
      if (px < left) { px = left; if (u < 0) u = -u * bounce; }
      else if (px > right) { px = right; if (u > 0) u = -u * bounce; }
      if (py > floor) { py = floor; if (v > 0) v = -v * bounce; }
      let shed = false;
      if (hull) {
        // inside the hull? push out through the nearest face, taking the hull's velocity; rain
        // goes out the sides (hullPush) and is thrown a little clear of them
        const dx = px - hull.x, dy = py - hull.y;
        const lx = hull.c * dx + hull.s * dy, ly = -hull.s * dx + hull.c * dy;
        const hit = hullPush(lx, ly, hull.hw, hull.hh, HULL_MARGIN);
        if (hit && rain) {
          // rain on the card runs off the nearer corner of the deck and down that side
          shed = true;
          const side = lx >= 0 ? 1 : -1, ex = side * (hull.hw + HULL_MARGIN), ey = -hull.hh - HULL_MARGIN;
          px = hull.x + hull.c * ex - hull.s * ey; py = hull.y + hull.s * ex + hull.c * ey;
          const sp = SHED_SPEED * (0.2 + 0.8 * shedScatter(i));
          u = hull.vx + side * hull.c * sp; v = Math.max(v, hull.vy) + side * hull.s * sp;
        } else if (hit) {
          const wnx = hull.c * hit.nx - hull.s * hit.ny, wny = hull.s * hit.nx + hull.c * hit.ny;
          px += wnx * hit.d; py += wny * hit.d;
          const rel = (u - hull.vx) * wnx + (v - hull.vy) * wny;
          if (rel < 0) { u -= rel * wnx * (1 + bounce); v -= rel * wny * (1 + bounce); }
        }
      }
      // into water with room in it, or onto the floor: room is measured against the full pool's hydrostatic pressure at this
      // depth, and thin water (the first of the pool, the surface) takes drops readily
      const room = g * Math.min(Math.max(py - (floor - this.depth), 0), this.depth) + K * LAND_ROOM;
      if (rain && !shed && pl < room && (cnt > 0.5 * rho0 || py > floor - h)
          && (shedScatter(i) + roll) % 1 < LAND_CHANCE * (1 + 12 * Math.max(0, 1 - cnt / rho0))) {
        landed[i] = 1;
        if (cnt > 1e-6) { u = su / cnt + 0.3 * (u - su / cnt); v = sv / cnt + 0.3 * (v - sv / cnt); } // a drop joins the water: most of its fall is spent
      }
      x[i] = px; y[i] = py; vx[i] = u; vy[i] = v;
    }
  }
}
