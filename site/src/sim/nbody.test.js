import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NBody, circularSpeed, schwarzschildRadius, BLACK } from './nbody.js';

// Deterministic stand-in for Math.random (Park-Miller).
function seeded(seed = 42) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

test('a body at circular speed around a lone core stays on a circle for ten orbits', () => {
  const sim = new NBody({ bodies: 0, nebulae: 1, random: seeded(), density: 1e-9 });
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
  const sim = new NBody({ bodies: 0, nebulae: 1, random: seeded(), density: 1 });
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
  const sim = new NBody({ bodies: 2000, random: seeded(11), touchFactor: 0 });
  const spread = (c) => {
    let s = 0, cnt = 0;
    for (let i = 0; i < sim.n; i++) if (sim.home[i] === c) { s += Math.hypot(sim.x[i] - sim.cx[c], sim.y[i] - sim.cy[c]); cnt++; }
    return s / cnt;
  };
  assert.ok(spread(0) < sim.o.nebulaRadius && spread(1) < sim.o.nebulaRadius, 'bodies sit inside their discs');
  const [px0, py0] = sim.momentum();
  assert.ok(Math.hypot(px0, py0) < 1e-6, `the system starts at rest: |p| = ${Math.hypot(px0, py0)}`);
  const d0 = Math.hypot(sim.cx[1] - sim.cx[0], sim.cy[1] - sim.cy[0]);
  for (let k = 0; k < 120 * 5; k++) sim.step();
  const d1 = Math.hypot(sim.cx[1] - sim.cx[0], sim.cy[1] - sim.cy[0]);
  assert.ok(d1 < d0, `cores should be closing in: ${d0} -> ${d1}`);
  const [px, py] = sim.momentum();
  const scale = sim.o.nebulaMass * 10;
  assert.ok(Math.hypot(px - px0, py - py0) / scale < 0.001, `tree-approximation momentum drift ${Math.hypot(px - px0, py - py0)}`);
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
  const sim = new NBody({ bodies: 100, random: seeded(9), touchFactor: 0 });
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
  const sim = new NBody({ bodies: 2000, random: seeded(3), touchFactor: 0 });
  for (let k = 0; k < 60 * 20; k++) sim.advance(1 / 60); // 20 seconds at 60 fps
  assert.equal(sim.count, 2000);
  for (let i = 0; i < sim.count; i++) assert.ok(Number.isFinite(sim.x[i]) && Number.isFinite(sim.y[i]));
  for (let c = 0; c < sim.k; c++) assert.ok(Number.isFinite(sim.cx[c]) && Number.isFinite(sim.cvx[c]));
});

