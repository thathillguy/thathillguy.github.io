import { useEffect, useRef } from 'react';
import { Driver } from '../sim/driver.js';
import { probeGpu, createGpuEngine } from '../sim/gpu.js';
import { calibrateGpu, calibrateCpu } from '../sim/calibrate.js';
import { createDiscRenderer } from '../render/discs.js';
import { createTextWarp } from '../render/warp.js';

const UNITS = 100;          // the shorter side of the canvas spans this many sim units
const BUDGET = 10;          // ms of physics per frame before the timestep coarsens
const TIME_SCALE = 0.5;     // sim seconds per real second
const LENS_DISTANCE = 20;   // effective lens-to-source distance: rE = sqrt(2 rs D)
const EASE_IN = 0.16, EASE_OUT = 0.24; // seconds for the warp to appear and fade

/**
 * The simulation canvas. Sizes itself to the device at startup (see calibrate.js) unless `stars`
 * is given. `warpTarget` is an element (the name card) to bend along with the field.
 */
export default function NBodyCanvas({ stars = 0, gpu = true, warpTarget = null }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = createDiscRenderer(canvas);
    const warp = warpTarget?.current ? createTextWarp(warpTarget.current) : null;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;

    let width = 1, height = 1, dpr = 1, pxPerUnit = 1;
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      pxPerUnit = Math.min(width, height) / UNITS;
    };
    measure();

    // Find the GPU, time it (or the CPU), then make as many stars as the device carries.
    let driver = null, sim = null, engine = null, disposed = false;
    const ready = (gpu ? probeGpu() : Promise.resolve(null)).then(async (device) => {
      let bodies = stars, probe = null;
      if (!bodies) {
        const limit = small ? 60000 : undefined;
        ({ bodies, probe } = device ? await calibrateGpu(device, { limit }) : calibrateCpu({ limit: small ? 8000 : undefined }));
      }
      if (disposed) { device?.destroy(); return; }
      driver = new Driver({ bodies, prime: !device, timeScale: TIME_SCALE, halfW: width / 2 / pxPerUnit, halfH: height / 2 / pxPerUnit });
      sim = driver.sim;
      if (device) { engine = createGpuEngine(device, sim); driver.useGpu(engine); }
      driver.probe = probe;
      window.__nbody = driver; // handy in the console
    });

    const einsteinRadius = () => Math.sqrt(2 * (sim?.holeRadius ?? 1.4) * LENS_DISTANCE) * pxPerUnit; // CSS px
    const fit = () => {
      measure();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      renderer.resize(canvas.width, canvas.height, pxPerUnit * dpr);
      sim?.setViewport(width / 2 / pxPerUnit, height / 2 / pxPerUnit);
      warp?.resize(einsteinRadius(), dpr);
    };
    fit();
    ready.then(() => { sim?.setViewport(width / 2 / pxPerUnit, height / 2 / pxPerUnit); warp?.resize(einsteinRadius(), dpr); });

    // The pointer's hole: its warp eases in while held and out after release.
    const lensState = { x: 0, y: 0, k: 0, target: 0 };
    let uploadedState = -1;
    const draw = (dt, now) => {
      if (!sim) { renderer.draw(null, null, null, 0); return; } // blank paper until the stars exist
      const rate = lensState.target > lensState.k ? dt / EASE_IN : dt / EASE_OUT;
      lensState.k += Math.max(-rate, Math.min(rate, lensState.target - lensState.k));
      const ease = lensState.k * lensState.k * (3 - 2 * lensState.k);
      renderer.lens(lensState.x * dpr, lensState.y * dpr, einsteinRadius() * dpr, ease);
      warp?.set(lensState.cx, lensState.cy, ease);
      // upload a physics state once, then move the stars on along their velocities each frame
      const fresh = driver.stateAt !== uploadedState;
      uploadedState = driver.stateAt;
      const lead = Math.min((now - driver.stateAt) / 1000, 0.25) * TIME_SCALE;
      renderer.draw(fresh ? driver.positions : null, fresh ? driver.velocities : null, driver.coloursChanged ? driver.colours : null, sim.n, lead);
      driver.coloursChanged = false;
    };

    // Physics ticks run back to back (they await the GPU); drawing happens every frame.
    let last = performance.now(), raf = 0, busy = false;
    const frame = (now) => {
      const dt = (now - last) / 1000;
      if (!busy && driver) {
        last = now;
        busy = true;
        driver.tick(dt, BUDGET).catch((e) => console.error(e)).finally(() => { busy = false; });
      }
      draw(dt, now);
      raf = requestAnimationFrame(frame);
    };
    if (reduceMotion) draw(0, performance.now());
    else raf = requestAnimationFrame(frame);

    let pointerId = null;
    const place = (e) => {
      if (!sim) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      sim.setHole((px - width / 2) / pxPerUnit, (py - height / 2) / pxPerUnit);
      lensState.x = px; lensState.y = py;
      lensState.cx = e.clientX; lensState.cy = e.clientY;
    };
    const onDown = (e) => {
      if ((e.button !== undefined && e.button !== 0) || pointerId !== null || !sim) return;
      pointerId = e.pointerId;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
      lensState.target = 1;
      place(e);
    };
    const onMove = (e) => { if (e.pointerId === pointerId) place(e); };
    const onUp = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      sim?.clearHole();
      lensState.target = 0;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    const onVisibility = () => { last = performance.now(); }; // no catch-up burst after a hidden tab
    document.addEventListener('visibilitychange', onVisibility);
    const ro = new ResizeObserver(() => { fit(); if (reduceMotion) draw(0, performance.now()); });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      disposed = true;
      engine?.destroy();
      warp?.dispose();
      renderer.dispose();
    };
  }, [stars, gpu, warpTarget]);

  return <canvas ref={canvasRef} className="nbody" aria-label="Gravity simulation of two colliding nebulae. Press and hold to place a black hole." />;
}
