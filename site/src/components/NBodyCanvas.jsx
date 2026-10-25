import { useEffect, useRef } from 'react';
import { Driver } from '../sim/driver.js';
import { createDiscRenderer } from '../render/discs.js';

const UNITS = 100;   // the shorter side of the canvas spans this many sim units
const BUDGET = 10;   // ms of physics per frame before the timestep coarsens
const STRIDE = 4;    // x, y, radius, colour per body in the GPU buffer

export default function NBodyCanvas({ bodies, onStats }) {
  const canvasRef = useRef(null);
  const driverRef = useRef(null);
  const onStatsRef = useRef(onStats);
  onStatsRef.current = onStats;
  const initialBodies = useRef(bodies);

  // Follow later changes to the body count without rebuilding the sim.
  useEffect(() => {
    driverRef.current?.sim.setCount(bodies);
  }, [bodies]);

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

    const driver = new Driver({ bodies: initialBodies.current, halfW: width / 2 / pxPerUnit, halfH: height / 2 / pxPerUnit });
    driverRef.current = driver;
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

    const drawOnce = () => {
      renderer.begin();
      renderer.bodies(packed, pack());
      renderer.end();
    };

    let frames = 0, lastStat = performance.now(), lastSimTime = 0, costSum = 0, costN = 0;
    let last = performance.now();
    const frame = (now) => {
      const steps = driver.tick((now - last) / 1000, BUDGET);
      last = now;
      if (steps) { costSum += driver.stepMs * steps; costN += steps; }
      drawOnce();

      frames++;
      if (now - lastStat >= 1000) {
        const seconds = (now - lastStat) / 1000;
        onStatsRef.current?.({
          fps: frames / seconds,
          speed: (sim.time - lastSimTime) / seconds,
          renderer: renderer.kind,
          stepMs: costN ? costSum / costN : 0,
          stepsPerSecond: driver.stepsPerSecond,
        });
        frames = 0; lastStat = now; lastSimTime = sim.time; costSum = 0; costN = 0;
      }
      raf = requestAnimationFrame(frame);
    };

    let raf = 0;
    if (reduceMotion) drawOnce();
    else raf = requestAnimationFrame(frame);

    const onVisibility = () => { last = performance.now(); }; // no catch-up burst after a hidden tab
    document.addEventListener('visibilitychange', onVisibility);
    const ro = new ResizeObserver(() => { fit(); if (reduceMotion) drawOnce(); });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      driverRef.current = null;
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="nbody" aria-label="Gravity simulation of two colliding nebulae" />;
}
