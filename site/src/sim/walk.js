// The Barnes-Hut tree walk for a range of bodies. Pure function over typed-array views, so the
// same code runs on the main thread and in worker threads over SharedArrayBuffer-backed arrays.

export const EMPTY = -1, INTERNAL = -2, CROWD = -3; // quadtree leaf states

/**
 * Adds the tree's accelerations to ax/ay for bodies [start, end) and records touching pairs
 * (i < j) into `touch` from `touchAt`, returning the new fill. `stack` is scratch space.
 */
export function walkRange(v, start, end, stack, touch, touchAt, touchCap) {
  const { x, y, r, ax, ay, nx, ny, nh, nm, ncx, ncy, nrmax, nleaf, nchild } = v;
  const { theta2, eps2, touchFactor } = v;
  for (let i = start; i < end; i++) {
    const xi = x[i], yi = y[i], ri = r[i];
    let axi = 0, ayi = 0;
    let sp = 0;
    stack[sp++] = 0;
    while (sp > 0) {
      const node = stack[--sp];
      const leaf = nleaf[node];
      if (leaf === i) continue;
      const dx = ncx[node] - xi, dy = ncy[node] - yi;
      const d2 = dx * dx + dy * dy;
      let open = false;
      if (leaf === INTERNAL) {
        // Always open a cell that contains this body (its lump would include the body itself)
        // or whose box is within touching reach (a contact inside must be seen).
        const bx = Math.max(Math.abs(xi - nx[node]) - nh[node], 0);
        const by = Math.max(Math.abs(yi - ny[node]) - nh[node], 0);
        const reach = touchFactor * (ri + nrmax[node]);
        const s = nh[node] * 2;
        open = bx * bx + by * by <= reach * reach || s * s >= theta2 * d2;
      } else if (leaf > i) {
        const t = touchFactor * (ri + r[leaf]);
        if (d2 < t * t && touchAt + 1 < touchCap) { touch[touchAt++] = i; touch[touchAt++] = leaf; }
      }
      if (!open) {
        const q = d2 + eps2;
        const f = nm[node] / (q * Math.sqrt(q));
        axi += f * dx;
        ayi += f * dy;
      } else {
        const c = node * 4;
        for (let j = 0; j < 4; j++) {
          const ch = nchild[c + j];
          if (ch >= 0 && nleaf[ch] !== EMPTY) stack[sp++] = ch;
        }
      }
    }
    ax[i] += axi;
    ay[i] += ayi;
  }
  return touchAt;
}
