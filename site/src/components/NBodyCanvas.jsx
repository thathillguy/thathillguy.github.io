import { useEffect, useRef } from 'react';
import { NBody, COLOURS } from '../sim/nbody.js';

const UNITS = 100;        // the shorter side of the canvas spans this many sim units
const FLING = 1.0;        // launch speed per sim unit of pull-back
const TAP_PX = 5;         // pointer movement under this counts as a click, not a pull
const TAU = Math.PI * 2;

export default function NBodyCanvas({ bodies = 150, onInteract }) {
  const canvasRef = useRef(null);
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;

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

    // A pull: the body is held at the pointer, tethered to the anchor where the press began.
    // Releasing launches it from the pointer back through the anchor, like an elastic band.
    const pull = { active: false, pulling: false, ax: 0, ay: 0, x: 0, y: 0, radius: 2, colour: 0 };
    const launchVelocity = () => [(pull.ax - pull.x) * FLING, (pull.ay - pull.y) * FLING];

    const circle = (x, y, r) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
    };

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
        circle(x[i], y[i], r[i]);
        ctx.fill();
        ctx.stroke();
      }

      ctx.fillStyle = '#000';
      circle(0, 0, sim.o.centralRadius);
      ctx.fill();

      if (pull.active && pull.pulling) {
        const [vx, vy] = launchVelocity();

        // predicted path, dotted, fading out
        const path = sim.previewPath(pull.x, pull.y, vx, vy);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let k = 0; k < path.length; k += 2) {
          if (k % 4) continue;
          circle(path[k], path[k + 1], 0.35 * (1 - k / path.length) + 0.1);
          ctx.fill();
        }

        // the band
        ctx.lineWidth = 2 / pxPerUnit;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.moveTo(pull.ax, pull.ay);
        ctx.lineTo(pull.x, pull.y);
        ctx.stroke();

        // anchor ring and the held body
        ctx.lineWidth = 1.5 / pxPerUnit;
        ctx.strokeStyle = '#000';
        circle(pull.ax, pull.ay, 1.2);
        ctx.stroke();
        ctx.fillStyle = COLOURS[pull.colour];
        circle(pull.x, pull.y, pull.radius);
        ctx.fill();
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
      [pull.ax, pull.ay] = toSim(e);
      pull.x = pull.ax;
      pull.y = pull.ay;
      pull.active = true;
      pull.pulling = false;
      pull.radius = 1.6 + Math.random() * 1.2;
      pull.colour = Math.floor(Math.random() * COLOURS.length);
    };
    const onMove = (e) => {
      if (!pull.active) return;
      [pull.x, pull.y] = toSim(e);
      if (Math.hypot(pull.x - pull.ax, pull.y - pull.ay) * pxPerUnit > TAP_PX) pull.pulling = true;
      if (reduceMotion) draw();
    };
    const onUp = (e) => {
      if (!pull.active) return;
      pull.active = false;
      [pull.x, pull.y] = toSim(e);
      if (pull.pulling) {
        const [vx, vy] = launchVelocity();
        sim.addBody(pull.x, pull.y, vx, vy, pull.radius, pull.colour);
      } else {
        const [vx, vy] = sim.orbitalVelocity(pull.ax, pull.ay, 0.97);
        sim.addBody(pull.ax, pull.ay, vx, vy, pull.radius, pull.colour);
      }
      onInteractRef.current?.();
      if (reduceMotion) draw();
    };
    const onCancel = () => { pull.active = false; };

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
