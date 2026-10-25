// Worker: walks chunks of bodies through the shared tree until the shared chunk counter runs out.
import { walkRange } from './walk.js';

let views = null;
let gen = -1;
const stack = new Int32Array(4096);

onmessage = ({ data: msg }) => {
  if (msg.type !== 'walk') return;
  if (msg.gen !== gen) {
    // new or resized buffers: rebuild the typed-array views over the shared memory
    const b = msg.buffers;
    views = {
      x: new Float64Array(b.x), y: new Float64Array(b.y), r: new Float64Array(b.r),
      ax: new Float64Array(b.ax), ay: new Float64Array(b.ay),
      nx: new Float64Array(b.nx), ny: new Float64Array(b.ny), nh: new Float64Array(b.nh), nm: new Float64Array(b.nm),
      ncx: new Float64Array(b.ncx), ncy: new Float64Array(b.ncy), nrmax: new Float64Array(b.nrmax),
      nleaf: new Int32Array(b.nleaf), nchild: new Int32Array(b.nchild),
      ctrl: new Int32Array(b.ctrl), touch: new Int32Array(b.touch),
    };
    gen = msg.gen;
  }
  const v = views;
  v.theta2 = msg.theta2; v.eps2 = msg.eps2; v.touchFactor = msg.touchFactor;
  const { chunk, n, touchStart, touchCap } = msg;
  let touchAt = touchStart;
  const t0 = performance.now();
  let chunks = 0;
  for (;;) {
    const c = Atomics.add(v.ctrl, 0, 1);
    const start = c * chunk;
    if (start >= n) break;
    touchAt = walkRange(v, start, Math.min(n, start + chunk), stack, v.touch, touchAt, touchStart + touchCap);
    chunks++;
  }
  postMessage({ type: 'done', count: touchAt - touchStart, busy: performance.now() - t0, chunks });
};
