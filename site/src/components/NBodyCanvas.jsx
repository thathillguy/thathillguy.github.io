import { useEffect, useRef } from 'react';
import { Driver } from '../sim/driver.js';
import { createDiscRenderer } from '../render/discs.js';

const UNITS = 100;   // the shorter side of the canvas spans this many sim units
const BUDGET = 10;   // ms of physics per frame before the timestep coarsens
const STRIDE = 4;    // x, y, radius, colour per body in the GPU buffer
const EINSTEIN = 4.2; // lensing ring radius in sim units; the dark horizon is the swallow radius
const EASE_IN = 0.16, EASE_OUT = 0.24; // seconds for the lens to appear and fade

export default function NBodyCanvas({ bodies }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
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

    const driver = new Driver({ bodies, halfW: width / 2 / pxPerUnit, halfH: height / 2 / pxPerUnit });
    const sim = driver.sim;

    const fit = () => {
      measure();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      renderer.resize(canvas.width, canvas.height, pxPerUnit * dpr);
      sim.setViewport(width / 2 / pxPerUnit, height / 2 / pxPerUnit);
    };
    fit();

    let packed = new Float32Array(0);
    const pack = () => {
      const { n, x, y, r, colour } = sim;
      if (packed.length < n * STRIDE) packed = new Float32Array(Math.ceil(n * 1.5) * STRIDE + 256);
      for (let i = 0, k = 0; i < n; i++, k += STRIDE) {
        packed[k] = x[i]; packed[k + 1] = y[i]; packed[k + 2] = r[i]; packed[k + 3] = colour[i];
      }
      return n;
    };

    // The lens sits where the pointer is; its strength eases toward 1 while held and 0 after.
    const lensState = { x: 0, y: 0, k: 0, target: 0 };
    const drawOnce = (dt = 0) => {
      const rate = lensState.target > lensState.k ? dt / EASE_IN : dt / EASE_OUT;
      lensState.k += Math.max(-rate, Math.min(rate, lensState.target - lensState.k));
      const ease = lensState.k * lensState.k * (3 - 2 * lensState.k);
      renderer.begin();
      renderer.bodies(packed, pack());
      renderer.lens(lensState.x * dpr, lensState.y * dpr, EINSTEIN * pxPerUnit * dpr, sim.o.holeRadius * pxPerUnit * dpr, ease);
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
      if (reduceMotion) drawOnce(1);
    };
    const onDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      lensState.target = 1;
      place(e);
    };
    const onMove = (e) => {
      if (e.pointerId === pointerId) place(e);
    };
    const onUp = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      sim.clearHole();
      lensState.target = 0;
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
  }, [bodies]);

  return <canvas ref={canvasRef} className="nbody" aria-label="Gravity simulation of two colliding nebulae. Press and hold to place a black hole." />;
}
