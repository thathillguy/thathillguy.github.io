// Sizes the simulation to the device: a quick timed run at startup, then as many stars as fit in
// the per-step budget. GPU cost is a fixed overhead plus a term in n^2 (all pairs), so two probe
// sizes separate the two. CPU cost is n log n on the tree, so one probe size is enough.
import { NBody } from './nbody.js';
import { createGpuEngine } from './gpu.js';

export const GPU_STEP_MS = 28;  // ~15 states per second at the coarse timestep, with headroom
export const CPU_STEP_MS = 16;
const GPU_RANGE = [20000, 160000];
const CPU_RANGE = [3000, 30000];

const clamp = (n, [lo, hi]) => Math.max(lo, Math.min(hi, Math.floor(n / 1000) * 1000));

async function timeGpu(device, bodies) {
  const sim = new NBody({ bodies, prime: false });
  const engine = createGpuEngine(device, sim);
  let best = Infinity;
  await engine.advance(2); // pipelines compile on the first dispatch
  for (let k = 0; k < 2; k++) {
    const t = performance.now();
    await engine.advance(5);
    best = Math.min(best, (performance.now() - t) / 5);
  }
  engine.destroy(true);
  return best;
}

export async function calibrateGpu(device, { limit = GPU_RANGE[1], stepMs = GPU_STEP_MS } = {}) {
  const n1 = 32000, n2 = 64000; // big enough that the n^2 term dominates the fixed overhead
  const [t1, t2] = [await timeGpu(device, n1), await timeGpu(device, n2)];
  const b = (t2 - t1) / (n2 * n2 - n1 * n1);
  const a = t1 - b * n1 * n1;
  if (!(b > 0) || !(stepMs > a)) return { bodies: clamp(Math.min(limit, 60000), GPU_RANGE), probe: { t1, t2 } };
  return { bodies: clamp(Math.min(limit, Math.sqrt((stepMs - a) / b)), GPU_RANGE), probe: { t1, t2 } };
}

export function calibrateCpu({ limit = CPU_RANGE[1], stepMs = CPU_STEP_MS } = {}) {
  const n0 = 5000;
  const sim = new NBody({ bodies: n0 });
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const t = performance.now();
    sim.step();
    best = Math.min(best, performance.now() - t);
  }
  // solve n ln n = ratio * n0 ln n0 by iteration
  const target = (stepMs / best) * n0 * Math.log(n0);
  let n = n0;
  for (let k = 0; k < 8; k++) n = target / Math.log(Math.max(n, 2));
  return { bodies: clamp(Math.min(limit, n), CPU_RANGE), probe: { t0: best } };
}
