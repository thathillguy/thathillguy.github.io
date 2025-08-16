// src/Containers/IndexContainer.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Container from "@mui/material/Container";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Unstable_Grid2";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Switch from "@mui/material/Switch";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import Link from "@mui/material/Link";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import Paper from "@mui/material/Paper";
import GitHubIcon from "@mui/icons-material/GitHub";
import LinkedInIcon from "@mui/icons-material/LinkedIn";
import LaunchIcon from "@mui/icons-material/Launch";

// ---------------- N-Body BACKGROUND (About section only) ----------------
const rand = (min, max) => Math.random() * (max - min) + min;

function createGalaxy(count, w, h) {
  // Centered spiral-ish distribution
  const cx = w / 2, cy = h / 2;
  const particles = new Array(count).fill(0).map(() => {
    const r = rand(20, Math.min(w, h) * 0.45) * Math.sqrt(Math.random());
    const theta = rand(0, Math.PI * 2);
    const speed = Math.sqrt(r) * 2.0; // faux Keplerian falloff
    const vx = -Math.sin(theta) * speed;
    const vy = Math.cos(theta) * speed;
    return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta), vx, vy, mass: rand(0.5, 2.0) };
  });
  return particles;
}

function NBodyBackgroundSection({ attachToId = "about-section", particleCount = 320 }) {
  const canvasRef = useRef(null);
  const holderRef = useRef(null); // the section container
  const stateRef = useRef({ particles: [], w: 0, h: 0 });
  const runningRef = useRef(true);

  // Find / bind the holder element (About section)
  useEffect(() => {
    const el = document.getElementById(attachToId);
    if (el) holderRef.current = el;
  }, [attachToId]);

  const resizeToHolder = useCallback(() => {
    const canvas = canvasRef.current;
    const holder = holderRef.current;
    if (!canvas || !holder) return;

    // Use the rendered size of the holder (content box); DPR for crispness
    const dpr = window.devicePixelRatio || 1;
    const rect = holder.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      stateRef.current.w = w;
      stateRef.current.h = h;

      // Create particles in CSS pixels (convert from device pixels)
      const vw = w / dpr, vh = h / dpr;
      stateRef.current.particles = createGalaxy(particleCount, vw, vh);
    }
  }, [particleCount]);

  // Keep canvas perfectly covering the section and centered
  useEffect(() => {
    resizeToHolder();

    // React to window resize
    const onResize = () => resizeToHolder();
    window.addEventListener("resize", onResize);

    // React to section size changes (e.g., content wraps)
    let ro;
    if ("ResizeObserver" in window) {
      ro = new ResizeObserver(() => resizeToHolder());
      if (holderRef.current) ro.observe(holderRef.current);
    }

    return () => {
      window.removeEventListener("resize", onResize);
      if (ro && holderRef.current) ro.unobserve(holderRef.current);
    };
  }, [resizeToHolder]);

  // Animation loop
  useEffect(() => {
    let raf;
    let last = performance.now();

    const step = (now) => {
      if (!runningRef.current) return;
      const dt = Math.min(0.033, (now - last) / 1000); // cap dt
      last = now;
      renderFrame(dt);
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const renderFrame = (dt) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const { w, h, particles } = stateRef.current;

    // Trails for motion blur, fully cover the section every frame
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(0, 0, w, h);

    // Simple gravity
    const l = particles.length;
    const G = 40, soft = 6, speedMul = 1.0;
    for (let i = 0; i < l; i++) {
      let ax = 0, ay = 0;
      const pi = particles[i];
      for (let j = 0; j < l; j++) {
        if (i === j) continue;
        const pj = particles[j];
        const dx = pj.x - pi.x, dy = pj.y - pi.y;
        const dist2 = dx*dx + dy*dy + soft*soft;
        const inv = 1 / Math.sqrt(dist2);
        const f = (G * pj.mass) * inv * inv;
        ax += f * dx; ay += f * dy;
      }
      pi.vx += ax * dt * speedMul;
      pi.vy += ay * dt * speedMul;
    }

    // Integrate & wrap inside the section bounds (CSS pixels)
    const vw = w / dpr, vh = h / dpr;
    for (let i = 0; i < l; i++) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < 0) p.x += vw; if (p.x > vw) p.x -= vw;
      if (p.y < 0) p.y += vh; if (p.y > vh) p.y -= vh;
    }

    // Draw — color by velocity direction; additive for glow
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < l; i++) {
      const p = particles[i];
      const hue = (Math.atan2(p.vy, p.vx) * 180 / Math.PI + 360) % 360;
      ctx.fillStyle = `hsla(${hue}, 100%, 70%, 0.9)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.6, Math.min(2.5, p.mass)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  return (
    // Absolutely cover the section; canvas renders behind content
    <Box
      aria-hidden
      sx={{
        position: "absolute",
        inset: 0,
        zIndex: -1,
        pointerEvents: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </Box>
  );
}

// ------------------- SITE LAYOUT (no sliders) -------------------
const projects = [
  { title: "N-Body Simulation (this page)", desc: "Live, colorful n-body background in the About section.", chips: ["React", "Canvas", "Physics"], cta: [{ label: "Jump to projects", href: "#projects" }] },
  { title: "PBJ — Pipeline Query Builder", desc: "Programmatic query tool for large pipeline datasets with fast filtering.", chips: ["TypeScript", "Prisma", "Node"], cta: [{ label: "GitHub", href: "https://github.com/thathillguy" }] },
  { title: "Forecasting Module", desc: "REST + React forecasting UI backed by real-time CRM ingestion.", chips: ["React", "REST", "Postgres"], cta: [{ label: "Case study", href: "#case-forecasting" }] },
];

function NavTabs({ value, onChange }) {
  return (
    <Tabs value={value} onChange={onChange} textColor="inherit" indicatorColor="secondary">
      <Tab label="Home" value="home"/>
      <Tab label="Projects" value="projects"/>
      <Tab label="About" value="about"/>
      <Tab label="Contact" value="contact"/>
    </Tabs>
  );
}

export default function IndexContainer() {
  const [dark, setDark] = useState(true);
  const [tab, setTab] = useState("home");

  const theme = useMemo(() => createTheme({
    palette: { mode: dark ? "dark" : "light", primary: { main: dark ? "#90caf9" : "#1976d2" } },
    shape: { borderRadius: 14 },
    typography: { fontFamily: "Inter, system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif" },
  }), [dark]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      <AppBar position="sticky" color="transparent" elevation={0}
        sx={{ backdropFilter: "saturate(150%) blur(8px)", backgroundColor: (t) => t.palette.mode === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.7)' }}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography variant="h6" fontWeight={800} sx={{ flexGrow: 1 }}>Robert Hill</Typography>
          <NavTabs value={tab} onChange={(_, v) => setTab(v)} />
          <Stack direction="row" gap={1}>
            <Tooltip title="GitHub"><IconButton component={Link} href="https:
