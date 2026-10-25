// Runs the simulation in real time on the thread that calls tick(), within a per-frame budget.
//
// It runs on the main thread: bodies can only move as often as the physics steps, so a worker
// would not make the picture smoother, and this keeps the data where the renderer reads it.
// (Measurement note: macOS slows Chrome's threads several-fold while another app has focus.
// Benchmark with the browser in front.)
import { NBody } from './nbody.js';

const FRAME = 1000 / 60;
export const DT_FINE = 1 / 120, DT_COARSE = 1 / 30;

export class Driver {
  constructor(opts = {}) {
    this.sim = new NBody({ ...opts, dt: opts.dt ?? (opts.bodies > 4000 ? 1 / 60 : DT_FINE) });
    this.timeScale = opts.timeScale ?? 1; // sim seconds per real second: below 1 plays slower
    this.acc = 0;
    this.stepMs = 0;     // cost of the most recent step
    this.costSum = 0;
    this.costN = 0;
    this.now = opts.now ?? (() => performance.now());
  }

  /** Absorb elapsed real time and run steps until caught up or the budget (ms) is spent. */
  tick(seconds, budgetMs = 10) {
    const sim = this.sim;
    this.acc += Math.min(Math.max(seconds, 0), sim.o.maxFrame) * this.timeScale;
    const start = this.now();
    let steps = 0;
    while (this.acc >= sim.o.dt) {
      const t = this.now();
      sim.step();
      this.acc -= sim.o.dt;
      steps++;
      this.stepMs = this.now() - t;
      this.costSum += this.stepMs;
      this.costN++;
      if (this.now() - start > budgetMs) {
        this.acc = Math.min(this.acc, sim.o.dt); // give up on the backlog rather than stall the page
        break;
      }
    }
    this.adapt(budgetMs);
    return steps;
  }

  /** As tick(), awaiting each step so the tree walk can run on the worker pool. */
  async tickAsync(seconds, budgetMs = 10) {
    const sim = this.sim;
    this.acc += Math.min(Math.max(seconds, 0), sim.o.maxFrame) * this.timeScale;
    const start = this.now();
    let steps = 0;
    while (this.acc >= sim.o.dt) {
      const t = this.now();
      await sim.stepAsync();
      this.acc -= sim.o.dt;
      steps++;
      this.stepMs = this.now() - t;
      this.costSum += this.stepMs;
      this.costN++;
      if (this.now() - start > budgetMs) {
        this.acc = Math.min(this.acc, sim.o.dt);
        break;
      }
    }
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
