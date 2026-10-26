import { useEffect, useRef } from 'react';
import { Driver } from '../sim/driver.js';
import { probeGpu, createGpuEngine } from '../sim/gpu.js';
import { calibrateGpu, calibrateCpu } from '../sim/calibrate.js';
import { createDiscRenderer } from '../render/discs.js';
import { createTextWarp } from '../render/warp.js';
import { Boat } from '../sim/boat.js';

const UNITS = 100;          // the shorter side of the canvas spans this many sim units
const BUDGET = 10;          // ms of physics per frame before the timestep coarsens
const TIME_SCALE = 0.5;     // sim seconds per real second
const LENS_DISTANCE = 20;   // effective lens-to-source distance: rE = sqrt(2 rs D)
const EASE_IN = 0.16, EASE_OUT = 0.24; // seconds for the warp to appear and fade
const FALL_START = 0.04, FALL_END = 0.55; // scroll position, in viewport heights, over which the page falls
const BOAT_RELEASE = 0.1;   // the about card lets go as soon as the fall is under way, and drops with the stars

/**
 * The simulation canvas. Sizes itself to the device at startup (see calibrate.js) unless `stars`
 * is given. `warpTarget` is an element (the name card) to bend along with the field. `onReady`
 * is told the star count and the path (GPU or CPU) once the stars exist.
 */
export default function NBodyCanvas({ stars = 0, gpu = true, warpTarget = null, boatTarget = null, onReady = null }) {
  const onReadyRef = useRef(onReady); // read through a ref so a new callback never rebuilds the sim
  onReadyRef.current = onReady;
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = createDiscRenderer(canvas);
    const warp = warpTarget?.current ? createTextWarp(warpTarget.current) : null;
    const boatEl = boatTarget?.current || null; // the about card; its parent is the slot it is laid out in
    const boat = new Boat();
    let boatReturning = false;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;

    let width = 1, height = 1, dpr = 1, pxPerUnit = 1;
    const measure = () => {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
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
      onReadyRef.current?.({ bodies, gpu: !!device });
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
      placeBoat(lead);
    };

    // The about card is a boat once the page has fallen: it drops from where it is laid out,
    // floats, and is eased back into place when the water is gone. The fluid sees its hull.
    const slotPose = () => {
      // where the page lays the card out (its slot, untransformed) and the card's own size
      const r = boatEl.parentElement.getBoundingClientRect();
      const w = boatEl.offsetWidth, h = boatEl.offsetHeight;
      return { tx: (r.left + w / 2 - width / 2) / pxPerUnit, ty: (r.top + h / 2 - height / 2) / pxPerUnit, hw: w / 2 / pxPerUnit, hh: h / 2 / pxPerUnit };
    };
    const updateBoat = (dtSim) => {
      if (!boatEl || !sim) return;
      const { tx, ty, hw, hh } = slotPose();
      boat.hw = hw; boat.hh = hh; boat.ceiling = 64 / pxPerUnit; boat.moorX = tx;
      if (sim.fall >= BOAT_RELEASE && !sim.rewind) {
        if (!boat.active) { boat.pin(tx, ty); boat.active = true; boatReturning = false; }
        boat.step(dtSim, sim.fluid, driver.pressure, driver.positions, driver.velocities, sim.n, sim.halfW, sim.halfH, sim.fluid.o.g * sim.fall);
        if (![boat.x, boat.y, boat.th, boat.vx, boat.vy, boat.om].every(Number.isFinite)) {
          console.warn('boat went non-finite; reset', { hw, hh, wet: boat.wet, pressureFinite: Number.isFinite(driver.pressure[0]) });
          boat.pin(tx, ty); boat.active = true;
        }
      } else {
        if (boat.active) { boat.active = false; boatReturning = true; }
        if (boatReturning) {
          boat.easeTo(tx, ty, 0.18);
          if (Math.hypot(boat.x - tx, boat.y - ty) < 0.05 && Math.abs(boat.th) < 0.002) { boat.pin(tx, ty); boatReturning = false; }
        } else boat.pin(tx, ty);
      }
      sim.boat = sim.fall > 0 ? boat.hull : null;
    };
    const placeBoat = (lead) => {
      if (!boatEl) return;
      if (!boat.active && !boatReturning) { if (boatEl.style.transform) boatEl.style.transform = ''; return; }
      const { tx, ty } = slotPose();
      const bx = boat.x + boat.vx * lead, by = boat.y + boat.vy * lead, th = boat.th + boat.om * lead;
      boatEl.style.transform = `translate3d(${((bx - tx) * pxPerUnit).toFixed(2)}px, ${((by - ty) * pxPerUnit).toFixed(2)}px, 0) rotate(${th.toFixed(4)}rad)`;
    };

    // Physics ticks run back to back (they await the GPU); drawing happens every frame.
    let last = performance.now(), raf = 0, busy = false;
    const frame = (now) => {
      const dt = (now - last) / 1000;
      if (!busy && driver) {
        last = now;
        busy = true;
        driver.tick(dt, BUDGET).then((steps) => { if (steps) updateBoat(steps * sim.o.dt); }).catch((e) => console.error(e)).finally(() => { busy = false; });
      }
      draw(dt, now);
      raf = requestAnimationFrame(frame);
    };
    if (reduceMotion) draw(0, performance.now());
    else raf = requestAnimationFrame(frame);

    // Scrolling down lets the page fall: the field hands over to a uniform downward one.
    const onScroll = () => {
      const t = Math.min(Math.max((window.scrollY / window.innerHeight - FALL_START) / (FALL_END - FALL_START), 0), 1);
      sim?.setFall(t * t * (3 - 2 * t));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    ready.then(onScroll);

    // The pointer is read on the window so a press anywhere but a control places the hole.
    let pointerId = null;
    const isControl = (el) => !!el?.closest?.('a, button, input, textarea, select, .topbar');
    const place = (e) => {
      if (!sim) return;
      const px = e.clientX, py = e.clientY;
      sim.setHole((px - width / 2) / pxPerUnit, (py - height / 2) / pxPerUnit);
      lensState.x = px; lensState.y = py;
      lensState.cx = e.clientX; lensState.cy = e.clientY;
    };
    const onDown = (e) => {
      if ((e.button !== undefined && e.button !== 0) || pointerId !== null || !sim || isControl(e.target)) return;
      pointerId = e.pointerId;
      lensState.target = 1;
      place(e);
      sim.splash((e.clientX - width / 2) / pxPerUnit, (e.clientY - height / 2) / pxPerUnit); // only while the page is fallen
    };
    const onMove = (e) => { if (e.pointerId === pointerId) place(e); };
    const onUp = (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = null;
      sim?.clearHole();
      lensState.target = 0;
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    const onVisibility = () => { last = performance.now(); }; // no catch-up burst after a hidden tab
    document.addEventListener('visibilitychange', onVisibility);
    const onResize = () => { fit(); onScroll(); if (reduceMotion) draw(0, performance.now()); };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      disposed = true;
      engine?.destroy();
      warp?.dispose();
      renderer.dispose();
    };
  }, [stars, gpu, warpTarget, boatTarget]);

  return <canvas ref={canvasRef} className="nbody" aria-label="Gravity simulation of two colliding nebulae. Press and hold to place a black hole." />;
}
