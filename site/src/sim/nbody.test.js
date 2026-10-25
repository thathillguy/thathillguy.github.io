import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NBody, circularSpeed } from './nbody.js';

// Deterministic stand-in for Math.random (Park-Miller).
function seeded(seed = 42) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

test('a body at circular speed around a lone core stays on a circle for ten orbits', () => {
  const sim = new NBody({ bodies: 0, nebulae: 1, random: seeded(), massPerArea: 1e-9 });
  const rho = 30, v = circularSpeed(sim.cm[0], sim.o.coreSoftening, rho);
  sim.addBody(rho, 0, 0, v, 1, 0);
  const period = (2 * Math.PI * rho) / v;
  const steps = Math.round((10 * period) / sim.o.dt);
  let worst = 0;
  for (let k = 0; k < steps; k++) {
    sim.step();
    worst = Math.max(worst, Math.abs(Math.hypot(sim.x[0] - sim.cx[0], sim.y[0] - sim.cy[0]) - rho));
  }
  assert.ok(worst < rho * 0.005, `radius drifted by ${worst}`);
});

test('energy of an eccentric orbit is conserved by the integrator', () => {
  const sim = new NBody({ bodies: 0, nebulae: 1, random: seeded(), massPerArea: 1 });
  const v = 0.7 * circularSpeed(sim.cm[0], sim.o.coreSoftening, 40);
  sim.addBody(40, 0, 0, v, 1.5, 1);
  const e0 = sim.energy();
  for (let k = 0; k < 10000; k++) sim.step();
  const e1 = sim.energy();
  assert.ok(Math.abs((e1 - e0) / e0) < 1e-4, `relative energy error ${(e1 - e0) / e0}`);
});

test('two cores alone follow the planned eccentric orbit and stay bound', () => {
  const sim = new NBody({ bodies: 0, random: seeded(), coreFraction: 1 });
  const sep0 = Math.hypot(sim.cx[1] - sim.cx[0], sim.cy[1] - sim.cy[0]);
  let closest = Infinity, furthest = 0;
  for (let k = 0; k < 120 * 120; k++) { // two minutes of sim time
    sim.step();
    const d = Math.hypot(sim.cx[1] - sim.cx[0], sim.cy[1] - sim.cy[0]);
    closest = Math.min(closest, d);
    furthest = Math.max(furthest, d);
  }
  assert.ok(Math.abs(closest - sim.o.periapsis) < 0.15 * sim.o.periapsis, `periapsis ${closest}`);
  assert.ok(furthest < sep0 * 1.05, `the pair drifted apart to ${furthest}`);
  const [px, py] = sim.momentum();
  assert.ok(Math.hypot(px, py) < 1e-6, 'net momentum stays zero');
});

test('Barnes-Hut accelerations match the exact all-pairs result closely', () => {
  const sim = new NBody({ bodies: 3000, random: seeded(5) });
  const ex = new Float64Array(sim.n), ey = new Float64Array(sim.n);
  sim._accelerateDirect(ex, ey);
  sim._accelerate();
  let num = 0, den = 0, worst = 0;
  for (let i = 0; i < sim.n; i++) {
    const dx = sim.ax[i] - ex[i], dy = sim.ay[i] - ey[i];
    const err = dx * dx + dy * dy, ref = ex[i] * ex[i] + ey[i] * ey[i];
    num += err; den += ref;
    worst = Math.max(worst, Math.sqrt(err / ref));
  }
  const rms = Math.sqrt(num / den);
  assert.ok(rms < 0.01, `rms relative error ${rms}`);
  assert.ok(worst < 0.1, `worst relative error ${worst}`);
  assert.ok(sim.stats.nodes > sim.n, 'the tree was built');
});

