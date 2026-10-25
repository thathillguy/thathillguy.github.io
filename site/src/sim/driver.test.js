import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Driver, DT_FINE, DT_COARSE } from './driver.js';

function seeded(seed = 42) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

test('the step coarsens when physics is too expensive for the budget', async () => {
  const d = new Driver({ bodies: 3000, random: seeded(), dt: DT_FINE });
  for (let f = 0; f < 120; f++) await d.tick(1 / 60, 0.5); // half a millisecond per frame: impossible
  assert.equal(d.sim.o.dt, DT_COARSE);
});

test('the step refines again when physics is cheap', async () => {
  const d = new Driver({ bodies: 10, random: seeded(), dt: DT_COARSE });
  for (let f = 0; f < 240; f++) await d.tick(1 / 60, 10);
  assert.equal(d.sim.o.dt, DT_FINE);
});

test('timeScale slows the simulation clock relative to real time', async () => {
  const d = new Driver({ bodies: 10, random: seeded(), timeScale: 0.5 });
  for (let f = 0; f < 120; f++) await d.tick(1 / 60, 10); // two real seconds
  assert.ok(Math.abs(d.sim.time - 1) < d.sim.o.dt * 2, `sim time ${d.sim.time}`);
});

test('instance data mirrors the simulation', async () => {
  const d = new Driver({ bodies: 50, random: seeded() });
  await d.tick(1 / 30, 10);
  for (let i = 0; i < d.sim.n; i++) {
    assert.ok(Math.abs(d.positions[4 * i] - d.sim.x[i]) < 1e-5);
    assert.equal(d.colours[i], d.sim.colour[i]);
  }
});
