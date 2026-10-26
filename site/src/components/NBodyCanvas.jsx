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
const FALL_START = 0.6, FALL_END = 0.9; // scroll position, in viewport heights, over which the rain begins: as the about screen arrives
const STIR_SPEED_CAP = 400; // sim units per sim second: a flung pointer is not a jet
const BOAT_RELEASE = 0.1;   // the fall must be this far along before the card can be launched

/**
 * The simulation canvas. Sizes itself to the device at startup (see calibrate.js) unless `stars`
 * is given. `warpTarget` is an element (the name card) to bend along with the field.
 */
export default function NBodyCanvas({ stars = 0, gpu = true, warpTarget = null, boatTarget = null }) {
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

    // The world is the whole page, two screens tall: the galaxies on the first, the pool floored
    // by the second. The canvas is fixed and looks at the part of the world the page is scrolled to.
    const viewY = () => window.scrollY / pxPerUnit;

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
      renderer.view(0, viewY());
      // upload a physics state once, then move the stars on along their velocities each frame
      const fresh = driver.stateAt !== uploadedState;
      uploadedState = driver.stateAt;
      const lead = Math.min((now - driver.stateAt) / 1000, 0.25) * TIME_SCALE;
      renderer.draw(fresh ? driver.positions : null, fresh ? driver.velocities : null, driver.coloursChanged ? driver.colours : null, sim.n, lead);
      driver.coloursChanged = false;
      placeBoat(lead);
    };

    // The about card is a boat: it stays where the page laid it out while the rain falls past it,
    // is launched the moment the rising water reaches its keel, floats, and is eased back into
    // place when the water is gone. The fluid sees its hull throughout.
    const slotPose = () => {
      // where the page lays the card out (its slot, untransformed) and the card's own size
      const r = boatEl.parentElement.getBoundingClientRect();
      const w = boatEl.offsetWidth, h = boatEl.offsetHeight;
      return { tx: (r.left + w / 2 - width / 2) / pxPerUnit, ty: (r.top + h / 2 - height / 2) / pxPerUnit + viewY(), hw: w / 2 / pxPerUnit, hh: h / 2 / pxPerUnit };
    };
    const updateBoat = (dtSim) => {
      if (!boatEl || !sim) return;
      const { tx, ty, hw, hh } = slotPose();
      boat.hw = hw; boat.hh = hh; boat.ceiling = 64 / pxPerUnit; boat.moorX = tx; boat.top = sim.floorY - 2 * sim.halfH;
      if (sim.fall >= BOAT_RELEASE && !sim.rewind) {
        if (!boat.active) { boat.pin(tx, ty); boat.active = true; boat.held = true; boatReturning = false; } // docked until the water lifts it
        boat.step(dtSim, sim.fluid, driver.pressure, driver.positions, driver.velocities, sim.n, sim.halfW, sim.floorY, sim.fluid.o.g * sim.fall);
        if (![boat.x, boat.y, boat.th, boat.vx, boat.vy, boat.om].every(Number.isFinite)) {
          console.warn('boat went non-finite; reset', { hw, hh, wet: boat.wet, pressureFinite: Number.isFinite(driver.pressure[0]) });
          boat.pin(tx, ty); boat.active = true;
        }
      } else {
        if (boat.active) { boat.active = false; boat.held = false; boatReturning = true; }
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
      settleStir(now);
      draw(dt, now);
      raf = requestAnimationFrame(frame);
    };
    if (reduceMotion) draw(0, performance.now());
    else raf = requestAnimationFrame(frame);

    // Scrolling carries the galaxies up with the page; once the about screen has arrived, the rain begins.
    const onScroll = () => {
      const t = Math.min(Math.max((window.scrollY / window.innerHeight - FALL_START) / (FALL_END - FALL_START), 0), 1);
      sim?.setFall(t * t * (3 - 2 * t));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    ready.then(onScroll);

    // The pointer is read on the window so a press anywhere but a control counts. On the galaxies
    // a press places the black hole and its lens; on the pool it is a stone (a splash) and then a
    // finger in the water, dragging the water along while it moves.
    let press = null; // { id, pool, x, y, t, vx, vy }: the current press, with the pointer's smoothed velocity
    const isControl = (el) => !!el?.closest?.('a, button, input, textarea, select, .topbar');
    const toSim = (e) => [(e.clientX - width / 2) / pxPerUnit, (e.clientY - height / 2) / pxPerUnit + viewY()];
    const place = (e) => {
      sim.setHole(...toSim(e));
      lensState.x = e.clientX; lensState.y = e.clientY;
      lensState.cx = e.clientX; lensState.cy = e.clientY;
    };
    const onDown = (e) => {
      if ((e.button !== undefined && e.button !== 0) || press || !sim || isControl(e.target)) return;
      const pool = sim.fall > 0;
      press = { id: e.pointerId, pool, x: e.clientX, y: e.clientY, t: e.timeStamp, vx: 0, vy: 0 };
      if (!e.target.closest?.('.boat')) document.body.classList.add('pressing'); // a drag from the water must not select the card's text
      if (pool) { sim.splash(...toSim(e)); sim.setStir(...toSim(e), 0, 0); }
      else { lensState.target = 1; place(e); }
    };
    const onMove = (e) => {
      if (!press || e.pointerId !== press.id) return;
      if (!press.pool) { place(e); return; }
      // pointer velocity in sim units per sim second (the sim runs at TIME_SCALE of real time)
      const dt = Math.max(4, e.timeStamp - press.t) / 1000, k = 1 / (pxPerUnit * TIME_SCALE * dt);
      press.vx += ((e.clientX - press.x) * k - press.vx) * 0.5;
      press.vy += ((e.clientY - press.y) * k - press.vy) * 0.5;
      const speed = Math.hypot(press.vx, press.vy), cap = STIR_SPEED_CAP;
      if (speed > cap) { press.vx *= cap / speed; press.vy *= cap / speed; }
      press.x = e.clientX; press.y = e.clientY; press.t = e.timeStamp;
      sim.setStir(...toSim(e), press.vx, press.vy);
    };
    const onUp = (e) => {
      if (!press || e.pointerId !== press.id) return;
      if (press.pool) sim?.clearStir();
      else { sim?.clearHole(); lensState.target = 0; }
      press = null;
      document.body.classList.remove('pressing');
    };
    // a finger that stops moving sends no more events: let its velocity die away so the water does too
    const settleStir = (now) => {
      if (!press?.pool || !sim || now - press.t < 90 || (press.vx === 0 && press.vy === 0)) return;
      press.vx = press.vy = 0;
      sim.setStir((press.x - width / 2) / pxPerUnit, (press.y - height / 2) / pxPerUnit + viewY(), 0, 0);
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
