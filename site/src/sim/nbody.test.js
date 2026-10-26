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
  const sim = new NBody({ bodies: 8000, random: seeded(5), releaseRate: 1000, halfW: 20, halfH: 14, nebulaRadius: 12, scaleLength: 4, separation: 24, periapsis: 8 });
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
  assert.ok(depth > 0.3 && depth < 0.5, `pool depth ${depth.toFixed(2)} of the height`);
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
  const sim = new NBody({ bodies: 12800, random: seeded(9), releaseRate: 1000, halfW: 32, halfH: 14, nebulaRadius: 12, scaleLength: 4, separation: 24, periapsis: 8 });
  sim.setFall(1);
  for (let k = 0; k < 60 * 8; k++) sim.step(); // let the drop's sloshing die down first
  const boat = new Boat({ sigma: 0.42 });
  boat.hw = 6; boat.hh = 2.5;
  boat.pin(0, 0); boat.active = true; // just above the water, so the drop is a small splash
  const positions = new Float32Array(sim.cap * 4), velocities = new Float32Array(sim.cap * 2);
  const pack = () => { for (let i = 0; i < sim.n; i++) { positions[4 * i] = sim.x[i]; positions[4 * i + 1] = sim.y[i]; velocities[2 * i] = sim.vx[i]; velocities[2 * i + 1] = sim.vy[i]; } };
  const g = sim.fluid.o.g;
  // the water's surface just beside the hull (the 5th percentile of y there): a tank this small
  // keeps a slow seiche going that the boat rides, so the far surface is not the one it floats in
  const surfaceNow = () => {
    const ys = [];
    for (let i = 0; i < sim.n; i++) { const d = Math.abs(sim.x[i] - boat.x); if (d > boat.hw + 1 && d < boat.hw + 6) ys.push(sim.y[i]); }
    ys.sort((a, b) => a - b);
    return ys[Math.floor(0.05 * ys.length)];
  };
  // judged over the last four seconds' mean: a tank this small never quite stops sloshing
  const total = 60 * 10, tail = 240;
  let submerged = 0, tilt = 0, bob = 0, floor = 0;
  for (let k = 0; k < total; k++) {
    sim.boat = boat.hull;
    sim.step();
    pack();
    boat.step(sim.o.dt, sim.fluid, sim.fluid.pres, positions, velocities, sim.n, sim.halfW, sim.halfH, g);
    if (k >= total - tail) {
      submerged += (boat.y + boat.hh - surfaceNow()) / (2 * boat.hh) / tail;
      tilt += Math.abs(boat.th) / tail; bob += Math.abs(boat.vy) / tail;
      if (boat.y + boat.hh >= sim.halfH - 1) floor++;
    }
  }
  assert.ok(submerged > 0.15 && submerged < 0.95, `mean submerged fraction ${submerged.toFixed(2)}`);
  assert.ok(tilt < 0.3, `mean tilt ${tilt.toFixed(3)}`);
  assert.ok(bob < 8, `bobbing, mean |vy| ${bob.toFixed(2)}`);
  assert.equal(floor, 0, 'never resting on the floor');
  let inside = 0;
  const c = Math.cos(boat.th), sn = Math.sin(boat.th);
  for (let i = 0; i < sim.n; i++) {
    const dx = sim.x[i] - boat.x, dy = sim.y[i] - boat.y;
    if (hullPush(c * dx + sn * dy, -sn * dx + c * dy, boat.hw, boat.hh)) inside++;
  }
  assert.equal(inside, 0, 'no star inside the hull');
});

test('a splash throws the water outward from the tap and nowhere else', () => {
  const sim = new NBody({ bodies: 9000, random: seeded(3), releaseRate: 1000, halfW: 36, halfH: 14, nebulaRadius: 12, scaleLength: 4, separation: 24, periapsis: 8 });
  sim.setFall(1);
  for (let k = 0; k < 60 * 5; k++) sim.step();
  const sx = 0, sy = sim.halfH - 3;
  const before = sim.energy();
  sim.splash(sx, sy);
  assert.ok(sim.pending, 'queued');
  sim.step();
  assert.equal(sim.pending, null, 'applied');
  let near = 0, outward = 0, far = 0, farFast = 0;
  for (let i = 0; i < sim.n; i++) {
    const dx = sim.x[i] - sx, dy = sim.y[i] - sy, d = Math.hypot(dx, dy);
    const vr = (sim.vx[i] * dx + sim.vy[i] * dy) / Math.max(d, 1e-6);
    if (d < sim.o.splashRadius * 0.7) { near++; if (vr > 5) outward++; }
    else if (d > sim.o.splashRadius * 1.6) { far++; if (Math.hypot(sim.vx[i], sim.vy[i]) > 40) farFast++; }
  }
  assert.ok(near > 50, `${near} stars near the tap`);
  assert.ok(outward > 0.6 * near, `${outward} of ${near} moving outward`);
  assert.ok(far > 500 && farFast < 0.02 * far, `${farFast} of ${far} far stars disturbed`);
  assert.ok(sim.energy() > before, 'the tap put energy in');
});

