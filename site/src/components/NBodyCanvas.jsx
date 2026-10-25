import { useEffect, useRef } from 'react';
import { Driver } from '../sim/driver.js';
import { schwarzschildRadius } from '../sim/nbody.js';
import { createDiscRenderer } from '../render/discs.js';

const UNITS = 100;   // the shorter side of the canvas spans this many sim units
const BUDGET = 10;   // ms of physics per frame before the timestep coarsens
const TIME_SCALE = 0.6; // sim seconds per real second; lower is calmer
const STRIDE = 4;    // x, y, radius, colour per body in the GPU buffer
const LENS_DISTANCE = 6.3; // effective lens-to-source distance in sim units: rE = sqrt(2 rs D)
const EASE_IN = 0.16, EASE_OUT = 0.24; // seconds for the lens to appear and fade

// Test scene: thousands of small bodies with random drift and a mild pull to the centre, so
// collisions keep happening. It runs on indefinitely: whatever forms, stays.
const COLLIDE_OPTS = { bodies: 0, nebulae: 1, nebulaMass: 400, coreFraction: 1, coreSoftening: 25, density: 0.5, touchFactor: 1, mergeChance: 1 };
function setupCollision(sim, count) {
  sim.setCount(0);
  const W = sim.halfW * 0.92, H = sim.halfH * 0.88;
  // a coarse grid keeps spawns from overlapping without an n^2 search
  const cell = 2.5, cols = Math.ceil((2 * W) / cell) + 1, rows = Math.ceil((2 * H) / cell) + 1;
  const grid = new Map();
  const key = (x, y) => (Math.floor((y + H) / cell) * cols + Math.floor((x + W) / cell));
  const clear = (x, y, r) => {
    const cx = Math.floor((x + W) / cell), cy = Math.floor((y + H) / cell);
    for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
      const bucket = grid.get(j * cols + i);
      if (bucket) for (const p of bucket) if (Math.hypot(p.x - x, p.y - y) < p.r + r + 0.3) return false;
    }
    return true;
  };
  for (let n = 0; n < count; n++) {
    const u = Math.random();
    const radius = u < 0.85 ? 0.12 + Math.random() * 0.25 : u < 0.98 ? 0.4 + Math.random() * 0.5 : 1 + Math.random() * 1.2;
    let x, y, tries = 0;
    do {
      x = (Math.random() * 2 - 1) * W;
      y = (Math.random() * 2 - 1) * H;
    } while (++tries < 30 && !clear(x, y, radius));
    const k = key(x, y);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ x, y, r: radius });
    const speed = 0.5 + Math.random() * 4, ang = Math.random() * Math.PI * 2;
    sim.addBody(x, y, speed * Math.cos(ang), speed * Math.sin(ang), radius, Math.floor(Math.random() * 4), 0);
  }
  // The bodies did not exist when the sim chose its constants: choose them again now.
  sim.o.lightSpeed = null;
  sim.o.holeMass = null;
  sim._setConstants();
  sim.o.holeSoftening = 2;
}