test('a black hole under the pointer pulls bodies in, swallows them, and can be removed', () => {
  const sim = new NBody({ bodies: 2000, random: seeded(21), touchFactor: 0, lightSpeed: 46, holeMass: 1500 });
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

test('touching bodies merge: mass and momentum add, count drops by one without fragments', () => {
  const sim = new NBody({ bodies: 0, nebulae: 1, random: seeded(), density: 1, touchFactor: 1, replaceMerged: false, fragmentFraction: 0 });
  sim.addBody(30, 0, 0, 10, 1, 0, 0);
  sim.addBody(31.2, 0, 2, 8, 1.2, 1, 0);
  const m0 = sim.m[0] + sim.m[1];
  const px = sim.m[0] * sim.vx[0] + sim.m[1] * sim.vx[1];
  const py = sim.m[0] * sim.vy[0] + sim.m[1] * sim.vy[1];
  sim.step();
  assert.equal(sim.count, 1);
  assert.equal(sim.stats.merges, 1);
  assert.ok(Math.abs(sim.m[0] - m0) < 1e-12, 'mass adds exactly');
  assert.ok(Math.abs(sim.r[0] - sim.radiusOf(sim.m[0])) < 1e-6, 'radius follows mass');
  const tol = sim.o.dt * sim.m[0] * 50; // one half-kick of the core's gravity
  assert.ok(Math.abs(sim.m[0] * sim.vx[0] - px) < tol, 'x momentum');
  assert.ok(Math.abs(sim.m[0] * sim.vy[0] - py) < tol, 'y momentum');
  assert.equal(sim.colour[0], 1, 'the heavier body keeps its colour');
});

test('a hard impact throws off fragments and conserves total mass and momentum', () => {
  const sim = new NBody({ bodies: 0, nebulae: 1, nebulaMass: 0, random: seeded(), density: 1, touchFactor: 1 });
  sim.addBody(-2, 0, 6, 0, 1.5, 0, 0);
  sim.addBody(2, 0.5, -6, 0, 1.0, 1, 0);
  const total = (a) => { let m = 0, px = 0, py = 0; for (let i = 0; i < a.n; i++) { m += a.m[i]; px += a.m[i] * a.vx[i]; py += a.m[i] * a.vy[i]; } return [m, px, py]; };
  const [m0, px0, py0] = total(sim);
  for (let k = 0; k < 60 && sim.stats.merges === 0; k++) sim.step();
  assert.equal(sim.stats.merges, 1, 'they collided');
  assert.ok(sim.count >= 2 && sim.count <= 4, `merged body plus one to three fragments, got ${sim.count}`);
  const [m1, px1, py1] = total(sim);
  assert.ok(Math.abs(m1 - m0) < 1e-9, `mass ${m0} -> ${m1}`);
  assert.ok(Math.abs(px1 - px0) < 1e-6 && Math.abs(py1 - py0) < 1e-6, 'momentum conserved');
  let big = 0; for (let i = 1; i < sim.n; i++) if (sim.m[i] > sim.m[big]) big = i;
  for (let i = 0; i < sim.n; i++) if (i !== big) assert.ok(sim.r[i] < sim.r[big], 'fragments are smaller than the survivor');
});

test('a gentle impact simply combines, with no fragments', () => {
  const sim = new NBody({ bodies: 0, nebulae: 1, nebulaMass: 0, random: seeded(), density: 1, touchFactor: 1 });
  sim.addBody(-2, 0, 0.8, 0, 1.5, 0, 0);
  sim.addBody(2, 0.3, -0.8, 0, 1.0, 1, 0);
  let k = 0; while (sim.stats.merges === 0 && k++ < 2000) sim.step();
  assert.equal(sim.stats.merges, 1);
  assert.equal(sim.count, 1);
});

test('a merge never adds energy: the fragment lives off what the inelastic collision destroys', () => {
  function seededBy(n) { let s = n; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
  const energy = (a) => {
    let e = 0;
    for (let i = 0; i < a.n; i++) e += 0.5 * a.m[i] * (a.vx[i] ** 2 + a.vy[i] ** 2);
    const eps2 = a.o.softening ** 2;
    for (let i = 0; i < a.n; i++) for (let j = i + 1; j < a.n; j++) { const dx = a.x[j] - a.x[i], dy = a.y[j] - a.y[i]; e -= a.m[i] * a.m[j] / Math.sqrt(dx * dx + dy * dy + eps2); }
    return e;
  };
  const rnd = seededBy(5);
  let checked = 0;
  for (let trial = 0; trial < 60; trial++) {
    const sim = new NBody({ bodies: 0, nebulae: 1, nebulaMass: 0, density: 0.5, touchFactor: 1, random: seededBy(trial + 1) });
    const v = 0.5 + 12 * rnd(), dy = (rnd() - 0.5) * 3;
    sim.addBody(-6, -dy / 2, v, (rnd() - 0.5) * 2, 1 + 2 * rnd(), 0, 0);
    sim.addBody(6, dy / 2, -v, (rnd() - 0.5) * 2, 0.5 + 2 * rnd(), 3, 0);
    const e0 = energy(sim);
    let k = 0; while (sim.stats.merges === 0 && k++ < 2000) sim.step();
    if (!sim.stats.merges) continue;
    const e1 = energy(sim);
    assert.ok(e1 <= e0 + 1e-9 * Math.abs(e0), `trial ${trial}: energy rose from ${e0} to ${e1}`);
    checked++;
  }
  assert.ok(checked > 40, `only ${checked} collisions happened`);
});


test('with touchFactor 0 bodies pass through each other', () => {
  const sim = new NBody({ bodies: 0, nebulae: 1, random: seeded(), density: 1, touchFactor: 0 });
  sim.addBody(30, 0, 0, 10, 1, 0, 0);
  sim.addBody(30.5, 0, 0, 10, 1, 1, 0);
  for (let k = 0; k < 50; k++) sim.step();
  assert.equal(sim.count, 2);
  assert.equal(sim.stats.merges, 0);
});

test('radius is a pure function of mass, before and after merging', () => {
  const sim = new NBody({ bodies: 500, random: seeded(13), touchFactor: 1, fragmentFraction: 0 });
  const check = () => { for (let i = 0; i < sim.n; i++) if (!sim.black[i]) assert.ok(Math.abs(sim.r[i] - sim.radiusOf(sim.m[i])) < 1e-6 * sim.r[i]); };
  check();
  let total = 0; for (let i = 0; i < sim.n; i++) total += sim.m[i];
  for (let k = 0; k < 120; k++) sim.step();
  assert.ok(sim.stats.merges > 0, 'some merges happened');
  check();
  let after = 0; for (let i = 0; i < sim.n; i++) after += sim.m[i];
  assert.ok(Math.abs(after - total) < 1e-9 * total, `total body mass ${total} -> ${after}`);
});

test('a small body hitting a much heavier one is eaten whole, however fast', () => {
  const sim = new NBody({ bodies: 0, nebulae: 1, nebulaMass: 0, random: seeded(), density: 1, touchFactor: 1 });
  sim.addBody(-3, 0, 12, 0, 0.7, 0, 0);   // mass 0.34
  sim.addBody(3, 0.4, -12, 0, 3.0, 1, 0); // mass 27
  const m0 = sim.m[0] + sim.m[1];
  let k = 0; while (sim.stats.merges === 0 && k++ < 2000) sim.step();
  assert.equal(sim.stats.merges, 1);
  assert.equal(sim.count, 1, 'no fragments');
  assert.ok(Math.abs(sim.m[0] - m0) < 1e-12);
});

test('a body collapses into a black hole once its Schwarzschild radius reaches its size, then eats whole', () => {
  // c chosen so that the merged mass (2.32, radius 1.32, rs 1.35) collapses while each half (1.16, rs 0.68) does not
  const sim = new NBody({ bodies: 0, nebulae: 1, nebulaMass: 0, random: seeded(), density: 1, touchFactor: 1, lightSpeed: 1.85 });
  sim.addBody(-2, 0, 0.6, 0, 1.05, 0, 0);
  sim.addBody(2, 0.2, -0.6, 0, 1.05, 1, 0);
  assert.ok(schwarzschildRadius(sim.m[0], 1.85) < sim.r[0], 'not a black hole on its own');
  let k = 0; while (sim.stats.merges === 0 && k++ < 3000) sim.step();
  assert.equal(sim.count, 1);
  assert.equal(sim.stats.collapses, 1);
  assert.equal(sim.black[0], 1);
  assert.equal(sim.colour[0], BLACK);
  assert.ok(Math.abs(sim.r[0] - schwarzschildRadius(sim.m[0], 1.85)) < 1e-6, 'drawn at its horizon');
  // a fast small body hitting it is swallowed without fragments, and the hole stays a hole
  const m0 = sim.m[0];
  sim.addBody(sim.x[0] + 6, sim.y[0] + 0.1, -12, 0, 0.9, 2, 0);
  k = 0; while (sim.stats.merges === 1 && k++ < 3000) sim.step();
  assert.equal(sim.count, 1, 'nothing flew off');
  assert.equal(sim.black[0], 1);
  assert.ok(sim.m[0] > m0);
});

test('stars are collisionless: the nebulae keep every body through a long run', () => {
  const sim = new NBody({ bodies: 3000, random: seeded(17) });
  for (let k = 0; k < 120 * 5; k++) sim.step();
  assert.equal(sim.count, 3000);
  assert.equal(sim.stats.merges, 0);
  assert.equal(sim.stats.collapses, 0);
});
