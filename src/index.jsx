// src/index.jsx
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

/** ====== About section with n-body background (incl. central black hole) ====== */
function About() {
  const sectionRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const section = sectionRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    // ----- sim constants (tweak to taste) -----
    const G = 60;                 // gravitational constant (visual)
    const BH_MASS = 1000;         // black hole mass (big)
    const SOFT = 8;               // softening to avoid singularities
    const COUNT = 260;            // number of orbiting bodies
    const TRAIL_ALPHA = 0.12;     // 0 = no trails; higher = more persistence

    // ----- state -----
    let particles = [];
    let width = 0, height = 0, dpr = 1;
    let raf, last = performance.now();

    const fit = () => {
      if (!section) return;
      dpr = window.devicePixelRatio || 1;
      const rect = section.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (w !== width || h !== height) {
        width = w; height = h;
        canvas.width = width; canvas.height = height;
        // (CSS size stays 100% via style)
        initParticles();
      }
    };

    const initParticles = () => {
      const vw = width / dpr, vh = height / dpr;
      const cx = vw / 2, cy = vh / 2;
      particles = Array.from({ length: COUNT }, () => {
        // spiral-ish disc around center with orbital velocity
        const r = (Math.min(vw, vh) * 0.45) * Math.sqrt(Math.random());
        const theta = Math.random() * Math.PI * 2;
        const x = cx + r * Math.cos(theta);
        const y = cy + r * Math.sin(theta);

        // circular orbit approx: v = sqrt(G*M / r)
        const speed = Math.sqrt((G * BH_MASS) / Math.max(r, 1));
        const vx = -Math.sin(theta) * speed + (Math.random() - 0.5) * 2;
        const vy =  Math.cos(theta) * speed + (Math.random() - 0.5) * 2;
        const mass = 0.6 + Math.random() * 2.0;

        return { x, y, vx, vy, m: mass };
      });
    };

    const step = (dt) => {
      const vw = width / dpr, vh = height / dpr;
      const cx = vw / 2, cy = vh / 2;

      // n^2 forces among particles (small N) + strong BH at center
      const n = particles.length;

      // accel from other particles
      for (let i = 0; i < n; i++) {
        let ax = 0, ay = 0;
        const pi = particles[i];

        // attract to black hole
        {
          const dx = cx - pi.x, dy = cy - pi.y;
          const d2 = dx*dx + dy*dy + SOFT*SOFT;
          const inv = 1 / Math.sqrt(d2);
          const f = (G * BH_MASS) * inv * inv; // ~ G*M/r^2
          ax += f * dx; ay += f * dy;
        }

        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const pj = particles[j];
          const dx = pj.x - pi.x, dy = pj.y - pi.y;
          const d2 = dx*dx + dy*dy + SOFT*SOFT;
          const inv = 1 / Math.sqrt(d2);
          const f = (G * pj.m) * inv * inv;
          ax += f * dx; ay += f * dy;
        }

        pi.vx += ax * dt;
        pi.vy += ay * dt;
      }

      // integrate + wrap edges
      for (let p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.x < 0) p.x += vw; if (p.x > vw) p.x -= vw;
        if (p.y < 0) p.y += vh; if (p.y > vh) p.y -= vh;
      }
    };

    const draw = () => {
      // trails / fade
      ctx.fillStyle = `rgba(0,0,0,${TRAIL_ALPHA})`;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.globalCompositeOperation = "lighter";

      // draw colorful particles (hue by velocity direction)
      for (let p of particles) {
        const hue = (Math.atan2(p.vy, p.vx) * 180 / Math.PI + 360) % 360;
        ctx.fillStyle = `hsla(${hue}, 100%, 70%, 0.9)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.6, Math.min(2.6, p.m)), 0, Math.PI * 2);
        ctx.fill();
      }

      // draw black hole (centered, with a soft glow ring)
      const vw = width / dpr, vh = height / dpr;
      const cx = vw / 2, cy = vh / 2;
      const rBH = Math.max(10, Math.min(vw, vh) * 0.04);

      // glow ring
      const grad = ctx.createRadialGradient(cx, cy, rBH, cx, cy, rBH * 2.2);
      grad.addColorStop(0, "rgba(255,140,0,0.25)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, rBH * 2.2, 0, Math.PI * 2);
      ctx.fill();

      // core
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(cx, cy, rBH, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    };

    const loop = (now) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      step(dt);
      draw();
      raf = requestAnimationFrame(loop);
    };

    // wire up sizing + start
    const ro = new ResizeObserver(fit);
    ro.observe(section);
    window.addEventListener("resize", fit);
    // ensure the section has real height so the canvas is visible
    section.style.minHeight = "70vh";
    section.style.position = "relative";
    fit();
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: "12px",
        marginTop: "64px",
      }}
    >
      {/* background canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
      {/* foreground content */}
      <div style={{ position: "relative", zIndex: 1, padding: "24px" }}>
        <h2 style={{ margin: 0, fontSize: "28px", fontWeight: 800 }}>About</h2>
        <p style={{ maxWidth: 800, lineHeight: 1.6, marginTop: 12 }}>
          I build performant systems and clean UIs. This section’s background is a real-time
          n-body simulation with a massive black hole at the center pulling colored bodies into orbit.
        </p>
      </div>
    </section>
  );
}

/** ====== Minimal single-page component ====== */
function App() {
  return (
    <main style={{ fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif", color: "#eaeaea", background: "#0b0b0b", minHeight: "100vh", padding: "40px 20px 80px" }}>
      <header style={{ maxWidth: 1024, margin: "0 auto 56px" }}>
        <div style={{ color: "#9aa4ad", letterSpacing: "0.12em", fontSize: 12, fontWeight: 700 }}>
          SENIOR SOFTWARE ENGINEER
        </div>
        <h1 style={{ margin: "8px 0 12px", fontSize: 42, lineHeight: 1.1 }}>
          Building performant systems & delightful UX
        </h1>
        <p style={{ margin: 0, maxWidth: 720 }}>
          Below, the About section uses a colorful, real-time n-body simulation with a central black hole.
        </p>
      </header>

      <div style={{ maxWidth: 1024, margin: "0 auto" }}>
        <About />
      </div>

      <footer style={{ maxWidth: 1024, margin: "56px auto 0", opacity: 0.6, fontSize: 12 }}>
        © {new Date().getFullYear()} Robert Hill
      </footer>
    </main>
  );
}

// Mount
const root = createRoot(document.getElementById("app"));
root.render(<App />);