test('nebulae start as two separate discs and begin to approach each other', () => {
  const sim = new NBody({ bodies: 2000, random: seeded(11) });
  const spread = (c) => {
    let s = 0, cnt = 0;
    for (let i = 0; i < sim.n; i++) if (sim.home[i] === c) { s += Math.hypot(sim.x[i] - sim.cx[c], sim.y[i] - sim.cy[c]); cnt++; }
    return s / cnt;
  };
  assert.ok(spread(0) < sim.o.nebulaRadius && spread(1) < sim.o.nebulaRadius, 'bodies sit inside their discs');
  const d0 = Math.hypot(sim.cx[1] - sim.cx[0], sim.cy[1] - sim.cy[0]);
  for (let k = 0; k < 120 * 5; k++) sim.step();
  const d1 = Math.hypot(sim.cx[1] - sim.cx[0], sim.cy[1] - sim.cy[0]);
  assert.ok(d1 < d0, `cores should be closing in: ${d0} -> ${d1}`);
  const [px, py] = sim.momentum();
  const scale = sim.o.nebulaMass * 10;
  assert.ok(Math.hypot(px, py) / scale < 0.01, `momentum drift ${Math.hypot(px, py)}`);
});

test('bodies flung far away are replaced inside a nebula', () => {
  const sim = new NBody({ bodies: 20, random: seeded(7) });
  sim.addBody(1000, 0, 0, 0, 1, 0);
  assert.equal(sim.count, 21);
  sim.step();
  assert.equal(sim.stats.escaped, 1);
  assert.equal(sim.count, 20);
  const i = sim.count - 1; // the respawn lands at the end of the array
  const c = sim.home[i];
  assert.ok(Math.hypot(sim.x[i] - sim.cx[c], sim.y[i] - sim.cy[c]) <= sim.o.nebulaRadius + 0.5);
});

test('setCount grows and shrinks the population', () => {
  const sim = new NBody({ bodies: 100, random: seeded(9) });
  sim.setCount(250);
  assert.equal(sim.count, 250);
  sim.step();
  assert.equal(sim.count, 250);
  sim.setCount(40);
  assert.equal(sim.count, 40);
  sim.step();
  assert.equal(sim.count, 40);
});

test('population is kept constant and finite through a long run', () => {
  const sim = new NBody({ bodies: 2000, random: seeded(3) });
  for (let k = 0; k < 60 * 20; k++) sim.advance(1 / 60); // 20 seconds at 60 fps
  assert.equal(sim.count, 2000);
  for (let i = 0; i < sim.count; i++) assert.ok(Number.isFinite(sim.x[i]) && Number.isFinite(sim.y[i]));
  for (let c = 0; c < sim.k; c++) assert.ok(Number.isFinite(sim.cx[c]) && Number.isFinite(sim.cvx[c]));
});

test('a black hole under the pointer pulls bodies in, swallows them, and can be removed', () => {
  const sim = new NBody({ bodies: 2000, random: seeded(21) });
  const c = 0; // put the hole just outside nebula 0's disc
  const hx = sim.cx[c] + 40, hy = sim.cy[c];
  sim.setHole(hx, hy);
  assert.equal(sim.k, 3);
  // mean acceleration of nebula-0 bodies now points toward the hole
  sim._accelerate();
  let ax = 0, cnt = 0;
  for (let i = 0; i < sim.n; i++) if (sim.home[i] === 0) { ax += sim.ax[i]; cnt++; }
  assert.ok(ax / cnt > 0, 'bodies are pulled toward +x where the hole is');
  for (let k = 0; k < 120 * 8; k++) sim.step();
  assert.ok(sim.stats.swallowed > 5, `swallowed ${sim.stats.swallowed}`);
  assert.equal(sim.count, 2000, 'swallowed bodies are replaced');
  assert.equal(sim.cx[sim.hole], hx, 'the hole does not move');
  sim.clearHole();
  assert.equal(sim.k, 2);
  assert.equal(sim.hole, null);
  for (let k = 0; k < 10; k++) sim.step();
  assert.equal(sim.count, 2000);
});
