import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NBody } from './nbody.js';

// Deterministic stand-in for Math.random (Park-Miller).
function seeded(seed = 42) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

test('a body launched at circular speed stays on a circle for ten orbits', () => {
  const sim = new NBody({ bodies: 0, random: seeded() });
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
  const sim = new NBody({ bodies: 0, random: seeded() });
  const [vx, vy] = sim.orbitalVelocity(45, 0, 0.7);
  sim.addBody(45, 0, vx, vy, 1.5, 1);
  const e0 = sim.energy();
  for (let k = 0; k < 20000; k++) sim.step();
  const e1 = sim.energy();
  assert.ok(Math.abs((e1 - e0) / e0) < 1e-5, `relative energy error ${(e1 - e0) / e0}`);
});

test('merging conserves mass and momentum', () => {
  const sim = new NBody({ bodies: 0, random: seeded(), touchFactor: 0.6 });
  sim.addBody(30, 0, 0, 10, 1, 0);
  sim.addBody(31, 0, 2, 8, 1.2, 1);
  const m0 = sim.m[0] + sim.m[1];
  const px = sim.m[0] * sim.vx[0] + sim.m[1] * sim.vx[1];
  const py = sim.m[0] * sim.vy[0] + sim.m[1] * sim.vy[1];
  sim.step();
  assert.equal(sim.count, 1);
  assert.equal(sim.stats.merges, 1);
  assert.ok(Math.abs(sim.m[0] - m0) < 1e-9);
  // momentum is checked before the post-merge kick, so allow the one half-step of gravity
  const tol = 0.5 * sim.o.dt * sim.m[0] * 10;
  assert.ok(Math.abs(sim.m[0] * sim.vx[0] - px) < tol, 'x momentum');
  assert.ok(Math.abs(sim.m[0] * sim.vy[0] - py) < tol, 'y momentum');
  assert.equal(sim.colour[0], 1, 'the heavier body keeps its colour');
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

test('population is kept constant and finite through a long run', () => {
  const sim = new NBody({ bodies: 60, random: seeded(3), touchFactor: 0.6 });
  sim.advance(0.5); // clamps to maxFrame, so only a few steps run
  for (let k = 0; k < 60 * 30; k++) sim.advance(1 / 60); // 30 seconds at 60 fps
  assert.equal(sim.count, 60);
  for (let i = 0; i < sim.count; i++) {
    assert.ok(Number.isFinite(sim.x[i]) && Number.isFinite(sim.y[i]));
    assert.ok(sim.r[i] <= sim.o.mergedMaxRadius + 1e-12);
  }
});

test('with merging off, bodies pass through each other', () => {
  const sim = new NBody({ bodies: 0, random: seeded() });
  sim.addBody(30, 0, 0, 10, 1, 0);
  sim.addBody(30.5, 0, 0, 10, 1, 1);
  for (let k = 0; k < 100; k++) sim.step();
  assert.equal(sim.count, 2);
  assert.equal(sim.stats.merges, 0);
});
