import { useEffect, useRef } from 'react';
import { Driver } from '../sim/driver.js';
import { probeGpu, createGpuEngine } from '../sim/gpu.js';
import { createDiscRenderer } from '../render/discs.js';

const UNITS = 100;          // the shorter side of the canvas spans this many sim units
const BUDGET = 10;          // ms of physics per frame before the timestep coarsens
const TIME_SCALE = 0.5;     // sim seconds per real second
const LENS_DISTANCE = 6.3;  // effective lens-to-source distance: rE = sqrt(2 rs D)
const EASE_IN = 0.16, EASE_OUT = 0.24; // seconds for the hole's lens to appear and fade

export default function NBodyCanvas({ starsGpu, starsCpu, gpu = true }) {
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

    // Find out whether there is a GPU before deciding how many stars to make.
    let driver = null, sim = null, engine = null, disposed = false;
    const ready = (gpu ? probeGpu() : Promise.resolve(null)).then((device) => {
      if (disposed) { device?.destroy(); return; }
      driver = new Driver({ bodies: device ? starsGpu : starsCpu, prime: !device, timeScale: TIME_SCALE, halfW: width / 2 / pxPerUnit, halfH: height / 2 / pxPerUnit });
      sim = driver.sim;
      if (device) { engine = createGpuEngine(device, sim); driver.useGpu(engine); }
      window.__nbody = driver; // handy in the console
    });

    const fit = () => {
      measure();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      renderer.resize(canvas.width, canvas.height, pxPerUnit * dpr);
      sim?.setViewport(width / 2 / pxPerUnit, height / 2 / pxPerUnit);
    };
    fit();
    ready.then(() => sim?.setViewport(width / 2 / pxPerUnit, height / 2 / pxPerUnit));

    // The pointer's black hole: its lens eases in while held and out after release.
    const lensState = { x: 0, y: 0, k: 0, target: 0 };
    let uploadedState = -1;
    const draw = (dt, now) => {
      if (!sim) return;
      const rate = lensState.target > lensState.k ? dt / EASE_IN : dt / EASE_OUT;
      lensState.k += Math.max(-rate, Math.min(rate, lensState.target - lensState.k));
      const ease = lensState.k * lensState.k * (3 - 2 * lensState.k);
      const rs = sim.holeRadius;
      renderer.lens(lensState.x * dpr, lensState.y * dpr, Math.sqrt(2 * rs * LENS_DISTANCE) * pxPerUnit * dpr, rs * pxPerUnit * dpr, ease);
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
      lensState.x = px;
      lensState.y = py;
      label.style.transform = `translate(${px + 18}px, ${py - 34}px)`;
    };
    const onDown = (e) => {
      if ((e.button !== undefined && e.button !== 0) || pointerId !== null || !sim) return;
      pointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      lensState.target = 1;
      label.textContent = `M = ${sim.o.holeMass.toLocaleString()}  ·  rₛ = ${sim.holeRadius.toFixed(2)}  ·  c = ${sim.o.lightSpeed}`;
      place(e);
      label.classList.add('on');
    };
    const onMove = (e) => { if (e.pointerId === pointerId) place(e); };
    const onUp = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      sim?.clearHole();
      lensState.target = 0;
      label.classList.remove('on');
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
      renderer.dispose();
    };
  }, [starsGpu, starsCpu, gpu]);

  return (
    <>
      <canvas ref={canvasRef} className="nbody" aria-label="Gravity simulation of two colliding nebulae. Press and hold to place a black hole." />
      <div ref={labelRef} className="hole-label" aria-hidden="true" />
    </>
  );
}
