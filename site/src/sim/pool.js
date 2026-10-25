// A pool of walker workers sharing the simulation's memory. Only possible when the page is
// cross-origin isolated (SharedArrayBuffer available); otherwise the sim walks on one thread.

export function canShare() {
  return typeof SharedArrayBuffer !== 'undefined' && (typeof crossOriginIsolated === 'undefined' || crossOriginIsolated);
}

export class WalkerPool {
  constructor(size) {
    this.size = size;
    this.workers = [];
    for (let i = 0; i < size; i++) {
      this.workers.push(new Worker(new URL('./walker.js', import.meta.url), { type: 'module' }));
    }
  }

  /** Walk all n bodies of the sim in parallel. Resolves to the list of touching pairs filled. */
  walk(sim) {
    const n = sim.n;
    const chunk = Math.max(64, Math.ceil(n / (this.size * 6)));
    sim._ctrl[0] = 0;
    const perWorker = sim._touchPer;
    const msgBase = {
      type: 'walk', gen: sim._shareGen, buffers: sim._shareGenSent === sim._shareGen ? undefined : sim.sharedBuffers(),
      n, chunk, theta2: sim.o.theta * sim.o.theta, eps2: sim.o.softening * sim.o.softening, touchFactor: sim.o.touchFactor,
      touchCap: perWorker,
    };
    sim._shareGenSent = sim._shareGen;
    const t0 = performance.now();
    const busy = new Array(this.size).fill(0), chunks = new Array(this.size).fill(0);
    return Promise.all(this.workers.map((w, k) => new Promise((resolve) => {
      w.onmessage = ({ data }) => { if (data.type === 'done') { busy[k] = data.busy; chunks[k] = data.chunks; resolve([k * perWorker, data.count]); } };
      w.postMessage({ ...msgBase, touchStart: k * perWorker });
    }))).then((regions) => {
      this.lastStats = { wall: performance.now() - t0, busy, chunks, chunk };
      return regions;
    });
  }

  terminate() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