test('a finger dragged through the water carries the water near it along', () => {
  const sim = new NBody({ bodies: 9000, random: seeded(4), releaseRate: 1000, halfW: 36, halfH: 14, nebulaRadius: 12, scaleLength: 4, separation: 24, periapsis: 8 });
  sim.setFall(1);
  for (let k = 0; k < 60 * 5; k++) sim.step();
  const sx = 0, sy = sim.halfH - 3;
  sim.setStir(sx, sy, 60, 0); // moving right
  for (let k = 0; k < 6; k++) sim.step();
  let near = 0, along = 0, far = 0, farFast = 0;
  for (let i = 0; i < sim.n; i++) {
    const d = Math.hypot(sim.x[i] - sx, sim.y[i] - sy);
    if (d < sim.o.stirRadius * 0.5) { near++; if (sim.vx[i] > 15) along++; }
    else if (d > sim.o.stirRadius * 2) { far++; if (Math.abs(sim.vx[i]) > 30) farFast++; }
  }
  assert.ok(near > 30, `${near} stars under the finger`);
  assert.ok(along > 0.7 * near, `${along} of ${near} carried along`);
  assert.ok(far > 500 && farFast < 0.02 * far, `${farFast} of ${far} far stars disturbed`);
  sim.clearStir();
  assert.equal(sim.stir, null);
});

test('a fall lets the stars go a few at a time, and they rain rather than fly', () => {
  const sim = new NBody({ bodies: 6000, random: seeded(8), halfW: 36, halfH: 20, nebulaRadius: 12, scaleLength: 4, separation: 24, periapsis: 8 });
  sim.setFall(1);
  const steps = Math.round(0.5 / sim.o.dt);
  for (let k = 0; k < steps; k++) sim.step();
  assert.ok(Math.abs(sim.release - 0.5 * sim.o.releaseRate) < 0.02, `released fraction ${sim.release.toFixed(3)} after 0.5 s`);
  let released = 0, relDown = 0, relSide = 0, held = 0, heldDown = 0, heldSide = 0;
  for (let i = 0; i < sim.n; i++) {
    if (sim.relw[i] > 0.5) { released++; relDown += sim.vy[i]; relSide += Math.abs(sim.vx[i]); }
    else if (sim.relw[i] === 0) { held++; heldDown += sim.vy[i]; heldSide += Math.abs(sim.vx[i]); }
  }
  const frac = released / sim.n;
  assert.ok(frac > 0.08 && frac < 0.25, `${(100 * frac).toFixed(0)}% released`);
  assert.ok(held > 0.6 * sim.n && Math.abs(heldDown / held) < 3, `the ${held} unreleased stars are still orbiting (mean vy ${(heldDown / held).toFixed(2)})`);
  assert.ok(relDown / released > 5, `released stars are falling (mean vy ${(relDown / released).toFixed(1)}; some have landed already)`);
  assert.ok(relSide / released < heldSide / held, `released |vx| ${(relSide / released).toFixed(1)} vs orbiting ${(heldSide / held).toFixed(1)}`);
  for (let k = 0; k < 6 * steps; k++) sim.step();
  assert.equal(sim.release, 1, 'everyone released by 3.5 s');
});

test('a released star falling through air loses its sideways motion: rain, not a shot', () => {
  // sparse galaxies, thinner than the pool's rest density, so every star is in air once released
  const sim = new NBody({ bodies: 1500, random: seeded(12), releaseRate: 1000, halfW: 40, halfH: 30, nebulaRadius: 25, scaleLength: 8, separation: 30, periapsis: 10 });
  sim.setFall(1);
  for (let i = 0; i < sim.n; i++) sim.vx[i] += 30; // everyone flung to the right
  const side = () => { let a = 0; for (let i = 0; i < sim.n; i++) a += Math.abs(sim.vx[i]); return a / sim.n; };
  const before = side();
  for (let k = 0; k < Math.round(0.3 / sim.o.dt); k++) sim.step();
  const after = side();
  let down = 0; for (let i = 0; i < sim.n; i++) down += sim.vy[i];
  assert.ok(after < 0.65 * before, `mean |vx| ${before.toFixed(1)} -> ${after.toFixed(1)} after 0.3 s in the air`);
  assert.ok(down / sim.n > 10, `and falling, mean vy ${(down / sim.n).toFixed(1)}`);
});
