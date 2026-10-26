import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NBody, circularSpeed } from './nbody.js';
import { Boat } from './boat.js';
import { hullPush } from './fluid.js';

// Deterministic stand-in for Math.random (Park-Miller).
function seeded(seed = 42) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

test('a star at circular speed around a lone core stays on a circle for ten orbits', () => {
  const sim = new NBody({ bodies: 0, random: seeded() });
  sim.cm[1] = 0; // switch the second core off
  const rho = 30, v = circularSpeed(sim.cm[0], sim.o.coreSoftening, rho);
  const c0 = [sim.cx[0], sim.cy[0]];
  sim.cpinned[0] = 1; sim.cpinned[1] = 1; sim.cvx.fill(0); sim.cvy.fill(0);
  sim.addBody(c0[0] + rho, c0[1], 0, v, 0.05, 0, 0);
  const period = (2 * Math.PI * rho) / v;
  const steps = Math.round((10 * period) / sim.o.dt);
  let worst = 0;
  for (let k = 0; k < steps; k++) {
    sim.step();
    worst = Math.max(worst, Math.abs(Math.hypot(sim.x[0] - c0[0], sim.y[0] - c0[1]) - rho));
  }
  assert.ok(worst < rho * 0.005, `radius drifted by ${worst}`);
});

test('energy of an eccentric orbit is conserved by the integrator', () => {
  const sim = new NBody({ bodies: 0, random: seeded() });
  sim.cm[1] = 0; sim.cpinned[0] = 1; sim.cpinned[1] = 1; sim.cvx.fill(0); sim.cvy.fill(0);
  const v = 0.7 * circularSpeed(sim.cm[0], sim.o.coreSoftening, 40);
  sim.addBody(sim.cx[0] + 40, sim.cy[0], 0, v, 0.05, 1, 0);
  sim.m[0] = 1;
  const e0 = sim.energy();
  for (let k = 0; k < 10000; k++) sim.step();
  const e1 = sim.energy();
  assert.ok(Math.abs((e1 - e0) / e0) < 1e-4, `relative energy error ${(e1 - e0) / e0}`);
});

