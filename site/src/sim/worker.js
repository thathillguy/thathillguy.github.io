// Runs the simulation off the main thread and streams packed positions back.
// Frame buffers are passed back and forth (transferred, never copied) so nothing is allocated per frame.
import { NBody } from './nbody.js';

export const STRIDE = 4; // x, y, radius, colour index per body

const FRAME = 1000 / 60;
const BUDGET = FRAME * 0.75;        // physics time we allow per frame before coarsening the step
const DT_FINE = 1 / 120, DT_COARSE = 1 / 30;

let sim = null;
let running = false;
let last = 0;
let free = [];
let timer = 0;
let stepMs = 0;          // cost of the most recent step
let costSum = 0, costN = 0;

function pack() {
  if (!free.length || !sim) return; // main thread still holds every buffer: skip this frame
  let buf = free.pop();
  const need = sim.n * STRIDE;
  if (buf.length < need) buf = new Float32Array(Math.ceil(need * 1.5) + 256);
  const { n, x, y, r, colour } = sim;
  for (let i = 0, k = 0; i < n; i++, k += STRIDE) {
    buf[k] = x[i];
    buf[k + 1] = y[i];
    buf[k + 2] = r[i];
    buf[k + 3] = colour[i];
  }
  postMessage({ type: 'frame', buf, n, time: sim.time, stepMs, dt: sim.o.dt }, [buf.buffer]);
}

// Keep the sim real-time: when a frame's worth of steps costs more than the budget, double the
// step (down to 30 steps per second); when it is comfortably cheap again, halve it back.
function adapt() {
  if (costN < 30) return;
  const perStep = costSum / costN;
  costSum = 0; costN = 0;
  const perFrame = perStep * (FRAME / 1000 / sim.o.dt);
  if (perFrame > BUDGET && sim.o.dt < DT_COARSE) sim.o.dt = Math.min(DT_COARSE, sim.o.dt * 2);
  else if (perFrame * 2 < BUDGET * 0.8 && sim.o.dt > DT_FINE) sim.o.dt = Math.max(DT_FINE, sim.o.dt / 2);
}

function loop() {
  if (!running) return;
  const start = performance.now();
  const before = sim.stats.steps;
  sim.advance((start - last) / 1000);
  last = start;
  const steps = sim.stats.steps - before;
  if (steps > 0) {
    stepMs = (performance.now() - start) / steps;
    costSum += stepMs * steps; costN += steps;
    adapt();
  }
  pack();
  const spent = performance.now() - start;
  timer = setTimeout(loop, Math.max(0, FRAME - spent));
}

onmessage = ({ data: msg }) => {
  switch (msg.type) {
    case 'init': {
      sim = new NBody({ ...msg.opts, dt: msg.opts.bodies > 4000 ? 1 / 60 : DT_FINE });
      const size = Math.ceil(msg.opts.bodies * 1.5) * STRIDE + 256;
      free = [new Float32Array(size), new Float32Array(size)];
      running = true;
      last = performance.now();
      clearTimeout(timer);
      loop();
      break;
    }
    case 'buffer':
      free.push(msg.buf);
      break;
    case 'viewport':
      sim?.setViewport(msg.halfW, msg.halfH);
      break;
    case 'add':
      sim?.addBody(msg.x, msg.y, msg.vx, msg.vy, msg.radius, msg.colour);
      break;
    case 'count':
      sim?.setCount(msg.count);
      break;
    case 'pause':
      running = false;
      clearTimeout(timer);
      break;
    case 'resume':
      if (sim && !running) {
        running = true;
        last = performance.now();
        loop();
      }
      break;
  }
};
