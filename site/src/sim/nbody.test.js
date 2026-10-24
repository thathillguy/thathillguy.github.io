import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NBody } from './nbody.js';

// Deterministic stand-in for Math.random (Park-Miller).
function seeded(seed = 42) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

test('a body launched at circular speed stays on a circle for ten orbits', () => {
  const sim = new NBody({ bodies: 0, random: seeded(), massPerArea: 1 });
  const rho = 40;
  const [vx, vy] = sim.orbitalVelocity(rho, 0);
  sim.addBody(rho, 0, vx, vy, 1, 0);
  const period = (2 * Math.PI * rho) / sim.circularSpeed(rho);
  const steps = Math.round((10 * period) / sim.o.dt);
  let worst = 0;
  for (let k = 0; k < steps; k++) {
    sim.step();
    worst = Math.max(worst, Math.abs(Math.hypot(sim.x[0], sim.y[0]) - rho));
  }
  assert.ok(worst < rho * 0.005, `radius drifted by ${worst}`);
  assert.equal(sim.count, 1);
});

test('energy of an eccentric orbit is conserved by the integrator', () => {
  const sim = new NBody({ bodies: 0, random: seeded(), massPerArea: 1 });
  const [vx, vy] = sim.orbitalVelocity(45, 0, 0.7);
  sim.addBody(45, 0, vx, vy, 1.5, 1);
  const e0 = sim.energy();
  for (let k = 0; k < 10000; k++) sim.step();
  const e1 = sim.energy();
  assert.ok(Math.abs((e1 - e0) / e0) < 1e-4, `relative energy error ${(e1 - e0) / e0}`);
});

test('Barnes-Hut accelerations match the exact all-pairs result closely', () => {
  const sim = new NBody({ bodies: 3000, random: seeded(5), bodyMassFraction: 0.5 });
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

test('two bodies with no central mass orbit each other and stay bound', () => {
  const sim = new NBody({ bodies: 0, random: seeded(), centralMass: 0, massPerArea: 100, softening: 0.1 });
  // equal masses on a circular mutual orbit of radius 5 (separation 10): v = sqrt(m / (4 r))... with G=1, v^2 = m/(4r)
  const m = 100, rr = 5, v = Math.sqrt(m / (4 * rr));
  sim.addBody(-rr, 0, 0, v, 1, 0);
  sim.addBody(rr, 0, 0, -v, 1, 1);
  for (let k = 0; k < 6000; k++) {
    sim.step();
    const d = Math.hypot(sim.x[1] - sim.x[0], sim.y[1] - sim.y[0]);
    assert.ok(d > 6 && d < 14, `separation wandered to ${d} at step ${k}`);
  }
  assert.equal(sim.count, 2);
});

test('bodies flung far away or swallowed by the centre are replaced', () => {
  const sim = new NBody({ bodies: 20, random: seeded(7) });
  sim.addBody(1000, 0, 0, 0, 1, 0);
  sim.addBody(0.5, 0, 0, 0, 1, 0);
  assert.equal(sim.count, 22);
  sim.step();
  assert.equal(sim.stats.escaped, 1);
  assert.equal(sim.stats.absorbed, 1);
  assert.equal(sim.count, 20);
  for (let i = 0; i < sim.count; i++) assert.ok(Number.isFinite(sim.x[i]) && Number.isFinite(sim.vx[i]));
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
  sim.advance(0.5); // clamps to maxFrame, so only a few steps run
  for (let k = 0; k < 60 * 10; k++) sim.advance(1 / 60); // 10 seconds at 60 fps
  assert.equal(sim.count, 2000);
  for (let i = 0; i < sim.count; i++) assert.ok(Number.isFinite(sim.x[i]) && Number.isFinite(sim.y[i]));
});

test('previewPath follows the same orbit the integrator produces', () => {
  const sim = new NBody({ bodies: 0, random: seeded(), massPerArea: 1 });
  const [vx, vy] = sim.orbitalVelocity(35, 0, 0.8);
  const path = sim.previewPath(35, 0, vx, vy, 60, 1 / 30);
  sim.addBody(35, 0, vx, vy, 1, 0);
  for (let k = 0; k < 2 * 120; k++) sim.step(); // 2 s at dt = 1/120
  const dx = path[118] - sim.x[0], dy = path[119] - sim.y[0];
  assert.ok(Math.hypot(dx, dy) < 0.5, `preview drifted ${Math.hypot(dx, dy)}`);
});
