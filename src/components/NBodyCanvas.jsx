import { useEffect, useRef } from 'react';
import { NBody, COLOURS } from '../sim/nbody.js';

const UNITS = 100;        // the shorter side of the canvas spans this many sim units
const FLING = 0.4;        // sim velocity per sim unit of drag
const TAP_PX = 5;         // pointer movement under this counts as a click, not a drag
const TAU = Math.PI * 2;

export default function NBodyCanvas({ bodies = 150 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
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

    const sim = new NBody({ bodies, halfW: width / 2 / pxPerUnit, halfH: height / 2 / pxPerUnit });

    const fit = () => {
      measure();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      sim.setViewport(width / 2 / pxPerUnit, height / 2 / pxPerUnit);
    };
    fit();

    const drag = { active: false, x0: 0, y0: 0, x: 0, y: 0, moved: false };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.translate(width / 2, height / 2);
      ctx.scale(pxPerUnit, pxPerUnit);
      ctx.lineWidth = 1 / pxPerUnit;
      ctx.strokeStyle = '#000';

      const { n, x, y, r, colour } = sim;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = COLOURS[colour[i]];
        ctx.beginPath();
        ctx.arc(x[i], y[i], r[i], 0, TAU);
        ctx.fill();
        ctx.stroke();
      }

      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(0, 0, sim.o.centralRadius, 0, TAU);
      ctx.fill();

      if (drag.active && drag.moved) {
        ctx.beginPath();
        ctx.moveTo(drag.x0, drag.y0);
        ctx.lineTo(drag.x, drag.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(drag.x, drag.y, 2, 0, TAU);
        ctx.stroke();
      }
    };

    let raf = 0;
    let last = performance.now();
    const frame = (now) => {
      sim.advance((now - last) / 1000);
      last = now;
      draw();
      raf = requestAnimationFrame(frame);
    };
    if (reduceMotion) draw();
    else raf = requestAnimationFrame(frame);

    const toSim = (e) => {
      const rect = canvas.getBoundingClientRect();
      return [(e.clientX - rect.left - width / 2) / pxPerUnit, (e.clientY - rect.top - height / 2) / pxPerUnit];
    };

    const onDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      [drag.x0, drag.y0] = toSim(e);
      drag.x = drag.x0;
      drag.y = drag.y0;
      drag.active = true;
      drag.moved = false;
    };
    const onMove = (e) => {
      if (!drag.active) return;
      [drag.x, drag.y] = toSim(e);
      if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) * pxPerUnit > TAP_PX) drag.moved = true;
      if (reduceMotion) draw();
    };
    const onUp = (e) => {
      if (!drag.active) return;
      drag.active = false;
      [drag.x, drag.y] = toSim(e);
      const radius = 1.6 + Math.random() * 1.2;
      const colour = Math.floor(Math.random() * COLOURS.length);
      if (drag.moved) {
        sim.addBody(drag.x, drag.y, (drag.x - drag.x0) * FLING, (drag.y - drag.y0) * FLING, radius, colour);
      } else {
        const [vx, vy] = sim.orbitalVelocity(drag.x0, drag.y0, 0.97);
        sim.addBody(drag.x0, drag.y0, vx, vy, radius, colour);
      }
      if (reduceMotion) draw();
    };
    const onCancel = () => { drag.active = false; };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);

    const ro = new ResizeObserver(() => {
      fit();
      if (reduceMotion) draw();
    });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
    };
  }, [bodies]);

  return <canvas ref={canvasRef} className="nbody" aria-label="Gravity simulation" />;
}
