import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Driver, DT_FINE, DT_COARSE } from './driver.js';

function seeded(seed = 42) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

test('the step coarsens when physics is too expensive for the budget', () => {
  const d = new Driver({ bodies: 3000, random: seeded(), dt: DT_FINE });
  for (let f = 0; f < 120; f++) d.tick(1 / 60, 0.5); // half a millisecond per frame: impossible
  assert.equal(d.sim.o.dt, DT_COARSE);
});

test('the step refines again when physics is cheap', () => {
  const d = new Driver({ bodies: 10, random: seeded(), dt: DT_COARSE });
  for (let f = 0; f < 240; f++) d.tick(1 / 60, 10);
  assert.equal(d.sim.o.dt, DT_FINE);
});

test('a frame never runs past its budget by more than one step', () => {
  let clock = 0;
  const d = new Driver({ bodies: 50, random: seeded(), now: () => clock });
  const realStep = d.sim.step.bind(d.sim);
  d.sim.step = () => { clock += 4; realStep(); }; // pretend each step costs 4 ms
  const steps = d.tick(0.05, 10);                 // 50 ms of backlog at 120 steps/s would be 6 steps
  assert.ok(steps <= 3, `ran ${steps} steps`);
  assert.ok(d.acc <= d.sim.o.dt + 1e-12, 'backlog was dropped');
});

test('timeScale slows the simulation clock relative to real time', () => {
  const d = new Driver({ bodies: 10, random: seeded(), timeScale: 0.5 });
  for (let f = 0; f < 120; f++) d.tick(1 / 60, 10); // two real seconds
  assert.ok(Math.abs(d.sim.time - 1) < d.sim.o.dt * 2, `sim time ${d.sim.time}`);
});
