// Runs the simulation in real time within a per-frame budget, adapting the timestep to the cost.
// Two engines: the CPU reference (synchronous) and the GPU (asynchronous, positions read back).
import { NBody } from './nbody.js';

const FRAME = 1000 / 60;
export const DT_FINE = 1 / 120, DT_COARSE = 1 / 30;

export class Driver {
  constructor(opts = {}) {
    this.sim = new NBody({ ...opts, dt: opts.dt ?? (opts.bodies > 4000 ? 1 / 60 : DT_FINE) });
    this.timeScale = opts.timeScale ?? 1; // sim seconds per real second: below 1 plays slower
    this.gpu = null;
    this.acc = 0;
    this.stepMs = 0;
    this.costSum = 0;
    this.costN = 0;
    this.now = opts.now ?? (() => performance.now());
    // the renderer's instance data: x, y, mass, radius per star, plus a colour index per star
    this.positions = new Float32Array(this.sim.cap * 4);
    this.velocities = new Float32Array(this.sim.cap * 2);
    this.colours = new Float32Array(this.sim.cap);
    this.stateAt = this.now(); // when `positions` was last refreshed (real time)
    this._packAll();
  }

  /** Hand the stars to a GPU engine (see gpu.js). */
  useGpu(engine) {
    this.gpu = engine;
    this.positions = engine.positions;
    this.velocities = engine.velocities;
  }

  _packAll() {
    const { n, x, y, m, r, colour } = this.sim;
    const p = this.positions, v = this.velocities, { vx, vy } = this.sim;
    for (let i = 0; i < n; i++) { p[4 * i] = x[i]; p[4 * i + 1] = y[i]; p[4 * i + 2] = m[i]; p[4 * i + 3] = r[i]; v[2 * i] = vx[i]; v[2 * i + 1] = vy[i]; this.colours[i] = colour[i]; }
    this.coloursChanged = true;
  }

  _steps(seconds, budgetMs) {
    const sim = this.sim;
    this.acc += Math.min(Math.max(seconds, 0), sim.o.maxFrame) * this.timeScale;
    let steps = 0;
    while (this.acc >= sim.o.dt) {
      this.acc -= sim.o.dt;
      steps++;
      if (steps * this.stepMs > budgetMs && steps > 1) { this.acc = Math.min(this.acc, sim.o.dt); break; }
    }
    return steps;
  }

  /** Absorb elapsed real time, run steps within the budget (ms), refresh the instance data. */
  async tick(seconds, budgetMs = 10) {
    const steps = this._steps(seconds, budgetMs);
    if (!steps) return 0;
    const t = this.now();
    if (this.gpu) {
      const rewritten = await this.gpu.advance(steps);
      if (rewritten) { for (const i of rewritten) this.colours[i] = this.sim.colour[i]; this.coloursChanged = true; }
    } else {
      for (let s = 0; s < steps; s++) this.sim.step();
      this._packAll();
    }
    this.stateAt = this.now();
    this.stepMs = (this.stateAt - t) / steps;
    this.costSum += this.stepMs * steps;
    this.costN += steps;
    this.adapt(budgetMs);
    return steps;
  }

  // Keep the sim real-time: when a frame's worth of steps costs more than the budget, double the
  // step (down to 30 steps per second); when it is comfortably cheap again, halve it back.
  adapt(budgetMs) {
    if (this.costN < 20) return;
    const perStep = this.costSum / this.costN;
    this.costSum = 0; this.costN = 0;
    const o = this.sim.o;
    const perFrame = perStep * (FRAME / 1000 / o.dt);
    if (perFrame > budgetMs && o.dt < DT_COARSE) o.dt = Math.min(DT_COARSE, o.dt * 2);
    else if (perFrame * 2 < budgetMs * 0.8 && o.dt > DT_FINE) o.dt = Math.max(DT_FINE, o.dt / 2);
  }

  get stepsPerSecond() {
    return Math.round(1 / this.sim.o.dt);
  }
}
