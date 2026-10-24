import { useEffect, useRef } from 'react';
import { COLOURS, DEFAULTS, orbitalVelocity, previewPath } from '../sim/nbody.js';
import { createDiscRenderer } from '../render/discs.js';

const UNITS = 100;        // the shorter side of the canvas spans this many sim units
const FLING = 1.0;        // launch speed per sim unit of pull-back
const TAP_PX = 5;         // pointer movement under this counts as a click, not a pull
const BLACK = 4, GREY = 5;

export default function NBodyCanvas({ bodies, onInteract, onStats }) {
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const callbacks = useRef({ onInteract, onStats });
  callbacks.current = { onInteract, onStats };
  const initialBodies = useRef(bodies);

  // Follow later changes to the body count without rebuilding the sim.
  useEffect(() => {
    workerRef.current?.postMessage({ type: 'count', count: bodies });
  }, [bodies]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = createDiscRenderer(canvas);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const simOpts = { centralMass: DEFAULTS.centralMass, centralRadius: DEFAULTS.centralRadius, spin: DEFAULTS.spin };

    let width = 1, height = 1, dpr = 1, pxPerUnit = 1;
    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      pxPerUnit = Math.min(width, height) / UNITS;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      renderer.resize(canvas.width, canvas.height, pxPerUnit * dpr);
      worker.postMessage({ type: 'viewport', halfW: width / 2 / pxPerUnit, halfH: height / 2 / pxPerUnit });
    };

    const worker = new Worker(new URL('../sim/worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    // latest frame from the worker, drawn on the next animation frame then handed back
    let pending = null;
    let frames = 0, lastStat = performance.now(), simTime = 0, lastSimTime = 0, stepMs = 0, stepSamples = 0, dt = 0;
    worker.onmessage = ({ data: msg }) => {
      if (msg.type !== 'frame') return;
      if (pending) worker.postMessage({ type: 'buffer', buf: pending.buf }, [pending.buf.buffer]);
      pending = msg;
      simTime = msg.time;
      stepMs += msg.stepMs;
      stepSamples++;
      dt = msg.dt;
    };

    fit();
    worker.postMessage({ type: 'init', opts: { bodies: initialBodies.current, halfW: width / 2 / pxPerUnit, halfH: height / 2 / pxPerUnit } });

    // A pull: the body is held at the pointer, tethered to the anchor where the press began.
    // Releasing launches it from the pointer back through the anchor, like an elastic band.
    const pull = { active: false, pulling: false, ax: 0, ay: 0, x: 0, y: 0, radius: 1, colour: 0 };
    const launchVelocity = () => [(pull.ax - pull.x) * FLING, (pull.ay - pull.y) * FLING];
    const overlay = new Float32Array(4 * 512);

    const drawOverlay = () => {
      let k = 0;
      const put = (x, y, r, c) => { overlay[k++] = x; overlay[k++] = y; overlay[k++] = r; overlay[k++] = c; };

      // predicted path, dotted and tapering
      const [vx, vy] = launchVelocity();
      const path = previewPath(simOpts, pull.x, pull.y, vx, vy);
      for (let p = 0; p < path.length; p += 4) put(path[p], path[p + 1], 0.32 * (1 - p / path.length) + 0.1, GREY);
      renderer.overlay(overlay, k / 4, 0.75, 0);

      // the band, as closely spaced dots from the anchor to the pointer
      k = 0;
      const dx = pull.x - pull.ax, dy = pull.y - pull.ay;
      const len = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(len / 0.5));
      for (let s = 0; s <= steps; s++) put(pull.ax + (dx * s) / steps, pull.ay + (dy * s) / steps, 0.22, BLACK);
      renderer.overlay(overlay, k / 4, 0.45, 0);

      // anchor and the held body
      k = 0;
      put(pull.ax, pull.ay, 0.5, BLACK);
      put(pull.x, pull.y, pull.radius, pull.colour);
      renderer.overlay(overlay, 2, 1, 1);
    };

    const centre = new Float32Array([0, 0, DEFAULTS.centralRadius, BLACK]);

    const draw = () => {
      renderer.begin();
      if (pending) {
        renderer.bodies(pending.buf, pending.n);
        worker.postMessage({ type: 'buffer', buf: pending.buf }, [pending.buf.buffer]);
        pending = null;
      } else {
        renderer.bodies(null, 0);
      }
      renderer.overlay(centre, 1, 1, 0);
      if (pull.active && pull.pulling) drawOverlay();
      renderer.end();

      frames++;
      const now = performance.now();
      if (now - lastStat >= 1000) {
        const fps = (frames * 1000) / (now - lastStat);
        const speed = (simTime - lastSimTime) / ((now - lastStat) / 1000);
        callbacks.current.onStats?.({ fps, speed, renderer: renderer.kind, stepMs: stepSamples ? stepMs / stepSamples : 0, stepsPerSecond: dt ? Math.round(1 / dt) : 0 });
        frames = 0; lastStat = now; lastSimTime = simTime; stepMs = 0; stepSamples = 0;
      }
    };

    let raf = 0;
    const frame = () => { draw(); raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);
    if (reduceMotion) worker.postMessage({ type: 'pause' });

    const toSim = (e) => {
      const rect = canvas.getBoundingClientRect();
      return [(e.clientX - rect.left - width / 2) / pxPerUnit, (e.clientY - rect.top - height / 2) / pxPerUnit];
    };

    const onDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      [pull.ax, pull.ay] = toSim(e);
      pull.x = pull.ax;
      pull.y = pull.ay;
      pull.active = true;
      pull.pulling = false;
      pull.radius = 1.0 + Math.random() * 0.6;
      pull.colour = Math.floor(Math.random() * COLOURS.length);
    };
    const onMove = (e) => {
      if (!pull.active) return;
      [pull.x, pull.y] = toSim(e);
      if (Math.hypot(pull.x - pull.ax, pull.y - pull.ay) * pxPerUnit > TAP_PX) pull.pulling = true;
    };
    const onUp = (e) => {
      if (!pull.active) return;
      pull.active = false;
      [pull.x, pull.y] = toSim(e);
      let x = pull.ax, y = pull.ay, vx, vy;
      if (pull.pulling) {
        x = pull.x; y = pull.y;
        [vx, vy] = launchVelocity();
      } else {
        [vx, vy] = orbitalVelocity(simOpts, x, y, 0.97);
      }
      worker.postMessage({ type: 'add', x, y, vx, vy, radius: pull.radius, colour: pull.colour });
      callbacks.current.onInteract?.();
    };
    const onCancel = () => { pull.active = false; };
    const onVisibility = () => {
      if (reduceMotion) return;
      worker.postMessage({ type: document.hidden ? 'pause' : 'resume' });
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    document.addEventListener('visibilitychange', onVisibility);

    const ro = new ResizeObserver(fit);
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      worker.terminate();
      workerRef.current = null;
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="nbody" aria-label="Gravity simulation" />;
}