test('two cores alone follow the planned eccentric orbit and stay bound', () => {
  const sim = new NBody({ bodies: 0, random: seeded(), coreFraction: 1 });
  const sep0 = Math.hypot(sim.cx[1] - sim.cx[0], sim.cy[1] - sim.cy[0]);
  let closest = Infinity, furthest = 0;
  for (let k = 0; k < 120 * 120; k++) {
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
  let num = 0, den = 0;
  for (let i = 0; i < sim.n; i++) {
    const dx = sim.ax[i] - ex[i], dy = sim.ay[i] - ey[i];
    num += dx * dx + dy * dy; den += ex[i] * ex[i] + ey[i] * ey[i];
  }
  const rms = Math.sqrt(num / den);
  assert.ok(rms < 0.01, `rms relative error ${rms}`);
});

test('the system starts at rest, the nebulae close in, and momentum drift is tiny', () => {
  const sim = new NBody({ bodies: 2000, random: seeded(11) });
  const [px0, py0] = sim.momentum();
  assert.ok(Math.hypot(px0, py0) < 1e-6, `|p| at start = ${Math.hypot(px0, py0)}`);
  const d0 = Math.hypot(sim.cx[1] - sim.cx[0], sim.cy[1] - sim.cy[0]);
  for (let k = 0; k < 120 * 5; k++) sim.step();
  const d1 = Math.hypot(sim.cx[1] - sim.cx[0], sim.cy[1] - sim.cy[0]);
  assert.ok(d1 < d0, `cores should be closing in: ${d0} -> ${d1}`);
  const [px, py] = sim.momentum();
  assert.ok(Math.hypot(px - px0, py - py0) / (sim.o.nebulaMass * 10) < 0.001, `drift ${Math.hypot(px - px0, py - py0)}`);
});

test('stars are collisionless: the population is constant and finite through a long run', () => {
  const sim = new NBody({ bodies: 2000, random: seeded(3) });
  for (let k = 0; k < 60 * 20; k++) sim.advance(1 / 60);
  assert.equal(sim.count, 2000);
  for (let i = 0; i < sim.count; i++) assert.ok(Number.isFinite(sim.x[i]) && Number.isFinite(sim.y[i]));
});

test('stars flung far away are replaced at a nebula rim, in place', () => {
  const sim = new NBody({ bodies: 20, random: seeded(7) });
  sim.x[5] = 1000; sim.y[5] = 0;
  const rewritten = sim.cull();
  assert.deepEqual(rewritten, [5]);
  assert.equal(sim.count, 20);
  const c = sim.home[5];
  const d = Math.hypot(sim.x[5] - sim.cx[c], sim.y[5] - sim.cy[c]);
  assert.ok(d > 0.8 * sim.o.nebulaRadius && d < 1.1 * sim.o.nebulaRadius, `respawned at ${d}`);
});

test('a black hole under the pointer pulls stars in, swallows them, and can be removed', () => {
  const sim = new NBody({ bodies: 2000, random: seeded(21) });
  const hx = sim.cx[0] + 40, hy = sim.cy[0];
  sim.setHole(hx, hy);
  assert.equal(sim.k, 3);
  sim._accelerate();
  let ax = 0, cnt = 0;
  for (let i = 0; i < sim.n; i++) if (sim.home[i] === 0) { ax += sim.ax[i]; cnt++; }
  assert.ok(ax / cnt > 0, 'stars are pulled toward +x where the hole is');
  for (let k = 0; k < 120 * 8; k++) sim.step();
  assert.ok(sim.stats.swallowed > 5, `swallowed ${sim.stats.swallowed}`);
  assert.equal(sim.count, 2000);
  assert.equal(sim.cx[sim.hole], hx, 'the hole does not move');
  sim.clearHole();
  assert.equal(sim.k, 2);
  for (let k = 0; k < 10; k++) sim.step();
  assert.equal(sim.count, 2000);
});

test('a fall pools the stars as a fluid filling about 40% of the height, and coming back rewinds the same stars exactly', () => {
  const sim = new NBody({ bodies: 8000, random: seeded(5), halfW: 20, halfH: 14, nebulaRadius: 12, scaleLength: 4, separation: 24, periapsis: 8 });
  for (let k = 0; k < 60; k++) sim.step();
  const before = { x: sim.x.slice(0, sim.n), y: sim.y.slice(0, sim.n), vx: sim.vx.slice(0, sim.n), e: sim.energy() };
  sim.setFall(1);
  for (let k = 0; k < 60 * 8; k++) sim.step();
  // every star inside the walls, and the pool's surface near 40% of the height
  let inside = 0;
  const ys = [];
  for (let i = 0; i < sim.n; i++) {
    if (Math.abs(sim.x[i]) <= sim.halfW && sim.y[i] <= sim.halfH) inside++;
    ys.push(sim.y[i]);
  }
  assert.equal(inside, sim.n, 'all stars inside the pool walls');
  ys.sort((a, b) => a - b);
  const surface = ys[Math.floor(0.05 * ys.length)]; // the top 5% is spray
  const depth = (sim.halfH - surface) / (2 * sim.halfH);
  assert.ok(depth > 0.32 && depth < 0.5, `pool depth ${depth.toFixed(2)} of the height`);
  assert.equal(sim.count, 8000);
  sim.setFall(0);
  assert.ok(sim.rewind, 'a rewind starts');
  const total = sim.rewind.total;
  for (let k = 0; k < total; k++) sim.step();
  assert.equal(sim.rewind, null, 'the rewind finishes');
  assert.deepEqual(sim.x.slice(0, sim.n), before.x);
  assert.deepEqual(sim.y.slice(0, sim.n), before.y);
  assert.deepEqual(sim.vx.slice(0, sim.n), before.vx);
  assert.ok(Math.abs(sim.energy() - before.e) < 1e-9 * Math.abs(before.e), 'energy is what it was');
  for (let k = 0; k < 30; k++) sim.step();
  assert.equal(sim.count, 8000);
});

test('the about card floats: it settles with roughly its density fraction submerged, level, and the stars stay out of it', () => {
  const sim = new NBody({ bodies: 12800, random: seeded(9), halfW: 32, halfH: 14, nebulaRadius: 12, scaleLength: 4, separation: 24, periapsis: 8 });
  sim.setFall(1);
  for (let k = 0; k < 60 * 4; k++) sim.step();
  const boat = new Boat({ sigma: 0.42 });
  boat.hw = 6; boat.hh = 2.5;
  boat.pin(0, -8); boat.active = true;
  const positions = new Float32Array(sim.cap * 4), velocities = new Float32Array(sim.cap * 2);
  const pack = () => { for (let i = 0; i < sim.n; i++) { positions[4 * i] = sim.x[i]; positions[4 * i + 1] = sim.y[i]; velocities[2 * i] = sim.vx[i]; velocities[2 * i + 1] = sim.vy[i]; } };
  const g = sim.fluid.o.g;
  for (let k = 0; k < 60 * 8; k++) {
    sim.boat = boat.hull;
    sim.step();
    pack();
    boat.step(sim.o.dt, positions, velocities, sim.n, sim.halfW, sim.halfH, g);
  }
  const [yl, yr] = boat.surface;
  const surface = (yl + yr) / 2;
  const submerged = (boat.y + boat.hh - surface) / (2 * boat.hh);
  // the pool is still sloshing from the splash, so this is a floating check, not a still one
  assert.ok(submerged > 0.25 && submerged < 0.85, `submerged fraction ${submerged.toFixed(2)}`);
  assert.ok(Math.abs(boat.th) < 0.4, `tilt ${boat.th.toFixed(3)}`);
  assert.ok(Math.abs(boat.vy) < 8, `bobbing, vy ${boat.vy.toFixed(2)}`);
  assert.ok(boat.y + boat.hh < sim.halfH - 1, 'not resting on the floor');
  let inside = 0;
  const c = Math.cos(boat.th), sn = Math.sin(boat.th);
  for (let i = 0; i < sim.n; i++) {
    const dx = sim.x[i] - boat.x, dy = sim.y[i] - boat.y;
    if (hullPush(c * dx + sn * dy, -sn * dx + c * dy, boat.hw, boat.hh)) inside++;
  }
  assert.equal(inside, 0, 'no star inside the hull');
});