export default function NBodyCanvas({ bodies, scene, swarm = 3000 }) {
  const canvasRef = useRef(null);
  const labelRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const label = labelRef.current;
    const renderer = createDiscRenderer(canvas);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 1, height = 1, dpr = 1, pxPerUnit = 1;
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      pxPerUnit = Math.min(width, height) / UNITS;
    };
    measure();

    const collide = scene === 'collide';
    const driver = new Driver({ bodies, timeScale: TIME_SCALE, halfW: width / 2 / pxPerUnit, halfH: height / 2 / pxPerUnit, ...(collide ? COLLIDE_OPTS : {}) });
    const sim = driver.sim;
    if (collide) setupCollision(sim, swarm);

    const fit = () => {
      measure();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      renderer.resize(canvas.width, canvas.height, pxPerUnit * dpr);
      sim.setViewport(width / 2 / pxPerUnit, height / 2 / pxPerUnit);
    };
    fit();

    // Collapsed bodies are left out: the lens pass draws their horizons, and a disc in the scene
    // texture would show up a second time, displaced by any other hole's lensing.
    let packed = new Float32Array(0);
    const pack = () => {
      const { n, x, y, r, colour, black } = sim;
      if (packed.length < n * STRIDE) packed = new Float32Array(Math.ceil(n * 1.5) * STRIDE + 256);
      let count = 0;
      for (let i = 0, k = 0; i < n; i++) {
        if (black[i]) continue;
        packed[k] = x[i]; packed[k + 1] = y[i]; packed[k + 2] = r[i]; packed[k + 3] = colour[i];
        k += STRIDE; count++;
      }
      return count;
    };

    // The pointer's lens sits where the pointer is; its strength eases toward 1 while held and 0
    // after. Collapsed bodies lens too (the heaviest few if there are many).
    const lensState = { x: 0, y: 0, k: 0, target: 0 };
    const lenses = [];
    const toPx = (sx, sy) => [(sx * pxPerUnit + width / 2) * dpr, (sy * pxPerUnit + height / 2) * dpr];
    const drawOnce = (dt = 0) => {
      const rate = lensState.target > lensState.k ? dt / EASE_IN : dt / EASE_OUT;
      lensState.k += Math.max(-rate, Math.min(rate, lensState.target - lensState.k));
      const ease = lensState.k * lensState.k * (3 - 2 * lensState.k);
      renderer.begin();
      renderer.bodies(packed, pack());
      lenses.length = 0;
      if (ease > 0) {
        const rs = sim.holeRadius;
        lenses.push({ x: lensState.x * dpr, y: lensState.y * dpr, rE: Math.sqrt(2 * rs * LENS_DISTANCE) * pxPerUnit * dpr, rH: rs * pxPerUnit * dpr, k: ease });
      }
      const holes = [];
      for (let i = 0; i < sim.n; i++) if (sim.black[i]) holes.push(i);
      holes.sort((a, b) => sim.m[b] - sim.m[a]);
      for (const i of holes.slice(0, 7)) {
        const rs = schwarzschildRadius(sim.m[i], sim.o.lightSpeed);
        const [px, py] = toPx(sim.x[i], sim.y[i]);
        lenses.push({ x: px, y: py, rE: Math.sqrt(2 * rs * LENS_DISTANCE) * pxPerUnit * dpr, rH: rs * pxPerUnit * dpr, k: 1 });
      }
      renderer.lens(lenses);
      renderer.end();
    };

    let last = performance.now();
    let raf = 0;
    const frame = (now) => {
      const dt = (now - last) / 1000;
      driver.tick(dt, BUDGET);
      last = now;
      drawOnce(dt);
      raf = requestAnimationFrame(frame);
    };
    if (reduceMotion) drawOnce();
    else raf = requestAnimationFrame(frame);

    // Press and hold to put a black hole under the pointer; it follows a drag and goes on release.
    let pointerId = null;
    const place = (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      sim.setHole((px - width / 2) / pxPerUnit, (py - height / 2) / pxPerUnit);
      lensState.x = px;
      lensState.y = py;
      label.style.transform = `translate(${px + 18}px, ${py - 34}px)`;
      if (reduceMotion) drawOnce(1);
    };
    const onDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      lensState.target = 1;
      label.textContent = `M = ${Math.round(sim.o.holeMass).toLocaleString()}  ·  r\u209B = ${sim.holeRadius.toFixed(2)}  ·  c = ${sim.o.lightSpeed.toFixed(sim.o.lightSpeed < 10 ? 2 : 0)}`;
      place(e);
      label.classList.add('on');
    };
    const onMove = (e) => {
      if (e.pointerId === pointerId) place(e);
    };
    const onUp = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      sim.clearHole();
      lensState.target = 0;
      label.classList.remove('on');
      if (reduceMotion) drawOnce(1);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    const onVisibility = () => { last = performance.now(); }; // no catch-up burst after a hidden tab
    document.addEventListener('visibilitychange', onVisibility);
    const ro = new ResizeObserver(() => { fit(); if (reduceMotion) drawOnce(); });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      renderer.dispose();
    };
  }, [bodies, scene, swarm]);

  return (
    <>
      <canvas ref={canvasRef} className="nbody" aria-label="Gravity simulation of two colliding nebulae. Press and hold to place a black hole." />
      <div ref={labelRef} className="hole-label" aria-hidden="true" />
    </>
  );
}
